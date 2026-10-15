import snapshot from "../data/codex-profile.json";

const timezone = "Asia/Shanghai";

export const codexUsage = {
  generatedAt: snapshot.generatedAt,
  timezone,
  source: "Codex Profile",
};
export const compactTokens = (value: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
export const exactTokens = (value: number) => new Intl.NumberFormat("en-US").format(value);
export const usageDate = (value: string) =>
  new Date(`${value}T12:00:00+08:00`).toLocaleDateString("en-US", {
    timeZone: timezone, month: "short", day: "numeric",
  });

type UsageSnapshot = Pick<typeof snapshot, "generatedAt" | "totalTokens" | "daily">;
type UsageDay = { date: string; totalTokens: number | null };

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function summarizeUsage(data: UsageSnapshot = snapshot) {
  const asOf = new Date(data.generatedAt).toLocaleDateString("en-CA", { timeZone: timezone });
  const records = new Map(data.daily.filter((day) => day.date <= asOf).map((day) => [day.date, day.totalTokens]));
  // A fetch timestamp does not establish that the service has reported that day.
  // Explicit zero buckets still count as reported; an absent trailing day does not.
  const dataThrough = [...records.keys()].sort().at(-1) ?? null;
  const dayAt = (date: string): UsageDay => ({
    date,
    totalTokens: dataThrough && date <= dataThrough ? records.get(date) ?? 0 : null,
  });
  const daily = Array.from({ length: 365 }, (_, index) => dayAt(shiftDate(asOf, index - 364)));
  const recent = Array.from({ length: 30 }, (_, index) => dayAt(shiftDate(dataThrough ?? asOf, index - 29)));
  return {
    totalTokens: data.totalTokens,
    periodTokens: dataThrough ? recent.reduce((sum, day) => sum + (day.totalTokens ?? 0), 0) : null,
    activeDays: daily.filter((day) => day.totalTokens !== null && day.totalTokens > 0).length,
    asOf,
    dataThrough,
    daily,
    recent,
  };
}

export function contributionWall(daily: UsageDay[]) {
  // Match Profile's 52 Sunday-aligned weeks and daily intensity calculation.
  const columns = 52;
  const today = daily[daily.length - 1].date;
  const sunday = new Date(`${today}T00:00:00Z`);
  sunday.setUTCDate(sunday.getUTCDate() - sunday.getUTCDay() - (columns - 1) * 7);
  const start = sunday.toISOString().slice(0, 10);
  const records = new Map(daily.map((day) => [day.date, day]));
  const calendar = Array.from({ length: columns * 7 }, (_, index) => {
    const date = new Date(sunday);
    date.setUTCDate(date.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return records.get(key) ?? { date: key, totalTokens: key > today ? null : 0 };
  });
  const positive = calendar.map((day) => day.totalTokens).filter((value): value is number => value !== null && value > 0).sort((a, b) => a - b);
  const position = Math.max(0, (positive.length - 1) * 0.95);
  const lower = Math.floor(position);
  const base = positive[lower] ?? 0;
  const scale = base + ((positive[lower + 1] ?? base) - base) * (position - lower);
  const cells = calendar.map((day, index) => {
    const ratio = scale > 0 && day.totalTokens !== null ? day.totalTokens / scale : 0;
    return {
      ...day, column: Math.floor(index / 7), row: index % 7, pending: day.totalTokens === null,
      level: ratio <= 0 ? 0 : ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1,
    };
  });
  const months: { column: number; label: string }[] = [];
  for (const cell of cells) {
    if (cell.date.endsWith("-01") || cell === cells[0]) {
      if (months.length && cell.column - months[months.length - 1].column < 3) months.pop();
      months.push({ column: cell.column, label: usageDate(cell.date).split(" ")[0] });
    }
  }
  return { columns, cells, months, start, today };
}

export const dayLabel = (day: UsageDay) =>
  `${usageDate(day.date)}, ${day.date.slice(0, 4)}: ${day.totalTokens === null ? "awaiting usage data" : `${exactTokens(day.totalTokens)} recorded tokens`}`;
