import type { MotionPart, Point } from "./types.js";
export declare const p: (x: number, y: number) => Point;
export declare const n: (value: number) => string;
export declare const xy: (point: Point) => string;
export declare const lerp: (a: number, b: number, amount: number) => number;
export declare const mix: (a: Point, b: Point, amount: number) => Point;
export declare const cycle: (phase: number) => number;
export declare const line: (...points: Point[]) => string;
export declare const polygon: (...points: Point[]) => string;
export declare const circle: (center: Point, radius: number) => string;
export declare const ink: (id: string, d: string, extras?: Partial<MotionPart>) => MotionPart;
export declare const solid: (id: string, d: string, extras?: Partial<MotionPart>) => MotionPart;
/** Two rigid limb segments meeting at a joint, with a selectable bend direction. */
export declare function joint(start: Point, end: Point, upper: number, lower: number, bend: 1 | -1): Point;
/** A tapered outline around a joint chain, with round ends. */
export declare function limb(points: Point[], radius?: number): string;
/** A barbell kept rigid while its centre and angle change. */
export declare function barbell(id: string, center: Point, halfWidth?: number, angle?: number, plateRadius?: number): MotionPart[];
