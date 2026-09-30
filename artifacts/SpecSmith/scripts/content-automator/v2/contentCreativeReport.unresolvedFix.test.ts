import { describe, expect, it } from "vitest";

import { buildContentCreativeReport, type HumanGate } from "./contentCreativeReport.ts";
import { HUMAN_ONLY_DIMENSIONS, reviewCreativeQuality } from "./creativeQualityReview.ts";
import type { CaptionCue } from "../captionRender.ts";
import type { CreativeFingerprint, PlatformScriptStoryboard, StoryboardBeat } from "../types.ts";

const NOW = new Date("2026-09-14T00:00:00.000Z");
const SHA = "d".repeat(64);

function beat(overrides: Partial<StoryboardBeat> & Pick<StoryboardBeat, "startSecond" | "endSecond" | "purpose">): StoryboardBeat {
  return {
    narration: "SpecSmith holds the rest of the build constant.",
    visualDirection: `unique direction ${overrides.startSecond}`,
    onScreenText: "REAL SPECS",
    factDependencies: [],
    ...overrides,
  };
}

const fingerprint = {
  version: "creative-fingerprint-v1",
  creativeId: "creative-regression",
  packageId: "pkg-regression",
  campaignId: "campaign-regression",
  ideaId: "idea-regression",
  platform: "youtube-shorts",
} as unknown as CreativeFingerprint;

const approvals = Object.fromEntries(
  [...HUMAN_ONLY_DIMENSIONS, "audio-listening-review"].map((gate) => [
    gate,
    { by: "reviewer", at: NOW.toISOString(), outcome: "approved" as const },
  ]),
) as Readonly<Record<string, HumanGate["decision"]>>;

function cuesFor(board: PlatformScriptStoryboard): CaptionCue[] {
  return board.beats.map((entry) => ({
    startSecond: entry.startSecond,
    endSecond: entry.endSecond,
    text: entry.onScreenText,
  }));
}

describe("CONTENT_CREATIVE_REPORT unresolved-fix gate", () => {
  it("does not become publishReady just because human gates are approved while a known creative fix remains", () => {
    const board: PlatformScriptStoryboard = {
      platform: "youtube-shorts",
      targetDurationSeconds: 24,
      title: "Repeated visual regression",
      narrationStyle: "direct",
      beats: [
        beat({ startSecond: 0, endSecond: 2, purpose: "hook", visualDirection: "same shot" }),
        beat({ startSecond: 2, endSecond: 8, purpose: "commitment", visualDirection: "same shot" }),
        beat({ startSecond: 8, endSecond: 16, purpose: "evidence", visualDirection: "same shot" }),
        beat({ startSecond: 16, endSecond: 24, purpose: "cta", visualDirection: "same shot", narration: "Open /compare." }),
      ],
      finalCta: "Open SpecSmith Compare.",
      factualGuardrails: [],
    };

    const review = reviewCreativeQuality({
      creativeId: "creative-regression",
      packageId: "pkg-regression",
      storyboard: board,
      captionCues: cuesFor(board),
      ctaRoute: "/compare",
      mediaSha256: SHA,
      now: NOW,
    });

    expect(review.recommendedFixes.length).toBeGreaterThan(0);

    const report = buildContentCreativeReport({
      review,
      fingerprint,
      mediaSha256: SHA,
      recordedHumanDecisions: approvals,
      now: NOW,
    });

    expect(report.publishReady).toBe(false);
    expect(report.blockedBy.some((entry) => entry.startsWith("Unresolved creative fix:"))).toBe(true);
  });
});
