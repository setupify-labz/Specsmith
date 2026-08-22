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

  it("forces creative direction into every candidate instead of producing generic script prompts", () => {
    const result = buildStrategyBatch(gpus, cpus, new Date("2026-08-21T12:00:00Z"));

    for (const idea of result.candidates) {
      expect(idea.creativeDNA.conceptName.length).toBeGreaterThan(10);
      expect(idea.creativeDNA.visualWorld.length).toBeGreaterThan(20);
      expect(idea.creativeDNA.retentionBeats).toHaveLength(5);
      expect(idea.creativeDNA.antiSlopRules.length).toBeGreaterThanOrEqual(6);
      expect(idea.creativeDNA.originalityConstraint).toContain("stock RGB B-roll");
      expect(idea.scores.originality).toBeGreaterThanOrEqual(1);
      expect(idea.scores.retentionPotential).toBeGreaterThanOrEqual(1);
    }
  });

  it("includes wildcard formats that break out of ordinary comparison/listicle grammar", () => {
    const result = buildStrategyBatch(gpus, cpus, new Date("2026-08-21T12:00:00Z"));
    const formats = new Set(result.candidates.map((idea) => idea.format));

    expect(formats.has("visual-story")).toBe(true);
    expect(formats.has("game")).toBe(true);
    expect(formats.has("simulation")).toBe(true);
    expect(formats.has("experiment")).toBe(true);
  });

  it("tries to make the daily four visually distinct, not template swaps", () => {
    const result = buildStrategyBatch(gpus, cpus, new Date("2026-08-21T12:00:00Z"));
    const worlds = result.topFour.map((idea) => idea.creativeDNA.visualWorld.split(" — ")[0]);

    expect(new Set(worlds).size).toBeGreaterThanOrEqual(3);
  });

  it("is deterministic for the same data and date", () => {
    const date = new Date("2026-08-21T12:00:00Z");
    const first = buildStrategyBatch(gpus, cpus, date);
    const second = buildStrategyBatch(gpus, cpus, date);
    expect(first).toEqual(second);
  });
});
