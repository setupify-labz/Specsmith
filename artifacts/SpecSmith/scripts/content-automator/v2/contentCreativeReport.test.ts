// CONTENT_CREATIVE_REPORT tests.
//
// The single rule worth most of this file: no machine score, however high,
// closes a human gate. Everything else in the report is descriptive; this one
// property is the difference between a report and a rubber stamp.

import { describe, expect, it } from "vitest";

import { buildContentCreativeReport, formatContentCreativeReport, type HumanGate } from "./contentCreativeReport.ts";
import { HUMAN_ONLY_DIMENSIONS, reviewCreativeQuality } from "./creativeQualityReview.ts";
import { repairCreative } from "./beatRepair.ts";
import type { CaptionCue } from "../captionRender.ts";
import type { CreativeFingerprint, PlatformScriptStoryboard, StoryboardBeat } from "../types.ts";

const NOW = new Date("2026-09-14T00:00:00.000Z");
const SHA = "c".repeat(64);

function beat(overrides: Partial<StoryboardBeat> & Pick<StoryboardBeat, "startSecond" | "endSecond" | "purpose">): StoryboardBeat {
  return {
    narration: "SpecSmith holds the rest of the build constant.",
    visualDirection: `unique direction ${overrides.startSecond}`,
    onScreenText: "REAL SPECS",
    factDependencies: [],
    ...overrides,
  };
}

const storyboard: PlatformScriptStoryboard = {
  platform: "youtube-shorts",
  targetDurationSeconds: 24,
  title: "RTX 4080 Super vs RTX 4080",
  narrationStyle: "direct",
  beats: [
    beat({ startSecond: 0, endSecond: 2, purpose: "hook", onScreenText: "Names hidden" }),
    beat({ startSecond: 2, endSecond: 8, purpose: "commitment", onScreenText: "LOCK YOUR PICK" }),
    beat({ startSecond: 8, endSecond: 16, purpose: "evidence", onScreenText: "REAL SPECS" }),
    beat({ startSecond: 16, endSecond: 24, purpose: "cta", onScreenText: "OPEN COMPARE", narration: "Open /compare and change the cards." }),
  ],
  finalCta: "Open SpecSmith Compare.",
  factualGuardrails: [],
};

const fingerprint = {
  version: "creative-fingerprint-v1",
  creativeId: "creative-1",
  packageId: "pkg-1",
  campaignId: "campaign-1",
  ideaId: "idea-1",
  platform: "youtube-shorts",
  format: "comparison",
  feature: "compare",
  subjectIds: ["rtx4080s", "rtx4080"],
  hookFamily: "blind-choice",
  hookText: "Can you pick the faster card?",
  visualWorld: "real SpecSmith comparison",
  narrativeEngine: "blind choice -> evidence -> reveal",
  targetDurationSeconds: 24,
  beatCount: 4,
  plannedBeatChangesPer10Seconds: 1.7,
  editDensity: "medium",
  captionedBeatRatio: 1,
  captionDensity: "medium",
  firstVisualType: "deterministic-ui",
} as unknown as CreativeFingerprint;

function cuesFor(board: PlatformScriptStoryboard): CaptionCue[] {
  return board.beats.map((entry) => ({ startSecond: entry.startSecond, endSecond: entry.endSecond, text: entry.onScreenText }));
}

const reviewOf = (board: PlatformScriptStoryboard) =>
  reviewCreativeQuality({
    creativeId: "creative-1",
    packageId: "pkg-1",
    storyboard: board,
    captionCues: cuesFor(board),
    ctaRoute: "/compare",
    mediaSha256: SHA,
    now: NOW,
  });

const approvals = (outcome: HumanGate["decision"] extends null ? never : "approved" | "rejected") =>
  Object.fromEntries(
    [...HUMAN_ONLY_DIMENSIONS, "audio-listening-review"].map((gate) => [gate, { by: "aaron", at: NOW.toISOString(), outcome }]),
  );

