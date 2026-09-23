import { describe, expect, it } from "vitest";
import { buildContentPackage } from "./contentPackage.ts";
import { allocateBeatWindows, assertNarrationFitsDuration, buildScriptStoryboardPackage } from "./scriptStoryboard.ts";
import { COMPARE_IDEA as COMPARE_IDEA_FOR_TEST } from "./compareIdeaFixture.ts";
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

describe("narration has to be speakable in the window it was given", () => {
  const beat = (purpose: string, words: number, startSecond: number, endSecond: number) => ({
    purpose,
    narration: Array.from({ length: words }, () => "word").join(" "),
    startSecond,
    endSecond,
  });

  it("catches the original defect: 90 words in a 24-second short", () => {
    // The real failure this exists for. 90 words is 32.7s at 165 wpm, and it
    // reached ffmpeg before anything noticed.
    expect(() => assertNarrationFitsDuration({
      platform: "youtube-shorts", targetDurationSeconds: 24, beats: [beat("hook", 90, 0, 24)],
    })).toThrow(/total narration needs 32\.7s but the script allots 24s/);
  });

  it("refuses to suggest stretching the clock", () => {
    expect(() => assertNarrationFitsDuration({
      platform: "youtube-shorts", targetDurationSeconds: 24, beats: [beat("hook", 90, 0, 24)],
    })).toThrow(/Shorten the copy; do not stretch the clock/);
  });

  it("catches a beat that overruns its OWN window even when the total fits", () => {
    // The check a total-only budget cannot make. 30 words is 10.9s; the whole
    // script fits 24s comfortably, but the hook carries three times what its
    // window holds and the voice never re-syncs with the pictures.
    expect(() => assertNarrationFitsDuration({
      platform: "youtube-shorts",
      targetDurationSeconds: 24,
      beats: [beat("hook", 30, 0, 3), beat("cta", 5, 3, 24)],
    })).toThrow(/hook needs 10\.9s in a 3s window/);
  });

  it("has NO authoring tolerance — a second over is over", () => {
    // An earlier version borrowed the compositor's 1.25x allowance as a
    // writing budget, which let every script be authored 25% too long by
    // default. The compositor's allowance is an emergency rendering guard and
    // stays where it was.
    const wordsFor = (seconds: number) => Math.round((seconds / 60) * 165);
    expect(() => assertNarrationFitsDuration({
      platform: "youtube-shorts", targetDurationSeconds: 24, beats: [beat("hook", wordsFor(25), 0, 24)],
    })).toThrow(/total narration needs/);
  });

  it("tolerates only the tenth-of-a-second the window grid is quantised to", () => {
    // 0.05s is arithmetic, not authoring: a twentieth of a syllable.
    expect(() => assertNarrationFitsDuration({
      platform: "youtube-shorts", targetDurationSeconds: 24, beats: [beat("hook", 11, 0, 4)],
    })).not.toThrow();
  });

  it("accepts the shortened COMPARE storyboard", () => {
    const script = buildScriptStoryboardPackage(COMPARE_IDEA_FOR_TEST, buildContentPackage(COMPARE_IDEA_FOR_TEST, new Date("2026-09-23T00:00:00Z")))
      .scripts.find((entry) => entry.platform === "youtube-shorts");
    expect(script).toBeDefined();
    expect(() => assertNarrationFitsDuration(script!)).not.toThrow();
  });
});

describe("beat windows are sized by what each beat says", () => {
  it("gives the hook room for a hook line instead of a fixed two seconds", () => {
    // The fixed 2/4/6/6/4/2 layout gave the hook 2s and the CTA 2s, and both
    // carry idea-supplied copy of eight to fourteen words. Two seconds holds
    // about five. No hook ever fitted its own window.
    const windows = allocateBeatWindows(
      ["a ".repeat(14).trim(), "b ".repeat(4).trim(), "c ".repeat(4).trim()],
      24,
    );
    expect(windows[0].endSecond - windows[0].startSecond).toBeGreaterThan(2);
  });

  it("keeps the total runtime exactly what the platform asked for", () => {
    // This is the difference from the rescaling that was removed: the budget
    // is divided, never extended.
    for (const total of [24, 26, 30]) {
      const windows = allocateBeatWindows(["one two three", "four", "five six", "seven eight nine ten"], total);
      expect(windows[windows.length - 1].endSecond).toBeCloseTo(total, 6);
    }
  });

  it("keeps the timeline contiguous and in order", () => {
    const windows = allocateBeatWindows(["a", "b b b", "c c", "d"], 24);
    expect(windows[0].startSecond).toBe(0);
    for (let index = 1; index < windows.length; index += 1) {
      expect(windows[index].startSecond).toBe(windows[index - 1].endSecond);
      expect(windows[index].endSecond).toBeGreaterThan(windows[index].startSecond);
    }
  });

  it("produces windows on a clean tenth-of-a-second grid", () => {
    // Accumulating 0.1 floats drifts within six beats — enough to make a
    // window read 1.4000000000000004s and miss its own allocation.
    const windows = allocateBeatWindows(["a", "b b", "c c c", "d", "e e", "f"], 24);
    for (const window of windows) {
      expect(Number.isInteger(Math.round(window.startSecond * 10))).toBe(true);
      expect(window.endSecond * 10).toBeCloseTo(Math.round(window.endSecond * 10), 9);
    }
  });

  it("splits evenly when nothing has anything to say", () => {
    const windows = allocateBeatWindows(["", "", ""], 24);
    expect(windows[windows.length - 1].endSecond).toBeCloseTo(24, 6);
  });
});
