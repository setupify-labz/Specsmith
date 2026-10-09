// The voiced cut is timed to the saved take: the turn, the held back view,
// the zoom, the flip and the light-up follow Liam's line timings, each caption
// starts with its line, the switch changes on the flip frame, and the sounds
// sit on the events they mark without overlapping.

import { describe, expect, it } from "vitest";

import { soundCuesFor, timingFromTake, VOICE_OFFSET_SECONDS } from "./finalCut.ts";
import { loadPowerSwitchTake } from "./liamTake.ts";
import { validateCues } from "../soundEffects.ts";
import { APPROVED_POWER_SWITCH_LINES } from "./script.ts";
import { join } from "node:path";

const takeDir = join(import.meta.dirname, "take");

describe("timing from the saved take", () => {
  it("loads the one approved take, bytes checked", async () => {
    const take = await loadPowerSwitchTake(takeDir);
    expect(take.sha256).toBe("1aabe1884ccbe2f51aba32b0de310f6eb7ffaad2c8ad94facfc3495e70d20b85");
    expect(take.lineTimings.map((line) => line.id)).toEqual(["hook", "where", "off", "on"]);
  });

  it("puts every event on Liam's words, and each caption on its line", async () => {
    const { lineTimings } = await loadPowerSwitchTake(takeDir);
    const timing = timingFromTake(lineTimings);
    const at = (id: string) => lineTimings.find((line) => line.id === id)!.start + VOICE_OFFSET_SECONDS;
    // The case has turned before "Check the switch…", the zoom has landed before "O is off.", the switch flips on "I".
    expect(timing.turn1[1]).toBeLessThanOrEqual(at("where"));
    expect(timing.zoomIn[1]).toBeLessThanOrEqual(at("off"));
    expect(timing.flip).toBeCloseTo(at("on"), 3);
    // The back of the PC is held long enough to place the switch.
    expect(timing.backHold[1] - timing.backHold[0]).toBeGreaterThan(1);
    // The lit PC holds after the last word.
    const lastWord = lineTimings.at(-1)!.end + VOICE_OFFSET_SECONDS;
    expect(timing.light).toBeGreaterThan(lastWord);
    expect(timing.durationSeconds - timing.light).toBeGreaterThanOrEqual(1.7);
    expect(timing.captions.map((caption) => caption.text)).toEqual(APPROVED_POWER_SWITCH_LINES.map((line) => line.spoken));
    expect(timing.captions[2].from).toBeCloseTo(at("off"), 3);
    expect(timing.captions[3].from).toBe(timing.flip);
    for (let i = 1; i < timing.captions.length; i += 1) expect(timing.captions[i].from).toBe(timing.captions[i - 1].to);
  });

  it("places one sound on each press, the flip and the light-up, none overlapping", async () => {
    const timing = timingFromTake((await loadPowerSwitchTake(takeDir)).lineTimings);
    const cues = soundCuesFor(timing);
    expect(cues.map((cue) => [cue.kind, cue.atSecond])).toEqual([["click", timing.press1], ["click", timing.flip], ["click", timing.press2], ["startup", timing.light]]);
    expect(() => validateCues(cues, timing.durationSeconds)).not.toThrow();
  });

  it("refuses a take whose lines leave no room to stage the turn and the flip", () => {
    const crowded = [
      { id: "hook", start: 0, end: 1 }, { id: "where", start: 1.1, end: 1.6 }, { id: "off", start: 1.7, end: 2 }, { id: "on", start: 2.1, end: 2.5 },
    ] as const;
    expect(() => timingFromTake(crowded)).toThrow(/too close together/);
  });
});
