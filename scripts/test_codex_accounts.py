import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import collect_codex_usage as collect
from test_codex_collector import auth, usage


def account_environment():
    return {
        "CODEX_ACCOUNT_COUNT": "2",
        "CODEX_AUTH_JSON": auth(account="account-one"),
        "CODEX_ACCOUNT_ID": "account-one",
        "CODEX_SECONDARY_AUTH_JSON": auth(account="account-two"),
        "CODEX_SECONDARY_ACCOUNT_ID": "account-two",
        "GH_TOKEN": "github-secret",
    }


class AccountAggregationTests(unittest.TestCase):
    def test_overlapping_dates_are_summed_and_nonoverlapping_dates_are_preserved(self):
        first = collect.normalize_usage(usage())
        first["generatedAt"] = "2026-10-15T00:00:00Z"
        second = collect.normalize_usage({"summary": {"lifetimeTokens": 70}, "dailyUsageBuckets": [
            {"startDate": "2026-10-13", "tokens": 20}, {"startDate": "2026-10-15", "tokens": 30}]})
        second["generatedAt"] = "2026-10-15T00:01:00Z"
        result = collect.combine_snapshots([first, second])
        self.assertEqual(result["totalTokens"], 160)
        self.assertEqual(result["generatedAt"], first["generatedAt"])
        self.assertEqual(result["daily"], [
            {"date": "2026-10-13", "totalTokens": 60},
            {"date": "2026-10-14", "totalTokens": 0},
            {"date": "2026-10-15", "totalTokens": 30},
        ])
        self.assertEqual(set(result), {"version", "source", "generatedAt", "totalTokens", "daily"})

    def test_single_account_compatibility_and_an_unused_second_account(self):
        snapshot = collect.normalize_usage(usage())
        empty = collect.normalize_usage({"summary": {"lifetimeTokens": 0}, "dailyUsageBuckets": []})
        self.assertEqual(collect.combine_snapshots([snapshot]), snapshot)
        combined = collect.combine_snapshots([snapshot, empty])
        self.assertEqual(combined["totalTokens"], snapshot["totalTokens"])
        self.assertEqual(combined["daily"], snapshot["daily"])
        env = account_environment()
        env["CODEX_ACCOUNT_COUNT"] = "1"
        self.assertEqual(len(collect.configured_accounts(env)), 1)

    def test_empty_private_or_overflowing_aggregates_are_rejected(self):
        private = collect.normalize_usage(usage())
        private["email"] = "private-canary"
        maximum = collect.normalize_usage({"summary": {"lifetimeTokens": 2**53 - 1}, "dailyUsageBuckets": []})
        for snapshots in ([], [private], [maximum, collect.normalize_usage(usage())]):
            with self.subTest(snapshots=snapshots), self.assertRaises(ValueError):
                collect.combine_snapshots(snapshots)

    def test_all_expected_credentials_are_required_before_any_refresh(self):
        for missing in ("CODEX_AUTH_JSON", "CODEX_ACCOUNT_ID", "CODEX_SECONDARY_AUTH_JSON", "CODEX_SECONDARY_ACCOUNT_ID"):
            with self.subTest(missing=missing):
                env = account_environment()
                del env[missing]
                collector, persist = Mock(), Mock()
                with self.assertRaises(ValueError):
                    collect.collect_accounts(env, collector=collector, persist=persist)
                collector.assert_not_called()
                persist.assert_not_called()

    def test_duplicate_accounts_are_rejected_before_they_can_be_double_counted(self):
        env = account_environment()
        env["CODEX_SECONDARY_ACCOUNT_ID"] = env["CODEX_ACCOUNT_ID"]
        env["CODEX_SECONDARY_AUTH_JSON"] = env["CODEX_AUTH_JSON"]
        collector, persist = Mock(), Mock()
        with self.assertRaises(ValueError):
            collect.collect_accounts(env, collector=collector, persist=persist)
        collector.assert_not_called()
        persist.assert_not_called()

    def test_both_accounts_rotate_independently_and_reuse_their_own_latest_credentials(self):
        env = account_environment()
        seeds, rotations = [], {"account-one": 0, "account-two": 0}
        self_test = self
        class RPC:
            def __init__(self, binary, home):
                self.home = home
                seed = (home / "auth.json").read_text()
                self.account = json.loads(seed)["tokens"]["account_id"]
                seeds.append((self.account, seed))
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def call(self, method, params=None):
                if method == "account/read":
                    rotations[self.account] += 1
                    (self.home / "auth.json").write_text(auth("rotated" + str(rotations[self.account]), account=self.account))
                    return {"account": {"type": "chatgpt"}}
                return usage()
        def collector(raw, account, save):
            return collect.collect(raw, account, save, rpc_factory=RPC)
        def persist(raw, account, token, *, secret_name):
            expected = "account-one" if secret_name == "CODEX_AUTH_JSON" else "account-two"
            self_test.assertEqual(account, expected)
            self_test.assertEqual(token, "github-secret")
            collect.validate_auth(raw, expected)
            env[secret_name] = raw
        for _ in range(2):
            result = collect.collect_accounts(env, collector=collector, persist=persist)
            self.assertEqual(result["totalTokens"], 180)
            self.assertNotIn("account-one", json.dumps(result))
            self.assertNotIn("account-two", json.dumps(result))
        self.assertEqual(seeds, [
            ("account-one", auth(account="account-one")),
            ("account-two", auth(account="account-two")),
            ("account-one", auth("rotated1", account="account-one")),
            ("account-two", auth("rotated1", account="account-two")),
        ])
        self.assertEqual(env["CODEX_AUTH_JSON"], auth("rotated2", account="account-one"))
        self.assertEqual(env["CODEX_SECONDARY_AUTH_JSON"], auth("rotated2", account="account-two"))

    def test_second_account_failure_preserves_previous_output_and_first_accounts_renewal(self):
        env = account_environment()
        def collector(raw, account, save):
            save(auth("rotated", account=account))
            if account == "account-two":
                raise RuntimeError("private-upstream-error")
            return collect.normalize_usage(usage())
        def persist(raw, account, token, *, secret_name):
            env[secret_name] = raw
        collect_all = collect.collect_accounts
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "codex-profile.json"
            original = json.dumps(collect.normalize_usage(usage()))
            output.write_text(original)
            stderr = io.StringIO()
            with patch.object(collect, "collect_accounts", side_effect=lambda _: collect_all(env, collector=collector, persist=persist)), \
                 patch("sys.argv", ["collect", "--output", str(output)]), contextlib.redirect_stderr(stderr), \
                 self.assertRaises(SystemExit) as error:
                collect.main()
            self.assertEqual(error.exception.code, 1)
            self.assertEqual(output.read_text(), original)
            self.assertNotIn("private-upstream-error", stderr.getvalue())
        self.assertEqual(env["CODEX_AUTH_JSON"], auth("rotated", account="account-one"))

    def test_second_account_persists_only_to_its_own_environment_secret(self):
        with patch.object(collect, "request", return_value={"full_name": collect.WEBSITE_REPO}), \
             patch.object(collect.subprocess, "run", return_value=Mock(returncode=0)) as run:
            collect.persist_auth(auth(account="account-two"), "account-two", "github-secret",
                                 secret_name="CODEX_SECONDARY_AUTH_JSON")
        args, kwargs = run.call_args
        self.assertEqual(args[0][3], "CODEX_SECONDARY_AUTH_JSON")
        self.assertEqual(kwargs["input"], auth(account="account-two"))
        self.assertNotIn("original-access", " ".join(args[0]))
        with patch.object(collect, "request") as api, self.assertRaises(ValueError):
            collect.persist_auth(auth(), "selected-account", "github-secret", secret_name="UNRELATED_SECRET")
        api.assert_not_called()


if __name__ == "__main__":
    unittest.main()
