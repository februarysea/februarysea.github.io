"""Retiring account two must retain history and never request its credentials."""
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import Mock

from collect_codex_usage import collect_after_archive
from codex_usage import extend_archive, validate_snapshot, validate_update
from test_codex_accounts import account_environment


def snapshot(daily, total, timestamp="2026-10-25T12:00:00Z"):
    return {"version": 1, "source": "codex-profile-service", "generatedAt": timestamp,
            "totalTokens": total, "daily": [{"date": day, "totalTokens": count} for day, count in daily]}


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.archive = snapshot([("2026-10-23", 40), ("2026-10-24", 60)], 1000, "2026-10-24T18:00:00Z")
        # Primary lifetime includes old usage already in the combined archive.
        self.primary = snapshot([("2026-10-23", 20), ("2026-10-24", 30), ("2026-10-25", 10)], 900)

    def test_archive_is_unchanged_and_only_new_primary_days_increase_lifetime(self):
        before = copy.deepcopy(self.archive)
        result = extend_archive(self.archive, self.primary, self.archive)
        self.assertEqual(result["totalTokens"], 1010)
        self.assertEqual(result["daily"][:2], self.archive["daily"])
        self.assertEqual(result["daily"][-1], {"date": "2026-10-25", "totalTokens": 10})
        self.assertEqual(result["archivedThrough"], "2026-10-24")
        self.assertEqual(self.archive, before)
        self.assertEqual(extend_archive(self.archive, self.primary, result), result)

    def test_retired_credentials_and_stale_account_count_never_reach_collector(self):
        env = account_environment()
        env["CODEX_SECONDARY_AUTH_JSON"] = "expired-or-missing"
        live = Mock(return_value=self.primary)
        collect_after_archive(env, self.archive, self.archive, collect_live=live)
        passed = live.call_args.args[0]
        self.assertEqual(passed["CODEX_ACCOUNT_COUNT"], "1")
        self.assertEqual(passed["CODEX_ACCOUNT_ID"], "account-one")
        self.assertFalse(any("SECONDARY" in k for k in passed))
        del env["CODEX_SECONDARY_ACCOUNT_ID"]
        del env["CODEX_SECONDARY_AUTH_JSON"]
        self.assertEqual(collect_after_archive(env, self.archive, self.archive, collect_live=live)["totalTokens"], 1010)

    def test_later_dual_account_cloud_snapshot_is_not_mistaken_for_primary_history(self):
        old_cloud = snapshot([("2026-10-23", 40), ("2026-10-24", 60), ("2026-10-25", 80)], 1080)
        result = extend_archive(self.archive, self.primary, old_cloud)
        self.assertEqual(result["totalTokens"], 1010)
        self.assertEqual(result["daily"][-1]["totalTokens"], 10)

    def test_rolling_retention_keeps_primary_history_and_corrections_replace_only_live_days(self):
        previous = extend_archive(self.archive, self.primary, self.archive)
        new = snapshot([("2026-10-24", 999), ("2026-10-25", 12), ("2026-10-26", 20)], 2000, "2026-10-27T00:00:00Z")
        current = extend_archive(self.archive, new, previous)
        self.assertEqual(current["totalTokens"], 1032)
        self.assertEqual(current["daily"][:2], self.archive["daily"])
        rolled = snapshot([("2026-11-01", 5)], 2500, "2026-11-02T00:00:00Z")
        result = extend_archive(self.archive, rolled, current)
        self.assertEqual(result["totalTokens"], 1037)
        self.assertEqual(result["daily"][:-1], current["daily"])

    def test_missing_or_inconsistent_history_and_stale_data_fail_closed(self):
        previous = extend_archive(self.archive, self.primary, self.archive)
        bad = copy.deepcopy(previous); bad["totalTokens"] += 100
        changed = copy.deepcopy(previous); changed["daily"][0]["totalTokens"] = 1
        for item in (bad, changed):
            with self.assertRaises(ValueError): extend_archive(self.archive, self.primary, item)
        for primary in (snapshot([], 900), {**self.primary, "generatedAt": "2026-10-24T00:00:00Z"}):
            with self.assertRaises(ValueError): extend_archive(self.archive, primary, previous)
        for key, value in (("archivedThrough", "2026-10-23"), ("archivedThrough", "private-canary")):
            changed = {**previous, key: value}
            with self.assertRaises(ValueError): validate_update(previous, changed)
        raw = {k: v for k, v in previous.items() if k != "archivedThrough"}
        with self.assertRaises(ValueError): validate_update(previous, raw)

    def test_reviewed_repository_baseline_preserves_every_historical_count(self):
        root = Path(__file__).resolve().parents[1]
        archive = validate_snapshot(json.loads((root / "config/codex-usage-archive.json").read_text()))
        current = validate_snapshot(json.loads((root / "src/data/codex-profile.json").read_text()))
        cutoff = archive["daily"][-1]["date"]
        self.assertEqual(cutoff, "2026-10-24")
        self.assertEqual([r for r in current["daily"] if r["date"] <= cutoff], archive["daily"])
        self.assertEqual(current["totalTokens"], archive["totalTokens"] + sum(r["totalTokens"] for r in current["daily"] if r["date"] > cutoff))


if __name__ == "__main__":
    unittest.main()
