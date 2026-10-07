import type { ExerciseMotion } from "./types.js";
export type { ExerciseMotion, MotionPart, Point } from "./types.js";
export { createPlayer } from "./player.js";
export type { PlayerOptions, WorkoutPlayer } from "./player.js";
export declare const exerciseIds: readonly string[];
export declare function getExercise(id: string): ExerciseMotion | undefined;
export interface SvgOptions {
    phase?: number;
    size?: number;
    title?: string;
}
/** A self-contained still pose; safe to call in Node or during server rendering. */
export declare function renderSvg(id: string, { phase, size, title }?: SvgOptions): string;
