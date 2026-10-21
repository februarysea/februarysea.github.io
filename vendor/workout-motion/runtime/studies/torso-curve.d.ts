import type { StudyPose, Vec3 } from "./rig.js";
export interface TorsoFrame {
    center: Vec3;
    up: Vec3;
    side: Vec3;
    front: Vec3;
}
export declare const TORSO_SECTIONS: readonly [readonly [0.02, 0.152, 0.086], readonly [0.16, 0.146, 0.092], readonly [0.34, 0.14, 0.096], readonly [0.54, 0.17, 0.117], readonly [0.78, 0.215, 0.125], readonly [0.96, 0.215, 0.1], readonly [1.04, 0.142, 0.077], readonly [1.14, 0.057, 0.052]];
export declare function rotateAbout(vector: Vec3, axis: Vec3, angle: number): Vec3;
/** t is normalized arc length, so bending never changes the .49 m body length. */
export declare function torsoFrameAt(pose: StudyPose, t: number): TorsoFrame;
export declare function torsoRadii(t: number): {
    width: number;
    depth: number;
};
export declare function torsoSurfaceAt(pose: StudyPose, t: number, angle: number): Vec3;
/** Original anatomical (t,x) coordinates mapped onto the curved H2 surface. */
export declare function torsoSurfaceLocal(pose: StudyPose, t: number, x: number): {
    point: Vec3;
    normal: Vec3;
};
/** Shoulder, neck and head endpoints are generated from the same curve as the skin. */
export declare function applyTorsoCurve(pose: StudyPose, curve: NonNullable<StudyPose["torsoCurve"]>): void;
/** Entire elliptical rings, including the inner side of the bend, against a plane. */
export declare function torsoPlaneDistance(pose: StudyPose, t: number, normal: Vec3, point?: Vec3): number;
