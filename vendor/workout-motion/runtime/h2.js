import { createStudyPlayer, renderStudy, reviewStudies } from "./review.js";
const catalog = new Map(reviewStudies.map((study) => {
    const { id, label, chinese, subtitle, durationMs, keyframes } = study;
    const metadata = Object.freeze({
        id, label, chinese, subtitle, durationMs,
        ...(keyframes ? { keyframes: Object.freeze(keyframes.map((keyframe) => Object.freeze({ ...keyframe }))) } : {}),
    });
    return [id, metadata];
}));
export const exerciseIds = Object.freeze([...catalog.keys()]);
/** Immutable metadata; the internal joint rig and pose functions remain private. */
export function getExercise(id) {
    return catalog.get(id);
}
function requireExercise(id) {
    const exercise = getExercise(id);
    if (!exercise)
        throw new RangeError(`Unknown exercise: ${id}`);
    return exercise;
}
/** Render one H2 pose without accessing the DOM; size <= 80 uses thumbnail detail. */
export function renderSvg(id, options = {}) {
    const exercise = requireExercise(id);
    return renderStudy(id, { ...options, title: options.title ?? exercise.chinese });
}
/** Mount the full-detail H2 player; size its host with CSS and destroy on unmount. */
export function createPlayer(host, id, options = {}) {
    const exercise = requireExercise(id);
    return createStudyPlayer(host, id, { ...options, title: options.title ?? exercise.chinese });
}
