import { add, BODY, cross, mul, sub, unit, v } from "./rig.js";
import { arm, body, cycle, SIDES, stages, study, X, Y, Z } from "./expansion-common.js";
import { grip, middle, pad, plantSeatedFeet, rod, roller, seated, stackPlates, toe, tower } from "./machine-common.js";
export const proneLegCurlStudy = study("prone-leg-curl", "Prone Leg Curl", "俯卧腿弯举", "胸腹与大腿贴垫，膝对转轴，屈膝带动后踝滚垫向上转动", phase => {
    const a = cycle(phase), up = unit(v(0, -.16, 1)), front = unit(cross(X, up)), hips = v(0, .75, 0), thigh = unit(v(0, -.07, -1));
    const angle = -.13 + 1.58 * a, shin = v(0, Math.sin(angle), -Math.cos(angle)), behind = v(0, Math.cos(angle), Math.sin(angle));
    const knees = SIDES.map(([, sign]) => add(add(hips, v(sign * .10, 0, 0)), mul(thigh, BODY.thigh)));
    const ankles = knees.map(k => add(k, mul(shin, BODY.shin))), joints = body(hips, up, [ankles[0], ankles[1]], Y);
    const knee = middle(knees[0], knees[1]), roll = add(add(knee, mul(shin, BODY.shin - .07)), mul(behind, .1185));
    const thighNormal = unit(cross(X, thigh));
    const pads = [pad("chest", add(add(hips, mul(up, .35)), mul(front, .125)), up, .62, .34, mul(front, -1)), pad("thigh", add(add(hips, mul(thigh, .18)), mul(thighNormal, -.110)), thigh, .31, .43, thighNormal)];
    const rods = [...tower(-.72, -.55, 1.23, .14 * a), rod("base", v(0, .03, -.82), v(0, .03, .72)),
        rod("front-foot", v(-.48, .025, .64), v(.48, .025, .64)), rod("rear-foot", v(-.48, .025, -.66), v(.48, .025, -.66)),
        rod("chest-post", v(0, .03, .41), add(pads[0].center, mul(front, .065))), rod("thigh-post", v(0, .03, -.16), add(pads[1].center, mul(thighNormal, -.065))),
        rod("roller-axle", v(-.38, roll.y, roll.z), v(.38, roll.y, roll.z))];
    const rollers = [roller("ankle-pad", roll, .49, .073)];
    const pose = { joints, feet: "air", shorts: { hipFlexion: true }, localOcclusion: { rollers: true }, apparatus: { pads, rods, rollers }, camera: { yaw: 58, pitch: 13, viewBox: "-25 120 410 235" } };
    for (const [index, [side, sign]] of SIDES.entries()) {
        joints[`${side}Knee`] = knees[index];
        const forward = mul(behind, -1), normal = mul(shin, -1);
        (pose.footFrames ??= {})[side] = { forward, normal };
        joints[`${side}Toe`] = toe(ankles[index], forward, normal);
        const pivot = v(sign * .38, knee.y, knee.z), end = v(sign * .38, roll.y, roll.z), handle = v(sign * .29, .50, .81);
        rods.push(rod(`${side}-pivot-post`, v(pivot.x, .03, pivot.z), pivot), rod(`${side}-lever`, pivot, end), rod(`${side}-handle`, add(handle, v(0, 0, -.11)), add(handle, v(0, 0, .11))), rod(`${side}-handle-post`, v(handle.x, .03, .70), add(handle, v(0, 0, -.11))));
        rollers.push(roller(`${side}-pivot`, pivot, .055, .047));
        grip(pose, side, handle, Z, v(sign, -.3, -.3));
    }
    return pose;
}, stages("俯卧伸腿", "屈膝抬跟", "小腿上卷"), 3900);
export const standingLegCurlMachineStudy = study("standing-leg-curl-machine", "Standing Leg Curl Machine", "站姿单腿弯举", "胸贴支撑垫、左脚站稳；右侧膝轴固定，后踝推动滚垫向后上方转", phase => {
    const a = cycle(phase), angle = .43 + 1.24 * a, hips = v(0, 1.010, -.025), up = unit(v(0, 1, .14));
    const knee = add(add(hips, v(.10, 0, 0)), mul(unit(v(0, -1, .06)), BODY.thigh)), shin = v(0, -Math.cos(angle), -Math.sin(angle)), behind = v(0, Math.sin(angle), -Math.cos(angle));
    const ankle = add(knee, mul(shin, BODY.shin)), joints = body(hips, up, [v(-.17, .15, 0), ankle]);
    joints.rightKnee = knee;
    const front = unit(cross(X, up)), chest = add(add(hips, mul(up, .37)), mul(front, .125)), roll = add(add(knee, mul(shin, BODY.shin - .07)), mul(behind, .117));
    const pivot = v(.40, knee.y, knee.z), rods = [...tower(-.58, .58, 1.7, .15 * a), rod("chest-post", v(0, .03, .54), add(chest, mul(front, .065))),
        rod("base", v(-.46, .025, .56), v(.46, .025, .56)), rod("right-base", v(.4, .025, -.65), v(.4, .025, .56)), rod("pivot-post", v(.4, .03, knee.z), pivot), rod("curl-lever", pivot, v(.4, roll.y, roll.z)), rod("roller-axle", v(.02, roll.y, roll.z), v(.4, roll.y, roll.z))];
    const forward = v(0, -Math.sin(angle), Math.cos(angle)), normal = mul(shin, -1);
    const pose = { joints, feet: "air", footFrames: { right: { forward, normal } }, apparatus: { rods, pads: [pad("chest", chest, up, .32, .30, mul(front, -1)), pad("standing-platform", v(-.17, .08, .06), Z, .36, .26, Y, X, .08)], rollers: [roller("ankle-pad", v(.1, roll.y, roll.z), .20, .073), roller("pivot", pivot, .055, .047)] }, camera: { yaw: 112, pitch: 11, viewBox: "-20 25 390 330" } };
    joints.rightToe = toe(ankle, forward, normal);
    for (const [side, sign] of SIDES) {
        const handle = v(sign * .28, 1.22, .37);
        grip(pose, side, handle, Y, v(sign, -.4, -.2));
        rods.push(rod(`${side}-handle`, add(handle, v(0, -.10, 0)), add(handle, v(0, .10, 0))), rod(`${side}-handle-support`, v(0, handle.y, .46), handle));
    }
    return pose;
}, stages("胸托单腿站稳", "后踝上卷", "屈膝收紧"), 3800);
export const machineCalfRaiseStudy = study("machine-calf-raise", "Standing Calf Raise Machine", "器械站姿提踵", "肩垫承重，前脚掌固定在踏板边缘；脚跟下放后抬起，膝保持近伸直", phase => {
    const pitch = -.52 * cycle(phase), c = Math.cos(pitch), s = Math.sin(pitch), plateY = .22;
    const ankleY = .07 + plateY - .19 * s + .07 * c - .07, ankleZ = .19 - .19 * c - .07 * s;
    const joints = body(v(0, .925 + ankleY - .07, 0), Y, [v(-.17, ankleY, ankleZ), v(.17, ankleY, ankleZ)]), shoulders = middle(joints.leftShoulder, joints.rightShoulder);
    const lift = (ankleY - .29) * 2, stackX = .78, stackZ = -.46;
    const pads = [pad("footplate", v(0, plateY, .17), Z, .16, .63), ...stackPlates(stackX, stackZ, lift)], rods = [...tower(stackX, stackZ, 2.01).filter(r => !r.id.startsWith("weight-")), rod("base", v(-.48, .025, -.48), v(.48, .025, -.48)), rod("footplate-post", v(0, .03, .17), v(0, plateY - .065, .17))];
    const rollers = [];
    const yokeY = shoulders.y + .133;
    // A moving pulley doubles the stack travel while the shoulder yoke rises.
    rollers.push(roller("moving-pulley", v(.38, yokeY, stackZ), .035, .040));
    rods.push(rod("pulley-yoke-link", v(.38, yokeY, -.34), v(.38, yokeY, stackZ)));
    const pose = { joints, feet: "air", footPitch: { left: pitch, right: pitch }, apparatus: { pads, rods, rollers, cables: [
                { id: "fixed-to-yoke", a: v(.34, .12, stackZ), b: v(.34, yokeY, stackZ) },
                { id: "yoke-to-base", a: v(.42, yokeY, stackZ), b: v(.42, .10, stackZ) },
                { id: "base-to-tower", a: v(.42, .10, stackZ), b: v(stackX + .15, .10, stackZ) },
                { id: "tower-lift", a: v(stackX + .15, .10, stackZ), b: v(stackX + .15, 1.97, stackZ) },
                { id: "tower-top", a: v(stackX + .15, 1.97, stackZ), b: v(stackX, 1.97, stackZ) },
                { id: "stack-lift", a: v(stackX, 1.97, stackZ), b: v(stackX, .385 + lift, stackZ) },
            ] }, camera: { yaw: 61, pitch: 11, viewBox: "-30 5 405 350" } };
    for (const [side, sign] of SIDES) {
        const shoulder = joints[`${side}Shoulder`], y = shoulder.y + .043, handle = v(sign * .29, shoulders.y - .09, .24), x = sign * .38;
        joints[`${side}Toe`] = add(joints[`${side}Ankle`], v(0, .17 * s - .045 * c, .17 * c + .045 * s));
        pads.push(pad(`${side}-shoulder-pad`, v(shoulder.x, y, .025), Z, .29, .17, mul(Y, -1)));
        rods.push(rod(`${side}-guide`, v(x, .03, -.34), v(x, 1.98, -.34)), rod(`${side}-base`, v(x, .03, -.50), v(x, .03, .40)), rod(`${side}-yoke`, v(x, y + .09, -.34), v(shoulder.x, y + .09, .025)), rod(`${side}-pad-link`, v(shoulder.x, y + .09, .025), v(shoulder.x, y + .065, .025)), rod(`${side}-handle-support`, v(shoulder.x, y + .09, .025), add(handle, v(0, .08, 0))), rod(`${side}-handle`, add(handle, v(0, -.07, 0)), add(handle, v(0, .08, 0))));
        rollers.push(roller(`${side}-collar`, v(x, y + .09, -.34), .12, .035, Y));
        grip(pose, side, handle, Y, v(sign, -.4, 0));
    }
    return pose;
}, stages("前掌踩稳踏板", "抬起脚跟", "肩垫随身升高"), 3400);
function tricepsExtensionPose(phase) {
    const a = cycle(phase), pose = seated(.61, .10, true), j = pose.joints, angle = 1.50 - 1.75 * a;
    plantSeatedFeet(pose);
    const rods = [...pose.apparatus.rods, ...tower(-.72, .64, 1.48, .14 * a)], pads = [...pose.apparatus.pads], rollers = [];
    for (const [side, sign] of SIDES) {
        const upper = unit(v(sign * .10, -.15, 1)), normal = unit(v(0, 1, .15));
        const elbow = add(j[`${side}Shoulder`], mul(upper, BODY.upperArm)), reach = v(0, Math.sin(angle), Math.cos(angle)), center = add(elbow, mul(reach, BODY.forearm + .05));
        j[`${side}Elbow`] = elbow;
        j[`${side}Wrist`] = add(elbow, mul(reach, BODY.forearm));
        (pose.handholds ??= {})[side] = { center, axis: mul(X, -sign), grip: "neutral", palmNormal: v(0, -Math.cos(angle), Math.sin(angle)) };
        // A tangent to the tapering back of the upper arm, ending before the
        // moving forearm. A pad parallel to the bone would leave the elbow floating.
        const taper = (.065 - .043) / (BODY.upperArm * (.90 - .58));
        const padAxis = unit(add(upper, mul(normal, taper))), padNormal = unit(sub(normal, mul(upper, taper))), across = unit(cross(padNormal, padAxis));
        const armPad = pad(`${side}-arm-pad`, add(add(j[`${side}Shoulder`], mul(upper, .2125)), mul(normal, -.0577754098)), padAxis, .155 * Math.sqrt(1 + taper * taper), .12, padNormal, across);
        const pivot = v(sign * .46, elbow.y, elbow.z), end = v(pivot.x, center.y, center.z);
        pads.push(armPad);
        rods.push(rod(`${side}-pad-post`, v(armPad.center.x, .03, armPad.center.z), add(armPad.center, mul(padNormal, -.065))), rod(`${side}-pivot-post`, v(pivot.x, .03, pivot.z), pivot), rod(`${side}-lever`, pivot, end), rod(`${side}-handle`, v(center.x - sign * .055, center.y, center.z), end));
        rollers.push(roller(`${side}-pivot`, pivot, .05, .045));
    }
    pose.apparatus = { pads, rods, rollers };
    pose.camera = { yaw: 55, pitch: 13, viewBox: "-30 85 400 270" };
    return pose;
}
export const tricepsExtensionMachineStudy = study("triceps-extension-machine", "Triceps Extension Machine", "器械三头伸肘", "背靠坐垫、上臂向前放在独立肘垫上，由竖起前臂的屈肘姿态向前下方伸直", p => tricepsExtensionPose(p), stages("独立肘垫承托", "向前下方伸肘", "手臂近伸直"), 3600);
export const assistedDipStudy = study("assisted-dip", "Assisted Dip", "器械辅助双杠臂屈伸", "握住固定平行把，双膝持续贴活动垫；屈肘下放再推起，配重反向移动", phase => {
    const down = .29 * cycle(phase), up = unit(v(0, 1, .15)), shoulders = v(0, 1.69 - down, .07), hips = sub(shoulders, mul(up, BODY.torso));
    const knees = SIDES.map(([, sign]) => add(add(hips, v(sign * .1, 0, 0)), mul(unit(v(0, -.96, -.28)), BODY.thigh))), ankles = knees.map(k => add(k, mul(unit(v(0, .12, -.99)), BODY.shin)));
    const joints = body(hips, up, [ankles[0], ankles[1]]), platform = v(0, knees[0].y - .052, knees[0].z + .04);
    const rods = [...tower(-.79, -.28, 1.96, .28 + down), rod("platform-arm", v(-.49, platform.y - .04, -.28), v(0, platform.y - .04, knees[0].z))];
    const pose = { joints, feet: "air", shorts: { hipFlexion: true }, apparatus: { rods, pads: [pad("knee-platform", platform, Z, .23, .45)], cables: [
                { id: "platform-lift", a: v(-.49, platform.y - .04, -.28), b: v(-.49, 1.90, -.28) }, { id: "overhead", a: v(-.49, 1.9, -.28), b: v(-.79, 1.9, -.28) }, { id: "counterweight", a: v(-.79, 1.9, -.28), b: v(-.79, .61 + down, -.28) },
            ] }, camera: { yaw: 53, pitch: 10, viewBox: "-30 5 405 350" } };
    for (const [index, [side, sign]] of SIDES.entries()) {
        joints[`${side}Knee`] = knees[index];
        const forward = v(0, -.6, -.8), normal = v(0, .8, -.6);
        (pose.footFrames ??= {})[side] = { forward, normal };
        joints[`${side}Toe`] = toe(ankles[index], forward, normal);
        grip(pose, side, v(sign * .28, 1.1, .02), Z, v(sign * .2, -.3, -1));
        rods.push(rod(`${side}-handle`, v(sign * .28, 1.1, -.40), v(sign * .28, 1.1, .33), .016), rod(`${side}-handle-post`, v(sign * .28, .03, .33), v(sign * .28, 1.1, .33)), rod(`${side}-rear-column`, v(sign * .49, .03, -.28), v(sign * .49, 1.96, -.28)), rod(`${side}-base`, v(sign * .49, .025, -.71), v(sign * .49, .025, .47)));
    }
    rods.push(rod("top-crossbar", v(-.79, 1.96, -.28), v(.49, 1.96, -.28)));
    return pose;
}, stages("双膝贴垫支撑", "屈肘下放", "肘屈至舒适深度"), 4100);
export const backExtensionStudy = study("back-extension", "45-degree Back Extension", "45°罗马椅背伸展", "大腿前侧贴垫、踝脚固定，围绕髋部俯身，再回到躯干与腿近似成线", phase => {
    const a = cycle(phase), angle = Math.PI / 4 + 1.03 * a, up = v(0, Math.cos(angle), Math.sin(angle)), hips = v(0, .86, .42), legUp = unit(v(0, .64, .58)), front = unit(cross(X, legUp));
    const ankles = [v(-.15, .22, -.16), v(.15, .22, -.16)], joints = body(hips, up, ankles, Z), foot = add(add(middle(...ankles), mul(legUp, -.07)), mul(front, .04));
    const thighPad = pad("thigh-support", add(add(hips, mul(legUp, -.19)), mul(front, .118)), legUp, .27, .46, mul(front, -1));
    const rods = [rod("base", v(0, .025, -.46), v(0, .025, .63)), rod("rear-foot", v(-.48, .025, -.36), v(.48, .025, -.36)), rod("front-foot", v(-.48, .025, .54), v(.48, .025, .54)), rod("inclined-support", v(0, .035, -.26), add(thighPad.center, mul(front, .065))), rod("footplate-post", v(0, .025, -.16), sub(foot, mul(legUp, .065)))];
    const shinUp = unit(sub(middle(joints.leftKnee, joints.rightKnee), middle(...ankles))), shinFront = unit(cross(X, shinUp));
    const ankleRoll = add(add(middle(...ankles), mul(shinUp, .07)), mul(shinFront, -.108));
    const pose = { joints, feet: "air", shorts: { hipFlexion: true }, apparatus: { rods, pads: [thighPad, pad("footplate", foot, front, .36, .52, legUp)], rollers: [roller("ankle-support", ankleRoll, .48, .065)] }, camera: { yaw: 59, pitch: 12, viewBox: "-35 100 420 255" } };
    const torsoFront = unit(cross(X, up)), chest = add(add(hips, mul(up, .37)), mul(torsoFront, .16));
    for (const [side, sign] of SIDES) {
        (pose.footFrames ??= {})[side] = { forward: front, normal: legUp };
        joints[`${side}Toe`] = toe(ankles[sign === -1 ? 0 : 1], front, legUp);
        const palm = add(chest, v(-sign * .08, 0, 0)), forward = v(-sign, 0, 0), wrist = sub(palm, mul(forward, .045));
        arm(joints, side, wrist, add(v(sign, 0, 0), mul(up, -.5)));
        (pose.handContacts ??= {})[side] = { center: palm, forward, normal: torsoFront };
    }
    return pose;
}, stages("躯干与腿成线", "髋部折叠俯身", "保持背部平稳"), 4000);
export const accessoryMachineStudies = [proneLegCurlStudy, standingLegCurlMachineStudy, machineCalfRaiseStudy, tricepsExtensionMachineStudy, assistedDipStudy, backExtensionStudy];
