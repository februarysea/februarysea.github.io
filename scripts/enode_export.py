#!/usr/bin/env python3
"""Export an Enode training snapshot offline; never read authentication files.

The full native JSON remains unchanged at --snapshot. CSV files and summary.json
contain training fields only. A rep-record is one recorded phase, including
invalid records; it is not necessarily one completed repetition.
"""

import argparse
import csv
import datetime as dt
import json
import math
import os
from pathlib import Path
import sqlite3
import tempfile
import uuid
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


UNDEFINED = -99999999
REP_COLUMNS = [
    "training_local_time", "timezone", "exercise", "session_id", "set_id",
    "set_order", "work", "loading_kg", "set_rep_count", "rep_id", "order",
    "phase", "valid", "velocity_mean_m_s", "velocity_peak_m_s", "duration_s",
]
MEASUREMENT_COLUMNS = [
    "training_local_time", "timezone", "exercise", "session_id", "set_id",
    "rep_id", "level", "entity_id", "measurement_id", "metric_id",
    "metric_key", "dimension", "loading_factor", "value_basis", "stored_unit",
    "raw_value", "value_user", "effective_value", "confidence", "created_ms",
]
# These are storage units, not the units selected for display in the app.
STORED_UNITS = {
    "mass": "kg", "speed": "m/s", "acceleration": "m/s^2", "length": "m",
    "duration": "s", "exertion": "RIR", "count": "count", "percent": "ratio",
    "heartRate": "bpm", "angle": "deg", "angularVelocity": "deg/s",
    "inertia": "kg*m^2", "rsi": "RSI", "scalar": "1",
    "force": "N", "power": "W", "rfd": "N/s",
}


class ExportError(Exception):
    """A safe-to-display export validation error."""


def identifier(value):
    if isinstance(value, bytes):
        try:
            return str(uuid.UUID(bytes=value))
        except ValueError:
            return ""
    return value.lower() if isinstance(value, str) else ""


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def effective(measurement):
    override = measurement.get("valueUser")
    value = override if number(override) and override not in (UNDEFINED, 0) else measurement.get("value")
    return value if number(value) and value != UNDEFINED else None


def cell(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value).lower()
    return value


def load_catalog(path):
    if not path.is_file():
        raise ExportError("Catalog database is missing.")
    metrics, translations, exercises = {}, {}, {}
    with sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        entities = {row["Z_NAME"]: row["Z_ENT"] for row in db.execute(
            "SELECT Z_NAME, Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME IN (?, ?, ?)",
            ("ENMetric", "ENTranslation", "ENExercise"),
        )}
        if len(entities) != 3:
            raise ExportError("Expected metric, translation and exercise entities are missing.")
        for row in db.execute("SELECT ZID, ZVALUE1 FROM ZSERVERENTITY WHERE Z_ENT=?", (entities["ENTranslation"],)):
            translations[identifier(row["ZID"])] = row["ZVALUE1"]
        for row in db.execute(
            "SELECT m.ZID, m.ZKEY2, m.ZDIMENSION, m.ZLOADINGFACTOR, t.ZVALUE1 "
            "FROM ZSERVERENTITY m LEFT JOIN ZSERVERENTITY t ON t.Z_PK=m.ZNAMETEXTCONTENT14 "
            "WHERE m.Z_ENT=?", (entities["ENMetric"],),
        ):
            metrics[identifier(row["ZID"])] = {
                "key": row["ZKEY2"], "dimension": row["ZDIMENSION"],
                "loadingFactor": row["ZLOADINGFACTOR"], "name": row["ZVALUE1"],
            }
        for row in db.execute(
            "SELECT x.ZID, x.ZNAME1, t.ZVALUE1 FROM ZSERVERENTITY x "
            "LEFT JOIN ZSERVERENTITY t ON t.Z_PK=x.ZNAMETEXTCONTENT5 WHERE x.Z_ENT=?",
            (entities["ENExercise"],),
        ):
            exercises[identifier(row["ZID"])] = row["ZNAME1"] or row["ZVALUE1"]
    return metrics, translations, exercises


def measurements(entity):
    values = entity.get("measurements", [])
    if not isinstance(values, list) or any(not isinstance(value, dict) for value in values):
        raise ExportError("Invalid measurements list in training snapshot.")
    return values


