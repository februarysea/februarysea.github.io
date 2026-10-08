#!/usr/bin/env python3
"""Incrementally synchronize One into an allowlisted, persistent public ledger.

The observed list API has no update cursor. Scan lightweight weekly list windows;
fetch details for new/changed sessions, recent sessions, and sessions due for an
audit. The persistent ledger contains hashes and public training fields only.
"""
import argparse
import copy
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

import enode
from enode_export import ExportError, identifier, load_catalog, number
from enode_public import build_public

DAY = 86400000
ZONE = ZoneInfo("Asia/Shanghai")
HASH = re.compile(r"^[0-9a-f]{64}$")
SET_ID = re.compile(r"^set-[0-9a-f]{20}$")


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def fingerprint(value):
    return digest(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False))


def summary_fingerprint(summary):
    # Do not trust created as an update timestamp. Hash all the observed training
    # summary fields; user/profile fields neither identify changes nor get stored.
    value = {key: summary.get(key) for key in ("created", "exercise", "measurements", "order", "suborder", "assignedTags")}
    for key in ("measurements", "assignedTags"):
        if isinstance(value[key], list):
            value[key] = sorted(value[key], key=lambda item: json.dumps(item, sort_keys=True))
    return fingerprint(value)


def utc(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).isoformat()


def local_date(ms):
    return dt.datetime.fromtimestamp(ms / 1000, ZONE).date().isoformat()


def date_start(date):
    return int(dt.datetime.combine(dt.date.fromisoformat(date), dt.time(), ZONE).timestamp() * 1000)


def check(condition, message):
    if not condition:
        raise ExportError(message)


def validate_sets(sets):
    check(isinstance(sets, list), "Invalid public sets.")
    seen = set()
    for item in sets:
        check(isinstance(item, dict) and set(item) == {"id", "exercise", "weightKg", "repCount", "work", "reps"}, "Unexpected public set fields.")
        check(isinstance(item["id"], str) and SET_ID.fullmatch(item["id"]) and item["id"] not in seen, "Invalid or duplicate public set ID.")
        seen.add(item["id"])
        check(isinstance(item["exercise"], str) and 0 < len(item["exercise"].strip()) <= 300, "Invalid exercise name.")
        check(item["weightKg"] is None or number(item["weightKg"]) and item["weightKg"] >= 0, "Invalid public load.")
        check(type(item["repCount"]) is int and item["repCount"] >= 0, "Invalid repetition count.")
        check(item["work"] is None or type(item["work"]) is bool, "Invalid set classification.")
        check(isinstance(item["reps"], list), "Invalid public repetitions.")
        for rep in item["reps"]:
            check(isinstance(rep, dict) and set(rep) <= {"meanVelocityMps"}, "Unexpected repetition fields.")
            check(not rep or number(rep["meanVelocityMps"]) and rep["meanVelocityMps"] >= 0, "Invalid public velocity.")


def validate_state(state):
    check(isinstance(state, dict) and set(state) == {"schemaVersion", "accountHash", "catalogHash", "fromMs", "checkedThroughMs", "sessions"}, "Unexpected sync-state fields.")
    check(state["schemaVersion"] == 1, "Unsupported sync-state version.")
    check(all(isinstance(state[k], str) and HASH.fullmatch(state[k]) for k in ("accountHash", "catalogHash")), "Invalid state fingerprint.")
    check(number(state["fromMs"]) and number(state["checkedThroughMs"]) and 0 <= state["fromMs"] < state["checkedThroughMs"], "Invalid state coverage.")
    check(isinstance(state["sessions"], dict), "Invalid persistent sessions.")
    all_sets = []
    for key, entry in state["sessions"].items():
        check(isinstance(key, str) and HASH.fullmatch(key), "Invalid persistent session key.")
        check(isinstance(entry, dict) and set(entry) == {"date", "position", "summaryHash", "verifiedAtMs", "missingSinceMs", "sets"}, "Unexpected persistent session fields.")
        check(type(entry["position"]) is int and entry["position"] >= 0, "Invalid session order.")
        check(isinstance(entry["date"], str) and dt.date.fromisoformat(entry["date"]).isoformat() == entry["date"], "Invalid training date.")
        check(local_date(state["fromMs"]) <= entry["date"] <= local_date(state["checkedThroughMs"]), "Training date outside state coverage.")
        check(isinstance(entry["summaryHash"], str) and HASH.fullmatch(entry["summaryHash"]), "Invalid summary fingerprint.")
        check(number(entry["verifiedAtMs"]) and 0 <= entry["verifiedAtMs"] <= state["checkedThroughMs"], "Invalid verification timestamp.")
        missing = entry["missingSinceMs"]
        check(missing is None or number(missing) and 0 <= missing <= state["checkedThroughMs"], "Invalid deletion checkpoint.")
        validate_sets(entry["sets"])
        all_sets.extend(entry["sets"])
    validate_sets(all_sets)
    return state


