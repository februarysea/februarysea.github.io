import base64
import copy
from datetime import datetime, timezone
import io
import json
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlparse

import codex_credits as credits
from codex_usage import extend_archive, validate_snapshot, validate_update
import collect_codex_usage as collector
import persist_codex_usage as publisher
from test_codex_collector import auth, usage


def client(surface="CODEX_DESKTOP_APP", count=100, amount=2):
    return {"client_id": surface, "uncached_text_input_tokens": count - 40,
            "cached_text_input_tokens": 30, "text_output_tokens": 10,
            "text_total_tokens": count, "credits": amount}


def payload(*days):
    return {"balance_unit": "credit", "group_by": "day", "account_id": "private-canary",
            "data": [{"date": day, "clients": [client()], "totals": client(),
                      "models": [{"model": "unused", "credits": 0}]} for day in days]}


def snapshot(days=("2026-10-25",), *, start="2026-10-25", generated="2026-10-30T00:00:00Z"):
    return {"version": 1, "source": "codex-analytics-credits", "scope": "primary-codex-surfaces",
            "generatedAt": generated, "startDate": start, "throughDate": days[-1],
            "daily": credits.normalize(payload(*days), start, days[-1])}


def profile(day="2026-10-24", tokens=100, generated="2026-10-30T00:00:00Z"):
    return {"version": 1, "source": "codex-profile-service", "generatedAt": generated,
            "totalTokens": tokens, "daily": [{"date": day, "totalTokens": tokens}]}


def response(value):
    return {"sha": "file-sha", "encoding": "base64", "content": base64.b64encode(json.dumps(value).encode()).decode()}


