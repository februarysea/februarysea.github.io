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

The homepage's Token usage heatmap uses the signed-in Codex Profile's daily
token buckets and lifetime total from `src/data/codex-profile.json`. Its reverse
side is Recent work. `/usage-preview/` retains the alternate visualizations.
Local session history and other accounts are not combined with this data.

```bash
pnpm run usage:sync
pnpm run usage:test
python3 scripts/fetch-codex-profile.py --validate-snapshot src/data/codex-profile.json
```

The sync command makes a read-only request to the same Profile service as the
desktop client, using the current local sign-in from `$CODEX_HOME/auth.json`
(default `~/.codex/auth.json`). This is an internal endpoint, not a documented
public API. Credentials are never written to the snapshot or browser bundle.
`CODEX_ACCOUNT_ID` optionally pins the expected account; a mismatch fails before
the request. Temporary service errors retry up to three times. Failed fetches
leave the last good snapshot intact.

The public snapshot contains only its schema version, source, fetch timestamp,
lifetime token total, and dated daily totals. Validation rejects extra fields,
invalid numbers, duplicate or unsorted dates, and inconsistent totals. The
Pages workflow runs the usage tests and validates this snapshot before building;
these checks do not read credentials or contact Profile.

Daily dates retain the service's original buckets. The wall shows 52 weeks,
and Last 30 days ends on the last reported day, including explicit zero values.
Unreported trailing days stay blank. Hovering, tapping, or focusing a day shows
its exact token count; arrow keys move between days. Narrow screens can scroll
the wall horizontally, starting at the recent end.

Scheduled Codex collection is not yet enabled. It requires a separately
authorized private automation environment and a dedicated managed login with
refresh-state persistence. Do not put Codex login credentials in this public
repository or its Actions workflows. See the
[official CI authentication guidance](https://learn.chatgpt.com/docs/auth/ci-cd-auth).
The existing Enode daily schedule and deployment settings are unchanged.
