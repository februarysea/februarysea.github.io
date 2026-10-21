import type { StudyPose } from "./rig.js";
import type { StudyPath } from "./draw.js";
/** Local equipment cutouts keep far body parts visible above their support plane.
 * No global front-layer override: the rest of the pad/box still hides objects
 * behind it. Fill and outline are separate so cutout edges create no extra ink.
 */
export declare function refineContactOcclusion(pose: StudyPose, parts: StudyPath[]): StudyPath[];
