"""Offline P7 history, filtering, authentication and failure-atomicity checks."""
import base64
import copy
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import p7_client as client
import p7_sync as sync

ROOT = Path(__file__).resolve().parents[1]
DEVICE_HASH = hashlib.sha256(b"synthetic-device").hexdigest()


def fixture(weights=(6.3, 4.9), day="2026-10-25", fetched="2026-10-25T12:00:00+00:00"):
    rows = []
    for index, kg in enumerate(weights):
        stamp = int(dt.datetime.fromisoformat(day + "T08:00:00+08:00").timestamp()) + index * 60
        seconds, grams = 30 + index, round(kg * 1000)
        binary = seconds.to_bytes(4, "big") + grams.to_bytes(4, "big") + bytes([8, index % 60])
        for dp, value in ((107, f"Weight:{grams}g,WC_time:{seconds}s,Total:{index},8h,{index % 60}m"),
                          (109, base64.b64encode(binary).decode())):
            rows.append({"timeStamp": stamp, "dpId": dp, "value": value, "private": "private-canary"})
    return {"success": True, "t": dt.datetime.fromisoformat(fetched).timestamp() * 1000,
            "result": {"total": len(rows), "hasNext": False, "dps": rows}, "sid": "private-canary"}


def rules():
    return sync.load_rules(ROOT / "config/p7-rules.json")


def state(weights=(6.3, 4.9), **kwargs):
    return sync.decode_snapshot(fixture(weights, **kwargs), DEVICE_HASH)