class CreditTests(unittest.TestCase):
    def test_selects_known_codex_surfaces_and_drops_identity_models_work_and_unknowns(self):
        raw = payload("2026-10-25")
        raw["data"][0]["clients"] += [client("CODEX_WORK_DESKTOP"),
                                     {"client_id": "CODEX_UNKNOWN_DEFAULT", "credits": 0}]
        raw["data"][0]["totals"] = client(count=200, amount=4)
        result = credits.normalize(raw, "2026-10-25", "2026-10-25")
        self.assertEqual(result[0]["totalTokens"], 100)
        self.assertEqual(result[0]["credits"], "2")
        self.assertNotIn("private-canary", json.dumps(result))
        self.assertNotIn("model", json.dumps(result))

    def test_percentage_units_duplicate_days_and_incomplete_counts_are_rejected(self):
        examples = []
        bad = payload("2026-10-25"); bad["balance_unit"] = "percent"; examples.append(bad)
        examples.append(payload("2026-10-25", "2026-10-25"))
        bad = payload("2026-10-25"); bad["data"][0]["clients"].append(client()); examples.append(bad)
        bad = payload("2026-10-25"); del bad["data"][0]["clients"][0]["text_total_tokens"]; examples.append(bad)
        bad = payload("2026-10-25"); bad["data"][0]["clients"][0]["text_output_tokens"] = 99; examples.append(bad)
        for value in examples:
            with self.subTest(value=value), self.assertRaises(ValueError):
                credits.normalize(value, "2026-10-25", "2026-10-25")

    def test_public_snapshot_validation_rejects_sensitive_fields_nonfinite_and_bad_dates(self):
        for key, value in (("access_token", "private-canary"), ("scope", "secondary")):
            bad = snapshot(); bad[key] = value
            with self.assertRaises(ValueError): credits.validate(bad)
        for amount in ("NaN", "Infinity", "-1", True, 2):
            bad = snapshot(); bad["daily"][0]["credits"] = amount
            with self.assertRaises(ValueError): credits.validate(bad)
        bad = snapshot(); bad["daily"][0]["date"] = "2026-10-24"
        with self.assertRaises(ValueError): credits.validate(bad)

    def test_incremental_refresh_replaces_recent_dates_retains_old_rows_and_never_adds_duplicates(self):
        before = snapshot(tuple(f"2026-10-{day}" for day in range(25, 30)))
        original = copy.deepcopy(before)
        update = payload("2026-10-28", "2026-10-29", "2026-10-30")
        update["data"][0]["clients"][0]["credits"] = 1
        fetch = Mock(return_value=update)
        result = credits.collect("unused", "2026-10-25", before,
                                 now=datetime(2026, 10, 31, tzinfo=timezone.utc), fetch=fetch)
        self.assertEqual(fetch.call_args.args[1:], ("2026-10-25", "2026-10-31"))
        self.assertEqual(len(result["daily"]), 6)
        self.assertEqual(result["daily"][3]["credits"], "1")
        self.assertEqual(result["daily"][:3], before["daily"][:3])
        self.assertEqual(before, original)

    def test_failed_or_regressed_refresh_does_not_modify_the_previous_snapshot(self):
        before = snapshot(("2026-10-25", "2026-10-29"))
        original = copy.deepcopy(before)
        for fetch in (Mock(side_effect=credits.DashboardUnavailable("private-canary")),
                      Mock(return_value=payload()), Mock(return_value=payload("2026-10-27"))):
            with self.assertRaises(credits.DashboardUnavailable):
                credits.collect("unused", "2026-10-25", before,
                                now=datetime(2026, 10, 31, tzinfo=timezone.utc), fetch=fetch)
            self.assertEqual(before, original)

    def test_request_uses_fixed_origin_inclusive_dates_and_authorization_only_in_headers(self):
        opener = Mock()
        opener.open.return_value = io.BytesIO(json.dumps(payload("2026-10-25")).encode())
        credits.request(auth(), "2026-10-25", "2026-10-25", opener=opener)
        request = opener.open.call_args.args[0]
        self.assertEqual(urlparse(request.full_url).netloc, "chatgpt.com")
        self.assertEqual(parse_qs(urlparse(request.full_url).query)["end_date"], ["2026-10-25"])
        self.assertNotIn("original-access", request.full_url)
        self.assertEqual(request.get_header("Authorization"), "Bearer original-access")
        self.assertIsNone(credits.NoRedirect().redirect_request(None, None, None, None, None, None))

    def test_single_primary_credit_samples_survive_aggregation_and_archive_extension(self):
        archive = profile()
        primary = profile("2026-10-25", 50)
        primary["creditUsage"] = snapshot()
        combined = collector.combine_snapshots([primary])
        result = extend_archive(archive, combined, archive)
        self.assertEqual(result["totalTokens"], 150)
        self.assertEqual(result["creditUsage"], primary["creditUsage"])
        without_credits = profile("2026-10-26", 60, "2026-10-31T00:00:00Z")
        kept = extend_archive(archive, without_credits, result)
        self.assertEqual(kept["creditUsage"], result["creditUsage"])
        self.assertEqual(kept["totalTokens"], 210)
        self.assertEqual(kept["daily"][0], archive["daily"][0])
        with self.assertRaises(ValueError): collector.combine_snapshots([primary, primary])
        with self.assertRaises(ValueError): validate_update(result, {k: v for k, v in result.items() if k != "creditUsage"})
        bad = copy.deepcopy(result); bad["creditUsage"]["startDate"] = "2026-10-24"
        with self.assertRaises(ValueError): validate_snapshot(bad)

    def test_archive_entrypoint_connects_the_optional_reader_only_to_primary(self):
        archive = profile()
        env = {"CODEX_AUTH_JSON": auth(), "CODEX_ACCOUNT_ID": "selected-account", "GH_TOKEN": "synthetic",
               "CODEX_ACCOUNT_COUNT": "2", "CODEX_SECONDARY_AUTH_JSON": "must-not-read"}
        def collect_primary(raw, account, persist, *, credit_reader):
            self.assertEqual(account, "selected-account")
            return {**profile("2026-10-25", 50), "creditUsage": credit_reader(raw)}
        with patch.object(collector, "collect", side_effect=collect_primary) as live, \
             patch.object(credits, "collect", return_value=snapshot()) as read:
            result = collector.collect_after_archive(env, archive, archive)
        self.assertEqual(live.call_count, 1)
        self.assertEqual(read.call_args.args[1:], ("2026-10-25", None))
        self.assertEqual(result["totalTokens"], 150)
        self.assertEqual(result["creditUsage"], snapshot())

    def test_optional_credit_errors_do_not_block_profile_or_credential_persistence(self):
        saved, read = [], []
        class RPC:
            def __init__(self, binary, home): self.home = home
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def call(self, method, params=None):
                (self.home / "auth.json").write_text(auth("latest"))
                return {"account": {"type": "chatgpt"}} if method == "account/read" else usage()
        def reader(raw):
            read.append(raw)
            raise ValueError("private-canary")
        output = io.StringIO()
        with patch("sys.stdout", output):
            result = collector.collect(auth(), "selected-account", saved.append, rpc_factory=RPC, credit_reader=reader)
        self.assertEqual(result["totalTokens"], 90)
        self.assertNotIn("creditUsage", result)
        self.assertEqual(read, [auth("latest")])
        self.assertEqual(saved[-1], auth("latest"))
        self.assertNotIn("private-canary", output.getvalue())

    def test_changed_credit_values_are_persisted_even_when_profile_tokens_are_unchanged(self):
        before = profile("2026-10-25")
        current = {**before, "creditUsage": snapshot()}
        api = Mock(side_effect=[response(before), {"commit": {"sha": "commit-sha"}}])
        self.assertEqual(publisher.publish(current, "synthetic", api), "commit-sha")
        later = copy.deepcopy(current)
        later["creditUsage"]["generatedAt"] = "2026-10-31T00:00:00Z"
        rechecked = Mock(side_effect=[response(current), {"commit":{"sha":"checked-again"}}])
        self.assertEqual(publisher.publish(later, "synthetic", rechecked), "checked-again")
        self.assertEqual(rechecked.call_count, 2)


if __name__ == "__main__":
    unittest.main()
