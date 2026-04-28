import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const defaultDataPath = path.resolve(projectRoot, "src/data/worktime.json");
const sourceDataDir = path.resolve(projectRoot, "src/data/worktime-sources");

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getFlagValue = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
};
const positionalArgs = [];
{
  const flagsWithValues = new Set(["--hours", "--date", "--device"]);
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token.startsWith("-")) {
      if (flagsWithValues.has(token)) i += 1;
      continue;
    }
    positionalArgs.push(token);
  }
}

const usage = () => {
  console.log("Usage: pnpm log:worktime <hours> [--date YYYY-MM-DD] [--yesterday] [--device NAME] [--add] [--backfill] [--dry-run] [--commit] [--push] [--rebase]");
  console.log("Example: pnpm log:worktime 2.5 --date 2026-02-09 --device mbp --commit --push --rebase");
};

if (hasFlag("-h") || hasFlag("--help")) {
  usage();
  process.exit(0);
}

const hoursArg = positionalArgs[0] ?? getFlagValue("--hours");
const rawHours = hoursArg ? Number(hoursArg) : NaN;

if (!Number.isFinite(rawHours) || rawHours < 0) {
  console.error("Please provide a valid non-negative hours value.");
  usage();
  process.exit(1);
}

const formatDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const parseKeyDate = (key) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
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

const dateArg = getFlagValue("--date");
if (dateArg && hasFlag("--yesterday")) {
  console.error("Use either --date or --yesterday, not both.");
  process.exit(1);
}
if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  console.error("Invalid date format. Use YYYY-MM-DD.");
  process.exit(1);
}

const device = normalizeDevice(getFlagValue("--device"));
const dataPath = device
  ? path.resolve(sourceDataDir, `${device}.json`)
  : defaultDataPath;
const dataPathRelative = path.relative(projectRoot, dataPath);

const today = new Date();
today.setHours(12, 0, 0, 0);
const getOffsetDate = (offsetDays) => {
  const date = new Date(today);
  date.setDate(today.getDate() + offsetDays);
  return formatDate(date);
};

const targetDate = dateArg ?? (hasFlag("--yesterday") ? getOffsetDate(-1) : formatDate(today));
const roundedHours = Math.round(rawHours * 10) / 10;
const shouldAdd = hasFlag("--add");
const isDryRun = hasFlag("--dry-run");

let data = {};
if (fs.existsSync(dataPath)) {
  const raw = fs.readFileSync(dataPath, "utf-8");
  data = raw.trim().length ? JSON.parse(raw) : {};
}

const hasExistingValue = Object.prototype.hasOwnProperty.call(data, targetDate);
const existingHoursRaw = Number(data[targetDate]);
const existingHours = Number.isFinite(existingHoursRaw) ? existingHoursRaw : 0;
const finalHours = shouldAdd
  ? Math.round((existingHours + roundedHours) * 10) / 10
  : roundedHours;
const hasChange = !hasExistingValue || existingHours !== finalHours;

const sorted = Object.fromEntries(
  Object.entries({ ...data, [targetDate]: finalHours }).sort(([a], [b]) => a.localeCompare(b))
);

if (shouldAdd) {
  console.log(`Logged +${roundedHours}h for ${targetDate}${device ? ` (${device})` : ""}.`);
  console.log(`Day total: ${existingHours}h -> ${finalHours}h.`);
} else {
  console.log(`Logged ${finalHours}h for ${targetDate}${device ? ` (${device})` : ""}.`);
}

if (!hasChange) {
  console.log(`No data change for ${dataPathRelative}.`);
} else if (isDryRun) {
  console.log(`Dry run enabled: ${dataPathRelative} was not modified.`);
} else {
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  fs.writeFileSync(dataPath, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`Updated: ${dataPathRelative}`);
}

if (hasFlag("--backfill")) {
  const keys = Object.keys(sorted).sort();
  if (keys.length === 0) {
    console.log("No data yet to backfill.");
  } else {
    const startDate = parseKeyDate(keys[0]);
    const endDate = parseKeyDate(hasFlag("--yesterday") ? getOffsetDate(-1) : formatDate(today));
    const missing = [];
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const key = formatDate(cursor);
      if (!(key in sorted)) missing.push(key);
      cursor.setDate(cursor.getDate() + 1);
    }
    if (missing.length) {
      console.log(`Missing dates (${missing.length}): ${missing.join(", ")}`);
    } else {
      console.log("No missing dates.");
    }
  }
}

if (isDryRun || !hasChange) {
  process.exit(0);
}

if (hasFlag("--commit")) {
  try {
    execFileSync("git", ["add", dataPathRelative], {
      cwd: projectRoot,
      stdio: "inherit",
    });
    const commitHours = shouldAdd
      ? `+${roundedHours}h => ${finalHours}h`
      : `${finalHours}h`;
    const label = device ? `${device} worktime` : "worktime";
    execFileSync("git", ["commit", "-m", `Log ${label} ${targetDate}: ${commitHours}`], {
      cwd: projectRoot,
      stdio: "inherit",
    });
  } catch (error) {
    console.error("Commit failed. Fix the error and try again.");
    process.exit(1);
  }
}

if (hasFlag("--push")) {
  try {
    if (hasFlag("--rebase")) {
      const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: projectRoot,
        encoding: "utf-8",
      }).trim();
      execFileSync("git", ["pull", "--rebase", "--autostash", "origin", branch], {
        cwd: projectRoot,
        stdio: "inherit",
      });
    }
    execFileSync("git", ["push", "origin", "HEAD"], { cwd: projectRoot, stdio: "inherit" });
  } catch (error) {
    console.error("Push failed. Fix the error and try again.");
    process.exit(1);
  }
}
