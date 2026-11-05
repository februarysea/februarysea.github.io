import codexSnapshot from "../data/codex-profile.json";
import apiSnapshot from "../data/openai-usage.json";
import priceSnapshot from "../data/token-prices.json";
import creditValuation from "../data/codex-credit-valuation.json";

type CodexSnapshot = {
  totalTokens: number;
  archivedThrough?: string;
  daily: { date: string; totalTokens: number }[];
  creditUsage?: {
    source: string; scope: string; startDate: string;
    daily: { date: string; totalTokens: number; credits: string }[];
  };
};
type ApiSnapshot = { daily: { date: string; models: {
  model: string; inputTokens: number; cachedInputTokens: number; outputTokens: number;
}[] }[] };
type PriceTable = Record<string, { input: number; cachedInput: number; output: number }>;

// Analytics supplies estimated rates, not verified subsets of Profile.
// Historical gaps use the same credit samples, never a separate local-log price.
export function estimateCodexCost(data: CodexSnapshot, usdPerCredit = creditValuation.usdPerCredit) {
  if (!Number.isFinite(usdPerCredit) || usdPerCredit <= 0) throw new Error("Invalid credit reference value.");
  const datedTokens = data.daily.reduce((sum, day) => sum + day.totalTokens, 0);
  if (datedTokens > data.totalTokens) throw new Error("Codex daily tokens exceed the lifetime total.");
  const activeDates = new Set(data.daily.filter(day => day.totalTokens > 0).map(day => day.date));
  const creditHistory = data.creditUsage;
  const creditDays = new Map(creditHistory?.source === "codex-analytics-credits"
    && creditHistory.scope === "primary-codex-surfaces" && data.archivedThrough
    && creditHistory.startDate > data.archivedThrough
    ? creditHistory.daily.filter(day => day.date >= creditHistory.startDate && activeDates.has(day.date)
      && day.totalTokens > 0 && Number.isFinite(Number(day.credits)) && Number(day.credits) > 0)
      .map(day => [day.date, day]) : []);
  const sampleTokens = [...creditDays.values()].reduce((sum, day) => sum + day.totalTokens, 0);
  const sampleCredits = [...creditDays.values()].reduce((sum, day) => sum + Number(day.credits), 0);
  // Token-weighted, not a simple mean of daily rates: a small day must not
  // disproportionately change the valuation of the whole historical archive.
  const averageRate = sampleTokens ? sampleCredits * usdPerCredit / sampleTokens : null;
  const result = { usd: null as number | null, tokens: data.totalTokens,
    creditRateTokens: 0, creditRateDays: 0, adjustedCreditDays: 0, averageRateTokens: 0,
    unpricedTokens: 0, creditUsd: 0, averageUsd: 0, usdPerCredit,
    sampleTokens, sampleCredits, averageUsdPerMillionTokens: averageRate === null ? null : averageRate * 1e6 };
  if (averageRate === null) {
    result.unpricedTokens = data.totalTokens;
    result.usd = data.totalTokens ? null : 0;
    return result;
  }
  for (const day of data.daily) {
    const creditDay = creditDays.get(day.date);
    if (creditDay) {
      // The user accepts community valuation and daily rate extrapolation.
      // Analytics counts differ from Profile; this is explicitly an estimate.
      result.creditUsd += day.totalTokens / creditDay.totalTokens * Number(creditDay.credits) * usdPerCredit;
      result.creditRateTokens += day.totalTokens;
      result.creditRateDays += 1;
      if (day.totalTokens !== creditDay.totalTokens) result.adjustedCreditDays += 1;
    }
  }
  // Includes the two-account archive, missing/zero-credit days, and any undated
  // lifetime tokens. These credits are inferred, not recovered historical bills.
  result.averageRateTokens = data.totalTokens - result.creditRateTokens;
  result.averageUsd = result.averageRateTokens * averageRate;
  result.usd = result.creditUsd + result.averageUsd;
  return result;
}

export function estimateApiCost(data: ApiSnapshot, prices: PriceTable) {
  let usd = 0, tokens = 0;
  const missingModels = new Set<string>();
  for (const day of data.daily) {
    for (const row of day.models) {
      const count = row.inputTokens + row.outputTokens;
      tokens += count;
      if (!count) continue;
      const model = row.model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
      const price = prices[row.model] ?? prices[model];
      if (!price) { missingModels.add(row.model); continue; }
      // The API includes cached tokens inside inputTokens. Reasoning is inside outputTokens.
      usd += ((row.inputTokens - row.cachedInputTokens) * price.input
        + row.cachedInputTokens * price.cachedInput + row.outputTokens * price.output) / 1e6;
    }
  }
  return { usd: missingModels.size ? null : usd, tokens, missingModels: [...missingModels].sort() };
}

export function estimateUsageCost(codex: CodexSnapshot = codexSnapshot, api: ApiSnapshot = apiSnapshot,
  prices: PriceTable = priceSnapshot.models) {
  const codexCost = estimateCodexCost(codex);
  const apiCost = estimateApiCost(api, prices);
  return { codex: codexCost, api: apiCost, tokens: codexCost.tokens + apiCost.tokens,
    usd: codexCost.usd === null || apiCost.usd === null ? null : codexCost.usd + apiCost.usd };
}

export const usageCost = estimateUsageCost();
