import importlib.util
import io
import json
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("codex_profile", Path(__file__).with_name("fetch-codex-profile.py"))
profile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile)


class ProfileUsageTests(unittest.TestCase):
    def snapshot(self):
        return profile.normalize_profile({
            "stats": {"lifetime_tokens": 90, "daily_usage_buckets": [
                {"start_date": "2026-10-13", "tokens": 40},
            ]},
        })

    def test_service_dates_and_lifetime_are_preserved(self):
        snapshot = profile.normalize_profile({
            "stats": {"lifetime_tokens": 900, "daily_usage_buckets": [
                {"start_date": "2026-10-13", "tokens": 40},
                {"start_date": "2025-12-29", "tokens": 30},
            ]},
        })
        self.assertEqual(snapshot["totalTokens"], 900)
        self.assertEqual(snapshot["daily"], [
            {"date": "2025-12-29", "totalTokens": 30},
            {"date": "2026-10-13", "totalTokens": 40},
        ])
        self.assertNotIn("inputTokens", json.dumps(snapshot))

    def test_profile_identity_and_secrets_are_excluded(self):
        snapshot = profile.normalize_profile({
            "profile": {"username": "private-user", "email": "private@example.com"},
            "access_token": "private-secret",
            "stats": {"lifetime_tokens": 10, "daily_usage_buckets": []},
        })
        for secret in ("private-user", "private@example.com", "private-secret"):
            self.assertNotIn(secret, json.dumps(snapshot))

    def test_unavailable_statistics_are_rejected(self):
        with self.assertRaises(ValueError):
            profile.normalize_profile({"metadata": {"stats_error": "unavailable"}, "stats": {}})
        with self.assertRaises(ValueError):
            profile.normalize_profile({"stats": {"lifetime_tokens": 10}})

    def test_invalid_daily_values_are_rejected(self):
        for bucket in ({"start_date": "invalid", "tokens": 20}, {"start_date": "2026-10-13", "tokens": -1}):
            with self.assertRaises(ValueError):
                profile.normalize_profile({"stats": {"lifetime_tokens": 10, "daily_usage_buckets": [bucket]}})

    def test_numeric_values_cannot_overflow_or_be_silently_rounded(self):
        for value in (True, False, "10", None, -1, 0.5, float("nan"), float("inf"), 2**53, 10**400):
            with self.subTest(value=repr(value)), self.assertRaises(ValueError):
                profile.token_count(value)
        self.assertEqual(profile.token_count(0), 0)
        self.assertEqual(profile.token_count(2**53 - 1), 2**53 - 1)

    def test_duplicate_service_buckets_are_summed_and_explicit_zero_is_preserved(self):
        snapshot = profile.normalize_profile({
            "stats": {"lifetime_tokens": 90, "daily_usage_buckets": [
                {"start_date": "2026-10-14", "tokens": 0},
                {"start_date": "2026-10-13", "tokens": 20},
                {"start_date": "2026-10-13", "tokens": 30},
            ]},
        })
        self.assertEqual(snapshot["daily"], [
            {"date": "2026-10-13", "totalTokens": 50},
            {"date": "2026-10-14", "totalTokens": 0},
        ])

    def test_malformed_service_payloads_are_rejected(self):
        for payload in (None, [], {}, {"stats": []}, {"stats": {}, "metadata": [1]}):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                profile.normalize_profile(payload)

    def test_snapshot_rejects_unexpected_fields_at_every_level(self):
        snapshot = self.snapshot()
        snapshot["account_id"] = "private-account"
        with self.assertRaises(ValueError):
            profile.validate_snapshot(snapshot)
        snapshot = self.snapshot()
        snapshot["daily"][0]["email"] = "private@example.com"
        with self.assertRaises(ValueError):
            profile.validate_snapshot(snapshot)

    def test_snapshot_rejects_invalid_timestamps(self):
        for timestamp in (None, 42, "2026-10-14", "2026-10-14T12:00:00", "invalid"):
            snapshot = self.snapshot()
            snapshot["generatedAt"] = timestamp
            with self.subTest(timestamp=timestamp), self.assertRaises(ValueError):
                profile.validate_snapshot(snapshot)

    def test_snapshot_rejects_ambiguous_or_inconsistent_daily_data(self):
        for daily in (
            [{"date": "20261013", "totalTokens": 40}],
            [{"date": "2026-10-13", "totalTokens": 100}],
            [{"date": "2026-10-13", "totalTokens": 10}] * 2,
            [{"date": "2026-10-14", "totalTokens": 0}, {"date": "2026-10-13", "totalTokens": 40}],
        ):
            snapshot = self.snapshot()
            snapshot["daily"] = daily
            with self.subTest(daily=daily), self.assertRaises(ValueError):
                profile.validate_snapshot(snapshot)

    def test_wrong_account_is_rejected_before_any_network_request(self):
        with tempfile.TemporaryDirectory() as directory:
            codex_home = Path(directory)
            (codex_home / "auth.json").write_text(json.dumps({"tokens": {
                "access_token": "test-token", "account_id": "unexpected-account",
            }}))
            with patch.object(profile.urllib.request, "build_opener") as opener:
                with self.assertRaisesRegex(ValueError, "does not match"):
                    profile.fetch_profile(codex_home, "expected-account")
                opener.assert_not_called()

    def test_redirects_cannot_forward_the_authorization_header(self):
        self.assertIsNone(profile.NoRedirects().redirect_request(
            None, None, 302, "Found", {}, "https://unrelated.example/",
        ))

    def test_failed_fetch_preserves_the_last_good_file_and_does_not_log_http_details(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "usage.json"
            original = json.dumps(self.snapshot())
            output.write_text(original)
            error = urllib.error.HTTPError(profile.PROFILE_URL, 401, "private-response", {}, None)
            stderr = io.StringIO()
            with patch("sys.argv", ["fetch", "--output", str(output)]), \
                    patch.object(profile, "fetch_profile", side_effect=error) as fetch, \
                    redirect_stderr(stderr), self.assertRaises(SystemExit) as raised:
                profile.main()
            self.assertEqual(raised.exception.code, 1)
            self.assertEqual(fetch.call_count, 1)
            self.assertEqual(output.read_text(), original)
            self.assertFalse(output.with_suffix(".json.tmp").exists())
            self.assertIn("HTTP 401", stderr.getvalue())
            self.assertNotIn("private-response", stderr.getvalue())

    def test_transient_failures_retry_then_write_only_validated_statistics(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "usage.json"
            snapshot = self.snapshot()
            error = urllib.error.HTTPError(profile.PROFILE_URL, 503, "Unavailable", {}, None)
            with patch("sys.argv", ["fetch", "--output", str(output)]), \
                    patch.object(profile, "fetch_profile", side_effect=[error, snapshot]) as fetch, \
                    patch.object(profile.time, "sleep") as sleep, redirect_stdout(io.StringIO()):
                profile.main()
            self.assertEqual(fetch.call_count, 2)
            sleep.assert_called_once_with(2)
            self.assertEqual(json.loads(output.read_text()), snapshot)
            self.assertFalse(output.with_suffix(".json.tmp").exists())

    def test_public_snapshot_validation_never_reads_credentials_or_calls_the_service(self):
        with tempfile.TemporaryDirectory() as directory:
            snapshot_path = Path(directory) / "usage.json"
            snapshot_path.write_text(json.dumps(self.snapshot()))
            with patch("sys.argv", ["fetch", "--validate-snapshot", str(snapshot_path)]), \
                    patch.object(profile, "fetch_profile") as fetch, redirect_stdout(io.StringIO()):
                profile.main()
            fetch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
