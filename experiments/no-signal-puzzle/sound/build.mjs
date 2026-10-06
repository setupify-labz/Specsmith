// Builds public/puzzle-sound.wav: every sound synthesised locally with ffmpeg
// (no samples, no music, no voice), each event placed from src/timeline.json.
// Run: node sound/build.mjs   (needs ffmpeg on PATH)

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
const part = (name, lavfi, filters, seconds) => {
  const path = join(work, `${name}.wav`);
  ff(["-f", "lavfi", "-i", lavfi, "-af", `${filters},aformat=sample_rates=48000:channel_layouts=stereo`, "-t", String(seconds), path]);
  return path;
};

// The sounds.
const fan = part("fan", `anoisesrc=color=pink:seed=3:duration=${T.duration}`, `highpass=f=160,lowpass=f=1300,volume=0.10,afade=t=in:d=0.4`, T.duration);
const thump = part("thump", "sine=frequency=52:duration=0.5", "volume=0.9,afade=t=out:st=0.04:d=0.42", 0.5);
const spin = part("spin", "anoisesrc=color=pink:seed=5:duration=0.9", "highpass=f=300,lowpass=f=2200,volume=0.35,afade=t=in:d=0.5,afade=t=out:st=0.55:d=0.35", 0.9);
const whoosh = part("whoosh", "anoisesrc=color=white:seed=9:duration=0.45", "bandpass=f=900:w=1.4,volume=0.55,afade=t=in:d=0.18,afade=t=out:st=0.2:d=0.25", 0.45);
const tick = part("tick", "sine=frequency=1500:duration=0.06", "volume=0.35,afade=t=out:st=0.005:d=0.05", 0.06);
const rustle = part("rustle", "anoisesrc=color=white:seed=13:duration=0.8", "highpass=f=1800,lowpass=f=5000,volume=0.10,afade=t=in:d=0.2,afade=t=out:st=0.5:d=0.3", 0.8);
const clickHi = part("clickhi", "anoisesrc=color=white:seed=21:duration=0.03", "highpass=f=2500,volume=0.9,afade=t=out:st=0.002:d=0.028", 0.03);
const clickLo = part("clicklo", "sine=frequency=140:duration=0.09", "volume=0.6,afade=t=out:st=0.005:d=0.085", 0.09);
const nope1 = part("nope1", "sine=frequency=220:duration=0.18", "volume=0.22,afade=t=in:d=0.01,afade=t=out:st=0.08:d=0.1", 0.18);
const nope2 = part("nope2", "sine=frequency=165:duration=0.26", "volume=0.22,afade=t=in:d=0.01,afade=t=out:st=0.1:d=0.16", 0.26);
const swellA = part("swellA", "sine=frequency=220:duration=1.8", "volume=0.16,afade=t=in:d=0.45,afade=t=out:st=0.6:d=1.2", 1.8);
const swellB = part("swellB", "sine=frequency=330:duration=1.8", "volume=0.12,afade=t=in:d=0.5,afade=t=out:st=0.6:d=1.2", 1.8);
const swellC = part("swellC", "sine=frequency=440:duration=1.8", "volume=0.10,afade=t=in:d=0.55,afade=t=out:st=0.6:d=1.2", 1.8);
const chime1 = part("chime1", "sine=frequency=659.25:duration=0.9", "volume=0.20,afade=t=in:d=0.01,afade=t=out:st=0.05:d=0.85", 0.9);
const chime2 = part("chime2", "sine=frequency=880:duration=1.1", "volume=0.18,afade=t=in:d=0.01,afade=t=out:st=0.05:d=1.05", 1.1);
const soft = part("soft", "anoisesrc=color=pink:seed=31:duration=0.5", "bandpass=f=600:w=1.2,volume=0.25,afade=t=in:d=0.2,afade=t=out:st=0.2:d=0.3", 0.5);

// Where each one goes.
const events = [
  [fan, 0], [thump, 0], [spin, 0],
  [whoosh, T.front1End - 0.05],
  ...T.ticks.map((tk) => [tick, tk]),
  [rustle, T.cableStart + 0.05],
  [clickHi, T.plugA], [clickLo, T.plugA],
  [nope1, T.plugA + 0.18], [nope2, T.plugA + 0.36],
  [clickHi, T.unplugA], [rustle, T.unplugA + 0.15],
  [clickHi, T.plugB], [clickLo, T.plugB],
  [swellA, T.osd - 0.1], [swellB, T.osd - 0.05], [swellC, T.osd],
  [chime1, T.desktop], [chime2, T.desktop + 0.12],
  [soft, T.takeaway - 0.1],
  [tick, T.signoff],
];

const inputs = events.flatMap(([path]) => ["-i", path]);
const delays = events.map(([, at], i) => `[${i}]adelay=${Math.round(at * 1000)}|${Math.round(at * 1000)}[d${i}]`);
const mix = `${events.map((_, i) => `[d${i}]`).join("")}amix=inputs=${events.length}:normalize=0,atrim=0:${T.duration}`;
const premix = join(work, "premix.wav");
ff([...inputs, "-filter_complex", `${delays.join(";")};${mix}`, "-ar", "48000", premix]);

// Two-pass loudness: -16 LUFS integrated, true peak at most -1.5 dBTP.
const probe = execFileSync("ffmpeg", ["-hide_banner", "-i", premix, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] }).toString()
  || "";
let measured;
try {
  measured = JSON.parse(probe.slice(probe.indexOf("{"), probe.lastIndexOf("}") + 1));
} catch {
  const err = execFileSync("sh", ["-c", `ffmpeg -hide_banner -i "${premix}" -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1`]).toString();
  measured = JSON.parse(err.slice(err.indexOf("{"), err.lastIndexOf("}") + 1));
}
const out = join(root, "public", "puzzle-sound.wav");
ff(["-i", premix, "-af", `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`, "-ar", "48000", out]);
console.log(`wrote ${out} (${events.length} events, premix ${measured.input_i} LUFS / ${measured.input_tp} dBTP)`);
