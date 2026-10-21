import { add, bendJoint, BODY, mul, sub, v } from "./rig.js";
import { cycle, SIDES, stages, study, Y, Z } from "./expansion-common.js";
import { grip, rod, toe } from "./machine-common.js";
import { cableStanding, cableStation } from "./cable-common.js";
const turn = (point, angle) => v(point.x * Math.cos(angle) + point.z * Math.sin(angle), point.y, -point.x * Math.sin(angle) + point.z * Math.cos(angle));
function twoHandHandle(pose, center, axis, outward, anchor) {
    const a = add(center, mul(axis, -.14)), b = add(center, mul(axis, .14)), socket = add(center, mul(outward, .16));
    pose.apparatus = { ...pose.apparatus, rods: [...pose.apparatus.rods, rod("shared-handle", a, b, .012), rod("handle-side-a", a, socket, .008), rod("handle-side-b", b, socket, .008)], cables: [{ id: "handle-cable", a: anchor, b: socket }] };
}
export const pallofPressStudy = study("pallof-press", "Pallof Press", "Pallof 抗旋转推", "侧向滑轮，双手由胸前向正前方推出；胸廓、骨盆和双脚保持方向不变", phase => {
    const a = cycle(phase), pose = cableStanding(true), center = v(0, 1.30, .24 + .395 * a), anchor = v(-.94, 1.30, .03);
    for (const [side, sign] of SIDES) {
        grip(pose, side, add(center, v(0, sign * .055, 0)), Y, v(sign * .6, -.5, .2));
    }
    cableStation(pose, "side", anchor, 1.76);
    twoHandHandle(pose, center, Y, Z, anchor);
    pose.camera = { yaw: 40, pitch: 11, viewBox: "-40 15 435 340" };
    return pose;
}, stages("胸前双手握柄", "向正前方推出", "躯干保持不转"), 3900);
export const cableWoodchopStudy = study("cable-woodchop", "High-to-low Cable Woodchop", "绳索高位伐木", "把手从左肩前向右髋前斜拉，胸廓与骨盆一起转动，脚以前掌为支点跟随转向", phase => {
    const a = cycle(phase), yaw = -.50 + a, pose = cableStanding(true), j = pose.joints;
    for (const name of Object.keys(j))
        j[name] = turn(j[name], yaw);
    for (const [side, sign] of SIDES) {
        const left = side === "left", footYaw = yaw * (left ? .35 : 1), pitch = -.15 * (left ? a : 1 - a);
        const forward = turn(v(0, Math.sin(pitch), Math.cos(pitch)), footYaw), normal = turn(v(0, Math.cos(pitch), -Math.sin(pitch)), footYaw);
        const contact = v(sign * .18, 0, left ? .44 : -.06), ankle = add(sub(contact, mul(forward, .19)), mul(normal, .07));
        j[`${side}Ankle`] = ankle;
        j[`${side}Knee`] = bendJoint(j[`${side}Hip`], ankle, BODY.thigh, BODY.shin, forward);
        j[`${side}Toe`] = toe(ankle, forward, normal);
        (pose.footFrames ??= {})[side] = { forward, normal };
    }
    const local = v(-.30 + .55 * a, 1.56 - .59 * a, .37 - .04 * a), center = turn(local, yaw), axis = turn(v(Math.cos(-72.5 * Math.PI / 180), Math.sin(-72.5 * Math.PI / 180), 0), yaw), anchor = v(-1.0, 1.85, .70);
    for (const [side, sign] of SIDES) {
        grip(pose, side, add(center, mul(axis, sign * .055)), axis, turn(v(sign * .6, -.5, .2), yaw));
    }
    cableStation(pose, "high", anchor, 1.98);
    twoHandHandle(pose, center, axis, turn(Z, yaw), anchor);
    pose.camera = { yaw: 26, pitch: 11, viewBox: "-55 5 455 350" };
    return pose;
}, stages("左肩前高位握柄", "转体斜向下拉", "把手到右髋前"), 4200);
export const coreCableStudies = [pallofPressStudy, cableWoodchopStudy];
