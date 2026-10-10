#!/usr/bin/env tsx
// The voiced two-checks cut, timed to the ONE saved Liam take.
//
// Nothing here generates audio: the take is loaded from take/ (bytes and
// timestamps checked against the pin in liamTake.ts) and the picture is timed
// to Liam's actual words, from the provider's character timestamps:
//   - the opening (dead press, the glimpse) keeps its silent-draft timing; the
//     voice is offset so "No power?" lands on the dead press and "Check the
//     power supply switch." begins as the picture returns to the dead PC;
//   - the take is placed in two stretches, split in Liam's silence before "PC
//     on, but no picture?", so that line waits for the light-up (the picture
//     needs ~1.8 s after "I is on."); no word is cut, stretched or re-spoken;
//   - the zoom lands on the switch as "O is off." starts, and the switch flips
//     on the "I" of "I is on.";
//   - the PC lights up just before "PC on, but no picture?", whose headline
//     comes in with the line; the ports close-up lands on "graphics card";
//   - the cable comes out on "that your monitor" and seats on "into its ports";
//   - the camera then backs out to both spots and holds briefly.
// A soft click marks each button press and the switch, and a startup tone the
// light-up (soundEffects.ts, at the track's fixed low mix gain); they carry the
// pauses. The mix is mastered to -16 LUFS integrated, true peak at most
// -1.5 dBTP, measured on the encode. The silent draft is left as it is.
//
//   SPECSMITH_RENDER_CHROMIUM=/opt/pw-browsers/chromium \
//   pnpm exec tsx scripts/content-automator/nextVideoTwoChecks/finalCut.ts

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { masterToLoudness, measureLoudness, mixAudio } from "../motionCompositor.ts";
import { SOUND_RECIPES, soundTrackArgs, type SoundCue } from "../soundEffects.ts";
import { FPS, renderComboDraft, type ComboCut, type ComboTiming } from "./comboDraft.ts";
import { loadTwoChecksTake, type Alignment } from "./liamTake.ts";
import { TWO_CHECKS_TAKE_TEXT } from "./script.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const TAKE_DIR = join(here, "take");
export const FINAL_DIR = resolve(here, "../../../render-output/two-checks-final");
export const FINAL_LOUDNESS = Object.freeze({ integratedLufs: -16, truePeakDbtp: -1.5, toleranceLu: 0.3 });
/** How long the closing view holds once the camera has backed out: the breath after the last word. */
export const CLOSE_HOLD_SECONDS = 0.55;
/** The cable's three motions: out of the motherboard port, carried across, pushed into the graphics card's. */
export const UNPLUG_SECONDS = 0.25, SEAT_SECONDS = 0.2, MIN_CARRY_SECONDS = 0.45;

const round = (x: number) => Math.round(x * 1000) / 1000;
const toFrame = (x: number) => Math.round(x * FPS) / FPS;

/** Where a phrase of the approved text starts and ends in the take (seconds, before the offset). */
export function phraseTimes(alignment: Alignment, phrase: string): { start: number; end: number } {
  if (alignment.characters.join("") !== TWO_CHECKS_TAKE_TEXT) throw new Error("The timestamps do not spell the approved text.");
  const at = TWO_CHECKS_TAKE_TEXT.indexOf(phrase);
  if (at < 0 || TWO_CHECKS_TAKE_TEXT.indexOf(phrase, at + 1) >= 0) throw new Error(`"${phrase}" is not a unique phrase of the approved text.`);
  return { start: alignment.character_start_times_seconds[at], end: alignment.character_end_times_seconds[at + phrase.length - 1] };
}

/** One stretch of the take placed on the cut's timeline: take seconds [from, to) play from `from + offset`. */
export interface VoiceSegment { readonly from: number; readonly to: number; readonly offset: number }

/**
 * The voiced cut's timing, captions and voice placement from the take's timestamps: every later event follows
 * Liam's words. The take is placed in two stretches, split in the silence before "PC on, but no picture?": the
 * picture needs about 1.8 s after "I is on." to back out, turn, press and light up, longer than a natural pause,
 * so the second stretch waits for the light-up. Nothing is cut from or added to his words.
 */
