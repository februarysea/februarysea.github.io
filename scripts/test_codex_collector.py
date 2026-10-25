import base64
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import collect_codex_usage as collect
import codex_github as github_api
import persist_codex_usage as publish


def auth(marker="original", account="selected-account"):
    return json.dumps({"auth_mode": "chatgpt", "last_refresh": "2026-10-15T00:00:00Z", "tokens": {
        "access_token": marker + "-access", "refresh_token": marker + "-refresh",
        "id_token": marker + "-id", "account_id": account}})


def usage():
    return {"summary": {"lifetimeTokens": 90}, "dailyUsageBuckets": [
        {"startDate": "2026-10-14", "tokens": 0}, {"startDate": "2026-10-13", "tokens": 40}],
        "email": "private-canary", "access_token": "private-canary"}


class CollectorTests(unittest.TestCase):
    def test_export_preserves_service_dates_and_removes_all_identity_fields(self):
        result = collect.normalize_usage(usage())
        self.assertEqual(result["daily"], [{"date": "2026-10-13", "totalTokens": 40}, {"date": "2026-10-14", "totalTokens": 0}])
        self.assertEqual(result["totalTokens"], 90)
        self.assertNotIn("private-canary", json.dumps(result))

    def test_null_metrics_fail_instead_of_becoming_zero(self):
        for value in (None, {}, {"summary": {"lifetimeTokens": None}, "dailyUsageBuckets": []},
                      {"summary": {"lifetimeTokens": 90}, "dailyUsageBuckets": None}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                collect.normalize_usage(value)

    def test_wrong_account_is_rejected_before_persistence_or_network(self):
        with patch.object(collect, "CodexRPC") as rpc:
            persist = unittest.mock.Mock()
            with self.assertRaises(ValueError):
                collect.collect(auth(account="other-account"), "selected-account", persist, rpc_factory=rpc)
            persist.assert_not_called()
            rpc.assert_not_called()

    def test_failed_storage_preflight_prevents_any_refresh(self):
        rpc = unittest.mock.Mock()
        with self.assertRaises(RuntimeError):
            collect.collect(auth(), "selected-account", unittest.mock.Mock(side_effect=RuntimeError("no storage")), rpc_factory=rpc)
        rpc.assert_not_called()

    def test_refreshed_credentials_are_saved_before_usage_and_again_after_error(self):
        saved, events, homes = [], [], []
        def persist(value):
            saved.append(value)
            events.append("saved-new" if value == auth("rotated") else "saved-old")
        class RPC:
            def __init__(self, binary, home):
                self.home = home
                homes.append(home)
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def call(self, method, params=None):
                if method == "account/read":
                    self_test.assertEqual(params, {"refreshToken": True})
                    (self.home / "auth.json").write_text(auth("rotated"))
                    return {"account": {"type": "chatgpt"}}
                events.append("usage")
                raise RuntimeError("service unavailable")
        self_test = self
        with self.assertRaises(RuntimeError):
            collect.collect(auth(), "selected-account", persist, rpc_factory=RPC)
        self.assertEqual(events, ["saved-old", "saved-new", "usage", "saved-new"])
        self.assertEqual(saved[-1], auth("rotated"))
        self.assertFalse(homes[0].exists())

    def test_a_second_run_uses_the_rotated_credentials(self):
        state = [auth()]
        seeds = []
        class RPC:
            def __init__(self, binary, home):
                self.home = home
                seeds.append((home / "auth.json").read_text())
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def call(self, method, params=None):
                if method == "account/read":
                    (self.home / "auth.json").write_text(auth("rotated" + str(len(seeds))))
                    return {"account": {"type": "chatgpt"}}
                return usage()
        def persist(value): state[0] = value
        for _ in range(2):
            collect.collect(state[0], "selected-account", persist, rpc_factory=RPC)
        self.assertEqual(seeds, [auth(), auth("rotated1")])
        self.assertEqual(state[0], auth("rotated2"))

    def test_auth_is_never_saved_to_another_repository(self):
        with patch.object(collect, "request", return_value={"private": True, "full_name": "somebody/other-repository"}), \
             patch.object(collect.subprocess, "run") as run:
            with self.assertRaises(RuntimeError):
                collect.persist_auth(auth(), "selected-account", "github-secret")
            run.assert_not_called()

    def test_credentials_go_to_environment_secret_over_stdin_not_command_arguments(self):
        with patch.object(collect, "request", return_value={"private": False, "full_name": github_api.WEBSITE_REPO}), \
             patch.object(collect.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run:
            collect.persist_auth(auth(), "selected-account", "github-secret")
        args, kwargs = run.call_args
        self.assertNotIn("original-access", " ".join(args[0]))
        self.assertNotIn("github-secret", " ".join(args[0]))
        self.assertEqual(args[0][-2:], ["--env", "codex-auth"])
        self.assertEqual(kwargs["input"], auth())
        self.assertEqual(kwargs["env"]["GH_TOKEN"], "github-secret")

    def test_rpc_does_not_pass_github_secrets_to_the_codex_subprocess(self):
        child = unittest.mock.Mock()
        child.stdin = io.BytesIO()
        child.stdout = io.BytesIO()
        with tempfile.TemporaryDirectory() as directory, \
             patch.dict(collect.os.environ, {"GH_TOKEN": "canary", "CODEX_AUTH_JSON": "canary", "APP_PRIVATE_KEY": "canary"}), \
             patch.object(collect.subprocess, "Popen", return_value=child) as popen:
            client = collect.CodexRPC("codex", Path(directory))
            client.close()
        env = popen.call_args.kwargs["env"]
        self.assertFalse({"GH_TOKEN", "CODEX_AUTH_JSON", "APP_PRIVATE_KEY"} & env.keys())

    def test_rpc_error_text_is_not_exposed(self):
        client = object.__new__(collect.CodexRPC)
        client.sequence = 0
        client.timeout = 1
        client.messages = collect.queue.Queue()
        client._send = unittest.mock.Mock()
        client.messages.put({"id": 1, "error": {"message": "private-canary"}})
        with self.assertRaises(RuntimeError) as raised:
            client.call("account/usage/read")
        self.assertNotIn("private-canary", str(raised.exception))

    def test_only_confirmed_auth_failures_request_signin(self):
        cases = (
            ("Your access token could not be refreshed because your refresh token has expired. Please log out and sign in again.", True),
            ("Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.", True),
            ("Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.", True),
            ("workspace routing discovery unauthorized (401)", True),
            ("workspace routing discovery timed out", False),
            ("failed to persist rotated login", False),
            ("503 Service unavailable", False),
        )
        for message, reauth in cases:
            client = object.__new__(collect.CodexRPC)
            client.sequence, client.timeout = 0, 1
            client.messages, client._send = collect.queue.Queue(), unittest.mock.Mock()
            client.messages.put({"id": 1, "error": {"message": message + " private-canary"}})
            with self.assertRaises(RuntimeError) as result:
                client.call("account/read")
            self.assertEqual(isinstance(result.exception, collect.CodexAuthRequired), reauth)
            self.assertNotIn("private-canary", str(result.exception))

    def test_second_account_expiry_is_labelled_without_exposing_identity(self):
        env = {"CODEX_AUTH_JSON": auth(account="first"), "CODEX_ACCOUNT_ID": "first",
               "CODEX_SECONDARY_AUTH_JSON": auth(account="second"), "CODEX_SECONDARY_ACCOUNT_ID": "second",
               "CODEX_ACCOUNT_COUNT": "2", "GH_TOKEN": "synthetic-token"}
        collector = unittest.mock.Mock(side_effect=[collect.normalize_usage(usage()), collect.CodexAuthRequired()])
        with self.assertRaises(collect.CodexAuthRequired) as result:
            collect.collect_accounts(env, collector=collector, persist=unittest.mock.Mock())
        self.assertEqual(result.exception.secret_name, "CODEX_SECONDARY_AUTH_JSON")

    def test_signed_out_account_requires_reauthorization_and_preserves_managed_auth(self):
        saved = []
        class RPC:
            def __init__(self, binary, home): pass
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def call(self, method, params=None):
                return {"account": None, "requiresOpenaiAuth": True}
        with self.assertRaises(collect.CodexAuthRequired):
            collect.collect(auth(), "selected-account", saved.append, rpc_factory=RPC)
        self.assertEqual(saved, [auth(), auth()])


class PublishTests(unittest.TestCase):
    def previous(self):
        result = collect.normalize_usage(usage())
        result["generatedAt"] = "2026-10-14T00:00:00Z"
        return result

    def response(self, previous, sha="file-sha"):
        return {"sha": sha, "encoding": "base64", "content": base64.b64encode(json.dumps(previous).encode()).decode()}

    def test_only_public_snapshot_path_and_master_can_be_updated(self):
        current = self.previous()
        current["totalTokens"] += 1
        api = unittest.mock.Mock(side_effect=[self.response(self.previous()), {"commit": {"sha": "commit-sha"}}])
        self.assertEqual(publish.publish(current, "token", api), "commit-sha")
        args, kwargs = api.call_args
        self.assertEqual(args[0], "/repos/februarysea/februarysea.github.io/contents/src/data/codex-profile.json")
        self.assertEqual(kwargs["payload"]["branch"], "master")
        self.assertEqual(kwargs["payload"]["sha"], "file-sha")
        self.assertEqual(json.loads(base64.b64decode(kwargs["payload"]["content"])), current)

    def test_secret_fields_fail_before_any_github_request(self):
        current = self.previous()
        current["refresh_token"] = "private-canary"
        api = unittest.mock.Mock()
        with self.assertRaises(ValueError):
            publish.publish(current, "token", api)
        api.assert_not_called()

    def test_stale_or_empty_data_cannot_replace_successful_history(self):
        current = self.previous()
        current["daily"] = []
        api = unittest.mock.Mock(return_value=self.response(self.previous()))
        with self.assertRaises(ValueError):
            publish.publish(current, "token", api)
        self.assertEqual(api.call_count, 1)

    def test_unchanged_counts_do_not_create_daily_empty_commits(self):
        api = unittest.mock.Mock(return_value=self.response(self.previous()))
        self.assertIsNone(publish.publish(collect.normalize_usage(usage()), "token", api))
        self.assertEqual(api.call_count, 1)

    def test_concurrent_update_is_reread_before_retry(self):
        current = self.previous()
        current["totalTokens"] += 1
        api = unittest.mock.Mock(side_effect=[self.response(self.previous()), github_api.APIError(409),
            self.response(self.previous(), "new-sha"), {"commit": {"sha": "commit-sha"}}])
        with patch.object(publish.time, "sleep"):
            publish.publish(current, "token", api)
        self.assertEqual(api.call_args.kwargs["payload"]["sha"], "new-sha")


class GitHubTests(unittest.TestCase):
    def test_redirects_cannot_forward_authorization(self):
        self.assertIsNone(github_api.NoRedirects().redirect_request(None, None, 302, "Found", {}, "https://elsewhere.invalid"))

    def test_short_lived_token_only_manages_website_environments(self):
        with patch.object(github_api.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout=b"signature")), \
             patch.object(github_api, "request", return_value={"token": "test-token"}) as api:
            github_api.installation_token("123", "456", "test-private-key")
        self.assertEqual(api.call_args.kwargs["payload"], {
            "repositories": ["februarysea.github.io"], "permissions": {"environments": "write"}})


if __name__ == "__main__":
    unittest.main()
