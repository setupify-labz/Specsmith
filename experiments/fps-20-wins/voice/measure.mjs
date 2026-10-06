// Measures the finished mix: loudness and peaks, the voice-to-bed gap during
// speech, and that the drop before the reveal is silent.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const P = JSON.parse(readFileSync(join(root, "src", "voiceplan.json"), "utf8"));
const file = process.argv[2] ?? join(root, "public", "voiced-mix.wav");
const work = join(root, "out", "voiced-parts");
const run = (args) => execFileSync("sh", ["-c", `ffmpeg -hide_banner -nostats ${args} 2>&1`]).toString();
const rms = (path, from, to) => {
  const out = run(`-ss ${from} -t ${Math.max(0.05, to - from)} -i "${path}" -af astats=measure_overall=RMS_level:measure_perchannel=none -f null -`);
  const m = [...out.matchAll(/RMS level dB: (-?[\d.inf]+)/g)].at(-1);
  return m ? Number(m[1]) : NaN;
};
const r128 = run(`-i "${file}" -af ebur128=peak=true -f null -`);
const I = r128.match(/I:\s+(-?[\d.]+) LUFS/g)?.at(-1);
const TP = r128.match(/Peak:\s+(-?[\d.]+) dBFS/g)?.at(-1);
console.log(`loudness ${I}; true peak ${TP}`);
// Voice vs the bed, and vs the effects, over each spoken line (stems are pre-loudnorm; the difference is what matters).
const spoken = (c) => [c.start, Math.min(c.end, c.spokenEnd ?? c.end)];
console.log("  bed gap  fx gap  line");
for (const c of P.captions) {
  const [a, b] = spoken(c);
  const v = rms(join(work, "voice.wav"), a, b);
  const bed = v - rms(join(work, "bed-ducked.wav"), a, b);
  const fx = v - rms(join(work, "fx-ducked.wav"), a, b);
  const f = (x) => (Number.isFinite(x) ? (Math.round(x * 10) / 10).toFixed(1) : "  inf").padStart(7);
  console.log(`${f(bed)} ${f(fx)}  ${c.show}`);
}
const drop = rms(file, P.events.dropStart + 0.1, P.events.reveal - 0.1);
console.log(`drop ${P.events.dropStart}-${P.events.reveal}s: ${drop} dB RMS`);