def public_from_state(state):
    validate_state(state)
    days = {}
    for key, entry in sorted(state["sessions"].items(), key=lambda pair: (pair[1]["date"], pair[1]["position"], pair[0])):
        days.setdefault(entry["date"], []).extend(entry["sets"])
    return {"schemaVersion": 1, "timezone": "Asia/Shanghai", "updatedAt": utc(state["checkedThroughMs"]),
            "coverage": {"from": dt.datetime.fromtimestamp(state["fromMs"] / 1000, ZONE).isoformat(),
                         "to": dt.datetime.fromtimestamp(state["checkedThroughMs"] / 1000, ZONE).isoformat()},
            "sessions": [{"id": "day-" + date, "date": date, "sets": sets} for date, sets in sorted(days.items()) if sets]}


def private_values():
    config = enode.client_config()
    token = enode.session_token()
    claims = enode.token_claims(token)
    return [value for value in (token, config.get("apiKey"), config.get("deviceId"), config.get("email"),
                                config.get("nativeHeaders", {}).get("device-name"), claims.get("uid"))
            if isinstance(value, str) and value]


def safe_outputs(state):
    public = public_from_state(state)
    encoded = json.dumps({"state": state, "public": public}, ensure_ascii=False).lower()
    check(not any(value.lower() in encoded for value in private_values()), "A private value was found in public output; nothing will be published.")
    return public


def atomic_json(path, data):
    check(not path.is_symlink(), "Output cannot be a symbolic link.")
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, pending = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(pending, path)
    finally:
        if os.path.exists(pending):
            os.unlink(pending)


def request(path):
    for attempt in range(3):
        try:
            return enode.request(path)
        except enode.EnodeError as error:
            if not error.retryable or attempt == 2:
                raise
            time.sleep(2 ** (attempt + 1))


