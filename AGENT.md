# Agent Notes

## Project Overview

This repository is the source for `februarysea.github.io`, a personal portfolio site built with Astro. The public site is configured as `https://www.februarysea.me` in `astro.config.mjs`.

Core stack:

- Astro 5
- UnoCSS
- Solid components
- Svelte components
- Motion, D3, Rive assets
- GitHub Pages deployment

## Local Environment

Use `pnpm`; this repo has a `pnpm-lock.yaml`.

Environment observed during the latest setup check:

- Node: `v25.7.0`
- pnpm: `10.28.2`
- Branch: `master`
- Remote tracking: `origin/master`
- Working tree before adding this file: clean

GitHub Actions currently builds with Node 20 and installs pnpm 9 in `.github/workflows/deploy.yml`, so avoid relying on local-only Node 25 behavior.

## Common Commands

```bash
pnpm install
pnpm run dev
pnpm run build
pnpm run preview
pnpm run eslint
pnpm run check
```

Worktime helpers:

```bash
pnpm log:worktime 9
pnpm log:worktime 9 --yesterday
pnpm log:worktime 9 --date 2026-02-07
pnpm log:worktime 2.5 --date 2026-04-28 --device mbp
pnpm log:worktime:mbp
pnpm log:worktime:macmini
pnpm log:worktime:test --yesterday
```

## Repository Map

- `src/pages/` contains route entry points.
- `src/components/` contains Astro, Solid, and Svelte UI components.
- `src/layouts/` contains shared page layouts.
- `src/data/blog/` contains Markdown blog entries.
- `src/data/worktime.json` stores legacy worktime totals.
- `src/data/worktime-sources/` stores per-device worktime sources. The Worktime card treats `src/data/worktime.json` as the macmini fallback, uses `macmini.json` when present for a date, and adds `mbp.json` when available.
- `src/lib/` contains shared helpers, constants, world data, and remark plugins.
- `public/` contains static images, fonts, favicon, and preview assets.
- `scripts/` contains worktime logging and ActivityWatch helper scripts.
- `.github/workflows/deploy.yml` builds and deploys GitHub Pages from `master`; it also runs daily at 00:10 Asia/Shanghai with `TZ=Asia/Shanghai`.

## Validation Notes

Run focused checks before handing off changes:

```bash
pnpm run eslint
pnpm run check
pnpm run build
```

Latest local validation results:

- `pnpm run eslint` exits successfully.
- `pnpm run check` exits successfully.
- `pnpm run build` exits successfully and builds 6 pages. In a restricted network environment, UnoCSS may warn that it cannot fetch Google Fonts from `fonts.googleapis.com`; this warning did not fail the build locally.

## Editing Guidance

- Keep changes scoped; the site is customized from `astro-bento-portfolio`, and some template remnants still exist in README and constants.
- Prefer existing Astro/UnoCSS conventions over introducing a new styling layer.
- Use typed DOM access in Astro client scripts when touching script blocks.
- Be careful with `src/data/worktime.json` and `src/data/worktime-sources/*.json`; the automation scripts can commit and push updates.
- `pnpm log:worktime:macmini` overwrites today's `macmini` source value from local ActivityWatch.
- `pnpm log:worktime:mbp` looks back 7 completed days through yesterday, runs only between 09:00 and 23:59 unless `--force` is passed, and records a local once-per-day success marker in `~/.cache/februarysea-worktime-mbp-sync.json`.
- Do not run destructive Git commands unless explicitly requested.
