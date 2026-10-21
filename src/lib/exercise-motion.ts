import { exerciseIds, getExercise } from "../../vendor/workout-motion/runtime/h2.js";
import aliases from "../../config/exercise-motion-aliases.json";

// Enode names stay unchanged. Match names/IDs, never guess a different movement.
const normalize = (name: string): string => name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const motions = new Map<string, string | undefined>();
for (const id of exerciseIds) {
  const exercise = getExercise(id);
  if (!exercise) continue;
  for (const name of [id, exercise.label, exercise.chinese]) {
    const key = normalize(name);
    // Ambiguous library names remain unmatched until explicitly configured.
    motions.set(key, motions.has(key) && motions.get(key) !== id ? undefined : id);
  }
}

const overrides = new Map(Object.entries(aliases).map(([name, id]) => [normalize(name), id]));

export function getExerciseMotion(exercise: string): string | undefined {
  const key = normalize(exercise);
  const override = overrides.get(key);
  if (override !== undefined) return getExercise(override) ? override : undefined;
  return motions.get(key);
}