def list_sessions(start, end, uid):
    summaries = {}
    cursor = start
    while cursor < end:
        until = min(end, cursor + 7 * DAY)
        result = request("/workout_sessions?" + urlencode({"from": cursor, "to": until}))
        check(isinstance(result, list), "History list schema changed.")
        for item in result:
            check(isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"] and isinstance(item.get("user"), dict), "Invalid history item identity.")
            if identifier(item["user"].get("id")) != uid:
                continue
            check(number(item.get("created")) and cursor <= item["created"] <= until and isinstance(item.get("exercise"), dict), "Invalid history item coverage or exercise.")
            key = identifier(item["id"])
            if key in summaries:
                check(summary_fingerprint(summaries[key]) == summary_fingerprint(item), "History changed during list pagination; rerun.")
            summaries[key] = item
        cursor = until
    return summaries


def read_details(summary, uid, start, end, catalog):
    sid = identifier(summary["id"])
    session = request("/workout_sessions/" + quote(summary["id"], safe=""))
    check(isinstance(session, dict) and identifier(session.get("id")) == sid and isinstance(session.get("user"), dict)
          and identifier(session["user"].get("id")) == uid and session.get("created") == summary["created"]
          and isinstance(session.get("sets"), list), "Session identity or schema mismatch.")
    session = {**session, "exercise": summary["exercise"]}
    details = {}
    for ref in session["sets"]:
        check(isinstance(ref, dict) and isinstance(ref.get("id"), str) and ref["id"] and identifier(ref.get("sessionID")) == sid, "Invalid set ownership.")
        key = identifier(ref["id"])
        check(key not in details, "Duplicate set reference.")
        detail = request("/workout_sets/" + quote(ref["id"], safe=""))
        check(isinstance(detail, dict) and identifier(detail.get("id")) == key and identifier(detail.get("sessionID")) == sid, "Set identity or schema mismatch.")
        details[key] = detail
    # Reuse the public exporter's rep relationships, counts, load and phase checks.
    snapshot = {"fetchedAt": utc(end), "fromMs": start, "toMs": end, "sessions": [session], "sets": details}
    public = build_public(snapshot, *catalog)
    sets = [item for day in public["sessions"] for item in day["sets"]]
    return sets, len(details)


def synchronize(previous, catalog_data, now_ms, *, force_audit=False, accept_deletions=False):
    validate_state(previous)
    uid = identifier(enode.token_claims(enode.session_token()).get("uid"))
    check(bool(uid) and digest(uid) == previous["accountHash"], "Session account does not match persistent data.")
    check(number(now_ms) and now_ms >= previous["checkedThroughMs"], "Sync time cannot move backwards.")
    catalog = (catalog_data["metrics"], catalog_data["translations"], catalog_data["exercises"])
    catalog_hash = fingerprint(catalog_data)
    summaries = list_sessions(previous["fromMs"], now_ms, uid)
    indexed = {digest(key): item for key, item in summaries.items()}
    state = copy.deepcopy(previous)
    state["checkedThroughMs"] = now_ms
    state["catalogHash"] = catalog_hash
    missing = set(previous["sessions"]) - set(indexed)
    if missing and not accept_deletions:
        check(len(missing) < len(previous["sessions"]) and len(missing) <= max(2, math.floor(len(previous["sessions"]) * .25)),
              "Unexpected bulk disappearance of training records; previous state retained. Review before accepting deletions.")
    report = {"indexed": len(indexed), "new": 0, "changed": 0, "rechecked": 0, "reused": 0,
              "details_fetched": 0, "sets_fetched": 0, "deleted": 0, "pending_deletions": 0}
    for key in sorted(missing):
        entry = state["sessions"][key]
        since = entry["missingSinceMs"]
        if accept_deletions or since is not None and now_ms - since >= 20 * 3600000:
            del state["sessions"][key]
            report["deleted"] += 1
        else:
            entry["missingSinceMs"] = since if since is not None else now_ms
            report["pending_deletions"] += 1
    for position, (key, summary) in enumerate(sorted(indexed.items(), key=lambda pair: (pair[1]["created"], identifier(pair[1]["id"])))):
        old = previous["sessions"].get(key)
        summary_hash = summary_fingerprint(summary)
        changed = old is not None and (summary_hash != old["summaryHash"] or catalog_hash != previous["catalogHash"])
        due = old is not None and (force_audit or now_ms - old["verifiedAtMs"] >= 7 * DAY
                                   or now_ms - summary["created"] <= 3 * DAY and now_ms - old["verifiedAtMs"] >= 6 * 3600000)
        if old is not None and not changed and not due:
            state["sessions"][key]["missingSinceMs"] = None
            state["sessions"][key]["position"] = position
            report["reused"] += 1
            continue
        sets, count = read_details(summary, uid, previous["fromMs"], now_ms, catalog)
        state["sessions"][key] = {"date": local_date(summary["created"]), "position": position, "summaryHash": summary_hash,
                                 "verifiedAtMs": now_ms, "missingSinceMs": None, "sets": sets}
        report["new" if old is None else "changed" if changed else "rechecked"] += 1
        report["details_fetched"] += 1
        report["sets_fetched"] += count
    # Verify the index again after detail reads; a concurrent app edit must not
    # advance our checkpoint using mismatched summaries and details.
    if report["details_fetched"]:
        verified = list_sessions(previous["fromMs"], now_ms, uid)
        check({key: summary_fingerprint(item) for key, item in summaries.items()} ==
              {key: summary_fingerprint(item) for key, item in verified.items()}, "Training changed during sync; previous state retained.")
    public = safe_outputs(state)
    return state, public, report


def bootstrap(snapshot, catalog_data):
    catalog = (catalog_data["metrics"], catalog_data["translations"], catalog_data["exercises"])
    build_public(snapshot, *catalog)
    uid = identifier(enode.token_claims(enode.session_token()).get("uid"))
    check(bool(uid), "No account identity in session.")
    checked = int(dt.datetime.fromisoformat(snapshot["fetchedAt"]).timestamp() * 1000)
    # Use the actual fetched upper bound for coverage and a conservative verified
    # time. Never claim the partial first day was fully fetched.
    checked = min(checked, snapshot["toMs"])
    state = {"schemaVersion": 1, "accountHash": digest(uid), "catalogHash": fingerprint(catalog_data),
             "fromMs": snapshot["fromMs"], "checkedThroughMs": checked, "sessions": {}}
    for position, session in enumerate(sorted(snapshot["sessions"], key=lambda item: (item["created"], identifier(item["id"])))):
        check(identifier((session.get("user") or {}).get("id")) == uid, "Bootstrap contains a different account.")
        subset = {**snapshot, "sessions": [session], "sets": {ref["id"]: snapshot["sets"][ref["id"]] for ref in session["sets"]}}
        sets = [item for day in build_public(subset, *catalog)["sessions"] for item in day["sets"]]
        state["sessions"][digest(identifier(session["id"]))] = {
            "date": local_date(session["created"]), "position": position, "summaryHash": summary_fingerprint(session),
            "verifiedAtMs": checked, "missingSinceMs": None, "sets": sets}
    safe_outputs(state)
    return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sync = sub.add_parser("sync")
    sync.add_argument("--state", type=Path, required=True)
    sync.add_argument("--catalog", type=Path, required=True)
    sync.add_argument("--output-dir", type=Path, required=True)
    sync.add_argument("--force-audit", action="store_true")
    sync.add_argument("--accept-deletions", action="store_true")
    seed = sub.add_parser("bootstrap")
    seed.add_argument("--snapshot", type=Path, required=True)
    seed.add_argument("--catalog", type=Path, required=True)
    seed.add_argument("--output", type=Path, required=True)
    valid = sub.add_parser("validate")
    valid.add_argument("--state", type=Path, required=True)
    valid.add_argument("--public", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "validate":
            state = validate_state(json.loads(args.state.read_text()))
            if args.public:
                check(json.loads(args.public.read_text()) == public_from_state(state), "Public output does not match persistent state.")
            print("Allowlisted sync data validated.")
            return
        load_catalog(args.catalog)  # Check portable schema before trusting it.
        catalog_data = json.loads(args.catalog.read_text())
        if args.command == "bootstrap":
            state = bootstrap(json.loads(args.snapshot.read_text()), catalog_data)
            atomic_json(args.output, state)
            print(json.dumps({"bootstrap_sessions": len(state["sessions"])}))
            return
        check(not args.output_dir.exists(), "Use a new output directory; never overwrite the last good state.")
        state, public, report = synchronize(json.loads(args.state.read_text()), catalog_data,
                                            int(time.time() * 1000), force_audit=args.force_audit,
                                            accept_deletions=args.accept_deletions)
        # Publish artifacts only after every request, relationship and disclosure
        # check succeeds. Persistent state is committed only after deployment.
        args.output_dir.mkdir(parents=True)
        atomic_json(args.output_dir / "sync-state.json", state)
        atomic_json(args.output_dir / "training.json", public)
        print(json.dumps(report))
    except (ExportError, enode.EnodeError, OSError, ValueError, KeyError, TypeError) as error:
        message = str(error) if isinstance(error, (ExportError, enode.EnodeError)) else type(error).__name__
        parser.exit(1, "Enode sync failed: " + message + "\n")


if __name__ == "__main__":
    main()
