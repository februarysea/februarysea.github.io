import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from sync_status import report_failure


class StatusTests(unittest.TestCase):
    def test_all_modules_get_specific_recovery_instructions_without_credentials(self):
        for module, secret in (("enode", "ENODE_SESSION_TOKEN"), ("codex", "CODEX_SECONDARY_AUTH_JSON"), ("p7", "P7_SESSION_JSON")):
            with tempfile.TemporaryDirectory() as tmp:
                output, summary = Path(tmp) / "outputs", Path(tmp) / "summary"
                stdout = io.StringIO()
                with patch.dict(os.environ, {"GITHUB_ACTIONS": "true", "GITHUB_OUTPUT": str(output), "GITHUB_STEP_SUMMARY": str(summary), secret: "private-canary"}), patch("sys.stdout", stdout):
                    report_failure(module, reauth=True, account=secret if module == "codex" else None)
                self.assertIn("reauth_required=true", output.read_text())
                self.assertIn(secret, summary.read_text())
                self.assertIn("sign-in required", stdout.getvalue())
                self.assertNotIn("private-canary", stdout.getvalue() + summary.read_text())

    def test_unknown_failures_do_not_claim_login_expired(self):
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "false", "GITHUB_OUTPUT": "", "GITHUB_STEP_SUMMARY": ""}):
            result = report_failure("codex")
        self.assertIn("Login expiry has not been confirmed", result)
        self.assertNotIn("sign-in required", result)
        with self.assertRaises(ValueError): report_failure("private-canary")
        with self.assertRaises(ValueError): report_failure("codex", account="private-canary")


if __name__ == "__main__":
    unittest.main()
