import { describe, expect, it } from "vitest";
import { buildContentPackage } from "./contentPackage.ts";
import { buildScriptStoryboardPackage } from "./scriptStoryboard.ts";
import { buildProductionPlanPackage } from "./productionPlan.ts";
import type { ContentIdea } from "./types.ts";

const idea: ContentIdea = {
  id: "builder-budget-challenge",
  format: "build",
  title: "What does another $200 actually change in this SpecSmith build?",
  hook: "You get $200 more. Where should it go?",
  angle: "Use Builder to show the highest-impact place to spend the extra budget.",
  targetAudience: "PC builders",
  requiredFacts: ["current build price", "compatible upgrade options", "part price deltas"],
  subjectIds: ["g1", "c1"],
  productConnection: {
    feature: "builder",
    route: "/builder",
    userProblem: "Builders struggle to know which component deserves the next chunk of budget.",
    whySpecSmith: "SpecSmith Builder can hold the full build constant while changing one real compatible component at a time.",
    continuationAction: "Open Builder, recreate the build, and test where your next $200 changes the result most.",
    sitePayoff: "The viewer can continue the exact budget experiment using their own build.",
  },
  creativeDNA: {
    conceptName: "Budget Lock",
    visualWorld: "Budget Lock — the build stays fixed while one upgrade slot opens",
    narrativeEngine: "constraint -> choice -> evidence -> payoff",
    openingImage: "A real build total and one locked upgrade slot are visible.",
    patternInterrupt: "The budget can only move once.",
    retentionBeats: ["1", "2", "3", "4", "5"],
    payoff: "Show the strongest compatible spend based on verified inputs.",
    audioDirection: "Tight impacts and silence before reveal.",
    originalityConstraint: "The Builder state must be essential to the story.",
    antiSlopRules: ["a", "b", "c", "d", "e", "f"],
  },
  scores: {
    curiosity: 9,
    usefulness: 10,
    visualPotential: 9,
    purchaseIntent: 9,
    novelty: 8,
    originality: 9,
    retentionPotential: 9,
    shareability: 8,
    productFit: 10,
    siteContinuation: 10,
    total: 9.2,
  },
};

describe("production plan", () => {
  it("routes evidence, payoff, and CTA visuals to deterministic SpecSmith rendering", () => {
    const content = buildContentPackage(idea, new Date("2026-08-22T18:00:00Z"));
    const scripts = buildScriptStoryboardPackage(idea, content);
    const production = buildProductionPlanPackage(scripts);

    for (const platform of production.platforms) {
      const deterministic = platform.tasks.filter((task) => task.capability === "deterministic-ui-render");
      expect(deterministic.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("adds voice, audio, captions, compositor, and quality gates to every platform", () => {
    const content = buildContentPackage(idea, new Date("2026-08-22T18:00:00Z"));
    const scripts = buildScriptStoryboardPackage(idea, content);
    const production = buildProductionPlanPackage(scripts);

    for (const platform of production.platforms) {
      const capabilities = new Set(platform.tasks.map((task) => task.capability));
      expect(capabilities.has("text-to-speech")).toBe(true);
      expect(capabilities.has("music-sfx")).toBe(true);
      expect(capabilities.has("caption-render")).toBe(true);
      expect(capabilities.has("motion-compositor")).toBe(true);
      expect(platform.qualityChecks.some((check) => check.includes("measured game FPS"))).toBe(true);
    }
  });

  it("gives generative visuals a non-video fallback without allowing fake product UI", () => {
    const content = buildContentPackage(idea, new Date("2026-08-22T18:00:00Z"));
    const scripts = buildScriptStoryboardPackage(idea, content);
    const production = buildProductionPlanPackage(scripts);

    const generativeTasks = production.platforms.flatMap((platform) => platform.tasks)
      .filter((task) => task.capability === "video-generation");
    expect(generativeTasks.length).toBeGreaterThan(0);
    expect(generativeTasks.every((task) => task.fallbackCapability === "image-generation")).toBe(true);
    expect(production.platforms.every((platform) => platform.qualityChecks.some((check) => check.includes("deterministic UI render")))).toBe(true);
  });
});
