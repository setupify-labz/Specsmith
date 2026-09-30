// Loads a Liam take for the race draft and cuts it into its five lines.
//
// A take is used only if it is the approved script, in the pinned Liam voice,
// with the audio its manifest describes. Lines are cut where the provider's
// character timestamps put them; if the take has none, where the audio's own
// pauses put them, and only if exactly the expected pauses are clear. Either
// way the draft is then timed from what Liam actually took to say each line.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

import { REVIEWED_LIAM_VOICE } from "../liamVoice.ts";
import { SAMPLE_RATE, trimSilence } from "./audio.ts";
import { APPROVED_RACE_LINES, LIAM_TAKE_MANIFEST, LIAM_TAKE_TEXT, type LineTiming } from "./liamTake.ts";
import type { LineId } from "./timeline.ts";

export class TakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TakeError";
  }
}

export interface LoadedTake {
  lines: Map<LineId, Float32Array>;
  /** Where each line was cut from, in take seconds, and how. */
  cuts: (LineTiming & { method: "provider-timestamps" | "audio-pauses" })[];
  provenance: { voiceId: string; voiceUsed: string; audioSha256: string; modelId: string; text: string };
}

function decode(path: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-loglevel", "error", "-i", path, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new TakeError(`ffmpeg could not decode the take: ${err.slice(-300)}`));
      const raw = Buffer.concat(out);
      resolve(Float32Array.from(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)));
    });
  });
}

/**
 * Line spans from the audio's own pauses: silent runs of at least `minGap`
 * seconds between speech. The `count - 1` longest become the line breaks, and
 * only if they stand clearly apart from the next-longest pause (a comma).
 */
export function segmentByPauses(samples: Float32Array, count: number, minGap = 0.12): { start: number; end: number }[] {
  const window = Math.round(0.01 * SAMPLE_RATE);
  const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0) || 1;
  const floor = peak * 10 ** (-38 / 20);
  const loud: boolean[] = [];
  for (let i = 0; i + window <= samples.length; i += window) {
    let sum = 0;
    for (let j = i; j < i + window; j += 1) sum += samples[j] * samples[j];
    loud.push(Math.sqrt(sum / window) > floor);
  }
  const first = loud.indexOf(true);
  const last = loud.lastIndexOf(true);
  if (first < 0) throw new TakeError("The take is silent.");
  const gaps: { from: number; to: number }[] = [];
  let run = -1;
  for (let k = first; k <= last; k += 1) {
    if (!loud[k] && run < 0) run = k;
    if (loud[k] && run >= 0) {
      if ((k - run) * 0.01 >= minGap) gaps.push({ from: run, to: k });
      run = -1;
    }
  }
  const byLength = [...gaps].sort((a, b) => (b.to - b.from) - (a.to - a.from));
  if (byLength.length < count - 1) throw new TakeError(`Found ${byLength.length} pauses in the take; ${count - 1} line breaks are needed.`);
  const breaks = byLength.slice(0, count - 1);
  const next = byLength[count - 1];
  const shortestBreak = Math.min(...breaks.map((gap) => gap.to - gap.from));
  if (next && next.to - next.from > shortestBreak * 0.8) {
    throw new TakeError("The line breaks are not clearly longer than the pauses inside lines; the take cannot be cut without guessing.");
  }
  breaks.sort((a, b) => a.from - b.from);
  const spans: { start: number; end: number }[] = [];
  let start = first * 0.01;
  for (const gap of breaks) {
    spans.push({ start, end: gap.from * 0.01 });
    start = gap.to * 0.01;
  }
  spans.push({ start, end: (last + 1) * 0.01 });
  return spans;
}

export async function loadLiamTake(dir: string): Promise<LoadedTake> {
  const manifest = JSON.parse(await readFile(join(dir, LIAM_TAKE_MANIFEST), "utf8")) as {
    text: string; voiceId: string; voiceUsed: string; modelId: string; isFixture: boolean;
    audio: { file: string; sha256: string }; lineTimings: LineTiming[] | null;
  };
  if (manifest.text !== LIAM_TAKE_TEXT) throw new TakeError("The take's text is not the approved script. Refusing it.");
  if (manifest.voiceId !== REVIEWED_LIAM_VOICE.voiceId || manifest.isFixture) throw new TakeError("The take is not the pinned Liam voice. Refusing it.");
  const audioPath = join(dir, manifest.audio.file);
  const sha256 = createHash("sha256").update(await readFile(audioPath)).digest("hex");
  if (sha256 !== manifest.audio.sha256) throw new TakeError("The take's audio is not the audio its manifest describes. Refusing it.");

  const samples = await decode(audioPath);
  const ids = APPROVED_RACE_LINES.map((line) => line.id);
  let cuts: LoadedTake["cuts"];
  if (manifest.lineTimings && manifest.lineTimings.length === ids.length) {
    cuts = manifest.lineTimings.map((timing, index) => {
      if (timing.id !== ids[index]) throw new TakeError("The take's line timings are out of order.");
      return { ...timing, method: "provider-timestamps" as const };
    });
  } else {
    cuts = segmentByPauses(samples, ids.length).map((span, index) => ({ id: ids[index], ...span, method: "audio-pauses" as const }));
  }

  const lines = new Map<LineId, Float32Array>();
  cuts.forEach((cut, index) => {
    // A little room either side so no consonant is clipped, never into the next line.
    const from = Math.max(0, cut.start - 0.04, index > 0 ? cuts[index - 1].end + 0.01 : 0);
    const to = Math.min(samples.length / SAMPLE_RATE, cut.end + 0.12, index < cuts.length - 1 ? cuts[index + 1].start - 0.01 : Infinity);
    const clip = trimSilence(samples.slice(Math.round(from * SAMPLE_RATE), Math.round(to * SAMPLE_RATE)));
    if (clip.length / SAMPLE_RATE < 0.4) throw new TakeError(`The "${cut.id}" line is only ${(clip.length / SAMPLE_RATE).toFixed(2)}s in the take.`);
    lines.set(cut.id, clip);
  });
  return {
    lines,
    cuts,
    provenance: { voiceId: manifest.voiceId, voiceUsed: manifest.voiceUsed, audioSha256: sha256, modelId: manifest.modelId, text: manifest.text },
  };
}
