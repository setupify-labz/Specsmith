#!/usr/bin/env tsx
// The voiced "PC won't turn on?" cut, timed to the ONE saved Liam take.
//
// Nothing here generates audio: the take is loaded from take/ (bytes checked
// against its manifest, text and voice checked against the approval) and the
// picture is timed to Liam's actual delivery, from the provider's character
// timestamps. Each caption changes when its line starts; the case turns to the
// back as "Check the switch…" begins, the zoom lands as "O is off." starts,
// the switch flips on "I", and the PC lights up after the last word, then
// holds. A synthesized click marks each press and the flip, and a soft startup
// tone the light-up (soundEffects.ts); they carry the final pause, not another line.
// The mix is mastered to -16 LUFS integrated, true peak at most -1.5 dBTP,
// measured on the encode. If rendering fails, rerun this: the take is reused.
//
//   SPECSMITH_RENDER_CHROMIUM=/opt/pw-browsers/chromium \
//   pnpm exec tsx scripts/content-automator/nextVideoPowerSwitch/finalCut.ts

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { masterToLoudness, measureLoudness, mixAudio } from "../motionCompositor.ts";
import { SOUND_RECIPES, soundTrackArgs, type SoundCue } from "../soundEffects.ts";
import { loadPowerSwitchTake, type LineTiming } from "./liamTake.ts";
import { FPS, renderOpeningTest, type CutTiming } from "./openingTest.ts";
import { APPROVED_POWER_SWITCH_LINES } from "./script.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const TAKE_DIR = join(here, "take");
export const FINAL_DIR = resolve(here, "../../../render-output/power-switch-final");
/** The voice starts this long after frame one, so the dead press is seen first. */
export const VOICE_OFFSET_SECONDS = 0.3;
/** How long the lit PC holds after it lights up: the payoff's breathing room. */
export const PAYOFF_HOLD_SECONDS = 1.8;
export const FINAL_LOUDNESS = Object.freeze({ integratedLufs: -16, truePeakDbtp: -1.5, toleranceLu: 0.3 });

const round = (x: number) => Math.round(x * 1000) / 1000;
const toFrame = (x: number) => Math.round(x * FPS) / FPS;

/** The cut's timing from the take's line timings: every event follows Liam's words. */
export function timingFromTake(lines: readonly LineTiming[], offset = VOICE_OFFSET_SECONDS): CutTiming {
  const at = Object.fromEntries(lines.map((line) => [line.id, { start: line.start + offset, end: line.end + offset }]));
  for (const id of ["hook", "where", "off", "on"]) if (!at[id]) throw new Error(`The take has no "${id}" line.`);
  const turn1: [number, number] = [round(at.where.start - 0.6), round(at.where.start - 0.2)];
  const zoomIn: [number, number] = [round(at.off.start - 0.35), round(at.off.start - 0.05)];
  const flip = round(at.on.start);
  const zoomOut: [number, number] = [round(at.on.end - 0.1), round(at.on.end + 0.2)];
  const turn2: [number, number] = [zoomOut[1], round(zoomOut[1] + 0.4)];
  const press2 = round(turn2[1] + 0.15);
  const light = round(press2 + 0.1);
  const durationSeconds = toFrame(light + PAYOFF_HOLD_SECONDS);
  if (!(turn1[0] > at.hook.end - 0.05 && zoomIn[0] > turn1[1] + 0.8 && flip > zoomIn[1] + 0.5)) {
    throw new Error("The take's lines are too close together to stage the turn, the held back view and the flip.");
  }
  const text = (id: string) => APPROVED_POWER_SWITCH_LINES.find((line) => line.id === id)!.spoken;
  return {
    durationSeconds, press1: 0.15, turn1, backHold: [turn1[1], zoomIn[0]], zoomIn, flip, zoomOut, turn2, press2, light,
    captions: [
      { from: 0, to: turn1[1], text: text("hook") },
      { from: turn1[1], to: round(at.off.start), text: text("where") },
      { from: round(at.off.start), to: flip, text: text("off") },
      { from: flip, to: durationSeconds, text: text("on") },
    ],
  };
}

