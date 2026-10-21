import type { StudyPose, Vec3 } from "./rig.js";
export type Apparatus = NonNullable<StudyPose["apparatus"]>;
export type Rod = NonNullable<Apparatus["rods"]>[number];
export type Pad = NonNullable<Apparatus["pads"]>[number];
export type Roller = NonNullable<Apparatus["rollers"]>[number];
export declare const rod: (id: string, a: Vec3, b: Vec3, radius?: number) => Rod;
export declare const pad: (id: string, center: Vec3, axis: Vec3, length: number, width: number, normal?: Vec3, across?: Vec3, thickness?: number) => Pad;
export declare const roller: (id: string, center: Vec3, length: number, radius: number, axis?: Vec3) => Roller;
export declare const middle: (a: Vec3, b: Vec3) => Vec3;
export declare const toe: (ankle: Vec3, forward: Vec3, normal: Vec3) => Vec3;
/** Follow the thighs' support plane instead of cutting a level pad through the shorts. */
export declare function positionSeat(pose: StudyPose, fixedAxis?: Vec3): void;
/** Solve to the palm's shaft center, then recover the anatomical wrist. */
export declare function grip(pose: StudyPose, side: "left" | "right", center: Vec3, axis: Vec3, pole: Vec3): void;
/** Pressing palms face across the shaft, perpendicular to the forearm.
 * Explicitly opt in: a missing palm frame must not turn the fist into an end cap. */
export declare function pressGrip(pose: StudyPose, side: "left" | "right", center: Vec3, axis: Vec3, pole: Vec3): void;
export declare function seated(height?: number, lean?: number, back?: boolean): StudyPose;
export declare function handlesAtSides(pose: StudyPose): void;
/** Ground the complete sole in new seated studies without changing old poses. */
export declare function plantSeatedFeet(pose: StudyPose): void;
/** Compact counterweight tower, kept behind the moving limbs. */
export declare function tower(x: number, z: number, height: number, lift?: number): Rod[];
/** Individually visible solid plates; their whole volume follows the lift. */
export declare function stackPlates(x: number, z: number, lift: number): Pad[];
