import { describe, expect, it } from "vitest";
import { buildAutomationBatch, hookFamilyOfIdea } from "./logicalAutomator.ts";
import {
  MAX_PRODUCTION_NARRATION_CHARACTERS,
  MIN_PRODUCTION_NARRATION_CHARACTERS,
  normalizeNarrationText,
} from "./narrationPolicy.ts";
import type { HardwareItem, VideoPerformanceRecord } from "./types.ts";

const gpus: HardwareItem[] = [
  { id: "g1", name: "GPU One", brand: "NVIDIA", price_usd: 1600, benchmark_score: 330, release_year: 2026, tier: 10 },
  { id: "g2", name: "GPU Two", brand: "AMD", price_usd: 1000, benchmark_score: 300, release_year: 2026, tier: 9 },
  { id: "g3", name: "GPU Three", brand: "NVIDIA", price_usd: 700, benchmark_score: 270, release_year: 2025, tier: 8 },
  { id: "g4", name: "GPU Four", brand: "AMD", price_usd: 500, benchmark_score: 235, release_year: 2025, tier: 7 },
  { id: "g5", name: "GPU Five", brand: "NVIDIA", price_usd: 350, benchmark_score: 205, release_year: 2024, tier: 6 },
  { id: "g6", name: "GPU Six", brand: "AMD", price_usd: 250, benchmark_score: 170, release_year: 2024, tier: 5 },
];

const cpus: HardwareItem[] = [
  { id: "c1", name: "CPU One", brand: "AMD", price_usd: 520, benchmark_score: 300, release_year: 2026, tier: 10 },
  { id: "c2", name: "CPU Two", brand: "Intel", price_usd: 330, benchmark_score: 270, release_year: 2025, tier: 8 },
  { id: "c3", name: "CPU Three", brand: "AMD", price_usd: 210, benchmark_score: 225, release_year: 2025, tier: 6 },
  { id: "c4", name: "CPU Four", brand: "Intel", price_usd: 140, benchmark_score: 180, release_year: 2024, tier: 5 },
];

const radical = new Set(["experiment", "visual-story", "game", "simulation"]);

function historyRecord(index: number, format: VideoPerformanceRecord["format"]): VideoPerformanceRecord {
  return {
    videoId: `history-${format}-${index}`,
    ideaId: `old-${index}`,
    platform: "youtube-shorts",
    publishedAt: `2026-08-${10 + index}T12:00:00Z`,
    durationSeconds: 24,
    views: 8000,
    shownOrImpressions: 10000,
    engagedViews: format === "game" ? 7800 : 5000,
    stayedToWatchRate: format === "game" ? 0.78 : 0.5,
    averagePercentageViewed: format === "game" ? 0.92 : 0.55,
    retentionCurve: [{ elapsedRatio: 0.95, audienceRatio: format === "game" ? 0.76 : 0.3 }],
    likes: format === "game" ? 650 : 250,
    comments: format === "game" ? 80 : 25,
    shares: format === "game" ? 150 : 25,
    saves: format === "game" ? 120 : 20,
    followsGained: format === "game" ? 90 : 20,
    siteClicks: format === "game" ? 180 : 40,
    builderStarts: format === "game" ? 60 : 10,
    affiliateClicks: format === "game" ? 20 : 3,
    format,
    visualWorld: format === "game" ? "Blind Draft Arena" : "Generic Comparison",
    narrativeEngine: format === "game" ? "blind-choice reveal" : "standard comparison",
    hookFamily: format === "game" ? "interactive-choice" : "price-gap-comparison",
    durationBucket: "20-29",
  };
}

describe("logical content automator", () => {
  it("selects exactly five high-tier SpecSmith ideas with at least three radical concepts", () => {
    const batch = buildAutomationBatch(gpus, cpus, [], new Date("2026-08-21T12:00:00Z"));
    expect(batch.dailyFive).toHaveLength(5);
    expect(new Set(batch.dailyFive.map((plan) => plan.idea.id)).size).toBe(5);
    expect(batch.dailyFive.filter((plan) => radical.has(plan.idea.format)).length).toBeGreaterThanOrEqual(3);
    expect(batch.dailyFive.every((plan) => plan.qualityScore >= batch.qualityFloor)).toBe(true);
    expect(batch.dailyFive.every((plan) => plan.idea.scores.productFit >= 9)).toBe(true);
    expect(batch.dailyFive.every((plan) => plan.idea.scores.siteContinuation >= 9)).toBe(true);
    expect(batch.dailyFive.every((plan) => plan.idea.productConnection.route.startsWith("/"))).toBe(true);
    expect(new Set(batch.dailyFive.map((plan) => plan.idea.productConnection.feature)).size).toBeGreaterThanOrEqual(3);
  });

  it("attaches one explicit learning hypothesis and site continuation to every video", () => {
    const batch = buildAutomationBatch(gpus, cpus, [], new Date("2026-08-21T12:00:00Z"));
    for (const plan of batch.dailyFive) {
      expect(plan.experiment.hypothesis.length).toBeGreaterThan(20);
      expect(plan.experiment.holdConstant.length).toBeGreaterThanOrEqual(3);
      expect(plan.experiment.holdConstant.some((rule) => rule.includes(plan.idea.productConnection.route))).toBe(true);
      expect(hookFamilyOfIdea(plan.idea).length).toBeGreaterThan(0);
    }
  });

  it("keeps every daily creative inside the narration budget and reuses its copy across platforms", () => {
    const batch = buildAutomationBatch(gpus, cpus, [], new Date("2026-08-21T12:00:00Z"));
    for (const storyboard of batch.scriptStoryboards) {
      const narrations = storyboard.scripts.map((script) => normalizeNarrationText(script.beats.map((beat) => beat.narration)));
      expect(new Set(narrations).size).toBe(1);
      expect(narrations[0].length).toBeGreaterThanOrEqual(MIN_PRODUCTION_NARRATION_CHARACTERS);
      expect(narrations[0].length).toBeLessThanOrEqual(MAX_PRODUCTION_NARRATION_CHARACTERS);
    }
  });

  it("records the configured production voice in every creative fingerprint", () => {
    const batch = buildAutomationBatch(
      gpus,
      cpus,
      [],
      new Date("2026-08-21T12:00:00Z"),
      { voiceId: "voice-production", voiceName: "SpecSmith Voice" },
    );

    expect(batch.creativeFingerprints).toHaveLength(15);
    expect(batch.creativeFingerprints.every((fingerprint) => fingerprint.voiceId === "voice-production")).toBe(true);
    expect(batch.creativeFingerprints.every((fingerprint) => fingerprint.voiceName === "SpecSmith Voice")).toBe(true);
  });

  it("uses repeated performance evidence as a bounded signal instead of blindly copying winners", () => {
    const history = [0, 1, 2, 3].flatMap((index) => [historyRecord(index, "game"), historyRecord(index, "comparison")]);
    const batch = buildAutomationBatch(gpus, cpus, history, new Date("2026-08-21T12:00:00Z"));
    expect(batch.performanceLearning?.videoCount).toBe(8);
    expect(batch.dailyFive.some((plan) => plan.learningAdjustment !== 0)).toBe(true);
    expect(batch.dailyFive.every((plan) => Math.abs(plan.learningAdjustment) <= 0.8)).toBe(true);
  });
});
