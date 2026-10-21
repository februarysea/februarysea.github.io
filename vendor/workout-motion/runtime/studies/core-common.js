import { add, BODY, cross, dot, mul, sub, unit, v } from "./rig.js";
import { arm, SIDES, study, X, Y } from "./expansion-common.js";
import { floorBody, foot, legTo } from "./bodyweight-common.js";
import { applyTorsoCurve, rotateAbout, torsoFrameAt } from "./torso-curve.js";
/** A fixed pelvis support: flexion lifts the thorax without sliding the feet. */
export const SUPINE_PELVIS_ANGLE = .023200303690842472;
export function coreStudy(...args) {
    const motion = study(...args);
    return { ...motion, pose: phase => ({ ...motion.pose(phase), exactSurfaceContours: true }) };
}
export function supineCore(flexion = 0, twist = 0, lateral = 0) {
    const up = v(0, Math.sin(SUPINE_PELVIS_ANGLE), -Math.cos(SUPINE_PELVIS_ANGLE));
    const pose = floorBody(v(0, .1161, .15), up);
    applyTorsoCurve(pose, { pelvisUp: up, flexion, twist, lateral });
    const end = torsoFrameAt(pose, 1), neckDirection = rotateAbout(end.up, end.side, -.1309489243293514);
    pose.joints.neck = add(end.center, mul(neckDirection, .115));
    pose.joints.head = add(pose.joints.neck, mul(rotateAbout(end.up, end.side, -.16534516363821194), .120));
    for (const [side, sign] of SIDES)
        legTo(pose, side, v(sign * .18, .07, .72), Y);
    pose.camera = { yaw: 63, pitch: 23, viewBox: "-15 135 385 220" };
    pose.groundContacts = [v(-.31, 0, -.42), v(.31, 0, -.42), v(-.28, 0, .76), v(.28, 0, .76)];
    return pose;
}
/** An explicit open palm frame avoids world-X hands on a rotated thorax. */
export function coreHand(pose, side, wrist, pole, forward, normal) {
    arm(pose.joints, side, wrist, pole);
    const along = unit(forward), n = unit(sub(normal, mul(along, dot(normal, along))));
    (pose.handContacts ??= {})[side] = { center: add(wrist, mul(along, .050)), forward: along, normal: n };
}
export function straightLeg(pose, side, direction, soleNormal) {
    const j = pose.joints, along = unit(direction), ankle = add(j[`${side}Hip`], mul(along, BODY.thigh + BODY.shin));
    j[`${side}Knee`] = add(j[`${side}Hip`], mul(along, BODY.thigh));
    const normal = soleNormal ?? mul(along, -1), forward = unit(cross(X, normal));
    foot(pose, side, ankle, forward, normal);
}
