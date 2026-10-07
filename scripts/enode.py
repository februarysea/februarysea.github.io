#!/usr/bin/env python3
"""Experimental client for the existing Enode web/export endpoints.

No account registration, migration, subscription changes, or automatic OTP retries.
Credentials and source data stay in .enode-private (gitignored, mode 0700).
"""

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import getpass
import json
import math
import os
from pathlib import Path
import plistlib
import re
import sqlite3
import subprocess
import sys
import tempfile
import uuid
from urllib.parse import quote, urlencode, urlsplit, parse_qs
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / ".enode-private"
BASE = "https://api.enode.ai/api"


class EnodeError(Exception):
    pass


def private_dir():
    PRIVATE.mkdir(mode=0o700, exist_ok=True)
    PRIVATE.chmod(0o700)


def save(name, value):
    private_dir()
    fd, temporary = tempfile.mkstemp(prefix=".pending-", dir=PRIVATE)
    try:
        with os.fdopen(fd, "w") as out:
            json.dump(value, out, ensure_ascii=False, indent=2)
            out.write("\n")
        os.replace(temporary, PRIVATE / name)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def read(name):
    path = PRIVATE / name
    if not path.exists():
        raise EnodeError(f"Missing private state: {name}")
    return json.loads(path.read_text())


def b64(value):
    return base64.b64encode(value.encode()).decode()


def curl_quote(value):
    if any(c in value for c in "\r\n\0"):
        raise EnodeError("Invalid control character in request configuration")
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def token_claims(token):
    # For local expiry diagnostics only; the API validates the token itself.
    try:
        part = token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
    except (ValueError, IndexError, UnicodeError):
        return {}


