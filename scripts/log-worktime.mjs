import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const defaultDataPath = path.resolve(projectRoot, "src/data/worktime.json");

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getFlagValue = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
};
const positionalArgs = [];
{
  const flagsWithValues = new Set(["--hours", "--date", "--out"]);
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
  console.log("Usage: pnpm log:worktime <hours> [--date YYYY-MM-DD] [--yesterday] [--backfill] [--commit] [--push] [--rebase] [--out path]");
  console.log("Example: pnpm log:worktime 9 --yesterday --commit --push --rebase");
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

const dateArg = getFlagValue("--date");
const outArg = getFlagValue("--out");
if (dateArg && hasFlag("--yesterday")) {
  console.error("Use either --date or --yesterday, not both.");
  process.exit(1);
}
if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  console.error("Invalid date format. Use YYYY-MM-DD.");
  process.exit(1);
}

const dataPath = outArg
  ? (path.isAbsolute(outArg) ? outArg : path.resolve(projectRoot, outArg))
  : defaultDataPath;
const dataPathRelative = path.relative(projectRoot, dataPath);
if (dataPathRelative.startsWith("..")) {
  console.error("Output path must be inside this repository.");
  process.exit(1);
}

const today = new Date();
today.setHours(12, 0, 0, 0);
const getOffsetDate = (offsetDays) => {
  const date = new Date(today);
  date.setDate(today.getDate() + offsetDays);
  return formatDate(date);
};

const targetDate = dateArg ?? (hasFlag("--yesterday") ? getOffsetDate(-1) : formatDate(today));
const roundedHours = Math.round(rawHours * 10) / 10;

let data = {};
if (fs.existsSync(dataPath)) {
  const raw = fs.readFileSync(dataPath, "utf-8");
  data = raw.trim().length ? JSON.parse(raw) : {};
}

data[targetDate] = roundedHours;
const sorted = Object.fromEntries(
  Object.entries(data).sort(([a], [b]) => a.localeCompare(b))
);

fs.writeFileSync(dataPath, JSON.stringify(sorted, null, 2) + "\n");

console.log(`Logged ${roundedHours}h for ${targetDate}.`);
console.log(`Updated: ${dataPathRelative}`);

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

if (hasFlag("--commit")) {
  try {
    execSync(`git add ${dataPathRelative}`, {
      cwd: projectRoot,
      stdio: "inherit",
    });
    execSync(`git commit -m "Log worktime ${targetDate}: ${roundedHours}h"`, {
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
      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: projectRoot,
        encoding: "utf-8",
      }).trim();
      execSync(`git pull --rebase origin ${branch}`, {
        cwd: projectRoot,
        stdio: "inherit",
      });
    }
    execSync("git push origin HEAD", { cwd: projectRoot, stdio: "inherit" });
  } catch (error) {
    console.error("Push failed. Fix the error and try again.");
    process.exit(1);
  }
}
