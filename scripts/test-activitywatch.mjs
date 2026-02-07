import os from "node:os";

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getFlagValue = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
};

const usage = () => {
  console.log("Usage: pnpm log:worktime:test [--date YYYY-MM-DD] [--yesterday] [--server URL]");
  console.log("Example: pnpm log:worktime:test --yesterday");
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

const parseDate = (value) => {
  const [year, month, day] = value.split("-").map(Number);
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

try {
  const info = await getJson(`${server}/api/0/info`);
  const buckets = await getJson(`${server}/api/0/buckets`);
  const bucketIds = Object.keys(buckets);

  console.log(`Connected to ActivityWatch: ${server}`);
  console.log(`Host: ${os.hostname()}`);
  console.log(`Version: ${info.version ?? "unknown"}`);
  console.log(`Buckets: ${bucketIds.length}`);

  const afkBucket = pickBucket(bucketIds, "aw-watcher-afk_");
  const windowBucket = pickBucket(bucketIds, "aw-watcher-window_");

  if (!afkBucket && !windowBucket) {
    console.error("No aw-watcher-afk_* or aw-watcher-window_* bucket found.");
    process.exit(1);
  }

  if (afkBucket) {
    const afkEvents = await getJson(
      `${server}/api/0/buckets/${encodeURIComponent(afkBucket)}/events?start=${encodeURIComponent(dayStart.toISOString())}&end=${encodeURIComponent(dayEnd.toISOString())}`
    );
    const activeSeconds = sumDurations(afkEvents, (event) => event?.data?.status === "not-afk");
    const activeHours = activeSeconds / 3600;
    console.log(`AFK bucket: ${afkBucket}`);
    console.log(`Events on ${targetDate}: ${afkEvents.length}`);
    console.log(`Estimated active hours: ${activeHours.toFixed(2)}h`);
  } else {
    const windowEvents = await getJson(
      `${server}/api/0/buckets/${encodeURIComponent(windowBucket)}/events?start=${encodeURIComponent(dayStart.toISOString())}&end=${encodeURIComponent(dayEnd.toISOString())}`
    );
    const activeSeconds = sumDurations(windowEvents, () => true);
    const activeHours = activeSeconds / 3600;
    console.log(`Window bucket: ${windowBucket}`);
    console.log(`Events on ${targetDate}: ${windowEvents.length}`);
    console.log(`Estimated active hours: ${activeHours.toFixed(2)}h`);
  }
} catch (error) {
  console.error("Could not read ActivityWatch data.");
  console.error(String(error?.message || error));
  process.exit(1);
}
