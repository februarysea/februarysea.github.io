import { add, blend, cross, dot, mul, sub, unit, v } from "./rig.js";
import { clipLineOutside, flattenPath } from "./contours.js";
import { shoeGeometry } from "./feet.js";
const turn = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
const area = (p) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - a.y * b.x; }, 0);
const path = (p) => p.length < 3 ? "" : p.map((a, i) => `${i ? "L" : "M"}${+a.x.toFixed(3)},${+a.y.toFixed(3)}`).join("") + "Z";
/** Simplify only sub-pixel flattening samples, retaining the real silhouette. */
function polygon(points) {
    const p = points.filter((a, i) => !i || Math.hypot(a.x - points[i - 1].x, a.y - points[i - 1].y) > .001);
    if (p.length > 1 && Math.hypot(p[0].x - p.at(-1).x, p[0].y - p.at(-1).y) < .001)
        p.pop();
    for (let i = p.length - 1; i >= 0 && p.length > 3; i--) {
        const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length];
        if (Math.abs(turn(a, c, b)) < .035 * Math.hypot(c.x - a.x, c.y - a.y))
            p.splice(i, 1);
    }
    return area(p) < 0 ? p.reverse() : p;
}
function halfPlane(p, a, b, inside) {
    const result = [];
    for (let i = 0; i < p.length; i++) {
        const start = p[i], end = p[(i + 1) % p.length];
        const da = turn(a, b, start), db = turn(a, b, end), sa = inside ? da >= 0 : da <= 0, sb = inside ? db >= 0 : db <= 0;
        if (sa)
            result.push(start);
        if (sa !== sb) {
            const t = da / (da - db);
            result.push({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
        }
    }
    return result;
}
function triangles(p) {
    const rest = [...p], result = [];
    while (rest.length > 3) {
        let found = false;
        for (let i = 0; i < rest.length; i++) {
            const a = rest[(i + rest.length - 1) % rest.length], b = rest[i], c = rest[(i + 1) % rest.length];
            if (turn(a, b, c) <= 1e-8)
                continue;
            if (rest.some(p => p !== a && p !== b && p !== c && turn(a, b, p) >= -1e-8 && turn(b, c, p) >= -1e-8 && turn(c, a, p) >= -1e-8))
                continue;
            result.push([a, b, c]);
            rest.splice(i, 1);
            found = true;
            break;
        }
        if (!found)
            break;
    }
    if (rest.length === 3)
        result.push(rest);
    return result;
}
const bounds = (p) => ({ x0: Math.min(...p.map(a => a.x)), x1: Math.max(...p.map(a => a.x)), y0: Math.min(...p.map(a => a.y)), y1: Math.max(...p.map(a => a.y)) });
/** Complete Catmull tube against a separating plane, including spline extrema. */
function armPlaneMinimum(start, end, stops, radii, origin, normal) {
    const axis = unit(sub(end, start)), radial = Math.sqrt(Math.max(0, 1 - dot(axis, normal) ** 2));
    const values = stops.map((t, i) => dot(sub(blend(start, end, t), origin), normal) - radii[i] * radial);
    let minimum = Infinity;
    for (let i = 0; i < values.length - 1; i++) {
        const a = values[i], d = values[i + 1], b = a + (d - values[Math.max(0, i - 1)]) / 8, c = d - (values[Math.min(values.length - 1, i + 2)] - a) / 8;
        const A = -a + 3 * b - 3 * c + d, B = 3 * a - 6 * b + 3 * c, C = -3 * a + 3 * b, roots = [0, 1];
        if (Math.abs(A) < 1e-14) {
            if (Math.abs(B) > 1e-14)
                roots.push(-C / (2 * B));
        }
        else {
            const q = 4 * B * B - 12 * A * C;
            if (q >= 0)
                roots.push((-2 * B + Math.sqrt(q)) / (6 * A), (-2 * B - Math.sqrt(q)) / (6 * A));
        }
        for (const t of roots)
            if (t >= 0 && t <= 1)
                minimum = Math.min(minimum, ((A * t + B) * t + C) * t + a);
    }
    return minimum;
}
function subtract(subject, clip) {
    const a = bounds(subject), b = bounds(clip);
    if (a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0)
        return [subject];
    const outside = [];
    let rest = subject;
    for (let i = 0; i < clip.length && rest.length >= 3; i++) {
        const a = clip[i], b = clip[(i + 1) % clip.length], piece = halfPlane(rest, a, b, false);
        if (piece.length >= 3 && Math.abs(area(piece)) > .00001)
            outside.push(piece);
        rest = halfPlane(rest, a, b, true);
    }
    return outside;
}
/** Local equipment cutouts keep far body parts visible above their support plane.
 * No global front-layer override: the rest of the pad/box still hides objects
 * behind it. Fill and outline are separate so cutout edges create no extra ink.
 */
export function refineContactOcclusion(pose, parts) {
    const byId = new Map(parts.map(p => [p.id, p])), result = [];
    const masks = new Map();
    const body = (id) => flattenPath(byId.get(id).d).map(polygon);
    for (const pad of pose.apparatus?.pads ?? []) {
        let normal = pad.normal ? unit(pad.normal) : unit(cross(unit(pad.axis), pad.across ? unit(pad.across) : v(1, 0, 0)));
        if (!pad.normal && normal.y < 0)
            normal = mul(normal, -1);
        // Head and neck are wholly on the supported side; do not mask pads merely
        // because their 2D projections happen to overlap a head elsewhere.
        const offset = sub(pose.joints.head, pad.center);
        // New supported heads can touch the cushion. Check their actual H2 skull
        // envelope, rather than forcing a visible gap to pass a center threshold.
        let contactHead = false;
        if (pad.headSupport) {
            const side = unit(sub(pose.joints.rightShoulder, pose.joints.leftShoulder));
            const axis = unit(sub(pose.joints.head, pose.joints.neck)), front = unit(cross(side, axis));
            contactHead = [[-.113, .034, .043], [-.076, .059, .069], [-.012, .078, .090], [.084, .077, .087], [.127, .068, .074]].every(([height, rx, rz]) => dot(add(offset, mul(axis, height)), normal) - Math.hypot(rx * dot(side, normal), rz * dot(front, normal)) >= -1e-7);
        }
        const supported = (dot(offset, normal) > .095 || contactHead) && Math.abs(dot(offset, unit(pad.axis))) < pad.length / 2 + .12 && Math.abs(offset.x) < pad.width / 2;
        const occluders = supported ? [...body("head"), ...body("neck")] : [];
        // Machine footplates have an explicit surface frame. A shoe wholly on the
        // supported side, with its sole touching the finite pad, stays above it.
        const yaw = (pose.camera?.yaw ?? 42) * Math.PI / 180, pitch = (pose.camera?.pitch ?? 9) * Math.PI / 180;
        const towardCamera = v(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
        if (pad.armSupport) {
            const along = unit(pad.axis), across = unit(pad.across ?? v(1, 0, 0));
            const planes = [[pad.center, normal],
                [add(pad.center, mul(along, pad.length / 2)), along], [add(pad.center, mul(along, -pad.length / 2)), mul(along, -1)],
                [add(pad.center, mul(across, pad.width / 2)), across], [add(pad.center, mul(across, -pad.width / 2)), mul(across, -1)]];
            for (const side of ["left", "right"])
                for (const segment of ["upper-arm", "forearm"]) {
                    const upper = segment === "upper-arm", j = pose.joints;
                    const start = j[`${side}${upper ? "Shoulder" : "Elbow"}`], end = j[`${side}${upper ? "Elbow" : "Wrist"}`];
                    const stops = upper ? [0, .22, .58, .9, 1] : [0, .12, .4, .76, 1], radii = upper ? [.071, .079, .065, .043, .036] : [.036, .045, .055, .036, .025];
                    if (planes.some(([origin, n]) => dot(n, towardCamera) > 1e-8 && armPlaneMinimum(start, end, stops, radii, origin, n) >= 0))
                        occluders.push(...body(`${side}-${segment}`));
                }
        }
        if (pad.normal && dot(normal, towardCamera) > 0)
            for (const side of ["left", "right"]) {
                const shoe = shoeGeometry(pose, side), distances = shoe.points.map(p => dot(sub(p, pad.center), normal));
                const along = unit(pad.axis), across = pad.across ? unit(pad.across) : v(1, 0, 0);
                const at = sub(shoe.point(.06, 0, .015), pad.center);
                if (Math.min(...distances) >= -1e-7 && Math.min(...distances) < .003 && Math.abs(dot(at, along)) < pad.length / 2 && Math.abs(dot(at, across)) < pad.width / 2)
                    occluders.push(...body(`${side}-shoe`));
            }
        for (const p of parts)
            if (p.id.startsWith(`pad-${pad.id}-`))
                masks.set(p.id, occluders);
    }
    for (const box of pose.boxes ?? []) {
        const occluders = [];
        for (const side of ["left", "right"]) {
            const ankle = pose.joints[`${side}Ankle`];
            if (shoeGeometry(pose, side).points.every(p => p.y >= box.center.y + box.height - 1e-6)) {
                occluders.push(...body(`${side}-shoe`));
                if ([pose.joints[`${side}Hip`], pose.joints[`${side}Knee`], ankle].every(p => p.y >= box.center.y + box.height + .025))
                    occluders.push(...body(`${side}-leg`));
            }
        }
        for (const p of parts)
            if (p.id.startsWith(`box-${box.id}-`))
                masks.set(p.id, occluders);
    }
    const triangulated = new Map();
    for (const p of parts) {
        const occluders = masks.get(p.id);
        if (!occluders) {
            result.push(p);
            continue;
        }
        let pieces = flattenPath(p.d).map(polygon);
        for (const mask of occluders) {
            let clips = triangulated.get(mask);
            if (!clips) {
                clips = triangles(mask);
                triangulated.set(mask, clips);
            }
            for (const clip of clips)
                pieces = pieces.flatMap(piece => subtract(piece, clip));
        }
        result.push({ ...p, d: pieces.map(path).join("") || "M0,0", stroke: "none" });
        result.push({ ...p, id: `${p.id}-outline`, d: clipLineOutside(p.d, occluders), fill: "none", depth: p.depth + .00001 });
    }
    return result;
}
