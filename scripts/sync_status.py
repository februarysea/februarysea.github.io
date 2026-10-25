"""Credential-free Actions diagnostics shared by the three data collectors."""
import os
from pathlib import Path


def report_failure(module, *, reauth=False, account=None):
    labels = {"enode": "Training (Enode)", "codex": "Codex Token", "p7": "Pets (P7)"}
    if module not in labels or account not in (None, "CODEX_AUTH_JSON", "CODEX_SECONDARY_AUTH_JSON"):
        raise ValueError("Unexpected synchronization diagnostic.")
    label = labels[module]
    if account:
        label += " / " + ("account 1" if account == "CODEX_AUTH_JSON" else "account 2")
    instructions = {
        "enode": "Sign in to One, open its history, then import the current session and update ENODE_SESSION_TOKEN.",
        "codex": "Create a fresh independent Codex login for this account and replace " + (account or "the affected auth Secret") + " in the codex-auth environment. Keep the desktop session separate.",
        "p7": "Scan a fresh PETSEE login QR and update P7_SESSION_JSON in the p7-auth environment.",
    }
    title = label + (": sign-in required" if reauth else ": synchronization failed")
    detail = instructions[module] if reauth else "Check the failed step for service, configuration, or validation errors. Login expiry has not been confirmed; do not replace credentials solely because of this failure."
    message = detail + " Previous published data is preserved. Rerun the workflow after resolving the failure."
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
            stream.write(f"reauth_required={'true' if reauth else 'false'}\n")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as stream:
            stream.write(f"## {title}\n\n{message}\n")
    if os.environ.get("GITHUB_ACTIONS") == "true":
        # Only fixed labels and allowlisted Secret names are emitted. Never errors.
        print(f"::error title={title}::{message}", flush=True)
    return title + ". " + message
