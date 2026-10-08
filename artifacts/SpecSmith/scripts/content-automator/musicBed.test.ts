// The composed background bed: the same samples every time, no heavy bass,
// no clicks, fades in and out to silence before the end, ducks under the
// figure beats; and adding it leaves the effects layer exactly as it was.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bedEnvelope, composeBed, MUSIC_BED, renderBed } from "./musicBed.ts";
import { createSoundEffectsAdapter, type SoundCue } from "./soundEffects.ts";

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "music-bed-")); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ffmpeg = (args: string[]) => {
  const result = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (result.error) throw new Error(`ffmpeg could not run: ${result.error.message}. These tests need ffmpeg installed.`);
  return result;
};
const integrated = (path: string, filter = "") => {
  const text = ffmpeg(["-hide_banner", "-nostats", "-i", path, "-af", `${filter}ebur128`, "-f", "null", "-"]).stderr;
  return Number(/I:\s+(-?[\d.]+)\s+LUFS/.exec(text.slice(text.lastIndexOf("Summary:")))![1]);
};
const toWav = (samples: Float32Array, name: string) => {
  const raw = join(dir, `${name}.f32`), wav = join(dir, `${name}.wav`);
  writeFileSync(raw, Buffer.from(samples.buffer));
  ffmpeg(["-v", "error", "-y", "-f", "f32le", "-ar", String(MUSIC_BED.sampleRate), "-ac", "1", "-i", raw, "-c:a", "pcm_s24le", wav]);
  return wav;
};

describe("the composed bed", () => {
  it("is the same samples every time", () => {
    const hash = (samples: Float32Array) => createHash("sha256").update(Buffer.from(samples.buffer)).digest("hex");
    expect(hash(composeBed(6))).toBe(hash(composeBed(6)));
  });

  it("has no heavy bass and no clicks", () => {
    const bed = composeBed(10);
    let peak = 0, step = 0;
    for (let i = 1; i < bed.length; i += 1) { peak = Math.max(peak, Math.abs(bed[i])); step = Math.max(step, Math.abs(bed[i] - bed[i - 1])); }
    expect(step / peak).toBeLessThan(0.15);
    const wav = toWav(bed, "bass");
    // Below 100 Hz sits more than 25 LU under the whole bed.
    expect(integrated(wav) - integrated(wav, "lowpass=f=100,lowpass=f=100,")).toBeGreaterThan(25);
  });

  it("fades in, ducks in its windows, fades out, and is silent before the end", () => {
    const ducks = [{ startSecond: 5, endSecond: 9, reason: "figures" }];
    expect(bedEnvelope(0, 20, ducks)).toBe(0);
    expect(bedEnvelope(MUSIC_BED.fadeIn, 20, ducks)).toBeCloseTo(1, 5);
    expect(bedEnvelope(7, 20, ducks)).toBeCloseTo(MUSIC_BED.duckGain, 5);
    expect(bedEnvelope(3, 20, ducks)).toBeCloseTo(1, 5);
    expect(bedEnvelope(20 - MUSIC_BED.endSilence, 20, ducks)).toBe(0);
    const shaped = renderBed(20, ducks, 1);
    const tail = shaped.subarray(Math.round((20 - MUSIC_BED.endSilence) * MUSIC_BED.sampleRate));
    expect(tail.every((sample) => sample === 0)).toBe(true);
  });
});

describe("the bed in the effects track", () => {
  const cues: SoundCue[] = [{ atSecond: 1, kind: "whoosh", reason: "cut" }, { atSecond: 3, kind: "pop", reason: "reveal" }];
  const render = async (name: string, musicBed?: unknown) => {
    const adapter = createSoundEffectsAdapter({ outputDir: join(dir, name) });
    const [artifact] = await adapter.render({ task: { taskId: "audio", soundEffectsState: { cues, ...(musicBed ? { musicBed } : {}) } }, targetDurationSeconds: 8, packageId: "p", platform: "youtube-shorts" } as never);
    return artifact;
  };

  it("leaves the effects layer byte for byte as it was, and is recorded as music", async () => {
    const plain = await render("plain");
    const withBed = await render("bed", { levelLufsAsMixed: -44, ducks: [{ startSecond: 2, endSecond: 4, reason: "figures" }] });
    expect(withBed.metadata?.effectsSha256).toBe(plain.metadata?.sha256);
    expect(withBed.metadata).toMatchObject({ renderer: "specsmith-synth-music-and-effects", isMusic: true, isLicensedSample: false });
    expect(plain.metadata).toMatchObject({ renderer: "specsmith-synth-sound-effects", isMusic: false });
    const bed = JSON.parse(String(withBed.metadata?.musicBed));
    expect(bed).toMatchObject({ playsFromSecond: 0, silentFromSecond: 8 - MUSIC_BED.endSilence, levelLufsAsMixed: -44 });
    // The bed lands at its level once mixed: the composed bed, measured, plus the applied gain, at the mix gain.
    const asMixed = integrated(join(dir, "bed", "audio__bed-level.wav"), "volume=0.14,") + bed.gainDb;
    expect(Math.abs(asMixed - -44)).toBeLessThan(0.3);
    expect(bed.composedLufs + bed.gainDb + 20 * Math.log10(0.14)).toBeCloseTo(-44, 1);
  }, 60_000);

  it("refuses a bed set loud enough to be foreground", async () => {
    await expect(render("loud", { levelLufsAsMixed: -20, ducks: [] })).rejects.toThrow(/background, never foreground/);
  });
});
