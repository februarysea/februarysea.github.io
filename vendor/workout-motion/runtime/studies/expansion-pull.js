import { add, bendJoint, BODY, cross, dot, mul, sub, unit, v } from "./rig.js";
import { arm, benchPose, body, cycle, dumbbell, hold, pairWeights, seat, SIDES, stages, standing, study, X, Z } from "./expansion-common.js";
function supinatedWeights(pose, one = false) {
    const hands = {}, weights = [];
    for (const [side, sign] of SIDES) {
        if (one && side === "left")
            continue;
        const e = pose.joints[`${side}Elbow`], w = pose.joints[`${side}Wrist`], r = unit(sub(w, e));
        const h = hold(e, w, X, v(0, r.z, -r.y));
        hands[side] = { ...h, ...(pose.localOcclusion?.handheld ? { thumb: mul(unit(cross(h.palmNormal, r)), sign) } : {}) };
        weights.push({ ...dumbbell(side, h.center, h.axis, .072), halfLength: .095 });
    }
    return { ...pose, handholds: hands, dumbbells: weights };
}
function curl(pose, phase) {
    const theta = .12 + 2.28 * cycle(phase);
    const outward = pose.apparatus?.pads ? .165 : .13;
    for (const [side, sign] of SIDES) {
        const elbow = add(pose.joints[`${side}Shoulder`], v(sign * outward, -Math.sqrt(BODY.upperArm ** 2 - outward ** 2 - .12 ** 2), .12));
        pose.joints[`${side}Elbow`] = elbow;
        pose.joints[`${side}Wrist`] = add(elbow, v(0, -BODY.forearm * Math.cos(theta), BODY.forearm * Math.sin(theta)));
    }
    return supinatedWeights(pose);
}
export const dumbbellCurlStudy = study("dumbbell-curl", "Dumbbell Curl", "哑铃弯举", "掌心从斜向前自然旋至向上，肘在体侧小幅随动，受控弯举并下放", phase => {
    const a = cycle(phase), joints = standing(), pose = { joints, camera: { yaw: 48, pitch: 9 }, localOcclusion: { handheld: true, elbows: true } };
    for (const [side, sign] of SIDES) {
        const upperZ = .06 + .025 * a;
        const elbow = add(joints[`${side}Shoulder`], v(sign * .07, -Math.sqrt(BODY.upperArm ** 2 - .07 ** 2 - upperZ ** 2), upperZ));
        const theta = .12 + 2.22 * a, foreYZ = Math.sqrt(BODY.forearm ** 2 - .065 ** 2);
        joints[`${side}Elbow`] = elbow;
        joints[`${side}Wrist`] = add(elbow, v(sign * .065, -foreYZ * Math.cos(theta), foreYZ * Math.sin(theta)));
    }
    const weighted = supinatedWeights(pose);
    for (const [side, sign] of SIDES) {
        const hand = weighted.handholds[side], reach = unit(sub(joints[`${side}Wrist`], joints[`${side}Elbow`]));
        const supinated = unit(v(0, reach.z, -reach.y)), turn = .55 * (1 - a), across = unit(sub(X, mul(reach, dot(X, reach))));
        hand.axis = unit(add(mul(across, Math.cos(turn)), mul(supinated, sign * Math.sin(turn))));
        hand.palmNormal = unit(cross(hand.axis, reach));
        hand.palmNormal = mul(hand.palmNormal, -1);
        hand.thumb = mul(unit(cross(hand.palmNormal, reach)), sign);
        weighted.dumbbells = weighted.dumbbells.map(d => d.id === side ? { ...d, axis: hand.axis } : d);
    }
    return weighted;
}, stages("自然悬垂", "旋掌屈肘", "掌心向上收缩"), 3900);
export const inclineDumbbellCurlStudy = study("incline-dumbbell-curl", "Incline Dumbbell Curl", "上斜哑铃弯举", "60°斜凳支撑背部，双臂自然悬垂，上臂稳定地完成反握弯举", p => {
    const pose = benchPose(Math.PI / 3);
    pose.camera = { yaw: 58, pitch: 10, viewBox: "25 65 310 280" };
    return curl(pose, p);
}, stages("斜凳悬垂", "屈肘提起", "顶端收缩"));
export const concentrationCurlStudy = study("concentration-curl", "Concentration Curl", "集中弯举", "坐姿前倾，右上臂靠住右大腿内侧，单臂弯举且肘位稳定", phase => {
    const theta = .16 + 2.21 * cycle(phase), joints = body(v(0, .565, 0), v(0, .51, Math.sqrt(1 - .51 ** 2)), [v(-.40, .07, .40), v(.40, .07, .40)], v(0, 1, 1));
    const dx = .10 - joints.rightShoulder.x, dz = .30 - joints.rightShoulder.z;
    // Place the distal upper arm against the inner thigh, not above the kneecap.
    const elbow = add(joints.rightShoulder, v(dx, -Math.sqrt(BODY.upperArm ** 2 - dx ** 2 - dz ** 2), dz));
    joints.rightElbow = elbow;
    joints.rightWrist = add(elbow, v(0, -BODY.forearm * Math.cos(theta), BODY.forearm * Math.sin(theta)));
    arm(joints, "left", v(-.31, .53, .36), v(-1, 0, .4));
    return supinatedWeights({ joints, apparatus: seat(.46), shorts: { hipFlexion: true }, localOcclusion: { handheld: true }, handContacts: { left: { center: v(-.32, .515, .395), forward: Z, normal: v(0, 1, 0) } }, camera: { yaw: 36, pitch: 12, viewBox: "35 140 290 205" } }, true);
}, stages("大腿内侧支撑", "单臂屈肘", "顶端收缩"));
export const bentOverDumbbellReverseFlyStudy = study("bent-over-dumbbell-reverse-fly", "Bent-over Dumbbell Reverse Fly", "俯身哑铃反向飞鸟", "髋铰链俯身，肘角微屈并保持稳定，双臂向两侧展开", phase => {
    const joints = standing(.83, 1.20, -.20), theta = .10 + 1.24 * cycle(phase);
    for (const [side, sign] of SIDES) {
        const e = add(joints[`${side}Shoulder`], v(sign * BODY.upperArm * Math.sin(theta), -BODY.upperArm * Math.cos(theta), 0));
        joints[`${side}Elbow`] = e;
        joints[`${side}Wrist`] = add(e, v(sign * BODY.forearm * Math.sin(theta - .20), -BODY.forearm * Math.cos(theta - .20), 0));
    }
    return pairWeights({ joints, shorts: { hipFlexion: true }, camera: { yaw: 38, pitch: 17, viewBox: "0 110 360 240" } }, Z);
}, stages("俯身悬垂", "两侧展开", "肩侧顶端"));
function tower(height, pulley) {
    return { rods: [
            { id: "tower", a: v(0, .025, 1.42), b: v(0, height, 1.42), radius: .025 },
            { id: "base", a: v(-.32, .025, 1.42), b: v(.32, .025, 1.42), radius: .025 },
            { id: "foot", a: v(0, .025, 1.20), b: v(0, .025, 1.66), radius: .025 },
            { id: "boom", a: v(0, height, 1.42), b: pulley, radius: .024 },
            { id: "pulley", a: add(pulley, v(-.045, 0, 0)), b: add(pulley, v(.045, 0, 0)), radius: .027 },
        ] };
}
export const cableFacePullStudy = study("cable-face-pull", "Cable Face Pull", "绳索面拉", "眼高滑轮配双绳端，双手拉向面部两旁，肘向外后移", phase => {
    const a = cycle(phase), joints = standing(.91), pulley = v(0, 1.57, 1.32);
    const hands = {};
    for (const [side, sign] of SIDES) {
        const contact = v(sign * (.15 + .20 * a), 1.49 + .065 * a, .60 - .46 * a);
        const elbow = bendJoint(joints[`${side}Shoulder`], contact, BODY.upperArm, BODY.forearm + .05, v(sign, -.15, -.5));
        joints[`${side}Elbow`] = elbow;
        joints[`${side}Wrist`] = add(contact, mul(unit(sub(elbow, contact)), .05));
        hands[side] = { center: contact, axis: v(0, 1, 0), grip: "neutral" };
    }
    const left = hands.left.center, right = hands.right.center;
    // Fixed rope length: wider hands bring the central junction nearer the fists.
    const junction = v(0, right.y, right.z + Math.sqrt(.43 ** 2 - right.x ** 2));
    const frame = tower(1.57, pulley);
    frame.cables = [{ id: "main", a: pulley, b: junction }, { id: "rope-left", a: junction, b: left }, { id: "rope-right", a: junction, b: right }];
    frame.rods = [...frame.rods, ...SIDES.map(([side]) => ({ id: `rope-stop-${side}`, a: add(hands[side].center, v(0, -.025, 0)), b: add(hands[side].center, v(0, .025, 0)), radius: .025 }))];
    return { joints, handholds: hands, apparatus: frame, camera: { yaw: 57, pitch: 9, viewBox: "-45 70 380 280" } };
}, stages("双绳伸臂", "肘向外后拉", "面部两侧"));
export const straightArmPulldownStudy = study("straight-arm-pulldown", "Straight-arm Pulldown", "直臂下拉", "面对高位滑轮，肘近伸直，肩带动横杆沿弧线拉至大腿前", phase => {
    const a = cycle(phase), joints = standing(.85, .31, -.10), theta = 1.83 - 1.64 * a;
    const hands = {};
    for (const [side, sign] of SIDES) {
        const e = add(joints[`${side}Shoulder`], v(sign * .035, -Math.sqrt(BODY.upperArm ** 2 - .035 ** 2) * Math.cos(theta), Math.sqrt(BODY.upperArm ** 2 - .035 ** 2) * Math.sin(theta)));
        const w = add(e, v(0, -BODY.forearm * Math.cos(theta - .10), BODY.forearm * Math.sin(theta - .10)));
        joints[`${side}Elbow`] = e;
        joints[`${side}Wrist`] = w;
        hands[side] = hold(e, w, X, unit(cross(X, sub(w, e))));
    }
    const l = hands.left.center, r = hands.right.center, center = v(0, l.y, l.z), pulley = v(0, 2.05, 1.32), frame = tower(2.05, pulley);
    frame.rods = [...frame.rods, { id: "straight-handle", a: add(l, v(-.12, 0, 0)), b: add(r, v(.12, 0, 0)), radius: .013 }];
    frame.cables = [{ id: "main", a: pulley, b: center }];
    return { joints, handholds: hands, apparatus: frame, shorts: { hipFlexion: true }, camera: { yaw: 61, pitch: 8, viewBox: "-45 15 375 335" } };
}, stages("高位伸臂", "肩部下拉", "大腿前方"));
export const barbellUprightRowStudy = study("barbell-upright-row", "Barbell Upright Row", "杠铃直立划船", "正握沿身体前方上拉，肘带动且高于手，控制在下胸附近", phase => {
    const joints = standing(), a = cycle(phase), center = v(0, .88 + .335 * a, .19);
    for (const [side, sign] of SIDES)
        arm(joints, side, v(sign * .29, center.y, center.z), v(sign, .75, -.15));
    return { joints, localOcclusion: { elbows: true }, bar: { center, halfLength: .84, plateRadius: .12, support: "hands", depthPolicy: "physical" }, camera: { yaw: 38, pitch: 10 } };
}, stages("大腿前起始", "肘部带动", "下胸高度"));
export const dumbbellShrugStudy = study("dumbbell-shrug", "Dumbbell Shrug", "哑铃耸肩", "双臂自然伸直，肩部垂直上提再受控落下，不绕肩或屈肘", phase => {
    const joints = standing(), lift = .045 * cycle(phase), torsoShoulders = v(0, joints.rightShoulder.y, joints.rightShoulder.z);
    for (const [side, sign] of SIDES) {
        const sh = add(joints[`${side}Shoulder`], v(0, lift, 0)), upper = v(sign * .115, -Math.sqrt(BODY.upperArm ** 2 - .115 ** 2), 0);
        joints[`${side}Shoulder`] = sh;
        joints[`${side}Elbow`] = add(sh, upper);
        joints[`${side}Wrist`] = add(joints[`${side}Elbow`], v(0, -BODY.forearm, 0));
    }
    return pairWeights({ joints, torsoShoulders, camera: { yaw: 38, pitch: 9 } }, Z);
}, stages("体侧悬垂", "垂直耸肩", "肩部顶端"), 3200);
export const pullExpansionStudies = [dumbbellCurlStudy, concentrationCurlStudy, inclineDumbbellCurlStudy, bentOverDumbbellReverseFlyStudy, cableFacePullStudy, straightArmPulldownStudy, barbellUprightRowStudy, dumbbellShrugStudy];
