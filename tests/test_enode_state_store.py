"""Exercise persistence against an isolated local Git remote, without credentials."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import enode_state_store as store
from enode_export import ExportError
from enode_sync import atomic_json, public_from_state
from test_enode_sync import fixture


class StateStoreTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="enode-store-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.remote = self.root / "remote.git"
        self.repo = self.root / "checkout"
        self.repo.mkdir()
        for path, extra in ((self.remote, ["--bare"]), (self.repo, [])):
            subprocess.run(["git", "init", *extra, str(path)], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(self.repo), "remote", "add", "origin", str(self.remote)], check=True, capture_output=True)
        original = Path.cwd()
        os.chdir(self.repo)
        self.addCleanup(os.chdir, original)
        environment = patch.dict(os.environ, {"GITHUB_OUTPUT": str(self.root / "outputs")})
        environment.start()
        self.addCleanup(environment.stop)
        self.state, _, _ = fixture()
        self.folder = self.root / "validated"
        self.save()

    def save(self):
        atomic_json(self.folder / "sync-state.json", self.state)
        atomic_json(self.folder / "training.json", public_from_state(self.state))

    def test_bootstrap_round_trip_and_only_two_files_are_committed(self):
        loaded = self.root / "loaded.json"
        store.load(self.folder / "sync-state.json", loaded)
        self.assertEqual(json.loads(loaded.read_text()), self.state)
        self.assertIn("state_revision=none", (self.root / "outputs").read_text())
        (self.folder / "session.json").write_text('{"token":"synthetic-do-not-publish"}')
        store.persist(self.folder, "none")
        first = store.remote_head()
        self.assertNotEqual(first, "none")
        self.assertEqual(store.git("ls-tree", "--name-only", first).splitlines(), ["sync-state.json", "training.json"])
        # The checked-out source/index are untouched by Git plumbing.
        self.assertEqual(store.git("status", "--porcelain"), "")
        store.load(self.folder / "sync-state.json", loaded)
        self.assertEqual(json.loads(loaded.read_text()), self.state)
        self.state["checkedThroughMs"] += 1000
        self.save()
        store.persist(self.folder, first)
        second = store.remote_head()
        self.assertEqual(store.git("rev-parse", second + "^"), first)
        self.assertEqual(json.loads(store.git("show", second + ":sync-state.json")), self.state)

    def test_changed_remote_is_not_overwritten(self):
        store.persist(self.folder, "none")
        first = store.remote_head()
        self.state["checkedThroughMs"] += 1000
        self.save()
        store.persist(self.folder, first)
        second = store.remote_head()
        with self.assertRaisesRegex(ExportError, "advanced"):
            store.persist(self.folder, first)
        self.assertEqual(store.remote_head(), second)

    def test_invalid_or_mismatched_public_data_never_creates_branch(self):
        public = public_from_state(self.state)
        public["sessions"] = []
        atomic_json(self.folder / "training.json", public)
        with self.assertRaisesRegex(ExportError, "does not match"):
            store.persist(self.folder, "none")
        self.assertEqual(store.remote_head(), "none")
        self.state["token"] = "synthetic-secret"
        atomic_json(self.folder / "sync-state.json", self.state)
        with self.assertRaisesRegex(ExportError, "Unexpected sync-state fields"):
            store.persist(self.folder, "none")
        self.assertEqual(store.remote_head(), "none")


if __name__ == "__main__":
    unittest.main()
