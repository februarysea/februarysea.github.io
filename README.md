# ⚡️astro-bento-portfolio

## A personal portfolio website made using `Astro`.

![astro-bento-portfolio | Bento-like Personal Porfolio Template](public/preview.png)

To view a demo example, **[click here](https://sparkly-speculoos-0c9197.netlify.app/)**

or my portfolio **[click here](https://gianmarcocavallo.com)**

## Features

- Modern and Minimal bento-like, sleek UI Design
- All in one page (almost)
- Fully Responsive
- Performances and SEO optimizations
- Ready to be deployed on [Netlify](https://www.netlify.com/)
- Blog
- RSS support (your-domain/rss.xml)
- Cool 3d globe

## Tech Stack

- [Astro](https://astro.build)
- [unocss](https://unocss.dev/)
- [motion](https://motion.dev/)
- [d3](https://d3js.org/)

# Steps ▶️

```bash
# Clone this repository
$ git clone https://github.com/Ladvace/astro-bento-portfolio
```

```bash
# Go into the repository
$ cd astro-bento-portfolio
```

```bash
# Install dependencies
$ pnpm install
or
$ npm install
```

```bash
# Start the project in development
$ pnpm run dev
or
$ npm run dev
```

# Be sure to replace the momoji and all the relative information, such as email, website and other info, if you don't your website is gonna point to my domain and to my info

## REMOVE THE umami analytics script tag (or replace it with your id) in `src/layouts/Layout.astro`

# Configuration

remember to replace the `site` and other properties with your data in `astro.config.mjs`

# Deploy on Netlify 🚀

Deploying your website on Netlify it's optional but I reccomand it in order to deploy it faster and easly.

You just need to fork this repo and linking it to your Netlify account.

or

[![Netlify Deploy button](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/Ladvace/astro-bento-portfolio)

## Authors ❤️

- Gianmarco - https://github.com/Ladvace

## Codex token usage

The homepage's Token usage heatmap preserves the two-account history through
**2026-10-24** in `config/codex-usage-archive.json`. From **2026-10-25**, only the
original primary account contributes new daily usage. The reviewed archive keeps
all 236 historical buckets and 19,685,521,977 tokens unchanged. It is a combined
archive: the old collector did not retain per-account snapshots, so no individual
account history is invented. Account identifiers and email addresses are never
exported. Its reverse side is Recent work. `/usage-preview/` retains
the alternate visualizations. Local session history is not used.

```bash
pnpm run usage:test
pnpm run usage:validate
```

This repository's Pages workflow collects usage and renews the primary account's
dedicated managed login using the official Codex client. The `sync-codex` job
saves the refreshed login back to its encrypted environment Secret and exports
only validated public statistics. The retired second account is neither read nor
renewed and cannot cause collection or login reminders to fail. Build and deployment jobs
receive that snapshot without any Codex credentials. After a successful deployment, the workflow saves the same
snapshot on `master` using `GITHUB_TOKEN`, without triggering a second run.
No additional repository, data branch, or daily Mac process is needed. Failed
collection keeps the previous Codex snapshot while other modules can still deploy. The workflow fixes the
active account count to one and no longer references second-account Secrets or
the old `CODEX_ACCOUNT_COUNT` repository variable.

Every new total is the fixed archived total plus primary-account daily buckets
after the cutoff. Repeated dates replace their current value instead of being
added again. Previously collected primary-only days survive a rolling service
window. The `archivedThrough` marker distinguishes migrated data from old live
two-account aggregates, so a legacy cloud run cannot be mistaken for primary-only
history. Corrections before the cutoff do not rewrite the preserved archive.

The public snapshot contains only its schema version, source, fetch timestamp,
lifetime token total, dated daily totals, and the archive cutoff date when present. Validation rejects extra fields,
invalid numbers, duplicate or unsorted dates, and inconsistent totals. The
Pages workflow runs the usage tests and validates this snapshot before building;
these checks do not read credentials or contact Profile.

Daily dates retain the service's original buckets. The wall shows 52 weeks,
and Last 7 days ends on the last reported day, including explicit zero values.
Unreported trailing days stay blank. Hovering, tapping, or focusing a day shows
a compact token count (K/M/B); arrow keys move between days. Narrow screens can
scroll the wall horizontally, starting at the recent end. The homepage card shares
the same flip controller as every other card. Each face has its own countdown:
8–14 seconds on the front and 6–10 seconds on the back. Mouse entry immediately
switches to the opposite face and pauses its fresh countdown; mouse exit switches
faces again and starts the newly shown face's full countdown. Flip buttons also switch faces and reset
the countdown, which stays paused while hovered. Ordinary clicks, including heatmap
dates, do not change the timer or leave it paused after exit. Keyboard navigation
and editing retain focus protection. Reduced motion disables automatic flipping.

Codex shares the existing daily Pages schedule at **00:00 Asia/Shanghai**
(16:00 UTC on the previous day; GitHub may queue runs). `CODEX_SYNC_ENABLED=true` enables collection
on scheduled runs and website updates. Manual runs offer `sync_codex` and
`dry_run`; a dry run still saves refreshed credentials but does not deploy or
commit statistics. Existing Enode synchronization remains in the same workflow.

### Authentication setup

| Location | Name | Purpose |
| --- | --- | --- |
| `codex-auth` environment Secret | `CODEX_AUTH_JSON` | Independent managed login, replaced after renewal |
| `codex-auth` environment Secret | `CODEX_ACCOUNT_ID` | Pin the first selected account |
| `codex-auth` environment Secret | `CODEX_APP_PRIVATE_KEY` | Sign short-lived Secret write-back tokens |
| Repository variable | `CODEX_APP_ID` | Owner-only GitHub App identity |
| Repository variable | `CODEX_APP_INSTALLATION_ID` | Installation on this website repository only |
| Repository variable | `CODEX_SYNC_ENABLED` | Enable only after verified cloud runs |

The GitHub App needs only **Environments: read and write**, with metadata read
access, installed on `februarysea/februarysea.github.io`. The normal workflow
token saves public data; the App has no code-writing permission. Its temporary
token is revoked after collection. The `codex-auth` environment permits only
the `master` branch. Pull request checks never access its Secrets.

Environment Secrets are loaded when a job starts, and the Pages workflow's
concurrency group serializes renewal. Credentials are saved immediately after
refresh and again when the client exits; failure to save prevents publication of new Codex statistics.
Use a separate `codex login` for the primary account, never its active desktop session.
The second-account Secrets are no longer referenced; their remote removal is
separate from this local change and is not needed to retain historical counts.
Delete the primary bootstrap copy once two cloud runs verify renewal and reuse.
Revoked or invalidated refresh tokens can require a fresh independent login.

The repository and Actions logs are public. Never commit auth files or PEM keys,
print raw account responses, or upload the auth directory as an artifact. The
collector masks credential values and exports an allowlist of numeric/date
fields. References: [Codex CI authentication](https://learn.chatgpt.com/docs/auth/ci-cd-auth)
and [GitHub environment Secrets](https://docs.github.com/en/actions/concepts/security/secrets).

## P7 pet observations

The pet card uses `src/data/p7-summary.json`. Each graph shows daily medians of
accepted observations; its headline shows the latest accepted individual weight.
Visit counts and median durations remain in the data snapshot for later analysis;
they are not shown on the card. Missing days are left unfilled. Cat identity is **inferred from
weight**, not supplied by the device, and the original owner-provided breeds and
birthdays remain unchanged.

`config/p7-rules.json` separates Tangyuan (reference 6.3 kg) and Doubao (4.85 kg)
using non-overlapping ±0.6 kg bands. Out-of-band readings are excluded first.
Within each cat's band, observations within 14 days of a reading are compared
using median absolute deviation (MAD). With at least five samples, deviations
greater than `max(0.25 kg, 3 × 1.4826 × MAD)` are excluded. These configurable
measurement-quality rules need review if the cats' usual weights change.
Exclusions remain in the local audit; only accepted measurements affect cards.

To import a previously verified local snapshot (paths are examples):

```bash
python3 scripts/p7_sync.py import \
  --source /path/to/p7-cloud-history.json \
  --device-config /path/to/p7-device.json \
  --state config/p7-sync-bootstrap.json \
  --output-dir .p7-private/output
python3 scripts/p7_sync.py validate \
  --state .p7-private/output/sync-state.json \
  --public .p7-private/output/p7-summary.json \
  --previous src/data/p7-summary.json
cp .p7-private/output/p7-summary.json src/data/p7-summary.json
```

The `sync-p7` job is disabled by default. After reviewing and deploying the local
changes, configure these Secrets in a `p7-auth` environment restricted to `master`:

| Secret | Purpose |
| --- | --- |
| `P7_APP_PROFILE_JSON` | Verified PETSEE request-signing profile |
| `P7_SESSION_JSON` | Authorized PETSEE session, including its API region |
| `P7_DEVICE_ID` | Pin this P7 device |

Test with manual `sync_p7=true`, `dry_run=true` before setting repository variable
`P7_SYNC_ENABLED=true`. It shares the existing daily schedule. The collector only
reads weight/duration history and reuses the authorized session; there is no
unverified login or refresh endpoint. Complete, matching DP107/109 representations
are required. Reports may arrive one second apart, but weight, duration and the
embedded visit time must agree, with exactly one matching report on each side.
Ambiguous, conflicting or missing reports still fail validation. The text report
anchors each visit's identity and date to preserve existing archive keys.
Date-level observations are deduplicated and retained in `p7-data`
after successful deployment, so a shrinking cloud window does not erase history.
Only `sync-state.json` and `p7-summary.json` are uploaded; no credentials, raw API
responses, precise visit timestamps or rejection-audit files enter artifacts.
After deployment, the public summary is also saved on `master`, matching the
Codex statistics flow. Dry runs never save checkpoints or public snapshots.

The durable archive is `sync-state.json` on the `p7-data` branch, alongside
the daily summaries in `p7-summary.json`. Archived observations have no automatic expiry; the
seven-day Actions artifact retention applies only to temporary transfer files.
The fetch window covers the latest seven calendar days, so a longer interruption
can leave gaps. Persistence requires P7 collection and the website deployment to
succeed; an unrelated Training or Codex collection failure does not block it.

```bash
python3 -m unittest discover -s scripts -p 'test_p7*.py'
python3 -m unittest discover -s scripts -p 'test_sync_status.py'
node --test scripts/test-pet-weight.mjs
```

## Synchronization failure email

Training, the active primary Codex account, and P7 fail their Actions job if
collection fails. Confirmed authentication failures add a **sign-in required**
annotation and run summary with the affected module, Codex account slot when
known, and the Secret to replace. Network, rate-limit, storage and data-validation
errors are kept separate and do not claim that a login expired. Each collector
is independent: a failed collection skips that module's new artifact and
checkpoint, while successful modules and website changes still build and deploy.
Codex and P7 reuse their saved snapshots on `master`. Training restores its last
deployed checkpoint from `enode-data`; if that archive is unavailable, a warning
is recorded and the checked-in Training snapshot is kept. Build or deployment
failures still prevent all new checkpoints from being saved. A collector failure
keeps the overall run marked failed for notification even if deployment succeeds.

GitHub sends the failure email, so no SMTP credentials or additional reminder
service is needed. In [GitHub notification settings](https://github.com/settings/notifications),
enable Actions email notifications and choose failed workflows only. This is an
account preference; adding the workflow does not enable it automatically. The
email links to the failed run and its recovery instructions. Scheduled runs
notify the workflow owner/cron editor or the user who re-enabled the schedule;
confirm that recipient during rollout. Failure-only email also covers network
and build failures and may repeat while a problem remains unresolved.
See [GitHub's workflow notification rules](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs).
