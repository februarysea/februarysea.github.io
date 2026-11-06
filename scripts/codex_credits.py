"""Incremental, public-safe Codex credit samples from the desktop analytics API.

The samples belong only to the primary account after the archived two-account
period. They calibrate estimates; they never replace Profile's token totals.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import json
import urllib.error
import urllib.parse
import urllib.request

from codex_dashboard import NoRedirect, DashboardUnavailable, iso_date
from codex_usage import token_count, timestamp


ENDPOINT = "https://chatgpt.com/backend-api/wham/analytics/daily-workspace-usage-counts"
# Explicit allowlist. Work and unrecognized future surfaces are never silently
# included in a Codex sample. Official client values, verified 2026-11-05.
CODEX_SURFACES = frozenset({"CODEX_CLI", "CODEX_DESKTOP_APP", "CODEX_IDE_VSCODE",
    "CODEX_WEB", "CODEX_GITHUB", "CODEX_SERVICE_EXEC"})
COUNT_FIELDS = ("uncachedInputTokens", "cachedInputTokens", "outputTokens", "totalTokens")
RECHECK_DAYS = 7


def credits(value):
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise ValueError("Invalid credit count.")
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        raise ValueError("Invalid credit count.") from None
    if not number.is_finite() or not 0 <= number <= Decimal("1e12"):
        raise ValueError("Invalid credit count.")
    return number


def validate(value):
    keys = {"version", "source", "scope", "generatedAt", "startDate", "throughDate", "daily"}
    if (not isinstance(value, dict) or set(value) != keys or type(value["version"]) is not int
            or value["version"] != 1 or value["source"] != "codex-analytics-credits"
            or value["scope"] != "primary-codex-surfaces"):
        raise ValueError("Unexpected credit snapshot fields.")
    timestamp(value["generatedAt"])
    start, through = iso_date(value["startDate"]), iso_date(value["throughDate"])
    if start > through or not isinstance(value["daily"], list) or not value["daily"]:
        raise ValueError("Invalid credit coverage.")
    last = ""
    for row in value["daily"]:
        if not isinstance(row, dict) or set(row) != {"date", "credits", *COUNT_FIELDS}:
            raise ValueError("Unexpected credit row fields.")
        day = iso_date(row["date"])
        if not start <= day <= through or day <= last:
            raise ValueError("Invalid or repeated credit date.")
        last = day
        for field in COUNT_FIELDS:
            token_count(row[field])
        if row["uncachedInputTokens"] + row["cachedInputTokens"] + row["outputTokens"] != row["totalTokens"]:
            raise ValueError("Credit token categories do not reconcile.")
        if not isinstance(row["credits"], str):
            raise ValueError("Credits must use a public decimal string.")
        amount = credits(row["credits"])
        if not row["totalTokens"] and amount:
            raise ValueError("Cannot price credits with no token basis.")
    if last != through:
        raise ValueError("Credit coverage must end at an observed row.")
    return value


def normalize(payload, start, end):
    if iso_date(start) > iso_date(end):
        raise ValueError("Invalid credit date range.")
    if (not isinstance(payload, dict) or payload.get("balance_unit") != "credit"
            or payload.get("group_by") != "day" or not isinstance(payload.get("data"), list)):
        raise ValueError("Expected absolute daily credit data, not percentages.")
    rows, seen = [], set()
    raw_fields = dict(zip(COUNT_FIELDS, ("uncached_text_input_tokens", "cached_text_input_tokens",
                                       "text_output_tokens", "text_total_tokens")))
    for source in payload["data"]:
        day = iso_date(source["date"])
        # The verified endpoint uses inclusive dates. Filter explicitly so an
        # unexpected extra day cannot enter a neighboring chunk twice.
        if day < start or day > end:
            continue
        if day in seen:
            raise ValueError("Duplicate analytics day.")
        seen.add(day)
        if not isinstance(source.get("clients"), list) or not isinstance(source.get("totals"), dict):
            raise ValueError("Missing analytics surface breakdown.")
        row = {"date": day, **{field: 0 for field in COUNT_FIELDS}}
        amount = Decimal(0)
        found = False
        surfaces = set()
        for client in source["clients"]:
            if client.get("client_id") not in CODEX_SURFACES:
                continue
            if client["client_id"] in surfaces:
                raise ValueError("Duplicate analytics surface.")
            surfaces.add(client["client_id"])
            found = True
            counts = {dest: token_count(client.get(raw)) for dest, raw in raw_fields.items()}
            if sum(counts[field] for field in COUNT_FIELDS[:3]) != counts["totalTokens"]:
                raise ValueError("Analytics token categories do not reconcile.")
            for field in COUNT_FIELDS:
                row[field] = token_count(row[field] + counts[field])
            amount += credits(client.get("credits"))
        if not found:
            continue  # No qualifying surface does not prove zero Codex use.
        if row["totalTokens"] > token_count(source["totals"].get("text_total_tokens")):
            raise ValueError("Surface tokens exceed daily tokens.")
        if amount > credits(source["totals"].get("credits")) + Decimal("0.000001"):
            raise ValueError("Surface credits exceed daily credits.")
        row["credits"] = format(amount, "f")
        rows.append(row)
    return sorted(rows, key=lambda row: row["date"])


def request(raw_auth, start, end, *, opener=None):
    if iso_date(start) > iso_date(end):
        raise ValueError("Invalid credit date range.")
    auth = json.loads(raw_auth)
    tokens = auth.get("tokens") or {}
    if auth.get("auth_mode") != "chatgpt" or any(not isinstance(tokens.get(k), str) or not tokens[k]
                                                for k in ("access_token", "account_id")):
        raise ValueError("A managed OAuth login is required.")
    query = urllib.parse.urlencode({"start_date": start, "end_date": end,
        "group_by": "day", "workspace_user": "true"})
    req = urllib.request.Request(ENDPOINT + "?" + query, headers={
        "Authorization": "Bearer " + tokens["access_token"],
        "ChatGPT-Account-Id": tokens["account_id"], "Accept": "application/json"})
    client = opener or urllib.request.build_opener(NoRedirect)
    try:
        with client.open(req, timeout=45) as response:
            body = response.read(8 * 1024 * 1024 + 1)
        if len(body) > 8 * 1024 * 1024:
            raise DashboardUnavailable("Credit response is too large.")
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
        raise DashboardUnavailable(f"Credit request returned HTTP {status}.") from None
    except (urllib.error.URLError, TimeoutError):
        raise DashboardUnavailable("Credit connection failed.") from None
    return json.loads(body)


def collect(raw_auth, start, previous=None, *, now=None, fetch=request):
    iso_date(start)
    if previous is not None:
        validate(previous)
        if previous["startDate"] != start:
            raise ValueError("Credit history cannot change account-period boundaries.")
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("Credit capture requires an aware timestamp.")
    end = now.astimezone(timezone.utc).date().isoformat()
    if start > end:
        raise ValueError("Credit start date is in the future.")
    if previous and timestamp(previous["generatedAt"]) > now:
        raise ValueError("Refusing older credit data.")
    # Re-read seven saved days to accept reporting delays, replacing rather than
    # adding repeated dates. Old history survives backend retention changes.
    first = max(start, (date.fromisoformat(previous["throughDate"]) - timedelta(days=RECHECK_DAYS - 1)).isoformat()) if previous else start
    saved = {row["date"]: row for row in previous["daily"]} if previous else {}
    current = date.fromisoformat(first)
    observed = []
    while current.isoformat() <= end:
        last = min(current + timedelta(days=30), date.fromisoformat(end)).isoformat()
        rows = normalize(fetch(raw_auth, current.isoformat(), last), current.isoformat(), last)
        observed.extend(rows)
        current = date.fromisoformat(last) + timedelta(days=1)
    if not observed:
        raise DashboardUnavailable("No usable credit records; preserving previous data.")
    if previous and max(row["date"] for row in observed) < previous["throughDate"]:
        raise DashboardUnavailable("Credit coverage regressed; preserving previous data.")
    saved.update({row["date"]: row for row in observed})
    return validate({"version": 1, "source": "codex-analytics-credits", "scope": "primary-codex-surfaces",
        "generatedAt": now.isoformat(), "startDate": start, "throughDate": max(saved),
        "daily": [saved[key] for key in sorted(saved)]})
