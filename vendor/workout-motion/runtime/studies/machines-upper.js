import { add, bendJoint, BODY, cross, mul, sub, unit, v } from "./rig.js";
import { body, cycle, SIDES, stages, study, X, Y, Z } from "./expansion-common.js";
import { grip, middle, pad, pressGrip, rod, roller, seated, tower } from "./machine-common.js";
function shoulderPressMachine(phase) {
    const a = cycle(phase), pose = seated(), rods = [...pose.apparatus.rods, ...tower(-.65, -.32, 1.73, .17 * a)], rollers = [];
    for (const [side, sign] of SIDES) {
        const pivot = v(sign * .44, 1.0, -.40);
        const angle = .31 + .85 * a;
        const point = add(pivot, v(0, .79 * Math.sin(angle), .79 * Math.cos(angle)));
        const center = add(point, v(-sign * .14, 0, 0));
        pressGrip(pose, side, center, X, v(sign * .85, -.8, -.12));
        rods.push(rod(`${side}-upright`, v(pivot.x, .03, -.39), v(pivot.x, pivot.y, -.39)), rod(`${side}-pivot-brace`, v(pivot.x, pivot.y, -.39), pivot), rod(`${side}-moving-arm`, pivot, point), rod(`${side}-handle`, add(center, v(-sign * .055, 0, 0)), point));
        rollers.push(roller(`${side}-pivot`, pivot, .055, .055));
    }
    pose.apparatus = { ...pose.apparatus, rods, rollers };
    pose.localOcclusion = { shoulders: true, elbows: true };
    pose.camera = { yaw: 38, pitch: 11, viewBox: "-20 45 385 310" };
    return pose;
}
export const shoulderPressMachineStudy = study("shoulder-press-machine", "Machine Shoulder Press", "器械推肩", "背臀固定座垫，从肩上方握位沿器械臂圆弧向上推举，再控制下放", p => shoulderPressMachine(p), stages("肩上握柄", "向上推举", "头顶伸展"));
function flyMachine(phase, reverse) {
    const a = cycle(phase), pose = seated(.61, -.04, !reverse), j = pose.joints;
    const angle = reverse ? .10 + 1.20 * a : 1.12 - 1.08 * a, decline = reverse ? 0 : .18;
    const rods = [...pose.apparatus.rods, ...tower(-.83, -.37, 1.94, .16 * a)], pads = [...pose.apparatus.pads], rollers = [];
    if (reverse) {
        const up = v(0, Math.cos(.04), -Math.sin(.04)), front = v(0, Math.sin(.04), Math.cos(.04));
        pads.push(pad("chest", add(add(v(0, .61, 0), mul(up, .35)), mul(front, .125)), up, .53, .28, mul(front, -1)));
        rods.push(rod("chest-support", v(0, .04, .38), add(pads.at(-1).center, mul(front, .065))));
    }
    rods.push(rod("overhead-crossbar", v(-.43, 1.91, -.30), v(.43, 1.91, -.30)), rod("overhead-post", v(0, .04, -.38), v(0, 1.91, -.30)));
    for (const [side, sign] of SIDES) {
        const shoulder = j[`${side}Shoulder`], upper = v(sign * Math.sin(angle) * Math.cos(decline), -Math.sin(decline), Math.cos(angle) * Math.cos(decline)), forearm = v(sign * Math.sin(angle - .35) * Math.cos(decline), -Math.sin(decline), Math.cos(angle - .35) * Math.cos(decline));
        j[`${side}Elbow`] = add(shoulder, mul(upper, BODY.upperArm));
        j[`${side}Wrist`] = add(j[`${side}Elbow`], mul(forearm, BODY.forearm));
        const center = add(j[`${side}Wrist`], mul(forearm, .05));
        const axis = reverse ? unit(cross(forearm, Y)) : Y;
        const palmNormal = reverse ? mul(Y, -1) : mul(unit(cross(axis, forearm)), sign);
        (pose.handholds ??= {})[side] = { center, axis, grip: reverse ? "pronated" : "neutral", palmNormal,
            thumb: mul(unit(cross(palmNormal, forearm)), sign) };
        const pivot = v(shoulder.x, 1.91, shoulder.z), tip = v(center.x, 1.91, center.z);
        rods.push(rod(`${side}-pivot-brace`, v(pivot.x, 1.91, -.30), pivot), rod(`${side}-swing-arm`, pivot, tip), rod(`${side}-handle-drop`, tip, reverse ? center : add(center, v(0, -.09, 0))));
        if (reverse)
            rods.push(rod(`${side}-handle`, add(center, mul(axis, -.085)), add(center, mul(axis, .085)), .013));
        rollers.push(roller(`${side}-pivot`, pivot, .05, .048, Y));
    }
    pose.apparatus = { ...pose.apparatus, rods, pads, rollers };
    pose.camera = { yaw: reverse ? 127 : 45, pitch: 10, viewBox: "-30 35 405 320" };
    return pose;
}
export const pecDeckStudy = study("pec-deck", "Pec Deck Fly", "蝴蝶机夹胸", "背贴垫、肩放低，肘略低于肩且保持微屈，双手从两侧合拢到胸前", p => flyMachine(p, false), stages("肩下沉双臂打开", "胸前合拢", "双手接近"), 3900);
export const reversePecDeckStudy = study("reverse-pec-deck", "Reverse Pec Deck Fly", "反向蝴蝶机飞鸟", "面向器械、胸部贴垫，保持肘角并将胸前双手向两侧打开", p => flyMachine(p, true), stages("胸前握柄", "向两侧打开", "双臂展开"), 3900);
export const chestSupportedRowStudy = study("chest-supported-row-machine", "Chest-supported Machine Row", "器械胸托划船", "胸廓靠住前方胸垫，双手向下肋附近拉回，肘部后移而躯干保持固定", phase => {
    const a = cycle(phase), pose = seated(.61, .12, false), j = pose.joints;
    const radius = Math.hypot(.70, -.106), startAngle = Math.atan2(-.106, .70), endAngle = Math.atan2(-.406, .58), angle = startAngle + (endAngle - startAngle) * a;
    const up = v(0, Math.cos(.12), Math.sin(.12)), front = v(0, -Math.sin(.12), Math.cos(.12));
    const chest = add(add(middle(j.leftHip, j.rightHip), mul(up, .37)), mul(front, .125));
    const rods = [...pose.apparatus.rods, ...tower(-.68, .70, 1.70, .17 * a), rod("chest-post", v(0, .04, .43), add(chest, mul(front, .065)))];
    const rollers = [];
    for (const [side, sign] of SIDES) {
        const pivot = v(sign * .48, .30, .756), end = add(pivot, v(0, radius * Math.cos(angle), radius * Math.sin(angle))), center = add(end, v(-sign * .15, 0, 0));
        grip(pose, side, center, Y, v(sign * .25, -.45, -1));
        rods.push(rod(`${side}-upright`, v(pivot.x, .04, .72), v(pivot.x, pivot.y, .72)), rod(`${side}-pivot-brace`, v(pivot.x, pivot.y, .72), pivot), rod(`${side}-lever`, pivot, end), rod(`${side}-handle-link`, end, center), rod(`${side}-handle`, add(center, v(0, -.075, 0)), add(center, v(0, .075, 0))));
        rollers.push(roller(`${side}-pivot`, pivot, .05, .045));
    }
    pose.apparatus = { ...pose.apparatus, pads: [...pose.apparatus.pads, pad("chest", chest, up, .34, .27, mul(front, -1))], rods, rollers };
    pose.camera = { yaw: 46, pitch: 12, viewBox: "-30 70 400 285" };
    return pose;
}, stages("胸托伸臂", "屈肘后拉", "握柄靠近下肋"), 3900);
export const assistedPullUpStudy = study("assisted-pull-up", "Assisted Pull-up", "器械辅助引体", "双手固定握住上方横杆，双膝持续贴活动垫，身体上拉时膝垫上升、配重下降", phase => {
    const a = cycle(phase), barY = 2.15, barZ = .13, halfGrip = .36;
    const hangGap = Math.sqrt(.58 ** 2 - (halfGrip - BODY.shoulderHalf) ** 2 - barZ ** 2), rise = (hangGap - .105) * a;
    const shoulderY = barY - hangGap + rise, hips = v(0, shoulderY - BODY.torso, 0);
    const knees = SIDES.map(([, sign]) => add(add(hips, v(sign * .1, 0, 0)), mul(unit(v(sign * .04, -.96, .26)), BODY.thigh)));
    const ankles = knees.map(knee => add(knee, mul(unit(v(0, .10, -.995)), BODY.shin)));
    const joints = body(hips, Y, [ankles[0], ankles[1]]), platformY = knees[0].y - .052;
    const pose = { joints, feet: "air", shorts: { hipFlexion: true }, bar: { center: v(0, barY, barZ), halfLength: .63, plateRadius: 0, support: "hands", kind: "pull-up-bar", grip: "pronated", depthPolicy: "physical" },
        apparatus: { pads: [pad("knee-platform", v(0, platformY, knees[0].z + .04), Z, .23, .45)], rods: [
                ...tower(-.80, -.25, 2.30, .72 - rise), rod("top-crossbar", v(-.80, 2.30, -.25), v(.64, 2.30, -.25)),
                ...SIDES.flatMap(([side, sign]) => [rod(`${side}-column`, v(sign * .64, .025, -.25), v(sign * .64, 2.30, -.25)), rod(`${side}-base`, v(sign * .64, .03, -.48), v(sign * .64, .03, .43)), rod(`${side}-bar-support`, v(sign * .63, 2.30, -.25), v(sign * .63, barY, barZ))]),
                rod("platform-arm", v(-.51, platformY - .04, -.25), v(0, platformY - .04, knees[0].z)),
            ], cables: [
                { id: "platform-lift", a: v(-.51, platformY - .04, -.25), b: v(-.51, 2.24, -.25) },
                { id: "overhead", a: v(-.51, 2.24, -.25), b: v(-.80, 2.24, -.25) },
                { id: "counterweight", a: v(-.80, 2.24, -.25), b: v(-.80, 1.05 - rise, -.25) },
            ] }, camera: { yaw: 35, pitch: 8, viewBox: "-25 -25 405 380" } };
    for (const [index, [side, sign]] of SIDES.entries()) {
        joints[`${side}Knee`] = knees[index];
        joints[`${side}Wrist`] = v(sign * halfGrip, barY, barZ);
        joints[`${side}Elbow`] = bendJoint(joints[`${side}Shoulder`], joints[`${side}Wrist`], BODY.upperArm, BODY.forearm, v(sign * .4, -.4, -.2));
        const normal = unit(sub(knees[index], ankles[index])), forward = unit(cross(X, normal));
        (pose.footFrames ??= {})[side] = { forward, normal };
        joints[`${side}Toe`] = add(add(joints[`${side}Ankle`], mul(forward, .17)), mul(normal, -.045));
    }
    return pose;
}, stages("双膝贴垫", "屈肘上拉", "下巴越杆"), 4100);
export const upperMachineStudies = [pecDeckStudy, shoulderPressMachineStudy, chestSupportedRowStudy, reversePecDeckStudy, assistedPullUpStudy];
