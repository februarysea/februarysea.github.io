import base64
import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from codex_github import APIError
from openai_usage import collect, validate_snapshot, validate_update
from persist_openai_usage import publish

EMPTY = {"version": 1, "source": "openai-organization-completions", "generatedAt": None,
         "startDate": None, "throughDate": None, "daily": []}
NOW = datetime(2026, 11, 3, 0, tzinfo=timezone.utc)


def bucket(day, rows=None):
    start = int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp())
    return {"object": "bucket", "start_time": start, "end_time": start + 86400,
            "results": rows if rows is not None else [
                {"object": "organization.usage.completions.result", "model": "example-model",
                 "input_tokens": 100, "input_cached_tokens": 80, "output_tokens": 20,
                 "num_model_requests": 2, "project_id": "private-project", "api_key_id": "private-key"}]}


def page(*buckets, cursor=None):
    return {"object": "page", "data": list(buckets), "has_more": cursor is not None, "next_page": cursor}


def sample():
    return collect(EMPTY, "2026-11-01", "private-admin-key", now=NOW,
                   api=lambda *_: page(bucket("2026-11-01"), bucket("2026-11-02")))


class CollectionTests(unittest.TestCase):
    def test_pagination_allowlist_and_cached_input_not_added_twice(self):
        calls = []
        def api(params, key):
            calls.append(params)
            self.assertEqual(key, "private-admin-key")
            return (page(bucket("2026-11-01"), cursor="page2") if len(calls) == 1 else
                    page(bucket("2026-11-02", [])))
        result = collect(EMPTY, "2026-11-01", "private-admin-key", now=NOW, api=api)
        self.assertEqual(calls[0]["group_by"], ["model"])
        self.assertEqual(calls[1]["page"], "page2")
        self.assertEqual(calls[0]["end_time"], int(NOW.replace(hour=0).timestamp()))
        model = result["daily"][0]["models"][0]
        self.assertEqual(model["inputTokens"] + model["outputTokens"], 120)
        self.assertEqual(model["cachedInputTokens"], 80)
        self.assertEqual(result["daily"][1]["models"], [])
        self.assertNotIn("private", json.dumps(result))

    def test_current_day_is_included_with_partial_bucket(self):
        now = NOW.replace(hour=12)
        today = bucket("2026-11-03")
        today["end_time"] = int(now.timestamp())
        result = collect(EMPTY, "2026-11-03", "key", now=now,
                         api=lambda *_: page(today))
        self.assertEqual(result["throughDate"], "2026-11-03")
        self.assertEqual(result["daily"][0]["models"][0]["inputTokens"], 100)

    def test_repeated_collection_replaces_instead_of_accumulating(self):
        prior = sample()
        corrected = bucket("2026-11-01")
        corrected["results"][0]["output_tokens"] = 7
        current = collect(prior, "2026-11-01", "key", now=NOW,
                          api=lambda *_: page(corrected, bucket("2026-11-02")))
        self.assertEqual(len(current["daily"]), 2)
        self.assertEqual(current["daily"][0]["models"][0]["outputTokens"], 7)
        self.assertEqual(prior["daily"][0]["models"][0]["outputTokens"], 20)

    def test_model_grouping_null_model_and_sorting(self):
        b = bucket("2026-11-01")
        b["results"].append(dict(b["results"][0]))
        b["results"].append({**b["results"][0], "model": None})
        result = collect(EMPTY, "2026-11-01", "key", now=NOW,
                         api=lambda *_: page(b, bucket("2026-11-02", [])))
        self.assertEqual([r["model"] for r in result["daily"][0]["models"]],
                         ["example-model", "unclassified"])
        self.assertEqual(result["daily"][0]["models"][0]["inputTokens"], 200)

    def test_missing_duplicate_partial_and_wrong_type_buckets_rejected(self):
        invalid = [page(bucket("2026-11-01")),
                   page(bucket("2026-11-01"), bucket("2026-11-01")),
                   page({**bucket("2026-11-01"), "end_time": 0}, bucket("2026-11-02")),
                   page(bucket("2026-11-01", [{"object": "organization.usage.images.result"}]), bucket("2026-11-02")),
                   {"object": "page", "data": [], "has_more": "false"}]
        for response in invalid:
            with self.subTest(response=response), self.assertRaises(ValueError):
                collect(EMPTY, "2026-11-01", "key", now=NOW, api=lambda *_: response)

    def test_cycle_in_pagination_rejected(self):
        calls = []
        def api(*_):
            calls.append(1)
            return page(cursor="same")
        with self.assertRaises(ValueError):
            collect(EMPTY, "2026-11-01", "key", now=NOW, api=api)
        self.assertEqual(len(calls), 2)

    def test_counts_reject_boolean_negative_overflow_and_invalid_cache(self):
        for key, value in [("input_tokens", True), ("output_tokens", -1),
                           ("output_tokens", 2**53), ("input_cached_tokens", 101)]:
            b = bucket("2026-11-01")
            b["results"][0][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                collect(EMPTY, "2026-11-01", "key", now=NOW,
                        api=lambda *_: page(b, bucket("2026-11-02")))

    def test_no_key_or_future_start_never_queries(self):
        def api(*_):
            self.fail("should not query")
        for start, key in [("2026-11-03", "key"), ("2026-11-01", ""), (None, "key")]:
            with self.assertRaises(ValueError):
                collect(EMPTY, start, key, now=NOW, api=api)

    def test_incremental_collection_retains_older_days_and_full_audit_requeries_them(self):
        from datetime import timedelta
        start = datetime(2026, 9, 1, tzinfo=timezone.utc)
        all_buckets = [bucket((start + timedelta(days=i)).date().isoformat(), []) for i in range(63)]
        prior = collect(EMPTY, "2026-09-01", "key", now=NOW, api=lambda params, _: page(*(b for b in all_buckets if params["start_time"] <= b["start_time"] < params["end_time"])))
        calls = []
        def api(params, _):
            calls.append(params)
            return page(*(b for b in all_buckets if params["start_time"] <= b["start_time"] < params["end_time"]))
        current = collect(prior, "2026-09-01", "key", now=NOW, api=api)
        self.assertEqual(current, prior)
        self.assertEqual(datetime.fromtimestamp(calls[-1]["start_time"], timezone.utc).date().isoformat(), "2026-10-31")
        calls.clear()
        collect(prior, "2026-09-01", "key", now=NOW, api=api, full=True)
        self.assertEqual(calls[0]["start_time"], int(start.timestamp()))
        self.assertTrue(all(c["end_time"] - c["start_time"] <= 31 * 86400 for c in calls))

    def test_failure_preserves_output_and_does_not_leak_key(self):
        with tempfile.TemporaryDirectory() as directory:
            previous, output = Path(directory)/"previous.json", Path(directory)/"out.json"
            previous.write_text(json.dumps(EMPTY))
            output.write_text("preserved")
            import os
            env = {**os.environ, "OPENAI_USAGE_ADMIN_KEY": "private-sentinel"}
            result = subprocess.run([sys.executable, str(Path(__file__).with_name("openai_usage.py")),
                                     "collect", "--previous", str(previous), "--snapshot", str(output),
                                     "--start-date", "invalid"], env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(output.read_text(), "preserved")
            self.assertNotIn("private-sentinel", result.stdout + result.stderr)


class SnapshotTests(unittest.TestCase):
    def test_only_exact_public_fields_are_accepted(self):
        for change in [lambda s:s.update(apiKey="private"),
                       lambda s:s["daily"][0].update(threadId="private"),
                       lambda s:s["daily"][0]["models"][0].update(project_id="private")]:
            snapshot = sample()
            change(snapshot)
            with self.assertRaises(ValueError):
                validate_snapshot(snapshot)

    def test_no_coverage_regression_or_unknown_zero(self):
        self.assertEqual(validate_snapshot(copy.deepcopy(EMPTY)), EMPTY)
        for update in [EMPTY, {**sample(), "generatedAt": "2026-11-01T00:00:00Z"},
                       {**sample(), "daily": []}, {**sample(), "startDate": "2026-10-01"}]:
            with self.assertRaises(ValueError):
                validate_update(sample(), update)

    def test_unsorted_or_duplicate_models_rejected(self):
        snapshot = sample()
        snapshot["daily"][0]["models"] *= 2
        with self.assertRaises(ValueError):
            validate_snapshot(snapshot)


class PersistTests(unittest.TestCase):
    def test_persist_exact_snapshot_and_revalidate_on_conflict(self):
        calls = []
        writes = []
        current = sample()
        def api(path, token, **kwargs):
            calls.append(path)
            self.assertEqual(token, "github-token")
            if not kwargs:
                return {"encoding": "base64", "sha": "rev" + str(len(calls)),
                        "content": base64.b64encode(json.dumps(EMPTY).encode()).decode()}
            writes.append(kwargs["payload"])
            if len(writes) == 1:
                raise APIError(409)
            return {"commit": {"sha": "saved"}}
        with patch("persist_openai_usage.time.sleep"):
            self.assertEqual(publish(current, "github-token", api), "saved")
        self.assertNotEqual(writes[0]["sha"], writes[1]["sha"])
        self.assertEqual(json.loads(base64.b64decode(writes[1]["content"])), current)
        self.assertEqual(writes[1]["branch"], "master")

    def test_unchanged_snapshot_does_not_write(self):
        current = sample()
        def api(path, token, **kwargs):
            self.assertFalse(kwargs)
            return {"encoding": "base64", "sha": "same",
                    "content": base64.b64encode(json.dumps(current).encode()).decode()}
        self.assertIsNone(publish(current, "token", api))


if __name__ == "__main__":
    unittest.main()
