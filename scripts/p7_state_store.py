"""Persist validated, credential-free P7 history after successful deployment.

Follows the Training module's optimistic, non-force data-branch checkpoint flow.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

from p7_sync import atomic_json, check, instant, load_rules, summarize, validate_public, validate_state

BRANCH = "refs/heads/p7-data"
SHA = re.compile(r"^[0-9a-f]{40}$")


def git(*args, input=None):
    result = subprocess.run(["git", *args], input=input, text=True, capture_output=True)
    check(result.returncode == 0, "P7 state Git operation failed.")
    return result.stdout.strip()


def remote_head():
    lines = git("ls-remote", "--heads", "origin", BRANCH).splitlines()
    if not lines:
        return "none"
    check(len(lines) == 1, "Unexpected P7 state branch.")
    sha, ref = lines[0].split()
    check(SHA.fullmatch(sha) and ref == BRANCH, "Invalid P7 state revision.")
    return sha


def load(bootstrap, output):
    revision = remote_head()
    if revision == "none":
        state = json.loads(bootstrap.read_text())
    else:
        git("fetch", "--no-tags", "--depth=1", "origin", BRANCH)
        revision = git("rev-parse", "FETCH_HEAD")
        check(SHA.fullmatch(revision), "Invalid fetched P7 revision.")
        state = json.loads(git("show", revision + ":sync-state.json"))
    atomic_json(output, validate_state(state))
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
            stream.write("state_revision=" + revision + "\n")
    print("Loaded validated P7 checkpoint.")


def persist(folder, expected, rules):
    check(expected == "none" or SHA.fullmatch(expected), "Invalid expected P7 revision.")
    state = validate_state(json.loads((folder / "sync-state.json").read_text()))
    public = validate_public(json.loads((folder / "p7-summary.json").read_text()))
    check(public == summarize(state, rules)[0], "P7 public data does not match checkpoint.")
    check(remote_head() == expected, "P7 state advanced; refusing to overwrite it.")
    if expected != "none":
        git("fetch", "--no-tags", "--depth=1", "origin", BRANCH)
        check(git("rev-parse", "FETCH_HEAD") == expected, "P7 checkpoint changed during fetch.")
        previous = validate_state(json.loads(git("show", expected + ":sync-state.json")))
        check(previous["deviceHash"] == state["deviceHash"], "P7 device identity changed.")
        check(instant(state["updatedAt"]) >= instant(previous["updatedAt"]), "Refusing an older P7 checkpoint.")
        check(previous["events"].keys() <= state["events"].keys(), "P7 checkpoint lost archived observations.")
    lines = []
    for name, data in (("sync-state.json", state), ("p7-summary.json", public)):
        blob = git("hash-object", "-w", "--stdin", input=json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        lines.append("100644 blob " + blob + "\t" + name)
    tree = git("mktree", input="\n".join(lines) + "\n")
    git("config", "user.name", "github-actions[bot]")
    git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    parents = [] if expected == "none" else ["-p", expected]
    revision = git("commit-tree", tree, *parents, input="Update validated P7 observations\n")
    git("push", "origin", revision + ":" + BRANCH)
    print("Saved the successfully deployed P7 checkpoint.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    read = sub.add_parser("load")
    read.add_argument("--bootstrap", type=Path, required=True)
    read.add_argument("--output", type=Path, required=True)
    save = sub.add_parser("persist")
    save.add_argument("--directory", type=Path, required=True)
    save.add_argument("--expected-revision", required=True)
    save.add_argument("--rules", type=Path, default=Path("config/p7-rules.json"))
    args = parser.parse_args()
    try:
        if args.command == "load":
            load(args.bootstrap, args.output)
        else:
            persist(args.directory, args.expected_revision, load_rules(args.rules))
    except (ValueError, OSError, KeyError, TypeError):
        parser.exit(1, "P7 checkpoint persistence failed; existing state was not force-overwritten.\n")


if __name__ == "__main__":
    main()
