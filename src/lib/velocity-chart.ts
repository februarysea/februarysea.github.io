/** Straight segments through measured values only; missing reps leave a gap. */
export function velocityGeometry(values: (number | null)[], width: number, height: number, ceiling: number, inset = 3) {
  const points = values.flatMap((value, index) => value === null || !Number.isFinite(value) || value < 0 ? [] : [{
    index,
    value,
    x: values.length <= 1 ? width / 2 : inset + index * (width - 2 * inset) / (values.length - 1),
    y: height - inset - Math.min(value / ceiling, 1) * (height - 2 * inset),
  }]);
  const segments: string[] = [];
  let previous = -2;
  for (const point of points) {
    if (point.index !== previous + 1) segments.push("");
    segments[segments.length - 1] += `${point.x.toFixed(2)},${point.y.toFixed(2)} `;
    previous = point.index;
  }
  return { points, segments };
}

export function velocityCeiling(values: (number | null)[]): number {
  const measured = values.filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
  return Math.max(0.5, Math.ceil(Math.max(0, ...measured) * 1.08 * 4) / 4);
}
