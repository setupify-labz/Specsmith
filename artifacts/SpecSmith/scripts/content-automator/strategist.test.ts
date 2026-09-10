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

const radicalFormats = new Set(["experiment", "visual-story", "game", "simulation"]);

describe("buildStrategyBatch", () => {
  it("creates a ranked batch from trusted local data", () => {
    const result = buildStrategyBatch(gpus, cpus, new Date("2026-08-21T12:00:00Z"));
    expect(result.candidateCount).toBeGreaterThanOrEqual(15);
    expect(result.topFour).toHaveLength(4);
    expect(new Set(result.topFour.map((idea) => idea.id)).size).toBe(4);
    expect(result.candidates.every((idea) => idea.scores.total >= 1 && idea.scores.total <= 10)).toBe(true);
    expect(result.candidates.some((idea) => idea.subjectIds.includes("old"))).toBe(false);
  });

  it("makes SpecSmith essential to every concept", () => {
    const result = buildStrategyBatch(gpus, cpus, new Date("2026-08-21T12:00:00Z"));
    for (const idea of result.candidates) {
      expect(idea.productConnection.route.startsWith("/")).toBe(true);
      expect(idea.productConnection.userProblem.length).toBeGreaterThan(15);
      expect(idea.productConnection.whySpecSmith.length).toBeGreaterThan(20);
      expect(idea.productConnection.continuationAction.length).toBeGreaterThan(20);
      expect(idea.scores.productFit).toBeGreaterThanOrEqual(9);
      expect(idea.scores.siteContinuation).toBeGreaterThanOrEqual(9);
      expect(idea.creativeDNA.originalityConstraint).toContain("SpecSmith");
    }
  });

  it("covers multiple real SpecSmith product surfaces including Build Crate", () => {
    const result = buildStrategyBatch(gpus, cpus, new Date("2026-08-21T12:00:00Z"));
    const features = new Set(result.candidates.map((idea) => idea.productConnection.feature));
    expect(features.has("builder")).toBe(true);
    expect(features.has("compare")).toBe(true);
    expect(features.has("build-crate")).toBe(true);
    expect(features.has("upgrade")).toBe(true);
    expect(features.has("gallery")).toBe(true);
    expect(features.has("build-guides")).toBe(true);
    expect(features.has("parts-catalog")).toBe(true);
    expect(features.has("price-guesser")).toBe(true);
  });

  it("keeps creative formats while tying them to product actions", () => {
    const result = buildStrategyBatch(gpus, cpus, new Date("2026-08-21T12:00:00Z"));
    const formats = new Set(result.candidates.map((idea) => idea.format));
    expect(formats.has("visual-story")).toBe(true);
    expect(formats.has("game")).toBe(true);
    expect(formats.has("simulation")).toBe(true);
    expect(formats.has("experiment")).toBe(true);
    expect(result.topFour.filter((idea) => radicalFormats.has(idea.format)).length).toBeGreaterThanOrEqual(2);
  });

  it("makes the top batch diverse by SpecSmith feature", () => {
    const result = buildStrategyBatch(gpus, cpus, new Date("2026-08-21T12:00:00Z"));
    expect(new Set(result.topFour.map((idea) => idea.productConnection.feature)).size).toBeGreaterThanOrEqual(3);
  });

  it("is deterministic for the same data and date", () => {
    const date = new Date("2026-08-21T12:00:00Z");
    expect(buildStrategyBatch(gpus, cpus, date)).toEqual(buildStrategyBatch(gpus, cpus, date));
  });
});
