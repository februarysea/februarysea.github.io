"""Validate the public Codex usage snapshot. This module never reads credentials."""
import argparse
import json
import math
from datetime import date, datetime
from pathlib import Path


def token_count(value):
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or value < 0 or value > 2**53 - 1
            or not math.isfinite(value) or value != int(value)):
        raise ValueError("Invalid token count.")
    return int(value)


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError("Invalid snapshot timestamp.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("Invalid snapshot timestamp.") from None
    if parsed.tzinfo is None:
        raise ValueError("Snapshot timestamp needs a timezone.")
    return parsed


def validate_snapshot(snapshot):
    required = {"version", "source", "generatedAt", "totalTokens", "daily"}
    if not isinstance(snapshot, dict) or set(snapshot) not in (required, required | {"archivedThrough"}):
        raise ValueError("Unexpected or missing snapshot fields.")
    if type(snapshot["version"]) is not int or snapshot["version"] != 1 or snapshot["source"] != "codex-profile-service":
        raise ValueError("Invalid snapshot version or source.")
    timestamp(snapshot["generatedAt"])
    total = token_count(snapshot["totalTokens"])
    if not isinstance(snapshot["daily"], list):
        raise ValueError("Invalid daily statistics.")
    previous_day = ""
    daily_total = 0
    for day in snapshot["daily"]:
        if not isinstance(day, dict) or set(day) != {"date", "totalTokens"}:
            raise ValueError("Unexpected or missing daily fields.")
        current_day = day["date"]
        try:
            if not isinstance(current_day, str) or date.fromisoformat(current_day).isoformat() != current_day:
                raise ValueError
        except ValueError:
            raise ValueError("Invalid daily date.") from None
        if current_day <= previous_day:
            raise ValueError("Daily dates must be unique and sorted.")
        previous_day = current_day
        daily_total += token_count(day["totalTokens"])
    if daily_total > total:
        raise ValueError("Daily usage exceeds the lifetime total.")
    if "archivedThrough" in snapshot:
        through = snapshot["archivedThrough"]
        if not isinstance(through, str) or date.fromisoformat(through).isoformat() != through:
            raise ValueError("Invalid archive cutoff date.")
        if through not in {row["date"] for row in snapshot["daily"]}:
            raise ValueError("Missing archived cutoff bucket.")
    return snapshot


def validate_update(previous, current):
    validate_snapshot(previous)
    validate_snapshot(current)
    if timestamp(current["generatedAt"]) < timestamp(previous["generatedAt"]):
        raise ValueError("Refusing an older snapshot.")
    if previous["daily"] and (not current["daily"] or current["daily"][-1]["date"] < previous["daily"][-1]["date"]):
        raise ValueError("Refusing missing or older daily coverage.")
    if "archivedThrough" in previous:
        cutoff = previous["archivedThrough"]
        if current.get("archivedThrough") != cutoff:
            raise ValueError("Refusing to remove or change the archived usage cutoff.")
        if ([row for row in previous["daily"] if row["date"] <= cutoff] !=
                [row for row in current["daily"] if row["date"] <= cutoff]):
            raise ValueError("Refusing to rewrite archived account history.")
    # The service may correct counts; do not invent a monotonic lifetime total.
    return current


def extend_archive(archive, primary, previous):
    """Keep the old combined prefix; add only primary-account days after it.

    The old collector did not retain per-account snapshots. Never guess the
    retired account's contribution or add the active account's lifetime twice.
    The archive marker distinguishes migrated history from older live aggregates.
    """
    for item in (archive, primary, previous):
        validate_snapshot(item)
    if not archive["daily"] or "archivedThrough" in archive or "archivedThrough" in primary:
        raise ValueError("Expected a raw archive and one live account snapshot.")
    cutoff = archive["daily"][-1]["date"]
    if timestamp(primary["generatedAt"]) < timestamp(archive["generatedAt"]):
        raise ValueError("Live usage predates the archive.")
    future = {}
    if "archivedThrough" in previous:
        if previous["archivedThrough"] != cutoff or [r for r in previous["daily"] if r["date"] <= cutoff] != archive["daily"]:
            raise ValueError("Published archive does not match the fixed baseline.")
        future = {r["date"]: r["totalTokens"] for r in previous["daily"] if r["date"] > cutoff}
        if previous["totalTokens"] != archive["totalTokens"] + sum(future.values()):
            raise ValueError("Archived lifetime total is inconsistent.")
        if future and (not primary["daily"] or primary["daily"][-1]["date"] < max(future)):
            raise ValueError("Live account coverage regressed.")
    # Replace repeated dates instead of accumulating them on every run. Keep
    # older primary-only days when they roll out of the service's read window.
    future.update({r["date"]: r["totalTokens"] for r in primary["daily"] if r["date"] > cutoff})
    result = {**archive, "generatedAt": primary["generatedAt"], "archivedThrough": cutoff,
              "totalTokens": token_count(archive["totalTokens"] + sum(future.values())),
              "daily": [*archive["daily"], *({"date": day, "totalTokens": value} for day, value in sorted(future.items()))]}
    validate_snapshot(result)
    if "archivedThrough" in previous:
        validate_update(previous, result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--previous", type=Path)
    args = parser.parse_args()
    try:
        snapshot = validate_snapshot(json.loads(args.snapshot.read_text()))
        if args.previous:
            validate_update(json.loads(args.previous.read_text()), snapshot)
    except (OSError, ValueError, TypeError):
        parser.exit(1, "Invalid public Codex usage snapshot; no files were changed.\n")
    print(f"Validated {len(snapshot['daily'])} public daily usage buckets.")


if __name__ == "__main__":
    main()
