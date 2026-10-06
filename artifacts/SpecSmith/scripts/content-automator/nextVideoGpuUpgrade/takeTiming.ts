// Times the GPU-upgrade Short to a real Liam take.
//
// A take is used only if it is the approved text, in the pinned Liam voice,
// with the audio its manifest names (by SHA-256) and the provider's character
// timestamps. There is no fallback: without timestamps the edit cannot follow
// the words, so nothing is rendered.
//
// HOW THE EDIT FOLLOWS THE DELIVERY
// The take plays once, unedited, from 0 s: no word is moved, cut or sped up.
// Each later beat (its picture and its caption) starts about LEAD seconds
// before Liam starts its line, and not before he has finished the previous
// one. The last beat holds TAIL seconds after his last word so the closing
// question and link can be read. Every boundary is on a 0.1 s grid: exactly
// three 30 fps frames, and exact in the decimal timings the plan carries, so
// no segment rounds to a different frame count and drifts off its cut.
// The retimed concept then goes back through every workflow check (pacing,
// caption density, evidence, figure binding) before it may be rendered.
//
// The sound effects are placed from the same retimed beats, on the events the
// motion-graphic renderer draws at fixed offsets into each scene.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { REVIEWED_LIAM_VOICE } from "../liamVoice.ts";
import type { SavedTake } from "../savedTakeNarration.ts";
import type { SoundCue } from "../soundEffects.ts";
import {
  APPROVED_GPU_UPGRADE_LINES,
  GPU_TAKE_MANIFEST,
  GPU_TAKE_TEXT,
  lineTimingsFromAlignment,
  type Alignment,
  type LineTiming,
} from "./liamTake.ts";

export class TakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TakeError";
  }
}

export interface LoadedGpuUpgradeTake {
  readonly take: SavedTake;
  readonly alignment: Alignment;
  readonly lineTimings: readonly LineTiming[];
  /** When Liam's last character ends, in take seconds. */
  readonly speechEnd: number;
  readonly providerReportedCharacterCost: number | null;
  readonly manifestPath: string;
}

/** Loads a take only if it is the approved text, in Liam, with the audio its manifest names and its timestamps. */
export async function loadGpuUpgradeTake(dir: string): Promise<LoadedGpuUpgradeTake> {
  const manifestPath = join(dir, GPU_TAKE_MANIFEST);
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    throw new TakeError(`No readable take manifest in ${dir}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (manifest.voiceId !== REVIEWED_LIAM_VOICE.voiceId) throw new TakeError("The take is not the pinned Liam voice. No other voice is used.");
  if (manifest.isFixture !== false) throw new TakeError("The take is marked as a fixture, not a provider take.");
  if (manifest.generatedBy !== "elevenlabs-text-to-speech-with-timestamps") throw new TakeError("The take was not made by the guarded provider request.");
  if (manifest.text !== GPU_TAKE_TEXT || JSON.stringify(manifest.lines) !== JSON.stringify(APPROVED_GPU_UPGRADE_LINES)) {
    throw new TakeError("The take is not the approved script word for word.");
  }
  const audio = manifest.audio as { file?: unknown; sha256?: unknown } | undefined;
  if (!audio || typeof audio.file !== "string" || typeof audio.sha256 !== "string") throw new TakeError("The take manifest names no audio.");
  const audioPath = join(dir, audio.file);
  const bytes = await readFile(audioPath).catch(() => { throw new TakeError(`The take audio ${audio.file} is missing.`); });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== audio.sha256) throw new TakeError("The take audio is not the audio its manifest describes.");
  if (!manifest.alignment) throw new TakeError(`The take has no provider timestamps (${String(manifest.alignmentError ?? "none recorded")}); the edit cannot follow the words, so it is not rendered.`);
  const alignment = manifest.alignment as Alignment;
  let lineTimings: LineTiming[];
  try {
    lineTimings = lineTimingsFromAlignment(alignment);
  } catch (error) {
    throw new TakeError(`The take's timestamps are unusable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    take: {
      audioPath, sha256, provider: "elevenlabs", voiceId: REVIEWED_LIAM_VOICE.voiceId,
      voiceName: String(manifest.voiceUsed ?? "Liam"), modelId: String(manifest.modelId ?? ""),
      providerTextSha256: createHash("sha256").update(GPU_TAKE_TEXT).digest("hex"),
      scriptTextSha256: scriptTextSha256(),
    },
    alignment,
    lineTimings,
    speechEnd: lineTimings.at(-1)!.end,
    providerReportedCharacterCost: typeof manifest.providerReportedCharacterCost === "number" ? manifest.providerReportedCharacterCost : null,
    manifestPath,
  };
}

/**
 * The storyboard narration this take voices, hashed as MASTER #7 hashes a
 * storyboard's narration (review/util.narrationText): each line spoken is its
 * beat's approved narration with only the figures spelled out, which the
 * guarded take checked before any spend and the loader re-checks here.
 */
