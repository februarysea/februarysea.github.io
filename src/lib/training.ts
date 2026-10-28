export interface TrainingRep {
  meanVelocityMps?: number | null;
}

export interface TrainingSet {
  id: string;
  exercise: string;
  weightKg: number | null;
  repCount: number;
  work: boolean | null;
  reps: TrainingRep[];
  videoUrl?: string;
  note?: string;
}

export interface TrainingSession {
  id: string;
  date: string;
  sets: TrainingSet[];
}

export interface OneRepMaxPoint { date: string; valueKg: number | null; }

/** Rep-based Epley estimate; unrecorded reps in reserve are not inferred. */
export function estimateOneRepMax(set: TrainingSet): number | null {
  if (set.work !== true || typeof set.weightKg !== "number" || !Number.isFinite(set.weightKg) || set.weightKg <= 0
    || !Number.isInteger(set.repCount) || set.repCount < 1 || set.repCount > 10) return null;
  return set.repCount === 1 ? set.weightKg : set.weightKg * (1 + set.repCount / 30);
}

/** Daily best eligible working set, with lift variants kept separate. */
export function getOneRepMaxTrends(sessions: TrainingSession[], from: string, through: string) {
  const lifts = [
    { exercise: "Squat", label: "Squat", variant: "Back squat", color: "#fda4af" },
    { exercise: "Bench Press", label: "Bench", variant: "Bench press", color: "#ddbedf" },
    { exercise: "Sumo Deadlift", label: "Deadlift", variant: "Sumo", color: "#c5c4e8" },
  ];
  return lifts.map((lift) => {
    const dates = new Map<string, number | null>();
    for (const session of sessions) {
      if (session.date < from || session.date > through) continue;
      for (const set of session.sets) {
        if (set.exercise !== lift.exercise || set.work !== true) continue;
        if (!dates.has(session.date)) dates.set(session.date, null);
        const estimate = estimateOneRepMax(set);
        if (estimate !== null) dates.set(session.date, Math.max(dates.get(session.date) ?? 0, estimate));
      }
    }
    const points: OneRepMaxPoint[] = [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, valueKg]) => ({ date, valueKg }));
    const measured = points.filter((point): point is OneRepMaxPoint & { valueKg: number } => point.valueKg !== null);
    return { ...lift, points, latest: measured.at(-1) ?? null, count: measured.length };
  });
}

/** Shared calendar spacing and zero-based kg scale; gaps stay unfilled. */
export function oneRepMaxGeometry(points: OneRepMaxPoint[], from: string, to: string, ceiling: number, width = 128, height = 60) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const span = Math.max(86400000, Date.parse(`${to}T00:00:00Z`) - start);
  const measured: { date: string; valueKg: number; x: number; y: number }[] = [];
  const segments: string[] = [];
  let segment: string[] = [];
  const flush = () => { if (segment.length > 1) segments.push(segment.join(" ")); segment = []; };
  for (const point of points) {
    if (point.date < from || point.date > to) continue;
    if (point.valueKg === null || !Number.isFinite(point.valueKg) || point.valueKg <= 0) { flush(); continue; }
    const x = 4 + (Date.parse(`${point.date}T00:00:00Z`) - start) / span * (width - 8);
    const y = height - 7 - point.valueKg / Math.max(1, ceiling) * (height - 18);
    measured.push({ ...point, valueKg: point.valueKg, x, y });
    segment.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  flush();
  return { points: measured, segments };
}

export interface TrainingData {
  schemaVersion: number;
  timezone: string;
  updatedAt: string | null;
  coverage: { from: string; to: string };
  sessions: TrainingSession[];
}

export interface TrainingWindow {
  from: string;
  to: string;
  dates: string[];
}

export interface SessionLift {
  exercise: string;
  sets: TrainingSet[];
  setCount: number;
  repCount: number;
  /** One external load per set, in its original order. Unknown loads stay null. */
  weights: (number | null)[];
  loadLabel: string;
  meanVelocityMps: number | null;
  /** Fastest rep's mean velocity, not an instantaneous peak velocity. */
  maxRepMeanVelocityMps: number | null;
  setVelocities: (number | null)[];
  repVelocitiesBySet: (number | null)[][];
}

export function getTrainingDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function formatTrainingDate(date: string, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("en", { timeZone: "UTC", ...options }).format(new Date(`${date}T12:00:00Z`));
}

/** Describes reps per set, preserving the set sequence when counts differ. */
export function formatSetReps(sets: readonly Pick<TrainingSet, "repCount">[]): string {
  const count = sets.length;
  if (!count) return "0 sets / 0 reps";
  const first = sets[0].repCount;
  const uniform = sets.every((set) => set.repCount === first);
  const reps = uniform ? String(first) : sets.map((set) => set.repCount).join("·");
  return `${count} set${count === 1 ? "" : "s"} / ${reps} rep${uniform && first === 1 ? "" : "s"}`;
}

export function getSetVolume(set: TrainingSet): number | null {
  return set.weightKg === null ? null : set.weightKg * set.repCount;
}

export function getRepMeanVelocity(reps: TrainingRep[]): number | null {
  const velocities = reps
    .map((rep) => rep.meanVelocityMps)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  return velocities.length ? velocities.reduce((sum, value) => sum + value, 0) / velocities.length : null;
}

