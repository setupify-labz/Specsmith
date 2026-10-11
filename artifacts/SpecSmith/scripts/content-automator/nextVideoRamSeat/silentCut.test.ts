// The RAM-seating Short: its beats run problem, location, action, payoff in
// order; its frames are one contiguous, ordered sequence; its captions cover
// the whole cut; and its copy makes no forbidden claim.

import { describe, expect, it } from "vitest";

import { BEATS, COPY, copyProblems, FPS, frameNames, TIMING } from "./silentCut.ts";

describe("the RAM-seating silent Short", () => {
  it("tells the story in order, with power off before the case opens and back on before the retry", () => {
    expect(BEATS.map((b) => b.name)).toEqual(["problem", "power-off", "location", "action", "payoff", "power-back", "try-again"]);
    expect(BEATS[0].from).toBe(0);
    for (let i = 1; i < BEATS.length; i += 1) expect(BEATS[i].from).toBe(BEATS[i - 1].to);
    expect(BEATS.at(-1)!.to).toBe(TIMING.durationSeconds);
    const events = [TIMING.press, TIMING.light, ...TIMING.offPress, TIMING.fansOff[1], ...TIMING.toRear, ...TIMING.unplug, ...TIMING.toSide, ...TIMING.panelOff,
      ...TIMING.zoomSlots, ...TIMING.toProfile, ...TIMING.align, ...TIMING.lower, ...TIMING.thumbsIn, ...TIMING.press2, ...TIMING.thumbsOut, TIMING.seated,
      ...TIMING.toBoard, ...TIMING.panelOn, ...TIMING.toRearAgain, ...TIMING.plugIn, ...TIMING.toFront];
    expect([...events].sort((a, b) => a - b)).toEqual(events);
    // Unplugged before the panel comes off or anyone touches the RAM; plugged back in before "Then try booting again."
    expect(TIMING.unplug[1]).toBeLessThan(TIMING.panelOff[0]);
    expect(TIMING.plugIn[1]).toBeLessThanOrEqual(COPY.captions.find((c) => c.text === "Then try booting again.")!.from);
    // The clips snap while the stick is pressed home, not after.
    expect(TIMING.clips[0]).toBeGreaterThan(TIMING.press2[0]);
    expect(TIMING.clips[1]).toBeLessThanOrEqual(TIMING.press2[1] + 0.1);
  });

  it("writes its frames as one contiguous, ordered sequence the encoder reads in order", () => {
    const names = frameNames(Math.round(TIMING.durationSeconds * FPS));
    expect(names).toHaveLength(372);
    expect(names[0]).toBe("f-0000.png");
    expect(names.at(-1)).toBe("f-0371.png");
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
