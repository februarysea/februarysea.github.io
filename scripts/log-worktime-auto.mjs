import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const sourceDataDir = path.resolve(projectRoot, "src/data/worktime-sources");
const args = process.argv.slice(2);

const hasFlag = (flag) => args.includes(flag);
const getFlagValue = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
};

const usage = () => {
  console.log("Usage: node scripts/log-worktime-auto.mjs [--device NAME] [--date YYYY-MM-DD] [--yesterday] [--lookback-days N] [--once-per-day] [--state-file PATH] [--start-hour H] [--end-hour H] [--force] [--dry-run] [--commit] [--push] [--rebase] [--server URL]");
  console.log("Example: pnpm log:worktime:macmini");
  console.log("Example: pnpm log:worktime:mbp");
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

const normalizeDevice = (value) => {
  if (!value) return null;
  const device = value.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(device)) {
    console.error("Invalid device name. Use lowercase letters, numbers, and hyphens only.");
    process.exit(1);
  }
  return device;
};

const parseHourFlag = (flag) => {
  const raw = getFlagValue(flag);
  if (raw === null) return null;
  const hour = Number(raw);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    console.error(`Invalid ${flag}. Use an integer from 0 to 23.`);
    process.exit(1);
  }
  return hour;
};

const parseLookbackDays = () => {
  const raw = getFlagValue("--lookback-days");
  if (raw === null) return 1;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 60) {
    console.error("Invalid --lookback-days. Use an integer from 1 to 60.");
    process.exit(1);
  }
  return days;
};

const readState = (statePath) => {
  if (!statePath || !fs.existsSync(statePath)) return {};
  const raw = fs.readFileSync(statePath, "utf-8");
  return raw.trim().length ? JSON.parse(raw) : {};
};

const writeState = (statePath, state) => {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
};

const runGit = (gitArgs, options = {}) => spawnSync("git", gitArgs, {
  cwd: projectRoot,
  encoding: options.encoding,
  stdio: options.stdio ?? "inherit",
});

const ensureGitSuccess = (result, label) => {
  if (result.status !== 0) {
    console.error(`${label} failed.`);
    process.exit(result.status ?? 1);
  }
};

const isDryRun = hasFlag("--dry-run");
const force = hasFlag("--force");
const device = normalizeDevice(getFlagValue("--device"));
const startHour = parseHourFlag("--start-hour");
const endHour = parseHourFlag("--end-hour");
if (startHour !== null && endHour !== null && startHour > endHour) {
  console.error("--start-hour must be less than or equal to --end-hour.");
  process.exit(1);
}

const now = new Date();
const todayKey = formatDate(now);
const currentHour = now.getHours();
if (!force && startHour !== null && currentHour < startHour) {
  console.log(`Before start hour (${startHour}:00); skipping worktime sync.`);
  process.exit(0);
}
if (!force && endHour !== null && currentHour > endHour) {
  console.log(`After end hour (${endHour}:59); skipping worktime sync.`);
  process.exit(0);
}

const statePath = getFlagValue("--state-file")
  || (device ? path.resolve(os.homedir(), ".cache", `februarysea-worktime-${device}-sync.json`) : null);
if (!force && hasFlag("--once-per-day") && statePath) {
  const state = readState(statePath);
  if (state.lastSuccessfulSyncDate === todayKey) {
    console.log(`Already synced ${device ?? "worktime"} today (${todayKey}); skipping.`);
    process.exit(0);
  }
}

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
const endDate = dateArg
  ? parseDate(dateArg)
  : (() => {
      const date = new Date(today);
      if (hasFlag("--yesterday")) date.setDate(date.getDate() - 1);
      return date;
    })();
const lookbackDays = parseLookbackDays();
const targetDates = [];
for (let offset = lookbackDays - 1; offset >= 0; offset -= 1) {
  const date = new Date(endDate);
  date.setDate(endDate.getDate() - offset);
  targetDates.push(formatDate(date));
}

const server = (getFlagValue("--server") || process.env.ACTIVITYWATCH_URL || "http://localhost:5600").replace(/\/+$/, "");

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

