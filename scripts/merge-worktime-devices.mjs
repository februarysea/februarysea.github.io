import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const dataDir = path.resolve(projectRoot, "src/data");
const outputPath = path.resolve(dataDir, "worktime.json");

const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const normalizeHours = (value) => Math.round(Number(value) * 10) / 10;

const deviceFiles = fs
  .readdirSync(dataDir)
  .filter((name) => /^worktime\.devices\..+\.json$/.test(name))
  .sort();

if (!deviceFiles.length) {
  console.log("No device files found (src/data/worktime.devices.*.json). Nothing to merge.");
  process.exit(0);
}

const readJsonFile = (filePath) => {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Invalid JSON in ${path.relative(projectRoot, filePath)}`);
    process.exit(1);
  }
};

const baseLog = readJsonFile(outputPath);
const merged = {};
const deviceTotals = {};

for (const [dateKey, hours] of Object.entries(baseLog)) {
  if (!isDateKey(dateKey)) continue;
  const numericHours = Number(hours);
  if (!Number.isFinite(numericHours) || numericHours < 0) continue;
  merged[dateKey] = normalizeHours(numericHours);
}

for (const fileName of deviceFiles) {
  const filePath = path.resolve(dataDir, fileName);
  const json = readJsonFile(filePath);

  for (const [dateKey, hours] of Object.entries(json)) {
    if (!isDateKey(dateKey)) continue;
    const numericHours = Number(hours);
    if (!Number.isFinite(numericHours) || numericHours < 0) continue;
    deviceTotals[dateKey] = normalizeHours((deviceTotals[dateKey] || 0) + numericHours);
  }
}

// For days present in device logs, aggregated device totals are source of truth.
for (const [dateKey, value] of Object.entries(deviceTotals)) {
  merged[dateKey] = normalizeHours(value);
}

const sorted = Object.fromEntries(
  Object.entries(merged).sort(([a], [b]) => a.localeCompare(b))
);

fs.writeFileSync(outputPath, JSON.stringify(sorted, null, 2) + "\n");

console.log(`Merged ${deviceFiles.length} device file(s) into src/data/worktime.json`);
console.log(`Device sources: ${deviceFiles.join(", ")}`);
