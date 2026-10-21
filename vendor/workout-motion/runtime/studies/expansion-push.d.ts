import type { StudyPose, Vec3 } from "./rig.js";
export declare const dumbbellBenchPressStudy: import("./rig.js").MotionStudy;
export declare const dumbbellFloorPressStudy: import("./rig.js").MotionStudy;
export declare const closeGripBenchPressStudy: import("./rig.js").MotionStudy;
export declare const dumbbellFlyStudy: import("./rig.js").MotionStudy;
/** Both palms support the upper plate of one vertical dumbbell. */
export declare function cupWeight(pose: StudyPose, wristCenter: Vec3): StudyPose;
export declare const dumbbellPulloverStudy: import("./rig.js").MotionStudy;
export declare const overheadDumbbellTricepsExtensionStudy: import("./rig.js").MotionStudy;
export declare const lyingDumbbellTricepsExtensionStudy: import("./rig.js").MotionStudy;
export declare const pushExpansionStudies: readonly [import("./rig.js").MotionStudy, import("./rig.js").MotionStudy, import("./rig.js").MotionStudy, import("./rig.js").MotionStudy, import("./rig.js").MotionStudy, import("./rig.js").MotionStudy, import("./rig.js").MotionStudy];