const sumDurations = (events, predicate, dayStart, dayEnd) => {
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

let activeBucket = null;
let sourceLabel = "";
let eventPredicate = () => true;

try {
  const buckets = await getJson(`${server}/api/0/buckets`);
  const bucketIds = Object.keys(buckets);

  const afkBucket = pickBucket(bucketIds, "aw-watcher-afk_");
  if (afkBucket) {
    activeBucket = afkBucket;
    sourceLabel = `AFK bucket (${afkBucket})`;
    eventPredicate = (event) => event?.data?.status === "not-afk";
  } else {
    const windowBucket = pickBucket(bucketIds, "aw-watcher-window_");
    if (!windowBucket) {
      console.error("No ActivityWatch bucket found. Expected aw-watcher-afk_* or aw-watcher-window_*.");
      process.exit(1);
    }
    activeBucket = windowBucket;
    sourceLabel = `Window bucket (${windowBucket})`;
  }
} catch (error) {
  console.error("Could not read ActivityWatch buckets.");
  console.error(String(error?.message || error));
  console.error("Make sure ActivityWatch is running and reachable.");
  process.exit(1);
}

console.log(`ActivityWatch source: ${sourceLabel}`);

const logScriptPath = path.resolve(__dirname, "./log-worktime.mjs");
for (const targetDate of targetDates) {
  const dayStart = parseDate(targetDate);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  let activeSeconds = 0;
  try {
    const events = await getJson(
      `${server}/api/0/buckets/${encodeURIComponent(activeBucket)}/events?start=${encodeURIComponent(dayStart.toISOString())}&end=${encodeURIComponent(dayEnd.toISOString())}`
    );
    activeSeconds = sumDurations(events, eventPredicate, dayStart, dayEnd);
  } catch (error) {
    console.error(`Could not read ActivityWatch data for ${targetDate}.`);
    console.error(String(error?.message || error));
    process.exit(1);
  }

  const rawHours = activeSeconds / 3600;
  const roundedHours = Math.round(rawHours * 10) / 10;
  console.log(`Detected ${rawHours.toFixed(2)}h on ${targetDate}; logging ${roundedHours}h.`);

  const childArgs = [logScriptPath, String(roundedHours), "--date", targetDate];
  if (device) childArgs.push("--device", device);
  if (isDryRun) childArgs.push("--dry-run");

  const result = spawnSync(process.execPath, childArgs, {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (isDryRun) {
  console.log("Dry run enabled: no sync state, commit, or push was written.");
  process.exit(0);
}

const dataPath = device
  ? path.resolve(sourceDataDir, `${device}.json`)
  : path.resolve(projectRoot, "src/data/worktime.json");
const dataPathRelative = path.relative(projectRoot, dataPath);
const statusResult = runGit(["status", "--porcelain", "--", dataPathRelative], {
  encoding: "utf-8",
  stdio: "pipe",
});
ensureGitSuccess(statusResult, "Git status");
const hasDataChange = statusResult.stdout.trim().length > 0;

if (!hasDataChange) {
  console.log(`No data changes in ${dataPathRelative}; skipping commit and push.`);
} else if (hasFlag("--commit")) {
  ensureGitSuccess(runGit(["add", dataPathRelative]), "Git add");
  const rangeLabel = targetDates.length === 1
    ? targetDates[0]
    : `${targetDates[0]}..${targetDates[targetDates.length - 1]}`;
  const label = device ? `${device} worktime` : "worktime";
  ensureGitSuccess(runGit(["commit", "-m", `Sync ${label} ${rangeLabel}`]), "Git commit");

  if (hasFlag("--push")) {
    if (hasFlag("--rebase")) {
      const branchResult = runGit(["rev-parse", "--abbrev-ref", "HEAD"], {
        encoding: "utf-8",
        stdio: "pipe",
      });
      ensureGitSuccess(branchResult, "Git branch lookup");
      const branch = branchResult.stdout.trim();
      ensureGitSuccess(runGit(["pull", "--rebase", "--autostash", "origin", branch]), "Git rebase");
    }
    ensureGitSuccess(runGit(["push", "origin", "HEAD"]), "Git push");
  }
} else if (hasFlag("--push")) {
  console.log("Data changed, but --commit was not set; skipping push.");
}

if (hasFlag("--once-per-day") && statePath) {
  writeState(statePath, {
    lastSuccessfulSyncDate: todayKey,
    lastSuccessfulSyncAt: new Date().toISOString(),
    device,
    targetDates,
  });
  console.log(`Updated sync state: ${statePath}`);
}
