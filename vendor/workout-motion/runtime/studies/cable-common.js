import { add, cross, dot, length, mul, sub, unit, v } from "./rig.js";
import { arm, body, SIDES, X, Y } from "./expansion-common.js";
import { grip, rod, roller } from "./machine-common.js";
export function cableStanding(split = false) {
    const up = unit(v(0, 1, split ? .08 : 0));
    const joints = body(v(0, split ? .85 : .925, 0), up, split ? [v(-.18, .07, .25), v(.18, .07, -.25)] : [v(-.17, .07, 0), v(.17, .07, 0)]);
    return { joints, feet: "air", shorts: { hipFlexion: true }, apparatus: { rods: [], cables: [], rollers: [] }, camera: { yaw: 46, pitch: 11, viewBox: "-35 10 425 345" } };
}
export function idleArm(pose, side) {
    const sign = side === "left" ? -1 : 1, hip = pose.joints[`${side}Hip`];
    arm(pose.joints, side, add(hip, v(sign * .21, -.02, .08)), v(sign, -.3, .1));
}
/** A slim cable column; the cable exits at a real pulley rather than a free point. */
export function cableStation(pose, id, anchor, height = 1.95) {
    pose.apparatus = { ...pose.apparatus, rods: [...pose.apparatus?.rods ?? [],
            rod(`${id}-column`, v(anchor.x, .025, anchor.z), v(anchor.x, height, anchor.z)),
            rod(`${id}-base-x`, v(anchor.x - .16, .025, anchor.z), v(anchor.x + .16, .025, anchor.z)),
            rod(`${id}-base-z`, v(anchor.x, .025, anchor.z - .22), v(anchor.x, .025, anchor.z + .22)),
        ], rollers: [...pose.apparatus?.rollers ?? [], roller(`${id}-pulley`, anchor, .035, .042, X)] };
}
/** A swivelling D handle keeps its rigid frame ahead of the anatomical wrist. */
export function attachCableHandle(pose, side, anchor, axisHint = Y, halfWidth = .065) {
    const j = pose.joints, reach = unit(sub(j[`${side}Wrist`], j[`${side}Elbow`])), center = add(j[`${side}Wrist`], mul(reach, .05)), pull = unit(sub(anchor, center));
    let seed = sub(axisHint, mul(pull, dot(axisHint, pull)));
    seed = sub(seed, mul(reach, dot(seed, reach)));
    if (length(seed) < 1e-6) {
        const fallback = Math.abs(reach.x) < .8 ? X : Y;
        seed = sub(fallback, mul(reach, dot(fallback, reach)));
    }
    const shaft = unit(seed), raw = unit(sub(pull, mul(shaft, dot(pull, shaft))));
    const along = Math.max(-1, Math.min(1, dot(raw, reach)));
    let sideward = sub(raw, mul(reach, along));
    if (length(sideward) < 1e-6)
        sideward = cross(shaft, reach);
    const constrained = Math.max(-.30, along);
    const direction = add(mul(reach, constrained), mul(unit(sideward), Math.sqrt(1 - constrained * constrained)));
    const socket = add(center, mul(direction, .11)), left = add(center, mul(shaft, -halfWidth)), right = add(center, mul(shaft, halfWidth));
    (pose.handholds ??= {})[side] = { center, axis: shaft, grip: Math.abs(dot(axisHint, X)) > .9 ? "pronated" : "neutral" };
    pose.apparatus = { ...pose.apparatus, rods: [...pose.apparatus?.rods ?? [], rod(`${side}-grip`, left, right, .012), rod(`${side}-handle-a`, left, socket, .008), rod(`${side}-handle-b`, right, socket, .008)], cables: [...pose.apparatus?.cables ?? [], { id: `${side}-cable`, a: anchor, b: socket }] };
}
export function pullHandle(pose, side, center, anchor, pole, axisHint = Y, halfWidth = .065) {
    grip(pose, side, center, axisHint, pole);
    attachCableHandle(pose, side, anchor, axisHint, halfWidth);
}
/** Both rope branches have constant length even when their common socket moves. */
export function attachRope(pose, anchor, branchLength = .34) {
    const palms = SIDES.map(([side]) => { const j = pose.joints; return add(j[`${side}Wrist`], mul(unit(sub(j[`${side}Wrist`], j[`${side}Elbow`])), .05)); });
    const middle = mul(add(palms[0], palms[1]), .5), across = unit(sub(palms[1], palms[0])), separation = Math.hypot(...Object.values(sub(palms[1], palms[0]))) / 2;
    const force = unit(sub(sub(anchor, middle), mul(across, dot(sub(anchor, middle), across))));
    const socket = add(middle, mul(force, Math.sqrt(branchLength ** 2 - separation ** 2)));
    pose.apparatus = { ...pose.apparatus, cables: [...pose.apparatus?.cables ?? [], { id: "main-cable", a: anchor, b: socket }, ...SIDES.map(([side], i) => ({ id: `${side}-rope`, a: socket, b: palms[i] }))] };
    for (const [index, [side]] of SIDES.entries())
        (pose.handholds ??= {})[side] = { center: palms[index], axis: unit(sub(socket, palms[index])), grip: "neutral" };
}
