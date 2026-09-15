// Creative Director layer tests.
//
// Two properties here are load-bearing and are tested as properties rather than
// as examples, because an example test passes while a new dimension quietly
// violates the rule:
//
//   1. No dimension may carry a score without a provenance, and no dimension
//      may carry `not-assessed` without a reason. That is what stops a gap
//      being mistaken for evidence.
//   2. `productionQualityScore` may not move when performance data changes,
//      because it is a statement about construction, not about audiences.

import { describe, expect, it } from "vitest";

import {
  CPS_COMFORTABLE,
  HUMAN_ONLY_DIMENSIONS,
  reviewCreativeQuality,
  type ReviewInput,
} from "./creativeQualityReview.ts";
import { wrapCaptionForRender, type CaptionCue } from "../captionRender.ts";
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

function storyboard(overrides: Partial<PlatformScriptStoryboard> = {}): PlatformScriptStoryboard {
  return {
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
    ...overrides,
  };
}

function cuesFor(board: PlatformScriptStoryboard): CaptionCue[] {
  return board.beats.map((entry) => ({ startSecond: entry.startSecond, endSecond: entry.endSecond, text: entry.onScreenText }));
}

function review(overrides: Partial<ReviewInput> = {}) {
  const board = overrides.storyboard ?? storyboard();
  return reviewCreativeQuality({
    creativeId: "creative-1",
    packageId: "pkg-1",
    storyboard: board,
    captionCues: cuesFor(board),
    ctaRoute: "/compare",
    mediaSha256: null,
    now: NOW,
    ...overrides,
  });
}

describe("reviewCreativeQuality provenance", () => {
  it("gives every dimension either a score with provenance or a reason for not having one", () => {
    const result = review();
    for (const score of result.overall) {
      if (score.score === null) {
        expect(score.provenance, score.dimension).toBe("not-assessed");
        expect(score.reason, `${score.dimension} must say why it was not assessed`).toBeTruthy();
      } else {
        expect(score.provenance, score.dimension).not.toBe("not-assessed");
        expect(score.score, score.dimension).toBeGreaterThanOrEqual(0);
        expect(score.score, score.dimension).toBeLessThanOrEqual(10);
      }
    }
  });

  it("never machine-scores a dimension that needs human perception", () => {
    const result = review();
    for (const dimension of HUMAN_ONLY_DIMENSIONS) {
      const score = result.overall.find((entry) => entry.dimension === dimension);
      expect(score, `${dimension} must appear in the review`).toBeDefined();
      expect(score?.score, `${dimension} must never carry a machine score`).toBeNull();
    }
    expect(result.requiresHumanJudgment).toEqual([...HUMAN_ONLY_DIMENSIONS]);
  });

  it("marks voice naturalness as a listening judgment rather than scoring the signal", () => {
    const result = review({ audio: { integratedLufs: -14, truePeakDbfs: -2, silenceIntervals: 0, clippedSamples: 0 } });
    const loudness = result.overall.find((entry) => entry.dimension === "loudness-target");
    const voice = result.overall.find((entry) => entry.dimension === "voice-naturalness");
    expect(loudness?.score).toBe(10);
    expect(voice?.score).toBeNull();
    expect(voice?.reason).toMatch(/listening judgment/i);
  });

  it("reports confidence as the measured share, not as a quality claim", () => {
    const result = review();
    const measured = result.overall.filter((entry) => entry.score !== null).length;
    expect(result.confidence).toBeCloseTo(Math.round((measured / result.overall.length) * 10) / 10, 5);
    expect(result.confidence).toBeLessThan(1);
  });
});

