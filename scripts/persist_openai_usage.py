"""Save only a successfully deployed, allowlisted API usage snapshot."""
import argparse
import base64
import json
import os
from pathlib import Path
import time

from codex_github import APIError, WEBSITE_REPO, request
from openai_usage import validate_snapshot, validate_update

ENDPOINT = f"/repos/{WEBSITE_REPO}/contents/src/data/openai-usage.json"


def publish(snapshot, token, api=request):
    validate_snapshot(snapshot)
    if snapshot["generatedAt"] is None:
        raise ValueError("Cannot publish an uncollected API snapshot.")
    content = base64.b64encode((json.dumps(snapshot, indent=2, allow_nan=False) + "\n").encode()).decode()
    for attempt in range(3):
        response = api(ENDPOINT + "?ref=master", token)
        if response.get("encoding") != "base64" or not isinstance(response.get("sha"), str):
            raise ValueError("Unexpected API snapshot response.")
        previous = json.loads(base64.b64decode(response["content"]))
        validate_update(previous, snapshot)
        # Keep the last successful check time, including a confirmed zero-change read.
        if previous == snapshot:
            return None
        try:
            result = api(ENDPOINT, token, method="PUT", payload={"branch": "master", "sha": response["sha"],
                         "content": content, "message": "Update OpenAI API usage statistics"})
            return result["commit"]["sha"]
        except APIError as error:
            if error.status not in (409, 422, 500, 502, 503, 504) or attempt == 2:
                raise
            time.sleep(2 ** (attempt + 1))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    args = parser.parse_args()
    try:
        result = publish(json.loads(args.snapshot.read_text()), os.environ["GH_TOKEN"])
        print("Saved deployed API usage." if result else "API usage unchanged.")
    except (OSError, ValueError, TypeError, KeyError, RuntimeError):
        parser.exit(1, "Saving API statistics failed; no raw account data was exported.\n")


if __name__ == "__main__":
    main()