/** Excludes both warm-ups and sets whose work status was not recorded. */
export function getWorkSessions(sessions: TrainingSession[]): TrainingSession[] {
  return sessions.flatMap((session) => {
    const sets = session.sets.filter((set) => set.work === true);
    return sets.length ? [{ ...session, sets }] : [];
  });
}

export function getTrainingWindow(today: string, mode: "rolling30" | "previousMonth" = "rolling30"): TrainingWindow {
  const end = new Date(`${today}T12:00:00Z`);
  if (Number.isNaN(end.getTime()) || end.toISOString().slice(0, 10) !== today) {
    throw new RangeError("Training window requires a valid YYYY-MM-DD date");
  }

  const start = new Date(end);
  if (mode === "previousMonth") {
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - 1);
    end.setUTCDate(0);
  }
  else {
    start.setUTCDate(start.getUTCDate() - 29);
  }

  const dates: string[] = [];
  for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    dates.push(day.toISOString().slice(0, 10));
  }
  return { from: dates[0], to: dates[dates.length - 1], dates };
}

export function getTrainingWindowSummary(sessions: TrainingSession[], window: TrainingWindow) {
  const selected = getWorkSessions(sessions).filter((session) => session.date >= window.from && session.date <= window.to);
  const sets = selected.flatMap((session) => session.sets);
  return {
    trainingDays: new Set(selected.map((session) => session.date)).size,
    sets: sets.length,
    reps: sets.reduce((total, set) => total + set.repCount, 0),
    exerciseCount: new Set(sets.map((set) => set.exercise)).size,
  };
}

/** Combines multiple records on the latest date while preserving set order. */
export function getLatestWorkSession(sessions: TrainingSession[]): TrainingSession | null {
  const workSessions = getWorkSessions(sessions);
  const latestDate = workSessions.reduce((date, session) => session.date > date ? session.date : date, "");
  const latest = workSessions.filter((session) => session.date === latestDate);
  return latest.length ? { ...latest[0], sets: latest.flatMap((session) => session.sets) } : null;
}

function getRepVelocity(rep: TrainingRep | undefined): number | null {
  const value = rep?.meanVelocityMps;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function getLoadLabel(weights: (number | null)[]): string {
  const known = weights.filter((weight): weight is number => weight !== null);
  if (!known.length) return "Load not recorded";
  const min = Math.min(...known);
  const max = Math.max(...known);
  const range = min === max ? `${min} kg` : `${min}–${max} kg`;
  const missing = weights.length - known.length;
  return missing ? `${range} · ${missing} unknown load${missing === 1 ? "" : "s"}` : range;
}

export function getSessionLifts(session: TrainingSession | null): SessionLift[] {
  const grouped = new Map<string, TrainingSet[]>();
  for (const set of session?.sets ?? []) {
    if (set.work !== true) continue;
    const sets = grouped.get(set.exercise) ?? [];
    sets.push(set);
    grouped.set(set.exercise, sets);
  }

  return [...grouped.entries()].map(([exercise, sets]) => {
    const weights = sets.map((set) => typeof set.weightKg === "number" && Number.isFinite(set.weightKg) && set.weightKg >= 0 ? set.weightKg : null);
    const repVelocitiesBySet = sets.map((set) => Array.from(
      { length: Math.max(set.repCount, set.reps.length) },
      (_, index) => getRepVelocity(set.reps[index]),
    ));
    const recordedVelocities = repVelocitiesBySet.flat().filter((value): value is number => value !== null);
    return {
      exercise,
      sets,
      setCount: sets.length,
      repCount: sets.reduce((total, set) => total + set.repCount, 0),
      weights,
      loadLabel: getLoadLabel(weights),
      meanVelocityMps: getRepMeanVelocity(sets.flatMap((set) => set.reps)),
      maxRepMeanVelocityMps: recordedVelocities.length ? Math.max(...recordedVelocities) : null,
      setVelocities: sets.map((set) => getRepMeanVelocity(set.reps)),
      repVelocitiesBySet,
    };
  });
}

export function getTrainingSummary(sessions: TrainingSession[], month: string) {
  const selected = sessions.filter((session) => session.date.startsWith(`${month}-`));
  return {
    trainingDays: new Set(selected.map((session) => session.date)).size,
    sets: selected.reduce((total, session) => total + session.sets.length, 0),
    volumeKg: selected.reduce((total, session) => total + session.sets.reduce((volume, set) => volume + (getSetVolume(set) ?? 0), 0), 0),
    unknownLoadSets: selected.reduce((total, session) => total + session.sets.filter((set) => set.weightKg === null).length, 0),
  };
}

export function getTrainingTrend(sessions: TrainingSession[], exercise: string, weightKg: number | null, metric: "velocity" | "volume") {
  const grouped = new Map<string, TrainingSet[]>();
  for (const session of sessions) {
    const matching = session.sets.filter((set) => set.exercise === exercise && (weightKg === null || set.weightKg === weightKg));
    if (matching.length) grouped.set(session.date, [...(grouped.get(session.date) ?? []), ...matching]);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([date, sets]) => {
      const value = metric === "volume"
        ? (sets.some((set) => set.weightKg === null) ? null : sets.reduce((sum, set) => sum + (getSetVolume(set) ?? 0), 0))
        : getRepMeanVelocity(sets.flatMap((set) => set.reps));
      return value === null ? [] : [{ date, value }];
    });
}
