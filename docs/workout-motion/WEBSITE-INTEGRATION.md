# Personal website integration

The homepage uses workout-motion's public H2 API from
https://github.com/februarysea/workout-motion. The bundled fallback snapshot is
`424fbcc1548b6e14a2276bc0886c13c7a228eb81` (v0.2.0, 92 motions).
Each GitHub Actions build also imports the latest `main` snapshot, recording its
exact commit and checksums in the deployed `SOURCE.json`.

`vendor/workout-motion/runtime/h2.js` is compiled from the public Git snapshot.
The complete compiled module tree, declarations, source checksums and original
license notices are included. The library has no runtime dependencies; the
local build does not download it or require the independent library checkout.
The legacy root entry is retained in the complete snapshot but never imported by
the website. Do not edit vendored modules to change a movement.

## Display

`src/lib/exercise-motion.ts` builds its lookup from the library's IDs, English
labels and Chinese labels. Matching ignores case, spacing and separators.
New same-name motions become available after the next successful Actions build;
there is no fixed list of supported Enode names. Unmatched or ambiguous names
remain without artwork instead of guessing an exercise variation.
`config/exercise-motion-aliases.json` holds explicit personal choices and takes
priority over catalog matching. Names, dates, loads and counts in the training
data remain unchanged.
The latest session mounts an illustration for each exercise in the existing
card, scrolling the list when it contains more rows than fit.

The H2 Overhead Press uses a grip wider than the shoulders. Landmine Press uses
the library's single-arm split-switch push press. Squat uses the high-bar back
squat; Hang Clean uses the hang power clean. Lateral Raise uses Cable Lateral
Raise (`cable-lateral-raise`), as selected for this site's training records,
rather than the library's dumbbell lateral raise. These are artwork mappings, not new
measurements or changes to the exercise records.

The component server-renders a static SVG, then lazily imports the player when
the session face is visible. The original authored cycle durations are retained
at speed 1. There is no manual
pause button. Playback stops on the card's front face and respects visibility
and reduced-motion preferences. The page keeps static artwork if
JavaScript or the animation chunk is unavailable. Page navigation releases the
players and observers; bfcache pagehide/pageshow pauses and resumes them.

The paper color matches the card's #050505 surface to preserve occlusion. A
0.55px non-scaling stroke keeps outlines readable at thumbnail size without
changing character geometry, viewBox or trajectory.

## Training data

The overview covers the latest 30 calendar days, inclusive of the build date in
Asia/Shanghai. It shows training days, working sets, repetitions and exercises.
Only sets explicitly marked `work: true` are included. Days outside the imported
coverage are marked as not synced, and the footer shows the actual import time.

The session face shows the latest day with working sets. Each exercise lists
sets and repetitions per set (for example, `5 sets / 5 reps`). Unequal rep counts
are shown in set order. A middle column shows AVG in m/s and a small chart of set
mean velocities; load is on the right. There is no detail dialog. Missing
measurements leave gaps; no samples are interpolated. AVG is the arithmetic mean
of all recorded repetition mean velocities, excluding warm-ups and missing
measurements. It is not an instantaneous peak or total distance divided by time.

The homepage's flip cards retain explicit bottom-right buttons and occasional
idle flips (first appearance after about 3–6 seconds, then 8–14 seconds apart,
returning after 3.5–5 seconds). Pointer entry previews the other face once; leaving
within that preview restores the face visible before entry. A hover preview gets
10 seconds of reading time before idle flips resume, even if the pointer stays
over the card. Once the idle cycle resumes, leaving no longer rewinds the preview.
A manually chosen face becomes the resting face and cancels any pending hover
restoration; automatic flips resume after its own 10-second reading period.
Touch input does not trigger hover previews. Automatic and hover flips pause for
keyboard focus, focused editable fields, open dialogs, offscreen/background
display and reduced-motion mode.
Hidden faces are inert; only a keyboard-triggered flip moves keyboard focus.
The middle card shows Conway's Game of Life on the front and Recent Work on the
back. Its front has no visible corner toggle or footer; the full face is a native
button so touch and keyboard users can still open Recent Work. Hover and idle
flips remain available, and the back retains its return button.
The publication metadata is verified against Crossref (DOI
10.1016/j.engappai.2026.116203), including the matching ScienceDirect PII.
The simulation pauses on the back and resumes on the front.

## Update

GitHub Actions fetches public `workout-motion/main` after installing the site's
locked dependencies, resolves its exact commit SHA, and runs the import script.
This runs on normal pushes, daily builds and manual builds. It does not execute
upstream package lifecycle scripts or install additional library dependencies.
The sync validates every motion and retains existing IDs and configured alias
targets. New catalog entries do not require editing a hard-coded count.

If fetching, compiling or validating the library fails, the workflow restores
the bundled snapshot and emits a warning. The browser uses the built snapshot;
it makes no runtime requests to GitHub. Publishing the library alone does not
trigger this site's build; daily synchronization will pick it up, or a normal
manual build can be run sooner.

To refresh the bundled fallback, use an exact commit SHA available in a local
checkout:

```sh
node scripts/sync-workout-motion.mjs --source /path/to/workout-motion --revision <full-40-character-sha>
pnpm run eslint
pnpm run check
node --test tests/exercise-motion.test.mjs
pnpm run build
```

The sync script reads committed blobs, compiles with the website's existing
TypeScript, validates the H2 catalog and records checksums in SOURCE.json before
replacing the snapshot. It does not run package lifecycle scripts, install
dependencies, modify the library checkout, fetch training data or deploy.
An upstream TypeScript version change or removed/renamed motion requires a
manual compatibility update. Preserve original LICENSE and NOTICE in both vendor
and public output.
