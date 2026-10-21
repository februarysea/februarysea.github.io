import { add, BODY, cross, mul, v } from "./rig.js";
import { cycle, SIDES, stages, study, X, Y, Z } from "./expansion-common.js";
import { grip, pad, rod } from "./machine-common.js";
import { floorBody, foot, forefootFrame, legTo, supportHand } from "./bodyweight-common.js";
import { kneePushUpHeight } from "./floor-contact.js";
export const inclinePushUpStudy = study("incline-push-up", "Incline Push-up", "上斜俯卧撑", "双掌撑在固定高台，前掌着地，身体整体向台沿下降后推起", phase => {
    const a = cycle(phase), frame = forefootFrame(), angle = Math.asin((1.239 - .349 * a - frame.height) / 1.358), up = v(0, Math.sin(angle), Math.cos(angle));
    const pose = floorBody(add(v(0, frame.height, -.30), mul(up, .868)), up);
    for (const [side, sign] of SIDES) {
        legTo(pose, side, v(sign * .10, frame.height, -.30), v(0, -1, 0), frame.forward, frame.normal);
        supportHand(pose, side, v(sign * .27, .65, .80), v(sign * .7, 0, -.6));
    }
    pose.apparatus = { pads: [pad("support", v(0, .65, .945), Z, .39, .90)], rods: [rod("front-foot", v(-.50, .025, .84), v(.50, .025, .84)), rod("back-foot", v(-.50, .025, 1.08), v(.50, .025, 1.08)), ...[-1, 1].map(sign => rod(`stand-${sign}`, v(sign * .36, .025, .96), v(sign * .36, .585, .96)))] };
    pose.camera = { yaw: 67, pitch: 15, viewBox: "-5 100 385 255" };
    return pose;
}, stages("高台撑起", "整体向台沿下降", "屈肘低位"), 3600);
export const kneePushUpStudy = study("knee-push-up", "Knee Push-up", "跪姿俯卧撑", "双掌和双膝固定，肩至膝保持整体关系，小腿抬起，屈肘后推回", phase => {
    const a = cycle(phase), shoulderY = .604 - .364 * a;
    const kneeY = kneePushUpHeight(shoulderY);
    const angle = Math.asin((shoulderY - kneeY) / (BODY.thigh + BODY.torso)), up = v(0, Math.sin(angle), Math.cos(angle));
    const pose = floorBody(add(v(0, kneeY, -.40), mul(up, BODY.thigh)), up);
    for (const [side, sign] of SIDES) {
        const knee = v(sign * .10, kneeY, -.40), ankle = add(knee, v(0, .21, -Math.sqrt(BODY.shin ** 2 - .21 ** 2)));
        pose.joints[`${side}Knee`] = knee;
        foot(pose, side, ankle, v(0, -.3, -Math.sqrt(.91)), v(0, Math.sqrt(.91), -.3));
        supportHand(pose, side, v(sign * .27, 0, .40), v(sign * .8, .15, -.6));
    }
    return pose;
}, stages("双膝支撑", "整体下降", "屈肘低位"), 3500);
export const pikePushUpStudy = study("pike-push-up", "Pike Push-up", "折刀俯卧撑", "髋部保持抬高，固定双掌与前掌，头部向两手之间下降后推起", phase => {
    const a = cycle(phase), uy = -.53 - .42 * a, up = v(0, uy, Math.sqrt(1 - uy ** 2)), frame = forefootFrame(), pose = floorBody(v(0, .86, 0), up);
    for (const [side, sign] of SIDES) {
        legTo(pose, side, v(sign * .10, frame.height, -.56), v(0, 1, -.3), frame.forward, frame.normal);
        supportHand(pose, side, v(sign * .30, 0, .32), v(sign * .8, .1, -.1));
    }
    pose.camera = { yaw: 70, pitch: 16, viewBox: "10 145 340 210" };
    return pose;
}, stages("髋部抬高支撑", "屈肘降低头部", "头接近两手之间"), 3600);
export const invertedRowStudy = study("inverted-row", "Inverted Row", "反向划船", "双手握固定低杆，脚跟着地，身体保持直线，胸部拉向杆后还原", phase => {
    const a = cycle(phase), pitch = .25, forward = v(0, Math.sin(pitch), Math.cos(pitch)), normal = v(0, Math.cos(pitch), -Math.sin(pitch));
    const ankleY = .065 * forward.y + .07 * normal.y, angle = Math.asin((.280 + .462 * a - ankleY) / 1.358), up = v(0, Math.sin(angle), -Math.cos(angle));
    const topAngle = Math.asin((.742 - ankleY) / 1.358), topUp = v(0, Math.sin(topAngle), -Math.cos(topAngle)), topShoulders = add(v(0, ankleY, .85), mul(topUp, 1.358));
    const bar = add(add(topShoulders, mul(topUp, -.1078)), mul(cross(X, topUp), .140));
    const pose = floorBody(add(v(0, ankleY, .85), mul(up, .868)), up);
    for (const [side, sign] of SIDES) {
        legTo(pose, side, v(sign * .10, ankleY, .85), Y, forward, normal);
        grip(pose, side, add(bar, v(sign * .29, 0, 0)), X, v(sign * .8, -.3, .3));
        pose.handholds[side].grip = "pronated";
    }
    pose.apparatus = { rods: [rod("row-bar", add(bar, v(-.54, 0, 0)), add(bar, v(.54, 0, 0)), .015), ...[-1, 1].flatMap(sign => [rod(`post-${sign}`, v(sign * .54, .025, bar.z), add(bar, v(sign * .54, .20, 0))), rod(`foot-${sign}`, v(sign * .54, .025, bar.z - .28), v(sign * .54, .025, bar.z + .28))])] };
    pose.camera = { yaw: 65, pitch: 17, viewBox: "-10 140 390 210" };
    return pose;
}, stages("伸臂悬垂", "保持直线拉起", "胸部靠近低杆"), 3700);
export const upperBodyweightStudies = [inclinePushUpStudy, kneePushUpStudy, pikePushUpStudy, invertedRowStudy];
