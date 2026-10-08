# Enode One → GitHub Pages

The existing One account supplies training data through the endpoints already
verified by the local exporter. No Python packages, local app database, or Enode
installation are needed on the runner: Python 3, curl and Git are sufficient.
These are observed app endpoints, so an Enode API/client change may need maintenance.

## Daily incremental sync

The Pages workflow runs at `0 16 * * *` UTC, midnight in Asia/Shanghai. Scheduled
runs can be delayed by GitHub. Set the repository variable `ENODE_SYNC_ENABLED`
to `true` to enable automatic sync. Before that, scheduled runs are skipped and
ordinary code pushes continue deploying the checked-in training snapshot.

Each enabled run does the following:

1. Load the last successfully deployed checkpoint from the `enode-data` branch.
   If the branch does not exist, use `config/enode-sync-bootstrap.json`.
2. Read the lightweight session list in weekly API windows over the saved history.
   Compare hashed session identities and summary fingerprints with the checkpoint.
3. Download session/set details only for new or changed records. Reuse other
   records. The observed list has `created`, but no reliable last-modified field:
   records from the last three days are also rechecked after six hours, and every
   record gets a detail audit after seven days. This catches edits to individual
   reps that may not change a list summary. It is not a repeated 35-day full export.
4. Validate ownership, relationships, counts, data types and the public whitelist.
   If details were fetched, reread the list to detect changes during the run.
5. Build and deploy the website in separate jobs, without Enode Secrets.
6. Only after deployment succeeds, commit the public data and checkpoint to
   `enode-data`. A normal, non-force push rejects a concurrent state change.

The bootstrap covers the exact original snapshot interval, starting
2026-09-05 at 19:26:28 Asia/Shanghai; it does not claim all-time history. Coverage
grows with subsequent runs. The website still displays its rolling 30-day view.
The history ledger is retained independently of that display window.

A missing record is kept until a second successful list check at least 20 hours
later. An unexpectedly empty list or bulk disappearance stops the run for review.
Transient transport, rate-limit and server failures get at most three attempts;
authentication/permission failures stop immediately. No login/OTP is initiated.

## What is stored where

| Location | Contents |
| --- | --- |
| GitHub repository Secrets | `ENODE_SESSION_TOKEN`, `ENODE_API_KEY`, `ENODE_DEVICE_ID`, `ENODE_DEVICE_NAME` |
| `config/enode-client.json` | Five nonsecret client headers observed in the working One request |
| `config/enode-catalog.json` | Generic metric definitions and resolved exercise names; no app database or account records |
| `enode-data` → `training.json` | Training dates, exercise names, loads, reps, work/warm-up classification and valid concentric mean velocities |
| `enode-data` → `sync-state.json` | Same public set fields, hashed account/session identities, summary hashes and sync timestamps |
| Actions artifact `enode-sync` (7 days) | Only the two validated JSON files above |
| Pages artifact / website | Built site with public training fields; no checkpoint or credentials |

This is a public repository: the data branch and its commit history are public,
including earlier training values. Hashes are persistent pseudonymous identifiers,
not encryption. Raw API account IDs, email, device identity, session token, API key,
raw sensor payloads and authentication files are excluded. The whitelist is checked
again before build and persistence; the fetch step also checks output against known
private values. Secrets never appear in curl arguments, logs, or artifact paths.

Only the fetch step receives Enode Secrets. The sync job has read-only repository
access and runs no npm packages. Build/deploy never receive those Secrets; the
separate persistence job has repository write access but no Enode Secrets. Third-party
actions are pinned to full commit IDs. GitHub runs the authorized fetch code with
the secrets: repository/workflow write access must therefore remain trusted.

## First cloud run

1. Review and push the workflow, scripts, catalog, tests and sanitized bootstrap to
   `master`. Leave `ENODE_SYNC_ENABLED` unset for the initial rollout.
2. Save the four current client/session values as individual repository Secrets.
   Read them directly from the gitignored local files; do not paste them into
   source code, issues, logs or command-line arguments.
3. In **Actions → Deploy to GitHub Pages → Run workflow**, select `master`, leave
   `sync_enode=true` and `dry_run=true`. Leave both audit/deletion overrides false.
4. Verify the fetch report and successful build. A dry run does not deploy or
   create/advance `enode-data`.
5. Set `ENODE_SYNC_ENABLED=true`, then run once with `dry_run=false`. Verify the
   deploy and persistence jobs, not just the green build. Later scheduled runs
   and source pushes use the same pipeline and current data branch.

Once enabled, a failed fetch blocks deployment instead of falling back to stale
source data. Build/deployment failures do not save the new checkpoint. If only
persistence fails after a successful deploy, the website has new data but the old
checkpoint remains: repair the Git permission/conflict and rerun safely.

## Maintenance

- Session/client authorization fails: refresh the local One session using the
  existing import workflow, verify locally, and replace the affected Secrets.
  Do not log out/revoke the working session as a test.
- Unknown exercise names or changed metric definitions: regenerate the portable
  catalog with `python3 scripts/enode_catalog.py --database /path/to/ENModel.sqlite
  --output config/enode-catalog.json`, review its diff, and push. A changed catalog
  triggers a detail recheck automatically. Never commit the SQLite database.
- Suspect older rep edits: manually run with `force_audit=true`; use a dry run
  first if you want to inspect the output without publishing.
- Intentional bulk deletions: verify in One, then explicitly set
  `accept_deletions=true` for one manual run. It accepts deletions immediately.
- GitHub disables an inactive scheduled workflow or a run fails: re-enable/rerun
  it in Actions and inspect GitHub's workflow failure notifications. The website
  keeps its previous successful deployment.
- To pause scheduled fetches without reverting public training on a later push,
  disable the whole workflow in Actions. Unsetting the rollout flag deliberately
  returns builds to the older checked-in snapshot; it is not a normal pause button.

## Local verification

```sh
python3 -m unittest discover -s tests -p 'test_enode*.py'
python3 scripts/enode_sync.py sync \
  --state config/enode-sync-bootstrap.json \
  --catalog config/enode-catalog.json \
  --output-dir .enode-private/validation-run-1
python3 scripts/enode_sync.py sync \
  --state .enode-private/validation-run-1/sync-state.json \
  --catalog config/enode-catalog.json \
  --output-dir .enode-private/validation-run-2
```

Use a new output directory on each run. An unchanged immediate second run should
report zero `details_fetched` and `sets_fetched`. The tests include changed/new
records, hidden rep edits, deletion confirmation, ownership/auth failures, retries,
privacy checks and persistence against an isolated local Git remote.
