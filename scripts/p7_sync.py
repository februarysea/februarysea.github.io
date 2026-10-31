"""Import verified P7 visits, reject weight errors, and export allowlisted statistics.

Credentials and raw API responses are never part of the persisted checkpoint.
The checkpoint retains date-level readings beyond the source's seven-day window.
"""
import argparse
import base64
from collections import defaultdict
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import statistics
import tempfile
from zoneinfo import ZoneInfo
from sync_status import report_failure

ZONE = ZoneInfo("Asia/Shanghai")
CATS = ("tangyuan", "doubao")
HASH = re.compile(r"^[a-f0-9]{64}$")
TEXT_REPORT = re.compile(r"Weight:(\d+)g,WC_time:(\d+)s,Total:(\d+),(\d+)h,(\d+)m")
PAIRING_ERRORS = frozenset((
    "P7 visit is missing its matching representation.",
    "P7 representations disagree.",
    "Conflicting duplicate P7 datapoint.",
    "Ambiguous P7 representation match.",
))


class P7DataError(ValueError):
    pass


def check(ok, message):
    if not ok:
        raise P7DataError(message)


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def date(value):
    check(isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value), "Invalid date.")
    return dt.date.fromisoformat(value)


def instant(value):
    check(isinstance(value, str), "Invalid timestamp.")
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    check(parsed.tzinfo is not None, "Timestamp needs a timezone.")
    return parsed


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")
    os.replace(temporary, path)


def load_rules(path):
    rules = json.loads(Path(path).read_text())
    expected = {"schemaVersion", "timezone", "maxProfileDeviationKg", "madMultiplier", "madFloorKg", "madMinimumSamples", "madWindowDays", "profiles"}
    check(set(rules) == expected and rules["schemaVersion"] == 1 and rules["timezone"] == "Asia/Shanghai", "Invalid P7 rules.")
    check(set(rules["profiles"]) == set(CATS), "Unexpected cat profiles.")
    for key in ("maxProfileDeviationKg", "madMultiplier", "madFloorKg", "madMinimumSamples", "madWindowDays"):
        check(number(rules[key]) and rules[key] > 0, "Invalid filter setting.")
    check(type(rules["madMinimumSamples"]) is int and type(rules["madWindowDays"]) is int, "Sample and day counts must be integers.")
    for profile in rules["profiles"].values():
        check(set(profile) == {"referenceKg"} and number(profile["referenceKg"]) and profile["referenceKg"] > 0, "Invalid reference weight.")
    centers = sorted(profile["referenceKg"] for profile in rules["profiles"].values())
    check(centers[1] - centers[0] > 2 * rules["maxProfileDeviationKg"], "Weight profiles overlap; explicit identification is required.")
    return rules


def validate_state(state):
    check(isinstance(state, dict) and set(state) == {"schemaVersion", "deviceHash", "updatedAt", "events"}, "Unexpected checkpoint fields.")
    check(state["schemaVersion"] == 1 and isinstance(state["deviceHash"], str) and HASH.fullmatch(state["deviceHash"]), "Invalid checkpoint identity.")
    through = instant(state["updatedAt"]).astimezone(ZONE).date()
    check(isinstance(state["events"], dict), "Invalid checkpoint events.")
    for key, item in state["events"].items():
        check(isinstance(key, str) and HASH.fullmatch(key), "Invalid event identifier.")
        check(isinstance(item, dict) and set(item) == {"date", "kg", "seconds", "order"}, "Unexpected event fields.")
        check(date(item["date"]) <= through, "Event is later than collection date.")
        check(number(item["kg"]) and 0 <= item["kg"] <= 100, "Invalid measured weight.")
        check(type(item["seconds"]) is int and 0 <= item["seconds"] <= 86400, "Invalid visit duration.")
        check(type(item["order"]) is int and item["order"] >= 0, "Invalid event order.")
    return state


