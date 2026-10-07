import type { StudyPose } from "./rig.js";
/** Shared shoe coordinates for the renderer and apparatus-clearance checks. */
export declare function shoeGeometry(pose: StudyPose, side: "left" | "right"): {
    point: (along: number, lateral: number, height: number) => import("./rig.js").Vec3;
    points: import("./rig.js").Vec3[];
    forward: import("./rig.js").Vec3;
    across: import("./rig.js").Vec3;
    footLength: number;
};
