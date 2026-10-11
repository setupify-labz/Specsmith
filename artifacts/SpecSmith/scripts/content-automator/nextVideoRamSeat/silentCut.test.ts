// The RAM-seating Short: its beats run problem, location, action, payoff in
// order; its frames are one contiguous, ordered sequence; its captions cover
// the whole cut; and its copy makes no forbidden claim.

import { describe, expect, it } from "vitest";

import { BEATS, COPY, copyProblems, FPS, frameNames, TIMING } from "./silentCut.ts";

describe("the RAM-seating silent Short", () => {
  it("tells the story in order: problem, location, action, payoff, with no gap", () => {
    expect(BEATS.map((b) => b.name)).toEqual(["problem", "location", "action", "payoff"]);
    expect(BEATS[0].from).toBe(0);
    for (let i = 1; i < BEATS.length; i += 1) expect(BEATS[i].from).toBe(BEATS[i - 1].to);
    expect(BEATS.at(-1)!.to).toBe(TIMING.durationSeconds);
    const events = [TIMING.press, TIMING.light, ...TIMING.toSide, ...TIMING.panelOff, ...TIMING.zoomSlots, TIMING.flag, ...TIMING.toProfile,
      ...TIMING.align, ...TIMING.lower, ...TIMING.thumbsIn, ...TIMING.press2, ...TIMING.thumbsOut, TIMING.seated, ...TIMING.toBoard];
    expect([...events].sort((a, b) => a - b)).toEqual(events);
    // The clips snap while the stick is pressed home, not after.
    expect(TIMING.clips[0]).toBeGreaterThan(TIMING.press2[0]);
    expect(TIMING.clips[1]).toBeLessThanOrEqual(TIMING.press2[1] + 0.1);
  });

  it("writes its frames as one contiguous, ordered sequence the encoder reads in order", () => {
    const names = frameNames(Math.round(TIMING.durationSeconds * FPS));
    expect(names).toHaveLength(390);
    expect(names[0]).toBe("f-0000.png");
    expect(names.at(-1)).toBe("f-0389.png");
    expect([...names].sort()).toEqual(names);
  });

  it("captions the whole cut and makes no forbidden claim", () => {
    expect(COPY.captions[0].from).toBe(0);
    for (let i = 1; i < COPY.captions.length; i += 1) expect(COPY.captions[i].from).toBe(COPY.captions[i - 1].to);
    expect(COPY.captions.at(-1)!.to).toBe(TIMING.durationSeconds);
    expect(copyProblems()).toEqual([]);
    expect(COPY.sources[0]).toMatch(/crucial\.com\/support\/install-memory-desktop/);
  });
});
