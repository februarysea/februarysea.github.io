"""Read the signed-in user's Profile usage from the official service.

OAuth credentials are read locally, never logged or written to the export.
Without --output this checks availability and prints a statistical summary.
"""

import argparse
import json
import math
import os
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

PROFILE_URL = "https://chatgpt.com/backend-api/wham/profiles/me"


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


def token_count(value):
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or value < 0 or value > 2**53 - 1
            or not math.isfinite(value) or value != int(value)):
        raise ValueError("Profile returned an invalid token count.")
    return int(value)


def iso_day(value):
    try:
        if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
            raise ValueError
    except ValueError:
        raise ValueError("Profile returned an invalid daily date.") from None
    return value


def validate_snapshot(snapshot):
    """Reject extra fields so only the intended public statistics can be published."""
    if not isinstance(snapshot, dict) or set(snapshot) != {"version", "source", "generatedAt", "totalTokens", "daily"}:
        raise ValueError("Snapshot contains unexpected or missing fields.")
    if type(snapshot["version"]) is not int or snapshot["version"] != 1 or snapshot["source"] != "codex-profile-service":
        raise ValueError("Snapshot source or version is invalid.")
    if not isinstance(snapshot["generatedAt"], str):
        raise ValueError("Snapshot timestamp must be an ISO timestamp.")
    try:
        stamp = datetime.fromisoformat(snapshot["generatedAt"].replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("Snapshot timestamp must be an ISO timestamp.") from None
    if stamp.tzinfo is None:
        raise ValueError("Snapshot timestamp must include a timezone.")
    total = token_count(snapshot["totalTokens"])
    if not isinstance(snapshot["daily"], list):
        raise ValueError("Snapshot daily statistics must be a list.")
    previous_day = ""
    daily_total = 0
    for day in snapshot["daily"]:
        if not isinstance(day, dict) or set(day) != {"date", "totalTokens"}:
            raise ValueError("Snapshot daily statistics contain unexpected fields.")
        current_day = iso_day(day["date"])
        if current_day <= previous_day:
            raise ValueError("Snapshot daily dates must be unique and sorted.")
        previous_day = current_day
        daily_total += token_count(day["totalTokens"])
    if daily_total > total:
        raise ValueError("Daily usage exceeds the service lifetime total.")
    return snapshot


def normalize_profile(payload):
    if not isinstance(payload, dict):
        raise ValueError("Profile response must be an object.")
    stats = payload.get("stats")
    metadata = payload.get("metadata") or {}
    if not isinstance(stats, dict) or not isinstance(metadata, dict):
        raise ValueError("Profile returned invalid statistics metadata.")
    if metadata.get("stats_error"):
        raise ValueError("The Profile service reports its statistics are unavailable.")
    buckets = stats.get("daily_usage_buckets")
    total = stats.get("lifetime_tokens")
    if not isinstance(buckets, list):
        raise ValueError("Profile did not return daily usage and a valid lifetime token total.")
    total = token_count(total)
    daily = {}
    for bucket in buckets:
        if not isinstance(bucket, dict):
            raise ValueError("Profile returned an invalid daily bucket.")
        day = iso_day(bucket.get("start_date", ""))
        tokens = token_count(bucket.get("tokens"))
        daily[day] = daily.get(day, 0) + tokens
    return validate_snapshot({
        "version": 1,
        "source": "codex-profile-service",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "totalTokens": int(total),
        # Preserve the service's date buckets exactly; do not rebucket to local time.
        "daily": [{"date": day, "totalTokens": tokens} for day, tokens in sorted(daily.items())],
    })


def fetch_profile(codex_home, expected_account=None):
    authentication = json.loads((codex_home / "auth.json").read_text())
    if not isinstance(authentication, dict) or not isinstance(authentication.get("tokens"), dict):
        raise ValueError("No current ChatGPT sign-in was found in this Codex home.")
    tokens = authentication["tokens"]
    access_token = tokens.get("access_token")
    account_id = tokens.get("account_id")
    if not isinstance(access_token, str) or not access_token or not isinstance(account_id, str) or not account_id:
        raise ValueError("No current ChatGPT sign-in was found in this Codex home.")
    if expected_account and account_id != expected_account:
        raise ValueError("The signed-in account does not match the configured usage account.")
    request = urllib.request.Request(PROFILE_URL, headers={
        "Authorization": "Bearer " + access_token,
        "ChatGPT-Account-Id": account_id,
        "Accept": "application/json",
    })
    opener = urllib.request.build_opener(NoRedirects())
    with opener.open(request, timeout=30) as response:
        payload = json.loads(response.read(2 * 1024 * 1024))
    return normalize_profile(payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--codex-home", type=Path, default=Path(os.environ.get("CODEX_HOME", "~/.codex")).expanduser())
    parser.add_argument("--output", type=Path)
    parser.add_argument("--validate-snapshot", type=Path, help="Validate public JSON without reading credentials or making a request.")
    parser.add_argument("--attempts", type=int, choices=range(1, 4), default=3)
    args = parser.parse_args()
    try:
        if args.validate_snapshot:
            snapshot = validate_snapshot(json.loads(args.validate_snapshot.read_text()))
        else:
            for attempt in range(args.attempts):
                try:
                    snapshot = fetch_profile(args.codex_home, os.environ.get("CODEX_ACCOUNT_ID"))
                    break
                except urllib.error.HTTPError as error:
                    if error.code not in (429, 500, 502, 503, 504) or attempt + 1 == args.attempts:
                        raise
                    time.sleep(2 ** (attempt + 1))
                except urllib.error.URLError:
                    if attempt + 1 == args.attempts:
                        raise
                    time.sleep(2 ** (attempt + 1))
    except urllib.error.HTTPError as error:
        parser.exit(1, f"Profile service returned HTTP {error.code}. Local statistics were not changed.\n")
    except (OSError, ValueError, urllib.error.URLError) as error:
        parser.exit(1, f"Cannot read Profile usage: {error}\n")
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(snapshot, indent=2) + "\n")
        temporary.replace(args.output)
    positive = [day for day in snapshot["daily"] if day["totalTokens"] > 0]
    print(json.dumps({
        "source": snapshot["source"],
        "totalTokens": snapshot["totalTokens"],
        "dailyBuckets": len(snapshot["daily"]),
        "daysWithUsage": len(positive),
        "firstDayWithUsage": positive[0]["date"] if positive else None,
        "lastDayWithUsage": positive[-1]["date"] if positive else None,
        "exported": bool(args.output),
    }, indent=2))


if __name__ == "__main__":
    main()
