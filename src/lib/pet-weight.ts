export interface DailyWeight {
  /** Measurement date, YYYY-MM-DD. One reading per date. */
  date: string;
  kg: number;
  samples?: number;
}

export interface PetWeightData {
  reportedOn: string;
  summary:
    | { kind: "stable"; current: number }
    | { kind: "range"; min: number; max: number };
  daily: readonly DailyWeight[];
  latestMeasurement?: DailyWeight | null;
  aggregation?: "daily-median";
  source?: "P7";
}

export function formatPetWeight(kg: number) {
  return kg.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

/** Last 30 calendar days ending at the latest recorded measurement. */
export function getDailyWeightChart(daily: readonly DailyWeight[]) {
  if (daily.length === 0) return null;
  const seen = new Set<string>();
  const records = daily.map((reading) => {
    const timestamp = Date.parse(`${reading.date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reading.date) || !Number.isFinite(timestamp)
      || new Date(timestamp).toISOString().slice(0, 10) !== reading.date) {
      throw new Error(`Invalid pet weight date: ${reading.date}`);
    }
    if (!Number.isFinite(reading.kg) || reading.kg <= 0) {
      throw new Error(`Pet weight must be a positive number: ${reading.date}`);
    }
    if (seen.has(reading.date)) throw new Error(`Duplicate pet weight date: ${reading.date}`);
    seen.add(reading.date);
    return { ...reading, timestamp };
  }).sort((a, b) => a.timestamp - b.timestamp);

  const latest = records[records.length - 1];
  const windowMs = 29 * 86400000;
  const start = latest.timestamp - windowMs;
  const visible = records.filter((reading) => reading.timestamp >= start);
  const firstTimestamp = visible[0].timestamp;
  const recordedSpanMs = latest.timestamp - firstTimestamp;
  const low = Math.min(...visible.map((reading) => reading.kg));
  const high = Math.max(...visible.map((reading) => reading.kg));
  const center = (low + high) / 2;
  const span = Math.max(0.6, high - low + 0.3);
  const points = visible.map((reading) => ({
    date: reading.date,
    kg: reading.kg,
    samples: reading.samples,
    x: recordedSpanMs ? 4 + (reading.timestamp - firstTimestamp) / recordedSpanMs * 152 : 156,
    y: 25 - (reading.kg - center) / span * 38,
  }));
  const curve = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const fill = points.length > 1
    ? `${curve} L${points[points.length - 1].x},48 L${points[0].x},48 Z`
    : null;
  return { latest, points, curve, fill };
}
