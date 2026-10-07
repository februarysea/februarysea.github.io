import type { MotionStudy, StudyPose } from "./rig.js";
type Key = readonly [phase: number, value: number];
/** Monotone cubic channels keep the staged lift continuous without overshoot. */
export declare function cleanChannel(keys: readonly Key[]): (phase: number) => number;
/** Internal pose inputs shared by the hang and floor-start variants. */
export interface CleanRigState {
    hipHeight: number;
    hipDepth: number;
    lean: number;
    lift: number;
    rack: number;
    flare: number;
    flight?: number;
    pullBarZ?: number;
}
/**
 * Experimental hang power clean, with an unchanged stance width: hang →
 * extension → high pull → turnover/quarter-squat catch → stand → controlled
 * unrack/reset. This is a staged illustration, not a simulation of bar inertia.
 */
export declare const cleanStudy: MotionStudy;
/** Fixed-length articulated body; the bar contact is separate from rack wrists. */
export declare function cleanRigPose(state: CleanRigState): StudyPose;
export {};
