import { describe, expect, it } from "vitest";
import { buildContentPackage } from "./contentPackage.ts";
import type { ContentIdea } from "./types.ts";

const idea: ContentIdea = {
  id: "crate-one-part-change",
  format: "game",
  title: "Build Crate picked this PC. You can change ONE part.",
  hook: "You get one change before this build is locked.",
  angle: "Turn a real Build Crate result into an interactive optimization challenge.",
  targetAudience: "PC builders",
  requiredFacts: ["crate result", "part prices", "compatibility"],
  subjectIds: ["gpu-1", "cpu-1"],
  productConnection: {
    feature: "build-crate",
    route: "/crate",
    userProblem: "People want a fast way to discover a viable build and decide what they would improve first.",
    whySpecSmith: "SpecSmithPC can generate the real compatible build and let the viewer continue into the Builder.",
    continuationAction: "Open Build Crate, pull a build, then send it to Builder and change the weakest part.",
    sitePayoff: "The viewer can reproduce the challenge with a real build instead of only watching the answer.",
  },
  creativeDNA: {
    conceptName: "Crate Challenge",
    visualWorld: "Crate Challenge — real parts reveal one at a time",
    narrativeEngine: "viewer choice -> reveal -> product payoff",
    openingImage: "A generated build is already on screen.",
    patternInterrupt: "Only one component can be changed.",
    retentionBeats: ["1", "2", "3", "4", "5"],
    payoff: "Show the best single change.",
    audioDirection: "Tight reveal sounds.",
    originalityConstraint: "The product action must drive the story.",
    antiSlopRules: ["a", "b", "c", "d", "e", "f"],
  },
  scores: {
    curiosity: 9,
    usefulness: 9,
    visualPotential: 9,
    purchaseIntent: 7,
    novelty: 9,
    originality: 9,
    retentionPotential: 9,
    shareability: 8,
    productFit: 10,
    siteContinuation: 10,
    total: 9.1,
  },
};

describe("content package", () => {
  it("turns one SpecSmithPC idea into three platform variants plus one site continuation", () => {
    const result = buildContentPackage(idea, new Date("2026-08-22T18:00:00Z"));

    expect(result.platforms).toHaveLength(3);
    expect(new Set(result.platforms.map((variant) => variant.platform)).size).toBe(3);
    expect(result.site.route).toBe("/crate");
    expect(result.feature).toBe("build-crate");
    expect(result.ideaId).toBe(idea.id);
  });

  it("adapts presentation by platform instead of copy-pasting one version", () => {
    const result = buildContentPackage(idea, new Date("2026-08-22T18:00:00Z"));
    const openings = result.platforms.map((variant) => variant.opening);
    const objectives = result.platforms.map((variant) => variant.objective);

    expect(new Set(openings).size).toBe(3);
    expect(new Set(objectives).size).toBe(3);
  });

  it("creates deterministic attribution ids and keeps the exact SpecSmithPC destination", () => {
    const first = buildContentPackage(idea, new Date("2026-08-22T18:00:00Z"));
    const second = buildContentPackage(idea, new Date("2026-08-22T18:00:00Z"));

    expect(first.campaignId).toBe(second.campaignId);
    expect(first.attribution.utmCampaign).toBe(first.campaignId);
    expect(first.platforms.every((variant) => variant.cta.includes("/crate"))).toBe(true);
    expect(first.platforms.every((variant) => variant.cta.includes("SpecSmithPC"))).toBe(true);
    expect(first.attribution.conversionEvents).toContain("site-click");
  });

  it("attaches bounded, branded hashtags and a strategy id to every platform", () => {
    const result = buildContentPackage(idea, new Date("2026-08-22T18:00:00Z"));

    for (const variant of result.platforms) {
      expect(variant.hashtagStrategy).toBe("intent-balanced-v1");
      expect(variant.hashtags).toContain("#SpecSmithPC");
      expect(variant.hashtags.length).toBeGreaterThanOrEqual(3);
      expect(variant.hashtags.length).toBeLessThanOrEqual(variant.platform === "youtube-shorts" ? 4 : 5);
    }
  });
});