def named_values(entity, catalog):
    values = {}
    for measurement in measurements(entity):
        key = catalog.get(identifier(measurement.get("metricID")), {}).get("key")
        if key:
            values[key] = effective(measurement)
    return values


def ordering(entity):
    order = entity.get("order")
    return (order if number(order) else float("inf"), identifier(entity.get("id")))


def build_rows(snapshot, catalog, translations, exercise_names):
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("sessions"), list) or not isinstance(snapshot.get("sets"), dict):
        raise ExportError("Snapshot must contain sessions as a list and sets as an object.")
    timezone = snapshot.get("timezone") or "Asia/Shanghai"
    try:
        zone = ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, TypeError, ValueError) as exc:
        raise ExportError("Snapshot timezone is invalid.") from exc
    details = {}
    for key, detail in snapshot["sets"].items():
        if not isinstance(detail, dict) or not identifier(detail.get("id")) or identifier(key) != identifier(detail["id"]):
            raise ExportError("Invalid set identity in snapshot.")
        normalized = identifier(key)
        if normalized in details:
            raise ExportError("Duplicate set identity in snapshot.")
        details[normalized] = detail
    rep_rows, metric_rows = [], []
    seen_sessions, seen_sets, seen_reps, dates, unknown_metrics = set(), set(), set(), set(), set()

    def add_measurements(entity, level, context):
        for measurement in measurements(entity):
            metric_id = identifier(measurement.get("metricID"))
            metric = catalog.get(metric_id, {})
            if not metric and metric_id:
                unknown_metrics.add(metric_id)
            dimension, factor = metric.get("dimension"), metric.get("loadingFactor")
            row = {
                **context, "level": level, "entity_id": entity.get("id"),
                "measurement_id": measurement.get("id"), "metric_id": measurement.get("metricID"),
                "metric_key": metric.get("key"), "dimension": dimension, "loading_factor": factor,
                # No load multiplication occurs in this exporter. In particular,
                # normalized force/power/RFD values must not be labelled N/W/N/s.
                "value_basis": "before_loading_factor" if factor else "stored",
                "stored_unit": "" if factor or factor is None else STORED_UNITS.get(dimension, ""),
                "raw_value": measurement.get("value"), "value_user": measurement.get("valueUser"),
                "effective_value": effective(measurement), "confidence": measurement.get("confidence"),
                "created_ms": measurement.get("created"),
            }
            metric_rows.append(row)

    for session in snapshot["sessions"]:
        if not isinstance(session, dict) or not identifier(session.get("id")) or not number(session.get("created")):
            raise ExportError("Session identity or timestamp is missing.")
        sid = identifier(session["id"])
        if sid in seen_sessions:
            raise ExportError("Duplicate session identity in snapshot.")
        seen_sessions.add(sid)
        try:
            local_time = dt.datetime.fromtimestamp(session["created"] / 1000, zone)
        except (ValueError, OverflowError, OSError) as exc:
            raise ExportError("Session timestamp is out of range.") from exc
        dates.add(local_time.date().isoformat())
        exercise = session.get("exercise") or {}
        if not isinstance(exercise, dict):
            raise ExportError("Invalid exercise object in snapshot.")
        exercise_id = exercise.get("id") or session.get("exerciseID") or exercise.get("exerciseDefinitionID") or ""
        label = (exercise.get("name") or exercise_names.get(identifier(exercise_id))
                 or translations.get(identifier(exercise.get("nameTextContentID"))) or exercise_id)
        context = {
            "training_local_time": local_time.isoformat(timespec="milliseconds"),
            "timezone": timezone, "exercise": label, "session_id": session["id"],
            "set_id": "", "rep_id": "",
        }
        add_measurements(session, "session", context)
        references = session.get("sets")
        if not isinstance(references, list) or any(not isinstance(item, dict) for item in references):
            raise ExportError("Session sets list is missing or invalid.")
        for reference in sorted(references, key=ordering):
            set_id = identifier(reference.get("id"))
            detail = details.get(set_id)
            if not detail or identifier(detail.get("sessionID")) != sid or set_id in seen_sets:
                raise ExportError("Set detail is missing, duplicated or belongs to another session.")
            seen_sets.add(set_id)
            set_context = {**context, "set_id": detail["id"]}
            add_measurements(detail, "set", set_context)
            set_values = named_values(detail, catalog)
            reps = detail.get("reps")
            if not isinstance(reps, list) or any(not isinstance(rep, dict) for rep in reps):
                raise ExportError("Set rep records are missing or invalid.")
            for rep in sorted(reps, key=ordering):
                rid = identifier(rep.get("id"))
                if not rid or rid in seen_reps or identifier(rep.get("setID")) != set_id:
                    raise ExportError("Rep record identity or set relationship is invalid.")
                seen_reps.add(rid)
                rep_context = {**set_context, "rep_id": rep["id"]}
                add_measurements(rep, "rep", rep_context)
                rep_values = named_values(rep, catalog)
                rep_rows.append({
                    **rep_context, "set_order": detail.get("order"), "work": detail.get("work"),
                    "loading_kg": set_values.get("loadingMass"), "set_rep_count": set_values.get("repCount"),
                    "order": rep.get("order"), "phase": rep.get("phase"), "valid": rep.get("valid"),
                    "velocity_mean_m_s": rep_values.get("velocityMean"),
                    "velocity_peak_m_s": rep_values.get("velocityPeak"), "duration_s": rep_values.get("duration"),
                })
    if seen_sets != set(details):
        raise ExportError("Snapshot contains set details without a matching session reference.")
    counts = {
        "training_days": len(dates), "sessions": len(seen_sessions), "sets": len(seen_sets),
        "rep_records": len(rep_rows),
        "valid_concentric_records": sum(row["phase"] == "concentric" and row["valid"] is True for row in rep_rows),
        "invalid_rep_records": sum(row["valid"] is False for row in rep_rows),
        "measurements": len(metric_rows), "unknown_metrics": len(unknown_metrics),
    }
    return rep_rows, metric_rows, counts, timezone


