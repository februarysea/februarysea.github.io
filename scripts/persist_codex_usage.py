"""Save successfully deployed statistics to master using the workflow token."""
import argparse
import base64
import json
import os
from pathlib import Path
import time

from codex_usage import validate_snapshot, validate_update
from codex_github import APIError, SNAPSHOT_PATH, WEBSITE_REPO, request

ENDPOINT = "/repos/" + WEBSITE_REPO + "/contents/" + SNAPSHOT_PATH


def publish(snapshot, token, api=request):
    validate_snapshot(snapshot)
    content = base64.b64encode((json.dumps(snapshot, indent=2, allow_nan=False) + "\n").encode()).decode()
    for attempt in range(3):
        previous_file = api(ENDPOINT + "?ref=master", token)
        if previous_file.get("encoding") != "base64" or not isinstance(previous_file.get("sha"), str):
            raise ValueError("Unexpected website snapshot response.")
        previous = json.loads(base64.b64decode(previous_file["content"]))
        validate_update(previous, snapshot)
        if (previous["daily"] == snapshot["daily"] and previous["totalTokens"] == snapshot["totalTokens"]
                and previous.get("archivedThrough") == snapshot.get("archivedThrough")):
            return None
        try:
            result = api(ENDPOINT, token, method="PUT", payload={
                "branch": "master", "sha": previous_file["sha"], "content": content,
                "message": "Update Codex usage statistics",
            })
            return result["commit"]["sha"]
        except APIError as error:
            if error.status not in (409, 422, 500, 502, 503, 504) or attempt == 2:
                raise
            # Reread and validate after a race; never force push or replace unrelated files.
            time.sleep(2 ** (attempt + 1))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    args = parser.parse_args()
    try:
        commit = publish(json.loads(args.snapshot.read_text()), os.environ["GH_TOKEN"])
        print("Saved successfully deployed statistics to master." if commit else "Usage is unchanged; no website commit needed.")
        if commit and os.environ.get("GITHUB_STEP_SUMMARY"):
            with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as stream:
                stream.write(f"Published [statistics commit](https://github.com/{WEBSITE_REPO}/commit/{commit}).\n")
    except (OSError, ValueError, TypeError, KeyError, RuntimeError):
        parser.exit(1, "Publishing statistics failed; no credential or raw account data was exported.\n")


if __name__ == "__main__":
    main()
