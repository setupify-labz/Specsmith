import { describe, expect, it } from "vitest";

import { repairCreative } from "./beatRepair.ts";
import { reviewCreativeQuality, type CreativeQualityReview } from "./creativeQualityReview.ts";
import type { CaptionCue } from "../captionRender.ts";
import type { PlatformScriptStoryboard, StoryboardBeat } from "../types.ts";

const NOW = new Date("2026-09-14T00:00:00.000Z");

function beat(overrides: Partial<StoryboardBeat> & Pick<StoryboardBeat, "startSecond" | "endSecond" | "purpose">): StoryboardBeat {
  return {
    narration: "SpecSmith holds the rest of the build constant.",
    visualDirection: `unique direction ${overrides.startSecond}`,
    onScreenText: "REAL SPECS",
    factDependencies: [],
    ...overrides,
  };
}

function board(): PlatformScriptStoryboard {
  return {
    platform: "youtube-shorts",
    targetDurationSeconds: 24,
    title: "repair regression fixture",
    narrationStyle: "direct",
    beats: [
      beat({ startSecond: 0, endSecond: 2, purpose: "hook", onScreenText: "Names hidden" }),
      beat({ startSecond: 2, endSecond: 8, purpose: "evidence", narration: "We benchmarked both cards ourselves." }),
      beat({ startSecond: 8, endSecond: 16, purpose: "payoff" }),
      beat({ startSecond: 16, endSecond: 24, purpose: "cta", narration: "Open /compare." }),
    ],
    finalCta: "Open SpecSmith Compare.",
    factualGuardrails: [],
  };
}

function cuesFor(storyboard: PlatformScriptStoryboard): CaptionCue[] {
  return storyboard.beats.map((entry) => ({
    startSecond: entry.startSecond,
    endSecond: entry.endSecond,
    text: entry.onScreenText,
  }));
}

function baseReview(storyboard: PlatformScriptStoryboard): CreativeQualityReview {
  return reviewCreativeQuality({
    creativeId: "creative-1",
    packageId: "pkg-1",
    storyboard,
    captionCues: cuesFor(storyboard),
    ctaRoute: "/compare",
    mediaSha256: null,
    now: NOW,
  });
}

describe("repair acceptance is fail-closed", () => {
  it("rejects a repair that clears a hard failure but regresses another measured dimension", () => {
    let calls = 0;
    const reviewer = (storyboard: PlatformScriptStoryboard): CreativeQualityReview => {
      calls += 1;
      const review = baseReview(storyboard);
      if (calls === 1) return review;

      // Simulate a downstream measurement discovering that the candidate became
      // worse on an independent measured dimension after the hard failure was
      // removed. A cleared slop failure must not override this regression.
      return {
        ...review,
        overall: review.overall.map((entry) =>
          entry.dimension === "shot-uniqueness" && entry.score !== null
            ? { ...entry, score: Math.max(0, entry.score - 1) }
            : entry,
        ),
      };
    };

    const input = board();
    const result = repairCreative({
      creativeId: "creative-1",
      storyboard: input,
      review: reviewer,
      ctaRoute: "/compare",
      minImprovement: 99,
    });

    expect(result.passes[0].review.slop.hardFailures).toHaveLength(0);
    expect(result.passes[0].lineage.regressedDimensions).toContain("shot-uniqueness");
    expect(result.passes[0].lineage.accepted).toBe(false);
    expect(result.passes[0].lineage.rejectionReason).toMatch(/clearing a hard failure does not permit a measured regression/i);
    expect(JSON.stringify(result.finalStoryboard)).toBe(JSON.stringify(input));
  });

  it("does not stop at quality-target-met while the re-review still names a fix", () => {
    // After the first pass the candidate clears its hard failure, regresses
    // nothing, and sits above the (deliberately low) quality target, but the
    // re-review still names an unrepairable visual fix. A high average must not
    // end the loop as if the creative were finished. (Regression for #127 fix 3.)
    const knownFix = {
      beats: [2],
      issue: "Beats 2 and 3 repeat one visual direction.",
      fix: "Give beat 3 a distinct visual direction.",
      dimension: "visual-repetition",
    };
    let calls = 0;
    const reviewer = (storyboard: PlatformScriptStoryboard): CreativeQualityReview => {
      calls += 1;
      const review = baseReview(storyboard);
      if (calls === 1) return review;
      return { ...review, recommendedFixes: [...review.recommendedFixes, knownFix] };
    };

    const result = repairCreative({
      creativeId: "creative-1",
      storyboard: board(),
      review: reviewer,
      ctaRoute: "/compare",
      qualityTarget: 0,
    });

    expect(result.passes[0].lineage.accepted).toBe(true);
    expect(result.passes[0].review.productionQualityScore).toBeGreaterThanOrEqual(0);
    expect(result.finalReview.recommendedFixes).toContainEqual(knownFix);
    expect(result.stoppedBecause).not.toBe("quality-target-met");
  });
});
