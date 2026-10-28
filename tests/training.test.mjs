import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/training.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const {
  getTrainingDate,
  getTrainingSummary,
  getSetVolume,
  getWorkSessions,
  getTrainingWindow,
  getTrainingWindowSummary,
  getLatestWorkSession,
  getSessionLifts,
  formatSetReps,
  estimateOneRepMax,
  getOneRepMaxTrends,
  oneRepMaxGeometry,
} = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
const chartSource = await readFile(new URL("../src/lib/velocity-chart.ts", import.meta.url), "utf8");
const { outputText: chartOutput } = ts.transpileModule(chartSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { velocityCeiling, velocityGeometry } = await import(
  `data:text/javascript;base64,${Buffer.from(chartOutput).toString("base64")}`
);

test("Shanghai month boundary and Enode counts drive the card", () => {
  assert.equal(getTrainingDate(new Date("2026-09-30T16:30:00Z")), "2026-10-01");
  const set = { id: "a", exercise: "Squat", weightKg: 80, repCount: 5, work: false, reps: [{ meanVelocityMps: .5 }] };
  const days = [
    { id: "a", date: "2026-09-30", sets: [set] },
    { id: "b", date: "2026-10-01", sets: [set] },
    { id: "c", date: "2026-10-01", sets: [set] },
  ];
  assert.deepEqual(getTrainingSummary(days, "2026-10"), { trainingDays: 1, sets: 2, volumeKg: 800, unknownLoadSets: 0 });
  assert.equal(getSetVolume({ ...set, weightKg: null }), null);
  assert.equal(getSetVolume({ ...set, weightKg: 0 }), 0);
});

test("missing load is flagged and a month without training has zero totals", () => {
  const sessions = [{ id: "day", date: "2026-10-01", sets: [{
    id: "set", exercise: "Squat", weightKg: null, repCount: 5, work: true, reps: [],
  }] }];
  assert.deepEqual(getTrainingSummary(sessions, "2026-10"), { trainingDays: 1, sets: 1, volumeKg: 0, unknownLoadSets: 1 });
  assert.deepEqual(getTrainingSummary(sessions, "2026-11"), { trainingDays: 0, sets: 0, volumeKg: 0, unknownLoadSets: 0 });
});

const workSet = (id, overrides = {}) => ({
  id, exercise: "Squat", weightKg: 80, repCount: 5, work: true, reps: [], ...overrides,
});

test("Epley estimates exclude warm-ups, invalid loads and high-rep sets", () => {
  assert.equal(estimateOneRepMax(workSet("a", { weightKg: 60, repCount: 5 })), 70);
  assert.equal(estimateOneRepMax(workSet("a", { weightKg: 100, repCount: 1 })), 100);
  assert.ok(Math.abs(estimateOneRepMax(workSet("a", { weightKg: 95 })) - 110.8333333333) < 1e-8);
  for (const overrides of [
    { work: false }, { work: null }, { weightKg: null }, { weightKg: 0 }, { weightKg: -1 },
    { weightKg: NaN }, { weightKg: Infinity }, { repCount: 0 }, { repCount: 11 },
    { repCount: 2.5 }, { repCount: NaN }, { repCount: Infinity },
  ]) assert.equal(estimateOneRepMax(workSet("invalid", overrides)), null);
});

test("curves use each day's best set since October 20, independent of the 30-day calendar", () => {
  const sessions = [
    { id: "old", date: "2026-10-01", sets: [workSet("old", { weightKg: 200 })] },
    { id: "a", date: "2026-10-20", sets: [workSet("a", { weightKg: 100, repCount: 3 })], oneRepMax: [{ exercise: "Squat", valueKg: 500 }] },
    { id: "b", date: "2026-10-20", sets: [workSet("b", { weightKg: 90 }), workSet("warmup", { weightKg: 200, work: false })] },
    { id: "c", date: "2026-10-22", sets: [workSet("c", { weightKg: null })] },
    { id: "d", date: "2026-10-26", sets: [workSet("d", { weightKg: 95 })] },
    { id: "variants", date: "2026-10-26", sets: [workSet("rdl", { exercise: "Romanian Deadlift", weightKg: 170 }), workSet("sumo", { exercise: "Sumo Deadlift", weightKg: 60 }), workSet("front", { exercise: "Front Squat", weightKg: 150 })] },
    { id: "future", date: "2026-10-29", sets: [workSet("future", { weightKg: 300 })] },
  ];
  const [squat, bench, deadlift] = getOneRepMaxTrends(sessions, "2026-10-20", "2026-10-28");
  assert.deepEqual(squat.points.map(p => p.date), ["2026-10-20", "2026-10-22", "2026-10-26"]);
  assert.ok(Math.abs(squat.points[0].valueKg - 110) < 1e-10);
  assert.equal(squat.points[1].valueKg, null);
  assert.ok(Math.abs(squat.latest.valueKg - 110.8333333333) < 1e-8);
  assert.equal(bench.latest, null);
  assert.equal(deadlift.latest.valueKg, 70);
  assert.equal(deadlift.count, 1);
  assert.equal(getTrainingWindowSummary(sessions, getTrainingWindow("2026-10-28")).trainingDays, 4);
  assert.equal(sessions[0].sets[0].weightKg, 200);
});

test("strength charts use calendar spacing, a common kg scale and break at missing estimates", () => {
  const plot = oneRepMaxGeometry([
    { date: "2026-10-01", valueKg: 100 }, { date: "2026-10-02", valueKg: 110 },
    { date: "2026-10-03", valueKg: null }, { date: "2026-10-06", valueKg: 120 },
  ], "2026-10-01", "2026-10-07", 150);
  assert.equal(plot.segments.length, 1);
  assert.equal(plot.points.length, 3);
  assert.equal(plot.points[2].x - plot.points[0].x, 5 * (plot.points[1].x - plot.points[0].x));
  const single = oneRepMaxGeometry([{ date: "2026-10-01", valueKg: 100 }], "2026-10-01", "2026-10-07", 150);
  assert.equal(single.segments.length, 0);
  assert.equal(single.points[0].y, plot.points[0].y);
});

test("set description shows reps per set rather than summed repetitions", () => {
  assert.equal(formatSetReps(Array.from({ length: 5 }, (_, index) => workSet(String(index)))), "5 sets / 5 reps");
  assert.equal(formatSetReps(Array.from({ length: 3 }, (_, index) => workSet(String(index), { repCount: 8 }))), "3 sets / 8 reps");
  assert.equal(formatSetReps([{ repCount: 1 }]), "1 set / 1 rep");
  assert.equal(formatSetReps([]), "0 sets / 0 reps");
});

test("unequal repetition counts are shown in set order without averaging or collapsing to a range", () => {
  const sets = Object.freeze([Object.freeze({ repCount: 8 }), Object.freeze({ repCount: 6 }), Object.freeze({ repCount: 5 })]);
  assert.equal(formatSetReps(sets), "3 sets / 8·6·5 reps");
  assert.equal(formatSetReps([{ repCount: 5 }, { repCount: 3 }, { repCount: 5 }]), "3 sets / 5·3·5 reps");
});

test("work-only sessions exclude warm-ups and unknown statuses without changing input", () => {
  const warmup = Object.freeze(workSet("warmup", { work: false }));
  const unknown = Object.freeze(workSet("unknown", { work: null }));
  const working = Object.freeze(workSet("working"));
  const sessions = Object.freeze([
    Object.freeze({ id: "a", date: "2026-09-27", sets: Object.freeze([warmup, unknown]) }),
    Object.freeze({ id: "b", date: "2026-09-28", sets: Object.freeze([warmup, working, unknown]) }),
    Object.freeze({ id: "empty", date: "2026-09-29", sets: Object.freeze([]) }),
  ]);
  assert.deepEqual(getWorkSessions(sessions), [{ id: "b", date: "2026-09-28", sets: [working] }]);
  assert.equal(sessions[1].sets.length, 3);
});

test("rolling windows contain exactly 30 inclusive calendar dates across year and leap boundaries", () => {
  const window = getTrainingWindow("2026-01-10");
  assert.equal(window.from, "2025-12-12");
  assert.equal(window.to, "2026-01-10");
  assert.equal(window.dates.length, 30);
  assert.equal(new Set(window.dates).size, 30);
  const leapWindow = getTrainingWindow("2024-03-01");
  assert.equal(leapWindow.from, "2024-02-01");
  assert.ok(leapWindow.dates.includes("2024-02-29"));
  assert.throws(() => getTrainingWindow("2026-02-30"), RangeError);
});

test("previous month windows include the entire month, including leap day and December", () => {
  for (const [today, from, to, length] of [
    ["2024-03-31", "2024-02-01", "2024-02-29", 29],
    ["2025-03-01", "2025-02-01", "2025-02-28", 28],
    ["2026-01-15", "2025-12-01", "2025-12-31", 31],
    ["2026-10-07", "2026-09-01", "2026-09-30", 30],
  ]) {
    const window = getTrainingWindow(today, "previousMonth");
    assert.equal(window.from, from);
    assert.equal(window.to, to);
    assert.equal(window.dates.length, length);
  }
});

test("window summaries count formal sets at both boundaries and unique dates and exercises", () => {
  const sessions = [
    { id: "before", date: "2026-09-07", sets: [workSet("before")] },
    { id: "first", date: "2026-09-08", sets: [workSet("first"), workSet("warmup", { work: false })] },
    { id: "also-first", date: "2026-09-08", sets: [workSet("also-first", { repCount: 3 })] },
    { id: "unknown", date: "2026-09-09", sets: [workSet("unknown", { work: null })] },
    { id: "last", date: "2026-10-07", sets: [workSet("last", { exercise: "Pull-Up", weightKg: null, repCount: 8 })] },
    { id: "after", date: "2026-10-08", sets: [workSet("after")] },
  ];
  const window = getTrainingWindow("2026-10-07");
  assert.deepEqual(getTrainingWindowSummary(sessions, window), { trainingDays: 2, sets: 3, reps: 16, exerciseCount: 2 });
  assert.deepEqual(getTrainingWindowSummary([], window), { trainingDays: 0, sets: 0, reps: 0, exerciseCount: 0 });
});

test("latest work session ignores newer non-work days and merges records on the same date", () => {
  const sessions = [
    { id: "first-record", date: "2026-09-28", sets: [workSet("first"), workSet("warmup", { work: false })] },
    { id: "newer", date: "2026-10-01", sets: [workSet("unknown", { work: null })] },
    { id: "older", date: "2026-09-20", sets: [workSet("older")] },
    { id: "second-record", date: "2026-09-28", sets: [workSet("second")] },
  ];
  assert.deepEqual(getLatestWorkSession(sessions), {
    id: "first-record", date: "2026-09-28", sets: [workSet("first"), workSet("second")],
  });
  assert.equal(getLatestWorkSession([sessions[1]]), null);
  assert.equal(getLatestWorkSession([]), null);
  assert.equal(sessions[0].sets.length, 2);
});

test("lift velocity statistics use individual recorded reps and preserve missing observations", () => {
  const session = { id: "day", date: "2026-09-28", sets: [
    workSet("warmup", { work: false, reps: [{ meanVelocityMps: 10 }] }),
    workSet("first", { weightKg: 40, repCount: 3, reps: [{ meanVelocityMps: .2 }, {}, { meanVelocityMps: .4 }] }),
    workSet("other", { exercise: "Bench Press", weightKg: 0, repCount: 1, reps: [{ meanVelocityMps: 0 }] }),
    workSet("second", { weightKg: 60, repCount: 3, reps: [{ meanVelocityMps: 1 }, { meanVelocityMps: null }] }),
    workSet("missing", { weightKg: null, repCount: 3, reps: [{ meanVelocityMps: NaN }, { meanVelocityMps: -1 }, { meanVelocityMps: Infinity }] }),
    workSet("unknown", { work: null, reps: [{ meanVelocityMps: 15 }] }),
  ] };
  const [squat, bench] = getSessionLifts(session);
  assert.equal(squat.exercise, "Squat");
  assert.equal(squat.setCount, 3);
  assert.equal(squat.repCount, 9);
  assert.deepEqual(squat.sets.map((set) => set.id), ["first", "second", "missing"]);
  assert.deepEqual(squat.weights, [40, 60, null]);
  assert.equal(squat.loadLabel, "40–60 kg · 1 unknown load");
  assert.ok(Math.abs(squat.meanVelocityMps - (1.6 / 3)) < 1e-12);
  assert.equal(squat.maxRepMeanVelocityMps, 1);
  assert.ok(Math.abs(squat.setVelocities[0] - .3) < 1e-12);
  assert.deepEqual(squat.setVelocities.slice(1), [1, null]);
  assert.deepEqual(squat.repVelocitiesBySet, [[.2, null, .4], [1, null, null], [null, null, null]]);
  assert.equal(bench.loadLabel, "0 kg");
  assert.equal(bench.meanVelocityMps, 0);
  assert.equal(bench.maxRepMeanVelocityMps, 0);
});

test("all-unknown loads and velocities remain absent, never Infinity or inferred zero", () => {
  const [lift] = getSessionLifts({ id: "day", date: "2026-09-28", sets: [workSet("a", { weightKg: null, repCount: 2 })] });
  assert.equal(lift.loadLabel, "Load not recorded");
  assert.deepEqual(lift.weights, [null]);
  assert.equal(lift.meanVelocityMps, null);
  assert.equal(lift.maxRepMeanVelocityMps, null);
  assert.deepEqual(lift.setVelocities, [null]);
  assert.deepEqual(lift.repVelocitiesBySet, [[null, null]]);
  assert.deepEqual(getSessionLifts(null), []);
});

test("velocity geometry leaves gaps at missing or invalid measurements and preserves actual zero", () => {
  const plot = velocityGeometry([0, .5, null, 1, NaN, Infinity, -1, .25], 70, 20, 1, 0);
  assert.deepEqual(plot.points, [
    { index: 0, value: 0, x: 0, y: 20 },
    { index: 1, value: .5, x: 10, y: 10 },
    { index: 3, value: 1, x: 30, y: 0 },
    { index: 7, value: .25, x: 70, y: 15 },
  ]);
  assert.deepEqual(plot.segments.map((segment) => segment.trim().split(" ").length), [2, 1, 1]);
  assert.deepEqual(velocityGeometry([null, null], 70, 20, 1), { points: [], segments: [] });
});

test("short sets share rep coordinates with longer sets when the common domain is padded with gaps", () => {
  const longSet = velocityGeometry([.2, .4, .6, .8, 1], 600, 176, 1.25, 0);
  const shortSet = velocityGeometry([.3, .5, null, null, null], 600, 176, 1.25, 0);
  assert.deepEqual(shortSet.points.map((point) => point.x), longSet.points.slice(0, 2).map((point) => point.x));
  assert.deepEqual(shortSet.points.map((point) => point.index), [0, 1]);
  assert.equal(shortSet.points.at(-1).x, 150);
  assert.equal(velocityGeometry([.5], 600, 176, 1).points[0].x, 300);
});

test("velocity ceiling stays finite for absent data and does not clip observed values", () => {
  assert.equal(velocityCeiling([null, NaN, Infinity, -1]), .5);
  assert.equal(velocityCeiling([0]), .5);
  const ceiling = velocityCeiling([.4342, null, 1.157]);
  assert.ok(ceiling > 1.157);
  const plot = velocityGeometry([.4342, 1.157], 600, 176, ceiling, 0);
  assert.ok(plot.points.every((point) => point.y > 0 && point.y < 176));
  assert.equal(plot.points[1].value, 1.157);
});
