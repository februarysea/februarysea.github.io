import { add, dot, mul, sub, unit, v } from './rig.js';
import { clipLineInside, clipLineOutside, flattenPath, pointInPolygon } from './contours.js';
import { shoeGeometry } from './feet.js';
const xy = (p) => `${+p.x.toFixed(3)},${+p.y.toFixed(3)}`;
const area = (points) => points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p.x * q.y - p.y * q.x;
}, 0);
const openPolygon = (p) => p.length > 1 && Math.hypot(p[0].x - p.at(-1).x, p[0].y - p.at(-1).y) < 1e-6 ? p.slice(0, -1) : p;
const polygonBounds = new WeakMap();
function nearPolygon(p, polygon, radius) {
    let bounds = polygonBounds.get(polygon);
    if (!bounds) {
        bounds = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
        for (const q of polygon) {
            bounds.x0 = Math.min(bounds.x0, q.x);
            bounds.x1 = Math.max(bounds.x1, q.x);
            bounds.y0 = Math.min(bounds.y0, q.y);
            bounds.y1 = Math.max(bounds.y1, q.y);
        }
        polygonBounds.set(polygon, bounds);
    }
    // Reject disjoint ink/masks before walking their edges. The exact test below
    // is unchanged, including stroke-width clearance at adjacent curved bands.
    if (p.x < bounds.x0 - radius || p.x > bounds.x1 + radius || p.y < bounds.y0 - radius || p.y > bounds.y1 + radius)
        return false;
    if (pointInPolygon(p, polygon))
        return true;
    return polygon.some((a, i) => {
        const b = polygon[(i + 1) % polygon.length], dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) <= radius;
    });
}
function halfPlane(points, signed, inside) {
    const out = [];
    for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length], da = signed(a), db = signed(b);
        const hasA = inside ? da >= 0 : da <= 0, hasB = inside ? db >= 0 : db <= 0;
        if (hasA)
            out.push(a);
        if (hasA !== hasB) {
            const t = da / (da - db);
            out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
    }
    return out;
}
/** Subtract convex equipment silhouettes from a filled limb without inventing
 * new outline strokes along the cut. The real outer contour is clipped apart. */
