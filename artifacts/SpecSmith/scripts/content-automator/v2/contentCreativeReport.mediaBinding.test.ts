// publishReady may rest only on real rendered bytes and on human decisions made
// about THOSE bytes. Before this, any truthy string counted as "rendered media",
// and an approval recorded for one render counted for every later render.

import { describe, expect, it } from "vitest";

import { buildContentCreativeReport, type HumanGate } from "./contentCreativeReport.ts";
import { HUMAN_ONLY_DIMENSIONS, reviewCreativeQuality } from "./creativeQualityReview.ts";
import type { CaptionCue } from "../captionRender.ts";
import type { CreativeFingerprint, PlatformScriptStoryboard, StoryboardBeat } from "../types.ts";

const NOW = new Date("2026-09-14T00:00:00.000Z");
const SHA = "c".repeat(64);
const OTHER_SHA = "d".repeat(64);

const beat = (overrides: Partial<StoryboardBeat> & Pick<StoryboardBeat, "startSecond" | "endSecond" | "purpose">): StoryboardBeat => ({
  narration: "SpecSmith holds the rest of the build constant.",
  visualDirection: `unique direction ${overrides.startSecond}`,
  onScreenText: "REAL SPECS",
  factDependencies: [],
  ...overrides,
});

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

const fingerprint = { version: "creative-fingerprint-v1", creativeId: "creative-1", ideaId: "idea-1", campaignId: "campaign-1" } as unknown as CreativeFingerprint;
const cues = (board: PlatformScriptStoryboard): CaptionCue[] =>
  board.beats.map((entry) => ({ startSecond: entry.startSecond, endSecond: entry.endSecond, text: entry.onScreenText }));
const reviewOf = (mediaSha256: string | null) => reviewCreativeQuality({
  creativeId: "creative-1", packageId: "pkg-1", storyboard, captionCues: cues(storyboard), ctaRoute: "/compare", mediaSha256, now: NOW,
});
const GATES = [...HUMAN_ONLY_DIMENSIONS, "audio-listening-review"];
const approvals = (decision: Partial<NonNullable<HumanGate["decision"]>> = {}) =>
  Object.fromEntries(GATES.map((gate) => [gate, { by: "aaron", at: NOW.toISOString(), outcome: "approved", mediaSha256: SHA, ...decision }])) as
    Record<string, HumanGate["decision"]>;

describe("publishReady is bound to real rendered media", () => {
  it("is ready only for a real digest with every approval made about that digest", () => {
    const report = buildContentCreativeReport({ review: reviewOf(SHA), fingerprint, mediaSha256: SHA, now: NOW, recordedHumanDecisions: approvals() });
    expect(report.blockedBy).toEqual([]);
    expect(report.publishReady).toBe(true);
  });

  it("refuses a media value that is not a SHA-256 digest", () => {
    for (const fake of ["pending", "rendered", "x", "C".repeat(63)]) {
      const report = buildContentCreativeReport({ review: reviewOf(null), fingerprint, mediaSha256: fake, now: NOW, recordedHumanDecisions: approvals({ mediaSha256: fake }) });
      expect(report.publishReady, fake).toBe(false);
      expect(report.blockedBy.join(" "), fake).toMatch(/not a SHA-256 digest/);
    }
  });

  it("does not let an approval of one render count for another", () => {
    const stale = buildContentCreativeReport({ review: reviewOf(SHA), fingerprint, mediaSha256: SHA, now: NOW, recordedHumanDecisions: approvals({ mediaSha256: OTHER_SHA }) });
    expect(stale.publishReady).toBe(false);
    expect(stale.blockedBy.join(" ")).toMatch(/made about other media/);
    const unbound = buildContentCreativeReport({
      review: reviewOf(SHA), fingerprint, mediaSha256: SHA, now: NOW,
      recordedHumanDecisions: Object.fromEntries(GATES.map((gate) => [gate, { by: "aaron", at: NOW.toISOString(), outcome: "approved" }])) as Record<string, HumanGate["decision"]>,
    });
    expect(unbound.publishReady).toBe(false);
  });

  it("does not accept an anonymous, undated or future-dated approval", () => {
    for (const bad of [{ by: " " }, { at: "not a date" }, { at: new Date(NOW.getTime() + 86_400_000).toISOString() }]) {
      const report = buildContentCreativeReport({ review: reviewOf(SHA), fingerprint, mediaSha256: SHA, now: NOW, recordedHumanDecisions: approvals(bad) });
      expect(report.publishReady, JSON.stringify(bad)).toBe(false);
    }
  });

  it("refuses a quality review that measured different media from the one being reported", () => {
    const report = buildContentCreativeReport({ review: reviewOf(OTHER_SHA), fingerprint, mediaSha256: SHA, now: NOW, recordedHumanDecisions: approvals() });
    expect(report.publishReady).toBe(false);
    expect(report.blockedBy.join(" ")).toMatch(/quality review measured other media/);
  });
});
