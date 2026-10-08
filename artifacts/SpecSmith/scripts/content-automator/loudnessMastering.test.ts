// Loudness mastering in the compositor: a constant gain and a true-peak
// limiter, verified on the encode. On a synthetic test signal (speech-like
// bursts with sharp transients, and a quiet "effect" tone in a pause) it must
// reach the target, keep the burst-to-effect balance, leave onsets where they
// were, and refuse a target it cannot meet rather than ship a clipped mix.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { masterChain, masterToLoudness, measureLoudness, parseMotionCompositorState } from "./motionCompositor.ts";

const RATE = 48000;
let dir: string;
const ffmpeg = (args: string[]) => {
  const result = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" });
  if (result.error) throw new Error(`ffmpeg could not run: ${result.error.message}. These tests need ffmpeg installed.`);
  if (result.status !== 0) throw new Error(result.stderr);
};

/** TEST SIGNAL: six 1 s bursts at about -22 dBFS, each opening on a 2 ms spike, and one quiet tone in a pause. */
const BURSTS = [0.5, 2.1, 3.7, 5.3, 6.9, 8.5];
const EFFECT = { start: 1.65, seconds: 0.2 };
function writeTestSignal(path: string) {
  const samples = new Float32Array(Math.round(10 * RATE));
  for (const start of BURSTS) {
    const s0 = Math.round(start * RATE);
    for (let i = 0; i < RATE; i += 1) {
      const t = i / RATE;
      samples[s0 + i] += 0.08 * (Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 440 * t)) / 1.5;
    }
    for (let i = 0; i < Math.round(0.002 * RATE); i += 1) samples[s0 + i] += 0.7;
  }
  const e0 = Math.round(EFFECT.start * RATE);
  for (let i = 0; i < Math.round(EFFECT.seconds * RATE); i += 1) samples[e0 + i] += 0.01 * Math.sin(2 * Math.PI * 600 * (i / RATE));
  const raw = join(dir, "signal.f32");
  writeFileSync(raw, Buffer.from(samples.buffer));
  ffmpeg(["-f", "f32le", "-ar", String(RATE), "-ac", "1", "-i", raw, "-c:a", "pcm_s24le", path]);
}
function readPcm(path: string): Float32Array {
  const raw = join(dir, `${Math.random().toString(36).slice(2)}.f32`);
  ffmpeg(["-i", path, "-ac", "1", "-ar", String(RATE), "-f", "f32le", raw]);
  const buffer = readFileSync(raw);
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}
const rmsDb = (pcm: Float32Array, start: number, seconds: number) => {
  const a = Math.round(start * RATE), b = a + Math.round(seconds * RATE);
  let sum = 0;
  for (let i = a; i < b; i += 1) sum += pcm[i] * pcm[i];
  return 10 * Math.log10(sum / (b - a));
};
const firstOnset = (pcm: Float32Array, after: number) => {
  for (let i = Math.round(after * RATE); i < pcm.length; i += 1) if (Math.abs(pcm[i]) > 0.05) return i / RATE;
  return -1;
};
const encode = (name: string) => async (masteredPath: string) => {
  const out = join(dir, `${name}.m4a`);
  ffmpeg(["-i", masteredPath, "-c:a", "aac", "-b:a", "192k", out]);
  return out;
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mastering-"));
  writeTestSignal(join(dir, "mix.wav"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("loudness mastering", () => {
  it("reaches the target on the encode, without clipping, keeping the balance and the timing", async () => {
    const target = { integratedLufs: -16, truePeakDbtp: -1.5, toleranceLu: 0.3 };
    const before = await measureLoudness("ffmpeg", join(dir, "mix.wav"));
    expect(before.integratedLufs).toBeLessThan(-20);
    const record = await masterToLoudness({ ffmpegPath: "ffmpeg", mixPath: join(dir, "mix.wav"), masteredPath: join(dir, "mastered.wav"), target, timeoutMs: 120_000, encode: encode("a") });
    const final = await measureLoudness("ffmpeg", join(dir, "a.m4a"));
    expect(Math.abs(final.integratedLufs + 16)).toBeLessThanOrEqual(0.3);
    expect(final.truePeakDbtp).toBeLessThanOrEqual(-1.5);
    expect(record).toMatchObject({ finalIntegratedLufs: final.integratedLufs, finalTruePeakDbtp: final.truePeakDbtp });

    // Balance: the burst body and the quiet effect both sit below the ceiling,
    // so the one constant gain moves them by the same amount.
    const pre = readPcm(join(dir, "mix.wav")), post = readPcm(join(dir, "mastered.wav"));
    const bodyBefore = rmsDb(pre, BURSTS[1] + 0.3, 0.4), bodyAfter = rmsDb(post, BURSTS[1] + 0.3, 0.4);
    const fxBefore = rmsDb(pre, EFFECT.start + 0.05, 0.1), fxAfter = rmsDb(post, EFFECT.start + 0.05, 0.1);
    expect(Math.abs((bodyAfter - fxAfter) - (bodyBefore - fxBefore))).toBeLessThan(0.3);
    expect(bodyAfter - bodyBefore).toBeCloseTo(Number(record.masterGainDb), 0);

    // Timing: the limiter's lookahead is compensated, so onsets do not move.
    for (const start of BURSTS) expect(Math.abs(firstOnset(post, start - 0.1) - firstOnset(pre, start - 0.1))).toBeLessThan(0.001);
  }, 120_000);

  it("refuses a target it cannot meet without crushing the audio, instead of shipping it", async () => {
    await expect(masterToLoudness({
      ffmpegPath: "ffmpeg", mixPath: join(dir, "mix.wav"), masteredPath: join(dir, "impossible.wav"),
      target: { integratedLufs: -5, truePeakDbtp: -12 }, timeoutMs: 120_000, encode: encode("b"),
    })).rejects.toThrow(/Could not master to -5 LUFS \/ -12 dBTP/);
  }, 120_000);
});

describe("the mastering chain and its settings", () => {
  it("is one gain, oversampled 4x, into a limiter with no auto-level and its delay compensated", () => {
    const chain = masterChain(8.6, -2);
    expect(chain).toMatch(/^volume=8\.600dB,aresample=192000,alimiter=limit=0\.794328:attack=5:release=50:level=false:latency=true,aresample=48000$/);
  });

  it("accepts a sensible target and refuses others", () => {
    const base = { durationSeconds: 2, fps: 30, visualTimeline: [{ visualTaskId: "v", startSecond: 0, endSecond: 2 }], voiceTaskId: "voice" };
    expect(parseMotionCompositorState({ ...base, loudness: { integratedLufs: -16, truePeakDbtp: -1.5 } }).loudness).toEqual({ integratedLufs: -16, truePeakDbtp: -1.5, toleranceLu: 0.5 });
    expect(parseMotionCompositorState(base).loudness).toBeUndefined();
    for (const loudness of [{ integratedLufs: 0, truePeakDbtp: -1 }, { integratedLufs: -16, truePeakDbtp: 1 }, { integratedLufs: -16, truePeakDbtp: -1.5, toleranceLu: 0 }, { integratedLufs: "loud" }]) {
      expect(() => parseMotionCompositorState({ ...base, loudness })).toThrow(/loudness needs/);
    }
  });
});
