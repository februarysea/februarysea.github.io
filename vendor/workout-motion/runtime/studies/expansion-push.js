import { add, blend, BODY, cross, mul, sub, unit, v } from "./rig.js";
import { arm, benchPose, cycle, dumbbell, neutralPairWeights, pairWeights, SIDES, stages, standing, study } from "./expansion-common.js";
function press(phase, floor = false) {
    const a = cycle(phase), pose = benchPose(0, floor);
    for (const [side, sign] of SIDES) {
        const shoulder = pose.joints[`${side}Shoulder`];
        // A floor press stops with the upper arm above the floor surface.
        const low = floor ? .175 : .23;
        arm(pose.joints, side, add(shoulder, v(sign * (.19 - .15 * a), low + (.57 - low) * a, .17 * (1 - a))), v(sign * .6, -.25, 1));
    }
    return pairWeights(pose);
}
export const dumbbellBenchPressStudy = study("dumbbell-bench-press", "Dumbbell Bench Press", "平板哑铃卧推", "平凳支撑肩背，两只哑铃从胸侧上推并自然靠拢", p => press(p), stages("胸侧起始", "上推内收", "伸臂顶端"));
export const dumbbellFloorPressStudy = study("dumbbell-floor-press", "Dumbbell Floor Press", "哑铃地板卧推", "屈膝仰卧，地面限制上臂下放幅度，双脚保持支撑", p => press(p, true), stages("地面限位", "推离地面", "伸臂顶端"));
function closeGripBarPress(phase) {
    const a = cycle(phase), pose = benchPose(0), sh = pose.joints.rightShoulder;
    const width = .225;
    const hip = blend(pose.joints.leftHip, pose.joints.rightHip, .5);
    const up = unit(sub(blend(pose.joints.leftShoulder, sh, .5), hip));
    const normal = unit(cross(v(1, 0, 0), up));
    // The shaft rests on the actual chest section, including its 11 mm radius.
    const chestT = .78;
    const chestDepth = .125 - Math.max(0, chestT - .78) / .18 * .025;
    const low = add(add(hip, mul(up, BODY.torso * chestT)), mul(normal, chestDepth + .011));
    const center = blend(low, v(0, sh.y + .615, sh.z), a);
    for (const [side, sign] of SIDES) {
        const grip = v(sign * width, center.y, center.z);
        arm(pose.joints, side, add(grip, v(0, -.05, 0)), v(sign * .16, -.2, 1));
    }
    pose.bar = { center, halfLength: .86, plateRadius: .135, support: "hands", depthPolicy: "physical" };
    pose.grips = { left: v(-width, center.y, center.z), right: v(width, center.y, center.z) };
    return pose;
}
export const closeGripBenchPressStudy = study("close-grip-bench-press", "Close-grip Bench Press", "窄握卧推", "握距略宽于肩，肘靠近躯干，杠铃沿胸部上方受控移动", p => closeGripBarPress(p), stages("窄握胸前", "伸肘上推", "伸臂顶端"));
export const dumbbellFlyStudy = study("dumbbell-fly", "Dumbbell Fly", "哑铃飞鸟", "肘角保持微屈，双臂沿宽弧展开，再合拢至胸部上方", phase => {
    const a = cycle(phase), pose = benchPose(), theta = .17 + 1.29 * a;
    for (const [side, sign] of SIDES) {
        const sh = pose.joints[`${side}Shoulder`];
        const upper = v(sign * Math.sin(theta), Math.cos(theta), 0);
        const fore = v(sign * Math.sin(theta - .34), Math.cos(theta - .34), 0);
        const elbow = add(sh, mul(upper, BODY.upperArm));
        pose.joints[`${side}Elbow`] = elbow;
        pose.joints[`${side}Wrist`] = add(elbow, mul(fore, BODY.forearm));
    }
    pose.camera = { yaw: 32, pitch: 23, viewBox: "-10 75 380 280" };
    return neutralPairWeights(pose);
}, stages("胸上合拢", "弧线展开", "胸侧伸展"), 4200);
/** Both palms support the upper plate of one vertical dumbbell. */
export function cupWeight(pose, wristCenter) {
    // Keep the upper plate at wristY + .035 while the compact lower plate
    // clears the skull during pullovers and overhead elbow extension.
    pose.dumbbells = [{ ...dumbbell("shared", add(wristCenter, v(0, -.04, 0)), v(0, 1, 0), .09), halfLength: .075 }];
    pose.handContacts = {
        left: { center: add(wristCenter, v(-.055, .025, 0)), forward: v(.7, 0, -.7), normal: v(0, 1, 0) },
        right: { center: add(wristCenter, v(.055, .025, 0)), forward: v(-.7, 0, -.7), normal: v(0, 1, 0) },
    };
    return pose;
}
export const dumbbellPulloverStudy = study("dumbbell-pullover", "Dumbbell Pullover", "哑铃仰卧上拉", "双手托住同一只哑铃，肘角近固定，从额头上方沿弧线越过头顶", phase => {
    const pose = benchPose(), theta = .12 + 1.10 * cycle(phase), sh = pose.joints.rightShoulder;
    const wrist = v(0, sh.y + .54 * Math.cos(theta), sh.z - .54 * Math.sin(theta));
    for (const [side, sign] of SIDES)
        arm(pose.joints, side, add(wrist, v(sign * .055, 0, 0)), v(sign, .15, .1));
    pose.camera = { yaw: 72, pitch: 14, viewBox: "-15 75 390 285" };
    return cupWeight(pose, wrist);
}, stages("额头上方", "越过头顶", "受控伸展"), 4200);
export const overheadDumbbellTricepsExtensionStudy = study("overhead-dumbbell-triceps-extension", "Overhead Dumbbell Triceps Extension", "双手哑铃颈后臂屈伸", "双手托一只哑铃，上臂保持头部两旁，屈肘下放至头后再伸肘", phase => {
    const a = cycle(phase), joints = standing(), theta = 2.50 - 2.28 * a;
    const upperY = Math.sqrt(BODY.upperArm ** 2 - .06 ** 2 - .08 ** 2);
    const foreYZ = Math.sqrt(BODY.forearm ** 2 - .085 ** 2);
    for (const [side, sign] of SIDES) {
        const elbow = add(joints[`${side}Shoulder`], v(-sign * .06, upperY, -.08));
        joints[`${side}Elbow`] = elbow;
        joints[`${side}Wrist`] = add(elbow, v(-sign * .085, foreYZ * Math.cos(theta), -foreYZ * Math.sin(theta)));
    }
    const wrist = joints.rightWrist;
    return cupWeight({ joints, camera: { yaw: 110, pitch: 8, viewBox: "35 15 290 330" } }, v(0, wrist.y, wrist.z));
}, stages("屈肘头后", "伸肘上举", "头顶伸臂"));
export const lyingDumbbellTricepsExtensionStudy = study("lying-dumbbell-triceps-extension", "Lying Dumbbell Triceps Extension", "仰卧哑铃臂屈伸", "上臂保持近竖直，前臂折向耳侧，再伸肘回到上方", phase => {
    const pose = benchPose(), theta = 1.80 - 1.69 * cycle(phase);
    for (const [side, sign] of SIDES) {
        const elbow = add(pose.joints[`${side}Shoulder`], v(sign * .035, Math.sqrt(BODY.upperArm ** 2 - .035 ** 2 - .03 ** 2), -.03));
        pose.joints[`${side}Elbow`] = elbow;
        pose.joints[`${side}Wrist`] = add(elbow, v(0, BODY.forearm * Math.cos(theta), -BODY.forearm * Math.sin(theta)));
    }
    return neutralPairWeights(pose);
}, stages("屈肘耳侧", "伸肘上举", "伸臂顶端"));
export const pushExpansionStudies = [dumbbellBenchPressStudy, dumbbellFlyStudy, dumbbellPulloverStudy, closeGripBenchPressStudy, dumbbellFloorPressStudy, overheadDumbbellTricepsExtensionStudy, lyingDumbbellTricepsExtensionStudy];
