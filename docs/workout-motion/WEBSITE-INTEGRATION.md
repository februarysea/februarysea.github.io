# Personal website integration

The homepage uses workout-motion's public H2 API, pinned to
`975788a1023ba46f700383b681ae22f27bb51a76` from
https://github.com/februarysea/workout-motion.

`vendor/workout-motion/runtime/h2.js` is compiled from the public Git snapshot.
The complete compiled module tree, declarations, source checksums and original
license notices are included. The library has no runtime dependencies; the
website build does not download it or require the independent library checkout.
The legacy root entry is retained in the complete snapshot but never imported by
the website. Do not edit vendored modules to change a movement.

## Display

`src/lib/exercise-motion.ts` maps the seven imported Enode exercise names to H2
IDs. Names, dates, loads and counts in the training data remain unchanged.
The latest session mounts an illustration for each exercise in the existing
card, scrolling the list when it contains more rows than fit.

The H2 Overhead Press uses a grip wider than the shoulders. Landmine Press uses
the library's single-arm split-switch push press. Squat uses the high-bar back
squat; Hang Clean uses the hang power clean. These are artwork mappings, not new
measurements or changes to the exercise records.

The component server-renders a static SVG, then lazily imports the player when
the session face is visible. The original authored cycle durations are retained
at speed 1 (the seven motions range from 3.6 to 4.2 seconds). There is no manual
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

After a new public library commit has been reviewed, use an exact commit SHA
available in a local checkout:

```sh
node scripts/sync-workout-motion.mjs --source /path/to/workout-motion --revision <full-40-character-sha>
pnpm run eslint
pnpm run check
pnpm run build
```

The sync script reads committed blobs, compiles with the website's existing
TypeScript, validates the H2 catalog and records checksums in SOURCE.json before
replacing the snapshot. It does not run package lifecycle scripts, install
dependencies, modify the library checkout, fetch training data or deploy.
The current catalog-count check intentionally requires review when upstream adds
motions. Preserve original LICENSE and NOTICE in both vendor and public output.
