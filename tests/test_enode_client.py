"""Offline safety checks using synthetic credentials and a temporary data directory."""

import base64
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import threading
import unittest
from unittest import mock
from urllib.parse import parse_qs, urlsplit


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "enode.py"
SPEC = importlib.util.spec_from_file_location("enode_client_under_test", MODULE_PATH)
enode = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(enode)


def fake_token(exp=4102444800):
    claims = json.dumps({"uid": "fake-user", "exp": exp}).encode()
    payload = base64.urlsafe_b64encode(claims).decode().rstrip("=")
    return "fake-header." + payload + ".fake-signature"


class EnodeClientTests(unittest.TestCase):
    def setUp(self):
        environment = mock.patch.dict(os.environ, {
            "GITHUB_ACTIONS": "false", "ENODE_SESSION_TOKEN": "", "ENODE_API_KEY": "",
            "ENODE_DEVICE_ID": "", "ENODE_DEVICE_NAME": "",
        })
        environment.start()
        self.addCleanup(environment.stop)
        temporary = tempfile.TemporaryDirectory(prefix="enode-test-")
        self.addCleanup(temporary.cleanup)
        self.private = Path(temporary.name) / "private-\u6d4b\u8bd5"
        private_patch = mock.patch.object(enode, "PRIVATE", self.private)
        private_patch.start()
        self.addCleanup(private_patch.stop)
        self.token = fake_token()
        self.api_key = 'fake-api-key-\u96ea"\\tail'
        enode.save("client.json", {
            "deviceId": "fake-device",
            "apiKey": self.api_key,
            "email": "fake@example.invalid",
        })
        enode.save("session.json", {"token": self.token})
        self.requests = []

    def curl_response(self, status=200, body='{"ok": true}', returncode=0):
        def run(argv, **kwargs):
            config_path = Path(argv[argv.index("--config") + 1])
            options = {}
            for line in config_path.read_text().splitlines():
                key, separator, value = line.partition(" = ")
                options.setdefault(key, []).append(json.loads(value) if separator else True)
            self.requests.append((argv, options))
            self.assertEqual(argv[:2], ["curl", "-q"])
            self.assertFalse({"-L", "--location", "--location-trusted"}.intersection(argv))
            self.assertFalse({"location", "location-trusted"}.intersection(options))
            self.assertEqual(options["proto"], ["=https"])
            self.assertEqual(stat.S_IMODE(config_path.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(config_path.parent.stat().st_mode), 0o700)
            self.assertTrue(kwargs["capture_output"])
            Path(options["output"][0]).write_text(body)
            return subprocess.CompletedProcess(
                argv, returncode, str(status), "simulated transport failure" if returncode else ""
            )
        return run

    def assert_request_files_cleaned(self):
        self.assertEqual(list(self.private.glob("request-*")), [])

    def test_auth_modes_keep_credentials_out_of_argv(self):
        basic = enode.b64("fake@example.invalid:123456")
        cases = (
            ({"auth": False}, None),
            ({"basic": basic, "auth": False}, "Basic " + basic),
            ({}, "Bearer " + self.token),
        )
        for arguments, expected in cases:
            with self.subTest(authorization=expected and expected.split()[0]):
                with mock.patch.object(enode.subprocess, "run", side_effect=self.curl_response()):
                    enode.request("/synthetic-endpoint", **arguments)
                argv, options = self.requests[-1]
                headers = dict(value.split(": ", 1) for value in options["header"])
                self.assertEqual(headers.get("Authorization"), expected)
                self.assertEqual(headers["api-key"], self.api_key)
                for secret in (self.token, basic, self.api_key):
                    self.assertNotIn(secret, " ".join(argv))
                self.assert_request_files_cleaned()

    def test_actions_requires_secrets_even_if_local_credentials_exist(self):
        with mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}), \
             mock.patch.object(enode.subprocess, "run") as run:
            with self.assertRaisesRegex(enode.EnodeError, "missing"):
                enode.session_token()
            with self.assertRaisesRegex(enode.EnodeError, "missing"):
                enode.request("/synthetic-endpoint")
            run.assert_not_called()

    def test_actions_uses_individual_env_secrets_without_reading_local_files(self):
        cloud_token = fake_token(exp=4102444801)
        env = {"GITHUB_ACTIONS": "true", "ENODE_SESSION_TOKEN": cloud_token,
               "ENODE_API_KEY": "synthetic-cloud-api", "ENODE_DEVICE_ID": "synthetic-cloud-device",
               "ENODE_DEVICE_NAME": "synthetic-cloud-name"}
        with mock.patch.dict(os.environ, env), \
             mock.patch.object(enode, "read", side_effect=AssertionError("Local credentials read")), \
             mock.patch.object(enode.subprocess, "run", side_effect=self.curl_response()):
            enode.request("/synthetic-endpoint")
        argv, options = self.requests[-1]
        headers = dict(value.split(": ", 1) for value in options["header"])
        self.assertEqual(headers["Authorization"], "Bearer " + cloud_token)
        self.assertEqual(headers["api-key"], env["ENODE_API_KEY"])
        self.assertEqual(headers["device-name"], env["ENODE_DEVICE_NAME"])
        self.assertFalse(any(value in " ".join(argv) for value in env.values()))
        self.assert_request_files_cleaned()

    def test_http_failures_do_not_retry_or_replace_session(self):
        previous = (self.private / "session.json").read_bytes()
        for status in (314, 401):
            with self.subTest(status=status):
                with mock.patch.object(enode.subprocess, "run", side_effect=self.curl_response(status)) as run:
                    with self.assertRaisesRegex(enode.EnodeError, f"HTTP {status}"):
                        enode.request("/synthetic-endpoint")
                    run.assert_called_once()
                self.assertEqual((self.private / "session.json").read_bytes(), previous)
                self.assert_request_files_cleaned()

    def test_expired_token_stops_before_network(self):
        enode.save("session.json", {"token": fake_token(exp=1)})
        with mock.patch.object(enode.subprocess, "run") as run:
            with self.assertRaises(enode.EnodeError):
                enode.request("/synthetic-endpoint")
            run.assert_not_called()

    def test_malformed_or_empty_json_is_rejected_by_default(self):
        for status, body in ((200, "<html>Sign in</html>"), (200, ""), (204, "")):
            with self.subTest(status=status, body=body):
                with mock.patch.object(enode.subprocess, "run", side_effect=self.curl_response(status, body)):
                    with self.assertRaises(enode.EnodeError):
                        enode.request("/synthetic-endpoint")
                self.assert_request_files_cleaned()

    def test_invalid_profile_or_scope_preserves_last_good_file(self):
        for command, filename in (("profile", "profile.json"), ("scope", "history-scope.json")):
            enode.save(filename, {"lastGood": "synthetic-data"})
            previous = (self.private / filename).read_bytes()
            failures = ({"return_value": None}, {"return_value": "unexpected scalar"},
                        {"side_effect": enode.EnodeError("HTTP 403")})
            for failure in failures:
                with self.subTest(command=command, failure=failure):
                    with mock.patch.object(enode.sys, "argv", ["enode.py", command]), \
                         mock.patch.object(enode, "request", **failure), \
                         contextlib.redirect_stdout(io.StringIO()):
                        with self.assertRaises(enode.EnodeError):
                            enode.main()
                    self.assertEqual((self.private / filename).read_bytes(), previous)

    def test_save_is_private_and_serialization_failure_preserves_previous(self):
        enode.save("snapshot.json", {"version": 1})
        snapshot = self.private / "snapshot.json"
        self.assertEqual(stat.S_IMODE(self.private.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(snapshot.stat().st_mode), 0o600)
        previous = snapshot.read_bytes()
        with self.assertRaises(TypeError):
            enode.save("snapshot.json", {"notJsonSerializable": {1, 2}})
        self.assertEqual(snapshot.read_bytes(), previous)
        self.assertEqual(list(self.private.glob(".pending-*")), [])
        enode.save("snapshot.json", {"version": 2})
        self.assertEqual(enode.read("snapshot.json"), {"version": 2})
        self.assertEqual(stat.S_IMODE(snapshot.stat().st_mode), 0o600)

    def test_network_failure_cleans_temporary_files_without_replacing_session(self):
        previous = (self.private / "session.json").read_bytes()
        with mock.patch.object(enode.subprocess, "run", side_effect=self.curl_response(returncode=60)) as run:
            with self.assertRaises(enode.EnodeError):
                enode.request("/synthetic-endpoint")
            run.assert_called_once()
        self.assertEqual((self.private / "session.json").read_bytes(), previous)
        self.assert_request_files_cleaned()

    def native_fixture(self):
        start = 1700000000000
        week = 7 * 86400000
        summaries = [
            {"id": "session-a", "user": {"id": "FAKE-USER"},
             "created": start + week, "exercise": {"id": "exercise-a"}},
            {"id": "session-b", "user": {"id": "fake-user"},
             "created": start + week + 86400000, "exercise": {"id": "exercise-b"}},
        ]
        foreign = {**summaries[0], "id": "foreign-session", "user": {"id": "another-user"}}
        routes = {}
        for suffix, summary in zip(("a", "b"), summaries):
            set_id = "set-" + suffix
            routes["/workout_sessions/" + summary["id"]] = {
                "id": summary["id"], "user": summary["user"], "created": summary["created"],
                "sets": [{"id": set_id, "sessionID": summary["id"]}],
            }
            routes["/workout_sets/" + set_id] = {
                "id": set_id, "sessionID": summary["id"],
                "reps": [{"id": "rep-" + suffix + "-" + str(phase), "setID": set_id,
                          "phase": phase, "measurements": [{"type": "synthetic", "value": 0.5}]}
                         for phase in (1, 2)],
            }

        def request(path, **kwargs):
            parsed = urlsplit(path)
            if parsed.path == "/workout_sessions":
                window_start = int(parse_qs(parsed.query)["from"][0])
                # An inclusive boundary repeats session-a in the second window.
                return copy.deepcopy([summaries[0], foreign] if window_start == start else summaries)
            if parsed.path not in routes:
                raise AssertionError("Unexpected native request: " + parsed.path)
            return copy.deepcopy(routes[parsed.path])

        return start, start + 2 * week, routes, request

    def test_native_windows_deduplicate_filter_owner_and_preserve_phase_records(self):
        start, end, routes, request = self.native_fixture()
        with mock.patch.object(enode, "request", side_effect=request) as calls, \
             contextlib.redirect_stdout(io.StringIO()):
            enode.fetch_native_history(start, end)
        snapshot = enode.read("training-latest.json")
        self.assertEqual([session["id"] for session in snapshot["sessions"]], ["session-a", "session-b"])
        self.assertEqual(set(snapshot["sets"]), {"set-a", "set-b"})
        self.assertEqual(snapshot["sets"]["set-a"]["reps"], routes["/workout_sets/set-a"]["reps"])
        self.assertEqual([rep["phase"] for rep in snapshot["sets"]["set-a"]["reps"]], [1, 2])
        paths = [call.args[0] for call in calls.call_args_list]
        self.assertEqual(paths.count("/workout_sessions/session-a"), 1)
        self.assertEqual(paths.count("/workout_sets/set-a"), 1)
        self.assertFalse(any("foreign-session" in path for path in paths))
        windows = [parse_qs(urlsplit(path).query) for path in paths
                   if urlsplit(path).path == "/workout_sessions"]
        self.assertEqual(len(windows), 2)
        self.assertEqual(windows[0]["from"], [str(start)])
        self.assertEqual(windows[0]["to"], windows[1]["from"])
        self.assertEqual(windows[1]["to"], [str(end)])

    def test_native_schema_and_ownership_failures_preserve_last_good_snapshot(self):
        cases = ("session-owner", "session-user-null", "session-date-null", "set-reference-owner",
                 "set-owner", "rep-owner", "duplicate-rep", "rep-measurements")
        enode.save("training-latest.json", {"lastGood": "synthetic snapshot"})
        previous = (self.private / "training-latest.json").read_bytes()
        for case in cases:
            with self.subTest(case=case):
                start, end, routes, request = self.native_fixture()
                session = routes["/workout_sessions/session-a"]
                workout_set = routes["/workout_sets/set-a"]
                if case == "session-owner":
                    session["user"] = {"id": "another-user"}
                elif case == "session-user-null":
                    session["user"] = None
                elif case == "session-date-null":
                    session["created"] = None
                elif case == "set-reference-owner":
                    session["sets"][0]["sessionID"] = "another-session"
                elif case == "set-owner":
                    workout_set["sessionID"] = "another-session"
                elif case == "rep-owner":
                    workout_set["reps"][0]["setID"] = "another-set"
                elif case == "duplicate-rep":
                    workout_set["reps"].append(copy.deepcopy(workout_set["reps"][0]))
                elif case == "rep-measurements":
                    workout_set["reps"][0]["measurements"] = None
                with mock.patch.object(enode, "request", side_effect=request), \
                     contextlib.redirect_stdout(io.StringIO()):
                    with self.assertRaises(enode.EnodeError):
                        enode.fetch_native_history(start, end)
                self.assertEqual((self.private / "training-latest.json").read_bytes(), previous)

    def test_native_midway_failure_preserves_previous_complete_snapshot(self):
        start, end, _, request = self.native_fixture()
        first_set_fetched = threading.Event()
        enode.save("training-latest.json", {"lastGood": "synthetic snapshot"})
        previous = (self.private / "training-latest.json").read_bytes()

        def failing_request(path, **kwargs):
            if path == "/workout_sets/set-b":
                self.assertTrue(first_set_fetched.wait(timeout=2), "First set was never fetched")
                raise enode.EnodeError("Simulated second-set network failure")
            result = request(path, **kwargs)
            if path == "/workout_sets/set-a":
                first_set_fetched.set()
            return result

        with mock.patch.object(enode, "request", side_effect=failing_request), \
             contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(enode.EnodeError, "second-set"):
                enode.fetch_native_history(start, end)
        self.assertTrue(first_set_fetched.is_set())
        self.assertEqual((self.private / "training-latest.json").read_bytes(), previous)


if __name__ == "__main__":
    unittest.main()
