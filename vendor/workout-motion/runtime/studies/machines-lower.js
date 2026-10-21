import { add, bendJoint, BODY, mul, unit, v } from "./rig.js";
import { body, cycle, SIDES, stages, study, X, Y, Z } from "./expansion-common.js";
import { grip, handlesAtSides, middle, pad, positionSeat, rod, roller, seated, toe, tower } from "./machine-common.js";
export const legPressStudy = study("leg-press", "45° Leg Press", "45°腿举", "背臀固定在座垫，双脚贴住踏板，伸腿推动滑车沿45°导轨往返", phase => {
    const a = cycle(phase), travel = .23 * a, up = unit(v(0, .76, -.65)), front = v(0, -up.z, up.y);
    const hips = v(0, .38, -.15), ankles = [v(-.20, .68 + travel, .28 + travel), v(.20, .68 + travel, .28 + travel)];
    const joints = body(hips, up, ankles, v(0, 1, -.3)), forward = unit(v(0, 1, -1)), normal = unit(v(0, -1, -1));
    const plate = add(add(middle(...ankles), mul(forward, .06)), mul(normal, -.07));
    const axle = add(add(plate, mul(normal, -.22)), mul(forward, .12)), railOffset = axle.y - axle.z;
    const seatAxis = v(0, -Math.sin(Math.PI / 12), Math.cos(Math.PI / 12)), seatNormal = v(0, Math.cos(Math.PI / 12), Math.sin(Math.PI / 12));
    const seatCenter = add(add(hips, mul(seatAxis, .10)), mul(seatNormal, -.09565));
    const pose = { joints, feet: "air", footFrames: { left: { forward, normal }, right: { forward, normal } }, shorts: { hipFlexion: true },
        apparatus: { pads: [pad("seat", seatCenter, seatAxis, .40, .42, seatNormal), pad("back", add(add(hips, mul(up, .32)), mul(front, -.125)), up, .84, .34, front), pad("footplate", plate, forward, .48, .72, normal, X, .045)], rods: [
                rod("base", v(0, .025, -.78), v(0, .025, 1.10)), rod("seat-support", v(0, .03, -.28), add(seatCenter, mul(seatNormal, -.065))),
                ...SIDES.flatMap(([side, sign]) => [rod(`${side}-rail`, v(sign * .46, .05 + railOffset, .05), v(sign * .46, .99 + railOffset, .99)), rod(`${side}-rail-post`, v(sign * .46, .03, .99), v(sign * .46, .99 + railOffset, .99)), rod(`${side}-sled-brace`, add(plate, v(sign * .29, 0, 0)), add(axle, v(sign * .29, 0, 0))), rod(`${side}-sled-axle`, add(axle, v(sign * .29, 0, 0)), add(axle, v(sign * .62, 0, 0)))]),
            ], rollers: SIDES.map(([side, sign]) => roller(`${side}-load`, add(axle, v(sign * .52, 0, 0)), .07, .15)) }, camera: { yaw: 102, pitch: 5, viewBox: "-30 105 395 250" } };
    for (const [side] of SIDES) {
        const hip = joints[`${side}Hip`], ankle = joints[`${side}Ankle`];
        joints[`${side}Knee`] = bendJoint(v(ankle.x, hip.y, hip.z), ankle, Math.sqrt(BODY.thigh ** 2 - (ankle.x - hip.x) ** 2), BODY.shin, v(0, 1, -.3));
        joints[`${side}Toe`] = toe(ankle, forward, normal);
    }
    handlesAtSides(pose);
    return pose;
}, stages("屈膝贴板", "伸腿推车", "腿部近伸直"), 4300);
function kneeExtensionMachine(phase) {
    const a = cycle(phase), angle = -1.48 + 1.36 * a, pose = seated(.68), j = pose.joints;
    const direction = v(0, Math.sin(angle), Math.cos(angle)), normal = v(0, Math.cos(angle), -Math.sin(angle));
    for (const [side, sign] of SIDES) {
        const knee = add(j[`${side}Hip`], v(sign * .05, -.015, Math.sqrt(BODY.thigh ** 2 - .05 ** 2 - .015 ** 2)));
        j[`${side}Knee`] = knee;
        j[`${side}Ankle`] = add(knee, mul(direction, BODY.shin));
        const ankleAngle = angle;
        const forward = v(0, Math.cos(ankleAngle), -Math.sin(ankleAngle)), soleNormal = v(0, -Math.sin(ankleAngle), -Math.cos(ankleAngle));
        (pose.footFrames ??= {})[side] = { forward, normal: soleNormal };
        j[`${side}Toe`] = toe(j[`${side}Ankle`], forward, soleNormal);
    }
    handlesAtSides(pose);
    const knee = middle(j.leftKnee, j.rightKnee), ankle = middle(j.leftAnkle, j.rightAnkle);
    const roll = add(add(ankle, mul(direction, -.07)), mul(normal, .108));
    pose.apparatus = { ...pose.apparatus, rods: [...pose.apparatus.rods, ...tower(-.60, -.28, 1.42, .13 * a),
            rod("roller-axle", add(roll, v(-.38, 0, 0)), add(roll, v(.38, 0, 0))),
            ...SIDES.flatMap(([side, sign]) => [rod(`${side}-pivot-support`, v(sign * .38, .04, knee.z), v(sign * .38, knee.y, knee.z)), rod(`${side}-lever`, v(sign * .38, knee.y, knee.z), v(sign * .38, roll.y, roll.z))])],
        rollers: [roller("ankle-pad", roll, .68, .065), ...SIDES.map(([side, sign]) => roller(`${side}-pivot`, v(sign * .38, knee.y, knee.z), .04, .05))] };
    positionSeat(pose);
    pose.camera = { yaw: 64, pitch: 12, viewBox: "-30 95 400 265" };
    return pose;
}
export const legExtensionStudy = study("seated-leg-extension", "Seated Leg Extension", "坐姿腿屈伸", "膝对齐器械转轴，滚垫贴小腿前侧，保持大腿固定并伸直小腿", p => kneeExtensionMachine(p), stages("屈膝就位", "伸膝抬垫", "小腿近水平"));
function hipMachine(phase, adduction) {
    const a = cycle(phase), spread = .12 + .57 * (adduction ? 1 - a : a), pose = seated(.65), j = pose.joints;
    const pads = [...pose.apparatus.pads], rods = [...pose.apparatus.rods, ...tower(-.67, -.31, 1.40, .12 * a)];
    for (const [side, sign] of SIDES) {
        const forward = v(sign * Math.sin(spread), 0, Math.cos(spread)), outward = v(sign * Math.cos(spread), 0, -Math.sin(spread));
        const thigh = add(mul(forward, Math.sqrt(1 - .08 ** 2)), v(0, -.08, 0));
        const knee = add(j[`${side}Hip`], mul(thigh, BODY.thigh)), ankle = add(knee, add(mul(forward, .11 * BODY.shin), v(0, -Math.sqrt(1 - .11 ** 2) * BODY.shin, 0)));
        j[`${side}Knee`] = knee;
        j[`${side}Ankle`] = ankle;
        j[`${side}Toe`] = toe(ankle, forward, Y);
        (pose.footFrames ??= {})[side] = { forward, normal: Y };
        const contact = add(add(knee, mul(forward, -.075)), mul(outward, adduction ? -.080 : .080));
        pads.push(pad(`${side}-knee-pad`, contact, Y, .20, .18, mul(outward, adduction ? 1 : -1), forward, .045));
        const foot = add(add(ankle, mul(forward, .06)), v(0, -.07, 0));
        pads.push(pad(`${side}-footrest`, foot, forward, .31, .16, Y, mul(outward, sign), .035));
        const pivot = v(sign * .10, .13, 0), end = v(knee.x, .13, knee.z);
        rods.push(rod(`${side}-swing-arm`, pivot, end), rod(`${side}-pad-post`, end, add(contact, mul(outward, adduction ? -.045 : .045))), rod(`${side}-foot-support`, end, add(foot, v(0, -.035, 0))));
    }
    for (const [side, sign] of SIDES) {
        const center = add(j[`${side}Hip`], v(sign * .19, -.12, -.045));
        grip(pose, side, center, Z, v(sign, -.5, -.4));
        rods.push(rod(`${side}-handle`, add(center, v(0, 0, -.10)), add(center, v(0, 0, .10)), .013), rod(`${side}-handle-post`, v(center.x, .03, center.z - .10), add(center, v(0, 0, -.10))));
    }
    pose.apparatus = { ...pose.apparatus, pads, rods };
    positionSeat(pose, v(0, -.09, Math.sqrt(1 - .09 ** 2)));
    pose.camera = { yaw: 28, pitch: 20, viewBox: "10 90 345 270" };
    return pose;
}
export const hipAbductionStudy = study("hip-abduction-machine", "Machine Hip Abduction", "器械髋外展", "背臀留在座垫，膝外侧推开活动垫，双脚随各自脚踏向外移动", p => hipMachine(p, false), stages("双腿靠拢", "向外推垫", "双腿打开"));
export const hipAdductionStudy = study("hip-adduction-machine", "Machine Hip Adduction", "器械髋内收", "从宽站距坐姿开始，膝内侧夹住活动垫，双腿向中间合拢", p => hipMachine(p, true), stages("双腿打开", "向内夹垫", "双腿合拢"));
export const lowerMachineStudies = [legPressStudy, legExtensionStudy, hipAbductionStudy, hipAdductionStudy];
