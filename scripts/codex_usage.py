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
    if not isinstance(snapshot, dict) or set(snapshot) != {"version", "source", "generatedAt", "totalTokens", "daily"}:
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
    return snapshot


def validate_update(previous, current):
    validate_snapshot(previous)
    validate_snapshot(current)
    if timestamp(current["generatedAt"]) < timestamp(previous["generatedAt"]):
        raise ValueError("Refusing an older snapshot.")
    if previous["daily"] and (not current["daily"] or current["daily"][-1]["date"] < previous["daily"][-1]["date"]):
        raise ValueError("Refusing missing or older daily coverage.")
    # The service may correct counts; do not invent a monotonic lifetime total.
    return current


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
