"""Small, fixed-destination GitHub client; never include response bodies in errors."""
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

WEBSITE_REPO = "februarysea/februarysea.github.io"
AUTH_ENVIRONMENT = "codex-auth"
SNAPSHOT_PATH = "src/data/codex-profile.json"


class APIError(RuntimeError):
    def __init__(self, status):
        self.status = status
        super().__init__(f"GitHub API returned HTTP {status}.")


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def request(path, token, *, method="GET", payload=None):
    if not path.startswith("/") or "\n" in path or "\r" in path:
        raise ValueError("Invalid GitHub API path.")
    req = urllib.request.Request("https://api.github.com" + path,
        data=None if payload is None else json.dumps(payload).encode(), method=method,
        headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "februarysea-codex-usage-sync",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.build_opener(NoRedirects()).open(req, timeout=30) as response:
            raw = response.read(4 * 1024 * 1024 + 1)
            if len(raw) > 4 * 1024 * 1024:
                raise ValueError("GitHub response exceeds the size limit.")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raise APIError(error.code) from None
    except urllib.error.URLError:
        raise RuntimeError("GitHub API connection failed.") from None


def installation_token(app_id, installation_id, private_key):
    if not re.fullmatch(r"[0-9]+", app_id) or not re.fullmatch(r"[0-9]+", installation_id):
        raise ValueError("Invalid GitHub App configuration.")
    permissions = {"environments": "write"}
    def encode(value):
        return base64.urlsafe_b64encode(value).rstrip(b"=")
    now = int(time.time())
    header = encode(b'{"alg":"RS256","typ":"JWT"}')
    claims = encode(json.dumps({"iat": now - 60, "exp": now + 540, "iss": app_id}).encode())
    message = header + b"." + claims
    with tempfile.TemporaryDirectory(prefix="usage-app-key-") as directory:
        key = Path(directory) / "app.pem"
        key.touch(mode=0o600)
        key.write_text(private_key)
        signed = subprocess.run(["openssl", "dgst", "-sha256", "-sign", str(key)],
                                input=message, capture_output=True)
        if signed.returncode:
            raise RuntimeError("GitHub App signing failed.")
    jwt = (message + b"." + encode(signed.stdout)).decode()
    response = request(f"/app/installations/{installation_id}/access_tokens", jwt, method="POST",
                       payload={"repositories": [WEBSITE_REPO.split("/")[1]], "permissions": permissions})
    token = response.get("token")
    if not isinstance(token, str) or not token:
        raise RuntimeError("GitHub did not issue an installation token.")
    return token


def revoke(token):
    request("/installation/token", token, method="DELETE")


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("purpose", choices=["auth", "revoke"])
    args = parser.parse_args()
    try:
        if args.purpose == "revoke":
            revoke(os.environ["GH_TOKEN"])
        else:
            token = installation_token(os.environ["APP_ID"], os.environ["APP_INSTALLATION_ID"],
                                       os.environ["APP_PRIVATE_KEY"])
            if os.environ.get("GITHUB_ACTIONS") != "true" or not os.environ.get("GITHUB_OUTPUT"):
                raise RuntimeError("Token output is only supported inside GitHub Actions.")
            print("::add-mask::" + token)
            with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
                stream.write("token=" + token + "\n")
    except (OSError, ValueError, KeyError, RuntimeError):
        parser.exit(1, "GitHub App operation failed; check its installation and permissions.\n")


if __name__ == "__main__":
    main()
