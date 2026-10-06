// The monitor cut's mix: the same instruments and processing as voice/mix.mjs,
// retimed to the shorter edit, plus a whoosh for the push into the screen and
// one for the pullback. Everything is synthesised here with ffmpeg: no samples,
// no purchased music.
//
//   node monitor/mix.mjs   -> public/monitor-mix.wav (reads src/monitorplan.json and the take)

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const P = JSON.parse(readFileSync(join(root, "src", "monitorplan.json"), "utf8"));
const takeDir = resolve(root, P.takeDir);
const manifest = JSON.parse(readFileSync(join(takeDir, "fps-20-wins-liam.json"), "utf8"));
const takeAudio = join(takeDir, manifest.audio.file);
const work = join(root, "out", "monitor-parts");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const SR = 48000, D = P.duration, E = P.events;
const ff = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
let n = 0;
const part = (lavfi, filters, seconds) => {
  const path = join(work, `p${n++}.wav`);
  ff(["-f", "lavfi", "-i", lavfi, "-af", `${filters},aformat=sample_rates=${SR}:channel_layouts=stereo`, "-t", String(seconds), path]);
  return path;
};
const voiceSynth = (expr, d) => part(`aevalsrc=exprs=${expr}:s=${SR}:d=${d}`, "anull", d);
const noise = (color, d, filt, vol, attack, release, seed = 1) =>
  part(`anoisesrc=color=${color}:seed=${seed}:duration=${d}:sample_rate=${SR}`, `${filt},volume=${vol},afade=t=in:d=${attack},afade=t=out:st=${Math.max(0, d - release)}:d=${release}`, d);
const tone = (f, d, vol, attack, release, extra = "") =>
  part(`sine=frequency=${f}:duration=${d}:sample_rate=${SR}`, `volume=${vol},afade=t=in:d=${attack},afade=t=out:st=${Math.max(0, d - release)}:d=${release}${extra}`, d);
const kick = (hi, lo, decay, gain, d = decay * 4) => voiceSynth(`${gain}*sin(2*PI*(${lo}*t+(${hi}-${lo})*0.035*(1-exp(-t/0.035))))*exp(-t/${decay})`, d);

// ---- Voice: the take, cut in two at the drop, placed on the plan --------------
const voiceParts = P.voice.map((seg, i) => {
  const path = join(work, `voice${i}.wav`);
  const len = seg.takeEnd - seg.takeStart;
  ff(["-ss", String(seg.takeStart), "-t", String(len), "-i", takeAudio, "-af",
    `afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, len - 0.04)}:d=0.04,highpass=f=80,equalizer=f=3000:t=q:w=1:g=2,aformat=sample_rates=${SR}:channel_layouts=stereo`, path]);
  return [path, seg.at];
});
const delay = (i, at) => `adelay=${Math.round(Math.max(0, at) * 1000)}|${Math.round(Math.max(0, at) * 1000)}`;
const voiceTrack = join(work, "voice.wav");
ff([...voiceParts.flatMap(([p]) => ["-i", p]), "-filter_complex",
  `${voiceParts.map(([, at], i) => `[${i}]${delay(i, at)}[v${i}]`).join(";")};${voiceParts.map((_, i) => `[v${i}]`).join("")}amix=inputs=${voiceParts.length}:normalize=0,apad,atrim=0:${D},acompressor=threshold=0.18:ratio=3:attack=5:release=80:makeup=1.6`,
  "-ar", String(SR), voiceTrack]);

