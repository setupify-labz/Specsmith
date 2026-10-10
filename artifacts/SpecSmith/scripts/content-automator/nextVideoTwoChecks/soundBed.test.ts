// The background layer: silent through the dead-PC opening, a tone only under
// the voiceless glimpse, the fan only from the light-up, synthesized (no
// sample files), and well below the voice at its fixed gains.

import { describe, expect, it } from "vitest";

import { cutFromTake, V2_PROFILE } from "./finalCut.ts";
import { BED, bedSpans, bedTrackArgs } from "./soundBed.ts";
import { loadTwoChecksV2Take, type Alignment } from "./liamTakeV2.ts";
import { join } from "node:path";

describe("the background layer of the v2 cut", async () => {
  const take = await loadTwoChecksV2Take(join(import.meta.dirname, "takeV2"));
  const { timing } = cutFromTake(take.manifest.alignment as Alignment, V2_PROFILE);

  it("leaves the dead-PC opening bare and starts the fan only when the PC lights up", () => {
    const { tone, fan } = bedSpans(timing);
    expect(tone.from).toBe(timing.glimpse[0]);
    expect(tone.to).toBeLessThan(timing.light);
    expect(fan.from).toBe(timing.light);
    expect(fan.to).toBe(timing.durationSeconds);
  });

  it("is synthesized by ffmpeg, with no sample or music file as an input", () => {
    const args = bedTrackArgs(timing, "/tmp/bed.wav");
    expect(args).not.toContain("-i");
    expect(args.join(" ")).toMatch(/aevalsrc=.*anoisesrc=d=[\d.]+:c=brown/);
  });

  it("keeps its gains restrained (the tone under the glimpse well down; the fan band-limited, not hiss)", () => {
    expect(BED.tone.gainDb).toBeLessThanOrEqual(-15);
    expect(BED.fan.gainDb).toBeLessThanOrEqual(0);
    expect(BED.fan.highHz).toBeLessThanOrEqual(1000);
  });
});