def valid_timestamp(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def request(path, method="GET", body=None, basic=None, auth=True, require_json=True):
    if not path.startswith("/") or "\r" in path or "\n" in path:
        raise EnodeError("Invalid API path")
    config = read("client.json")
    headers = {
        "device-type": "web",
        "device-name": "Enode personal export client",
        "device-id": config["deviceId"],
        "x-user-agent": "enodeportalwebapp/1.0 (web)",
        "api-key": config["apiKey"],
        "timezone": "Asia/Shanghai",
        "Accept-Language": "en",
        "Accept": "application/json",
    }
    # Reuse the One app's observed client identity only when explicitly imported
    # from an authenticated request belonging to the selected account.
    if config.get("nativeHeaders"):
        headers = {**config["nativeHeaders"], "Accept": "application/json"}
    if basic:
        headers["Authorization"] = "Basic " + basic
    elif auth:
        session = read("session.json")
        claims = token_claims(session["token"])
        if claims.get("exp", float("inf")) <= dt.datetime.now().timestamp():
            raise EnodeError("Saved token has expired; sign in to One, open its history, then import-app-session again.")
        headers["Authorization"] = "Bearer " + session["token"]
    if body is not None:
        headers["Content-Type"] = "application/json"
    # Credentials are never placed in argv, logs, or printed responses.
    private_dir()
    with tempfile.TemporaryDirectory(prefix="request-", dir=PRIVATE) as temporary:
        folder = Path(temporary)
        response = folder / "response.json"
        lines = ["url = " + curl_quote(BASE + path),
                 "request = " + curl_quote(method),
                 "output = " + curl_quote(str(response)),
                 'write-out = "%{http_code}"',
                 "silent", "show-error", 'proto = "=https"']
        for key, value in headers.items():
            lines.append("header = " + curl_quote(f"{key}: {value}"))
        if body is not None:
            data = folder / "body.json"
            data.write_text(json.dumps(body))
            data.chmod(0o600)
            lines.append("data-binary = " + curl_quote("@" + str(data)))
        curl_config = folder / "curl.conf"
        curl_config.write_text("\n".join(lines) + "\n")
        curl_config.chmod(0o600)
        run = subprocess.run(["curl", "-q", "-m", "30", "--config", str(curl_config)],
                             capture_output=True, text=True)
        if run.returncode:
            raise EnodeError(f"Network request failed (curl {run.returncode}): {run.stderr.strip()}")
        status = int(run.stdout)
        text = response.read_text() if response.exists() else ""
        try:
            payload = json.loads(text) if text else None
        except ValueError:
            payload = None
        if not 200 <= status < 300:
            # Preserve the response privately, but do not echo arbitrary server text.
            save("last-error.json", {"status": status, "response": payload})
            safe = {}
            if status == 401:
                safe["nextStep"] = "Sign in to One, open its history, then import-app-session again."
            elif status in (314, 403):
                safe["nextStep"] = "Account/client permission mismatch; stop and inspect the private error."
            raise EnodeError(f"HTTP {status}: {json.dumps(safe, ensure_ascii=False)}")
        if require_json and payload is None:
            raise EnodeError(f"HTTP {status} did not return valid non-null JSON; existing data retained.")
        return payload


def shape(value):
    if isinstance(value, list):
        return {"type": "list", "count": len(value),
                "firstItemKeys": sorted(value[0]) if value and isinstance(value[0], dict) else []}
    if isinstance(value, dict):
        return {"type": "object", "fields": {k: (len(v) if isinstance(v, list) else type(v).__name__)
                                               for k, v in value.items()}}
    return {"type": type(value).__name__}


def import_app_session(cache_path, email):
    cache_path = cache_path.resolve(strict=True)
    library = cache_path.parent.parent.parent
    model = library / "Application Support/Enode/ENModel.sqlite"
    expected_email = email.strip().lower()
    with sqlite3.connect(model.as_uri() + "?mode=ro", uri=True, timeout=5) as db:
        db.execute("PRAGMA query_only=ON")
        rows = db.execute("SELECT ZID,ZEMAIL FROM ZSERVERENTITY WHERE Z_ENT=(SELECT Z_ENT FROM Z_PRIMARYKEY WHERE Z_NAME='ENUser')").fetchall()
    user_ids = {str(uuid.UUID(bytes=uid)).lower() for uid, address in rows
                if isinstance(address, str) and address.lower() == expected_email}
    if not user_ids:
        raise EnodeError("The requested account is not present in this app database.")
    with sqlite3.connect(cache_path.as_uri() + "?mode=ro", uri=True, timeout=5) as cache:
        cache.execute("PRAGMA query_only=ON")
        entries = cache.execute("SELECT r.request_key,b.request_object,b.response_object FROM cfurl_cache_response r JOIN cfurl_cache_blob_data b USING(entry_ID) ORDER BY r.time_stamp DESC").fetchall()
    allowed_headers = {"api-key", "app-version", "device-id", "device-name", "device-type",
                       "User-Agent", "Accept-Language", "timezone"}
    for url, raw_request, raw_response in entries:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.netloc != "api.enode.ai" or parsed.path != "/api/workout_sessions":
            continue
        request_data = plistlib.loads(raw_request).get("Array", [])
        response_data = plistlib.loads(raw_response).get("Array", [])
        if len(request_data) < 20 or len(response_data) < 4 or response_data[3] != 200 or request_data[18] != "GET":
            continue
        headers = request_data[19]
        auth = headers.get("Authorization", "") if isinstance(headers, dict) else ""
        if not auth.startswith("Bearer "):
            continue
        token = auth[7:]
        claims = token_claims(token)
        if str(claims.get("uid", "")).lower() not in user_ids:
            continue
        if claims.get("exp", 0) <= dt.datetime.now().timestamp():
            continue
        native_headers = {k: v for k, v in headers.items() if k in allowed_headers}
        if not all(native_headers.get(k) for k in ("api-key", "device-id", "device-type", "User-Agent")):
            continue
        query = parse_qs(parsed.query)
        if set(query) - {"from", "to"}:
            continue
        save("client.json", {"email": expected_email, "apiKey": native_headers["api-key"],
                             "deviceId": native_headers["device-id"], "nativeHeaders": native_headers,
                             "nativeProbePath": parsed.path.removeprefix("/api") + ("?" + parsed.query if parsed.query else ""),
                             "appCachePath": str(cache_path), "catalogDbPath": str(model),
                             "source": "existing One app session"})
        save("session.json", {"token": token, "savedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                              "source": "existing One app session"})
        print("Existing One session imported privately; account identity matched. No login or account changes made.")
        return
    raise EnodeError("No unexpired, account-matched One session found in successful cached history requests.")


def fetch_history(start_ms, end_ms):
    uid = token_claims(read("session.json")["token"]).get("uid")
    if not uid:
        raise EnodeError("Token does not contain the expected user ID")
    sessions = {}
    seen_ids = set()
    expected_total = None
    for page in range(1, 1001):
        query = urlencode({"from": start_ms, "to": end_ms, "page": page, "per": 200})
        result = request("/workout_sessions/search?" + query, method="POST", body={"searchItems": []})
        if not isinstance(result, dict) or not isinstance(result.get("pagedEntities"), list):
            raise EnodeError("History response schema changed; previous snapshot retained.")
        total = result.get("metaData", {}).get("total")
        if not isinstance(total, int) or isinstance(total, bool) or total < 0:
            raise EnodeError("History total missing or invalid; previous snapshot retained.")
        if expected_total is not None and total != expected_total:
            raise EnodeError("History changed during pagination; rerun to obtain a consistent snapshot.")
        expected_total = total
        batch = result["pagedEntities"]
        if not batch and len(seen_ids) < total:
            raise EnodeError("History ended before the advertised total; previous snapshot retained.")
        for item in batch:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                raise EnodeError("History item missing its ID; previous snapshot retained.")
            if item["id"] in seen_ids:
                raise EnodeError("Duplicate session across pages; previous snapshot retained.")
            seen_ids.add(item["id"])
            if not isinstance(item.get("user"), dict) or not item["user"].get("id"):
                raise EnodeError("Cannot identify session owner; previous snapshot retained.")
            if item["user"]["id"] == uid:
                sessions[item["id"]] = item
        if len(seen_ids) == total:
            break
        if len(seen_ids) > total:
            raise EnodeError("History count exceeds advertised total; previous snapshot retained.")
    else:
        raise EnodeError("Pagination safety limit reached; previous snapshot retained.")
    sets = {}
    for session in sessions.values():
        if not isinstance(session.get("sets"), list):
            raise EnodeError("Training sets missing from a session; previous snapshot retained.")
        for reference in session["sets"]:
            set_id = reference.get("id") if isinstance(reference, dict) else None
            if not isinstance(set_id, str):
                raise EnodeError("Training set ID missing; previous snapshot retained.")
            if set_id in sets:
                continue
            detail = request("/workout_sets/" + quote(set_id, safe=""))
            if not isinstance(detail, dict) or detail.get("id") != set_id or not isinstance(detail.get("reps"), list):
                raise EnodeError("Training set response schema changed; previous snapshot retained.")
            sets[set_id] = detail
    snapshot = {"fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                "fromMs": start_ms, "toMs": end_ms, "sessions": list(sessions.values()), "sets": sets}
    # A single all-or-nothing snapshot; never append partial pages or incomplete sets.
    save("training-latest.json", snapshot)
    print(json.dumps({"sessions": len(sessions), "sets": len(sets),
                      "reps": sum(len(s["reps"]) for s in sets.values()),
                      "saved": ".enode-private/training-latest.json"}))


def fetch_native_history(start_ms, end_ms):
    uid = str(token_claims(read("session.json")["token"]).get("uid", "")).lower()
    if not uid:
        raise EnodeError("No account ID in session")
    summaries = {}
    window_start = start_ms
    while window_start < end_ms:
        window_end = min(end_ms, window_start + 7 * 86400000)
        result = request("/workout_sessions?" + urlencode({"from": window_start, "to": window_end}))
        if not isinstance(result, list):
            raise EnodeError("Native history response schema changed; previous snapshot retained.")
        for item in result:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not isinstance(item.get("user"), dict):
                raise EnodeError("Invalid native history item; previous snapshot retained.")
            if str(item["user"].get("id", "")).lower() != uid:
                continue
            if not valid_timestamp(item.get("created")) or not isinstance(item.get("exercise"), dict):
                raise EnodeError("Missing native history date or exercise; previous snapshot retained.")
            summaries[item["id"]] = item
        window_start = window_end

    def get_session(summary):
        result = request("/workout_sessions/" + quote(summary["id"], safe=""))
        if (not isinstance(result, dict) or result.get("id") != summary["id"]
                or not isinstance(result.get("user"), dict)
                or str(result.get("user", {}).get("id", "")).lower() != uid
                or not isinstance(result.get("sets"), list) or not valid_timestamp(result.get("created"))):
            raise EnodeError("Native session identity or schema mismatch; previous snapshot retained.")
        return {**result, "exercise": summary["exercise"]}

    with ThreadPoolExecutor(max_workers=4) as pool:
        sessions = list(pool.map(get_session, summaries.values()))
    set_owners = {}
    for session in sessions:
        for item in session["sets"]:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str) or item.get("sessionID") != session["id"]:
                raise EnodeError("Invalid set ownership; previous snapshot retained.")
            if item["id"] in set_owners and set_owners[item["id"]] != session["id"]:
                raise EnodeError("Conflicting set ownership; previous snapshot retained.")
            set_owners[item["id"]] = session["id"]

    def get_set(pair):
        set_id, session_id = pair
        result = request("/workout_sets/" + quote(set_id, safe=""))
        if (not isinstance(result, dict) or result.get("id") != set_id
                or result.get("sessionID") != session_id or not isinstance(result.get("reps"), list)):
            raise EnodeError("Native set identity or schema mismatch; previous snapshot retained.")
        rep_ids = set()
        for rep in result["reps"]:
            if (not isinstance(rep, dict) or not isinstance(rep.get("id"), str)
                    or rep.get("setID") != set_id or not isinstance(rep.get("measurements"), list)
                    or rep["id"] in rep_ids):
                raise EnodeError("Invalid or duplicate rep; previous snapshot retained.")
            rep_ids.add(rep["id"])
        return set_id, result

    with ThreadPoolExecutor(max_workers=4) as pool:
        sets = dict(pool.map(get_set, set_owners.items()))
    sessions.sort(key=lambda s: (s["created"], s["id"]))
    days = sorted({dt.datetime.fromtimestamp(s["created"] / 1000, ZoneInfo("Asia/Shanghai")).date().isoformat() for s in sessions})
    snapshot = {"source": "Enode One native API", "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                "fromMs": start_ms, "toMs": end_ms, "timezone": "Asia/Shanghai",
                "trainingDates": days, "sessions": sessions, "sets": sets}
    save("training-latest.json", snapshot)
    print(json.dumps({"trainingDays": len(days), "exerciseSessions": len(sessions), "sets": len(sets),
                      "phaseRecords": sum(len(s["reps"]) for s in sets.values()), "trainingDates": days,
                      "saved": ".enode-private/training-latest.json"}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="command", required=True)
    init = subs.add_parser("init")
    init.add_argument("--portal-bundle", type=Path, required=True)
    app_session = subs.add_parser("import-app-session")
    app_session.add_argument("--cache", type=Path, required=True)
    app_session.add_argument("--email", required=True)
    otp = subs.add_parser("request-code")
    otp.add_argument("--email", required=True)
    verify = subs.add_parser("login")
    verify.add_argument("--code-stdin", action="store_true")
    subs.add_parser("status")
    subs.add_parser("profile")
    subs.add_parser("probe")
    subs.add_parser("sample")
    scope = subs.add_parser("scope")
    scope.add_argument("--from-ms", type=int)
    scope.add_argument("--to-ms", type=int)
    fetch = subs.add_parser("fetch")
    fetch.add_argument("--days", type=int, default=30)
    args = parser.parse_args()
    if args.command == "import-app-session":
        import_app_session(args.cache, args.email)
    elif args.command == "init":
        source = args.portal_bundle.read_text()
        match = re.search(r'configureApi\)\(\{baseUrl:.*?apiKey:"([^"\\]+)"', source)
        if not match:
            raise EnodeError("Public portal config shape changed; inspect the current bundle.")
        existing = read("client.json") if (PRIVATE / "client.json").exists() else {}
        save("client.json", {**existing, "apiKey": match[1],
                             "deviceId": existing.get("deviceId", str(uuid.uuid4()))})
        print("Public client configuration saved; no account token acquired.")
    elif args.command == "request-code":
        email = args.email.strip().lower()
        config = read("client.json")
        save("client.json", {**config, "email": email})
        result = request("/users/login/otp/" + quote(b64(email), safe=""), auth=False, require_json=False)
        save("otp-response.json", result)
        print(json.dumps({"requestAccepted": True, "responseShape": shape(result),
                          "reason": result.get("reason") if isinstance(result, dict) else None}))
    elif args.command == "login":
        code = sys.stdin.readline().strip() if args.code_stdin else getpass.getpass("Enode email code: ")
        if not code:
            raise EnodeError("No code provided")
        email = read("client.json")["email"]
        result = request("/users/login", method="POST", basic=b64(email + ":" + code), auth=False)
        if not isinstance(result, dict) or not result.get("token"):
            raise EnodeError("Login response did not include a token; no session saved.")
        save("session.json", {"token": result["token"], "savedAt": dt.datetime.now(dt.timezone.utc).isoformat()})
        print("Login succeeded. Token saved privately; use status/profile/scope next.")
    elif args.command == "status":
        claims = token_claims(read("session.json")["token"])
        expires = claims.get("exp")
        print(json.dumps({"hasUserId": bool(claims.get("uid")),
                          "expiresAtUTC": dt.datetime.fromtimestamp(expires, dt.timezone.utc).isoformat() if expires else None,
                          "expired": expires <= dt.datetime.now().timestamp() if expires else None}))
    elif args.command == "profile":
        uid = token_claims(read("session.json")["token"]).get("uid")
        if not uid:
            raise EnodeError("Token does not contain the expected user ID")
        result = request("/users/" + quote(uid, safe=""))
        if not isinstance(result, dict) or result.get("id") != uid:
            raise EnodeError("Profile response schema changed; previous profile retained.")
        save("profile.json", result)
        print(json.dumps(shape(result)))
    elif args.command == "probe":
        path = read("client.json").get("nativeProbePath")
        if not path or not path.startswith("/workout_sessions"):
            raise EnodeError("Import a verified existing app session before probing its history route.")
        result = request(path)
        if not isinstance(result, (dict, list)):
            raise EnodeError("Unexpected history response; nothing saved.")
        save("native-history-probe.json", result)
        print(json.dumps(shape(result)))
    elif args.command == "sample":
        uid = token_claims(read("session.json")["token"]).get("uid", "").lower()
        matches = [s for s in read("native-history-probe.json") if s.get("user", {}).get("id", "").lower() == uid]
        if not matches:
            raise EnodeError("Probe contains no sessions for this account.")
        item = matches[0]
        detail = request("/workout_sessions/" + quote(item["id"], safe=""))
        if not isinstance(detail, dict) or detail.get("id") != item["id"] or not isinstance(detail.get("sets"), list):
            raise EnodeError("Unexpected session detail response")
        save("sample-session.json", detail)
        print("Session:", json.dumps(shape(detail)))
        if detail["sets"]:
            set_id = detail["sets"][0]["id"]
            workout_set = request("/workout_sets/" + quote(set_id, safe=""))
            if not isinstance(workout_set, dict) or workout_set.get("id") != set_id:
                raise EnodeError("Unexpected set response")
            save("sample-set.json", workout_set)
            print("Set:", json.dumps(shape(workout_set)))
            if workout_set.get("reps"):
                print("Rep:", json.dumps(shape(workout_set["reps"][0])))
    elif args.command == "scope":
        query = {k: v for k, v in {"from": args.from_ms, "to": args.to_ms}.items() if v is not None}
        result = request("/history/scope" + ("?" + urlencode(query) if query else ""))
        if not isinstance(result, dict) or not isinstance(result.get("athletes"), list) or not isinstance(result.get("exercises"), list):
            raise EnodeError("Scope response schema changed; previous scope retained.")
        save("history-scope.json", result)
        print(json.dumps(shape(result)))
    elif args.command == "fetch":
        if args.days < 1:
            raise EnodeError("--days must be positive")
        end = int(dt.datetime.now().timestamp() * 1000)
        fetcher = fetch_native_history if read("client.json").get("nativeHeaders") else fetch_history
        fetcher(end - args.days * 86400000, end)


if __name__ == "__main__":
    try:
        main()
    except (EnodeError, KeyError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
