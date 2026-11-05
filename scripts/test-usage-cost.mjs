import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const sourceFile = new URL("../src/lib/usage-cost.ts", import.meta.url);
const compiled = ts.transpileModule(readFileSync(sourceFile, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, require: createRequire(sourceFile) });
const { estimateCodexCost, estimateApiCost, estimateUsageCost, usageCost } = module.exports;
const prices = { example: { input: 10, cachedInput: 1, output: 50 } };
const api = { daily: [{ date: "2026-11-03", models: [
  { model: "example", inputTokens: 1000000, cachedInputTokens: 900000, outputTokens: 100000 },
] }] };
const codex = { totalTokens: 650, daily: [
  { date: "2026-01-01", totalTokens: 200 },
  { date: "2026-02-01", totalTokens: 100 },
  { date: "2026-03-01", totalTokens: 300 },
] };

const withCredits = (tokens = 150, credits = "30") => ({ ...codex, archivedThrough: "2026-01-01",
  creditUsage: { source: "codex-analytics-credits", scope: "primary-codex-surfaces", startDate: "2026-01-02", daily: [
    { date: "2026-03-01", totalTokens: tokens, credits },
    // Out-of-coverage samples cannot add tokens or cost, nor rewrite the dual-account archive.
    { date: "2026-01-01", totalTokens: 1, credits: "99999" },
    { date: "2026-04-01", totalTokens: 1, credits: "99999" },
  ] } });

test("all historical and undated tokens use the same credit valuation, without double counting", () => {
  for (const [tokens, creditUsd] of [[150, 2.4], [300, 1.2], [600, 0.6]]) {
    const result = estimateCodexCost(withCredits(tokens), 0.04);
    assert.ok(Math.abs(result.usd - (650 / tokens * 30 * 0.04)) < 1e-9);
    assert.ok(Math.abs(result.creditUsd - creditUsd) < 1e-9);
    assert.equal(result.tokens, 650);
    assert.equal(result.creditRateTokens, 300);
    assert.equal(result.averageRateTokens, 350);
    assert.equal(result.creditRateDays, 1);
    assert.equal(result.adjustedCreditDays, tokens === 300 ? 0 : 1);
    assert.equal(result.unpricedTokens, 0);
    assert.equal(result.sampleTokens, tokens);
    assert.equal(result.sampleCredits, 30);
  }
});

test("historical average weights sample tokens instead of giving every day equal influence", () => {
  const data = withCredits();
  data.creditUsage.daily.push({ date: "2026-02-01", totalTokens: 100, credits: "25" });
  const result = estimateCodexCost(data);
  // Daily estimates: $1 + $2.4. Other 250 tokens: (25+30)*$0.04/(100+150)*250 = $2.2.
  assert.ok(Math.abs(result.usd - 5.6) < 1e-9);
  assert.ok(Math.abs(result.averageUsd - 2.2) < 1e-9);
  assert.equal(result.averageRateTokens, 250);
  assert.equal(result.sampleTokens, 250);
  assert.equal(result.sampleCredits, 55);
});

test("zero/missing credits and incompatible account scope cannot invent a free or unrelated rate", () => {
  assert.equal(estimateCodexCost(withCredits(150, "0")).usd, null);
  assert.equal(estimateCodexCost(withCredits(0)).usd, null);
  const wrongScope = withCredits();
  wrongScope.creditUsage.scope = "another-account";
  assert.equal(estimateCodexCost(wrongScope).usd, null);
  const mixedHistory = withCredits();
  delete mixedHistory.archivedThrough;
  assert.equal(estimateCodexCost(mixedHistory).usd, null);
  const data = withCredits(150, "0");
  data.creditUsage.daily.push({ date: "2026-02-01", totalTokens: 100, credits: "25" });
  const result = estimateCodexCost(data);
  assert.equal(result.usd, 6.5);
  assert.equal(result.averageRateTokens, 550);
});

test("the reference credit price applies equally to current usage and the inferred historical balance", () => {
  const data = withCredits();
  const normal = estimateCodexCost(data, 0.04), double = estimateCodexCost(data, 0.08);
  assert.equal(double.usd, normal.usd * 2);
  assert.equal(double.averageUsd, normal.averageUsd * 2);
  assert.equal(double.creditUsd, normal.creditUsd * 2);
  assert.throws(() => estimateCodexCost(data, 0), /reference value/);
});

test("samples outside positive Profile dates cannot change the historical average", () => {
  const data = withCredits();
  data.daily.push({ date: "2026-04-01", totalTokens: 0 });
  const result = estimateCodexCost(data);
  assert.equal(result.sampleTokens, 150);
  assert.equal(result.sampleCredits, 30);
  assert.ok(Math.abs(result.usd - 5.2) < 1e-9);
  assert.throws(() => estimateCodexCost({ ...data, totalTokens: 1 }), /daily tokens exceed/);
});

test("API input/cache/output prices avoid double counting cache and accept dated model IDs", () => {
  assert.ok(Math.abs(estimateApiCost(api, prices).usd - 6.9) < 1e-9);
  const dated = structuredClone(api);
  dated.daily[0].models[0].model = "example-2026-10-01";
  assert.equal(estimateApiCost(dated, prices).usd, estimateApiCost(api, prices).usd);
});

test("total estimate covers the exact same Codex plus API tokens and does not add billing costs again", () => {
  const result = estimateUsageCost(withCredits(), { ...api, costs: { totalUsd: 999 } }, prices);
  assert.equal(result.tokens, 1100650);
  assert.ok(Math.abs(result.usd - 12.1) < 1e-9);
});

test("unknown model prices or missing Codex samples cannot silently become zero/partial totals", () => {
  assert.equal(estimateUsageCost(withCredits(), api, {}).usd, null);
  assert.equal(estimateUsageCost(codex, api, prices).usd, null);
  assert.equal(estimateCodexCost(codex).unpricedTokens, 650);
  assert.equal(estimateCodexCost({ totalTokens: 0, daily: [] }).usd, 0);
});

test("checked-in estimates cover every token in the checked-in source snapshots", () => {
  const read = name => JSON.parse(readFileSync(new URL(`../src/data/${name}.json`, import.meta.url)));
  const codex = read("codex-profile"), api = read("openai-usage");
  const apiTokens = api.daily.reduce((sum, day) => sum + day.models.reduce((n, row) => n + row.inputTokens + row.outputTokens, 0), 0);
  assert.equal(usageCost.tokens, codex.totalTokens + apiTokens);
  // New unpriced models must not block unrelated site deployments.
  if (usageCost.codex.usd === null || usageCost.api.missingModels.length) assert.equal(usageCost.usd, null);
  else assert.ok(Number.isFinite(usageCost.usd) && usageCost.usd >= 0);
  assert.equal(usageCost.api.tokens, apiTokens);
  assert.equal(usageCost.codex.creditRateTokens + usageCost.codex.averageRateTokens + usageCost.codex.unpricedTokens, codex.totalTokens);
});
