import { add, blend, BODY, cross, dot, mul, sub, unit, v } from "./rig.js";
import { arm, cycle, stages, study, X } from "./expansion-common.js";
import { bodyUp, foot, quadrupedPose } from "./bodyweight-common.js";
const rotateX = (p, angle) => v(p.x, p.y * Math.cos(angle) - p.z * Math.sin(angle), p.y * Math.sin(angle) + p.z * Math.cos(angle));
function alternate(phase) {
    const t = ((phase % 1) + 1) % 1;
    return { a: cycle((t % .5) * 2), side: t < .5 ? "left" : "right" };
}
const alternateStages = [
    { phase: 0, label: "稳定支撑" }, { phase: .22, label: "左侧动作" }, { phase: .50, label: "回到支撑" }, { phase: .72, label: "右侧动作" },
];
function liftHand(pose, side, amount, targetWrist, targetForward, targetNormal) {
    const sign = side === "left" ? -1 : 1, start = pose.handContacts[side];
    const wrist = blend(pose.joints[`${side}Wrist`], targetWrist, amount);
    arm(pose.joints, side, wrist, blend(v(sign * .5, -.2, -.5), v(sign * .8, -.15, -.2), amount));
    const forward = unit(blend(start.forward, targetForward, amount)), candidate = blend(start.normal, targetNormal, amount);
    const normal = unit(sub(candidate, mul(forward, dot(candidate, forward))));
    pose.handContacts[side] = { center: add(add(wrist, mul(forward, .05)), mul(normal, -.024 * (1 - amount))), forward, normal };
}
export const birdDogStudy = study("bird-dog", "Bird Dog", "鸟狗式", "四点跪姿，对侧手臂与腿伸出后收回，再换另一侧；骨盆保持朝地", phase => {
    const { a, side } = alternate(phase), leg = side === "left" ? "right" : "left", pose = quadrupedPose(), j = pose.joints;
    const up = bodyUp(pose), normal = unit(cross(up, X));
    liftHand(pose, side, a, add(j[`${side}Shoulder`], mul(up, .575)), up, normal);
    const thigh = unit(blend(v(0, -1, 0), mul(up, -1), a)), shin = unit(blend(v(0, .10 / BODY.shin, -Math.sqrt(BODY.shin ** 2 - .10 ** 2) / BODY.shin), mul(up, -1), a * a));
    j[`${leg}Knee`] = add(j[`${leg}Hip`], mul(thigh, BODY.thigh));
    const startFrame = pose.footFrames[leg];
    foot(pose, leg, add(j[`${leg}Knee`], mul(shin, BODY.shin)), unit(blend(startFrame.forward, mul(up, -1), a)), unit(blend(startFrame.normal, normal, a)));
    pose.camera = { yaw: 68, pitch: 18, viewBox: "-10 135 390 220" };
    return pose;
}, alternateStages, 6400);
export const donkeyKickStudy = study("donkey-kick", "Donkey Kick", "跪姿屈膝后抬腿", "双掌与左膝稳定支撑，右膝保持弯曲，从髋部向后上方抬腿再还原", phase => {
    const angle = 1.10 * cycle(phase), pose = quadrupedPose(), j = pose.joints;
    const thigh = rotateX(v(0, -1, 0), angle), shin = rotateX(v(0, .10 / BODY.shin, -Math.sqrt(BODY.shin ** 2 - .10 ** 2) / BODY.shin), angle), frame = pose.footFrames.right;
    j.rightKnee = add(j.rightHip, mul(thigh, BODY.thigh));
    foot(pose, "right", add(j.rightKnee, mul(shin, BODY.shin)), rotateX(frame.forward, angle), rotateX(frame.normal, angle));
    return pose;
}, stages("四点跪姿", "屈膝后抬", "骨盆保持稳定"), 3600);
export const floorBodyweightStudies = [birdDogStudy, donkeyKickStudy];
