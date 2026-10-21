import { add, bendJoint, BODY, cross, mul, sub, unit, v } from "./rig.js";
import { benchPose, body, cycle, SIDES, stages, study, X, Y, Z } from "./expansion-common.js";
import { grip, middle, pad, rod, roller, stackPlates, tower } from "./machine-common.js";
/** This family depicts vertical guides, including collars attached to the moving shaft. */
function smithFrame(pose, height, range) {
    const bar = pose.bar, z = bar.center.z;
    const rods = [...pose.apparatus?.rods ?? []];
    const rollers = [...pose.apparatus?.rollers ?? []];
    for (const [side, sign] of SIDES) {
        const x = sign * .63;
        rods.push(rod(`${side}-guide`, v(x, .10, z), v(x, height, z), .013), rod(`${side}-frame`, v(x, .025, z - .23), v(x, height, z - .23), .025), rod(`${side}-top-link`, v(x, height, z - .23), v(x, height, z)), rod(`${side}-guide-foot`, v(x, .10, z), v(x, .10, z - .23)), rod(`${side}-base`, v(x, .025, z - .53), v(x, .025, z + .60), .025));
        rollers.push(roller(`${side}-sliding-collar`, v(x, bar.center.y, z), .12, .037, Y));
        rods.push(rod(`${side}-load-sleeve`, v(x, bar.center.y, z), v(sign * .78, bar.center.y, z), .024));
    }
    rods.push(rod("smith-top", v(-.63, height, z - .23), v(.63, height, z - .23)));
    const stackX = -.98, stackZ = z - .34, lift = range[1] - bar.center.y, top = height - .045;
    rods.push(...tower(stackX, stackZ, height).filter(r => !r.id.startsWith("weight-")), rod("counterbalance-attachment", v(-.63, bar.center.y, z), v(-.78, bar.center.y, stackZ)));
    pose.apparatus = { ...pose.apparatus, rods, rollers,
        pads: [...pose.apparatus?.pads ?? [], ...stackPlates(stackX, stackZ, lift)],
        cables: [
            { id: "counterbalance-lift", a: v(-.78, bar.center.y, stackZ), b: v(-.78, top, stackZ) },
            { id: "counterbalance-top", a: v(-.78, top, stackZ), b: v(stackX, top, stackZ) },
            { id: "counterbalance-stack", a: v(stackX, top, stackZ), b: v(stackX, .385 + lift, stackZ) },
        ] };
    return pose;
}
export const smithSquatStudy = study("smith-machine-squat", "Smith Machine Squat", "史密斯深蹲", "双脚略在导轨前方，杠放在上背；脚掌固定，随垂直导轨下蹲和站起", phase => {
    const a = cycle(phase), lean = .10 + .22 * a, up = v(0, Math.cos(lean), Math.sin(lean)), front = unit(cross(X, up));
    const hips = v(0, .915 - .49 * a, .03 - (.49 + .035) * up.z + .080624 * front.z);
    const joints = body(hips, up, [v(-.20, .07, .13), v(.20, .07, .13)]);
    for (const [side] of SIDES) {
        const hip = joints[`${side}Hip`], ankle = joints[`${side}Ankle`];
        joints[`${side}Knee`] = bendJoint(v(ankle.x, hip.y, hip.z), ankle, Math.sqrt(BODY.thigh ** 2 - (hip.x - ankle.x) ** 2), BODY.shin, Z);
    }
    const center = add(add(middle(joints.leftShoulder, joints.rightShoulder), mul(up, .035)), mul(front, -.080624));
    const pose = { joints, shorts: { hipFlexion: true }, bar: { center, halfLength: .84, plateRadius: .15, support: "upper-back", depthPolicy: "physical" }, camera: { yaw: 45, pitch: 11, viewBox: "-25 20 415 335" } };
    for (const [side, sign] of SIDES) {
        grip(pose, side, add(center, v(sign * .37, 0, 0)), X, add(mul(up, -1), mul(front, -.6)));
        pose.handholds[side].grip = "pronated";
        (pose.grips ??= {})[side] = pose.handholds[side].center;
    }
    const top = .915 + .525 * Math.cos(.10) + .080624 * Math.sin(.10);
    const bottom = .425 + .525 * Math.cos(.32) + .080624 * Math.sin(.32);
    return smithFrame(pose, 1.94, [bottom, top]);
}, stages("站稳上背承杠", "沿轨下蹲", "蹲至舒适深度"), 4100);
function smithBench(phase, incline) {
    const pose = benchPose(incline ? Math.PI / 6 : 0), j = pose.joints, a = cycle(phase);
    const hips = middle(j.leftHip, j.rightHip), shoulders = middle(j.leftShoulder, j.rightShoulder), up = unit(sub(shoulders, hips)), normal = unit(cross(X, up));
    // Dedicated new bench geometry: the thorax's rear surface is 125 mm deep.
    // The seat follows the fixed thighs; neither cushion enters the shorts.
    const thigh = unit(sub(middle(j.leftKnee, j.rightKnee), hips)), seatNormal = unit(cross(thigh, X));
    const seat = pad("seat-pad", add(add(hips, mul(thigh, .10)), mul(seatNormal, incline ? -.111 : -.118)), thigh, .46, .35, seatNormal);
    const back = { ...pad("back-pad", add(add(hips, mul(up, .4275)), mul(normal, -.125)), up, .905, .33, normal), headSupport: true };
    pose.apparatus = { ...pose.apparatus, pads: [back, seat], rods: pose.apparatus.rods.map(r => r.id === "bench-support" ? { ...r, b: add(add(back.center, mul(up, .15)), mul(normal, -.065)) } : r.id === "bench-seat-support" ? { ...r, b: add(seat.center, mul(seatNormal, -.065)) } : r) };
    const headTilt = 6.95735 * Math.PI / 180, headAxis = add(mul(up, Math.cos(headTilt)), mul(normal, -Math.sin(headTilt)));
    j.head = add(shoulders, mul(headAxis, .235));
    j.neck = add(shoulders, mul(headAxis, .115));
    const t = incline ? .85 : .78, depth = .125 - Math.max(0, t - .78) / .18 * .025;
    const low = add(add(hips, mul(up, BODY.torso * t)), mul(normal, depth + .011)), halfGrip = .36;
    const topY = shoulders.y + Math.sqrt(.625 ** 2 - (halfGrip - BODY.shoulderHalf) ** 2 - (low.z - shoulders.z) ** 2);
    const center = v(0, low.y + (topY - low.y) * a, low.z);
    pose.bar = { center, halfLength: .84, plateRadius: .15, support: "hands", grip: "pronated", depthPolicy: "physical" };
    for (const [side, sign] of SIDES) {
        grip(pose, side, add(center, v(sign * halfGrip, 0, 0)), X, v(sign * .5, -.3, 1));
        pose.handholds[side].grip = "pronated";
        (pose.grips ??= {})[side] = pose.handholds[side].center;
    }
    pose.camera = { yaw: 52, pitch: 12, viewBox: "-35 65 430 285" };
    pose.localOcclusion = { chestBar: true };
    return smithFrame(pose, 1.70, [low.y, topY]);
}
export const smithBenchStudy = study("smith-machine-bench-press", "Smith Machine Bench Press", "史密斯平板卧推", "头背臀贴凳，最低点杠杆接触胸部表面；双手沿垂直导轨推起", p => smithBench(p, false), stages("杠杆触胸", "垂直推起", "肘近伸直"), 3900);
export const smithInclineStudy = study("smith-machine-incline-press", "Smith Machine Incline Press", "史密斯上斜卧推", "上斜凳固定头背，杠在上胸处触胸，再沿垂直导轨推起", p => smithBench(p, true), stages("上胸触杠", "向上推起", "手臂伸展"), 3900);
export const smithMachineStudies = [smithSquatStudy, smithBenchStudy, smithInclineStudy];
