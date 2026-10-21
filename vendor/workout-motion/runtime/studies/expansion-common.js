import { add, bendJoint, BODY, cross, dot, mul, sub, unit, v } from "./rig.js";
export const SIDES = [["left", -1], ["right", 1]];
export const X = v(1, 0, 0);
export const Y = v(0, 1, 0);
export const Z = v(0, 0, 1);
export function cycle(phase, turn = .44) {
    const p = ((phase % 1) + 1) % 1;
    return (1 - Math.cos(Math.PI * (p <= turn ? p / turn : (1 - p) / (1 - turn)))) / 2;
}
export const stages = (start, moving, top, turn = .44) => [
    { phase: 0, label: start }, { phase: turn / 2, label: moving },
    { phase: turn, label: top }, { phase: (1 + turn) / 2, label: "受控还原" },
];
/** New studies use the existing H2 bone lengths; accepted studies stay untouched. */
export function body(hips, up, ankles, kneePole = Z) {
    const shoulders = add(hips, mul(up, BODY.torso));
    const result = { head: add(shoulders, mul(up, .235)), neck: add(shoulders, mul(up, .115)) };
    for (const [side, sign] of SIDES) {
        const hip = add(hips, v(sign * BODY.hipHalf, 0, 0)), ankle = ankles[sign === -1 ? 0 : 1];
        const shoulder = add(shoulders, v(sign * BODY.shoulderHalf, 0, 0));
        result[`${side}Hip`] = hip;
        result[`${side}Ankle`] = ankle;
        result[`${side}Knee`] = bendJoint(hip, ankle, BODY.thigh, BODY.shin, kneePole);
        result[`${side}Toe`] = add(ankle, v(0, -.045, .17));
        result[`${side}Shoulder`] = shoulder;
        result[`${side}Elbow`] = add(shoulder, v(sign * .04, -Math.sqrt(BODY.upperArm ** 2 - .04 ** 2), 0));
        result[`${side}Wrist`] = add(result[`${side}Elbow`], v(0, -BODY.forearm, 0));
    }
    return result;
}
export const standing = (hipHeight = .925, lean = 0, hipZ = 0) => body(v(0, hipHeight, hipZ), v(0, Math.cos(lean), Math.sin(lean)), [v(-.17, .07, 0), v(.17, .07, 0)]);
export function arm(joints, side, wrist, pole) {
    joints[`${side}Wrist`] = wrist;
    joints[`${side}Elbow`] = bendJoint(joints[`${side}Shoulder`], wrist, BODY.upperArm, BODY.forearm, pole);
}
export const dumbbell = (id, center, axis, radius = .075) => ({ id, center, axis, halfLength: .115, plateRadius: radius });
export function hold(elbow, wrist, preferred = X, palmNormal) {
    const reach = unit(sub(wrist, elbow));
    let shaft = sub(preferred, mul(reach, dot(preferred, reach)));
    if (dot(shaft, shaft) < .01)
        shaft = cross(reach, Math.abs(reach.x) < .8 ? X : Y);
    return { center: add(wrist, mul(reach, .05)), axis: unit(shaft), grip: "pronated", ...(palmNormal ? { palmNormal } : {}) };
}
export function pairWeights(pose, preferred = X, radius = .075, palmNormal) {
    const left = hold(pose.joints.leftElbow, pose.joints.leftWrist, preferred, palmNormal);
    const right = hold(pose.joints.rightElbow, pose.joints.rightWrist, preferred, palmNormal);
    return { ...pose, handholds: { left, right }, dumbbells: [dumbbell("left", left.center, left.axis, radius), dumbbell("right", right.center, right.axis, radius)] };
}
/** Opposing palms, both thumbs toward the head end of the dumbbell shaft. */
export function neutralPairWeights(pose) {
    const weights = pairWeights(pose, Z);
    for (const [side, sign] of SIDES) {
        const hand = weights.handholds[side], reach = unit(sub(pose.joints[`${side}Wrist`], pose.joints[`${side}Elbow`]));
        const shaft = unit(cross(X, reach));
        hand.palmNormal = mul(unit(cross(shaft, reach)), sign);
        hand.axis = shaft;
        hand.grip = "neutral";
        hand.thumb = mul(unit(cross(hand.palmNormal, reach)), sign);
        weights.dumbbells = weights.dumbbells.map(d => d.id === side ? { ...d, axis: shaft } : d);
    }
    weights.localOcclusion = { ...pose.localOcclusion, handheld: true };
    return weights;
}
export function seat(height = .46) {
    return { pads: [{ id: "seat", center: v(0, height, .02), axis: Z, length: .40, width: .42, thickness: .065 }], rods: [
            { id: "seat-post", a: v(0, .03, .02), b: v(0, height - .065, .02), radius: .025 },
            { id: "seat-foot", a: v(-.27, .025, .02), b: v(.27, .025, .02), radius: .025 },
        ] };
}
export function benchPose(angle = 0, floor = false) {
    const up = v(0, Math.sin(angle), -Math.cos(angle));
    const hip = v(0, floor ? .13 : .59, .25);
    const joints = body(hip, up, [v(-.23, .07, floor ? .76 : .70), v(.23, .07, floor ? .76 : .70)], v(0, 1, .3));
    const normal = v(0, Math.cos(angle), Math.sin(angle));
    const pose = { joints, shorts: { hipFlexion: true }, camera: { yaw: 53, pitch: 13, viewBox: "-10 75 360 285" } };
    if (floor) {
        pose.groundContacts = [v(-.40, 0, -.52), v(.40, 0, -.52), v(-.28, 0, .79), v(.28, 0, .79)];
        pose.camera = { yaw: 56, pitch: 20, viewBox: "-10 175 360 180" };
    }
    else {
        const center = add(add(hip, mul(up, .31)), mul(normal, -.103));
        pose.apparatus = { pads: [
                { id: "back-pad", center, axis: up, length: 1.02, width: .33, thickness: .065 },
                { id: "seat-pad", center: v(0, .487, .41), axis: Z, length: .32, width: .35, thickness: .065 },
            ], rods: [
                { id: "bench-base", a: v(0, .035, -.57), b: v(0, .035, .54), radius: .025 },
                { id: "bench-support", a: v(0, .035, -.31), b: add(center, mul(up, .2)), radius: .025 },
                { id: "bench-seat-support", a: v(0, .035, .40), b: v(0, .42, .40), radius: .025 },
                { id: "bench-front-foot", a: v(-.3, .025, .5), b: v(.3, .025, .5), radius: .025 },
                { id: "bench-rear-foot", a: v(-.3, .025, -.50), b: v(.3, .025, -.50), radius: .025 },
            ] };
    }
    return pose;
}
export function study(id, label, chinese, subtitle, pose, keyframes, durationMs = 3600, isometric = false) {
    return { id, label, chinese, subtitle, pose: phase => ({ ...pose(phase), occlusion: "surface", supportOcclusion: true }), keyframes, durationMs, ...(isometric ? { isometric: true } : {}) };
}