export function cutFromTake(alignment: Alignment): ComboCut & { readonly voice: readonly VoiceSegment[] } {
  const raw = (phrase: string) => phraseTimes(alignment, phrase);
  // The opening is fixed (dead press 0-0.55 s, glimpse 0.55-1.15 s). "No power?" lands on the dead press; the
  // second line must not start over the glimpse.
  const offsetA = round(Math.max(0.15 - raw("No power?").start, 1.15 - raw("Check the power supply switch.").start));
  if (raw("No power?").start + offsetA > 0.45) throw new Error("The take's first pause is too long: \"No power?\" would miss the dead press.");
  const a = (phrase: string) => ({ start: round(raw(phrase).start + offsetA), end: round(raw(phrase).end + offsetA) });

  const where = a("Check the power supply switch."), off = a("O is off."), on = a("I is on.");
  // Check 1: turn, then close on the switch as "O is off." starts; flip on "I".
  const zoomIn: [number, number] = [round(off.start - 0.55), round(off.start - 0.05)];
  const turnLength = zoomIn[0] - 1.5;
  if (turnLength < 0.45) throw new Error("\"O is off.\" comes too soon after the opening to turn the case to the back.");
  const turn1: [number, number] = turnLength <= 0.85 ? [1.5, zoomIn[0]] : [round(zoomIn[0] - 0.8), zoomIn[0]];
  const pullOut: [number, number] = [1.15, round(Math.min(Math.max(turn1[0], 1.5), 1.75))];
  const flip = on.start;
  if (flip < zoomIn[1] + 0.25) throw new Error("\"I is on.\" comes before the close-up on the switch has landed.");
  const finger = round(Math.max(flip - 0.55, zoomIn[1] + 0.05));

  // Back to the front: "I = ON" holds 0.5 s, then out, turn, press, light. The second stretch of the take starts
  // so "PC on, but no picture?" begins 0.3 s after the light-up (or later, if Liam's own pause is longer).
  const zoomOut: [number, number] = [round(flip + 0.5), round(flip + 0.8)];
  const turn2: [number, number] = [zoomOut[1], round(zoomOut[1] + 0.55)];
  const press2 = round(turn2[1] + 0.15), light = round(press2 + 0.1);
  const split = round((raw("I is on.").end + raw("PC on, but no picture?").start) / 2);
  const offsetB = round(Math.max(offsetA, light + 0.3 - raw("PC on, but no picture?").start));
  const b = (phrase: string) => ({ start: round(raw(phrase).start + offsetB), end: round(raw(phrase).end + offsetB) });
  const symptom = b("PC on, but no picture?"), cable = b("If you have a graphics card,"), check = b("check that your monitor"), last = b("into its ports.");
  const head2 = round(Math.max(light + 0.2, symptom.start - 0.1));

  // Check 2: turn during the question; a slow push to the ports lands on "graphics card".
  const turn3: [number, number] = [round(Math.max(head2 + 0.15, symptom.start + 0.15)), 0];
  turn3[1] = round(turn3[0] + 0.6);
  const gfx = b("graphics card").start;
  const zoomPortsEnd = round(Math.max(turn3[1] + 0.35, gfx - 0.1));
  const zoomPorts: [number, number] = [round(Math.max(turn3[1], zoomPortsEnd - 0.9)), zoomPortsEnd];
  // The cable: the unplug starts exactly on "that your monitor" and the plug is seated on "into its ports". Both
  // ends are fixed to the words; the carry between them takes whatever time Liam leaves (never moving the unplug).
  const pull = b("that your monitor").start, travel = round(pull + UNPLUG_SECONDS);
  const seated = round(last.start + 0.1), push = round(seated - SEAT_SECONDS);
  if (push - travel < MIN_CARRY_SECONDS) throw new Error(`Only ${round(push - travel)} s between "that your monitor" and "into its ports" to carry the cable; it needs ${MIN_CARRY_SECONDS} s.`);
  if (pull < zoomPorts[1] + 0.15) throw new Error("The cable would move before the ports close-up has landed.");

  // The camera backs out on the last word (its timestamp runs past where the sound fades), then holds briefly.
  const zoomOut2: [number, number] = [round(Math.max(last.end - 0.35, seated + 0.35)), 0];
  zoomOut2[1] = round(zoomOut2[0] + 0.4);
  const final = zoomOut2[1];
  const durationSeconds = toFrame(final + CLOSE_HOLD_SECONDS);

  const timing: ComboTiming = {
    durationSeconds, press1: 0.12, glimpse: [0.55, 1.15],
    pullOut, turn1, zoomIn, finger, flip, zoomOut, turn2, press2, light,
    turn3, zoomPorts, pull, travel, push, seated, zoomOut2, final, head2,
  };
  const captions = [
    { from: 0, to: 0.55, text: "No power?" },
    { from: 0.55, to: where.start, text: "" },
    { from: where.start, to: off.start, text: "Check the power supply switch." },
    { from: off.start, to: flip, text: "O is off." },
    { from: flip, to: round(symptom.start - 0.1), text: "I is on." },
    { from: round(symptom.start - 0.1), to: cable.start, text: "PC on, but no picture?" },
    { from: cable.start, to: check.start, text: "If you have a graphics card," },
    { from: check.start, to: durationSeconds, text: "check that your monitor is plugged into its ports." },
  ];
  const voice: VoiceSegment[] = [{ from: 0, to: split, offset: offsetA }, { from: split, to: Infinity, offset: offsetB }];
  return { timing, captions, videoName: "two-checks-picture.mp4", voice };
}

