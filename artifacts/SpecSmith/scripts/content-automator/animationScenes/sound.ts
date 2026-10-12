// The shared sound effects: short, restrained cues synthesized by ffmpeg (no
// samples, no music, no whooshes), and the mix that places them on the frames
// their actions are seen. Levels are absolute sample peaks, set so a narration
// mastered later to -16 LUFS stays well above them; the mix is not
// loudness-normalized (normalizing an effects-only track would make every
// click loud). The RAM Short uses these same recipes (nextVideoRamSeat/soundMix.ts).

import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

export type CueKind = "button" | "plug" | "tick" | "tap" | "snap" | "switch";

/** Each kind's sound as an ffmpeg lavfi source, before level. */
export const RECIPES: Readonly<Record<CueKind, string>> = {
  button: "anoisesrc=d=0.05:c=white:r=48000:a=0.5:seed=11,highpass=f=1500,lowpass=f=7000,afade=t=out:st=0.003:d=0.047:curve=exp",
  plug: "aevalsrc='0.6*sin(2*PI*120*t)*exp(-t*28)+0.45*sin(2*PI*420*t)*exp(-t*45)+0.2*sin(2*PI*900*t)*exp(-t*70)':d=0.2:s=48000",
  tick: "sine=f=1800:d=0.03:r=48000,afade=t=out:st=0.004:d=0.026",
  tap: "anoisesrc=d=0.04:c=pink:r=48000:a=0.5:seed=5,highpass=f=300,lowpass=f=1800,afade=t=out:st=0.003:d=0.037:curve=exp",
  // A short bright transient over a fast-decaying ring: a clip or latch catching.
  snap: "aevalsrc='(0.9*sin(2*PI*2600*t)+0.5*sin(2*PI*4100*t))*exp(-t*110)+0.35*(random(0)*2-1)*exp(-t*400)':d=0.06:s=48000,highpass=f=900",
  // A rocker switch: a low clunk with a little click on top.
  switch: "aevalsrc='0.7*sin(2*PI*190*t)*exp(-t*60)+0.4*(random(0)*2-1)*exp(-t*260)':d=0.08:s=48000,lowpass=f=3200",
};

/** Default target sample peak of each kind, dBFS. The clearest cue of a cut should be the snap. */
export const PEAK_DBFS: Readonly<Record<CueKind, number>> = { snap: -12, plug: -20, switch: -22, button: -23, tap: -26, tick: -30 };

export interface MixCue { readonly recipe: string; readonly peakDbfs: number; readonly at: number }

export function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    const err: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolvePromise(Buffer.concat(err).toString("utf8")) : reject(new Error(`${command} exited ${code}: ${Buffer.concat(err).toString("utf8").slice(-600)}`)));
  });
}
async function peakDb(path: string): Promise<number> {
  const log = await run("ffmpeg", ["-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"]);
  const m = log.match(/max_volume: (-?[\d.]+) dB/);
  if (!m) throw new Error(`No peak measured for ${path}.`);
  return Number(m[1]);
}

/** Places each cue on its frame, at its measured-then-gained peak, and muxes the track under the silent picture. */
export async function mixCues(cues: readonly MixCue[], durationSeconds: number, silentVideo: string, outVideo: string, workDir: string): Promise<void> {
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  const gains = new Map<string, number>();
  for (const recipe of new Set(cues.map((c) => c.recipe))) {
    const raw = join(workDir, `r${gains.size}.wav`);
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", recipe, "-ac", "1", "-ar", "48000", raw]);
    gains.set(recipe, await peakDb(raw));
  }
  const d = durationSeconds;
  const sources = [`anullsrc=r=48000:cl=mono,atrim=0:${d.toFixed(3)}[base]`];
  cues.forEach((cue, i) => sources.push(`${cue.recipe},volume=${(cue.peakDbfs - gains.get(cue.recipe)!).toFixed(2)}dB,adelay=${Math.round(cue.at * 1000)}:all=1[c${i}]`));
  const graph = `${sources.join(";")};[base]${cues.map((_, i) => `[c${i}]`).join("")}amix=inputs=${cues.length + 1}:duration=first:normalize=0,atrim=0:${d.toFixed(3)}[out]`;
  const track = join(workDir, "effects.wav");
  await run("ffmpeg", ["-v", "error", "-y", "-filter_complex", graph, "-map", "[out]", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s24le", track]);
  await run("ffmpeg", ["-v", "error", "-y", "-i", silentVideo, "-i", track, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-t", d.toFixed(3), "-movflags", "+faststart", outVideo]);
  await rm(workDir, { recursive: true, force: true });
}
