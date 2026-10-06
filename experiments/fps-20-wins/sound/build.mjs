// Builds public/wins-sound.wav: every sound synthesised locally with ffmpeg
// (no samples, no music library, no voice), each event placed from
// src/timeline.json. Run: node sound/build.mjs   (needs ffmpeg on PATH)
//
// Mix design (replaces the noise-and-sub-drone bed):
//  - Percussion is shaped, not raw sines: kicks have a pitch drop, snares a
//    tonal body plus noise, hats and ticks are short filtered noise.
//  - A quiet groove locked to the edit (0.4 s beat, so the three spotlights
//    land on beats) carries the counting; a ticking hold builds under 20/20.
//  - The cut is true silence. The reveal is a different texture: a deep hit,
//    a bell with real partials, and a soft mid-register chord pad that phone
//    speakers can reproduce. No sub drones, no hiss beds.
//  - Rumble below 35 Hz is removed; gentle compression; -14 LUFS, -1.5 dBTP.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = JSON.parse(readFileSync(join(root, "src", "timeline.json"), "utf8"));
const work = join(root, "out", "sound-parts");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const SR = 48000;
const ff = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
let n = 0;
/** Render one lavfi source through a filter chain to a stereo wav. */
const part = (lavfi, filters, seconds) => {
  const path = join(work, `p${n++}.wav`);
  ff(["-f", "lavfi", "-i", lavfi, "-af", `${filters},aformat=sample_rates=${SR}:channel_layouts=stereo`, "-t", String(seconds), path]);
  return path;
};
/** A synthesised voice from an expression (no commas allowed in the expression). */
const voice = (expr, d, filters = "anull") => part(`aevalsrc=exprs=${expr}:s=${SR}:d=${d}`, filters, d);
const noise = (color, d, filt, vol, attack, release, seed = 1) =>
  part(`anoisesrc=color=${color}:seed=${seed}:duration=${d}:sample_rate=${SR}`, `${filt},volume=${vol},afade=t=in:d=${attack},afade=t=out:st=${Math.max(0, d - release)}:d=${release}`, d);
const tone = (f, d, vol, attack, release, extra = "") =>
  part(`sine=frequency=${f}:duration=${d}:sample_rate=${SR}`, `volume=${vol},afade=t=in:d=${attack},afade=t=out:st=${Math.max(0, d - release)}:d=${release}${extra}`, d);

// ---- Instruments -----------------------------------------------------------
/** Kick: a sine whose pitch drops from `hi` to `lo` Hz, with an exponential body. */
const kick = (hi, lo, decay, gain, d = decay * 4) =>
  voice(`${gain}*sin(2*PI*(${lo}*t+(${hi}-${lo})*0.035*(1-exp(-t/0.035))))*exp(-t/${decay})`, d);
/** Snare: tonal body plus band-passed noise. */
const snareBody = voice(`0.45*sin(2*PI*185*t)*exp(-t/0.05)`, 0.25);
const snareNoise = noise("white", 0.22, "highpass=f=1200,lowpass=f=8000", 0.55, 0.001, 0.2, 5);
const hat = noise("white", 0.06, "highpass=f=7500", 0.22, 0.001, 0.055, 7);
const hatOpen = noise("white", 0.22, "highpass=f=6500", 0.16, 0.001, 0.2, 8);
const tick = noise("white", 0.018, "highpass=f=2800,lowpass=f=9000", 0.5, 0.0005, 0.017, 11);
const softTick = noise("white", 0.02, "highpass=f=2200,lowpass=f=7000", 0.28, 0.0005, 0.019, 12);
const whoosh = noise("pink", 0.38, "bandpass=f=1400:w=1.6", 0.6, 0.16, 0.2, 3);
const swell = noise("pink", 0.85, "highpass=f=900,lowpass=f=9000", 0.32, 0.8, 0.04, 9);
const crash = noise("white", 1.6, "highpass=f=4200,lowpass=f=14000", 0.28, 0.002, 1.55, 13);
const grooveKick = kick(110, 50, 0.07, 0.55);
const hitKick = kick(160, 46, 0.12, 0.95);
const landKick = kick(180, 40, 0.22, 1.0);
const revealThud = kick(120, 36, 0.45, 1.0, 2.0);
/** Bell: a struck tone with inharmonic partials, each decaying at its own rate. */
const bell = voice(
  `0.30*sin(2*PI*523.25*t)*exp(-t/1.6)+0.13*sin(2*PI*1306*t)*exp(-t/0.7)+0.07*sin(2*PI*1770*t)*exp(-t/0.4)+0.04*sin(2*PI*2380*t)*exp(-t/0.25)`,
  3.0,
);
const pluck = (f) => voice(`0.32*sin(2*PI*${f}*t)*exp(-t/0.35)+0.08*sin(2*PI*${2 * f}*t)*exp(-t/0.15)`, 1.2);
/** Pad: a soft chord in the midrange, slow attack, slight movement. */
const pad = (d, vol) => [261.63, 329.63, 392.0].map((f, i) => tone(f, d, vol * (i === 0 ? 1 : 0.8), Math.min(1.2, d / 3), Math.min(1.5, d / 2.5), `,tremolo=f=${3 + i * 0.7}:d=0.12`));