export function scriptTextSha256(): string {
  const text = APPROVED_GPU_UPGRADE_LINES.map((line) => line.beatNarration.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(text).digest("hex");
}

export const EDIT = Object.freeze({
  /** A beat's picture and caption arrive this long before its first word. */
  lead: 0.15,
  /** ...and not before the previous line's last word, give or take this much (one-and-a-half frames). */
  overlapTolerance: 0.05,
  /** Cuts fall on this grid: three frames at 30 fps. */
  grid: 0.1,
  /** The closing question and link stay this long after the last word. */
  tail: 1.2,
  fps: 30,
  /** The shortest beat the storyboard review allows (MASTER #1 youtube-shorts envelope). */
  minBeat: 1.5,
});

const round3 = (seconds: number) => Math.round(seconds * 1000) / 1000;
const steps = (seconds: number) => seconds / EDIT.grid;
const onGrid = (n: number) => round3(n * EDIT.grid);

export interface RetimedBeat {
  readonly index: number;
  readonly id: LineTiming["id"];
  readonly startSecond: number;
  readonly endSecond: number;
  /** Where Liam says this beat's line, in video seconds (the take starts at 0). */
  readonly lineStart: number;
  readonly lineEnd: number;
}

/** Beat boundaries that follow the take. Refuses a take the edit cannot follow honestly. */
export function retimeBeats(timings: readonly LineTiming[]): RetimedBeat[] {
  if (timings.length !== APPROVED_GPU_UPGRADE_LINES.length) throw new TakeError(`The take has ${timings.length} lines, not ${APPROVED_GPU_UPGRADE_LINES.length}.`);
  const starts = timings.map((timing, index) => {
    if (index === 0) return 0;
    const previousEnd = timings[index - 1].end;
    if (timing.start < previousEnd) throw new TakeError(`Line ${index + 1} starts before line ${index} ends.`);
    // The grid point nearest LEAD before the word, inside [previous word's end, this word's start].
    const low = Math.ceil(steps(previousEnd - EDIT.overlapTolerance) - 1e-9), high = Math.floor(steps(timing.start) + 1e-9);
    if (low > high) throw new TakeError(`Liam leaves no ${EDIT.grid} s cut point between lines ${index} and ${index + 1}; the edit cannot cut there without clipping a word.`);
    return onGrid(Math.min(high, Math.max(low, Math.round(steps(timing.start - EDIT.lead)))));
  });
  const end = onGrid(Math.ceil(steps(timings.at(-1)!.end + EDIT.tail) - 1e-9));
  const beats = timings.map((timing, index) => ({
    index, id: timing.id,
    startSecond: round3(starts[index]),
    endSecond: round3(index + 1 < starts.length ? starts[index + 1] : end),
    lineStart: round3(timing.start), lineEnd: round3(timing.end),
  }));
  for (const beat of beats) {
    if (beat.endSecond - beat.startSecond < EDIT.minBeat - 1e-9) {
      throw new TakeError(`Beat ${beat.index + 1} would last ${(beat.endSecond - beat.startSecond).toFixed(2)} s, under the ${EDIT.minBeat} s minimum; the take is too fast for this edit.`);
    }
    // The line must be heard inside its own beat, never across a cut.
    if (beat.lineStart < beat.startSecond - 1e-9 || beat.lineEnd > beat.endSecond + EDIT.overlapTolerance + 1e-9) {
      throw new TakeError(`Line ${beat.index + 1} (${beat.lineStart}-${beat.lineEnd} s) is not inside its beat (${beat.startSecond}-${beat.endSecond} s).`);
    }
  }
  return beats;
}

/**
 * The approved concept with its beats retimed, and nothing else changed:
 * same narration, captions, pictures, claims and disclosures.
 */
export function retimeConcept<T extends { beats: { startSecond: number; endSecond: number; narration: string }[] }>(concept: T, beats: readonly RetimedBeat[]): T {
  if (concept.beats.length !== beats.length) throw new TakeError("The concept and the take have different numbers of beats.");
  concept.beats.forEach((beat, index) => {
    if (beat.narration !== APPROVED_GPU_UPGRADE_LINES[index].beatNarration) throw new TakeError(`Beat ${index + 1}'s narration is not the line Liam spoke.`);
  });
  return { ...concept, beats: concept.beats.map((beat, index) => ({ ...beat, startSecond: beats[index].startSecond, endSecond: beats[index].endSecond })) };
}

/**
 * Restrained effects on the events the pictures actually show, from the
 * motion-graphic renderer's fixed offsets into each scene
 * (dataMotionGraphicRender.ts):
 *   upgrade-intro    the arrow draws from 0.05 s: one soft whoosh
 *   each cut         one soft whoosh, 0.05 s before the new picture
 *   fps-change       the after-value fades in at 0.6 s: one tick
 *   percent reveal   each percentage at 0.8 s + 0.25 s per row: one pop each
 * Nothing under the explain and ask lines but the cut: the words carry them.
 */
export function soundCuesFor(beats: readonly RetimedBeat[]): SoundCue[] {
  const cues: SoundCue[] = [{ atSecond: 0.05, kind: "whoosh", reason: "the RTX 4060 -> RTX 5070 arrow draws" }];
  for (const beat of beats.slice(1)) cues.push({ atSecond: round3(Math.max(0, beat.startSecond - 0.05)), kind: "whoosh", reason: `cut to beat ${beat.index + 1}` });
  for (const id of ["fps-aw", "fps-val"] as const) {
    const beat = beats.find((entry) => entry.id === id)!;
    cues.push({ atSecond: round3(beat.startSecond + 0.6), kind: "tick", reason: `${id === "fps-aw" ? "65" : "305"} estimated FPS appears` });
  }
  const reveal = beats.find((entry) => entry.id === "percent")!;
  cues.push({ atSecond: round3(reveal.startSecond + 0.8), kind: "pop", reason: "+51% appears" });
  cues.push({ atSecond: round3(reveal.startSecond + 1.05), kind: "pop", reason: "+16% appears" });
  return cues.sort((a, b) => a.atSecond - b.atSecond);
}

/** Where each beat's line is heard in the final video, for the render manifest. */
export function narrationSegmentsFor(beats: readonly RetimedBeat[]) {
  return beats.map((beat) => ({ beatIndex: beat.index, startSecond: beat.lineStart, endSecond: beat.lineEnd }));
}
