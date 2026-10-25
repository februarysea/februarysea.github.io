"""No live writes: state persistence uses temporary Git repos; API calls are mocked."""
import base64
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

import p7_state_store as store
import p7_sync as sync
import persist_p7_summary as publish
from codex_github import APIError
from test_p7_sync import state, rules


class StateStoreTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix="p7-store-")
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        remote, repo = self.root / "remote.git", self.root / "checkout"
        for path, extra in ((remote, ["--bare"]), (repo, [])):
            subprocess.run(["git", "init", *extra, str(path)], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(repo), "remote", "add", "origin", str(remote)], check=True, capture_output=True)
        original = Path.cwd()
        os.chdir(repo)
        self.addCleanup(os.chdir, original)
        env = patch.dict(os.environ, {"GITHUB_OUTPUT": str(self.root / "outputs")})
        env.start(); self.addCleanup(env.stop)
        self.folder = self.root / "validated"
        self.record, self.rules = state(), rules()
        sync.write_outputs(self.record, self.rules, self.folder)

    def test_roundtrip_commits_only_two_allowlisted_files_and_keeps_checkout_untouched(self):
        loaded = self.root / "loaded.json"
        store.load(self.folder / "sync-state.json", loaded)
        self.assertEqual(json.loads(loaded.read_text()), self.record)
        (self.folder / "session.json").write_text('{"sid":"private-canary"}')
        store.persist(self.folder, "none", self.rules)
        first = store.remote_head()
        self.assertEqual(store.git("ls-tree", "--name-only", first).splitlines(), ["p7-summary.json", "sync-state.json"])
        self.assertEqual(store.git("status", "--porcelain"), "")
        store.load(self.folder / "sync-state.json", loaded)
        self.assertEqual(json.loads(loaded.read_text()), self.record)
        self.record["updatedAt"] = "2026-10-26T12:00:00+00:00"
        sync.write_outputs(self.record, self.rules, self.folder)
        store.persist(self.folder, first, self.rules)
        second = store.remote_head()
        self.assertEqual(store.git("rev-parse", second + "^"), first)
        with self.assertRaisesRegex(ValueError, "advanced"):
            store.persist(self.folder, first, self.rules)
        self.assertEqual(store.remote_head(), second)

    def test_mismatched_or_secret_bearing_state_never_creates_remote_branch(self):
        public = sync.summarize(self.record, self.rules)[0]
        public["cats"]["tangyuan"]["latestMeasurement"]["kg"] += .1
        sync.atomic_json(self.folder / "p7-summary.json", public)
        with self.assertRaisesRegex(ValueError, "match"):
            store.persist(self.folder, "none", self.rules)
        self.assertEqual(store.remote_head(), "none")
        self.record["sid"] = "private-canary"
        sync.atomic_json(self.folder / "sync-state.json", self.record)
        with self.assertRaises(ValueError):
            store.persist(self.folder, "none", self.rules)
        self.assertEqual(store.remote_head(), "none")


class PublicPersistenceTests(unittest.TestCase):
    def snapshot(self):
        return sync.summarize(state(), rules())[0]

    def response(self, snapshot, sha="file-sha"):
        return {"sha": sha, "encoding": "base64", "content": base64.b64encode(json.dumps(snapshot).encode()).decode()}

    def test_fixed_path_and_conflict_reread(self):
        previous, current = self.snapshot(), self.snapshot()
        current["updatedAt"] = "2026-10-25T13:00:00+00:00"
        api = Mock(side_effect=[self.response(previous), APIError(409), self.response(previous, "new-sha"), {"commit": {"sha": "new-commit"}}])
        with patch.object(publish.time, "sleep"):
            self.assertEqual(publish.publish(current, "synthetic-token", api), "new-commit")
        self.assertEqual(api.call_args.args[0], "/repos/februarysea/februarysea.github.io/contents/src/data/p7-summary.json")
        self.assertEqual(api.call_args.kwargs["payload"]["sha"], "new-sha")
        self.assertEqual(api.call_args.kwargs["payload"]["branch"], "master")
        self.assertEqual(json.loads(base64.b64decode(api.call_args.kwargs["payload"]["content"])), current)

    def test_secret_fields_and_history_regressions_cannot_be_published(self):
        public = self.snapshot()
        bad = {**public, "refresh_token": "private-canary"}
        api = Mock()
        with self.assertRaises(ValueError): publish.publish(bad, "token", api)
        api.assert_not_called()
        for bad in ({**public, "updatedAt": "2026-10-25T11:00:00+00:00"}, sync.summarize(state(()), rules())[0]):
            api = Mock(return_value=self.response(public))
            with self.assertRaises(ValueError): publish.publish(bad, "token", api)
            self.assertEqual(api.call_count, 1)
        api = Mock(return_value=self.response(public))
        self.assertIsNone(publish.publish(public, "token", api))
        self.assertEqual(api.call_count, 1)


if __name__ == "__main__":
    unittest.main()
