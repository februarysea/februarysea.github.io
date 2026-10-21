import type { StudyPose, Vec3 } from "./rig.js";
import { study } from "./expansion-common.js";
/** A fixed pelvis support: flexion lifts the thorax without sliding the feet. */
export declare const SUPINE_PELVIS_ANGLE = 0.023200303690842472;
export declare function coreStudy(...args: Parameters<typeof study>): ReturnType<typeof study>;
export declare function supineCore(flexion?: number, twist?: number, lateral?: number): StudyPose;
/** An explicit open palm frame avoids world-X hands on a rotated thorax. */
export declare function coreHand(pose: StudyPose, side: "left" | "right", wrist: Vec3, pole: Vec3, forward: Vec3, normal: Vec3): void;
export declare function straightLeg(pose: StudyPose, side: "left" | "right", direction: Vec3, soleNormal?: Vec3): void;
