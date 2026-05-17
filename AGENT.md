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

## Repository Map

- `src/pages/` contains route entry points.
- `src/components/` contains Astro, Solid, and Svelte UI components.
- `src/layouts/` contains shared page layouts.
- `src/data/blog/` contains Markdown blog entries.
- `src/lib/` contains shared helpers, constants, world data, and remark plugins.
- `public/` contains static images, fonts, favicon, and preview assets.
- `.github/workflows/deploy.yml` builds and deploys GitHub Pages from `master` on push or manual dispatch.

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
- Do not run destructive Git commands unless explicitly requested.
