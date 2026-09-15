// MASTER #6 — Separability analysis tests.
//
// These tests run against the REAL catalog data and the REAL shipped FPS model
// rather than against hand-picked numbers, because the whole point of the
// module is that the shipped model's own declared range invalidates claims the
// shipped comparison surface invites.

import { describe, expect, it } from "vitest";

import { estimateFps } from "../../../../src/lib/fps.ts";
import cpus from "../../../../src/data/cpus.json" with { type: "json" };
import games from "../../../../src/data/games.json" with { type: "json" };
import gpus from "../../../../src/data/gpus.json" with { type: "json" };
import {
  analyzeSeparability,
  FPS_ESTIMATE_DISCLOSURE,
  permittedWording,
  surveySeparability,
  type ComparisonPoint,
  type EstimateWithRange,
} from "./separability.ts";

interface CatalogGpu { id: string; name: string; price_usd: number; gpu_multiplier: number }
interface CatalogCpu { id: string; name: string; price_usd: number; cpu_multiplier: number }
interface CatalogGame { id: string; name: string; gpu_bound: number; base_fps: Record<string, Record<string, number>> }

function gpu(id: string): CatalogGpu {
  const found = (gpus as CatalogGpu[]).find((entry) => entry.id === id);
  if (!found) throw new Error(`fixture drift: gpu ${id} is no longer in the catalog`);
  return found;
}

function cpu(id: string): CatalogCpu {
  const found = (cpus as CatalogCpu[]).find((entry) => entry.id === id);
  if (!found) throw new Error(`fixture drift: cpu ${id} is no longer in the catalog`);
  return found;
}

// The section-1 audience problem, taken from real catalog rows.
const BUILD_A = { gpu: gpu("rtx5060ti"), cpu: cpu("i3-13100f") };
const BUILD_B = { gpu: gpu("rtx4060ti"), cpu: cpu("r5-9600x") };

function estimateAt(build: { gpu: CatalogGpu; cpu: CatalogCpu }, game: CatalogGame): EstimateWithRange {
  return estimateFps(build.gpu.gpu_multiplier, build.cpu.cpu_multiplier, game.base_fps["1440p"].high, game.gpu_bound);
}

describe("the section-1 audience problem is real", () => {
  it("still costs exactly the same at editorial catalog prices", () => {
    const a = BUILD_A.gpu.price_usd + BUILD_A.cpu.price_usd;
    const b = BUILD_B.gpu.price_usd + BUILD_B.cpu.price_usd;
    expect(a).toBe(b);
  });
});

describe("separability over the real catalog", () => {
  const points: ComparisonPoint<CatalogGame>[] = (games as CatalogGame[]).map((game) => ({
    context: game,
    a: estimateAt(BUILD_A, game),
    b: estimateAt(BUILD_B, game),
  }));

  it("finds a genuine point-estimate crossover", () => {
    // This is what makes the comparison look decidable on the product surface.
    const survey = surveySeparability(points);
    expect(survey.pointLeaderFlips).toBe(true);
  });

  it("refuses to name a winner anywhere, because the model's own range never separates them", () => {
    const survey = surveySeparability(points);
    expect(survey.noPointSeparates).toBe(true);
    expect(survey.separableCount).toBe(0);
    expect(survey.undeterminedCount).toBe(0);
    expect(survey.inseparableCount).toBe(points.length);
    for (const entry of survey.points) {
      expect(entry.result.claimableLeader).toBeNull();
    }
  });

  it("keeps the point gap visible even where no claim is allowed", () => {
    // Inseparable is not "equal". Suppressing the gap would be its own
    // distortion; the gap is reported and simply may not become a claim.
    const widest = surveySeparability(points).points
      .map((entry) => entry.result)
      .reduce((best, result) => (Math.abs(result.pointGap ?? 0) > Math.abs(best.pointGap ?? 0) ? result : best));
    expect(Math.abs(widest.pointGap ?? 0)).toBeGreaterThan(10);
    expect(widest.verdict).toBe("inseparable");
    expect(widest.pointLeader).not.toBeNull();
    expect(widest.claimableLeader).toBeNull();
  });
});

