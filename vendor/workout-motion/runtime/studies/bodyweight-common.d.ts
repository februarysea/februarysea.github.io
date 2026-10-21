import type { StudyPose, Vec3 } from "./rig.js";
export declare function floorBody(hips: Vec3, up: Vec3): StudyPose;
/** The actual palm surface rests on the support, while the wrist stays above it. */
export declare function supportHand(pose: StudyPose, side: "left" | "right", surface: Vec3, pole: Vec3, forward?: Vec3, normal?: Vec3): void;
export declare function foot(pose: StudyPose, side: "left" | "right", ankle: Vec3, forward?: Vec3, normal?: Vec3): void;
export declare function legTo(pose: StudyPose, side: "left" | "right", ankle: Vec3, pole: Vec3, forward?: Vec3, normal?: Vec3): void;
export declare function forefootFrame(pitch?: number): {
    forward: Vec3;
    normal: Vec3;
    height: number;
};
/** A high plank with fixed palms and the complete shoe rotating about its forefoot. */
export declare function plankPose(shoulderHeight?: number): StudyPose;
/** Four-point kneeling, with knee surfaces on the floor and unclipped raised shoes. */
export declare function quadrupedPose(): StudyPose;
export declare function bodyUp(pose: StudyPose): Vec3;