// ---- Arrangement -----------------------------------------------------------
const events = [];
const at = (path, time, gain = 1) => events.push([path, Math.max(0, time), gain]);
const BEAT = 0.4;

// The groove under the counting: soft kick on the beat, hat on the off-beat, open hat every 4th.
for (let b = 0; b * BEAT < T.land - 0.05; b++) {
  const time = b * BEAT;
  at(grooveKick, time, 0.8);
  at(b % 4 === 3 ? hatOpen : hat, time + BEAT / 2, 0.9);
}
// Three spotlights, three different hits.
const spotHits = [
  [[whoosh, -0.12], [hitKick, 0], [snareBody, 0], [snareNoise, 0]],
  [[hitKick, 0], [snareNoise, 0], [hatOpen, 0]],
  [[whoosh, -0.12], [hitKick, 0], [snareBody, 0], [snareNoise, 0], [crash, 0, 0.35]],
];
T.spots.forEach((time, i) => spotHits[i].forEach(([p, dt, g]) => at(p, time + dt, g ?? 1)));
// Counter rolls: one tick per counted game.
let count = 1;
for (const roll of T.rolls) {
  const steps = roll.to - count;
  for (let k = 1; k <= steps; k++) at(tick, roll.at + (roll.span * k) / steps, 0.85);
  count = roll.to;
}
// 20/20: swell in, big landing.
at(swell, T.land - 0.85);
at(landKick, T.land); at(snareBody, T.land); at(snareNoise, T.land); at(crash, T.land, 0.9);
// The hold: a clock that tightens, then nothing at the cut.
at(whoosh, T.blowout - 0.08, 0.6);
for (let time = T.land + 0.4; time < T.cut - 0.05; time += 0.2) {
  const k = (time - T.land) / (T.cut - T.land);
  at(softTick, time, 0.5 + 0.6 * k);
}
// T.cut to T.numbers: true silence.
// The numbers count up: ticks that slow as they settle.
for (let k = 0; k < 9; k++) at(softTick, T.numbers + 0.9 * (1 - Math.pow(1 - k / 9, 2)), 0.7);
// The reveal: deep hit, bell, and a pad that holds under the payoff.
at(revealThud, T.apart); at(bell, T.apart + 0.01);
pad(T.question - T.apart + 0.6, 0.06).forEach((p) => at(p, T.apart + 0.05));
// The question: two plucks and a short, quieter pad resolving out.
at(pluck(659.25), T.question); at(pluck(783.99), T.question + 0.15);
pad(T.duration - T.question, 0.035).forEach((p) => at(p, T.question));

// ---- Mix -------------------------------------------------------------------
const inputs = events.flatMap(([path]) => ["-i", path]);
const chains = events.map(([, time, gain], i) => `[${i}]volume=${gain},adelay=${Math.round(time * 1000)}|${Math.round(time * 1000)}[d${i}]`);
const mix = `${events.map((_, i) => `[d${i}]`).join("")}amix=inputs=${events.length}:normalize=0,atrim=0:${T.duration},highpass=f=35,acompressor=threshold=0.25:ratio=2.5:attack=5:release=120:makeup=1`;
const premix = join(work, "premix.wav");
ff([...inputs, "-filter_complex", `${chains.join(";")};${mix}`, "-ar", String(SR), premix]);

const report = execFileSync("sh", ["-c", `ffmpeg -hide_banner -i "${premix}" -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null - 2>&1`]).toString();
const m = JSON.parse(report.slice(report.lastIndexOf("{"), report.lastIndexOf("}") + 1));
const out = join(root, "public", "wins-sound.wav");
ff(["-i", premix, "-af", `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset},alimiter=limit=0.78:attack=1:release=60:level=disabled`, "-ar", String(SR), out]);
console.log(`wrote ${out} (${events.length} events; premix ${m.input_i} LUFS, ${m.input_tp} dBTP)`);
