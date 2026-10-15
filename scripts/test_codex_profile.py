import copy
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

import codex_usage as profile


class ProfileUsageTests(unittest.TestCase):
    def snapshot(self):
        return {"version": 1, "source": "codex-profile-service",
                "generatedAt": "2026-10-14T12:00:00+00:00", "totalTokens": 90,
                "daily": [{"date": "2026-10-13", "totalTokens": 40}]}

    def test_exact_dates_counts_and_explicit_zero_are_preserved(self):
        snapshot = self.snapshot()
        snapshot["daily"].append({"date": "2026-10-14", "totalTokens": 0})
        self.assertEqual(profile.validate_snapshot(snapshot), snapshot)

    def test_invalid_numeric_values_are_rejected(self):
        for value in (True, False, "10", None, -1, 0.5, float("nan"), float("inf"), 2**53, 10**400):
            with self.subTest(value=repr(value)), self.assertRaises(ValueError):
                profile.token_count(value)
        self.assertEqual(profile.token_count(0), 0)
        self.assertEqual(profile.token_count(2**53 - 1), 2**53 - 1)

    def test_identity_and_credentials_cannot_enter_public_json(self):
        for field in ("account_id", "email", "access_token", "refresh_token", "profile"):
            snapshot = self.snapshot()
            snapshot[field] = "private-canary"
            with self.subTest(field=field), self.assertRaises(ValueError):
                profile.validate_snapshot(snapshot)
        snapshot = self.snapshot()
        snapshot["daily"][0]["email"] = "private-canary"
        with self.assertRaises(ValueError):
            profile.validate_snapshot(snapshot)

    def test_invalid_envelopes_and_timestamps_are_rejected(self):
        for value in (None, [], {}, {**self.snapshot(), "version": True}, {**self.snapshot(), "source": "other"}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                profile.validate_snapshot(value)
        for value in (None, 42, "2026-10-14", "2026-10-14T12:00:00", "invalid"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                profile.validate_snapshot({**self.snapshot(), "generatedAt": value})

    def test_ambiguous_or_inconsistent_daily_data_is_rejected(self):
        for daily in (None, [{"date": "20261013", "totalTokens": 40}],
                      [{"date": "2026-10-13", "totalTokens": 100}],
                      [{"date": "2026-10-13", "totalTokens": 10}] * 2,
                      [{"date": "2026-10-14", "totalTokens": 0}, {"date": "2026-10-13", "totalTokens": 40}]):
            with self.subTest(daily=daily), self.assertRaises(ValueError):
                profile.validate_snapshot({**self.snapshot(), "daily": daily})

    def test_regressing_snapshot_or_daily_coverage_is_rejected(self):
        for changes in ({"generatedAt": "2026-10-13T12:00:00+00:00"}, {"daily": []},
                        {"daily": [{"date": "2026-10-12", "totalTokens": 40}]}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                profile.validate_update(self.snapshot(), {**self.snapshot(), **changes})

    def test_service_corrections_are_allowed_with_current_coverage(self):
        current = copy.deepcopy(self.snapshot())
        current["totalTokens"] = 50
        current["daily"][0]["totalTokens"] = 30
        self.assertEqual(profile.validate_update(self.snapshot(), current), current)

    def test_cli_validation_does_not_modify_files_or_disclose_invalid_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "usage.json"
            path.write_text(json.dumps(self.snapshot()))
            original = path.read_bytes()
            with patch("sys.argv", ["validate", str(path)]), redirect_stdout(io.StringIO()):
                profile.main()
            self.assertEqual(path.read_bytes(), original)
            path.write_text('{"access_token":"private-canary"}')
            stderr = io.StringIO()
            with patch("sys.argv", ["validate", str(path)]), redirect_stderr(stderr), self.assertRaises(SystemExit):
                profile.main()
            self.assertNotIn("private-canary", stderr.getvalue())
            self.assertEqual(path.read_text(), '{"access_token":"private-canary"}')


if __name__ == "__main__":
    unittest.main()
