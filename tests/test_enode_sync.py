"""Incremental correctness, disclosure boundaries and failure atomicity."""
import base64
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import enode
import enode_sync as sync
from enode_export import ExportError, load_catalog

UID = "synthetic-private-account"
CREATED = 1790000000000
NOW = CREATED + 10 * sync.DAY
CATALOG = {"schemaVersion": 1, "metrics": {
    key: {"key": value, "dimension": "scalar", "loadingFactor": 0, "name": value}
    for key, value in (("load", "loadingMass"), ("count", "repCount"), ("velocity", "velocityMean"))
}, "translations": {}, "exercises": {}}


def measurement(metric, value):
    return {"metricID": metric, "value": value}


def fixture(count=3):
    summaries, routes, state = {}, {}, {"schemaVersion": 1, "accountHash": sync.digest(UID),
        "catalogHash": sync.fingerprint(CATALOG), "fromMs": CREATED - sync.DAY,
        "checkedThroughMs": NOW - sync.DAY, "sessions": {}}
    for n in range(count):
        sid, set_id = f"private-session-{n}", f"private-set-{n}"
        summary = {"id": sid, "created": CREATED + n * 1000, "user": {"id": UID, "email": "private@example.invalid"},
                   "exercise": {"name": "Squat"}, "measurements": [], "order": n}
        summaries[sid] = summary
        detail = {**summary, "sets": [{"id": set_id, "sessionID": sid}]}
        workout_set = {"id": set_id, "sessionID": sid, "work": True,
                       "measurements": [measurement("load", 100), measurement("count", 1)],
                       "reps": [{"id": f"private-rep-{n}", "setID": set_id, "phase": "concentric", "valid": True,
                                 "measurements": [measurement("velocity", .5)], "dataPackages": ["NEVER-PUBLISH"]}]}
        routes["/workout_sessions/" + sid] = detail
        routes["/workout_sets/" + set_id] = workout_set
        state["sessions"][sync.digest(sid)] = {"date": sync.local_date(summary["created"]), "position": n,
            "summaryHash": sync.summary_fingerprint(summary), "verifiedAtMs": NOW - sync.DAY, "missingSinceMs": None,
            "sets": [{"id": "set-" + sync.digest(set_id)[:20], "exercise": "Squat", "weightKg": 100,
                      "repCount": 1, "work": True, "reps": [{"meanVelocityMps": .5}]}]}
    return state, summaries, routes


