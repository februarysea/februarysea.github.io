import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/pet-weight.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { getDailyWeightChart, formatPetWeight } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("empty history stays in preview mode; one reading does not invent a trend", () => {
  assert.equal(getDailyWeightChart([]), null);
  const chart = getDailyWeightChart([{ date: "2026-10-25", kg: 6.3 }]);
  assert.equal(chart.points.length, 1);
  assert.equal(chart.points[0].x, 156);
  assert.equal(chart.fill, null);
  assert.doesNotMatch(chart.curve, /[LC]/);
});

test("sparse readings retain real date spacing and latest weight without filling gaps", () => {
  const input = [
    { date: "2026-10-25", kg: 4.85 },
    { date: "2026-10-01", kg: 5.0 },
    { date: "2026-10-10", kg: 4.7 },
  ];
  const original = structuredClone(input);
  const chart = getDailyWeightChart(input);
  assert.deepEqual(chart.points.map((point) => point.date), ["2026-10-01", "2026-10-10", "2026-10-25"]);
  assert.equal(chart.latest.kg, 4.85);
  const [first, middle, last] = chart.points;
  assert.ok(Math.abs((last.x - middle.x) / (middle.x - first.x) - 15 / 9) < 1e-10);
  assert.equal((chart.curve.match(/L/g) || []).length, 2);
  assert.deepEqual(input, original);
});

test("the 30-day window includes its first date across a year boundary", () => {
  const chart = getDailyWeightChart([
    { date: "2025-12-02", kg: 5.2 },
    { date: "2025-12-03", kg: 5.1 },
    { date: "2026-01-01", kg: 5.0 },
  ]);
  assert.deepEqual(chart.points.map((point) => point.date), ["2025-12-03", "2026-01-01"]);
  assert.equal(chart.points[0].x, 4);
  assert.equal(chart.points[1].x, 156);
});

test("unchanged measurements remain finite and level", () => {
  const chart = getDailyWeightChart([
    { date: "2026-10-20", kg: 6.3 },
    { date: "2026-10-25", kg: 6.3 },
  ]);
  assert.ok(chart.points.every((point) => Number.isFinite(point.y) && point.y === 25));
  assert.equal(formatPetWeight(4.85), "4.85");
  assert.equal(formatPetWeight(5), "5.0");
});

test("invalid dates, nonpositive weights and duplicate days are rejected", () => {
  for (const date of ["2026-02-30", "2026-2-03", "invalid"]) {
    assert.throws(() => getDailyWeightChart([{ date, kg: 5 }]), /Invalid pet weight date/);
  }
  for (const kg of [0, -1, NaN, Infinity]) {
    assert.throws(() => getDailyWeightChart([{ date: "2026-10-25", kg }]), /positive number/);
  }
  assert.throws(() => getDailyWeightChart([
    { date: "2026-10-25", kg: 5 }, { date: "2026-10-25", kg: 4.9 },
  ]), /Duplicate/);
  assert.equal(getDailyWeightChart([{ date: "2024-02-29", kg: 5 }]).latest.date, "2024-02-29");
});
