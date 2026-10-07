import type { StudyPose } from "./rig.js";
import type { StudyPath } from "./draw.js";
/** Opt-in visible-surface ordering for close hanging arms and low hand-held bars. */
export declare function refineSurfaceDepth(pose: StudyPose, original: StudyPath[]): StudyPath[];
