import { add, blend, BODY, cross, dot, length, mul, sub, unit, v } from "./rig.js";
export const TORSO_SECTIONS = [
    [.02, .152, .086], [.16, .146, .092], [.34, .140, .096], [.54, .170, .117],
    [.78, .215, .125], [.96, .215, .100], [1.04, .142, .077], [1.14, .057, .052],
];
const sinc = (x) => Math.abs(x) < 1e-4 ? 1 - x * x / 6 + x ** 4 / 120 : Math.sin(x) / x;
const cosc = (x) => Math.abs(x) < 1e-4 ? .5 - x * x / 24 + x ** 4 / 720 : (1 - Math.cos(x)) / (x * x);
export function rotateAbout(vector, axis, angle) {
    return add(add(mul(vector, Math.cos(angle)), mul(cross(axis, vector), Math.sin(angle))), mul(axis, dot(axis, vector) * (1 - Math.cos(angle))));
}
/** t is normalized arc length, so bending never changes the .49 m body length. */
export function torsoFrameAt(pose, t) {
    const j = pose.joints, hips = blend(j.leftHip, j.rightHip, .5), curve = pose.torsoCurve;
    if (!curve) {
        const shoulders = pose.torsoShoulders ?? blend(j.leftShoulder, j.rightShoulder, .5), up = unit(sub(shoulders, hips)), side = unit(sub(j.rightShoulder, j.leftShoulder));
        return { center: blend(hips, shoulders, t), up, side, front: unit(cross(side, up)) };
    }
    const up0 = unit(curve.pelvisUp), hipSide = sub(j.rightHip, j.leftHip), side0 = unit(sub(hipSide, mul(up0, dot(hipSide, up0)))), front0 = unit(cross(side0, up0));
    const w = add(mul(front0, curve.flexion), mul(side0, curve.lateral ?? 0)), theta = length(w), at = Math.max(0, Math.min(1, t)), x = theta * at;
    const up = add(mul(up0, Math.cos(x)), mul(w, at * sinc(x)));
    let center = add(add(hips, mul(up0, BODY.torso * at * sinc(x))), mul(w, BODY.torso * at * at * cosc(x)));
    center = add(center, mul(up, BODY.torso * (t - at)));
    const axis = theta > 1e-12 ? unit(cross(up0, w)) : side0;
    const transported = theta > 1e-12 ? rotateAbout(side0, axis, x) : side0;
    const twist = (curve.twist ?? 0) * at * at * (3 - 2 * at), side = unit(rotateAbout(transported, up, twist));
    return { center, up: unit(up), side, front: unit(cross(side, up)) };
}
export function torsoRadii(t) {
    for (let i = 1; i < TORSO_SECTIONS.length; i++) {
        const a = TORSO_SECTIONS[i - 1], b = TORSO_SECTIONS[i];
        if (t <= b[0]) {
            const q = Math.max(0, (t - a[0]) / (b[0] - a[0]));
            return { width: a[1] + (b[1] - a[1]) * q, depth: a[2] + (b[2] - a[2]) * q };
        }
    }
    const last = TORSO_SECTIONS[TORSO_SECTIONS.length - 1];
    return { width: last[1], depth: last[2] };
}
export function torsoSurfaceAt(pose, t, angle) {
    const frame = torsoFrameAt(pose, t), radius = torsoRadii(t);
    return add(add(frame.center, mul(frame.side, radius.width * Math.cos(angle))), mul(frame.front, radius.depth * Math.sin(angle)));
}
/** Original anatomical (t,x) coordinates mapped onto the curved H2 surface. */
export function torsoSurfaceLocal(pose, t, x) {
    const frame = torsoFrameAt(pose, t), radius = torsoRadii(t), lateral = Math.max(-.94, Math.min(.94, x / radius.width)), angle = Math.acos(lateral);
    const point = torsoSurfaceAt(pose, t, angle), epsilon = 1e-4;
    const along = sub(torsoSurfaceAt(pose, t + epsilon, angle), torsoSurfaceAt(pose, t - epsilon, angle));
    const around = add(mul(frame.side, -radius.width * Math.sin(angle)), mul(frame.front, radius.depth * Math.cos(angle)));
    let normal = unit(cross(along, around));
    if (dot(normal, sub(point, frame.center)) < 0)
        normal = mul(normal, -1);
    return { point, normal };
}
/** Shoulder, neck and head endpoints are generated from the same curve as the skin. */
export function applyTorsoCurve(pose, curve) {
    pose.torsoCurve = curve;
    const frame = torsoFrameAt(pose, 1), j = pose.joints;
    j.leftShoulder = add(frame.center, mul(frame.side, -BODY.shoulderHalf));
    j.rightShoulder = add(frame.center, mul(frame.side, BODY.shoulderHalf));
    j.neck = add(frame.center, mul(frame.up, .115));
    j.head = add(frame.center, mul(frame.up, .235));
}
/** Entire elliptical rings, including the inner side of the bend, against a plane. */
export function torsoPlaneDistance(pose, t, normal, point = v(0, 0, 0)) {
    const frame = torsoFrameAt(pose, t), radius = torsoRadii(t);
    return dot(sub(frame.center, point), normal) - Math.hypot(radius.width * dot(frame.side, normal), radius.depth * dot(frame.front, normal));
}
