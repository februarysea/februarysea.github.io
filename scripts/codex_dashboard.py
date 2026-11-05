"""Read aggregate model usage from the official personal dashboard using OAuth.

This endpoint is used by the desktop client, not a documented public API.
Personal accounts currently return percentages, NOT token counts or USD.
This reader neither renews nor writes credentials. In automation, use the
existing managed login renewal before invoking it with a current credential.
"""
import argparse
from datetime import date, datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request


ENDPOINT = "https://chatgpt.com/backend-api/wham/usage/daily-token-usage-breakdown"


class DashboardUnavailable(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        # Never forward the OAuth authorization header to another location.
        return None


def iso_date(value):
    if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
        raise ValueError("Invalid dashboard date.")
    return value


def normalize(payload, start, end):
    iso_date(start)
    iso_date(end)
    if start > end:
        raise ValueError("Invalid dashboard range.")
    if not isinstance(payload, dict) or payload.get("units") not in ("percent", "credits"):
        raise ValueError("Unrecognized dashboard units; refusing to infer token counts.")
    if payload.get("group_by") != "day" or not isinstance(payload.get("data"), list):
        raise ValueError("Expected daily dashboard rows.")
    daily, seen = [], set()
    for row in payload["data"]:
        day = iso_date(row["date"])
        if not start <= day <= end or day in seen:
            raise ValueError("Unexpected or repeated dashboard date.")
        seen.add(day)
        if not isinstance(row.get("models"), list):
            raise ValueError("Missing model breakdown.")
        models = {}
        for item in row["models"]:
            name, speed, value = item["model"], item["speed"], item["credits"]
            if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}", name):
                raise ValueError("Invalid model name.")
            if speed not in ("standard", "fast", "ultrafast", "unknown"):
                raise ValueError("Unrecognized speed tier.")
            if (isinstance(value, bool) or not isinstance(value, (int, float))
                    or not math.isfinite(value) or not 0 <= value <= 1e12):
                raise ValueError("Invalid usage value.")
            key = (name, speed)
            models[key] = models.get(key, 0) + value
            if models[key] > 1e12:
                raise ValueError("Usage value exceeds supported bounds.")
        daily.append({"date": day, "models": [
            {"model": name, "speed": speed, "usageValue": value}
            for (name, speed), value in sorted(models.items())
        ]})
    return {"version": 1, "source": "codex-personal-dashboard", "scope": "single-account",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "unit": payload["units"], "requestedStartDate": start, "requestedEndDate": end,
            "daily": sorted(daily, key=lambda row: row["date"])}


def collect(raw_auth, start, end, *, opener=None):
    iso_date(start)
    iso_date(end)
    if start > end or (date.fromisoformat(end) - date.fromisoformat(start)).days > 30:
        raise ValueError("Request between one and 31 days per read.")
    auth = json.loads(raw_auth)
    tokens = auth.get("tokens") or {}
    if auth.get("auth_mode") != "chatgpt" or any(
        not isinstance(tokens.get(key), str) or not tokens[key] for key in ("access_token", "account_id")
    ):
        raise ValueError("A current managed ChatGPT OAuth login is required.")
    query = urllib.parse.urlencode({"start_date": start, "end_date": end, "group_by": "day"})
    request = urllib.request.Request(ENDPOINT + "?" + query, headers={
        "Authorization": "Bearer " + tokens["access_token"],
        "ChatGPT-Account-Id": tokens["account_id"],
        "x-openai-codex-usage-categories": "1", "Accept": "application/json",
    })
    client = opener or urllib.request.build_opener(NoRedirect)
    try:
        with client.open(request, timeout=45) as response:
            body = response.read(8 * 1024 * 1024 + 1)
        if len(body) > 8 * 1024 * 1024:
            raise DashboardUnavailable("Dashboard response is too large.")
    except urllib.error.HTTPError as error:
        # Do not print upstream response bodies, request headers, or credentials.
        status = error.code
        error.close()
        raise DashboardUnavailable(f"Dashboard request returned HTTP {status}.") from None
    except (urllib.error.URLError, TimeoutError):
        raise DashboardUnavailable("Dashboard connection failed.") from None
    return normalize(json.loads(body), start, end)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--auth-file", type=Path, help="Otherwise use CODEX_AUTH_JSON from the environment.")
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        raw = args.auth_file.read_text() if args.auth_file else os.environ.get("CODEX_AUTH_JSON", "")
        result = collect(raw, args.start_date, args.end_date)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
        temporary.replace(args.output)
    except DashboardUnavailable as error:
        parser.exit(1, str(error) + " Snapshot preserved.\n")
    except (OSError, ValueError, TypeError, KeyError):
        parser.exit(1, "Invalid or unavailable dashboard data; snapshot preserved.\n")
    print(f"Saved {len(result['daily'])} aggregate daily rows; unit={result['unit']}. No token or dollar counts inferred.")


if __name__ == "__main__":
    main()