class IncrementalTests(unittest.TestCase):
    def setUp(self):
        payload = base64.urlsafe_b64encode(json.dumps({"uid": UID, "exp": 4102444800}).encode()).decode().rstrip("=")
        self.token = "fake-header." + payload + ".fake-signature"
        self.calls = []
        for target, value in (("session_token", self.token), ("client_config", {"apiKey": "API-SECRET", "deviceId": "DEVICE-SECRET", "email": "private@example.invalid"})):
            context = patch.object(enode, target, return_value=value)
            context.start()
            self.addCleanup(context.stop)

    def api(self, summaries, routes):
        def call(path):
            self.calls.append(path)
            parsed = urlsplit(path)
            if parsed.path == "/workout_sessions":
                query = parse_qs(parsed.query)
                return copy.deepcopy([s for s in summaries.values() if float(query["from"][0]) <= s["created"] <= float(query["to"][0])])
            return copy.deepcopy(routes[path])
        return call

    def run_sync(self, state, summaries, routes, now=NOW, **kwargs):
        with patch.object(sync, "request", side_effect=self.api(summaries, routes)):
            return sync.synchronize(state, CATALOG, now, **kwargs)

    def test_unchanged_only_lists_and_reuses_details(self):
        state, summaries, routes = fixture()
        before = copy.deepcopy(state)
        result, public, report = self.run_sync(state, summaries, routes)
        self.assertEqual(report["details_fetched"], 0)
        self.assertEqual(report["sets_fetched"], 0)
        self.assertEqual(report["reused"], 3)
        self.assertTrue(all(urlsplit(p).path == "/workout_sessions" for p in self.calls))
        self.assertEqual(state, before)
        self.assertEqual(result["checkedThroughMs"], NOW)
        self.assertEqual(len(public["sessions"][0]["sets"]), 3)

    def test_new_and_changed_only_fetch_targeted_details(self):
        state, summaries, routes = fixture()
        state["sessions"].pop(sync.digest("private-session-2"))
        summaries["private-session-1"]["measurements"] = [measurement("load", 105)]
        routes["/workout_sets/private-set-1"]["measurements"][0]["value"] = 105
        result, public, report = self.run_sync(state, summaries, routes)
        self.assertEqual((report["new"], report["changed"], report["reused"]), (1, 1, 1))
        self.assertEqual((report["details_fetched"], report["sets_fetched"]), (2, 2))
        self.assertNotIn("/workout_sessions/private-session-0", self.calls)
        self.assertEqual(public["sessions"][0]["sets"][1]["weightKg"], 105)
        encoded = json.dumps(result)
        for secret in (UID, "private-session", "private-set", "private-rep", "private@example.invalid", "NEVER-PUBLISH", self.token):
            self.assertNotIn(secret, encoded)

    def test_recent_recheck_is_bounded_not_every_code_push(self):
        state, summaries, routes = fixture(1)
        summaries["private-session-0"]["created"] = NOW - sync.DAY
        routes["/workout_sessions/private-session-0"]["created"] = NOW - sync.DAY
        entry = state["sessions"][sync.digest("private-session-0")]
        entry["date"] = sync.local_date(NOW - sync.DAY)
        entry["summaryHash"] = sync.summary_fingerprint(summaries["private-session-0"])
        fresh, _, report = self.run_sync(state, summaries, routes)
        self.assertEqual(report["rechecked"], 1)
        _, _, again = self.run_sync(fresh, summaries, routes, NOW + 60000)
        self.assertEqual(again["details_fetched"], 0)

    def test_weekly_audit_catches_rep_change_missing_from_summary(self):
        state, summaries, routes = fixture(1)
        state["sessions"][sync.digest("private-session-0")]["verifiedAtMs"] = NOW - 8 * sync.DAY
        routes["/workout_sets/private-set-0"]["reps"][0]["measurements"][0]["value"] = .8
        _, public, report = self.run_sync(state, summaries, routes)
        self.assertEqual(report["rechecked"], 1)
        self.assertEqual(public["sessions"][0]["sets"][0]["reps"], [{"meanVelocityMps": .8}])

    def test_deletion_needs_two_daily_confirmations_and_reappearance_cancels(self):
        state, summaries, routes = fixture()
        removed = summaries.pop("private-session-1")
        pending, _, report = self.run_sync(state, summaries, routes)
        self.assertEqual(report["pending_deletions"], 1)
        self.assertEqual(len(pending["sessions"]), 3)
        _, _, soon = self.run_sync(pending, summaries, routes, NOW + 60000)
        self.assertEqual(soon["deleted"], 0)
        deleted, _, report = self.run_sync(pending, summaries, routes, NOW + sync.DAY)
        self.assertEqual(report["deleted"], 1)
        self.assertEqual(len(deleted["sessions"]), 2)
        summaries["private-session-1"] = removed
        returned, _, _ = self.run_sync(pending, summaries, routes, NOW + sync.DAY)
        self.assertIsNone(returned["sessions"][sync.digest("private-session-1")]["missingSinceMs"])

    def test_empty_and_bulk_loss_fail_without_mutating_state(self):
        state, summaries, routes = fixture(12)
        before = copy.deepcopy(state)
        for missing in ({}, dict(list(summaries.items())[5:])):
            with self.assertRaisesRegex(ExportError, "bulk disappearance"):
                self.run_sync(state, missing, routes)
        self.assertEqual(state, before)
        result, _, report = self.run_sync(state, {}, routes, accept_deletions=True)
        self.assertEqual(result["sessions"], {})
        self.assertEqual(report["deleted"], 12)

    def test_midway_failure_and_wrong_ownership_do_not_advance_state(self):
        state, summaries, routes = fixture()
        before = copy.deepcopy(state)
        routes["/workout_sets/private-set-1"]["sessionID"] = "wrong-account-session"
        with self.assertRaises(ExportError):
            self.run_sync(state, summaries, routes, force_audit=True)
        self.assertEqual(state, before)

    def test_account_mismatch_stops_before_requests(self):
        state, summaries, routes = fixture()
        state["accountHash"] = sync.digest("another-account")
        with self.assertRaisesRegex(ExportError, "account"):
            self.run_sync(state, summaries, routes)
        self.assertEqual(self.calls, [])

    def test_catalog_change_rechecks_existing_records(self):
        state, summaries, routes = fixture(1)
        state["catalogHash"] = sync.digest("old-catalog")
        _, _, report = self.run_sync(state, summaries, routes)
        self.assertEqual(report["changed"], 1)

    def test_extra_fields_and_secret_in_name_are_rejected(self):
        state, _, _ = fixture(1)
        for target in (state, next(iter(state["sessions"].values())), next(iter(state["sessions"].values()))["sets"][0]):
            target["token"] = "SECRET"
            with self.assertRaises(ExportError):
                sync.validate_state(state)
            del target["token"]
        next(iter(state["sessions"].values()))["sets"][0]["exercise"] = "API-SECRET"
        with self.assertRaisesRegex(ExportError, "private value"):
            sync.safe_outputs(state)

    def test_transport_retries_but_auth_does_not(self):
        for error, count in ((enode.EnodeError("HTTP 401"), 1), (enode.EnodeError("HTTP 503", retryable=True), 3)):
            with patch.object(enode, "request", side_effect=error) as mocked, patch.object(sync.time, "sleep"):
                with self.assertRaises(enode.EnodeError):
                    sync.request("/workout_sessions")
                self.assertEqual(mocked.call_count, count)

    def test_portable_catalog_preserves_mapping_and_rejects_extras(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "catalog.json"
            path.write_text(json.dumps(CATALOG))
            self.assertEqual(load_catalog(path)[0], CATALOG["metrics"])
            path.write_text(json.dumps({**CATALOG, "account": UID}))
            with self.assertRaises(ExportError):
                load_catalog(path)


if __name__ == "__main__":
    unittest.main()
