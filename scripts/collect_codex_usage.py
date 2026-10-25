"""Renew isolated Codex sessions and export their combined public statistics."""
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

from codex_usage import extend_archive, timestamp, token_count, validate_snapshot
from codex_github import AUTH_ENVIRONMENT, WEBSITE_REPO, request
from sync_status import report_failure


AUTH_SECRETS = ("CODEX_AUTH_JSON", "CODEX_SECONDARY_AUTH_JSON")


class CodexAuthRequired(RuntimeError):
    def __init__(self, secret_name=None):
        super().__init__("Codex managed login requires reauthorization.")
        self.secret_name = secret_name


def is_auth_error(error):
    # Fixed messages from the pinned official client (rust-v0.162.1):
    # login/src/auth/manager.rs and account_processor/workspace_routing.rs.
    # Inspect in memory only; never forward arbitrary RPC payloads to Actions.
    if not isinstance(error, dict) or not isinstance(error.get("message"), str):
        return False
    message = error["message"]
    known = (
        "Your access token could not be refreshed because your refresh token has expired. Please log out and sign in again.",
        "Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.",
        "Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.",
        "Your access token could not be refreshed. Please log out and sign in again.",
        "Your access token could not be refreshed because you have since logged out or signed in to another account. Please sign in again.",
        "workspace routing discovery unauthorized (401)",
    )
    return any(value in message for value in known)


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


def persist_auth(raw, expected_account, github_token, secret_name="CODEX_AUTH_JSON"):
    if secret_name not in AUTH_SECRETS:
        raise ValueError("Unexpected credential storage destination.")
    mask_auth(validate_auth(raw, expected_account))
    # Only the user-selected website environment may receive encrypted credentials.
    repository = request("/repos/" + WEBSITE_REPO, github_token)
    if repository.get("full_name") != WEBSITE_REPO:
        raise RuntimeError("Authentication storage is not the configured website repository.")
    env = dict(os.environ)
    env["GH_TOKEN"] = github_token
    for attempt in range(3):
        result = subprocess.run(["gh", "secret", "set", secret_name, "--repo", WEBSITE_REPO,
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
                if method in ("account/read", "account/usage/read") and is_auth_error(message["error"]):
                    raise CodexAuthRequired()
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
                if isinstance(account, dict) and account.get("account") is None and account.get("requiresOpenaiAuth") is True:
                    raise CodexAuthRequired()
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


def configured_accounts(environ):
    count = environ.get("CODEX_ACCOUNT_COUNT") or "1"
    if count not in ("1", "2"):
        raise ValueError("Expected one or two configured Codex accounts.")
    slots = ((AUTH_SECRETS[0], "CODEX_ACCOUNT_ID"),
             (AUTH_SECRETS[1], "CODEX_SECONDARY_ACCOUNT_ID"))
    accounts, seen = [], set()
    for secret_name, account_key in slots[:int(count)]:
        raw, account = environ.get(secret_name, ""), environ.get(account_key, "")
        validate_auth(raw, account)
        if account in seen:
            raise ValueError("Duplicate Codex accounts would double-count usage.")
        seen.add(account)
        accounts.append((secret_name, raw, account))
    return accounts


def combine_snapshots(snapshots):
    if not snapshots:
        raise ValueError("No account statistics were collected.")
    daily, total = {}, 0
    for snapshot in snapshots:
        validate_snapshot(snapshot)
        total = token_count(total + snapshot["totalTokens"])
        for bucket in snapshot["daily"]:
            day = bucket["date"]
            daily[day] = token_count(daily.get(day, 0) + bucket["totalTokens"])
    # Use the oldest capture so the aggregate never claims a newer full refresh.
    captured_at = min(snapshots, key=lambda item: timestamp(item["generatedAt"]))["generatedAt"]
    return validate_snapshot({"version": 1, "source": "codex-profile-service",
                              "generatedAt": captured_at, "totalTokens": total,
                              "daily": [{"date": day, "totalTokens": value}
                                        for day, value in sorted(daily.items())]})


def collect_accounts(environ, *, collector=collect, persist=persist_auth):
    # Validate every configured account before any session can rotate.
    accounts = configured_accounts(environ)
    github_token = environ["GH_TOKEN"]
    snapshots = []
    for secret_name, raw, account in accounts:
        def save(value, account_id=account, destination=secret_name):
            persist(value, account_id, github_token, secret_name=destination)
        try:
            snapshots.append(collector(raw, account, save))
        except CodexAuthRequired:
            raise CodexAuthRequired(secret_name) from None
    # A failure in any account prevents a partial aggregate from being exported.
    return combine_snapshots(snapshots)


def collect_after_archive(environ, archive, previous, *, collect_live=collect_accounts):
    validate_snapshot(archive)
    validate_snapshot(previous)
    # An old repository variable or leftover second-account Secret cannot
    # reactivate the retired account. Only the original slot is passed onward.
    primary_env = {key: environ[key] for key in ("CODEX_AUTH_JSON", "CODEX_ACCOUNT_ID", "GH_TOKEN") if key in environ}
    primary_env["CODEX_ACCOUNT_COUNT"] = "1"
    return extend_archive(archive, collect_live(primary_env), previous)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--previous", type=Path)
    args = parser.parse_args()
    try:
        if bool(args.archive) != bool(args.previous):
            raise ValueError("Archive mode requires both the fixed archive and previous public snapshot.")
        snapshot = collect_after_archive(os.environ, json.loads(args.archive.read_text()), json.loads(args.previous.read_text())) if args.archive else collect_accounts(os.environ)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(snapshot, indent=2, allow_nan=False) + "\n")
        temporary.replace(args.output)
        print(f"Saved public statistics for {len(snapshot['daily'])} days; managed auth persisted in encrypted environment storage.")
    except (OSError, ValueError, TypeError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        expired = isinstance(error, CodexAuthRequired)
        message = report_failure("codex", reauth=expired, account=error.secret_name if expired else None)
        parser.exit(2 if expired else 1, message + "\n")


if __name__ == "__main__":
    main()
