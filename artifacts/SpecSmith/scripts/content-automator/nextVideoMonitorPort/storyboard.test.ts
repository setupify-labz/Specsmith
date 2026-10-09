// The monitor-port Short's guards: no outcome without a verified PC record,
// NO SIGNAL only as this PC's observed result and never as universal, no FPS,
// percentage, bottleneck or performance-loss claim without measurement, no
// "your GPU is wasted", the hook from frame 0 and the instruction at the end.

import { describe, expect, it } from "vitest";

import {
  allCopy, beats, copyProblems, DURATION_SECONDS, finalCutProblems, proposedNarration, storyProblems,
  type PcRecord,
} from "./storyboard.ts";

const record = (motherboardShowed: string, igpu = true): PcRecord => ({
  cpu: "Example CPU", motherboard: "Example board", gpu: "Example GPU", cpuHasIntegratedGraphics: igpu, firmwareIntegratedGraphics: "Auto",
  motherboardPort: { monitorShowed: motherboardShowed, displayAdapter: null, footage: { path: "mb.mp4", sha256: "0".repeat(64) } },
  graphicsCardPort: { monitorShowed: "the Windows desktop", displayAdapter: "Example GPU", footage: { path: "gpu.mp4", sha256: "1".repeat(64) } },
  measuredPerformance: null,
});

describe("the animated cut", () => {
  it("renders, opens on the hook, ends on the closing line, inside 8–10 s", () => {
    expect(storyProblems(null)).toEqual([]);
    expect(beats(null)[0]).toMatchObject({ startSecond: 0, caption: "Bought a graphics card. Is your monitor plugged into it?" });
    expect(beats(null).at(-1)).toMatchObject({ endSecond: DURATION_SECONDS, caption: "Check where your monitor cable goes." });
    expect(DURATION_SECONDS).toBeGreaterThanOrEqual(8);
    expect(DURATION_SECONDS).toBeLessThanOrEqual(10);
  });

  it("shows no result scene and says no outcome: no placeholder, no NO SIGNAL, no FPS", () => {
    expect(beats(null).map((beat) => beat.id)).toEqual(["hook", "motherboard", "graphics-card", "close"]);
    for (const text of allCopy(null)) expect(text).not.toMatch(/result|no signal|fps|on this pc/i);
  });

  it("is not a final footage cut until the PC and both connections are recorded", () => {
    expect(finalCutProblems(null)).toHaveLength(1);
    expect(finalCutProblems(record("the Windows desktop"))).toEqual([]);
  });

  it("proposes narration short enough for the cut", () => {
    expect(proposedNarration(null)).toBe("Bought a graphics card? Is your monitor plugged into it? Use the ports down here, on the card. Check where yours goes.");
    expect(proposedNarration(null).length).toBe(118);
  });
});

describe("NO SIGNAL is an observation, not a rule", () => {
  it("is refused when no PC showed it", () => {
    expect(copyProblems(["Motherboard port: NO SIGNAL"], null)).toHaveLength(1);
    expect(copyProblems(["On this PC: NO SIGNAL"], record("the Windows desktop"))).toHaveLength(1);
  });

  it("is allowed only as this PC's observed result", () => {
    expect(copyProblems(["On this PC: NO SIGNAL"], record("NO SIGNAL message"))).toEqual([]);
    expect(copyProblems(["Motherboard ports give NO SIGNAL"], record("NO SIGNAL message"))).toHaveLength(1);
  });

  it("flags a record whose CPU has no integrated graphics yet showed a picture", () => {
    expect(finalCutProblems(record("the Windows desktop", false)).join()).toMatch(/no integrated graphics/);
  });
});

describe("no performance claims without measurement", () => {
  const bad = [
    "Get 40% more FPS", "Up to 60 fps more", "You're losing performance", "More frames on the graphics card", "FPS will jump",
    "Your CPU is the bottleneck", "Your GPU is wasted", "Windows isn't using your graphics card", "This always happens", "SpecSmith checks your ports",
  ];
  for (const sentence of bad) it(`refuses "${sentence}"`, () => expect(copyProblems([sentence], null).length).toBeGreaterThan(0));

  it("passes every line the Short shows or says", () => {
    expect(copyProblems(allCopy(null), null)).toEqual([]);
    expect(copyProblems(allCopy(record("NO SIGNAL message")), record("NO SIGNAL message"))).toEqual([]);
  });
});
