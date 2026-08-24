import { describe, expect, it } from "vitest";
import { applyAudioSelectionsToProductionPlans, buildAudioSelections, selectAudioForIdea } from "./audioTrend.ts";
import { buildContentPackage } from "./contentPackage.ts";
import { buildProductionPlanPackage } from "./productionPlan.ts";
import { buildScriptStoryboardPackage } from "./scriptStoryboard.ts";
import type { ContentIdea } from "./types.ts";

const idea: ContentIdea = {
  id: "price-guesser-reveal",
  format: "game",
  title: "Can you beat SpecSmith's GPU Price Guesser?",
  hook: "Lock your price before the reveal.",
  angle: "Turn the real price into a fast guessing game with a reveal.",
  targetAudience: "PC buyers",
  requiredFacts: ["verified current GPU price"],
  subjectIds: ["g1"],
  productConnection: {
    feature: "price-guesser",
    route: "/price-guesser",
    userProblem: "GPU pricing is hard to judge quickly without current context.",
    whySpecSmith: "SpecSmith turns current hardware prices into a playable decision and reveal.",
    continuationAction: "Open Price Guesser and play another round with live SpecSmith data.",
    sitePayoff: "The viewer can continue the exact guessing game on SpecSmith.",
  },
  creativeDNA: {
    conceptName: "Price Lock",
    visualWorld: "Price Guesser Countdown",
    narrativeEngine: "guess -> tension -> reveal",
    openingImage: "A GPU and a locked price field fill the first frame.",
    patternInterrupt: "Freeze the timer before revealing the real number.",
    retentionBeats: ["guess", "countdown", "hint", "reversal", "reveal"],
    payoff: "Reveal the verified price.",
    audioDirection: "Countdown tension, silence before reveal, then one clean impact.",
    originalityConstraint: "Audio must reinforce the guessing mechanic.",
    antiSlopRules: ["a", "b", "c", "d", "e", "f"],
  },
  scores: {
    curiosity: 9,
    usefulness: 9,
    visualPotential: 9,
    purchaseIntent: 8,
    novelty: 9,
    originality: 9,
    retentionPotential: 10,
    shareability: 9,
    productFit: 10,
    siteContinuation: 10,
    total: 9.2,
  },
};

const now = new Date("2026-08-22T22:00:00Z");

const snapshot = {
  capturedAt: "2026-08-22T20:00:00Z",
  candidates: [
    {
      id: "tt-cleared-rise",
      platform: "tiktok" as const,
      title: "Countdown Drop",
      artist: "Creator",
      capturedAt: "2026-08-22T20:00:00Z",
      rightsStatus: "platform-cleared" as const,
      popularityScore: 82,
      velocityScore: 95,
      saturationScore: 35,
      tags: ["countdown", "tension", "reveal", "game"],
    },
    {
      id: "tt-uncleared-bigger",
      platform: "tiktok" as const,
      title: "Huge Song",
      capturedAt: "2026-08-22T20:00:00Z",
      rightsStatus: "unknown" as const,
      popularityScore: 100,
      velocityScore: 100,
      saturationScore: 10,
      tags: ["countdown", "reveal", "game"],
    },
    {
      id: "yt-cleared",
      platform: "youtube-shorts" as const,
      title: "Shorts Reveal",
      capturedAt: "2026-08-22T20:00:00Z",
      rightsStatus: "platform-cleared" as const,
      popularityScore: 90,
      velocityScore: 88,
      saturationScore: 40,
      tags: ["reveal", "tension", "game"],
    },
    {
      id: "ig-cleared",
      platform: "instagram-reels" as const,
      title: "Reels Tension",
      capturedAt: "2026-08-22T20:00:00Z",
      rightsStatus: "commercial-cleared" as const,
      popularityScore: 86,
      velocityScore: 91,
      saturationScore: 45,
      tags: ["countdown", "reveal", "impact"],
    },
  ],
};

describe("trending audio selector", () => {
  it("chooses a cleared rising sound and rejects a stronger uncleared sound", () => {
    const selection = selectAudioForIdea(idea, "tiktok", snapshot, now);
    expect(selection.mode).toBe("trending");
    expect(selection.candidateId).toBe("tt-cleared-rise");
    expect(selection.rightsStatus).toBe("platform-cleared");
    expect(selection.attachMode).toBe("platform-publish");
  });

  it("falls back to original/licensed audio when the snapshot is stale", () => {
    const stale = { ...snapshot, capturedAt: "2026-08-01T00:00:00Z" };
    const selection = selectAudioForIdea(idea, "tiktok", stale, now);
    expect(selection.mode).toBe("original");
    expect(selection.reason.toLowerCase()).toContain("stale");
  });

  it("builds one audio decision per idea per platform", () => {
    const selections = buildAudioSelections([idea], snapshot, now);
    expect(selections).toHaveLength(3);
    expect(new Set(selections.map((entry) => entry.platform)).size).toBe(3);
    expect(selections.every((entry) => entry.mode === "trending")).toBe(true);
  });

  it("adds platform-native trending audio at publish time rather than baking it into the master", () => {
    const content = buildContentPackage(idea, now);
    const scripts = buildScriptStoryboardPackage(idea, content);
    const production = buildProductionPlanPackage(scripts);
    const selections = buildAudioSelections([idea], snapshot, now);
    const [updated] = applyAudioSelectionsToProductionPlans([production], selections);

    const tiktok = updated.platforms.find((entry) => entry.platform === "tiktok")!;
    const musicTask = tiktok.tasks.find((task) => task.capability === "music-sfx")!;
    expect(musicTask.inputRequirements.some((requirement) => requirement.includes("platform-native publish-time"))).toBe(true);
    expect(musicTask.inputRequirements.some((requirement) => requirement.includes("Do not bake"))).toBe(true);
  });
});
