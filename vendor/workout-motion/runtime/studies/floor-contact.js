import { add, blend, BODY, mul, v } from "./rig.js";
/** Lowest point of the H2 rounded leg outline in its sagittal YZ plane. */
export function sagittalLegFloor(hip, knee, ankle) {
    const incoming = blend(hip, knee, .85), outgoing = blend(knee, ankle, .18);
    const rounded = (t) => add(add(mul(incoming, (1 - t) ** 2), mul(knee, 2 * (1 - t) * t)), mul(outgoing, t * t));
    const points = [hip, blend(hip, knee, .22), blend(hip, knee, .58), rounded(.15), rounded(.5), rounded(.85), blend(knee, ankle, .4), blend(knee, ankle, .76), ankle];
    const radii = [.09, .098, .088, .061, .052, .056, .077, .049, .029];
    const left = [], right = [];
    points.forEach((point, i) => {
        const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
        const offset = radii[i] * (after.z - before.z) / Math.hypot(after.y - before.y, after.z - before.z);
        left.push(point.y + offset);
        right.push(point.y - offset);
    });
    const outline = [...left, ...right.reverse()], n = outline.length;
    let floor = Infinity;
    for (let i = 0; i < n; i++) {
        const a = outline[(i + n - 1) % n], b = outline[i], c = outline[(i + 1) % n], d = outline[(i + 2) % n];
        const c1 = b + (c - a) * .88 / 6, c2 = c - (d - b) * .88 / 6;
        const A = -b + 3 * c1 - 3 * c2 + c, B = 2 * (b - 2 * c1 + c2), C = c1 - b;
        const roots = [];
        if (Math.abs(A) < 1e-12) {
            if (Math.abs(B) > 1e-12)
                roots.push(-C / B);
        }
        else {
            const discriminant = B * B - 4 * A * C;
            if (discriminant >= 0)
                roots.push((-B + Math.sqrt(discriminant)) / (2 * A), (-B - Math.sqrt(discriminant)) / (2 * A));
        }
        floor = Math.min(floor, b, c);
        for (const t of roots)
            if (t > 0 && t < 1)
                floor = Math.min(floor, (1 - t) ** 3 * b + 3 * (1 - t) ** 2 * t * c1 + 3 * (1 - t) * t * t * c2 + t ** 3 * c);
    }
    return floor;
}
/** Keep the shoulder target fixed while the rounded knee rolls on the floor. */
export function kneePushUpHeight(shoulderY) {
    let low = .02, high = .08;
    for (let i = 0; i < 20; i++) {
        const height = (low + high) / 2, y = (shoulderY - height) / (BODY.thigh + BODY.torso), up = v(0, y, Math.sqrt(1 - y * y));
        const knee = v(0, height, 0), hip = add(knee, mul(up, BODY.thigh)), ankle = add(knee, v(0, .21, -Math.sqrt(BODY.shin ** 2 - .21 ** 2)));
        if (sagittalLegFloor(hip, knee, ankle) < .0001)
            low = height;
        else
            high = height;
    }
    return (low + high) / 2;
}