/** The sounds: a soft click on each press and on the flip, a startup tone as the PC lights. */
export function soundCuesFor(timing: CutTiming): SoundCue[] {
  return [
    { atSecond: timing.press1, kind: "click", reason: "the power button is pressed; nothing happens" },
    { atSecond: timing.flip, kind: "click", reason: "the switch flips from O to I" },
    { atSecond: timing.press2, kind: "click", reason: "the power button is pressed again" },
    { atSecond: timing.light, kind: "startup", reason: "the PC lights up" },
  ];
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    const err: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited ${code}: ${Buffer.concat(err).toString("utf8").slice(-600)}`)));
  });
}
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export async function renderFinalCut(outputDir = FINAL_DIR) {
  const take = await loadPowerSwitchTake(TAKE_DIR);
  const timing = timingFromTake(take.lineTimings);
  const duration = timing.durationSeconds;
  // Picture: the same renderer as the silent cut, timed to the take. (It uses and removes outputDir/work.)
  const picture = await renderOpeningTest(outputDir, timing, "power-switch-picture.mp4");
  const work = join(outputDir, "audio-work");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });

  // Sound: the take, offset; the two effects at the track's fixed mix gain.
  const voice = join(work, "voice.wav"), sfx = join(work, "sfx.wav"), mix = join(work, "mix.wav"), mastered = join(work, "mastered.wav");
  await run("ffmpeg", ["-v", "error", "-y", "-i", take.audioPath, "-af", `adelay=${Math.round(VOICE_OFFSET_SECONDS * 1000)}:all=1,apad`, "-t", duration.toFixed(3), "-ar", "48000", "-ac", "1", "-c:a", "pcm_s24le", voice]);
  const cues = soundCuesFor(timing);
  await run("ffmpeg", soundTrackArgs(cues, duration, sfx));
  await mixAudio({ ffmpegPath: "ffmpeg", voicePath: voice, musicPath: sfx, durationSeconds: duration, outputPath: mix, timeoutMs: 120_000 });

  const videoPath = join(outputDir, "power-switch-final.mp4");
  const mastering = await masterToLoudness({
    ffmpegPath: "ffmpeg", mixPath: mix, masteredPath: mastered, target: FINAL_LOUDNESS, timeoutMs: 120_000,
    encode: async (masteredPath) => {
      await run("ffmpeg", ["-v", "error", "-y", "-i", picture.videoPath, "-i", masteredPath, "-map", "0:v", "-map", "1:a",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-t", duration.toFixed(3), "-movflags", "+faststart", videoPath]);
      return videoPath;
    },
  });
  const final = await measureLoudness("ffmpeg", videoPath);

  // Phone-size checks of the voiced cut.
  const sheet = join(outputDir, "phone-every-0.2s.png");
  await run("ffmpeg", ["-v", "error", "-y", "-i", videoPath, "-vf", "fps=5,scale=180:320:flags=lanczos,tile=10x4:padding=4:color=0x2A2A33", "-frames:v", "1", sheet]);
  await rm(work, { recursive: true, force: true });

  const report = {
    label: "VOICED CUT from the one approved Liam take. Stylized illustration, not a fix for every PC. Not published.",
    video: { path: videoPath, sha256: sha256(await readFile(videoPath)), durationSeconds: duration, fps: FPS },
    picture: { sha256: picture.sha256, minFontPx: picture.minFinalPx },
    take: { file: "nextVideoPowerSwitch/take/power-switch-liam.mp3", sha256: take.sha256, lineTimings: take.lineTimings, voiceOffsetSeconds: VOICE_OFFSET_SECONDS },
    timing,
    sound: { cues: cues.map((cue) => ({ ...cue, seconds: SOUND_RECIPES[cue.kind].seconds })), madeBy: "soundEffects.ts (synthesized by ffmpeg; no samples)" },
    loudness: { ...mastering, measuredOnDelivered: final },
    phoneSheet: sheet,
  };
  await writeFile(join(outputDir, "final-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  renderFinalCut().then((report) => {
    console.log(report.label);
    console.log(`video: ${report.video.path} (${report.video.durationSeconds.toFixed(2)} s)`);
    console.log(`sha256: ${report.video.sha256}`);
    console.log(`loudness: ${report.loudness.measuredOnDelivered.integratedLufs} LUFS, ${report.loudness.measuredOnDelivered.truePeakDbtp} dBTP`);
    console.log(`timing: ${JSON.stringify(report.timing)}`);
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