class HistoryTests(unittest.TestCase):
    def test_two_representations_are_deduplicated_and_private_fields_are_removed(self):
        raw = fixture()
        raw["result"]["dps"] += copy.deepcopy(raw["result"]["dps"])
        raw["result"]["total"] *= 2
        result = sync.decode_snapshot(raw, DEVICE_HASH)
        self.assertEqual(len(result["events"]), 2)
        self.assertNotIn("private-canary", json.dumps(result))
        self.assertNotIn("timeStamp", json.dumps(result))

    def test_matching_reports_one_second_apart_keep_the_same_event_identity(self):
        original = state((6.3,))
        for skew in (-1, 1):
            raw = fixture((6.3,))
            raw["result"]["dps"][1]["timeStamp"] += skew
            with self.subTest(skew=skew):
                result = sync.decode_snapshot(raw, DEVICE_HASH)
                self.assertEqual(result, original)
                self.assertEqual(sync.merge_state(original, result), original)

    def test_one_second_skew_across_midnight_keeps_the_text_reports_day(self):
        raw = fixture((6.3,))
        text, binary = raw["result"]["dps"]
        stamp = int(dt.datetime.fromisoformat("2026-10-24T23:59:59+08:00").timestamp())
        text["timeStamp"] = binary["timeStamp"] = stamp
        original = sync.decode_snapshot(raw, DEVICE_HASH)
        binary["timeStamp"] += 1
        result = sync.decode_snapshot(raw, DEVICE_HASH)
        self.assertEqual(result, original)
        self.assertEqual(next(iter(result["events"].values()))["date"], "2026-10-24")

    def test_skew_does_not_accept_mismatched_distant_or_ambiguous_reports(self):
        cases = []
        raw = fixture((6.3,)); raw["result"]["dps"][1]["timeStamp"] += 2; cases.append(raw)
        raw = fixture((6.3,)); raw["result"]["dps"][1]["timeStamp"] += 1
        raw["result"]["dps"][0]["value"] = raw["result"]["dps"][0]["value"].replace("6300", "6200"); cases.append(raw)
        for index in (0, 1):
            raw = fixture((6.3,))
            duplicate = copy.deepcopy(raw["result"]["dps"][index])
            duplicate["timeStamp"] += 1
            raw["result"]["dps"].append(duplicate)
            raw["result"]["total"] += 1
            cases.append(raw)
        for index, raw in enumerate(cases):
            with self.subTest(case=index), self.assertRaises(sync.P7DataError):
                sync.decode_snapshot(raw, DEVICE_HASH)

    def test_incomplete_pagination_missing_pairs_and_conflicts_fail_closed(self):
        cases = []
        raw = fixture(); raw["result"]["hasNext"] = True; cases.append(raw)
        raw = fixture(); raw["result"]["dps"].pop(); raw["result"]["total"] -= 1; cases.append(raw)
        raw = fixture(); raw["result"]["dps"][0]["value"] = raw["result"]["dps"][0]["value"].replace("6300", "6200"); cases.append(raw)
        raw = fixture(); raw["result"]["dps"].append({**raw["result"]["dps"][0], "value": "conflict"}); raw["result"]["total"] += 1; cases.append(raw)
        for raw in cases:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                sync.decode_snapshot(raw, DEVICE_HASH)

    def test_low_errors_and_isolated_mad_outlier_do_not_affect_median_or_visits(self):
        record = state((1.731, 2.006, 2.928, 6.3, 6.31, 6.32, 6.29, 6.7, 4.7, 5.0, 4.8))
        public, audit = sync.summarize(record, rules())
        sync.validate_public(public)
        self.assertEqual(public["quality"], {"total": 11, "kept": 7, "excluded": 4, "outsideRange": 3, "madOutliers": 1})
        self.assertEqual(public["cats"]["tangyuan"]["daily"], [{"date": "2026-10-25", "kg": 6.305, "samples": 4}])
        self.assertEqual(public["cats"]["tangyuan"]["latestMeasurement"]["kg"], 6.29)
        self.assertEqual(public["cats"]["doubao"]["visits7d"], 3)
        self.assertEqual({r["reason"] for r in audit["rejected"]}, {"outside_profile_range", "mad_outlier"})

    def test_cloud_retention_does_not_delete_history_or_double_count_overlap(self):
        previous = state(day="2026-10-18", fetched="2026-10-18T12:00:00+00:00")
        current = state()
        merged = sync.merge_state(previous, current)
        self.assertEqual(sync.merge_state(merged, current), merged)
        public, _ = sync.summarize(merged, rules())
        self.assertEqual([r["date"] for r in public["cats"]["tangyuan"]["daily"]], ["2026-10-18", "2026-10-25"])
        self.assertEqual(public["cats"]["tangyuan"]["visits7d"], 1)
        for bad in (previous, {**current, "deviceHash": "a" * 64}):
            with self.assertRaises(ValueError):
                sync.merge_state(merged, bad)

    def test_disclosure_and_consistency_checks_before_publication(self):
        record = state()
        public = sync.summarize(record, rules())[0]
        for target in ("root", "cat", "daily", "count"):
            bad = copy.deepcopy(public)
            if target == "root": bad["sid"] = "private-canary"
            if target == "cat": bad["cats"]["doubao"]["account"] = "private-canary"
            if target == "daily": bad["cats"]["doubao"]["daily"][0]["email"] = "private-canary"
            if target == "count": bad["cats"]["doubao"]["daily"][0]["samples"] = 999
            with self.subTest(target=target), self.assertRaises(ValueError):
                sync.validate_public(bad)
        with self.assertRaises(ValueError):
            sync.validate_state({**record, "sid": "private-canary"})

    def test_collection_failures_preserve_previous_output_and_report_only_confirmed_expiry(self):
        for error, code, reauth in ((client.P7AuthExpired("private-canary"), 2, True),
                                    (client.P7TransientError("private-canary"), 1, False),
                                    (sync.P7DataError("private-canary"), 1, False),
                                    (sync.P7DataError("P7 visit is missing its matching representation."), 1, False)):
            with tempfile.TemporaryDirectory() as tmp:
                folder = Path(tmp)
                good = folder / "p7-summary.json"
                good.write_text("previous-snapshot")
                env = {"GITHUB_OUTPUT": str(folder / "outputs"), "GITHUB_STEP_SUMMARY": str(folder / "summary"), "GITHUB_ACTIONS": "false"}
                stderr = io.StringIO()
                with patch.dict(os.environ, env), patch.object(client.P7Client, "from_environment", side_effect=error), \
                     patch("sys.argv", ["p7_sync", "sync", "--rules", str(ROOT / "config/p7-rules.json"), "--output-dir", str(folder)]), \
                     patch("sys.stderr", stderr), self.assertRaises(SystemExit) as result:
                    sync.main()
                self.assertEqual(result.exception.code, code)
                self.assertEqual(good.read_text(), "previous-snapshot")
                self.assertIn(f"reauth_required={str(reauth).lower()}", (folder / "outputs").read_text())
                self.assertNotIn("private-canary", stderr.getvalue() + (folder / "summary").read_text())
                if str(error) in sync.PAIRING_ERRORS:
                    self.assertIn("P7 data validation: " + str(error), stderr.getvalue())


