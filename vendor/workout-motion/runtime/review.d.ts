import type { CharacterView } from "./studies/draw.js";
import type { PlayerOptions, WorkoutPlayer } from "./player.js";
/** B05 review catalog: 29 motions; visual review status is maintained in review/app.js. */
export declare const benchmarkStudies: readonly [import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy];
export declare const batchAStudies: readonly [import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy];
export declare const batchBStudies: readonly [import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy];
export declare const deadliftStudies: readonly [import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy];
export declare const reviewStudies: readonly [import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy, import("./studies/rig.js").MotionStudy];
export declare function renderStudy(id: string, options?: {
    phase?: number;
    size?: number;
    title?: string;
    decorative?: boolean;
}): string;
export declare function renderCharacter(options?: {
    view?: CharacterView;
    size?: number;
}): string;
export declare function renderGripDetail(options: {
    side: "left" | "right";
    size?: number;
}): string;
export declare function createStudyPlayer(host: HTMLElement, id: string, options?: PlayerOptions & {
    title?: string;
    decorative?: boolean;
}): WorkoutPlayer;
