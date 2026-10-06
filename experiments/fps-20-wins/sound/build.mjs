// Builds public/wins-sound.wav: every sound synthesised locally with ffmpeg
// (sines and noise; no samples, no music, no voice), each event placed
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

// Building blocks. Natural pitch throughout: nothing is sped up, pitched up or swept.
const whoosh = noise("white", 0.35, "bandpass=f=1200:w=1.5", 0.5, 0.12, 0.22, 3);
const kick = sine(58, 0.28, 0.95, 0.002, 0.27);
const snap = noise("white", 0.07, "highpass=f=2500", 0.45, 0.002, 0.065, 5);
const tom = sine(98, 0.32, 0.55, 0.002, 0.3);
const clap = noise("pink", 0.12, "bandpass=f=1600:w=1.2", 0.55, 0.002, 0.11, 17);
const tick = sine(1100, 0.03, 0.14, 0.002, 0.028);
const boom = sine(42, 1.1, 1.0, 0.002, 1.05);
const crash = noise("pink", 1.4, "highpass=f=3500", 0.32, 0.003, 1.35, 7);
const swell = noise("pink", 0.75, "highpass=f=1200,lowpass=f=6000", 0.22, 0.7, 0.05, 9);
const swish = noise("pink", 0.3, "bandpass=f=900:w=1.4", 0.3, 0.12, 0.18, 13);
const softTick = sine(880, 0.06, 0.16, 0.002, 0.055);
const thud = sine(46, 1.3, 1.0, 0.003, 1.25);
const bell1 = sine(523.25, 2.2, 0.24, 0.003, 2.15);
const bell2 = sine(1046.5, 1.8, 0.08, 0.003, 1.75);
const pluck1 = sine(659.25, 0.6, 0.18, 0.003, 0.58);
const pluck2 = sine(783.99, 0.8, 0.16, 0.003, 0.78);

// A low, original synth bed gives the silent cut a contrast. Keep the
// rhythmic section underneath the counting, then switch to a warmer held
// chord beneath the small-gap reveal. These are tones and filtered noise,
// not stock samples or a voice track.
const raceEnd = T.cut - 0.16;
const raceAir = noise("pink", raceEnd, "highpass=f=180,lowpass=f=1000", 0.15, 0.12, raceEnd - 0.24, 29);
const raceLow = sine(65.41, raceEnd, 0.16, 0.08, raceEnd - 0.2);
const revealStart = T.numbers;
const revealLength = T.duration - revealStart;
const revealAir = noise("pink", revealLength, "highpass=f=280,lowpass=f=1700", 0.10, 0.35, revealLength - 0.5, 31);
const revealRoot = sine(130.81, revealLength, 0.12, 0.3, revealLength - 0.5);
const revealFifth = sine(196.0, revealLength, 0.055, 0.3, revealLength - 0.5);
const pulse = sine(98, 0.22, 0.25, 0.003, 0.17);
const brush = noise("pink", 0.12, "highpass=f=2300,lowpass=f=7000", 0.13, 0.005, 0.09, 37);

const events = [
  [raceAir, 0], [raceLow, 0],
  [revealAir, revealStart], [revealRoot, revealStart], [revealFifth, revealStart],
];
for (let at = 0.25; at < raceEnd - 0.22; at += 0.55) {
  events.push([pulse, at]);
  if (Math.round((at - 0.25) / 0.55) % 2) events.push([brush, at + 0.27]);
}
// Three spotlights, three different hits.
const hits = [[whoosh, kick, snap], [kick, clap], [whoosh, kick, tom, snap]];
T.spots.forEach((at, i) => hits[i].forEach((h) => events.push([h, h === whoosh ? Math.max(0, at - 0.1) : at])));
// Counter rolls: quiet same-pitch ticks, one per counted game.
let count = 1;
for (const roll of T.rolls) {
  const steps = roll.to - count;
  const span = roll.span;
  for (let k = 1; k <= steps; k++) events.push([tick, roll.at + (span * k) / steps]);
  count = roll.to;
}
events.push(
  [swell, T.land - 0.72],
  [boom, T.land], [kick, T.land], [crash, T.land],
  [swish, T.blowout - 0.05],
  // T.cut: nothing. The silence is the change.
  [softTick, T.numbers], [softTick, T.numbers + 0.08],
  [thud, T.apart], [bell1, T.apart + 0.02], [bell2, T.apart + 0.02],
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
