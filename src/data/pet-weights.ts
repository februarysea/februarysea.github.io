import type { PetWeightData } from "../lib/pet-weight";
import p7 from "./p7-summary.json";

// P7 supplies filtered daily medians and the latest individual measurement.
// Personal summaries remain a fallback if a cat has no accepted measurements.
export const petWeights = {
  tangyuan: {
    reportedOn: "2026-10-25",
    summary: { kind: "stable", current: 6.3 },
    daily: p7.cats.tangyuan.daily,
    latestMeasurement: p7.cats.tangyuan.latestMeasurement,
    aggregation: "daily-median",
    source: "P7",
  },
  doubao: {
    reportedOn: "2026-10-25",
    summary: { kind: "range", min: 4.7, max: 5.0 },
    daily: p7.cats.doubao.daily,
    latestMeasurement: p7.cats.doubao.latestMeasurement,
    aggregation: "daily-median",
    source: "P7",
  },
} satisfies Record<"tangyuan" | "doubao", PetWeightData>;