def decode_snapshot(snapshot, device_hash):
    check(isinstance(snapshot, dict) and snapshot.get("success") is True, "P7 did not return a successful snapshot.")
    result = snapshot.get("result")
    check(isinstance(result, dict) and result.get("hasNext") is False and isinstance(result.get("dps"), list), "Incomplete P7 pagination.")
    check(result.get("total") == len(result["dps"]), "P7 row count mismatch.")
    check(number(snapshot.get("t")), "Missing P7 response timestamp.")
    fetched = dt.datetime.fromtimestamp(snapshot["t"] / 1000, dt.timezone.utc)
    pairs = defaultdict(dict)
    for row in result["dps"]:
        stamp, dp = row.get("timeStamp"), row.get("dpId")
        check(type(stamp) is int and 0 < stamp <= fetched.timestamp() + 300, "Invalid event timestamp.")
        check(dp in (107, 109) and isinstance(row.get("value"), str), "Unexpected P7 datapoint.")
        check(dp not in pairs[stamp] or pairs[stamp][dp] == row["value"], "Conflicting duplicate P7 datapoint.")
        pairs[stamp][dp] = row["value"]
    text_reports, binary_reports = {}, {}
    for stamp, pair in pairs.items():
        if 107 in pair:
            match = TEXT_REPORT.fullmatch(pair[107])
            check(match is not None, "Unknown P7 text record format.")
            grams, seconds, _, hour, minute = map(int, match.groups())
            check(0 <= hour < 24 and 0 <= minute < 60, "Invalid P7 visit time.")
            text_reports[stamp] = (seconds, grams, hour, minute)
        if 109 in pair:
            binary = base64.b64decode(pair[109], validate=True)
            check(len(binary) == 10, "Unknown P7 binary record format.")
            binary_reports[stamp] = (int.from_bytes(binary[:4], "big"), int.from_bytes(binary[4:8], "big"), binary[8], binary[9])
        if set(pair) == {107, 109}:
            check(text_reports[stamp] == binary_reports[stamp], "P7 representations disagree.")

    events, order, matched = {}, defaultdict(int), set()
    for stamp, measurement in sorted(text_reports.items()):
        # The two reports for one visit can be recorded one second apart.
        # Require equal decoded contents and a unique, one-to-one match.
        candidates = [candidate for candidate in (stamp - 1, stamp, stamp + 1)
                      if binary_reports.get(candidate) == measurement]
        check(candidates, "P7 visit is missing its matching representation.")
        check(len(candidates) == 1 and candidates[0] not in matched, "Ambiguous P7 representation match.")
        matched.add(candidates[0])
        seconds, grams, _, _ = measurement
        # DP107 remains the identity/date anchor, preserving existing archives.
        day = dt.datetime.fromtimestamp(stamp, ZONE).date().isoformat()
        key = hashlib.sha256(f"{device_hash}:{stamp}:{grams}:{seconds}".encode()).hexdigest()
        events[key] = {"date": day, "kg": grams / 1000, "seconds": seconds, "order": order[day]}
        order[day] += 1
    check(len(matched) == len(binary_reports), "P7 visit is missing its matching representation.")
    return validate_state({"schemaVersion": 1, "deviceHash": device_hash, "updatedAt": fetched.isoformat(), "events": events})


def merge_state(previous, current):
    validate_state(current)
    if previous is None:
        return current
    validate_state(previous)
    check(previous["deviceHash"] == current["deviceHash"], "P7 device identity changed.")
    check(instant(current["updatedAt"]) >= instant(previous["updatedAt"]), "Refusing an older P7 snapshot.")
    # Cloud retention expiry is not a deletion: keep all previously archived visits.
    return validate_state({**current, "events": {**previous["events"], **current["events"]}})


