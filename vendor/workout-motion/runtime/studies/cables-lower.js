import { v } from "./rig.js";
import { body, cycle, SIDES, stages, study, Y } from "./expansion-common.js";
import { grip } from "./machine-common.js";
import { attachRope, cableStation } from "./cable-common.js";
export const cablePullThroughStudy = study("cable-pull-through", "Cable Pull-through", "绳索胯下拉", "背向低滑轮，绳把从双腿之间通过；髋向后折叠再伸直，双臂保持近直", phase => {
    const a = cycle(phase), angle = .15 + .95 * a, hips = v(0, .915 - .21 * a, -.30 * a), up = v(0, Math.cos(angle), Math.sin(angle));
    const pose = { joints: body(hips, up, [v(-.22, .07, 0), v(.22, .07, 0)]), feet: "air", shorts: { hipFlexion: true }, apparatus: {}, camera: { yaw: 112, pitch: 12, viewBox: "-40 5 435 350" } };
    for (const [side, sign] of SIDES) {
        const shoulder = pose.joints[`${side}Shoulder`], palm = v(sign * .07, shoulder.y - .605, shoulder.z + .15);
        grip(pose, side, palm, Y, v(sign * .5, -1, 0));
    }
    const anchor = v(0, .14, -1.0);
    cableStation(pose, "low", anchor, 1.70);
    attachRope(pose, anchor, .34);
    return pose;
}, stages("站直握绳", "髋向后折叠", "保持背部平稳"), 4000);
export const lowerCableStudies = [cablePullThroughStudy];
