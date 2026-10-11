#!/usr/bin/env tsx
// Restrained sound effects for the RAM-seating Short, one per visible action,
// synthesized by ffmpeg (no samples, no music, no whooshes).
//
//   button   a soft click as the finger presses the power button (on, then off)
//   fan      a quiet fan hum while the fans spin, slowing away at shutdown
//   plug     a dull plug sound as the cord leaves the power supply, and as it goes back in
//   tick     a faint tick as the notch lines up with the slot's ridge
//   tap      a soft tap as the stick settles onto the slot
//   snap     the clips snapping shut: two crisp clicks, one per clip, the CLEAREST cue
//
// No startup tone or any sound of a PC booting: the video ends before anyone
// presses the button, so nothing may suggest that it booted.
//
// LEVELS are absolute sample peaks in the delivered file, set so a narration
// mastered later to -16 LUFS (peaks around -3 to -1 dBFS) stays well above them:
// the snap peaks at -12 dBFS, everything else at -20 dBFS or lower, the fan hum
// lower still. The mix is not loudness-normalized on its own; normalizing a
// sound-effects-only track up to -16 LUFS would make every click loud.
//
//   SPECSMITH_RENDER_CHROMIUM=/opt/pw-browsers/chromium \
//   pnpm exec tsx scripts/content-automator/nextVideoRamSeat/soundMix.ts

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { OUTPUT_DIR, renderSilentCut, TIMING } from "./silentCut.ts";

export type CueKind = "button" | "fan" | "plug" | "tick" | "tap" | "snap";
export interface Cue { readonly kind: CueKind; readonly at: number; readonly seconds: number; readonly reason: string }

/** Target sample peak of each kind in the delivered file, dBFS. The snap is the loudest by design. */
export const PEAK_DBFS: Readonly<Record<CueKind, number>> = { snap: -12, plug: -20, button: -23, tap: -26, tick: -30, fan: -34 };

const fanSeconds = TIMING.fansOff[1] - TIMING.light;
/** Each kind's sound as an ffmpeg lavfi source, before level. */
export const RECIPES: Readonly<Record<CueKind, string>> = {
  button: "anoisesrc=d=0.05:c=white:r=48000:a=0.5:seed=11,highpass=f=1500,lowpass=f=7000,afade=t=out:st=0.003:d=0.047:curve=exp",
  fan: `anoisesrc=d=${fanSeconds.toFixed(3)}:c=brown:r=48000:a=0.5:seed=7,highpass=f=180,lowpass=f=900,afade=t=in:st=0:d=0.35,` +
    `afade=t=out:st=${(TIMING.fansOff[0] - TIMING.light).toFixed(3)}:d=${(TIMING.fansOff[1] - TIMING.fansOff[0]).toFixed(3)}:curve=qsin`,
  plug: "aevalsrc='0.6*sin(2*PI*120*t)*exp(-t*28)+0.45*sin(2*PI*420*t)*exp(-t*45)+0.2*sin(2*PI*900*t)*exp(-t*70)':d=0.2:s=48000",
  tick: "sine=f=1800:d=0.03:r=48000,afade=t=out:st=0.004:d=0.026",
  tap: "anoisesrc=d=0.04:c=pink:r=48000:a=0.5:seed=5,highpass=f=300,lowpass=f=1800,afade=t=out:st=0.003:d=0.037:curve=exp",
  // One clip: a short bright transient over a fast-decaying ring. The cue places two, 35 ms apart (left and right clip).
  snap: "aevalsrc='(0.9*sin(2*PI*2600*t)+0.5*sin(2*PI*4100*t))*exp(-t*110)+0.35*(random(0)*2-1)*exp(-t*400)':d=0.06:s=48000,highpass=f=900",
};

/** The cues, each on the frame its action is seen. */
export function cues(): Cue[] {
  const T = TIMING;
  return [
    { kind: "button", at: T.press, seconds: 0.05, reason: "the power button is pressed: the PC turns on" },
    { kind: "fan", at: T.light, seconds: fanSeconds, reason: "the fans spin, then slow to a stop at shutdown" },
    { kind: "button", at: T.offPress[0] + 0.05, seconds: 0.05, reason: "the power button is pressed again: shut down" },
    { kind: "plug", at: T.unplug[0] + 0.04, seconds: 0.2, reason: "the cord leaves the power supply" },
    { kind: "tick", at: T.align[1], seconds: 0.03, reason: "the notch lines up with the slot's ridge" },
    { kind: "tap", at: T.lower[1], seconds: 0.04, reason: "the stick settles onto the slot" },
    { kind: "snap", at: T.clips[1] - 0.02, seconds: 0.06, reason: "the first clip snaps shut" },
    { kind: "snap", at: T.clips[1] + 0.015, seconds: 0.06, reason: "the second clip snaps shut" },
    { kind: "plug", at: T.plugIn[1] - 0.06, seconds: 0.2, reason: "the cord goes back into the power supply" },
  ];
}

function run(command: string, args: string[]): Promise<string> {
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

export async function renderWithSound(outputDir = OUTPUT_DIR) {
  const picture = await renderSilentCut(outputDir);
  const work = join(outputDir, "sound-work");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  // Measure each recipe once, so its level is set from its real peak rather than guessed.
  const gains = {} as Record<CueKind, number>;
  for (const kind of Object.keys(RECIPES) as CueKind[]) {
    const raw = join(work, `${kind}.wav`);
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", RECIPES[kind], "-ac", "1", "-ar", "48000", raw]);
    gains[kind] = PEAK_DBFS[kind] - await peakDb(raw);
  }
  const list = cues(), d = TIMING.durationSeconds;
  const sources = [`anullsrc=r=48000:cl=mono,atrim=0:${d.toFixed(3)}[base]`];
  list.forEach((cue, i) => sources.push(`${RECIPES[cue.kind]},volume=${gains[cue.kind].toFixed(2)}dB,adelay=${Math.round(cue.at * 1000)}:all=1[c${i}]`));
  const graph = `${sources.join(";")};[base]${list.map((_, i) => `[c${i}]`).join("")}amix=inputs=${list.length + 1}:duration=first:normalize=0,atrim=0:${d.toFixed(3)}[out]`;
  const track = join(work, "effects.wav");
  await run("ffmpeg", ["-v", "error", "-y", "-filter_complex", graph, "-map", "[out]", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s24le", track]);
  const videoPath = join(outputDir, "ram-seat-sfx.mp4");
  await run("ffmpeg", ["-v", "error", "-y", "-i", picture.videoPath, "-i", track, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-t", d.toFixed(3), "-movflags", "+faststart", videoPath]);
  await rm(work, { recursive: true, force: true });
  return { videoPath, silentPath: picture.videoPath, sha256: createHash("sha256").update(await readFile(videoPath)).digest("hex"), cues: list, peakDbfs: PEAK_DBFS };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  renderWithSound().then((result) => console.log(JSON.stringify({ ...result, cues: result.cues.map((c) => `${c.at.toFixed(2)}s ${c.kind}: ${c.reason}`) }, null, 2))).catch((error) => { console.error(error); process.exitCode = 1; });
}
