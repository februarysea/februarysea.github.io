import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

const hasFlag = (flag) => args.includes(flag);
const getFlagValue = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
};

const usage = () => {
  console.log("Usage: pnpm log:worktime:auto [--device name] [--date YYYY-MM-DD] [--yesterday] [--dry-run] [--backfill] [--commit] [--push] [--rebase] [--server URL]");
  console.log("Example: pnpm log:worktime:auto --device macmini --yesterday --commit --push --rebase");
};

if (hasFlag("-h") || hasFlag("--help")) {
  usage();
  process.exit(0);
}

const formatDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDate = (key) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
};

const dateArg = getFlagValue("--date");
if (dateArg && hasFlag("--yesterday")) {
  console.error("Use either --date or --yesterday, not both.");
  process.exit(1);
}
if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  console.error("Invalid date format. Use YYYY-MM-DD.");
  process.exit(1);
}

const today = new Date();
today.setHours(0, 0, 0, 0);

const targetDate = dateArg ?? (hasFlag("--yesterday")
  ? (() => {
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      return formatDate(d);
    })()
  : formatDate(today));

const dayStart = parseDate(targetDate);
const dayEnd = new Date(dayStart);
dayEnd.setDate(dayEnd.getDate() + 1);

const server = (getFlagValue("--server") || process.env.ACTIVITYWATCH_URL || "http://localhost:5600").replace(/\/+$/, "");
const normalizeDevice = (value) => (
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
);
const rawDevice = getFlagValue("--device") || process.env.WORKTIME_DEVICE || os.hostname();
const device = normalizeDevice(rawDevice);
if (!device) {
  console.error("Invalid device name. Use --device (letters, numbers, dot, dash, underscore).");
  process.exit(1);
}
const outputRelativePath = `src/data/worktime.devices.${device}.json`;

const getJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
};

const pickBucket = (bucketIds, prefix) => {
  const exact = `${prefix}${os.hostname()}`;
  if (bucketIds.includes(exact)) return exact;

  const all = bucketIds.filter((id) => id.startsWith(prefix)).sort();
  if (!all.length) return null;
  if (all.length === 1) return all[0];

  const shortHost = os.hostname().split(".")[0];
  const byShortHost = all.find((id) => id === `${prefix}${shortHost}` || id.includes(shortHost));
  return byShortHost ?? all[0];
};

const overlapSeconds = (eventStart, eventEnd, rangeStart, rangeEnd) => {
  const start = Math.max(eventStart.getTime(), rangeStart.getTime());
  const end = Math.min(eventEnd.getTime(), rangeEnd.getTime());
  return Math.max(0, (end - start) / 1000);
};

const sumDurations = (events, predicate) => {
  let total = 0;
  for (const event of events) {
    if (!predicate(event)) continue;
    const start = new Date(event.timestamp);
    const durationSeconds = Number(event.duration) || 0;
    const end = new Date(start.getTime() + durationSeconds * 1000);
    total += overlapSeconds(start, end, dayStart, dayEnd);
  }
  return total;
};

let activeSeconds = 0;
let sourceLabel = "";

try {
  const buckets = await getJson(`${server}/api/0/buckets`);
  const bucketIds = Object.keys(buckets);

  const afkBucket = pickBucket(bucketIds, "aw-watcher-afk_");
  if (afkBucket) {
    const events = await getJson(
      `${server}/api/0/buckets/${encodeURIComponent(afkBucket)}/events?start=${encodeURIComponent(dayStart.toISOString())}&end=${encodeURIComponent(dayEnd.toISOString())}`
    );
    activeSeconds = sumDurations(events, (event) => event?.data?.status === "not-afk");
    sourceLabel = `AFK bucket (${afkBucket})`;
  } else {
    const windowBucket = pickBucket(bucketIds, "aw-watcher-window_");
    if (!windowBucket) {
      console.error("No ActivityWatch bucket found. Expected aw-watcher-afk_* or aw-watcher-window_*.");
      process.exit(1);
    }
    const events = await getJson(
      `${server}/api/0/buckets/${encodeURIComponent(windowBucket)}/events?start=${encodeURIComponent(dayStart.toISOString())}&end=${encodeURIComponent(dayEnd.toISOString())}`
    );
    activeSeconds = sumDurations(events, () => true);
    sourceLabel = `Window bucket (${windowBucket})`;
  }
} catch (error) {
  console.error("Could not read ActivityWatch data.");
  console.error(String(error?.message || error));
  console.error("Make sure ActivityWatch is running and reachable.");
  process.exit(1);
}

const rawHours = activeSeconds / 3600;
const roundedHours = Math.round(rawHours * 10) / 10;

console.log(`ActivityWatch source: ${sourceLabel}`);
console.log(`Detected ${rawHours.toFixed(2)}h on ${targetDate}; logging ${roundedHours}h.`);
console.log(`Device: ${device} -> ${outputRelativePath}`);

if (hasFlag("--dry-run")) {
  console.log("Dry run enabled: no data file was modified.");
  process.exit(0);
}

const logScriptPath = path.resolve(__dirname, "./log-worktime.mjs");
const childArgs = [logScriptPath, String(roundedHours), "--date", targetDate, "--out", outputRelativePath];
for (const forwardFlag of ["--backfill", "--commit", "--push", "--rebase"]) {
  if (hasFlag(forwardFlag)) childArgs.push(forwardFlag);
}

const result = spawnSync(process.execPath, childArgs, {
  cwd: projectRoot,
  stdio: "inherit",
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
