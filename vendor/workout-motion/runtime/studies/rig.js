export const v = (x, y, z) => ({ x, y, z });
export const add = (a, b) => v(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => v(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul = (a, scale) => v(a.x * scale, a.y * scale, a.z * scale);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (a) => Math.hypot(a.x, a.y, a.z);
export const unit = (a) => mul(a, 1 / (length(a) || 1));
export const cross = (a, b) => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const blend = (a, b, amount) => add(a, mul(sub(b, a), amount));
export const rep = (phase) => (1 - Math.cos(phase * Math.PI * 2)) / 2;
export const BODY = Object.freeze({ upperArm: 0.305, forearm: 0.285, thigh: 0.445, shin: 0.425, torso: 0.49, shoulderHalf: 0.20, hipHalf: 0.10 });
/** A fixed-length two-bone chain, bent toward a world-space direction. */
export function bendJoint(start, end, first, second, pole) {
    const delta = sub(end, start);
    const distance = length(delta);
    if (distance > first + second + 1e-6 || distance < Math.abs(first - second) - 1e-6) {
        throw new RangeError(`Unreachable joint target: ${distance.toFixed(4)} for ${first} + ${second}`);
    }
    const direction = unit(delta);
    const along = (first * first - second * second + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, first * first - along * along));
    const bend = unit(sub(pole, mul(direction, dot(pole, direction))));
    return add(add(start, mul(direction, along)), mul(bend, height));
}