def classify(state, rules):
    candidates, rejected = {cat: [] for cat in CATS}, []
    for key, value in state["events"].items():
        row = {"id": key, **value}
        matches = [cat for cat in CATS if abs(value["kg"] - rules["profiles"][cat]["referenceKg"]) <= rules["maxProfileDeviationKg"]]
        if len(matches) != 1:
            rejected.append({**row, "reason": "outside_profile_range"})
        else:
            candidates[matches[0]].append(row)
    kept = {cat: [] for cat in CATS}
    for cat, rows in candidates.items():
        for row in rows:
            neighbors = [r["kg"] for r in rows if abs((date(r["date"]) - date(row["date"])).days) <= rules["madWindowDays"]]
            if len(neighbors) >= rules["madMinimumSamples"]:
                median = statistics.median(neighbors)
                mad = statistics.median(abs(kg - median) for kg in neighbors)
                tolerance = max(rules["madFloorKg"], rules["madMultiplier"] * 1.4826 * mad)
                if abs(row["kg"] - median) > tolerance:
                    rejected.append({**row, "reason": "mad_outlier", "cat": cat})
                    continue
            kept[cat].append(row)
        kept[cat].sort(key=lambda row: (row["date"], row["order"], row["id"]))
    return kept, rejected


def summarize(state, rules):
    validate_state(state)
    kept, rejected = classify(state, rules)
    end = instant(state["updatedAt"]).astimezone(ZONE).date()
    start = end - dt.timedelta(days=6)
    recent = lambda row: start <= date(row["date"]) <= end
    cats = {}
    for cat, rows in kept.items():
        days = defaultdict(list)
        for row in rows:
            days[row["date"]].append(row["kg"])
        window = [row for row in rows if recent(row)]
        latest = rows[-1] if rows else None
        cats[cat] = {
            "assignment": "weight-estimate",
            "daily": [{"date": day, "kg": round(statistics.median(values), 4), "samples": len(values)} for day, values in sorted(days.items())],
            "latestMeasurement": {"date": latest["date"], "kg": latest["kg"]} if latest else None,
            "visits7d": len(window),
            "medianDurationSeconds7d": statistics.median(row["seconds"] for row in window) if window else None,
        }
    recent_rejected = [row for row in rejected if recent(row)]
    accepted = sum(cat["visits7d"] for cat in cats.values())
    snapshot = {
        "schemaVersion": 1, "source": "P7", "updatedAt": state["updatedAt"],
        "window": {"from": start.isoformat(), "to": end.isoformat()},
        "quality": {"total": accepted + len(recent_rejected), "kept": accepted, "excluded": len(recent_rejected),
                    "outsideRange": sum(row["reason"] == "outside_profile_range" for row in recent_rejected),
                    "madOutliers": sum(row["reason"] == "mad_outlier" for row in recent_rejected)},
        "cats": cats,
    }
    return snapshot, {"updatedAt": state["updatedAt"], "rejected": rejected}


def validate_public(snapshot):
    check(isinstance(snapshot, dict) and set(snapshot) == {"schemaVersion", "source", "updatedAt", "window", "quality", "cats"}, "Unexpected public P7 fields.")
    check(snapshot["schemaVersion"] == 1 and snapshot["source"] == "P7", "Invalid public P7 source.")
    through = instant(snapshot["updatedAt"]).astimezone(ZONE).date()
    check(set(snapshot["window"]) == {"from", "to"} and date(snapshot["window"]["to"]) == through
          and date(snapshot["window"]["from"]) == through - dt.timedelta(days=6), "Invalid P7 coverage window.")
    q = snapshot["quality"]
    check(set(q) == {"total", "kept", "excluded", "outsideRange", "madOutliers"}, "Unexpected quality fields.")
    check(all(type(v) is int and v >= 0 for v in q.values()) and q["total"] == q["kept"] + q["excluded"]
          and q["excluded"] == q["outsideRange"] + q["madOutliers"], "Invalid P7 quality counts.")
    check(set(snapshot["cats"]) == set(CATS), "Unexpected public cat names.")
    for cat in snapshot["cats"].values():
        check(set(cat) == {"assignment", "daily", "latestMeasurement", "visits7d", "medianDurationSeconds7d"}
              and cat["assignment"] == "weight-estimate", "Unexpected cat statistics.")
        check(type(cat["visits7d"]) is int and cat["visits7d"] >= 0, "Invalid visit count.")
        check(isinstance(cat["daily"], list), "Invalid daily reading list.")
        seconds = cat["medianDurationSeconds7d"]
        check(seconds is None or number(seconds) and 0 <= seconds <= 86400, "Invalid duration summary.")
        check((seconds is None) == (cat["visits7d"] == 0), "Duration and visit count disagree.")
        last = None
        for row in cat["daily"]:
            check(set(row) == {"date", "kg", "samples"}, "Unexpected daily reading fields.")
            current = date(row["date"])
            check(current <= through and (last is None or current > last), "Invalid daily chronology.")
            check(number(row["kg"]) and 0 < row["kg"] < 100 and type(row["samples"]) is int and row["samples"] > 0, "Invalid daily weight.")
            last = current
        check(sum(row["samples"] for row in cat["daily"] if date(row["date"]) >= through - dt.timedelta(days=6)) == cat["visits7d"], "Daily sample and visit counts disagree.")
        latest = cat["latestMeasurement"]
        if latest is not None:
            check(set(latest) == {"date", "kg"} and date(latest["date"]) == last
                  and number(latest["kg"]) and 0 < latest["kg"] < 100, "Invalid latest measurement.")
        else:
            check(not cat["daily"], "Missing latest measurement.")
    check(sum(cat["visits7d"] for cat in snapshot["cats"].values()) == q["kept"], "Visit count mismatch.")
    return snapshot