class ClientTests(unittest.TestCase):
    def make(self, transport, session=None):
        profile = {key: "synthetic-" + key for key in ("certificate_sha256", "bmp_component", "app_secret", "app_version", "sdk_version", "client_id", "install_id", "ttid", "ch_key")}
        profile.update(package_name="com.petsee", signing_mode="pkg_cert_bmp_secret")
        return client.P7Client(profile, session or {"sid": "synthetic-session"}, "synthetic-device", transport=transport, sleep=Mock())

    def test_only_verified_endpoint_and_history_action_receive_credentials(self):
        transport = Mock(return_value=fixture())
        api = self.make(transport)
        api.history(dt.datetime(2026, 10, 25, 12, tzinfo=dt.timezone.utc))
        endpoint, params = transport.call_args.args
        self.assertEqual(endpoint, "https://a1.tuyacn.com/api.json")
        self.assertEqual(params["a"], client.ACTION)
        self.assertEqual(params["sid"], "synthetic-session")
        self.assertEqual(len(params["sign"]), 64)
        query = json.loads(params["postData"])
        self.assertEqual(query["dpIds"], "107,109")
        self.assertEqual(query["devId"], "synthetic-device")
        self.assertEqual(dt.datetime.fromtimestamp(int(query["startTime"]) / 1000, sync.ZONE).isoformat(), "2026-10-19T00:00:00+08:00")
        for host in ("https://evil.invalid", "https://a1.tuyacn.com.evil.invalid", "http://a1.tuyacn.com", "https://user:pass@a1.tuyacn.com"):
            with self.assertRaises(client.P7ClientError):
                self.make(transport, {"sid": "synthetic-session", "domain": {"mobileApiUrl": host}})
        with self.assertRaises(client.P7ClientError):
            api.page({**query, "devId": "another-device"})
        self.assertIsNone(client.NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://evil.invalid"))

    def test_auth_rejection_does_not_retry_but_network_failure_does(self):
        transport = Mock(return_value={"success": False, "errorCode": "USER_SESSION_INVALID", "message": "private-canary"})
        with self.assertRaises(client.P7AuthExpired) as result:
            self.make(transport).history()
        self.assertEqual(transport.call_count, 1)
        self.assertNotIn("private-canary", str(result.exception))
        transport = Mock(side_effect=client.P7TransientError("network"))
        with self.assertRaises(client.P7TransientError):
            self.make(transport).history()
        self.assertEqual(transport.call_count, 3)

    def test_complete_pagination_and_failure_on_changed_or_partial_results(self):
        full = fixture()
        first, second = copy.deepcopy(full), copy.deepcopy(full)
        first["result"].update(dps=full["result"]["dps"][:2], hasNext=True)
        second["result"].update(dps=full["result"]["dps"][2:])
        transport = Mock(side_effect=[first, second])
        self.assertEqual(self.make(transport).history(), {k: full[k] for k in ("success", "t", "result")})
        self.assertEqual(json.loads(transport.call_args.args[1]["postData"])["offset"], 2)
        for bad in (first, {**second, "result": {**second["result"], "total": 5}}):
            with self.assertRaises(client.P7ClientError):
                self.make(Mock(side_effect=[first, bad])).history()


if __name__ == "__main__":
    unittest.main()
