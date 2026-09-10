import { describe, expect, it } from "vitest";
import { buildContentPackage } from "./contentPackage.ts";
import { buildScriptStoryboardPackage } from "./scriptStoryboard.ts";
import type { ContentIdea } from "./types.ts";

const idea: ContentIdea = {
  id: "compare-blind-pick",
  format: "game",
  title: "Two GPUs. Pick one before SpecSmith reveals the names.",
  hook: "You only get the prices and specs. Pick one now.",
  angle: "Use Compare to turn a buyer decision into a blind-choice reveal.",
  targetAudience: "GPU buyers",
  requiredFacts: ["GPU A price", "GPU B price", "benchmark score difference"],
  subjectIds: ["g1", "g2"],
  productConnection: {
    feature: "compare",
    route: "/compare",
    userProblem: "Buyers struggle to tell whether the more expensive GPU is actually worth the extra money.",
    whySpecSmith: "SpecSmith Compare places both choices in one product workflow and exposes the useful tradeoffs.",
    continuationAction: "Open Compare, load the two GPUs, and inspect the full tradeoff before choosing.",
    sitePayoff: "The viewer can reproduce the exact comparison instead of trusting a short-form conclusion.",
  },
  creativeDNA: {
    conceptName: "Blind Pick",
    visualWorld: "Blind Pick — identities hidden until the end",
    narrativeEngine: "prediction -> evidence -> reveal",
    openingImage: "Two hidden GPU cards are already competing.",
    patternInterrupt: "Reveal one decisive fact at a time.",
    retentionBeats: ["1", "2", "3", "4", "5"],
    payoff: "Reveal the better fit based on verified tradeoffs.",
    audioDirection: "Sparse tension and reveal hits.",
    originalityConstraint: "The comparison interaction must drive the story.",
    antiSlopRules: ["a", "b", "c", "d", "e", "f"],
  },
  scores: {
    curiosity: 9,
    usefulness: 9,
    visualPotential: 9,
    purchaseIntent: 9,
    novelty: 9,
    originality: 9,
    retentionPotential: 9,
    shareability: 8,
    productFit: 10,
    siteContinuation: 10,
    total: 9.2,
  },
};

describe("script storyboard", () => {
  it("creates a complete script for every supported short-form platform", () => {
    const contentPackage = buildContentPackage(idea, new Date("2026-08-22T18:00:00Z"));
    const result = buildScriptStoryboardPackage(idea, contentPackage);

    expect(result.scripts).toHaveLength(3);
    expect(new Set(result.scripts.map((script) => script.platform)).size).toBe(3);
    expect(result.scripts.every((script) => script.beats.length === 6)).toBe(true);
  });

  it("keeps factual dependencies and exact SpecSmith continuation in every script", () => {
    const contentPackage = buildContentPackage(idea, new Date("2026-08-22T18:00:00Z"));
    const result = buildScriptStoryboardPackage(idea, contentPackage);

    for (const script of result.scripts) {
      expect(script.beats.some((beat) => beat.factDependencies.length > 0)).toBe(true);
      expect(script.finalCta).toContain("/compare");
      expect(script.factualGuardrails.some((rule) => rule.includes("measured game FPS"))).toBe(true);
      expect(script.beats.at(-1)?.purpose).toBe("cta");
    }
  });

  it("covers the full target duration without overlapping the CTA beyond the end", () => {
    const contentPackage = buildContentPackage(idea, new Date("2026-08-22T18:00:00Z"));
    const result = buildScriptStoryboardPackage(idea, contentPackage);

    for (const script of result.scripts) {
      expect(script.beats[0].startSecond).toBe(0);
      expect(script.beats.at(-1)?.endSecond).toBe(script.targetDurationSeconds);
      expect(script.beats.every((beat) => beat.endSecond > beat.startSecond)).toBe(true);
    }
  });
});
