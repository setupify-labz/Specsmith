// Sound cues for the race, synthesized here from the timeline's cue list.
//
// Offline and original: oscillators and seeded noise, no samples, no provider,
// no voice. Every sound starts at a cue the picture also uses, so a tick lands
// on its tile's flip and the whoosh on the pull-back.

import { DURATION_SECONDS, type SoundCue } from "./timeline.ts";

export const SAMPLE_RATE = 48_000;

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

export function synthesizeCues(cues: SoundCue[]): Float32Array {
  const total = Math.round(DURATION_SECONDS * SAMPLE_RATE);
  const out = new Float32Array(total);
  const at = (kind: SoundCue["kind"]) => cues.find((cue) => cue.kind === kind)?.at;
  const add = (start: number, length: number, sample: (time: number, index: number) => number) => {
    const first = Math.max(0, Math.round(start * SAMPLE_RATE));
    const count = Math.min(total - first, Math.round(length * SAMPLE_RATE));
    for (let i = 0; i < count; i += 1) out[first + i] += sample(i / SAMPLE_RATE, i);
  };

  // Engine: a rev into a steady two-oscillator drone that fades as the camera pulls away.
  const rev = at("rev") ?? 0;
  const engineStart = at("engine-start") ?? 0.6;
  const whoosh = at("whoosh") ?? 5;
  const reveal = at("reveal") ?? 6.3;
  let phase1 = 0;
  let phase2 = 0;
  add(rev, reveal + 0.4 - rev, (time) => {
    const t = rev + time;
    const launch = Math.min(1, Math.max(0, (t - engineStart) / 1.2));
    const freq = t < engineStart ? 45 + 60 * (t / engineStart) ** 2 : 70 + 40 * launch + 4 * Math.sin(t * 9);
    phase1 += (2 * Math.PI * freq) / SAMPLE_RATE;
    phase2 += (2 * Math.PI * freq * 1.503) / SAMPLE_RATE;
    const fadeIn = Math.min(1, t / 0.25);
    const fadeOut = t < whoosh ? 1 : Math.max(0, 1 - (t - whoosh) / (reveal + 0.4 - whoosh));
    // Soft-clipped saw-ish tone: harmonics without harshness.
    const tone = Math.tanh(2.2 * (Math.sin(phase1) + 0.45 * Math.sin(2 * phase1) + 0.3 * Math.sin(phase2)));
    return 0.16 * tone * fadeIn * fadeOut;
  });

  // Flip ticks: a short filtered click, pitch climbing tile by tile.
  for (const cue of cues.filter((entry) => entry.kind === "flip")) {
    const random = noise(1000 + (cue.index ?? 0));
    const pitch = 900 + 45 * (cue.index ?? 0);
    add(cue.at, 0.07, (time) => {
      const env = Math.exp(-time * 70);
      return env * (0.22 * Math.sin(2 * Math.PI * pitch * time) + 0.1 * random());
    });
  }

  // Stamp: a low thump with a noise crack.
  const stamp = at("stamp");
  if (stamp !== undefined) {
    const random = noise(77);
    add(stamp, 0.6, (time) => {
      const thump = Math.sin(2 * Math.PI * (60 - 25 * time) * time) * Math.exp(-time * 7);
      return 0.5 * thump + 0.18 * random() * Math.exp(-time * 40);
    });
  }

  // Whoosh: noise through a one-pole low-pass whose cutoff sweeps up, then down.
  {
    const random = noise(4242);
    const length = reveal - whoosh + 0.2;
    let smooth = 0;
    add(whoosh, length, (time) => {
      const u = time / length;
      const cutoff = 200 + 5000 * Math.sin(Math.PI * u) ** 2;
      const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / SAMPLE_RATE);
      smooth += alpha * (random() - smooth);
      return 0.5 * smooth * Math.sin(Math.PI * u) ** 1.5;
    });
  }

  // Reveal: two soft bell tones and a low floor under the finish.
  add(reveal, DURATION_SECONDS - reveal, (time) => {
    const bell = (freq: number, delay: number) =>
      time < delay ? 0 : Math.sin(2 * Math.PI * freq * (time - delay)) * Math.exp(-(time - delay) * 2.6);
    const floor = Math.sin(2 * Math.PI * 55 * time) * Math.min(1, time * 4) * Math.exp(-time * 1.2);
    return 0.14 * bell(880, 0) + 0.11 * bell(1318.5, 0.12) + 0.12 * floor;
  });

  // Normalise to -1 dBFS peak, with a short fade at the very end.
  const peak = out.reduce((max, value) => Math.max(max, Math.abs(value)), 0) || 1;
  const gain = 0.89 / peak;
  const tail = Math.round(0.05 * SAMPLE_RATE);
  for (let i = 0; i < total; i += 1) out[i] *= gain * Math.min(1, (total - i) / tail);
  return out;
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
