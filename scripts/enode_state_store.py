#!/usr/bin/env python3
"""Load/commit allowlisted sync data on a dedicated branch using normal Git pushes."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

from enode_export import ExportError
from enode_sync import atomic_json, check, public_from_state, validate_state

BRANCH = "refs/heads/enode-data"
SHA = re.compile(r"^[0-9a-f]{40}$")


def git(*args, input=None):
    result = subprocess.run(["git", *args], input=input, text=True, capture_output=True)
    check(result.returncode == 0, "State Git operation failed: " + args[0])
    return result.stdout.strip()


def remote_head():
    lines = git("ls-remote", "--heads", "origin", BRANCH).splitlines()
    if not lines:
        return "none"
    check(len(lines) == 1, "Unexpected state branch response.")
    sha, ref = lines[0].split()
    check(SHA.fullmatch(sha) and ref == BRANCH, "Invalid state branch identity.")
    return sha


def load(bootstrap, output):
    revision = remote_head()
    if revision == "none":
        state = json.loads(bootstrap.read_text())
    else:
        git("fetch", "--no-tags", "--depth=1", "origin", BRANCH)
        revision = git("rev-parse", "FETCH_HEAD")
        check(SHA.fullmatch(revision), "Invalid fetched revision.")
        state = json.loads(git("show", revision + ":sync-state.json"))
    atomic_json(output, validate_state(state))
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
            stream.write("state_revision=" + revision + "\n")
    print("Loaded bootstrap data." if revision == "none" else "Loaded persistent sync data.")


def persist(folder, expected):
    check(expected == "none" or SHA.fullmatch(expected), "Invalid expected state revision.")
    state = validate_state(json.loads((folder / "sync-state.json").read_text()))
    public = json.loads((folder / "training.json").read_text())
    check(public == public_from_state(state), "Published data does not match sync state.")
    check(remote_head() == expected, "Persistent data advanced during this run; refusing to overwrite it.")
    if expected != "none":
        git("fetch", "--no-tags", "--depth=1", "origin", BRANCH)
        check(git("rev-parse", "FETCH_HEAD") == expected, "State branch changed while fetching.")
    tree_lines = []
    for name, value in (("sync-state.json", state), ("training.json", public)):
        blob = git("hash-object", "-w", "--stdin", input=json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        tree_lines.append("100644 blob " + blob + "\t" + name)
    tree = git("mktree", input="\n".join(tree_lines) + "\n")
    git("config", "user.name", "github-actions[bot]")
    git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    parents = [] if expected == "none" else ["-p", expected]
    revision = git("commit-tree", tree, *parents, input="Update Enode training data\n")
    # No force flag: concurrent changes fail even if they arrive after our check.
    git("push", "origin", revision + ":" + BRANCH)
    print("Saved validated public training data and sync checkpoint.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    read = sub.add_parser("load")
    read.add_argument("--bootstrap", type=Path, required=True)
    read.add_argument("--output", type=Path, required=True)
    write = sub.add_parser("persist")
    write.add_argument("--directory", type=Path, required=True)
    write.add_argument("--expected-revision", required=True)
    args = parser.parse_args()
    try:
        if args.command == "load":
            load(args.bootstrap, args.output)
        else:
            persist(args.directory, args.expected_revision)
    except (ExportError, OSError, ValueError, KeyError, TypeError) as error:
        message = str(error) if isinstance(error, ExportError) else type(error).__name__
        parser.exit(1, "State persistence failed: " + message + "\n")
