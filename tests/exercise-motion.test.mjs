import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { exerciseIds, getExercise, renderSvg } from "../vendor/workout-motion/runtime/h2.js";

const aliases = JSON.parse(await readFile(new URL("../config/exercise-motion-aliases.json", import.meta.url), "utf8"));
const source = (await readFile(new URL("../src/lib/exercise-motion.ts", import.meta.url), "utf8"))
  .replace('"../../vendor/workout-motion/runtime/h2.js"', JSON.stringify(new URL("../vendor/workout-motion/runtime/h2.js", import.meta.url).href))
  .replace('import aliases from "../../config/exercise-motion-aliases.json";', `const aliases = ${JSON.stringify(aliases)};`);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
});
const { getExerciseMotion } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("the full catalog resolves by ID, English name and Chinese name without a hand-maintained list", () => {
  for (const id of exerciseIds) {
    const exercise = getExercise(id);
    for (const name of [id, exercise.label, exercise.chinese]) {
      const expected = id === "lateral-raise" && name !== exercise.chinese ? "cable-lateral-raise" : id;
      assert.equal(getExerciseMotion(name), expected, name);
    }
  }
});

test("Enode Lateral Raise uses the selected cable animation, including formatting variants", () => {
  for (const name of ["Lateral Raise", " lateral RAISE ", "Lateral-Raise", "Cable Lateral Raise"]) {
    const id = getExerciseMotion(name);
    assert.equal(id, "cable-lateral-raise");
    assert.match(renderSvg(id, { size: 64, phase: .35 }), /^<svg/);
  }
});

test("the original seven training movements retain their mappings", () => {
  for (const [name, id] of Object.entries({
    "Bench Press": "bench-press", "Overhead Press": "overhead-press", "Landmine Press": "landmine-press",
    "Pull-Up": "pull-up", "Squat": "squat", "Romanian Deadlift": "romanian-deadlift", "Hang Clean": "hang-clean",
  })) assert.equal(getExerciseMotion(name), id);
});

test("normalization tolerates spaces, case and separators without fuzzy movement guesses", () => {
  assert.equal(getExerciseMotion("  CABLE_LATERAL_RAISE  "), "cable-lateral-raise");
  assert.equal(getExerciseMotion("ＰＵＬＬ－ＵＰ"), "pull-up");
  for (const name of ["", "Unknown exercise", "Lateral Rise", "Raise", "__proto__"]) {
    assert.equal(getExerciseMotion(name), undefined);
  }
});
