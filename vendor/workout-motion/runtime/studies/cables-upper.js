import { add, BODY, cross, dot, mul, sub, unit, v } from "./rig.js";
import { body, cycle, SIDES, stages, study, X, Y, Z } from "./expansion-common.js";
import { toe, rod } from "./machine-common.js";
import { attachCableHandle, attachRope, cableStanding, cableStation, idleArm, pullHandle } from "./cable-common.js";
function cablePalm(pose, side, facing) {
    const hand = pose.handholds[side], reach = unit(sub(pose.joints[`${side}Wrist`], pose.joints[`${side}Elbow`]));
    hand.palmNormal = mul(unit(cross(hand.axis, reach)), facing);
    hand.thumb = mul(unit(cross(hand.palmNormal, reach)), side === "left" ? -1 : 1);
    pose.localOcclusion = { elbows: true, shoulders: true };
}
function chestFly(phase, low) {
    const a = cycle(phase), pose = cableStanding(), j = pose.joints;
    for (const [side, sign] of SIDES) {
        let upper, forearm;
        if (low) {
            const azimuth = .90 - 1.14 * a, elevation = -1.00 + .85 * a;
            upper = v(sign * Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
            forearm = v(sign * Math.sin(azimuth) * Math.cos(elevation + .28), Math.sin(elevation + .28), Math.cos(azimuth) * Math.cos(elevation + .28));
        }
        else {
            const angle = 1.12 - 1.15 * a;
            upper = v(sign * Math.sin(angle), -Math.sin(.12) * Math.cos(angle), Math.cos(.12) * Math.cos(angle));
            forearm = v(sign * Math.sin(angle - .35), -Math.sin(.12) * Math.cos(angle - .35), Math.cos(.12) * Math.cos(angle - .35));
        }
        j[`${side}Elbow`] = add(j[`${side}Shoulder`], mul(upper, BODY.upperArm));
        j[`${side}Wrist`] = add(j[`${side}Elbow`], mul(forearm, BODY.forearm));
        const anchor = v(sign * .95, low ? .15 : 1.57, -.46);
        cableStation(pose, side, anchor);
        attachCableHandle(pose, side, anchor, Y, .075);
        cablePalm(pose, side, -sign);
    }
    pose.camera = { yaw: 30, pitch: 10, viewBox: "-45 10 445 345" };
    return pose;
}
export const standingCableFlyStudy = study("standing-cable-chest-fly", "Standing Cable Chest Fly", "站姿绳索夹胸", "两侧滑轮略高于肩，肘角保持微屈，双手沿弧线向胸前合拢", p => chestFly(p, false), stages("双臂打开", "弧线向内合拢", "双手接近胸前"), 3900);
export const lowCableFlyStudy = study("low-to-high-cable-fly", "Low-to-high Cable Fly", "低位绳索上斜夹胸", "双手从髋外侧向前上方合拢，保持肘角，低位滑轮始终从下方牵引", p => chestFly(p, true), stages("髋外侧握柄", "向前上方合拢", "把手接近肩高"), 3900);
export const singleArmCableRowStudy = study("single-arm-cable-row", "Standing Single-arm Cable Row", "站姿单臂绳索划船", "站稳并固定躯干，右肘后拉，把手接近同侧下肋，再受控伸臂", phase => {
    const a = cycle(phase), pose = cableStanding(true), anchor = v(.34, 1.12, 1.05);
    idleArm(pose, "left");
    cableStation(pose, "right", anchor);
    pullHandle(pose, "right", v(.30, 1.20 - .12 * a, .63 - .50 * a), anchor, v(.3, -.5, -1));
    pose.camera = { yaw: 52, pitch: 11, viewBox: "-50 15 440 340" };
    return pose;
}, stages("站稳伸臂", "屈肘后拉", "把手靠近下肋"), 3900);
export const kneelingCablePulldownStudy = study("kneeling-single-arm-lat-pulldown", "Kneeling Single-arm Lat Pulldown", "跪姿单臂绳索下拉", "双膝固定地面，高位把手位于头侧；右肘向同侧肋部下降，躯干保持平稳", phase => {
    const a = cycle(phase), hips = v(0, .0415 + BODY.thigh, 0), knees = [v(-.1, .0415, 0), v(.1, .0415, 0)];
    const ankles = knees.map(k => add(k, v(0, .10, -Math.sqrt(BODY.shin ** 2 - .10 ** 2)))), joints = body(hips, Y, [ankles[0], ankles[1]], Z);
    const pose = { joints, feet: "air", apparatus: {}, groundContacts: knees.map(k => v(k.x, 0, k.z)), camera: { yaw: 56, pitch: 10, viewBox: "-35 30 420 325" } };
    for (const [index, [side]] of SIDES.entries()) {
        joints[`${side}Knee`] = knees[index];
        const forward = v(0, -.3, -Math.sqrt(.91)), normal = v(0, Math.sqrt(.91), -.3);
        (pose.footFrames ??= {})[side] = { forward, normal };
        joints[`${side}Toe`] = toe(ankles[index], forward, normal);
    }
    idleArm(pose, "left");
    const anchor = v(.32, 1.90, .66);
    cableStation(pose, "high", anchor, 2.0);
    pullHandle(pose, "right", v(.27 + .03 * a + .045 * Math.sin(Math.PI * a), 1.56 - .62 * a, .17 + .12 * a), anchor, v(.12, -1, -.15), Y, .075);
    cablePalm(pose, "right", -1);
    return pose;
}, stages("双膝着地伸臂", "肘向肋部下降", "右肘收至身侧"), 3900);
export const cableLateralRaiseStudy = study("cable-lateral-raise", "Cable Lateral Raise", "绳索侧平举", "右手跨身握住低位把手，保持肘微屈向右侧抬起；绳索从髋前经过", phase => {
    const a = cycle(phase), pose = cableStanding(), angle = -.38 + 1.95 * a, j = pose.joints;
    const upper = unit(v(Math.sin(angle), -Math.cos(angle), .50)), tangent = v(Math.cos(angle), Math.sin(angle), 0);
    const lower = add(mul(upper, Math.cos(.25)), mul(tangent, -Math.sin(.25)));
    j.rightElbow = add(j.rightShoulder, mul(upper, BODY.upperArm));
    j.rightWrist = add(j.rightElbow, mul(lower, BODY.forearm));
    idleArm(pose, "left");
    const anchor = v(-.65, .15, .26);
    cableStation(pose, "low", anchor, 1.72);
    attachCableHandle(pose, "right", anchor, Z, .075);
    cablePalm(pose, "right", -1);
    pose.camera = { yaw: 26, pitch: 11, viewBox: "-45 15 430 340" };
    return pose;
}, stages("跨身低位握柄", "向外侧抬起", "手臂接近肩高"), 3600);
export const cableReverseFlyStudy = study("cable-reverse-fly", "Cable Reverse Fly", "绳索反向飞鸟", "面对双滑轮并交叉握柄，肘角保持微屈，双手从胸前向两侧打开", phase => {
    const a = cycle(phase), pose = cableStanding(), angle = .05 + 1.37 * a, j = pose.joints;
    for (const [side, sign] of SIDES) {
        // The crossed lines and sockets occupy separate heights in 3D.
        j[`${side}Elbow`] = add(j[`${side}Shoulder`], mul(unit(v(sign * Math.sin(angle), -sign * .06, Math.cos(angle))), BODY.upperArm));
        j[`${side}Wrist`] = add(j[`${side}Elbow`], mul(unit(v(sign * Math.sin(angle - .30), -sign * .06, Math.cos(angle - .30))), BODY.forearm));
        const anchor = v(-sign * .70, 1.535 - sign * .045, 1.01);
        cableStation(pose, side, anchor);
        attachCableHandle(pose, side, anchor);
    }
    pose.camera = { yaw: 132, pitch: 11, viewBox: "-50 0 450 355" };
    return pose;
}, stages("交叉握柄伸臂", "向两侧打开", "肩后侧收紧"), 3900);
export const cableBicepsCurlStudy = study("cable-biceps-curl", "Cable Biceps Curl", "绳索二头弯举", "低位滑轮连接短杆，掌心向上、肘在体侧小幅随动，受控弯举并下放", phase => {
    const a = cycle(phase), pose = cableStanding(), theta = .23 + 2.11 * a, j = pose.joints, reach = v(0, -Math.cos(theta), Math.sin(theta));
    for (const [side, sign] of SIDES) {
        const upperZ = .06 + .025 * a;
        j[`${side}Elbow`] = add(j[`${side}Shoulder`], v(sign * .035, -Math.sqrt(BODY.upperArm ** 2 - .035 ** 2 - upperZ ** 2), upperZ));
        j[`${side}Wrist`] = add(j[`${side}Elbow`], mul(reach, BODY.forearm));
        const palmNormal = mul(unit(cross(X, reach)), -1);
        (pose.handholds ??= {})[side] = { center: add(j[`${side}Wrist`], mul(reach, .05)), axis: X, grip: "neutral", palmNormal, thumb: mul(unit(cross(palmNormal, reach)), sign) };
    }
    const center = { ...pose.handholds.right.center, x: 0 }, anchor = v(0, .13, 1.03);
    cableStation(pose, "low", anchor, 1.80);
    pose.apparatus = { ...pose.apparatus, rods: [...pose.apparatus.rods, rod("curl-bar", add(center, v(-.29, 0, 0)), add(center, v(.29, 0, 0)), .013)], cables: [{ id: "curl-cable", a: anchor, b: center }] };
    pose.localOcclusion = { elbows: true };
    pose.camera = { yaw: 58, pitch: 11, viewBox: "-40 15 435 340" };
    return pose;
}, stages("掌心向上握短杆", "屈肘抬杆", "弯举顶端"), 3600);
export const overheadCableExtensionStudy = study("overhead-cable-triceps-extension", "Overhead Cable Triceps Extension", "绳索过顶臂屈伸", "背向高滑轮、分腿站稳，上臂固定在头两侧，双手从头后向前上方伸展", phase => {
    const a = cycle(phase), pose = cableStanding(true), angle = 3.65 - 2.33 * a, j = pose.joints;
    for (const [side, sign] of SIDES) {
        j[`${side}Elbow`] = add(j[`${side}Shoulder`], mul(unit(v(sign * .15, .94, .25)), BODY.upperArm));
        j[`${side}Wrist`] = add(j[`${side}Elbow`], mul(v(0, Math.sin(angle), Math.cos(angle)), BODY.forearm));
    }
    const anchor = v(0, 1.65, -.83);
    cableStation(pose, "high", anchor, 1.95);
    attachRope(pose, anchor, .34);
    for (const [side, sign] of SIDES) {
        const hand = pose.handholds[side], inward = v(-sign, 0, 0), reach = unit(sub(j[`${side}Wrist`], j[`${side}Elbow`]));
        hand.palmNormal = unit(sub(inward, mul(hand.axis, dot(inward, hand.axis))));
        hand.thumb = mul(unit(cross(hand.palmNormal, reach)), sign);
    }
    pose.localOcclusion = { elbows: true, shoulders: true };
    pose.camera = { yaw: 55, pitch: 10, viewBox: "-40 -15 435 370" };
    return pose;
}, stages("屈肘头后握绳", "伸肘向前上方", "肘部近伸直"), 3700);
export const standingCablePressStudy = study("standing-cable-chest-press", "Standing Cable Chest Press", "站姿绳索推胸", "分腿站稳、固定躯干，双手由胸侧向前推出，肘部明显伸展后受控收回", phase => {
    const a = cycle(phase), pose = cableStanding(true);
    for (const [side, sign] of SIDES) {
        const anchor = v(sign * .88, 1.40, -.46);
        cableStation(pose, side, anchor);
        pullHandle(pose, side, v(sign * (.34 - .14 * a), 1.22 + .12 * a, .32 + .35 * a), anchor, v(sign * .5, -.5, -.25), X, .075);
        cablePalm(pose, side, 1);
    }
    pose.camera = { yaw: 32, pitch: 10, viewBox: "-40 10 430 345" };
    return pose;
}, stages("胸侧握柄", "向前推并伸肘", "双臂接近伸直"), 3900);
export const upperCableStudies = [standingCableFlyStudy, lowCableFlyStudy, singleArmCableRowStudy, kneelingCablePulldownStudy, cableLateralRaiseStudy, cableReverseFlyStudy, cableBicepsCurlStudy, overheadCableExtensionStudy, standingCablePressStudy];
