import type { StudyPose, Vec3 } from "./rig.js";
export interface AnatomyLandmark {
    id: string;
    points: Vec3[];
    width: number;
    /** Average outward surface normal, for back-face suppression by the renderer. */
    normal: Vec3;
}
/**
 * The same H2 pectoral / abdominal drawing in the body's own coordinate frame.
 * t runs from the hip line to the shoulder line; x is lateral distance in metres.
 * It therefore follows a lying bench pose and a leaning squat without screen-space
 * redrawing. All IDs remain present at every phase, including invisible far-side lines.
 */
export declare function torsoLandmarks(pose: StudyPose): AnatomyLandmark[];