function subtractPolygons(d, masks) {
    let pieces = flattenPath(d).map(openPolygon).filter(p => p.length >= 3);
    for (const raw of masks) {
        const mask = openPolygon(raw), direction = area(mask) >= 0 ? 1 : -1, result = [];
        for (const piece of pieces) {
            let inside = piece;
            for (let i = 0; i < mask.length && inside.length >= 3; i++) {
                const a = mask[i], b = mask[(i + 1) % mask.length];
                const signed = (p) => direction * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
                const outside = halfPlane(inside, signed, false);
                if (outside.length >= 3 && Math.abs(area(outside)) > 1e-7)
                    result.push(outside);
                inside = halfPlane(inside, signed, true);
            }
        }
        pieces = result;
    }
    return pieces.map(p => p.map((q, i) => `${i ? 'L' : 'M'}${xy(q)}`).join('') + 'Z').join('') || 'M0,0';
}
export function refineLocalOverlap(pose, original) {
    const options = pose.localOcclusion;
    if (!options)
        return original;
    const parts = original.map(p => ({ ...p })), byId = new Map(parts.map(p => [p.id, p]));
    const yaw = (pose.camera?.yaw ?? 42) * Math.PI / 180, pitch = (pose.camera?.pitch ?? 9) * Math.PI / 180;
    const view = v(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const depth = (p) => dot(p, view);
    const j = pose.joints;
    if (options.rollers) {
        const rollerBands = parts.filter(p => p.id.startsWith('roller-ankle-pad-band-')).map(p => ({ part: p, masks: flattenPath(p.d) }));
        for (const ink of parts.filter(p => p.id.startsWith('roller-ankle-pad-edge-'))) {
            const paths = flattenPath(ink.d), samples = paths.flatMap(path => [...path, ...path.slice(1).map((p, i) => ({ x: (p.x + path[i].x) / 2, y: (p.y + path[i].y) / 2 }))]);
            // Include the whole stroke width: an adjacent curved band can cover
            // half a contour without containing its centerline.
            for (const { part, masks } of rollerBands)
                if (samples.some(p => masks.some(mask => nearPolygon(p, mask, ink.width / 2 + .03))))
                    ink.depth = Math.max(ink.depth, part.depth + .002);
        }
        for (const side of ['left', 'right']) {
            const bands = parts.filter(p => p.id.startsWith(`${side}-leg-band-`)).map(p => ({ part: p, masks: flattenPath(p.d) }));
            for (const ink of parts.filter(p => new RegExp(`^${side}-(?:calf|shin)-local-`).test(p.id))) {
                const samples = flattenPath(ink.d).flat();
                if (samples.length > 1)
                    samples.push({ x: (samples[0].x + samples.at(-1).x) / 2, y: (samples[0].y + samples.at(-1).y) / 2 });
                for (const { part, masks } of bands)
                    if (samples.some(p => masks.some(mask => nearPolygon(p, mask, ink.width / 2 + .03))))
                        ink.depth = Math.max(ink.depth, part.depth + .002);
            }
        }
        const roller = pose.apparatus?.rollers?.find(r => r.id === 'ankle-pad');
        const body = byId.get('roller-ankle-pad-body');
        if (roller && body) {
            const equipment = parts.filter(p => /^roller-ankle-pad-(?:band-|edge-|cap)/.test(p.id));
            const targets = [...equipment, ...parts.filter(p => /^(?:left|right)-(?:shoe|sole|laces)$/.test(p.id))];
            const outlines = new Map();
            for (const p of targets)
                if (p.fill !== 'none' && p.stroke !== 'none') {
                    const outline = { ...p, id: `${p.id}-contact-outline`, fill: 'none', depth: p.depth + .0001 };
                    parts.push(outline);
                    outlines.set(p.id, outline);
                    p.stroke = 'none';
                }
            const cut = (p, masks) => {
                const outline = outlines.get(p.id);
                if (outline)
                    outline.d = clipLineOutside(outline.d, masks);
                p.d = p.fill === 'none' ? clipLineOutside(p.d, masks) : subtractPolygons(p.d, masks);
            };
            for (const side of ['left', 'right']) {
                const shoe = byId.get(`${side}-shoe`), surface = shoeGeometry(pose, side), shin = unit(sub(j[`${side}Ankle`], j[`${side}Knee`]));
                const plane = unit(add(pose.footFrames[side].forward, shin));
                // A separating plane proves the entire shoe and roller are disjoint.
                // Its camera-facing sign determines the local overlap, regardless of
                // either part's mean depth or the depth of the attached thigh.
                const separation = Math.min(...surface.points.map(p => dot(sub(p, roller.center), plane))) - roller.radius;
                if (separation <= 0 || Math.abs(dot(plane, roller.axis)) > 1e-6)
                    continue;
                if (dot(plane, view) > 0) {
                    const masks = flattenPath(shoe.d);
                    for (const p of equipment)
                        cut(p, masks);
                }
                else {
                    const masks = flattenPath(body.d);
                    for (const p of targets.filter(p => p.id.startsWith(`${side}-`)))
                        cut(p, masks);
                }
            }
        }
    }
    if (options.handheld)
        for (const side of ['left', 'right']) {
            const hold = pose.handholds?.[side], weight = pose.dumbbells?.find(d => d.id === side);
            if (!hold || !weight)
                continue;
            const axis = unit(weight.axis), sign = dot(axis, view) >= 0 ? 1 : -1, toward = mul(axis, sign);
            const plate = byId.get(`dumbbell-${side}-${sign}-edge`);
            if (!plate)
                continue;
            // A whole near plate precedes its own fist/forearm on every shared ray
            // when they lie behind its inner axial plane. Includes the plate sidewall.
            const elbow = j[`${side}Elbow`], wrist = j[`${side}Wrist`];
            const support = Math.max(dot(sub(elbow, weight.center), toward) + .056, dot(sub(wrist, weight.center), toward) + .042, .043);
            const masks = support < weight.halfLength - .018 - .001 ? flattenPath(plate.d) : [];
            const related = parts.filter(p => p.id.startsWith(`${side}-`) && /-(?:hand|thumb|grip|finger-\d|wrist-crease|forearm|forearm-outline|forearm-tendon)$/.test(p.id));
            for (const part of related) {
                const d = part.d;
                if (part.fill !== 'none' && part.stroke !== 'none') {
                    parts.push({ ...part, id: `${part.id}-contact-outline`, d: clipLineOutside(d, masks), fill: 'none', depth: part.depth + .0001 });
                    part.stroke = 'none';
                }
                if (masks.length)
                    part.d = part.fill === 'none' ? clipLineOutside(d, masks) : subtractPolygons(d, masks);
            }
        }
    if (options.elbows)
        for (const side of ['left', 'right']) {
            const elbow = byId.get(`${side}-elbow-fill`), upper = byId.get(`${side}-upper-arm`), forearm = byId.get(`${side}-forearm`);
            if (!elbow || !upper || !forearm)
                continue;
            const delta = Math.max(upper.depth, forearm.depth, depth(j[`${side}Elbow`]) + .036) + .002 - elbow.depth;
            for (const suffix of ['elbow-fill', 'elbow-outline', 'elbow-crease']) {
                const part = byId.get(`${side}-${suffix}`);
                if (part)
                    part.depth += delta;
            }
            const right = v(Math.cos(yaw), 0, -Math.sin(yaw)), up = v(-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), -Math.cos(yaw) * Math.sin(pitch));
            const center = { x: 180 + depthProjection(j[`${side}Elbow`], right), y: 315 - depthProjection(j[`${side}Elbow`], up) };
            const disk = Array.from({ length: 32 }, (_, i) => ({ x: center.x + .036 * 132 * Math.cos(i * Math.PI / 16), y: center.y + .036 * 132 * Math.sin(i * Math.PI / 16) }));
            for (const suffix of ['upper-arm-outline', 'forearm-outline', 'biceps', 'triceps', 'forearm-tendon']) {
                const part = byId.get(`${side}-${suffix}`);
                const adjacent = suffix.startsWith('forearm') ? upper : forearm;
                if (part)
                    part.d = clipLineOutside(part.d, [disk, ...flattenPath(adjacent.d)]);
            }
        }
    if (options.chestBar && pose.bar) {
        const torso = byId.get('torso');
        if (torso) {
            const masks = flattenPath(torso.d);
            const torsoInk = parts.filter(p => /^(?:anatomy-|torso)/.test(p.id));
            const front = Math.max(torso.depth, ...torsoInk.map(p => p.depth));
            for (const part of parts.filter(p => /^bar-\d+$/.test(p.id))) {
                const crossing = flattenPath(part.d).some(path => path.some((p, i) => {
                    const q = path[(i + 1) % path.length];
                    return Array.from({ length: 17 }, (_, k) => ({ x: p.x + (q.x - p.x) * k / 16, y: p.y + (q.y - p.y) * k / 16 }))
                        .some(sample => masks.some(mask => pointInPolygon(sample, mask)));
                }));
                if (crossing)
                    part.depth = Math.max(part.depth, front + .004);
            }
        }
    }
    if (options.shoulders)
        for (const side of ['left', 'right']) {
            const cap = byId.get(`${side}-shoulder-fill`), upper = byId.get(`${side}-upper-arm`), torso = byId.get('torso');
            if (!cap || !upper || !torso)
                continue;
            // A shoulder and its upper arm share one outer contour. Mean arm depth
            // must not expose a circular shoulder seam when the arm faces the viewer.
            const masks = flattenPath(cap.d);
            const deltoid = byId.get(`${side}-deltoid`), shoulderInk = options.shoulderInk && deltoid ? clipLineInside(deltoid.d, masks) : undefined;
            for (const suffix of ['upper-arm-outline', 'deltoid']) {
                const part = byId.get(`${side}-${suffix}`);
                if (part)
                    part.d = clipLineOutside(part.d, masks);
            }
            cap.depth = Math.max(cap.depth, upper.depth + .002);
            if (deltoid && shoulderInk)
                parts.push({ ...deltoid, id: `${side}-deltoid-shoulder`, d: shoulderInk, depth: cap.depth + .002 });
            const contour = byId.get(`${side}-shoulder-contour`);
            if (contour)
                contour.depth = cap.depth + .0004;
        }
    if (options.hips) {
        const cloth = parts.filter(p => /^(?:shorts|left-shorts-leg|right-shorts-leg)$/.test(p.id)).flatMap(p => flattenPath(p.d));
        for (const part of parts.filter(p => /^(?:torso-outline|anatomy-)/.test(p.id)))
            part.d = clipLineOutside(part.d, cloth);
        for (const side of ['left', 'right']) {
            const covered = ['shorts', `${side}-shorts-leg`].flatMap(id => flattenPath(byId.get(id).d));
            const leg = byId.get(`${side}-leg`);
            if (!leg)
                continue;
            // The skin starts under the garment. Its closed proximal cap must never
            // reappear over the waist merely because a knee is closer to the camera.
            parts.push({ ...leg, id: `${side}-leg-contact-outline`, d: clipLineOutside(leg.d, covered), fill: 'none', depth: leg.depth + .0001 });
            leg.d = subtractPolygons(leg.d, covered);
            leg.stroke = 'none';
            for (const suffix of ['quadriceps', 'quadriceps-inner']) {
                const ink = byId.get(`${side}-${suffix}`);
                if (ink)
                    ink.d = clipLineOutside(ink.d, covered);
            }
        }
    }
    return parts;
}
function depthProjection(point, axis) { return dot(point, axis) * 132; }
