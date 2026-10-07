import type { StudyPose } from "./rig.js";
/** A pronated bar grip: mirrored thumbs point inwards; the palm faces away
 * from the head in the bench pose. Unlike v02, this is not one global cuff
 * pasted onto both wrists. Wrist positions are the rig's bar-contact anchors. */
export declare function gripFrame(pose: StudyPose, name: "left" | "right"): {
    center: import("./rig.js").Vec3;
    reach: import("./rig.js").Vec3;
    along: import("./rig.js").Vec3;
    across: import("./rig.js").Vec3;
    palm: import("./rig.js").Vec3;
    thumb: import("./rig.js").Vec3;
};