def private_write(path, writer):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="") as stream:
        writer(stream)
        stream.flush()
        os.fsync(stream.fileno())


def csv_write(stream, columns, rows):
    writer = csv.DictWriter(stream, fieldnames=columns)
    writer.writeheader()
    writer.writerows({key: cell(row.get(key)) for key in columns} for row in rows)


def export(snapshot_path, catalog_path, output):
    if snapshot_path.name in ("client.json", "session.json"):
        raise ExportError("Authentication files are not training snapshots.")
    with snapshot_path.open(encoding="utf-8") as stream:
        snapshot = json.load(stream)
    catalog, translations, exercise_names = load_catalog(catalog_path)
    reps, metrics, counts, timezone = build_rows(snapshot, catalog, translations, exercise_names)
    if output.is_symlink():
        raise ExportError("Output directory must not be a symbolic link.")
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    output.chmod(0o700)
    if snapshot_path.resolve() in {output.resolve() / name for name in ("rep-records.csv", "measurements.csv", "summary.json")}:
        raise ExportError("Output would overwrite the source snapshot.")
    summary = {
        "schema_version": 1, "timezone": timezone, **counts,
        "rep_record_definition": "One recorded phase, including invalid records; not necessarily one completed repetition.",
        "measurement_values": "Raw values and effective overrides; loadingFactor has not been multiplied.",
        "native_json": "The complete source snapshot remains unchanged at the input location.",
    }
    # Stage every file before replacing any prior output. summary.json is the
    # completion marker and is replaced last. No partial CSV is ever published.
    with tempfile.TemporaryDirectory(prefix=".enode-export-", dir=output) as temporary:
        staging = Path(temporary)
        private_write(staging / "rep-records.csv", lambda stream: csv_write(stream, REP_COLUMNS, reps))
        private_write(staging / "measurements.csv", lambda stream: csv_write(stream, MEASUREMENT_COLUMNS, metrics))
        private_write(staging / "summary.json", lambda stream: json.dump(summary, stream, ensure_ascii=False, indent=2, allow_nan=False))
        for name in ("rep-records.csv", "measurements.csv", "summary.json"):
            os.replace(staging / name, output / name)
    return counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--catalog-db", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        counts = export(args.snapshot, args.catalog_db, args.output)
    except (ExportError, OSError, sqlite3.Error, json.JSONDecodeError) as exc:
        # Avoid printing rows, SQL or source contents on failure.
        message = str(exc) if isinstance(exc, ExportError) else type(exc).__name__
        parser.exit(1, "Export failed: " + message + "\n")
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
