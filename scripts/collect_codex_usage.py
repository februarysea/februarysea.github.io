"""Renew an isolated Codex session, persist it, and export only public statistics."""
import argparse
import json
import os
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timezone

from codex_usage import token_count, validate_snapshot
from codex_github import AUTH_ENVIRONMENT, WEBSITE_REPO, request


def validate_auth(raw, expected_account):
    auth = json.loads(raw)
    if not isinstance(auth, dict) or auth.get("auth_mode") != "chatgpt":
        raise ValueError("An independent managed ChatGPT login is required.")
    tokens = auth.get("tokens")
    if not isinstance(tokens, dict) or any(not isinstance(tokens.get(key), str) or not tokens[key]
                                          for key in ("access_token", "refresh_token", "id_token", "account_id")):
        raise ValueError("The managed login is incomplete.")
    if not expected_account or tokens["account_id"] != expected_account:
        raise ValueError("The login does not match the configured account.")
    return auth


def mask_auth(auth):
    if os.environ.get("GITHUB_ACTIONS") == "true":
        for value in auth["tokens"].values():
            if isinstance(value, str) and value:
                # Escape workflow-command characters before registering a mask.
                value = value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
                print("::add-mask::" + value, flush=True)


def persist_auth(raw, expected_account, github_token):
    mask_auth(validate_auth(raw, expected_account))
    # Only the user-selected website environment may receive encrypted credentials.
    repository = request("/repos/" + WEBSITE_REPO, github_token)
    if repository.get("full_name") != WEBSITE_REPO:
        raise RuntimeError("Authentication storage is not the configured website repository.")
    env = dict(os.environ)
    env["GH_TOKEN"] = github_token
    for attempt in range(3):
        result = subprocess.run(["gh", "secret", "set", "CODEX_AUTH_JSON", "--repo", WEBSITE_REPO,
                                 "--env", AUTH_ENVIRONMENT], input=raw, text=True,
                                capture_output=True, env=env, timeout=45)
        if result.returncode == 0:
            return
        if attempt < 2:
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError("Could not persist the refreshed login; publishing is stopped.")


class CodexRPC:
    def __init__(self, binary, codex_home, timeout=90):
        self.timeout = timeout
        self.sequence = 0
        self.messages = queue.Queue()
        # Do not pass GitHub credentials or the original auth JSON to Codex's environment.
        env = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR")
               if key in os.environ}
        env["CODEX_HOME"] = str(codex_home)
        self.proc = subprocess.Popen([binary, "app-server"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL, env=env, cwd=codex_home)
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _read(self):
        try:
            while True:
                line = self.proc.stdout.readline(4 * 1024 * 1024 + 1)
                if not line or len(line) > 4 * 1024 * 1024:
                    break
                self.messages.put(json.loads(line))
        except (OSError, ValueError):
            pass
        finally:
            self.messages.put(None)

    def _send(self, message):
        self.proc.stdin.write((json.dumps(message) + "\n").encode())
        self.proc.stdin.flush()

    def call(self, method, params=None):
        self.sequence += 1
        request_id = self.sequence
        self._send({"id": request_id, "method": method, "params": params or {}})
        deadline = time.monotonic() + self.timeout
        while True:
            try:
                message = self.messages.get(timeout=max(0, deadline - time.monotonic()))
            except queue.Empty:
                raise RuntimeError("Codex account request timed out.") from None
            if message is None:
                raise RuntimeError("Codex account connection ended.")
            if message.get("id") != request_id:
                continue
            if "error" in message:
                # Error payloads may contain upstream credentials or account details.
                raise RuntimeError("Codex account request failed: " + method)
            if "result" not in message:
                raise RuntimeError("Codex returned an invalid response.")
            return message["result"]

    def __enter__(self):
        try:
            self.call("initialize", {"clientInfo": {"name": "codex_usage_sync", "title": "Usage sync", "version": "1.0.0"}})
            self._send({"method": "initialized", "params": {}})
        except BaseException:
            self.close()
            raise
        return self

    def close(self):
        if self.proc.stdin and not self.proc.stdin.closed:
            self.proc.stdin.close()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait()
        self.reader.join(timeout=1)
        self.proc.stdout.close()

    def __exit__(self, *args):
        self.close()


def normalize_usage(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("summary"), dict):
        raise ValueError("Codex did not return a usage summary.")
    total = token_count(payload["summary"].get("lifetimeTokens"))
    buckets = payload.get("dailyUsageBuckets")
    if not isinstance(buckets, list):
        raise ValueError("Daily usage is unavailable; preserving the website snapshot.")
    daily = {}
    for bucket in buckets:
        if not isinstance(bucket, dict) or not isinstance(bucket.get("startDate"), str):
            raise ValueError("Invalid daily usage bucket.")
        day = bucket["startDate"]
        daily[day] = daily.get(day, 0) + token_count(bucket.get("tokens"))
    return validate_snapshot({"version": 1, "source": "codex-profile-service",
                              "generatedAt": datetime.now(timezone.utc).isoformat(),
                              "totalTokens": total,
                              "daily": [{"date": day, "totalTokens": count} for day, count in sorted(daily.items())]})


def collect(raw_auth, account_id, persist, binary="codex", rpc_factory=CodexRPC):
    mask_auth(validate_auth(raw_auth, account_id))
    # Prove write-back works before allowing refresh-token rotation.
    persist(raw_auth)
    with tempfile.TemporaryDirectory(prefix="codex-usage-auth-") as directory:
        home = Path(directory)
        home.chmod(0o700)
        auth_path = home / "auth.json"
        auth_path.touch(mode=0o600)
        auth_path.write_text(raw_auth)
        (home / "config.toml").write_text('cli_auth_credentials_store = "file"\n')
        try:
            with rpc_factory(binary, home) as rpc:
                account = rpc.call("account/read", {"refreshToken": True})
                if not isinstance(account, dict) or (account.get("account") or {}).get("type") != "chatgpt":
                    raise ValueError("Codex did not load a managed ChatGPT session.")
                # Persist immediately after refresh, before any usage service request.
                refreshed = auth_path.read_text()
                validate_auth(refreshed, account_id)
                persist(refreshed)
                payload = rpc.call("account/usage/read")
        finally:
            # Also cover an additional refresh during the usage request or an upstream error.
            if auth_path.exists():
                latest = auth_path.read_text()
                validate_auth(latest, account_id)
                persist(latest)
        return normalize_usage(payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        raw = os.environ["CODEX_AUTH_JSON"]
        account = os.environ["CODEX_ACCOUNT_ID"]
        github_token = os.environ["GH_TOKEN"]
        snapshot = collect(raw, account, lambda value: persist_auth(value, account, github_token))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(snapshot, indent=2, allow_nan=False) + "\n")
        temporary.replace(args.output)
        print(f"Saved public statistics for {len(snapshot['daily'])} days; managed auth persisted in encrypted environment storage.")
    except (OSError, ValueError, TypeError, KeyError, RuntimeError, subprocess.SubprocessError):
        parser.exit(1, "Codex collection failed. Previous website data is unchanged. Check auth, secret write-back, or service availability.\n")


if __name__ == "__main__":
    main()
