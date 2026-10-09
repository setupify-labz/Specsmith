// The combined "two spots" Short: its copy passes the monitor-port Short's
// forbidden-claim rules (no universal NO SIGNAL, no FPS figure, no guaranteed
// fix), its beats run in the asked order inside 12-15 s, and the proposed
// narration fits the cut.

import { describe, expect, it } from "vitest";

import { comboCopyProblems, COPY, PROPOSED_NARRATION, TIMING } from "./comboDraft.ts";

describe("the two-spots Short", () => {
  it("makes no forbidden claim in any caption, chapter, label or the narration", () => {
    expect(comboCopyProblems()).toEqual([]);
    for (const bad of ["Motherboard ports give no signal", "Get 30 more FPS", "This always fixes it"]) expect(comboCopyProblems([bad]).length).toBeGreaterThan(0);
  });

  it("opens on the dead press, then the glimpse, inside the first ~1.1 s", () => {
    expect(TIMING.press1).toBeLessThan(0.3);
    expect(TIMING.glimpse[0]).toBeGreaterThan(TIMING.press1 + 0.25);
    expect(TIMING.glimpse[1]).toBeLessThanOrEqual(1.1);
    expect(COPY.labels).toMatchObject({ noPower: "NO POWER?", noPicture: "ON, NO PICTURE?" });
  });

  it("runs dead press, switch, power-on, then the cable move, inside 12–15 s", () => {
    expect(TIMING.durationSeconds).toBeGreaterThanOrEqual(12);
    expect(TIMING.durationSeconds).toBeLessThanOrEqual(15);
    const order = [TIMING.press1, TIMING.glimpse[0], TIMING.glimpse[1], TIMING.turn1[0], TIMING.flip, TIMING.light, TIMING.pull, TIMING.seated, TIMING.final];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(TIMING.turn3[0]).toBeGreaterThan(TIMING.light);
  });

  it("keeps captions continuous from frame one to the end, opening on the title line", () => {
    expect(COPY.captions[0]).toMatchObject({ from: 0, text: "New PC not working? Check these two spots." });
    for (let i = 1; i < COPY.captions.length; i += 1) expect(COPY.captions[i].from).toBe(COPY.captions[i - 1].to);
    expect(COPY.captions.at(-1)!.to).toBe(TIMING.durationSeconds);
  });

  it("proposes narration that fits the cut at the saved takes' pace", () => {
    expect(PROPOSED_NARRATION.length / 13.5).toBeLessThan(TIMING.durationSeconds - 0.5);
  });
});