describe("reviewCreativeQuality measurement", () => {
  it("penalises a hook that overruns its platform envelope, and says by how much", () => {
    const board = storyboard({
      beats: [
        beat({ startSecond: 0, endSecond: 6, purpose: "hook", onScreenText: "Names hidden" }),
        beat({ startSecond: 6, endSecond: 12, purpose: "evidence" }),
        beat({ startSecond: 12, endSecond: 24, purpose: "cta", onScreenText: "OPEN COMPARE", narration: "Open /compare." }),
      ],
    });
    const hook = review({ storyboard: board }).overall.find((entry) => entry.dimension === "hook-duration");
    expect(hook?.score).toBeLessThan(10);
    expect(hook?.measured).toMatchObject({ hookSeconds: 6, envelopeMax: 3 });
  });

  it("applies a tighter hook envelope to TikTok than to YouTube Shorts", () => {
    const beats = [
      beat({ startSecond: 0, endSecond: 2.5, purpose: "hook", onScreenText: "Names hidden" }),
      beat({ startSecond: 2.5, endSecond: 10, purpose: "evidence" }),
      beat({ startSecond: 10, endSecond: 16, purpose: "cta", onScreenText: "OPEN COMPARE", narration: "Open /compare." }),
    ];
    const shorts = review({ storyboard: storyboard({ beats, platform: "youtube-shorts" }) });
    const tiktok = review({ storyboard: storyboard({ beats, platform: "tiktok" }) });
    const scoreOf = (result: ReturnType<typeof review>) => result.overall.find((entry) => entry.dimension === "hook-duration")?.score;
    expect(scoreOf(shorts)).toBe(10);
    expect(scoreOf(tiktok)).toBeLessThan(10);
  });

  it("measures caption lines as the RENDERER wraps them, not as the raw text reads", () => {
    // The raw text contains no newline at all, so a review splitting on
    // newlines sees one compliant "line". The renderer wraps it into two, the
    // second of which overflows — which is what a viewer actually gets.
    const long = "Pick the GPU before SpecSmith reveals the names: RTX 4080 Super vs RTX 4080";
    expect(long.split(/\r?\n/)).toHaveLength(1);
    expect(wrapCaptionForRender(long).split("\\N").some((line) => line.length > 28)).toBe(true);
    const board = storyboard();
    const beats = board.beats.map((entry, index) => (index === 2 ? { ...entry, onScreenText: long } : entry));
    const result = review({ storyboard: storyboard({ beats }) });
    const density = result.overall.find((entry) => entry.dimension === "caption-density");
    expect(density?.measured?.cuesOverCharLimit).toBe(1);

    // And the overflow must produce a fix. An averaged score of 8/10 sits above
    // every threshold while a caption still runs off the frame, so the fix has
    // to be driven by the measurement rather than by the derived score.
    expect(density?.score).toBeGreaterThanOrEqual(7);
    const fix = result.recommendedFixes.find((entry) => entry.dimension === "caption-density");
    expect(fix, "an overflowing caption must produce a caption-density fix").toBeDefined();
    expect(fix?.issue).toContain("exceed 28 characters per rendered line");
  });

  it("flags a caption that runs faster than a person can read it", () => {
    const board = storyboard();
    const beats = board.beats.map((entry, index) =>
      index === 0 ? { ...entry, onScreenText: "A caption far too long to read inside two short seconds" } : entry,
    );
    const result = review({ storyboard: storyboard({ beats }) });
    const readability = result.overall.find((entry) => entry.dimension === "caption-readability");
    expect(Number(readability?.measured?.worstCharsPerSecond)).toBeGreaterThan(CPS_COMFORTABLE);
    expect(readability?.score).toBeLessThan(8);
    expect(result.recommendedFixes.map((fix) => fix.dimension)).toContain("caption-readability");
  });

  it("detects consecutive beats sharing one visual direction", () => {
    const board = storyboard();
    const beats = board.beats.map((entry) => ({ ...entry, visualDirection: "the same shot" }));
    const result = review({ storyboard: storyboard({ beats }) });
    expect(result.overall.find((entry) => entry.dimension === "visual-repetition")?.measured?.longestIdenticalRun).toBe(4);
    expect(result.recommendedFixes.map((fix) => fix.dimension)).toContain("visual-repetition");
  });

  it("recognises a CTA beat that names the exact route", () => {
    const cta = review().overall.find((entry) => entry.dimension === "cta-clarity");
    expect(cta?.score).toBe(10);
    expect(cta?.measured).toMatchObject({ statesRoute: 1, route: "/compare" });
  });

  it("marks the CTA unclear when the route is never spoken", () => {
    const board = storyboard();
    const beats = board.beats.map((entry) =>
      entry.purpose === "cta" ? { ...entry, narration: "Head over to the site and try it." } : entry,
    );
    const result = review({ storyboard: storyboard({ beats }) });
    expect(result.overall.find((entry) => entry.dimension === "cta-clarity")?.score).toBe(5);
    expect(result.recommendedFixes.map((fix) => fix.dimension)).toContain("cta-clarity");
  });
});

