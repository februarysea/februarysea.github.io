import type { PlayerOptions, WorkoutPlayer } from "./player.js";
export type { WorkoutPlayer } from "./player.js";
export interface H2Exercise {
    readonly id: string;
    readonly label: string;
    readonly chinese: string;
    readonly subtitle: string;
    readonly durationMs: number;
    readonly keyframes?: readonly Readonly<{
        phase: number;
        label: string;
    }>[];
}
export interface H2SvgOptions {
    phase?: number;
    size?: number;
    title?: string;
    decorative?: boolean;
}
export interface H2PlayerOptions extends PlayerOptions {
    title?: string;
    decorative?: boolean;
}
export declare const exerciseIds: readonly string[];
/** Immutable metadata; the internal joint rig and pose functions remain private. */
export declare function getExercise(id: string): H2Exercise | undefined;
/** Render one H2 pose without accessing the DOM; size <= 80 uses thumbnail detail. */
export declare function renderSvg(id: string, options?: H2SvgOptions): string;
/** Mount the full-detail H2 player; size its host with CSS and destroy on unmount. */
export declare function createPlayer(host: HTMLElement, id: string, options?: H2PlayerOptions): WorkoutPlayer;
