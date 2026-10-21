# workout-motion

An SVG exercise animation library for training logs, fitness apps and websites.

**[Live demo](https://jichunhou.me/workout-motion/)** · **English** · [简体中文](README.zh-CN.md)

- **92 exercises** in a consistent visual style, covering free weights, machines, cables, bodyweight and core training, with more to come.
- **No runtime dependencies**, with a framework-independent JavaScript API.
- **Playback and static output**: pause, seek, adjust speed, or render any frame as SVG.

| Squat | Bench Press | Deadlift | Pull-up |
| :---: | :---: | :---: | :---: |
| [![Squat](site/previews/squat.gif)](https://jichunhou.me/workout-motion/?lang=en&motion=squat) | [![Bench Press](site/previews/bench-press.gif)](https://jichunhou.me/workout-motion/?lang=en&motion=bench-press) | [![Deadlift](site/previews/conventional-deadlift.gif)](https://jichunhou.me/workout-motion/?lang=en&motion=conventional-deadlift) | [![Pull-up](site/previews/pull-up.gif)](https://jichunhou.me/workout-motion/?lang=en&motion=pull-up) |

Full motion loops at 2× speed. Click a preview for interactive playback.

## Getting started

Build the SVG assets from source with Node.js 20+ and pnpm 10.28.2:

```sh
git clone https://github.com/februarysea/workout-motion.git
cd workout-motion
pnpm install --frozen-lockfile
pnpm build
```

The build generates:

- `assets/<id>.svg` — one SVG for each of the 92 motions, ready to use as an image.
- `assets/manifest.json` — motion IDs, names, durations and SVG filenames.
- `dist/` — JavaScript modules and TypeScript declarations for rendering and playback.

The exported SVGs are static frames at phase `0.2`. Continuous animation uses the
JavaScript player. Forearm Plank and Hollow Body Hold are isometric poses and
intentionally remain still.

## Render a specific frame

After building, use `renderSvg` in Node.js to generate an SVG at any point in a
motion. Save this example as `export-frame.mjs` in the repository root and run
`node export-frame.mjs`:

```js
import { writeFile } from 'node:fs/promises';
import { renderSvg } from './dist/h2.js';

const svg = renderSvg('squat', { phase: 0.5, size: 256, title: 'Squat' });
await writeFile('squat.svg', svg, 'utf8');
```

This creates `squat.svg`. `phase` selects a point in the motion from `0` to `1`;
`size` sets the SVG dimensions in pixels.

## API

The 92-exercise library uses the **`/h2` entry**, built as `dist/h2.js`. The package
root retains seven legacy drawings; use `/h2` for the current catalog.

| Export | Purpose |
| --- | --- |
| `exerciseIds` | Read-only list of the 92 motion IDs |
| `getExercise(id)` | Frozen metadata: names, duration, subtitle, optional keyframes and `isometric`; `undefined` for an unknown ID |
| `createPlayer(element, id, options?)` | Mount an SVG animation and return its controls |
| `renderSvg(id, options?)` | Return a static SVG string; works in Node and SSR without a DOM |

For animation in an application, pass a mounted HTML element as `host`:

```js
import { createPlayer } from './dist/h2.js';

const player = createPlayer(host, 'bench-press', { autoplay: false });
```

Players expose `play()`, `pause()`, `seek(phase)`, `setSpeed(speed)`, `destroy()`,
and read-only `playing` / `progress`. Speed is a positive multiplier. Options
include `autoplay`, `phase`, `speed`, `title` and `onStateChange`.
Connect playback controls to these methods and keep a visible pause control.
Playback respects reduced motion and pauses when the page is hidden or the
player is offscreen. Call `destroy()` when removing the host.

## SVG appearance

Inline SVGs and players inherit four CSS variables. For example, apply a light
theme to a host with the `workout-motion` class:

```css
.workout-motion {
  width: 320px;
  max-width: 100%;
  aspect-ratio: 1;
  background: var(--figure-paper);
  --figure-paper: #f4f1e9;
  --figure-ink: #252720;
  --figure-detail: #55594d;
  --figure-muted: #83877a;
}
```

Match the host background to `--figure-paper`, which masks hidden outlines, and
preserve the SVG's aspect ratio. For external SVGs in `<img>`, set
`background: #151718` to match the default paper color; they do not inherit page CSS variables.

## Exercises

Pass any of these IDs to `createPlayer`, `renderSvg` or `getExercise`.

<details>
<summary>All 92 motion IDs</summary>

| ID | Motion |
| --- | --- |
| `conventional-deadlift` | Conventional Deadlift |
| `sumo-deadlift` | Sumo Deadlift |
| `low-bar-squat` | Low-bar Back Squat |
| `reverse-lunge` | Reverse Lunge |
| `glute-bridge` | Glute Bridge |
| `hip-thrust` | Barbell Hip Thrust |
| `single-arm-dumbbell-row` | Single-arm Dumbbell Row |
| `incline-dumbbell-press` | Incline Dumbbell Press |
| `dumbbell-shoulder-press` | Dumbbell Shoulder Press |
| `hammer-curl` | Hammer Curl |
| `lateral-raise` | Lateral Raise |
| `seated-cable-row` | Seated Cable Row |
| `lat-pulldown` | Lat Pulldown |
| `triceps-pushdown` | Cable Triceps Pushdown |
| `dip` | Parallel-bar Dip |
| `bent-over-row` | Bent-over Barbell Row |
| `barbell-curl` | Barbell Curl |
| `front-squat` | Barbell Front Squat |
| `bench-press` | Bench Press |
| `squat` | Barbell Back Squat |
| `overhead-press` | Overhead Press |
| `romanian-deadlift` | Romanian Deadlift |
| `pull-up` | Pull-up |
| `landmine-press` | Landmine Split-switch Push Press |
| `hang-clean` | Hang Power Clean |
| `power-clean` | Power Clean |
| `box-jump` | Standing Box Jump |
| `depth-box-jump` | Drop-to-Box Jump |
| `lateral-box-jump` | Lateral Box Jump |
| `dumbbell-bench-press` | Dumbbell Bench Press |
| `dumbbell-fly` | Dumbbell Fly |
| `dumbbell-pullover` | Dumbbell Pullover |
| `close-grip-bench-press` | Close-grip Bench Press |
| `dumbbell-floor-press` | Dumbbell Floor Press |
| `overhead-dumbbell-triceps-extension` | Overhead Dumbbell Triceps Extension |
| `lying-dumbbell-triceps-extension` | Lying Dumbbell Triceps Extension |
| `dumbbell-curl` | Dumbbell Curl |
| `concentration-curl` | Concentration Curl |
| `incline-dumbbell-curl` | Incline Dumbbell Curl |
| `bent-over-dumbbell-reverse-fly` | Bent-over Dumbbell Reverse Fly |
| `cable-face-pull` | Cable Face Pull |
| `straight-arm-pulldown` | Straight-arm Pulldown |
| `barbell-upright-row` | Barbell Upright Row |
| `dumbbell-shrug` | Dumbbell Shrug |
| `goblet-squat` | Goblet Squat |
| `bulgarian-split-squat` | Bulgarian Split Squat |
| `forward-lunge` | Forward Lunge |
| `dumbbell-romanian-deadlift` | Dumbbell Romanian Deadlift |
| `single-leg-romanian-deadlift` | Single-leg Romanian Deadlift |
| `step-up` | Step-up |
| `standing-calf-raise` | Standing Calf Raise |
| `seated-calf-raise` | Seated Calf Raise |
| `leg-press` | 45° Leg Press |
| `seated-leg-extension` | Seated Leg Extension |
| `hip-abduction-machine` | Machine Hip Abduction |
| `hip-adduction-machine` | Machine Hip Adduction |
| `pec-deck` | Pec Deck Fly |
| `shoulder-press-machine` | Machine Shoulder Press |
| `chest-supported-row-machine` | Chest-supported Machine Row |
| `reverse-pec-deck` | Reverse Pec Deck Fly |
| `assisted-pull-up` | Assisted Pull-up |
| `smith-machine-squat` | Smith Machine Squat |
| `smith-machine-bench-press` | Smith Machine Bench Press |
| `smith-machine-incline-press` | Smith Machine Incline Press |
| `prone-leg-curl` | Prone Leg Curl |
| `standing-leg-curl-machine` | Standing Leg Curl Machine |
| `machine-calf-raise` | Standing Calf Raise Machine |
| `triceps-extension-machine` | Triceps Extension Machine |
| `assisted-dip` | Assisted Dip |
| `back-extension` | 45-degree Back Extension |
| `standing-cable-chest-fly` | Standing Cable Chest Fly |
| `low-to-high-cable-fly` | Low-to-high Cable Fly |
| `single-arm-cable-row` | Standing Single-arm Cable Row |
| `kneeling-single-arm-lat-pulldown` | Kneeling Single-arm Lat Pulldown |
| `cable-lateral-raise` | Cable Lateral Raise |
| `cable-reverse-fly` | Cable Reverse Fly |
| `cable-biceps-curl` | Cable Biceps Curl |
| `overhead-cable-triceps-extension` | Overhead Cable Triceps Extension |
| `standing-cable-chest-press` | Standing Cable Chest Press |
| `cable-pull-through` | Cable Pull-through |
| `pallof-press` | Pallof Press |
| `cable-woodchop` | High-to-low Cable Woodchop |
| `incline-push-up` | Incline Push-up |
| `knee-push-up` | Knee Push-up |
| `pike-push-up` | Pike Push-up |
| `inverted-row` | Inverted Row |
| `bodyweight-squat` | Bodyweight Squat |
| `bird-dog` | Bird Dog |
| `donkey-kick` | Donkey Kick |
| `forearm-plank` | Forearm Plank |
| `hollow-body-hold` | Hollow Body Hold |
| `dead-bug` | Dead Bug |

</details>

## License

Noncommercial use is free under [PolyForm Noncommercial 1.0.0](LICENSE); commercial
use outside its permissions requires [written permission](COMMERCIAL-LICENSE.md).
Retain attribution and [NOTICE](NOTICE); the [full terms](LICENSE) govern.
