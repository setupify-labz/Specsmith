// Builds public/wins-sound.wav: every sound synthesised locally with ffmpeg
// (sines, chirps and noise; no samples, no music, no voice), each event placed
// from src/timeline.json. Run: node sound/build.mjs   (needs ffmpeg on PATH)

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = JSON.parse(readFileSync(join(root, "src", "timeline.json"), "utf8"));
const work = join(root, "out", "sound-parts");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const ff = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
let n = 0;
const part = (lavfi, filters, seconds) => {
  const path = join(work, `p${n++}.wav`);
  ff(["-f", "lavfi", "-i", lavfi, "-af", `${filters},aformat=sample_rates=48000:channel_layouts=stereo`, "-t", String(seconds), path]);
  return path;
};
const sine = (f, d, vol, attack = 0.005, release = d - 0.01) => part(`sine=frequency=${f}:duration=${d}`, `volume=${vol},afade=t=in:d=${attack},afade=t=out:st=${Math.max(0, d - release)}:d=${release}`, d);
const noise = (color, d, filt, vol, attack, release, seed = 1) => part(`anoisesrc=color=${color}:seed=${seed}:duration=${d}`, `${filt},volume=${vol},afade=t=in:d=${attack},afade=t=out:st=${Math.max(0, d - release)}:d=${release}`, d);
const chirp = (f0, f1, d, vol) => part(`aevalsrc=sin(2*PI*(${f0}*t+(${f1}-${f0})*t*t/(2*${d}))):s=48000:d=${d}`, `volume=${vol},afade=t=in:d=${d * 0.85},afade=t=out:st=${d * 0.9}:d=${d * 0.1}`, d);

// Building blocks.
const whoosh = noise("white", 0.35, "bandpass=f=1200:w=1.5", 0.5, 0.12, 0.22, 3);
const kick = sine(58, 0.28, 0.95, 0.002, 0.27);
const snap = noise("white", 0.07, "highpass=f=2500", 0.45, 0.002, 0.065, 5);
const pulse = sine(50, 0.16, 0.45, 0.002, 0.15);
const boom = sine(42, 1.1, 1.0, 0.002, 1.05);
const crash = noise("pink", 1.4, "highpass=f=3500", 0.32, 0.003, 1.35, 7);
const riser = chirp(180, 900, 1.35, 0.16);
const riserNoise = noise("white", 1.35, "highpass=f=2000,lowpass=f=7000", 0.08, 1.2, 0.08, 9);
const suck = noise("white", 0.32, "bandpass=f=700:w=1.2", 0.45, 0.28, 0.04, 11);
const tone = sine(392, 0.9, 0.12, 0.02, 0.85);
const zoomSwish = noise("pink", 0.4, "bandpass=f=900:w=1.4", 0.3, 0.15, 0.25, 13);
const thud = sine(46, 1.2, 0.95, 0.003, 1.15);
const bell1 = sine(523.25, 2.0, 0.22, 0.003, 1.95);
const bell2 = sine(1046.5, 1.6, 0.08, 0.003, 1.55);
const tickSoft = sine(1200, 0.06, 0.2, 0.002, 0.055);
const pluck1 = sine(659.25, 0.6, 0.18, 0.003, 0.58);
const pluck2 = sine(783.99, 0.8, 0.16, 0.003, 0.78);

const events = [[whoosh, 0], [whoosh, 0.08], [kick, 0.35], [snap, 0.35]];
T.beats.forEach((beat, i) => {
  if (i < T.namedBeats) {
    events.push([kick, beat], [snap, beat], [whoosh, beat - 0.12]);
  } else {
    // Blips rise in pitch as the count climbs; every fifth lead hits harder.
    events.push([sine(Math.round(650 + (i - T.namedBeats) * 55), 0.09, 0.28, 0.002, 0.085), beat]);
    if ((i + 1) % 5 === 0) events.push([kick, beat], [snap, beat]);
  }
});
// A driving pulse under the counting, on a steady 0.25 s grid.
for (let at = T.beats[T.namedBeats]; at < T.land - 0.1; at += 0.25) events.push([pulse, at]);
events.push(
  [boom, T.land], [kick, T.land], [crash, T.land],
  [riser, T.blowout - 0.35], [riserNoise, T.blowout - 0.35],
  [suck, T.collapse - 0.05], // then nearly nothing: the sound change
  [tone, T.marks + 0.1],
  [zoomSwish, T.zoom],
  [thud, T.apart], [bell1, T.apart + 0.02], [bell2, T.apart + 0.02],
  [tickSoft, T.perGame],
  [pluck1, T.question], [pluck2, T.question + 0.14],
);

const inputs = events.flatMap(([path]) => ["-i", path]);
const delays = events.map(([, at], i) => `[${i}]adelay=${Math.round(Math.max(0, at) * 1000)}|${Math.round(Math.max(0, at) * 1000)}[d${i}]`);
const mix = `${events.map((_, i) => `[d${i}]`).join("")}amix=inputs=${events.length}:normalize=0,atrim=0:${T.duration}`;
const premix = join(work, "premix.wav");
ff([...inputs, "-filter_complex", `${delays.join(";")};${mix}`, "-ar", "48000", premix]);

// Two-pass loudness to -16 LUFS; a limiter keeps the true peak under -1.5 dBTP.
const report = execFileSync("sh", ["-c", `ffmpeg -hide_banner -i "${premix}" -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1`]).toString();
const m = JSON.parse(report.slice(report.lastIndexOf("{"), report.lastIndexOf("}") + 1));
const out = join(root, "public", "wins-sound.wav");
ff(["-i", premix, "-af", `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset},alimiter=limit=0.66:attack=1:release=60:level=disabled`, "-ar", "48000", out]);
console.log(`wrote ${out} (${events.length} events; premix ${m.input_i} LUFS, ${m.input_tp} dBTP)`);