// ---- Bed: a soft groove until the drop, a pad after the reveal ----------------
// GROOVE and PAD set the bed's level under the voice; voice/measure.mjs checks the gap is 8-12 dB.
const GROOVE = 4.8, PAD = 3.0, UNDER_PAD = 1.5;
const grooveKick = kick(110, 50, 0.07, 0.5 * GROOVE);
const hat = noise("white", 0.05, "highpass=f=7500", 0.18 * GROOVE, 0.001, 0.045, 7);
const bedEvents = [];
for (let time = 0; time < E.dropStart - 0.1; time += 0.4) { bedEvents.push([grooveKick, time]); bedEvents.push([hat, time + 0.2]); }
// A steady low pad under the groove until the drop, so the bed does not swing with each kick.
const underLen = E.dropStart - 0.05;
[110.0, 164.81].forEach((f, i) => bedEvents.push([tone(f, underLen, UNDER_PAD, 0.3, 0.12, `,tremolo=f=${2 + i}:d=0.08`), 0]));
const padLen = D - E.reveal;
[220.0, 277.18, 329.63].forEach((f, i) => bedEvents.push([tone(f, padLen, PAD, 0.35, 1.2, `,tremolo=f=${3 + i}:d=0.1`), E.reveal]));
const bedTrack = join(work, "bed.wav");
ff([...bedEvents.flatMap(([p]) => ["-i", p]), "-filter_complex",
  `${bedEvents.map(([, at], i) => `[${i}]${delay(i, at)}[b${i}]`).join(";")};${bedEvents.map((_, i) => `[b${i}]`).join("")}amix=inputs=${bedEvents.length}:normalize=0,apad,atrim=0:${D}`,
  "-ar", String(SR), bedTrack]);

// ---- Effects: on the beats, short and clear of the words' first consonants ---
const whoosh = noise("pink", 0.35, "bandpass=f=1400:w=1.6", 0.45, 0.15, 0.18, 3);
const snareNoise = noise("white", 0.18, "highpass=f=1500,lowpass=f=8000", 0.35, 0.001, 0.17, 5);
const tick = noise("white", 0.016, "highpass=f=2800,lowpass=f=9000", 0.4, 0.0005, 0.015, 11);
const hitKick = kick(150, 46, 0.1, 0.8);
const landKick = kick(180, 40, 0.22, 1.0);
const crash = noise("white", 0.8, "highpass=f=4200,lowpass=f=14000", 0.22, 0.002, 0.78, 13);
const swell = noise("pink", 0.8, "highpass=f=900,lowpass=f=9000", 0.25, 0.75, 0.04, 9);
const revealWhoosh = noise("pink", 0.45, "bandpass=f=900:w=1.2", 0.5, 0.05, 0.4, 15);
const pop = voiceSynth("0.25*sin(2*PI*880*t)*exp(-t/0.06)", 0.3);
// The "4 FPS apart" hit sits under the key words, so it stays well below the voice.
const thud = kick(120, 36, 0.45, 0.45, 2.0);
const bell = voiceSynth("0.12*sin(2*PI*523.25*t)*exp(-t/1.5)+0.05*sin(2*PI*1306*t)*exp(-t/0.6)+0.02*sin(2*PI*1770*t)*exp(-t/0.35)", 2.6);
const pluck = (f) => voiceSynth(`0.24*sin(2*PI*${f}*t)*exp(-t/0.35)+0.06*sin(2*PI*${2 * f}*t)*exp(-t/0.15)`, 1.0);
const fx = [];
// The push into the screen: a rising whoosh across the move, a soft thump as the screen fills the frame.
const entryLen = E.entry[1] - E.entry[0];
const entryWhoosh = noise("pink", entryLen + 0.15, "bandpass=f=1200:w=1.4", 0.5, entryLen * 0.8, 0.2, 21);
fx.push([entryWhoosh, E.entry[0]], [kick(120, 50, 0.08, 0.55), E.entry[1] - 0.02]);
// Four results, each with its own colour, so the beats are not one repeated tick.
const spotHits = [
  [hitKick, snareNoise],
  [kick(170, 52, 0.09, 0.75), noise("white", 0.12, "highpass=f=2500,lowpass=f=9000", 0.3, 0.001, 0.11, 6)],
  [kick(140, 44, 0.11, 0.8), whoosh],
  [kick(160, 48, 0.1, 0.8), pluck(587.33)],
];
E.spots.forEach((s, i) => { for (const p of spotHits[i]) fx.push([p, s - 0.03]); });
// The segments filling between results: a light tick per step.
const rolls = [[E.spots[1], 5], [E.spots[2], 2], [E.spots[3], 8], [E.rollTo20, 4]];
for (const [at, steps] of rolls) for (let k = 1; k <= Math.min(steps, 6); k++) fx.push([tick, at + (0.22 * k) / Math.min(steps, 6)]);
fx.push([swell, E.land - 0.78], [landKick, E.land], [crash, E.land]);
// The reveal: both averages land together on one hit; the gap lands on a low thud.
fx.push([revealWhoosh, E.reveal - 0.05], [kick(130, 42, 0.16, 0.7), E.numbers - 0.02], [pop, E.numbers]);
fx.push([thud, E.apart], [bell, E.apart + 0.01]);
const pullWhoosh = noise("pink", 0.9, "bandpass=f=800:w=1.2", 0.35, 0.1, 0.7, 23);
fx.push([pullWhoosh, E.pullBack], [pluck(659.25), E.question - 0.03], [pluck(783.99), E.lastWord + 0.05]);
const fxTrack = join(work, "fx.wav");
ff([...fx.flatMap(([p]) => ["-i", p]), "-filter_complex",
  `${fx.map(([, at], i) => `[${i}]${delay(i, at)}[f${i}]`).join(";")};${fx.map((_, i) => `[f${i}]`).join("")}amix=inputs=${fx.length}:normalize=0,apad,atrim=0:${D}`,
  "-ar", String(SR), fxTrack]);

