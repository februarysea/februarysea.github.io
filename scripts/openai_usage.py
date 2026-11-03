"""Collect public model totals from the OpenAI organization Usage API.

Only completed UTC days from the completions usage endpoint are included.
Cached input is a subset of input, never an additional contribution to totals.
"""
import argparse
from datetime import date, datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from codex_github import NoRedirects
from codex_usage import timestamp, token_count

SOURCE = "openai-organization-completions"
ENDPOINT = "https://api.openai.com/v1/organization/usage/completions"
COUNTS = ("inputTokens", "cachedInputTokens", "outputTokens", "requests")
FIELDS = {"version", "source", "generatedAt", "startDate", "throughDate", "daily"}
MODEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,199}\Z")


def day(value):
    if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
        raise ValueError("Invalid usage date.")
    return date.fromisoformat(value)


def validate_snapshot(snapshot):
    if not isinstance(snapshot, dict) or set(snapshot) != FIELDS:
        raise ValueError("Unexpected public API usage fields.")
    if type(snapshot["version"]) is not int or snapshot["version"] != 1 or snapshot["source"] != SOURCE:
        raise ValueError("Invalid API usage source or version.")
    if not isinstance(snapshot["daily"], list):
        raise ValueError("Invalid API daily data.")
    if snapshot["generatedAt"] is None:
        if snapshot["startDate"] is not None or snapshot["throughDate"] is not None or snapshot["daily"]:
            raise ValueError("Unconnected API data must be empty.")
        return snapshot
    generated = timestamp(snapshot["generatedAt"]).astimezone(timezone.utc)
    start, through = day(snapshot["startDate"]), day(snapshot["throughDate"])
    if not start <= through < generated.date():
        raise ValueError("Expected completed UTC usage days.")
    expected = start
    total = 0
    for row in snapshot["daily"]:
        if not isinstance(row, dict) or set(row) != {"date", "models"} or day(row["date"]) != expected:
            raise ValueError("API coverage must be continuous and sorted.")
        if not isinstance(row["models"], list):
            raise ValueError("Invalid API model data.")
        last_model = ""
        for model in row["models"]:
            if not isinstance(model, dict) or set(model) != {"model", *COUNTS}:
                raise ValueError("Unexpected public model fields.")
            name = model["model"]
            if not isinstance(name, str) or not MODEL.fullmatch(name) or name <= last_model:
                raise ValueError("API models must be valid, unique and sorted.")
            last_model = name
            for key in COUNTS:
                token_count(model[key])
            if model["cachedInputTokens"] > model["inputTokens"]:
                raise ValueError("Cached tokens exceed input tokens.")
            total = token_count(total + model["inputTokens"] + model["outputTokens"])
        expected += timedelta(days=1)
    if expected != through + timedelta(days=1):
        raise ValueError("Missing API usage coverage.")
    return snapshot


def validate_update(previous, current):
    validate_snapshot(previous)
    validate_snapshot(current)
    if previous["generatedAt"] is not None:
        if (current["generatedAt"] is None or
                timestamp(current["generatedAt"]) < timestamp(previous["generatedAt"]) or
                current["startDate"] != previous["startDate"] or
                current["throughDate"] < previous["throughDate"]):
            raise ValueError("Refusing to replace API history with older or different coverage.")
    return current


