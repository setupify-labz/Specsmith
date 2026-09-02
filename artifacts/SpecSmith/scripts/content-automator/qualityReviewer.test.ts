import { describe, expect, it } from "vitest";
import { buildContentPackage } from "./contentPackage.ts";
import { buildScriptStoryboardPackage } from "./scriptStoryboard.ts";
import { buildProductionPlanPackage } from "./productionPlan.ts";
import {
  buildQualityReviewRequest,
  reviewRenderedVideo,
  type RenderedVideoObservation,
} from "./qualityReviewer.ts";
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

const content = buildContentPackage(idea, new Date("2026-08-22T18:00:00Z"));
const scripts = buildScriptStoryboardPackage(idea, content);
const production = buildProductionPlanPackage(scripts);
const request = buildQualityReviewRequest(content, scripts, production, "youtube-shorts");

/** Stand-in digest for the reviewed master; only its shape matters here. */
const MASTER_SHA256 = "b".repeat(64);

function cleanObservation(overrides: Partial<RenderedVideoObservation> = {}): RenderedVideoObservation {
  return {
    packageId: content.packageId,
    platform: "youtube-shorts",
    // The digest of the exact file the reviewer watched. It is carried through
    // to QualityReviewResult.reviewedMediaSha256 and is what the publishing
    // gate binds the published bytes to.
    masterSha256: MASTER_SHA256,
    durationSeconds: 24,
    openingDecisionClearWithoutAudio: true,
    captionsLegibilityScore: 9.5,
    captionSafeAreaRatio: 1,
    audioClarityScore: 9.3,
    visualCoherenceScore: 9.2,
    pacingScore: 9.1,
    specSmithRelevanceScore: 9.7,
    genericAiBrollRatio: 0.15,
    observedCtaRoute: "/builder",
    claims: [
      {
        text: "The current build price shown is verified from the Builder state.",
        kind: "price",
        verification: "verified",
        evidenceRefs: ["builder-state:build-1"],
      },
      {
        text: "The upgrade option is compatible with the selected build.",
        kind: "compatibility",
        verification: "verified",
        evidenceRefs: ["compatibility-engine:build-1"],
      },
    ],
    uiShots: [
      { source: "deterministic", presentedAsRealSpecSmithUi: true, taskId: "youtube-shorts-beat-3-visual" },
      { source: "deterministic", presentedAsRealSpecSmithUi: true, taskId: "youtube-shorts-beat-5-visual" },
    ],
    missingRequiredFacts: [],
    failedTaskIds: [],
    ...overrides,
  };
}

describe("automated quality reviewer", () => {
  it("builds a strict review contract from the content, storyboard, and production plans", () => {
    expect(request.expectedRoute).toBe("/builder");
    expect(request.requiredFacts).toEqual(idea.requiredFacts);
    expect(request.expectedTaskIds.length).toBeGreaterThan(8);
    expect(request.hardBlockers.some((rule) => rule.includes("measured game FPS"))).toBe(true);
    expect(request.productionChecks.some((rule) => rule.includes("generic AI B-roll"))).toBe(true);
  });

  it("passes a strong render and marks it publishable", () => {
    const result = reviewRenderedVideo(request, cleanObservation());
    expect(result.decision).toBe("pass");
    expect(result.publishable).toBe(true);
    expect(result.overallScore).toBeGreaterThanOrEqual(8.5);
    expect(result.issues.filter((issue) => issue.severity !== "warning")).toHaveLength(0);
  });

  it("holds uncertain factual claims instead of guessing or auto-publishing", () => {
    const result = reviewRenderedVideo(request, cleanObservation({
      claims: [{
        text: "This upgrade is 17% faster.",
        kind: "other",
        verification: "unverified",
        evidenceRefs: [],
      }],
    }));
    expect(result.decision).toBe("hold-for-human-review");
    expect(result.publishable).toBe(false);
    expect(result.issues.some((issue) => issue.code === "unverified-claim")).toBe(true);
  });

  it("forces a full regeneration for fake SpecSmith UI, wrong CTA, or dangerous FPS labeling", () => {
    const result = reviewRenderedVideo(request, cleanObservation({
      observedCtaRoute: "/",
      claims: [{
        text: "Expected game performance",
        kind: "estimated-fps",
        verification: "verified",
        evidenceRefs: ["estimator:run-1"],
        displayLabel: "FPS",
      }],
      uiShots: [{ source: "generated", presentedAsRealSpecSmithUi: true, taskId: "youtube-shorts-beat-5-visual" }],
    }));
    expect(result.decision).toBe("regenerate-full");
    expect(result.publishable).toBe(false);
    expect(result.issues.some((issue) => issue.code === "fake-specsmith-ui")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "wrong-cta-route")).toBe(true);
    expect(result.issues.some((issue) => issue.code === "estimated-fps-unlabeled")).toBe(true);
  });

  it("targets only repairable caption/audio tasks when the rest of the video is strong", () => {
    const result = reviewRenderedVideo(request, cleanObservation({
      captionsLegibilityScore: 6.5,
      captionSafeAreaRatio: 0.88,
      audioClarityScore: 7,
    }));
    expect(result.decision).toBe("regenerate-targeted");
    expect(result.publishable).toBe(false);
    expect(result.regenerateTaskIds.some((id) => id.includes("captions"))).toBe(true);
    expect(result.regenerateTaskIds.some((id) => id.includes("voice"))).toBe(true);
    expect(result.regenerateTaskIds.some((id) => id.includes("compose"))).toBe(true);
  });

  it("rejects AI-slop-dominant visuals even if the other numeric scores look good", () => {
    const result = reviewRenderedVideo(request, cleanObservation({ genericAiBrollRatio: 0.75 }));
    expect(result.decision).toBe("regenerate-full");
    expect(result.issues.some((issue) => issue.code === "ai-slop-dominant")).toBe(true);
  });

  it("prevents an internal SpecSmith score from masquerading as measured game FPS", () => {
    const result = reviewRenderedVideo(request, cleanObservation({
      claims: [{
        text: "SpecSmith benchmark score 285",
        kind: "specsmith-score",
        verification: "verified",
        evidenceRefs: ["catalog:g1"],
        displayLabel: "Measured 285 FPS",
      }],
    }));
    expect(result.decision).toBe("regenerate-full");
    expect(result.issues.some((issue) => issue.code === "score-mislabeled-as-measured-fps")).toBe(true);
  });
});
