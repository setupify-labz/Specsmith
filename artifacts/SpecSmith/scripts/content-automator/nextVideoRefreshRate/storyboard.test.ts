// The refresh-rate Short's copy guards: no specific higher rate without a
// recording that shows it, "144 Hz monitor" only for a display that offers
// exactly 144 Hz, no FPS-boost, fix-everything, every-monitor or
// SpecSmith-detects claims, and the edit's shape (hook at frame 0, 12–15 s).

import { describe, expect, it } from "vitest";

import {
  allCopy, captions, copyProblems, DURATION_SECONDS, FORBIDDEN_CLAIMS, higherRateLabel, hookCaption, PROPOSED_NARRATION,
  PROPOSED_NARRATION_TEXT, storyProblems, type Footage,
} from "./storyboard.ts";

const recording = (offeredHz: number[]): Footage => ({
  path: "x.mp4", sha256: "0".repeat(64), recordedOn: "2026-10-09", windowsVersion: "Windows 11", monitorModel: "Example", offeredHz,
});

describe("the story as configured (no recording yet)", () => {
  it("has no problems, and names no rate but 60 Hz anywhere", () => {
    expect(storyProblems(null)).toEqual([]);
    for (const text of allCopy(null)) expect(text).not.toMatch(/\b(?!60\b)\d{2,3}\s*(hz|hertz)\b/i);
  });

  it("uses the generic hook and a placeholder for the higher rate", () => {
    expect(hookCaption(null)).toBe("High-refresh monitor. Still set to 60 Hz?");
    expect(higherRateLabel(null)).toBe("Higher rate");
  });

  it("puts the hook on screen from frame 0 and holds captions, without gaps, to the end of a 12–15 s cut", () => {
    const list = captions(null);
    expect(list[0]).toMatchObject({ startSecond: 0, hook: true });
    expect(list.at(-1)).toMatchObject({ endSecond: DURATION_SECONDS, text: "What was yours set to?" });
    expect(DURATION_SECONDS).toBeGreaterThanOrEqual(12);
    expect(DURATION_SECONDS).toBeLessThanOrEqual(15);
  });

  it("proposes narration that fits before the end, with its exact length recorded", () => {
    expect(PROPOSED_NARRATION_TEXT).toBe("Your high-refresh monitor might still be set to sixty hertz. Open Advanced display, select your monitor, then choose the higher rate it supports. What was yours set to?");
    expect(PROPOSED_NARRATION_TEXT.length).toBe(168);
    expect(PROPOSED_NARRATION.at(-1)!.plannedStartSecond).toBeLessThan(DURATION_SECONDS - 2);
  });
});

describe("a recording decides the rate and the hook", () => {
  it("says 144 Hz only when the recorded display offers exactly that", () => {
    expect(hookCaption(recording([60, 144]))).toBe("144 Hz monitor. Still set to 60?");
    expect(hookCaption(recording([60, 120, 165]))).toBe("High-refresh monitor. Still set to 60 Hz?");
    expect(hookCaption(recording([60, 100, 120, 144, 165]))).toBe("High-refresh monitor. Still set to 60 Hz?");
    expect(higherRateLabel(recording([60, 120, 165]))).toBe("165 Hz");
    expect(storyProblems(recording([60, 144]))).toEqual([]);
  });

  it("refuses a recording that does not show both 60 Hz and a higher rate", () => {
    expect(() => higherRateLabel(recording([144]))).toThrow(/both 60 Hz and a higher rate/);
    expect(() => higherRateLabel(recording([60]))).toThrow(/both 60 Hz and a higher rate/);
  });

  it("refuses copy naming a rate the recording did not show", () => {
    expect(copyProblems(["Switch to 144 Hz"], null)).toHaveLength(1);
    expect(copyProblems(["Switch to 144 Hz"], recording([60, 165]))).toHaveLength(1);
    expect(copyProblems(["Switch to 165 Hz"], recording([60, 165]))).toEqual([]);
  });
});

describe("forbidden claims", () => {
  const bad = [
    "This boosts your FPS",
    "More FPS in every game",
    "Your FPS will jump",
    "This fixes every display problem",
    "Every monitor supports 144 Hz",
    "All gaming monitors can do this",
    "SpecSmith detects your refresh rate",
    "Feel the difference instantly",
  ];
  for (const sentence of bad) {
    it(`refuses "${sentence}"`, () => {
      expect(copyProblems([sentence], recording([60, 144])).length).toBeGreaterThan(0);
    });
  }

  it("allows the payoff note and every line of the story", () => {
    for (const text of allCopy(null)) for (const { pattern } of FORBIDDEN_CLAIMS) expect(text).not.toMatch(pattern);
  });
});