// ---- Mix: bed and effects ducked under the voice; voice on top ----------------
// BED_GAIN and FX_GAIN set the level under speech (measured afterwards by voice/measure.mjs).
const BED_GAIN = 0.32, FX_GAIN = 0.75;
const premix = join(work, "premix.wav");
ff(["-i", voiceTrack, "-i", bedTrack, "-i", fxTrack, "-filter_complex",
  `[0]asplit=3[vkey1][vkey2][vout];` +
  `[1]volume=${BED_GAIN}[bed];[bed][vkey1]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=600[bedd];` +
  `[2]volume=${FX_GAIN}[fx];[fx][vkey2]sidechaincompress=threshold=0.03:ratio=3:attack=5:release=150[fxd];` +
  `[vout][bedd][fxd]amix=inputs=3:normalize=0,highpass=f=35`,
  "-ar", String(SR), premix]);
const report = execFileSync("sh", ["-c", `ffmpeg -hide_banner -i "${premix}" -af loudnorm=I=-15:TP=-1.5:LRA=11:print_format=json -f null - 2>&1`]).toString();
const m = JSON.parse(report.slice(report.lastIndexOf("{"), report.lastIndexOf("}") + 1));
const out = join(root, "public", "monitor-mix.wav");
ff(["-i", premix, "-af", `loudnorm=I=-15:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset},alimiter=limit=0.78:attack=1:release=60:level=disabled`, "-ar", String(SR), out]);
// Stems with the same ducking, for measuring the voice-to-bed and voice-to-effects gaps during speech.
for (const [name, input, gain, sc] of [["bed-ducked", bedTrack, BED_GAIN, "threshold=0.02:ratio=6:attack=15:release=600"], ["fx-ducked", fxTrack, FX_GAIN, "threshold=0.03:ratio=3:attack=5:release=150"]]) {
  ff(["-i", voiceTrack, "-i", input, "-filter_complex", `[1]volume=${gain}[x];[x][0]sidechaincompress=${sc}[out]`, "-map", "[out]", "-ar", String(SR), join(work, `${name}.wav`)]);
}
console.log(`wrote ${out}; stems in ${work} (premix ${m.input_i} LUFS)`);
