#!/usr/bin/env python3
"""Build the homepage's allowlisted training JSON from a local snapshot.

No authentication files or network access are used. Dates use Asia/Shanghai.
All recorded sets (including warm-ups) are included. Repetition counts prefer
Enode's set-level repCount; only valid concentric records supply velocities.
Volume is external load in kg times repetitions, without adding body mass or
doubling unilateral exercises. Missing load stays null, never zero.
"""

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from zoneinfo import ZoneInfo

from enode_export import (
    ExportError, build_rows, identifier, load_catalog, named_values, number, ordering,
)

TIMEZONE = "Asia/Shanghai"


def timestamp(value):
    if not isinstance(value, str):
        raise ExportError("Snapshot download time is missing.")
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.utcoffset() is None:
            raise ValueError
        return parsed.astimezone(dt.timezone.utc).isoformat()
    except ValueError as exc:
        raise ExportError("Snapshot download time must include a timezone.") from exc


def build_public(snapshot, catalog, translations, exercise_names):
    if not isinstance(snapshot, dict):
        raise ExportError("Training snapshot must be an object.")
    # Reuse the exporter's complete identity/relationship validation before
    # producing any public output. Its rows and raw metric values stay private.
    build_rows({**snapshot, "timezone": TIMEZONE}, catalog, translations, exercise_names)
    if not {"loadingMass", "repCount", "velocityMean"}.issubset(
        {metric.get("key") for metric in catalog.values()}
    ):
        raise ExportError("Required load, repetition and velocity definitions are missing.")
    updated_at = timestamp(snapshot.get("fetchedAt"))
    start, end = snapshot.get("fromMs"), snapshot.get("toMs")
    if not number(start) or not number(end) or start >= end:
        raise ExportError("Snapshot coverage is missing or invalid.")
    zone = ZoneInfo(TIMEZONE)
    try:
        coverage = {
            "from": dt.datetime.fromtimestamp(start / 1000, zone).isoformat(),
            "to": dt.datetime.fromtimestamp(end / 1000, zone).isoformat(),
        }
    except (ValueError, OverflowError, OSError) as exc:
        raise ExportError("Snapshot coverage is out of range.") from exc
    details = {identifier(key): value for key, value in snapshot["sets"].items()}
    days = {}
    for session in sorted(snapshot["sessions"], key=lambda item: (item["created"], ordering(item))):
        if not start <= session["created"] <= end:
            raise ExportError("Training date falls outside snapshot coverage.")
        date = dt.datetime.fromtimestamp(session["created"] / 1000, zone).date().isoformat()
        exercise = session.get("exercise") or {}
        exercise_id = exercise.get("id") or session.get("exerciseID") or exercise.get("exerciseDefinitionID")
        label = (exercise.get("name") or exercise_names.get(identifier(exercise_id))
                 or translations.get(identifier(exercise.get("nameTextContentID"))))
        if not isinstance(label, str) or not label.strip():
            # Do not publish an internal UUID as a fallback exercise label.
            raise ExportError("An exercise name cannot be resolved; update the local catalog.")
        for reference in sorted(session["sets"], key=ordering):
            detail = details[identifier(reference["id"])]
            values = named_values(detail, catalog)
            load = values.get("loadingMass")
            if load is not None and (not number(load) or load < 0):
                raise ExportError("External load must be nonnegative or missing.")
            reps = []
            for rep in sorted(detail["reps"], key=ordering):
                if rep.get("valid") is not True or rep.get("phase") != "concentric":
                    continue
                velocity = named_values(rep, catalog).get("velocityMean")
                if velocity is not None and (not number(velocity) or velocity < 0):
                    raise ExportError("Mean velocity must be nonnegative or missing.")
                reps.append({"meanVelocityMps": velocity} if velocity is not None else {})
            rep_count = values.get("repCount")
            if rep_count is None:
                rep_count = len(reps)
            if not number(rep_count) or rep_count < 0 or int(rep_count) != rep_count:
                raise ExportError("Repetition count must be a nonnegative integer.")
            work = detail.get("work")
            if work is not None and not isinstance(work, bool):
                raise ExportError("Set classification must be true, false or missing.")
            public_set = {
                "id": "set-" + hashlib.sha256(identifier(detail["id"]).encode()).hexdigest()[:20],
                "exercise": label.strip(), "weightKg": load,
                "repCount": int(rep_count), "work": work, "reps": reps,
            }
            days.setdefault(date, []).append(public_set)
    return {
        "schemaVersion": 1, "timezone": TIMEZONE, "updatedAt": updated_at,
        "coverage": coverage,
        "sessions": [{"id": "day-" + date, "date": date, "sets": sets} for date, sets in sorted(days.items())],
    }


def export_public(snapshot_path, catalog_path, output):
    if snapshot_path.name in ("client.json", "session.json"):
        raise ExportError("Authentication files are not training snapshots.")
    if output.is_symlink() or output.resolve() in (snapshot_path.resolve(), catalog_path.resolve()):
        raise ExportError("Output must not overwrite the input or a symbolic link.")
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    public = build_public(snapshot, *load_catalog(catalog_path))
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".training-", dir=output.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(public, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    sets = [item for day in public["sessions"] for item in day["sets"]]
    return {
        "training_days": len(public["sessions"]), "sets": len(sets),
        "repetitions": sum(item["repCount"] for item in sets),
        "external_load_volume_kg": sum((item["weightKg"] or 0) * item["repCount"] for item in sets),
        "sets_with_unknown_load": sum(item["weightKg"] is None for item in sets),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--catalog", "--catalog-db", dest="catalog_db", type=Path, required=True,
                        help="Portable JSON catalog or the local app SQLite database")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = export_public(args.snapshot, args.catalog_db, args.output)
    except (ExportError, OSError, sqlite3.Error, json.JSONDecodeError) as exc:
        message = str(exc) if isinstance(exc, ExportError) else type(exc).__name__
        parser.exit(1, "Public export failed: " + message + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
