import type { JointName, MotionStudy, StudyPose, Vec3 } from "./rig.js";
export declare const SIDES: readonly [readonly ["left", -1], readonly ["right", 1]];
export declare const X: Vec3;
export declare const Y: Vec3;
export declare const Z: Vec3;
export declare function cycle(phase: number, turn?: number): number;
export declare const stages: (start: string, moving: string, top: string, turn?: number) => {
    phase: number;
    label: string;
}[];
/** New studies use the existing H2 bone lengths; accepted studies stay untouched. */
export declare function body(hips: Vec3, up: Vec3, ankles: readonly [Vec3, Vec3], kneePole?: Vec3): StudyPose["joints"];
export declare const standing: (hipHeight?: number, lean?: number, hipZ?: number) => Record<JointName, Vec3>;
export declare function arm(joints: StudyPose["joints"], side: "left" | "right", wrist: Vec3, pole: Vec3): void;
export declare const dumbbell: (id: string, center: Vec3, axis: Vec3, radius?: number) => {
    id: string;
    center: Vec3;
    axis: Vec3;
    halfLength: number;
    plateRadius: number;
};
export declare function hold(elbow: Vec3, wrist: Vec3, preferred?: Vec3, palmNormal?: Vec3): {
    palmNormal?: Vec3 | undefined;
    center: Vec3;
    axis: Vec3;
    grip: "pronated";
};
export declare function pairWeights(pose: StudyPose, preferred?: Vec3, radius?: number, palmNormal?: Vec3): StudyPose;
/** Opposing palms, both thumbs toward the head end of the dumbbell shaft. */
export declare function neutralPairWeights(pose: StudyPose): StudyPose;
export declare function seat(height?: number): NonNullable<StudyPose["apparatus"]>;
export declare function benchPose(angle?: number, floor?: boolean): StudyPose;
export declare function study(id: string, label: string, chinese: string, subtitle: string, pose: MotionStudy["pose"], keyframes: MotionStudy["keyframes"], durationMs?: number, isometric?: boolean): MotionStudy;