/** The ffmpeg filter that places the take's stretches on the timeline, with 10 ms fades at each cut (in silence). */
export function voicePlacementFilter(voice: readonly VoiceSegment[]): string {
  const parts = voice.map((segment, i) => {
    const trim = Number.isFinite(segment.to) ? `atrim=start=${segment.from}:end=${segment.to}` : `atrim=start=${segment.from}`;
    const fades = `afade=t=in:d=0.01${Number.isFinite(segment.to) ? `,areverse,afade=t=in:d=0.01,areverse` : ""}`;
    return `[0:a]${trim},asetpts=PTS-STARTPTS,${fades},adelay=${Math.round((segment.from + segment.offset) * 1000)}:all=1[v${i}]`;
  });
  return `${parts.join(";")};${voice.map((_, i) => `[v${i}]`).join("")}amix=inputs=${voice.length}:normalize=0:duration=longest,apad[out]`;
}

/** Restrained sounds: a soft click on each press and on the switch, a startup tone as the PC lights. */
export function soundCuesFor(timing: ComboTiming): SoundCue[] {
  return [
    { atSecond: timing.press1, kind: "click", reason: "the power button is pressed; nothing happens" },
    { atSecond: timing.flip, kind: "click", reason: "the power supply switch flips from O to I" },
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
  const take = await loadTwoChecksTake(TAKE_DIR);
  const alignment = take.manifest.alignment as Alignment;
  const cut = cutFromTake(alignment);
  const duration = cut.timing.durationSeconds;
  await mkdir(outputDir, { recursive: true });
  const picture = await renderComboDraft(outputDir, cut);
  const work = join(outputDir, "audio-work");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });

  const voice = join(work, "voice.wav"), sfx = join(work, "sfx.wav"), mix = join(work, "mix.wav"), mastered = join(work, "mastered.wav");
  await run("ffmpeg", ["-v", "error", "-y", "-i", take.audioPath, "-filter_complex", voicePlacementFilter(cut.voice), "-map", "[out]", "-t", duration.toFixed(3), "-ar", "48000", "-ac", "1", "-c:a", "pcm_s24le", voice]);
  const cues = soundCuesFor(cut.timing);
  await run("ffmpeg", soundTrackArgs(cues, duration, sfx));
  await mixAudio({ ffmpegPath: "ffmpeg", voicePath: voice, musicPath: sfx, durationSeconds: duration, outputPath: mix, timeoutMs: 120_000 });

  const videoPath = join(outputDir, "two-checks-final.mp4");
  const mastering = await masterToLoudness({
    ffmpegPath: "ffmpeg", mixPath: mix, masteredPath: mastered, target: FINAL_LOUDNESS, timeoutMs: 120_000,
    encode: async (masteredPath) => {
      await run("ffmpeg", ["-v", "error", "-y", "-i", picture.videoPath, "-i", masteredPath, "-map", "0:v", "-map", "1:a",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-t", duration.toFixed(3), "-movflags", "+faststart", videoPath]);
      return videoPath;
    },
  });
  const final = await measureLoudness("ffmpeg", videoPath);
  const sheet = join(outputDir, "phone-every-0.25s.png");
  await run("ffmpeg", ["-v", "error", "-y", "-i", videoPath, "-vf", "fps=4,scale=180:320:flags=lanczos,tile=14x4:padding=4:color=0x2A2A33", "-frames:v", "1", sheet]);
  await rm(work, { recursive: true, force: true });

  const report = {
    label: "VOICED CUT from the one approved Liam take. Stylized illustration, not a fix for every PC. Not published.",
    video: { path: videoPath, sha256: sha256(await readFile(videoPath)), durationSeconds: duration, fps: FPS },
    picture: { sha256: picture.sha256, minFontPx: picture.minFinalPx },
    take: { file: "nextVideoTwoChecks/take/two-checks-liam.mp3", sha256: take.sha256, lineTimings: take.lineTimings, voicePlacement: cut.voice.map((segment) => ({ ...segment, to: Number.isFinite(segment.to) ? segment.to : "end" })) },
    timing: cut.timing,
    captions: cut.captions,
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
