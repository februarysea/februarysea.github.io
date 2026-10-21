import { add, blend, cross, dot, mul, sub, unit } from "./rig.js";
import { torsoFrameAt } from "./torso-curve.js";
/** Sample a physical ring; renderers can select its visible arc by camera depth. */
export function garmentRingPoint(ring, angle) {
    return add(ring.center, add(mul(ring.side, Math.cos(angle) * ring.rx), mul(ring.front, Math.sin(angle) * ring.rz)));
}
export function garmentRingPoints(ring, count = 32) {
    return Array.from({ length: count }, (_, i) => garmentRingPoint(ring, i * Math.PI * 2 / count));
}
/**
 * A small pelvis yoke and two separate, femur-skinned fabric sleeves. The old
 * flat outline moved each hem's centre but kept its edge and crotch in the torso
 * frame. At deep flexion that left the shorts hanging vertically over horizontal
 * thighs. Here every sleeve section and seam rotates with its own femur.
 *
 * The proximal rings overlap the pelvis yoke, which should be drawn over their
 * tops without an internal joining stroke. It is one continuous garment surface,
 * not two visible capped cylinders. Only the distal ring is a visible hem.
 */
export function garmentGeometry(pose) {
    const j = pose.joints;
    const hips = blend(j.leftHip, j.rightHip, .5);
    const shoulders = blend(j.leftShoulder, j.rightShoulder, .5);
    const pelvisFrame = pose.torsoCurve ? torsoFrameAt(pose, 0) : undefined;
    const up = pelvisFrame?.up ?? unit(sub(shoulders, hips));
    const side = pelvisFrame?.side ?? unit(sub(j.rightHip, j.leftHip));
    const front = pelvisFrame?.front ?? unit(cross(side, up));
    const down = unit(add(unit(sub(j.leftKnee, j.leftHip)), unit(sub(j.rightKnee, j.rightHip))));
    // A deep hinge needs fabric to bridge the trunk and nearly upright thighs.
    // A squat folds the thighs toward the trunk instead; preserve that garment,
    // along with the supported bench pose. Both hinge gates vary smoothly.
    const hingeAmount = !pose.bench && !pose.torsoCurve ? Math.max(0, Math.min(1, (.85 - up.y) / .50)) : 0;
    const uprightLegAmount = Math.max(0, Math.min(1, (-down.y - .40) / .30));
    const hinge = hingeAmount * hingeAmount * (3 - 2 * hingeAmount)
        * uprightLegAmount * uprightLegAmount * (3 - 2 * uprightLegAmount);
    const sleeve = (name, sign) => {
        const hip = j[`${name}Hip`], knee = j[`${name}Knee`];
        const axis = unit(sub(knee, hip));
        const sleeveSide = unit(sub(side, mul(axis, dot(side, axis))));
        const sleeveFront = unit(cross(sleeveSide, mul(axis, -1)));
        // A deeply flexed thigh must not carry an upright circular sleeve root
        // below the pelvis as a second round buttock. Keep its root in the pelvic
        // frame and progressively skin the following rings toward the femur. The
        // cuff remains exactly thigh-aligned. Existing studies opt out entirely.
        const flexAmount = pose.shorts?.hipFlexion ? Math.max(0, Math.min(1, (dot(axis, up) + .25) / .65)) : 0;
        const flex = flexAmount * flexAmount * (3 - 2 * flexAmount);
        const section = (t, rx, rz, pelvisInfluence = 0) => {
            const influence = flex * pelvisInfluence;
            if (influence === 0)
                return { center: blend(hip, knee, t), side: sleeveSide, front: sleeveFront, rx, rz };
            const ringSide = unit(blend(sleeveSide, side, influence));
            const blendedFront = blend(sleeveFront, front, influence);
            const ringFront = unit(sub(blendedFront, mul(ringSide, dot(blendedFront, ringSide))));
            return { center: blend(hip, knee, t), side: ringSide, front: ringFront, rx, rz };
        };
        const rings = [
            // The yoke covers the proximal fabric. Taper its hidden sleeve root in
            // a hinge so it does not poke out behind the pelvis as a second cuff.
            section(0, .102 - .021 * hinge - .025 * flex, .107 - .024 * hinge - .025 * flex, 1),
            section(.08, .104 - .008 * hinge - .013 * flex, .108 - .009 * hinge - .014 * flex, .70),
            section(.26, .104, .106, .15),
            section(.43, .100, .098),
        ];
        const hem = rings[rings.length - 1];
        return {
            name, axis, side: sleeveSide, front: sleeveFront, rings, hem,
            outerSeam: rings.map(section => add(section.center, mul(sleeveSide, sign * section.rx))),
        };
    };
    const legs = [sleeve("left", -1), sleeve("right", 1)];
    const crotch = add(hips, mul(down, .080));
    // Reusing the trunk frame for every pelvis ring turns the widest ring into a
    // vertical disc at the hip, producing a round "ball" above a disconnected
    // trouser leg. Blend the lower fabric frames toward the femurs instead.
    const thighUp = mul(down, -1);
    const fabricFrame = (influence) => hinge === 0 ? front : unit(cross(side, unit(blend(up, thighUp, influence * hinge))));
    const ring = (center, rx, rz, influence = 0) => ({
        center, rx, rz, side, front: fabricFrame(influence),
    });
    const waistRing = (height, rx, rz) => {
        if (pose.shorts?.anchoredWaist)
            return { center: add(hips, mul(up, height)), rx, rz, side, front };
        if (!pose.torsoCurve)
            return ring(add(hips, mul(up, height)), rx, rz, .28);
        const frame = torsoFrameAt(pose, height / .49);
        return { center: frame.center, side: frame.side, front: frame.front, rx, rz };
    };
    const waistband = [
        waistRing(.084, .160, .100 - (pose.shorts?.anchoredWaist ? 0 : .010 * hinge)),
        waistRing(.059, .169, .107 - (pose.shorts?.anchoredWaist ? 0 : .011 * hinge)),
    ];
    return {
        hingeBlend: hinge,
        waistband,
        // The waist still overlaps the torso. Below it, compact transition rings
        // join the hip roots to the upper thighs without an inflated rear cap.
        pelvis: [waistband[0], waistband[1],
            ring(hips, .193 - .019 * hinge, .116 - .018 * hinge, .62),
            ring(add(hips, mul(down, .025 + .025 * hinge)), .181 - .009 * hinge, .106 - .007 * hinge, .85),
            ...(pose.shorts?.continuousYoke ? (() => {
                // One continuous seat joins the two proximal sleeves during a hinge.
                const roots = legs.map(leg => leg.rings[2]), center = blend(roots[0].center, roots[1].center, .5);
                return [{ center, side, front: unit(cross(side, mul(down, -1))),
                        rx: Math.max(...roots.map(r => Math.abs(dot(sub(r.center, center), side)) + r.rx)), rz: .106 }];
            })() : [])],
        legs,
        crotch,
    };
}
