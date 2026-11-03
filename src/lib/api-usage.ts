import snapshot from "../data/openai-usage.json";

export type ModelUsage = {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  requests: number;
};
export type ApiUsageSnapshot = {
  generatedAt: string | null;
  startDate: string | null;
  throughDate: string | null;
  daily: { date: string; models: ModelUsage[] }[];
};

export function summarizeApiUsage(data: ApiUsageSnapshot = snapshot) {
  if (!data.generatedAt || !data.throughDate) {
    return { connected: false, totalTokens: null, recentTokens: null, requests: null,
      models: [] as (ModelUsage & { totalTokens: number })[],
      startDate: null, throughDate: null, generatedAt: null };
  }
  const recentStart = new Date(`${data.throughDate}T00:00:00Z`);
  recentStart.setUTCDate(recentStart.getUTCDate() - 6);
  const recentDate = recentStart.toISOString().slice(0, 10);
  const grouped = new Map<string, ModelUsage>();
  let recentTokens = 0;
  for (const day of data.daily) {
    for (const row of day.models) {
      const model = grouped.get(row.model) ?? {
        model: row.model, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, requests: 0,
      };
      model.inputTokens += row.inputTokens;
      model.cachedInputTokens += row.cachedInputTokens;
      model.outputTokens += row.outputTokens;
      model.requests += row.requests;
      grouped.set(row.model, model);
      if (day.date >= recentDate && day.date <= data.throughDate) {
        recentTokens += row.inputTokens + row.outputTokens;
      }
    }
  }
  const models = [...grouped.values()]
    .map((model) => ({ ...model, totalTokens: model.inputTokens + model.outputTokens }))
    .sort((a, b) => b.totalTokens - a.totalTokens || a.model.localeCompare(b.model));
  return { connected: true, totalTokens: models.reduce((sum, model) => sum + model.totalTokens, 0),
    recentTokens, requests: models.reduce((sum, model) => sum + model.requests, 0), models,
    startDate: data.startDate, throughDate: data.throughDate, generatedAt: data.generatedAt };
}

export const apiUsage = summarizeApiUsage();

// Cost records come from the Costs API, not a token-rate multiplication.
type CostSnapshot = { generatedAt: string; startDate: string; throughDate: string;
  currency: string; daily: { date: string; items: { lineItem: string; usd: string }[] }[] };
const costs = (snapshot as ApiUsageSnapshot & { costs?: CostSnapshot }).costs;
const costItems = new Map<string, number>();
for (const day of costs?.daily ?? []) {
  for (const item of day.items) costItems.set(item.lineItem, (costItems.get(item.lineItem) ?? 0) + Number(item.usd));
}
export const apiCosts = {
  available: Boolean(costs), throughDate: costs?.throughDate ?? null,
  generatedAt: costs?.generatedAt ?? null,
  totalUsd: costs ? [...costItems.values()].reduce((sum, n) => sum + n, 0) : null,
  items: [...costItems].map(([lineItem, usd]) => ({ lineItem, usd })).sort((a,b) => b.usd-a.usd),
};
export const usd = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(value);
