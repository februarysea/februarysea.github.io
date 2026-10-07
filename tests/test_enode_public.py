"""Tests for public disclosure boundaries and training-count semantics."""

import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from enode_export import ExportError
from enode_public import build_public, export_public


CATALOG = {
    "load": {"key": "loadingMass"}, "count": {"key": "repCount"},
    "velocity": {"key": "velocityMean"},
}


def measurement(key, value, override=0):
    return {"metricID": key, "value": value, "valueUser": override}


def fixture():
    # 2026-09-30 16:30 UTC is October 1 in Shanghai.
    created = 1790785800000
    reps = []
    for i, (phase, valid, velocity) in enumerate([
        ("concentric", True, .5), ("eccentric", True, .3),
        ("concentric", False, .9), ("concentric", True, .4),
    ]):
        reps.append({
            "id": f"private-rep-{i}", "setID": "private-set", "order": i,
            "phase": phase, "valid": valid, "dataPackages": ["SENSOR-SECRET"],
            "measurements": [measurement("velocity", velocity)],
        })
    return {
        "fetchedAt": "2026-10-05T11:27:10+00:00", "timezone": "UTC",
        "fromMs": created - 86400000, "toMs": created + 86400000,
        "token": "NEVER-PUBLISH-TOKEN", "email": "private@example.invalid",
        "sessions": [{
            "id": "private-session", "created": created,
            "user": {"id": "private-user", "email": "private@example.invalid"},
            "exercise": {"id": "private-exercise", "name": "Squat"},
            "sets": [{"id": "private-set"}],
        }],
        "sets": {"private-set": {
            "id": "private-set", "sessionID": "private-session", "work": False,
            "measurements": [measurement("load", 100, 80), measurement("count", 2)],
            "reps": reps,
        }},
    }


class PublicTrainingTests(unittest.TestCase):
    def build(self, snapshot):
        return build_public(snapshot, CATALOG, {}, {})

    def test_counts_timezone_override_and_warmups(self):
        public = self.build(fixture())
        day = public["sessions"][0]
        self.assertEqual(day["date"], "2026-10-01")
        item = day["sets"][0]
        self.assertEqual((item["repCount"], item["weightKg"], item["work"]), (2, 80, False))
        self.assertEqual(item["reps"], [{"meanVelocityMps": .5}, {"meanVelocityMps": .4}])

    def test_only_allowlisted_fields_are_published(self):
        public = self.build(fixture())
        encoded = json.dumps(public)
        for forbidden in ("private-", "TOKEN", "SENSOR", "example.invalid", "measurements", "dataPackages"):
            self.assertNotIn(forbidden, encoded)
        self.assertEqual(set(public), {"schemaVersion", "timezone", "updatedAt", "coverage", "sessions"})
        self.assertEqual(set(public["sessions"][0]["sets"][0]), {"id", "exercise", "weightKg", "repCount", "work", "reps"})
        self.assertEqual(public, self.build(fixture()))

    def test_enode_count_can_differ_from_available_velocity_records(self):
        snapshot = fixture()
        snapshot["sets"]["private-set"]["measurements"][1]["value"] = 5
        item = self.build(snapshot)["sessions"][0]["sets"][0]
        self.assertEqual(item["repCount"], 5)
        self.assertEqual(len(item["reps"]), 2)

    def test_missing_load_differs_from_bodyweight_zero(self):
        snapshot = fixture()
        values = snapshot["sets"]["private-set"]["measurements"]
        values[0] = measurement("load", -99999999)
        self.assertIsNone(self.build(snapshot)["sessions"][0]["sets"][0]["weightKg"])
        values[0] = measurement("load", 0)
        self.assertEqual(self.build(snapshot)["sessions"][0]["sets"][0]["weightKg"], 0)

    def test_multiple_exercises_on_same_day_are_one_training_day(self):
        snapshot = fixture()
        session = copy.deepcopy(snapshot["sessions"][0])
        session.update(id="second-session", exercise={"name": "Bench Press"}, sets=[{"id": "second-set"}])
        detail = copy.deepcopy(snapshot["sets"]["private-set"])
        detail.update(id="second-set", sessionID="second-session", reps=[])
        snapshot["sessions"].append(session)
        snapshot["sets"]["second-set"] = detail
        self.assertEqual(len(self.build(snapshot)["sessions"]), 1)
        self.assertEqual(len(self.build(snapshot)["sessions"][0]["sets"]), 2)

    def test_invalid_input_preserves_previous_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            snapshot = fixture()
            snapshot["sets"]["private-set"]["sessionID"] = "wrong-owner"
            source, output = root / "source.json", root / "public.json"
            source.write_text(json.dumps(snapshot))
            output.write_text("previous-good-output")
            with patch("enode_public.load_catalog", return_value=(CATALOG, {}, {})):
                with self.assertRaises(ExportError):
                    export_public(source, root / "catalog.sqlite", output)
            self.assertEqual(output.read_text(), "previous-good-output")

    def test_rejects_bad_count_unknown_exercise_and_missing_catalog(self):
        for change in ("count", "exercise", "coverage"):
            with self.subTest(change=change):
                snapshot = fixture()
                if change == "count":
                    snapshot["sets"]["private-set"]["measurements"][1]["value"] = -1
                elif change == "exercise":
                    snapshot["sessions"][0]["exercise"] = {"id": "unmapped-id"}
                else:
                    snapshot["toMs"] = snapshot["fromMs"]
                with self.assertRaises(ExportError):
                    self.build(snapshot)
        with self.assertRaises(ExportError):
            build_public(fixture(), {}, {}, {})


if __name__ == "__main__":
    unittest.main()
