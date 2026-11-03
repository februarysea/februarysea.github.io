import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const sourceFile = new URL("../src/lib/api-usage.ts", import.meta.url);
const compiled = ts.transpileModule(readFileSync(sourceFile, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, require: createRequire(sourceFile), Date, Intl });
const { summarizeApiUsage } = module.exports;
const row = (model, inputTokens, cachedInputTokens, outputTokens) =>
  ({ model, inputTokens, cachedInputTokens, outputTokens, requests: 1 });

test("unconnected API usage stays unknown instead of showing zero", () => {
  const data = summarizeApiUsage({ generatedAt: null, startDate: null, throughDate: null, daily: [] });
  assert.equal(data.connected, false);
  assert.equal(data.totalTokens, null);
  assert.equal(data.recentTokens, null);
  assert.equal(data.models.length, 0);
});

test("model totals combine repeated days, count cached input once, and sort by usage", () => {
  const data = summarizeApiUsage({ generatedAt: "2026-11-03T10:00:00Z", startDate: "2026-10-01", throughDate: "2026-11-02", daily: [
    { date: "2026-10-01", models: [row("model-a", 100, 80, 20)] },
    { date: "2026-10-26", models: [row("model-b", 200, 100, 30)] },
    { date: "2026-10-27", models: [row("model-a", 10, 5, 5)] },
    { date: "2026-11-02", models: [row("model-a", 30, 20, 10)] },
  ] });
  assert.equal(data.totalTokens, 405);
  assert.equal(data.recentTokens, 55);
  assert.equal(data.requests, 4);
  assert.equal(data.models[0].model, "model-b");
  assert.equal(data.models[1].totalTokens, 175);
  assert.equal(data.models[1].cachedInputTokens, 105);
});

test("successfully collected empty days show a known zero", () => {
  const data = summarizeApiUsage({ generatedAt: "2026-11-03T10:00:00Z", startDate: "2026-11-01", throughDate: "2026-11-02", daily: [
    { date: "2026-11-01", models: [] }, { date: "2026-11-02", models: [] },
  ] });
  assert.equal(data.connected, true);
  assert.equal(data.totalTokens, 0);
  assert.equal(data.recentTokens, 0);
});
