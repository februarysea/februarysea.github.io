import type { Vec3 } from "./rig.js";
/** Lowest point of the H2 rounded leg outline in its sagittal YZ plane. */
export declare function sagittalLegFloor(hip: Vec3, knee: Vec3, ankle: Vec3): number;
/** Keep the shoulder target fixed while the rounded knee rolls on the floor. */
export declare function kneePushUpHeight(shoulderY: number): number;
