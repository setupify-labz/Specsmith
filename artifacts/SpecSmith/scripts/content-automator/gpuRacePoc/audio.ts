// Sound for the race draft: synthesized cues, the placeholder narration, and
// the mix of the two.
//
// Offline and original: oscillators and seeded noise for the effects, local
// espeak-ng for the narration. No samples, no provider, no paid voice. The
// narration is a stand-in for the intended Liam read and is labelled as one.
// Every effect starts at a cue the picture also uses, and the effects duck
// under each narration line so the words stay clear.

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PlacedLine, SoundCue } from "./timeline.ts";

export const SAMPLE_RATE = 48_000;

/** The same settings as the repository's offline narration fixture (localFixtureTts.ts). */
export const PLACEHOLDER_VOICE = { engine: "espeak-ng", voice: "en-us", wordsPerMinute: 165, pitch: 50 } as const;

/** Seeded noise, so the same timeline always makes the same bytes. */
function noise(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

function run(command: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${command} exited ${code}: ${err.slice(-400)}`))));
  });
}

/** One narration line as 48 kHz mono samples, spoken by the placeholder voice. */
export async function speakPlaceholder(text: string): Promise<Float32Array> {
  const dir = await mkdtemp(join(tmpdir(), "race-voice-"));
  try {
    const wav = join(dir, "line.wav");
    await run(PLACEHOLDER_VOICE.engine, [
      "-v", PLACEHOLDER_VOICE.voice, "-s", String(PLACEHOLDER_VOICE.wordsPerMinute), "-p", String(PLACEHOLDER_VOICE.pitch), "-w", wav, text,
    ]);
    const raw = await run("ffmpeg", ["-loglevel", "error", "-i", wav, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "-"]);
    const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    return trimSilence(Float32Array.from(samples));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Drops leading and trailing silence, so a line's length is the length of its words. */
export function trimSilence(samples: Float32Array, threshold = 0.01): Float32Array {
  let first = 0;
  let last = samples.length - 1;
  while (first < samples.length && Math.abs(samples[first]) < threshold) first += 1;
  while (last > first && Math.abs(samples[last]) < threshold) last -= 1;
  const pad = Math.round(0.02 * SAMPLE_RATE);
  return samples.slice(Math.max(0, first - pad), Math.min(samples.length, last + pad));
}

export function synthesizeCues(cues: SoundCue[], durationSeconds: number): Float32Array {
  const total = Math.round(durationSeconds * SAMPLE_RATE);
  const out = new Float32Array(total);
  const at = (kind: SoundCue["kind"]) => cues.find((cue) => cue.kind === kind)?.at;
  const add = (start: number, length: number, sample: (time: number) => number) => {
    const first = Math.max(0, Math.round(start * SAMPLE_RATE));
    const count = Math.min(total - first, Math.round(length * SAMPLE_RATE));
    for (let i = 0; i < count; i += 1) out[first + i] += sample(i / SAMPLE_RATE);
  };

  // Engine: a steady two-oscillator drone from the start of the race, fading through the pull-back.
  const engineStart = at("engine-start") ?? 0;
  const whoosh = at("whoosh") ?? durationSeconds;
  const reveal = at("reveal") ?? durationSeconds;
  const spotlights = cues.filter((cue) => cue.kind === "spotlight").map((cue) => cue.at);
  let phase1 = 0;
  let phase2 = 0;
  add(0, reveal, (time) => {
    const launch = Math.min(1, Math.max(0, (time - engineStart) / 1.0));
    const idle = time < engineStart ? 0.45 : 1;
    // The engine drops in pitch through each slow-motion spotlight.
    const slow = spotlights.reduce((drop, start) => drop * (time > start && time < start + 1 ? 0.6 : 1), 1);
    const freq = (time < engineStart ? 48 : 70 + 40 * launch) * slow + 3 * Math.sin(time * 9);
    phase1 += (2 * Math.PI * freq) / SAMPLE_RATE;
    phase2 += (2 * Math.PI * freq * 1.503) / SAMPLE_RATE;
    const fadeIn = Math.min(1, time / 0.3);
    const fadeOut = time < whoosh ? 1 : Math.max(0, 1 - (time - whoosh) / Math.max(0.1, reveal - whoosh));
    const tone = Math.tanh(2.2 * (Math.sin(phase1) + 0.45 * Math.sin(2 * phase1) + 0.3 * Math.sin(phase2)));
    return 0.14 * tone * idle * fadeIn * fadeOut;
  });

  // Flip ticks: a short filtered click, pitch climbing with the count.
  for (const cue of cues.filter((entry) => entry.kind === "flip")) {
    const random = noise(1000 + (cue.index ?? 0));
    const pitch = 700 + 55 * (cue.index ?? 0);
    add(cue.at, 0.08, (time) => Math.exp(-time * 60) * (0.24 * Math.sin(2 * Math.PI * pitch * time) + 0.1 * random()));
  }

  // Spotlight: a soft rising swell into the slow-motion pass.
  for (const start of spotlights) {
    const random = noise(Math.round(start * 1000));
    let smooth = 0;
    add(start, 0.9, (time) => {
      const u = time / 0.9;
      const alpha = 1 - Math.exp((-2 * Math.PI * (300 + 2500 * u)) / SAMPLE_RATE);
      smooth += alpha * (random() - smooth);
      return 0.22 * smooth * Math.sin(Math.PI * u) + 0.06 * Math.sin(2 * Math.PI * 440 * time) * Math.exp(-time * 3);
    });
  }

  // Count complete: a low thump with a crack.
  const complete = at("complete");
  if (complete !== undefined) {
    const random = noise(77);
    add(complete, 0.6, (time) => 0.5 * Math.sin(2 * Math.PI * (60 - 25 * time) * time) * Math.exp(-time * 7) + 0.16 * random() * Math.exp(-time * 40));
  }

  // Pull-back whoosh: noise through a low-pass whose cutoff sweeps up, then down.
  {
    const random = noise(4242);
    const length = Math.max(0.6, reveal - whoosh + 0.2);
    let smooth = 0;
    add(whoosh, length, (time) => {
      const u = time / length;
      const alpha = 1 - Math.exp((-2 * Math.PI * (200 + 5000 * Math.sin(Math.PI * u) ** 2)) / SAMPLE_RATE);
      smooth += alpha * (random() - smooth);
      return 0.45 * smooth * Math.sin(Math.PI * u) ** 1.5;
    });
  }

  // Averages revealed: a bell. Verdict: a lower bell over a floor that holds to the end.
  const bell = (freq: number, time: number, decay: number) => Math.sin(2 * Math.PI * freq * time) * Math.exp(-time * decay);
  add(reveal, 1.5, (time) => 0.13 * bell(880, time, 2.6) + 0.1 * (time > 0.12 ? bell(1318.5, time - 0.12, 2.6) : 0));
  const verdict = at("verdict");
  if (verdict !== undefined) {
    add(verdict, durationSeconds - verdict, (time) =>
      0.14 * bell(659.3, time, 1.6) + 0.12 * Math.sin(2 * Math.PI * 55 * time) * Math.min(1, time * 4) * Math.exp(-time * 0.9));
  }
  return out;
}

/**
 * The final mix: narration on top, effects ducked by 10 dB under each line
 * (with 80 ms ramps), normalised to -1 dBFS with a short tail fade.
 */
export function mixDraft(effects: Float32Array, lines: { start: number; samples: Float32Array }[]): Float32Array {
  const total = effects.length;
  const duck = new Float32Array(total).fill(1);
  const ramp = Math.round(0.08 * SAMPLE_RATE);
  const ducked = 10 ** (-10 / 20);
  for (const line of lines) {
    const first = Math.round(line.start * SAMPLE_RATE);
    const last = first + line.samples.length;
    for (let i = Math.max(0, first - ramp); i < Math.min(total, last + ramp); i += 1) {
      const edge = i < first ? (first - i) / ramp : i > last ? (i - last) / ramp : 0;
      duck[i] = Math.min(duck[i], ducked + (1 - ducked) * edge);
    }
  }
  const out = new Float32Array(total);
  for (let i = 0; i < total; i += 1) out[i] = effects[i] * duck[i];
  for (const line of lines) {
    const first = Math.round(line.start * SAMPLE_RATE);
    for (let i = 0; i < line.samples.length && first + i < total; i += 1) out[first + i] += 0.9 * line.samples[i];
  }
  const peak = out.reduce((max, value) => Math.max(max, Math.abs(value)), 0) || 1;
  const gain = 0.89 / peak;
  const tail = Math.round(0.05 * SAMPLE_RATE);
  for (let i = 0; i < total; i += 1) out[i] *= gain * Math.min(1, (total - i) / tail);
  return out;
}

/** Line start times and samples, placed as the timeline says. */
export function placedVoice(lines: PlacedLine[], voice: Map<string, Float32Array>): { start: number; samples: Float32Array }[] {
  return lines.map((line) => {
    const samples = voice.get(line.id);
    if (!samples) throw new Error(`No narration audio for "${line.id}".`);
    return { start: line.start, samples };
  });
}

/** 16-bit mono PCM WAV. */
export function wavBytes(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, index) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), index * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(SAMPLE_RATE * 2, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
