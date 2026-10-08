// Synthesized sound effects: one at a time, inside the video, deterministic,
// and at the restrained levels the module promises once mixed.

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SOUND_MIX_GAIN, SOUND_PEAKS_AS_MIXED_DBFS, SOUND_RECIPES, soundTrackArgs, validateCues, type SoundCue } from "./soundEffects.ts";

const ffmpeg = (args: string[]) => {
  const result = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (result.error) throw new Error(`ffmpeg could not run: ${result.error.message}. These tests need ffmpeg installed.`);
  return result;
};

describe("cues", () => {
  it("refuse overlapping sounds and sounds past the end", () => {
    expect(() => validateCues([{ atSecond: 1, kind: "whoosh", reason: "a" }, { atSecond: 1.1, kind: "pop", reason: "b" }], 5)).toThrow(/overlap/);
    expect(() => validateCues([{ atSecond: 4.9, kind: "whoosh", reason: "late" }], 5)).toThrow(/past the end/);
    expect(() => validateCues([{ atSecond: -0.1, kind: "tick", reason: "early" }], 5)).toThrow();
  });
});

describe("the synthesized track", () => {
  it("puts each effect at its intended peak once mixed, within a decibel", () => {
    for (const [kind, recipe] of Object.entries(SOUND_RECIPES) as [keyof typeof SOUND_RECIPES, (typeof SOUND_RECIPES)["tick"]][]) {
      const out = ffmpeg(["-hide_banner", "-f", "lavfi", "-i", recipe.chain(101), "-af", "volumedetect", "-f", "null", "-"]).stderr;
      const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(out)?.[1]);
      expect(Math.abs(peak + 20 * Math.log10(SOUND_MIX_GAIN) - SOUND_PEAKS_AS_MIXED_DBFS[kind])).toBeLessThan(1);
    }
  });

  it("is the same bytes for the same cues, and silent between them", () => {
    const dir = mkdtempSync(join(tmpdir(), "sfx-"));
    try {
      const cues: SoundCue[] = [{ atSecond: 0.5, kind: "whoosh", reason: "cut" }, { atSecond: 1.2, kind: "pop", reason: "reveal" }];
      const paths = [join(dir, "a.wav"), join(dir, "b.wav")];
      for (const path of paths) expect(ffmpeg(soundTrackArgs(cues, 2, path)).status).toBe(0);
      const [a, b] = paths.map((path) => createHash("sha256").update(readFileSync(path)).digest("hex"));
      expect(a).toBe(b);
      const quiet = ffmpeg(["-hide_banner", "-i", paths[0], "-af", "atrim=0:0.4,volumedetect", "-f", "null", "-"]).stderr;
      expect(quiet).toMatch(/max_volume: -(inf|9\d|\d{3})/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
