import { add, bendJoint, BODY, mul, sub, unit, v } from "./rig.js";
import { arm, body, SIDES, Y, Z } from "./expansion-common.js";
import { toe } from "./machine-common.js";
export function floorBody(hips, up) {
    const ankles = SIDES.map(([, sign]) => add(hips, v(sign * .10, -.855, 0)));
    return { joints: body(hips, up, ankles), feet: "air", shorts: { hipFlexion: true }, anatomy: { surfaceArms: true },
        camera: { yaw: 66, pitch: 18, viewBox: "-10 140 370 215" } };
}
/** The actual palm surface rests on the support, while the wrist stays above it. */
export function supportHand(pose, side, surface, pole, forward = Z, normal = Y) {
    const center = add(surface, mul(normal, .014));
    arm(pose.joints, side, add(add(center, mul(forward, -.050)), mul(normal, .024)), pole);
    (pose.handContacts ??= {})[side] = { center, forward, normal };
}
export function foot(pose, side, ankle, forward = Z, normal = Y) {
    pose.joints[`${side}Ankle`] = ankle;
    pose.joints[`${side}Toe`] = toe(ankle, forward, normal);
    (pose.footFrames ??= {})[side] = { forward, normal };
}
export function legTo(pose, side, ankle, pole, forward = Z, normal = Y) {
    foot(pose, side, ankle, forward, normal);
    pose.joints[`${side}Knee`] = bendJoint(pose.joints[`${side}Hip`], ankle, BODY.thigh, BODY.shin, pole);
}
export function forefootFrame(pitch = -1.10) {
    const forward = v(0, Math.sin(pitch), Math.cos(pitch)), normal = v(0, Math.cos(pitch), -Math.sin(pitch));
    return { forward, normal, height: -.19 * forward.y + .07 * normal.y };
}
/** A high plank with fixed palms and the complete shoe rotating about its forefoot. */
export function plankPose(shoulderHeight = .604) {
    const frame = forefootFrame(), angle = Math.asin((shoulderHeight - frame.height) / 1.358), up = v(0, Math.sin(angle), Math.cos(angle));
    const ankles = [v(-.10, frame.height, -.85), v(.10, frame.height, -.85)];
    const pose = floorBody(add(v(0, frame.height, -.85), mul(up, .868)), up);
    for (const [side, sign] of SIDES) {
        legTo(pose, side, ankles[sign === -1 ? 0 : 1], v(0, -1, 0), frame.forward, frame.normal);
        supportHand(pose, side, v(sign * .27, 0, .52), v(sign * .8, .15, -.6));
    }
    pose.groundContacts = [v(-.34, 0, .50), v(.34, 0, .50), v(-.19, 0, -.83), v(.19, 0, -.83)];
    return pose;
}
/** Four-point kneeling, with knee surfaces on the floor and unclipped raised shoes. */
export function quadrupedPose() {
    const kneeHeight = .0428, hips = v(0, kneeHeight + BODY.thigh, -.30), rise = (.61 - hips.y) / BODY.torso;
    const pose = floorBody(hips, v(0, rise, Math.sqrt(1 - rise ** 2)));
    for (const [side, sign] of SIDES) {
        const knee = v(sign * .10, kneeHeight, -.30), ankle = add(knee, v(0, .10, -Math.sqrt(BODY.shin ** 2 - .10 ** 2)));
        pose.joints[`${side}Knee`] = knee;
        foot(pose, side, ankle, v(0, -.3, -Math.sqrt(.91)), v(0, Math.sqrt(.91), -.3));
        supportHand(pose, side, v(sign * .25, 0, .25), v(sign * .5, -.2, -.5));
    }
    pose.groundContacts = [v(-.32, 0, .25), v(.32, 0, .25), v(-.19, 0, -.30), v(.19, 0, -.30)];
    return pose;
}
export function bodyUp(pose) {
    const j = pose.joints;
    return unit(sub(mul(add(j.leftShoulder, j.rightShoulder), .5), mul(add(j.leftHip, j.rightHip), .5)));
}
