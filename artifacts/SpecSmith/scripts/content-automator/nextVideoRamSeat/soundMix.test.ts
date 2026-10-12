// The RAM-seating Short's sound: one cue per visible action, the clips snapping
// shut the loudest, everything below a future narration, and nothing that
// sounds like a PC booting.

import { describe, expect, it } from "vitest";

import { TIMING } from "./silentCut.ts";
import { cues, PEAK_DBFS, RECIPES } from "./soundMix.ts";

describe("the RAM-seating Short's sound effects", () => {
  const list = cues();
  it("puts each cue on its visible action, inside the cut", () => {
    for (const cue of list) { expect(cue.at).toBeGreaterThanOrEqual(0); expect(cue.at + cue.seconds).toBeLessThanOrEqual(TIMING.durationSeconds); }
    const at = (kind: string) => list.filter((c) => c.kind === kind).map((c) => c.at);
    expect(at("button")[0]).toBeCloseTo(TIMING.press, 2);
    expect(at("plug")[0]).toBeGreaterThanOrEqual(TIMING.unplug[0]);
    expect(at("plug")[0]).toBeLessThan(TIMING.unplug[1]);
    expect(at("plug")[1]).toBeGreaterThan(TIMING.plugIn[0]);
    expect(at("plug")[1]).toBeLessThanOrEqual(TIMING.plugIn[1]);
    for (const snap of at("snap")) expect(Math.abs(snap - TIMING.clips[1])).toBeLessThan(0.05);
    expect(at("tick")[0]).toBe(TIMING.align[1]);
  });
  it("makes the clips snapping shut the clearest cue, and keeps every cue below a -16 LUFS narration's peaks", () => {
    const others = Object.entries(PEAK_DBFS).filter(([kind]) => kind !== "snap").map(([, db]) => db);
    expect(PEAK_DBFS.snap).toBeGreaterThan(Math.max(...others) + 6);
    expect(PEAK_DBFS.snap).toBeLessThanOrEqual(-12);
  });
  it("has no whoosh, music or startup sound, and nothing after the cord goes back in", () => {
    expect(Object.keys(RECIPES).sort()).toEqual(["button", "fan", "plug", "snap", "tap", "tick"]);
    expect(Math.max(...list.map((c) => c.at))).toBeLessThanOrEqual(TIMING.plugIn[1]);
  });
});
