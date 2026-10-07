/** Enode names stay unchanged; these IDs select artwork from workout-motion /h2. */
const exerciseMotions: Readonly<Record<string, string>> = Object.freeze({
  "Bench Press": "bench-press",
  "Overhead Press": "overhead-press",
  "Landmine Press": "landmine-press",
  "Pull-Up": "pull-up",
  "Squat": "squat",
  "Romanian Deadlift": "romanian-deadlift",
  "Hang Clean": "hang-clean",
});

export function getExerciseMotion(exercise: string): string | undefined {
  return Object.hasOwn(exerciseMotions, exercise) ? exerciseMotions[exercise] : undefined;
}
