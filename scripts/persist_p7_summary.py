"""Save the already-deployed P7 summary to master, like Codex Token statistics."""
import argparse
import base64
import json
import os
from pathlib import Path
import time

from codex_github import APIError, WEBSITE_REPO, request
from p7_sync import check, validate_progress, validate_public

ENDPOINT = "/repos/" + WEBSITE_REPO + "/contents/src/data/p7-summary.json"


def publish(snapshot, token, api=request):
    validate_public(snapshot)
    content = base64.b64encode((json.dumps(snapshot, indent=2, allow_nan=False) + "\n").encode()).decode()
    for attempt in range(3):
        current_file = api(ENDPOINT + "?ref=master", token)
        check(current_file.get("encoding") == "base64" and isinstance(current_file.get("sha"), str), "Invalid P7 file response.")
        previous = validate_public(json.loads(base64.b64decode(current_file["content"])))
        validate_progress(snapshot, previous)
        if previous == snapshot:
            return None
        try:
            result = api(ENDPOINT, token, method="PUT", payload={"branch": "master", "sha": current_file["sha"], "content": content,
                                                                "message": "Update filtered P7 cat statistics"})
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
        publish(json.loads(args.snapshot.read_text()), os.environ["GH_TOKEN"])
        print("Saved the successfully deployed public P7 summary.")
    except (OSError, ValueError, TypeError, KeyError, RuntimeError):
        parser.exit(1, "P7 snapshot persistence failed; credentials were not exported.\n")


if __name__ == "__main__":
    main()
