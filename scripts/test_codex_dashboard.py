import io
import json
import unittest
import urllib.error
from codex_dashboard import collect, normalize, DashboardUnavailable, NoRedirect


def payload():
    return {"units": "percent", "group_by": "day", "account_id": "private",
            "data": [{"date": "2026-11-02", "attribution": [{"thread_id": "private"}],
                      "models": [{"model": "gpt-6-astra", "speed": "fast", "credits": 21.5}]}]}


class DashboardTests(unittest.TestCase):
    def test_percent_remains_percent_and_only_allowlisted_aggregates_leave_reader(self):
        result = normalize(payload(), "2026-11-02", "2026-11-04")
        self.assertEqual(result["unit"], "percent")
        self.assertEqual(result["daily"][0]["models"][0]["usageValue"], 21.5)
        self.assertNotIn("private", json.dumps(result))
        self.assertNotIn("totalTokens", json.dumps(result))
        self.assertNotIn("estimatedUsd", json.dumps(result))
        # An omitted day remains unknown, not a fabricated zero.
        self.assertEqual(len(result["daily"]), 1)

    def test_unknown_units_bad_values_and_duplicate_dates_rejected(self):
        data = payload()
        data["units"] = "tokens"
        with self.assertRaises(ValueError): normalize(data, "2026-11-02", "2026-11-04")
        for value in (True, -1, float("nan"), float("inf")):
            data = payload()
            data["data"][0]["models"][0]["credits"] = value
            with self.assertRaises(ValueError): normalize(data, "2026-11-02", "2026-11-04")
        data = payload()
        data["data"] *= 2
        with self.assertRaises(ValueError): normalize(data, "2026-11-02", "2026-11-04")

    def test_authenticated_read_uses_fixed_destination_and_does_not_mutate_login(self):
        calls = []
        class Client:
            def open(self, request, timeout):
                calls.append(request)
                return io.BytesIO(json.dumps(payload()).encode())
        raw = json.dumps({"auth_mode": "chatgpt", "tokens": {"access_token": "secret", "account_id": "private"}})
        result = collect(raw, "2026-11-02", "2026-11-04", opener=Client())
        self.assertEqual(calls[0].get_method(), "GET")
        self.assertTrue(calls[0].full_url.startswith("https://chatgpt.com/backend-api/wham/usage/daily-token-usage-breakdown?"))
        self.assertEqual(calls[0].get_header("Authorization"), "Bearer secret")
        self.assertNotIn("secret", json.dumps(result))
        self.assertIsNone(NoRedirect().redirect_request(None, None, None, None, None, None))

    def test_permission_denial_is_reported_without_body_or_credential_disclosure(self):
        class Client:
            def open(self, request, timeout):
                raise urllib.error.HTTPError(request.full_url, 403, "private", {}, io.BytesIO(b"secret"))
        raw = json.dumps({"auth_mode": "chatgpt", "tokens": {"access_token": "secret", "account_id": "private"}})
        with self.assertRaisesRegex(DashboardUnavailable, r"^Dashboard request returned HTTP 403\.$"):
            collect(raw, "2026-11-02", "2026-11-04", opener=Client())
