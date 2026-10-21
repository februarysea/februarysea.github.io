import { add, bendJoint, BODY, cross, mul, sub, unit, v } from "./rig.js";
import { body, SIDES, X, Y, Z } from "./expansion-common.js";
export const rod = (id, a, b, radius = .018) => ({ id, a, b, radius });
export const pad = (id, center, axis, length, width, normal = Y, across = X, thickness = .065) => ({ id, center, axis, length, width, normal, across, thickness });
export const roller = (id, center, length, radius, axis = X) => ({ id, center, length, radius, axis });
export const middle = (a, b) => mul(add(a, b), .5);
export const toe = (ankle, forward, normal) => add(add(ankle, mul(forward, .17)), mul(normal, -.045));
/** Follow the thighs' support plane instead of cutting a level pad through the shorts. */
export function positionSeat(pose, fixedAxis) {
    const j = pose.joints, hips = middle(j.leftHip, j.rightHip), knees = middle(j.leftKnee, j.rightKnee);
    const along = fixedAxis ?? unit(sub(knees, hips)), normal = unit(cross(along, X));
    const center = add(add(hips, mul(along, .10)), mul(normal, -.108));
    pose.apparatus = { ...pose.apparatus,
        pads: pose.apparatus.pads.map(p => p.id === "seat" ? { ...p, center, axis: along, normal, length: .46 } : p),
        rods: pose.apparatus.rods.map(r => r.id === "seat-post" ? { ...r, b: add(center, mul(normal, -.065)) } : r),
    };
}
/** Solve to the palm's shaft center, then recover the anatomical wrist. */
export function grip(pose, side, center, axis, pole) {
    const j = pose.joints, elbow = bendJoint(j[`${side}Shoulder`], center, BODY.upperArm, BODY.forearm + .05, pole);
    j[`${side}Elbow`] = elbow;
    j[`${side}Wrist`] = add(center, mul(unit(sub(elbow, center)), .05));
    (pose.handholds ??= {})[side] = { center, axis, grip: "neutral" };
}
/** Pressing palms face across the shaft, perpendicular to the forearm.
 * Explicitly opt in: a missing palm frame must not turn the fist into an end cap. */
export function pressGrip(pose, side, center, axis, pole) {
    grip(pose, side, center, axis, pole);
    const reach = unit(sub(pose.joints[`${side}Wrist`], pose.joints[`${side}Elbow`]));
    const palmNormal = unit(cross(axis, reach)), sign = side === "left" ? -1 : 1;
    Object.assign(pose.handholds[side], { grip: "pronated", palmNormal, thumb: mul(unit(cross(palmNormal, reach)), sign) });
}
export function seated(height = .61, lean = -.10, back = true) {
    const up = v(0, Math.cos(lean), Math.sin(lean)), front = unit(cross(X, up)), hips = v(0, height, 0);
    const joints = body(hips, up, [v(-.17, .085, .43), v(.17, .085, .43)]);
    const seatY = height - .105;
    const pose = { joints, feet: "air", shorts: { hipFlexion: true }, anatomy: { surfaceArms: true },
        apparatus: { pads: [pad("seat", v(0, seatY, .11), Z, .43, .40), ...(back ? [pad("back", add(add(hips, mul(up, .31)), mul(front, -.125)), up, .72, .30, front)] : [])], rods: [
                rod("seat-post", v(0, .04, .04), v(0, seatY - .065, .04)),
                rod("base", v(0, .035, -.40), v(0, .035, .60)),
                rod("rear-foot", v(-.48, .03, -.35), v(.48, .03, -.35)),
                rod("front-foot", v(-.48, .03, .56), v(.48, .03, .56)),
                ...(back ? [rod("back-support", v(0, .05, -.22), add(add(hips, mul(up, .56)), mul(front, -.20)))] : []),
            ] }, camera: { yaw: 56, pitch: 13, viewBox: "-10 55 365 300" } };
    positionSeat(pose);
    return pose;
}
export function handlesAtSides(pose) {
    const rods = [...pose.apparatus?.rods ?? []];
    for (const [side, sign] of SIDES) {
        const center = add(pose.joints[`${side}Hip`], v(sign * .23, .065, -.045));
        grip(pose, side, center, Z, v(sign, -.5, -.4));
        rods.push(rod(`${side}-handle`, add(center, v(0, 0, -.10)), add(center, v(0, 0, .10)), .013));
        rods.push(rod(`${side}-handle-post`, add(center, v(0, -.20, -.10)), add(center, v(0, 0, -.10))));
    }
    pose.apparatus = { ...pose.apparatus, rods };
}
/** Ground the complete sole in new seated studies without changing old poses. */
export function plantSeatedFeet(pose) {
    for (const [side] of SIDES) {
        const ankle = { ...pose.joints[`${side}Ankle`], y: .07 };
        pose.joints[`${side}Ankle`] = ankle;
        pose.joints[`${side}Knee`] = bendJoint(pose.joints[`${side}Hip`], ankle, BODY.thigh, BODY.shin, Z);
        pose.joints[`${side}Toe`] = add(ankle, v(0, -.045, .17));
    }
    positionSeat(pose);
}
/** Compact counterweight tower, kept behind the moving limbs. */
export function tower(x, z, height, lift = 0) {
    const rods = [rod("tower-left", v(x - .13, .04, z), v(x - .13, height, z)), rod("tower-right", v(x + .13, .04, z), v(x + .13, height, z)), rod("tower-top", v(x - .13, height, z), v(x + .13, height, z)), rod("tower-base", v(x - .18, .03, z), v(.2, .03, z))];
    for (let i = 0; i < 6; i++)
        rods.push(rod(`weight-${i}`, v(x - .105, .15 + i * .036 + lift, z), v(x + .105, .15 + i * .036 + lift, z), .012));
    return rods;
}
/** Individually visible solid plates; their whole volume follows the lift. */
export function stackPlates(x, z, lift) {
    return Array.from({ length: 6 }, (_, i) => pad(`weight-stack-${i}`, v(x, .17 + i * .043 + lift, z), Z, .17, .25, Y, X, .028));
}
