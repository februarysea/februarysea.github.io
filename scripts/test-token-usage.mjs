import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const sourceFile = new URL("../src/lib/token-usage.ts", import.meta.url);
const compiled = ts.transpileModule(readFileSync(sourceFile, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, require: createRequire(sourceFile), Date, Intl });
const { summarizeUsage, contributionWall, dayLabel } = module.exports;

const snapshot = (daily, generatedAt = "2026-10-14T13:24:23Z") => ({
  generatedAt, totalTokens: 900, daily,
});

test("a delayed daily bucket stays pending and does not extend the trend to zero", () => {
  const summary = summarizeUsage(snapshot([{ date: "2026-10-13", totalTokens: 40 }]));
  assert.equal(summary.dataThrough, "2026-10-13");
  assert.equal(summary.daily.at(-1).totalTokens, null);
  assert.equal(summary.recent.at(-1).date, "2026-10-13");
  assert.equal(summary.recent.at(-1).totalTokens, 40);
  assert.equal(summary.recent[0].date, "2026-10-07");
  assert.equal(summary.recent.length, 7);
  const wall = contributionWall(summary.daily);
  assert.equal(wall.cells.find((day) => day.date === "2026-10-14").pending, true);
  assert.equal(wall.cells.find((day) => day.date === "2026-10-13").pending, false);
  assert.match(dayLabel(summary.daily.at(-1)), /awaiting usage data/);
});

test("an explicitly reported zero remains a real zero and advances the date", () => {
  const summary = summarizeUsage(snapshot([
    { date: "2026-10-14", totalTokens: 0 },
    { date: "2026-10-13", totalTokens: 40 },
  ]));
  assert.equal(summary.dataThrough, "2026-10-14");
  assert.equal(summary.recent.at(-1).totalTokens, 0);
  assert.equal(contributionWall(summary.daily).cells.find((day) => day.date === "2026-10-14").pending, false);
  assert.match(dayLabel(summary.recent.at(-1)), /0 recorded tokens/);
});

test("a 7-day window crosses the year correctly and includes both boundaries only once", () => {
  const summary = summarizeUsage(snapshot([
    { date: "2025-12-25", totalTokens: 500 },
    { date: "2025-12-26", totalTokens: 20 },
    { date: "2025-12-31", totalTokens: 10 },
    { date: "2026-01-01", totalTokens: 30 },
  ], "2026-01-02T01:00:00Z"));
  assert.equal(summary.recent.length, 7);
  assert.equal(summary.recent[0].date, "2025-12-26");
  assert.equal(summary.recent.at(-1).date, "2026-01-01");
  assert.equal(summary.periodTokens, 60);
});

test("an empty service history has an unknown daily total, not a fabricated zero", () => {
  const summary = summarizeUsage(snapshot([]));
  assert.equal(summary.totalTokens, 900);
  assert.equal(summary.dataThrough, null);
  assert.equal(summary.periodTokens, null);
  assert.equal(contributionWall(summary.daily).cells.every((day) => day.pending), true);
});

test("snapshot capture dates use Shanghai time and leave later service dates out", () => {
  const summary = summarizeUsage(snapshot([
    { date: "2026-10-14", totalTokens: 50 },
    { date: "2026-10-16", totalTokens: 100 },
  ], "2026-10-14T17:00:00Z"));
  assert.equal(summary.asOf, "2026-10-15");
  assert.equal(summary.dataThrough, "2026-10-14");
  assert.equal(summary.daily.at(-1).totalTokens, null);
  assert.equal(summary.periodTokens, 50);
});