def validate_progress(snapshot, previous):
    validate_public(snapshot)
    validate_public(previous)
    check(instant(snapshot["updatedAt"]) >= instant(previous["updatedAt"]), "Refusing an older P7 snapshot.")
    for cat in CATS:
        old_dates = {row["date"] for row in previous["cats"][cat]["daily"]}
        new_dates = {row["date"] for row in snapshot["cats"][cat]["daily"]}
        check(old_dates <= new_dates, "P7 archive lost previously published days; review before replacing it.")


def write_outputs(state, rules, folder):
    public, audit = summarize(state, rules)
    validate_public(public)
    atomic_json(folder / "sync-state.json", state)
    atomic_json(folder / "p7-summary.json", public)
    atomic_json(folder / "rejection-audit.json", audit)
    return public


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("import", "sync"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--state", type=Path)
        cmd.add_argument("--rules", type=Path, default=Path("config/p7-rules.json"))
        cmd.add_argument("--output-dir", type=Path, required=True)
        if name == "import":
            cmd.add_argument("--source", type=Path, required=True)
            cmd.add_argument("--device-config", type=Path, required=True)
    verify = sub.add_parser("validate")
    verify.add_argument("--public", type=Path, required=True)
    verify.add_argument("--state", type=Path)
    verify.add_argument("--previous", type=Path)
    verify.add_argument("--rules", type=Path, default=Path("config/p7-rules.json"))
    args = parser.parse_args()
    try:
        rules = load_rules(args.rules)
        if args.command == "validate":
            public = validate_public(json.loads(args.public.read_text()))
            if args.previous:
                validate_progress(public, json.loads(args.previous.read_text()))
            if args.state:
                expected, _ = summarize(json.loads(args.state.read_text()), rules)
                check(public == expected, "Snapshot does not match its checkpoint.")
            print("P7 public statistics validated.")
            return
        previous = json.loads(args.state.read_text()) if args.state else None
        if args.command == "import":
            device = json.loads(args.device_config.read_text())["device_id"]
            raw = json.loads(args.source.read_text())
        else:
            from p7_client import P7Client
            client = P7Client.from_environment()
            device, raw = client.device_id, client.history()
        check(isinstance(device, str) and device, "Missing P7 device identity.")
        current = decode_snapshot(raw, hashlib.sha256(device.encode()).hexdigest())
        public = write_outputs(merge_state(previous, current), rules, args.output_dir)
        print(json.dumps({"success": True, **public["quality"]}))
    except Exception as error:
        from p7_client import P7AuthExpired
        expired = isinstance(error, P7AuthExpired)
        message = report_failure("p7", reauth=expired)
        # Only these fixed parser diagnostics are safe for public Actions logs.
        # Never print arbitrary exception bodies, vendor responses or identifiers.
        if isinstance(error, P7DataError) and str(error) in PAIRING_ERRORS:
            message += "\nP7 data validation: " + str(error)
        parser.exit(2 if expired else 1, message + "\n")


if __name__ == "__main__":
    main()