def request(params, key):
    # Fixed destination, no redirects, and no upstream body in diagnostic output.
    req = urllib.request.Request(ENDPOINT + "?" + urllib.parse.urlencode(params, doseq=True),
                                 headers={"Authorization": "Bearer " + key, "Accept": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.build_opener(NoRedirects()).open(req, timeout=30) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
                if len(raw) > 8 * 1024 * 1024:
                    raise ValueError("API usage response is too large.")
                return json.loads(raw)
        except urllib.error.HTTPError as error:
            if error.code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(2 ** (attempt + 1))
                continue
            raise RuntimeError(f"OpenAI usage query returned HTTP {error.code}.") from None
        except (urllib.error.URLError, TimeoutError):
            if attempt < 2:
                time.sleep(2 ** (attempt + 1))
                continue
            raise RuntimeError("OpenAI usage connection failed.") from None


def collect(previous, start_date, key, *, now=None, api=request, full=False):
    validate_snapshot(previous)
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    start = day(start_date)
    end = now.date()  # Never label a partial day as complete.
    if start >= end:
        raise ValueError("API history must start before today UTC.")
    if previous["startDate"] is not None and previous["startDate"] != start_date:
        raise ValueError("Changing API coverage requires an explicit history migration.")
    if not isinstance(key, str) or not key.strip():
        raise ValueError("OpenAI usage Admin API Key is missing.")
    refresh = start
    if previous["throughDate"] and not full:
        # Re-read the most recent 31 saved days for delayed usage and corrections.
        refresh = max(start, day(previous["throughDate"]) - timedelta(days=30))
    begin_ts = int(datetime.combine(refresh, datetime.min.time(), timezone.utc).timestamp())
    end_ts = int(datetime.combine(end, datetime.min.time(), timezone.utc).timestamp())
    params = {"start_time": begin_ts, "end_time": end_ts, "bucket_width": "1d",
              "group_by": ["model"], "limit": 31}
    records, cursors = {}, set()
    for _ in range(500):
        page = api(params.copy(), key)
        if (not isinstance(page, dict) or page.get("object") != "page" or
                not isinstance(page.get("data"), list) or type(page.get("has_more")) is not bool):
            raise ValueError("Invalid API usage page.")
        for bucket in page["data"]:
            if not isinstance(bucket, dict) or bucket.get("object") != "bucket":
                raise ValueError("Invalid API usage bucket.")
            first, last = bucket.get("start_time"), bucket.get("end_time")
            if (type(first) is not int or type(last) is not int or first % 86400 or
                    last != first + 86400 or not begin_ts <= first < last <= end_ts):
                raise ValueError("Unexpected API bucket boundaries.")
            date_key = datetime.fromtimestamp(first, timezone.utc).date().isoformat()
            if date_key in records or not isinstance(bucket.get("results"), list):
                raise ValueError("Duplicate or invalid API bucket.")
            models = {}
            for row in bucket["results"]:
                if not isinstance(row, dict) or row.get("object") != "organization.usage.completions.result":
                    raise ValueError("Unexpected API usage category.")
                name = row.get("model")
                if name is None:
                    name = "unclassified"
                if not isinstance(name, str) or not MODEL.fullmatch(name):
                    raise ValueError("Invalid API model name.")
                counts = {"inputTokens": token_count(row.get("input_tokens")),
                          "cachedInputTokens": token_count(row.get("input_cached_tokens", 0)),
                          "outputTokens": token_count(row.get("output_tokens")),
                          "requests": token_count(row.get("num_model_requests"))}
                if counts["cachedInputTokens"] > counts["inputTokens"]:
                    raise ValueError("Cached tokens exceed input tokens.")
                target = models.setdefault(name, {"model": name, **dict.fromkeys(COUNTS, 0)})
                for field in COUNTS:
                    target[field] = token_count(target[field] + counts[field])
            records[date_key] = {"date": date_key, "models": [models[m] for m in sorted(models)]}
        if not page["has_more"]:
            break
        cursor = page.get("next_page")
        if not isinstance(cursor, str) or not cursor or len(cursor) > 4096 or cursor in cursors:
            raise ValueError("Invalid API pagination cursor.")
        cursors.add(cursor)
        params["page"] = cursor
    else:
        raise ValueError("API pagination limit reached.")
    # Missing buckets are unknown, not zeros. An explicit empty results bucket is zero.
    if len(records) != (end - refresh).days:
        raise ValueError("API usage coverage is incomplete; previous data retained.")
    snapshot = {"version": 1, "source": SOURCE, "generatedAt": now.isoformat(),
                "startDate": start_date, "throughDate": (end - timedelta(days=1)).isoformat(),
                "daily": [r for r in previous["daily"] if r["date"] < refresh.isoformat()] +
                         [records[d] for d in sorted(records)]}
    return validate_update(previous, snapshot)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["collect", "validate"])
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--previous", type=Path)
    parser.add_argument("--start-date", default=os.environ.get("OPENAI_USAGE_START_DATE"))
    parser.add_argument("--full", action="store_true", help="Re-query the complete configured date range")
    args = parser.parse_args()
    try:
        if args.action == "validate":
            snapshot = validate_snapshot(json.loads(args.snapshot.read_text()))
            if args.previous:
                validate_update(json.loads(args.previous.read_text()), snapshot)
        else:
            if not args.previous:
                raise ValueError("A previous API snapshot is required.")
            previous = json.loads(args.previous.read_text())
            snapshot = collect(previous, args.start_date, os.environ.get("OPENAI_USAGE_ADMIN_KEY"), full=args.full)
            args.snapshot.parent.mkdir(parents=True, exist_ok=True)
            staged = args.snapshot.with_suffix(".tmp")
            staged.write_text(json.dumps(snapshot, indent=2, allow_nan=False) + "\n")
            staged.replace(args.snapshot)
    except (OSError, ValueError, TypeError, KeyError, RuntimeError):
        parser.exit(1, "API usage unavailable; previous data retained. Check the Admin Key, start date, and API access. Other modules can still deploy.\n")
    print(f"Validated {len(snapshot['daily'])} public API usage days.")


if __name__ == "__main__":
    main()
