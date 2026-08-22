import { describe, expect, it } from "vitest";
import { buildStrategyBatch } from "./strategist.ts";
import type { HardwareItem } from "./types.ts";

const gpus: HardwareItem[] = [
  { id: "g1", name: "GPU One", brand: "NVIDIA", price_usd: 1200, benchmark_score: 300, release_year: 2026, tier: 9 },
  { id: "g2", name: "GPU Two", brand: "AMD", price_usd: 700, benchmark_score: 260, release_year: 2026, tier: 8 },
  { id: "g3", name: "GPU Three", brand: "AMD", price_usd: 400, benchmark_score: 220, release_year: 2025, tier: 7 },
  { id: "g4", name: "GPU Four", brand: "NVIDIA", price_usd: 250, benchmark_score: 170, release_year: 2024, tier: 5 },
  { id: "old", name: "Old GPU", brand: "AMD", price_usd: 100, benchmark_score: 60, release_year: 2018, tier: 2 },
];

const cpus: HardwareItem[] = [
  { id: "c1", name: "CPU One", brand: "AMD", price_usd: 280, benchmark_score: 260, release_year: 2026, tier: 8 },
  { id: "c2", name: "CPU Two", brand: "Intel", price_usd: 180, benchmark_score: 210, release_year: 2025, tier: 6 },
  { id: "c3", name: "CPU Three", brand: "AMD", price_usd: 120, benchmark_score: 160, release_year: 2024, tier: 4 },
];

describe("buildStrategyBatch", () => {
  it("creates a ranked, diverse top four from trusted local data", () => {
    const result = buildStrategyBatch(gpus, cpus, new Date("2026-08-21T12:00:00Z"));

    expect(result.candidateCount).toBeGreaterThanOrEqual(10);
    expect(result.topFour).toHaveLength(4);
    expect(new Set(result.topFour.map((idea) => idea.id)).size).toBe(4);
    expect(new Set(result.topFour.map((idea) => idea.format)).size).toBeGreaterThanOrEqual(3);
    expect(result.candidates.every((idea) => idea.scores.total >= 1 && idea.scores.total <= 10)).toBe(true);
    expect(result.candidates.some((idea) => idea.subjectIds.includes("old"))).toBe(false);
  });

  it("is deterministic for the same data and date", () => {
    const date = new Date("2026-08-21T12:00:00Z");
    const first = buildStrategyBatch(gpus, cpus, date);
    const second = buildStrategyBatch(gpus, cpus, date);
    expect(first).toEqual(second);
  });
});
