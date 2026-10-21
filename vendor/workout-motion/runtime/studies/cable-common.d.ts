import type { StudyPose, Vec3 } from "./rig.js";
export declare function cableStanding(split?: boolean): StudyPose;
export declare function idleArm(pose: StudyPose, side: "left" | "right"): void;
/** A slim cable column; the cable exits at a real pulley rather than a free point. */
export declare function cableStation(pose: StudyPose, id: string, anchor: Vec3, height?: number): void;
/** A swivelling D handle keeps its rigid frame ahead of the anatomical wrist. */
export declare function attachCableHandle(pose: StudyPose, side: "left" | "right", anchor: Vec3, axisHint?: Vec3, halfWidth?: number): void;
export declare function pullHandle(pose: StudyPose, side: "left" | "right", center: Vec3, anchor: Vec3, pole: Vec3, axisHint?: Vec3, halfWidth?: number): void;
/** Both rope branches have constant length even when their common socket moves. */
export declare function attachRope(pose: StudyPose, anchor: Vec3, branchLength?: number): void;