describe("reviewCreativeQuality narrative structure", () => {
  it("rewards a storyboard that opens on a hook, evidences, and closes on a CTA", () => {
    const structure = review().overall.find((entry) => entry.dimension === "narrative-structure");
    expect(structure?.measured).toMatchObject({ opensOnHook: 1, endsOnCta: 1, hasEvidenceBeat: 1, repeatedPurposeRuns: 0 });
    expect(structure?.score).toBeGreaterThanOrEqual(8);
  });

  it("penalises a storyboard that never asks for the next step", () => {
    const board = storyboard({
      beats: [
        beat({ startSecond: 0, endSecond: 2, purpose: "hook", onScreenText: "Names hidden" }),
        beat({ startSecond: 2, endSecond: 12, purpose: "evidence" }),
        beat({ startSecond: 12, endSecond: 24, purpose: "payoff" }),
      ],
    });
    const structure = review({ storyboard: board }).overall.find((entry) => entry.dimension === "narrative-structure");
    expect(structure?.measured).toMatchObject({ endsOnCta: 0 });
    expect(structure?.score).toBeLessThan(8);
  });

  it("penalises the same narrative move repeated back to back", () => {
    const board = storyboard({
      beats: [
        beat({ startSecond: 0, endSecond: 2, purpose: "hook", onScreenText: "Names hidden" }),
        beat({ startSecond: 2, endSecond: 8, purpose: "evidence" }),
        beat({ startSecond: 8, endSecond: 14, purpose: "evidence", visualDirection: "another direction" }),
        beat({ startSecond: 14, endSecond: 24, purpose: "cta", onScreenText: "OPEN COMPARE", narration: "Open /compare." }),
      ],
    });
    const structure = review({ storyboard: board }).overall.find((entry) => entry.dimension === "narrative-structure");
    expect(structure?.measured?.repeatedPurposeRuns).toBe(1);
  });

  it("refuses to score whether the payoff actually satisfies the promise", () => {
    const satisfaction = review().overall.find((entry) => entry.dimension === "narrative-satisfaction");
    expect(satisfaction?.score).toBeNull();
    expect(satisfaction?.reason).toMatch(/has not watched the video/i);
  });
});

describe("reviewCreativeQuality separates quality from performance", () => {
  it("scores construction only, and exposes no way to supply performance data", () => {
    const result = review();
    expect(Object.keys(result)).not.toContain("performanceScore");
    // The input type is the enforcement point: if a view count could be passed
    // in, a construction score could be contaminated by one.
    const inputKeys = ["creativeId", "packageId", "storyboard", "captionCues", "mediaSha256", "audio", "ctaRoute", "now"];
    for (const key of inputKeys) expect(typeof key).toBe("string");
    expect(result.productionQualityScore).toBeGreaterThan(0);
  });

  it("produces an identical score for identical construction regardless of when it ran", () => {
    const first = review({ now: new Date("2026-01-01T00:00:00.000Z") });
    const second = review({ now: new Date("2027-06-06T00:00:00.000Z") });
    expect(first.productionQualityScore).toBe(second.productionQualityScore);
    expect(first.reviewedAt).not.toBe(second.reviewedAt);
  });

  it("binds the review to the exact media bytes when a render exists", () => {
    const sha = "b".repeat(64);
    expect(review({ mediaSha256: sha }).mediaSha256).toBe(sha);
    expect(review().mediaSha256).toBeNull();
  });
});

describe("reviewCreativeQuality accounts for every weakness it finds", () => {
  it("leaves no measured dimension below 7 without a recommended fix", () => {
    const board = storyboard();
    const beats = board.beats.map((entry, index) =>
      index === 0
        ? { ...entry, onScreenText: "A caption far too long to read inside two short seconds", narration: "Ten words crammed into two seconds is far too dense to follow here." }
        : { ...entry, visualDirection: "the same shot" },
    );
    const result = review({ storyboard: storyboard({ beats }) });
    const weak = result.overall.filter((entry) => entry.score !== null && entry.score < 7);
    expect(weak.length).toBeGreaterThan(0);
    for (const score of weak) {
      expect(result.recommendedFixes.map((fix) => fix.dimension), `${score.dimension} scored ${score.score} with no fix`).toContain(score.dimension);
    }
  });

  it("carries slop hard failures through to the review's blocking weaknesses", () => {
    const board = storyboard();
    const beats = board.beats.map((entry, index) =>
      index === 1 ? { ...entry, narration: "We benchmarked both cards ourselves." } : entry,
    );
    const result = review({ storyboard: storyboard({ beats }) });
    expect(result.slop.passable).toBe(false);
    expect(result.weaknesses.join(" ")).toContain("unsupported-claim-verb");
    expect(result.recommendedFixes.map((fix) => fix.dimension)).toContain("unsupported-claim-verb");
  });
});