describe("the overlap test itself", () => {
  it("separates genuinely disjoint ranges and names the leader", () => {
    const result = analyzeSeparability({ estimated: 100, min: 92, max: 108 }, { estimated: 60, min: 55, max: 65 });
    expect(result.verdict).toBe("separable");
    expect(result.claimableLeader).toBe("a");
    expect(result.pointGap).toBe(40);
    expect(result.overlapFraction).toBe(0);
  });

  it("treats a single-frame boundary contact as overlap, not separation", () => {
    // A model that rounds an 8% band cannot resolve a one-frame touch.
    const result = analyzeSeparability({ estimated: 100, min: 92, max: 108 }, { estimated: 120, min: 108, max: 130 });
    expect(result.verdict).toBe("inseparable");
    expect(result.claimableLeader).toBeNull();
  });

  it("reports undetermined rather than assuming a zero-width range", () => {
    for (const broken of [
      { estimated: 100, min: 110, max: 120 },
      { estimated: 100, min: 90, max: 80 },
      { estimated: Number.NaN, min: 1, max: 2 },
    ]) {
      const result = analyzeSeparability(broken, { estimated: 60, min: 55, max: 65 });
      expect(result.verdict).toBe("undetermined");
      expect(result.claimableLeader).toBeNull();
      expect(result.pointGap).toBeNull();
      expect(result.reason).toMatch(/not a zero range/);
    }
  });

  it("reports no leader when the estimates are identical", () => {
    const result = analyzeSeparability({ estimated: 83, min: 76, max: 90 }, { estimated: 83, min: 76, max: 90 });
    expect(result.pointLeader).toBeNull();
    expect(result.claimableLeader).toBeNull();
    expect(result.overlapFraction).toBe(1);
  });

  it("is symmetric in verdict and antisymmetric in leader", () => {
    const a = { estimated: 258, min: 237, max: 279 };
    const b = { estimated: 276, min: 254, max: 298 };
    const forward = analyzeSeparability(a, b);
    const reverse = analyzeSeparability(b, a);
    expect(reverse.verdict).toBe(forward.verdict);
    expect(reverse.pointGap).toBe(-(forward.pointGap ?? 0));
    expect(reverse.pointLeader).toBe("a");
    expect(forward.pointLeader).toBe("b");
  });

  it("is deterministic", () => {
    const a = { estimated: 69, min: 63, max: 75 };
    const b = { estimated: 66, min: 61, max: 71 };
    expect(analyzeSeparability(a, b)).toEqual(analyzeSeparability(a, b));
  });

  it("survey of nothing does not claim a universal finding", () => {
    const survey = surveySeparability([]);
    expect(survey.noPointSeparates).toBe(false);
    expect(survey.pointLeaderFlips).toBe(false);
  });
});

describe("permitted wording never outruns the verdict", () => {
  it("offers no directional sentence when the ranges overlap", () => {
    const result = analyzeSeparability({ estimated: 258, min: 237, max: 279 }, { estimated: 276, min: 254, max: 298 });
    const wording = permittedWording(result, "Build A", "Build B");
    expect(wording.directional).toBeNull();
    expect(wording.safest).toMatch(/does not separate/);
    expect(wording.requiredDisclosure).toBe(FPS_ESTIMATE_DISCLOSURE);
  });

  /**
   * A denial is not an assertion. "not a measured difference" is exactly the
   * wording we want, so a naive substring scan for "measured" would punish the
   * honest phrasing. Strip explicit negations before scanning for a claim.
   */
  function affirmativeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/\bnot (?:a |an )?(?:measured|benchmark|benchmarked|proven|tested)\b[^.,;]*/g, " ")
      .replace(/\bnot measured benchmarks\b/g, " ");
  }

  it("never describes the model band as a measurement or a statistical interval", () => {
    const results = [
      analyzeSeparability({ estimated: 100, min: 92, max: 108 }, { estimated: 60, min: 55, max: 65 }),
      analyzeSeparability({ estimated: 258, min: 237, max: 279 }, { estimated: 276, min: 254, max: 298 }),
      analyzeSeparability({ estimated: Number.NaN, min: 1, max: 2 }, { estimated: 60, min: 55, max: 65 }),
    ];
    for (const result of results) {
      const wording = permittedWording(result, "Build A", "Build B");
      const text = affirmativeText(`${result.reason} ${wording.safest} ${wording.directional ?? ""}`);
      for (const forbidden of [
        "benchmark",
        "measured",
        "we tested",
        "confidence interval",
        "statistically",
        "margin of error",
        "proven",
      ]) {
        expect(text).not.toContain(forbidden);
      }
    }
  });

  it("marks even a separable lead as a model estimate rather than a fact about hardware", () => {
    const result = analyzeSeparability({ estimated: 100, min: 92, max: 108 }, { estimated: 60, min: 55, max: 65 });
    const wording = permittedWording(result, "Build A", "Build B");
    expect(wording.directional).toMatch(/SpecSmith's model estimates/);
    expect(result.reason).toMatch(/not a measured difference/);
  });
});