describe("buildContentCreativeReport human gates", () => {
  it("lists every human-only dimension plus the audio listening gate as undecided by default", () => {
    const report = buildContentCreativeReport({ review: reviewOf(storyboard), fingerprint, mediaSha256: SHA, now: NOW });
    const gates = report.humanGates.map((gate) => gate.gate);
    for (const dimension of HUMAN_ONLY_DIMENSIONS) expect(gates).toContain(dimension);
    expect(gates).toContain("audio-listening-review");
    expect(report.humanGates.every((gate) => gate.decision === null)).toBe(true);
  });

  it("refuses publishReady while any human gate is undecided, however high the score", () => {
    const review = reviewOf(storyboard);
    expect(review.productionQualityScore).toBeGreaterThan(8);
    const report = buildContentCreativeReport({ review, fingerprint, mediaSha256: SHA, now: NOW });
    expect(report.publishReady).toBe(false);
    expect(report.blockedBy.join(" ")).toContain("Human gate not decided");
  });

  it("refuses publishReady when a human gate was rejected, and names who rejected it", () => {
    const decisions = { ...approvals("approved"), "audio-listening-review": { by: "aaron", at: NOW.toISOString(), outcome: "rejected" as const } };
    const report = buildContentCreativeReport({ review: reviewOf(storyboard), fingerprint, mediaSha256: SHA, now: NOW, recordedHumanDecisions: decisions });
    expect(report.publishReady).toBe(false);
    expect(report.blockedBy.join(" ")).toContain("Human gate rejected: audio-listening-review (by aaron)");
  });

  it("allows publishReady only once every gate carries a recorded approval AND media exists", () => {
    const report = buildContentCreativeReport({ review: reviewOf(storyboard), fingerprint, mediaSha256: SHA, now: NOW, recordedHumanDecisions: approvals("approved") });
    expect(report.blockedBy).toEqual([]);
    expect(report.publishReady).toBe(true);
  });

  it("refuses publishReady when nothing was rendered, even with every approval recorded", () => {
    const report = buildContentCreativeReport({ review: reviewOf(storyboard), fingerprint, mediaSha256: null, now: NOW, recordedHumanDecisions: approvals("approved") });
    expect(report.publishReady).toBe(false);
    expect(report.blockedBy).toContain("No rendered media: nothing exists to publish.");
  });

  it("refuses publishReady while a blocking content failure stands", () => {
    const beats = storyboard.beats.map((entry, index) =>
      index === 1 ? { ...entry, narration: "We benchmarked both cards ourselves." } : entry,
    );
    const report = buildContentCreativeReport({
      review: reviewOf({ ...storyboard, beats }),
      fingerprint,
      mediaSha256: SHA,
      now: NOW,
      recordedHumanDecisions: approvals("approved"),
    });
    expect(report.publishReady).toBe(false);
    expect(report.blockedBy.join(" ")).toContain("unsupported-claim-verb");
  });
});

describe("buildContentCreativeReport reports absence as absence", () => {
  it("reports no published history rather than a zero performance score", () => {
    const report = buildContentCreativeReport({ review: reviewOf(storyboard), fingerprint, mediaSha256: SHA, now: NOW });
    expect(report.performance.status).toBe("no-published-history");
    expect(JSON.stringify(report.performance)).not.toContain("0");
    expect(report.performance.why).toMatch(/would assert a measured failure that never happened/);
  });

  it("counts machine-assessed and not-assessed dimensions separately", () => {
    const review = reviewOf(storyboard);
    const report = buildContentCreativeReport({ review, fingerprint, mediaSha256: SHA, now: NOW });
    expect(report.quality.measuredDimensions).toBe(review.overall.filter((entry) => entry.score !== null).length);
    expect(report.quality.notAssessedDimensions).toBe(review.overall.filter((entry) => entry.score === null).length);
    expect(report.quality.notAssessedDimensions).toBeGreaterThan(0);
  });
});

describe("buildContentCreativeReport carries revision lineage", () => {
  it("records each pass, its parent, and whether it was accepted", () => {
    const beats = storyboard.beats.map((entry, index) =>
      index === 2 ? { ...entry, onScreenText: "Pick the GPU before SpecSmith reveals the names: RTX 4080 Super vs RTX 4080" } : entry,
    );
    const repair = repairCreative({ creativeId: "creative-1", storyboard: { ...storyboard, beats }, review: reviewOf, ctaRoute: "/compare" });
    const report = buildContentCreativeReport({ review: repair.finalReview, fingerprint, repair, mediaSha256: SHA, now: NOW });

    expect(report.revisions.passes).toBe(repair.passes.length);
    expect(report.revisions.accepted + report.revisions.rejected).toBe(repair.passes.length);
    expect(report.identity.creativeId).toBe(repair.finalCreativeId);
    expect(report.identity.parentCreativeId).toBe("creative-1");
    expect(report.revisions.stoppedBecause).toBe(repair.stoppedBecause);
  });

  it("says 'no-repair-run' rather than implying a clean pass when repair never ran", () => {
    const report = buildContentCreativeReport({ review: reviewOf(storyboard), fingerprint, mediaSha256: SHA, now: NOW });
    expect(report.revisions.stoppedBecause).toBe("no-repair-run");
    expect(report.revisions.passes).toBe(0);
  });

  it("carries refusals through to the report rather than dropping them", () => {
    const beats = storyboard.beats.map((entry) => ({ ...entry, visualDirection: "the same shot" }));
    const repair = repairCreative({ creativeId: "creative-1", storyboard: { ...storyboard, beats }, review: reviewOf, ctaRoute: "/compare" });
    const report = buildContentCreativeReport({ review: repair.finalReview, fingerprint, repair, mediaSha256: SHA, now: NOW });
    expect(report.revisions.unrepairable.map((entry) => entry.dimension)).toContain("visual-repetition");
  });
});

describe("formatContentCreativeReport", () => {
  it("renders the blockers and the not-assessed count without hiding them", () => {
    const report = buildContentCreativeReport({ review: reviewOf(storyboard), fingerprint, mediaSha256: SHA, now: NOW });
    const text = formatContentCreativeReport(report);
    expect(text).toContain("publish ready:       false");
    expect(text).toContain("not machine-assessed:");
    expect(text).toContain("no-published-history");
    for (const blocker of report.blockedBy) expect(text).toContain(blocker);
  });
});
