// Times the picture-locked RAM-fit cut to a real Liam take.
//
// A take is used only if it is the approved script, in the pinned Liam voice,
// with the audio its manifest names (by SHA-256) and the provider's character
// timestamps. There is no fallback: without timestamps the render refuses,
// because captions and the three visual beats are timed to the words.
//
// The shots, their order and their internal moves are locked. What the take
// decides is when each shot starts, and exactly when three beats land:
//   - the jam, on "won't";
//   - the DDR5 stick seating, as "DDR5 RAM here" ends;
//   - the DDR4 stick seating, as "DDR4 board" ends.
// Each line is cut from the take at its own timestamps and placed at its
// shot's start, so a line never spills into the next shot. A shot is held a
// little longer than its line only where the locked animation needs the time.
// A beat never moves off its words: if Liam says the two fixes closer together
// than the animation can seat them, the pause he already takes at the comma
// after "here," is lengthened (by at most LOCKED.maxCommaPause) so both still
// land as their words end; a take that would need more is refused.
// Captions appear as their first word is said. The only exception is the
// opening hook, which is on screen from frame one when line 1 starts within
// LOCKED.jamEarliest of it.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { REVIEWED_LIAM_VOICE } from "../liamVoice.ts";
import {
  APPROVED_RAM_FIT_LINES,
  lineTimingsFromAlignment,
  RAM_FIT_TAKE_MANIFEST,
  RAM_FIT_TAKE_TEXT,
  type Alignment,
  type LineTiming,
} from "./liamTake.ts";
import type { PilotScene, SceneId } from "./storyboard.ts";

export class TakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TakeError";
  }
}

export interface LoadedRamFitTake {
  readonly audioPath: string;
  readonly audioSha256: string;
  readonly voiceId: string;
  readonly voiceUsed: string;
  readonly modelId: string;
  readonly text: string;
  readonly alignment: Alignment;
  readonly lineTimings: readonly LineTiming[];
  readonly providerReportedCharacterCost: number | null;
}

/** Loads a take only if it is the approved script, in Liam, with the audio its manifest names. */
export async function loadRamFitTake(dir: string): Promise<LoadedRamFitTake> {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(join(dir, RAM_FIT_TAKE_MANIFEST), "utf8")) as Record<string, unknown>;
  } catch (error) {
    throw new TakeError(`No readable take manifest in ${dir}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (manifest.voiceId !== REVIEWED_LIAM_VOICE.voiceId) throw new TakeError("The take is not the pinned Liam voice. No other voice is used.");
  if (manifest.isFixture !== false) throw new TakeError("The take is marked as a fixture, not a provider take.");
  if (manifest.text !== RAM_FIT_TAKE_TEXT || JSON.stringify(manifest.lines) !== JSON.stringify(APPROVED_RAM_FIT_LINES)) {
    throw new TakeError("The take is not the approved script word for word.");
  }
  const audio = manifest.audio as { file?: unknown; sha256?: unknown } | undefined;
  if (!audio || typeof audio.file !== "string" || typeof audio.sha256 !== "string") throw new TakeError("The take manifest names no audio.");
  const audioPath = join(dir, audio.file);
  const bytes = await readFile(audioPath).catch(() => { throw new TakeError(`The take audio ${audio.file} is missing.`); });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== audio.sha256) throw new TakeError("The take audio is not the audio its manifest describes.");
  if (!manifest.alignment) throw new TakeError(`The take has no provider timestamps (${String(manifest.alignmentError ?? "none recorded")}); the cut cannot be timed to the words, so it is not rendered.`);
  const alignment = manifest.alignment as Alignment;
  let lineTimings: LineTiming[];
  try {
    lineTimings = lineTimingsFromAlignment(alignment);
  } catch (error) {
    throw new TakeError(`The take's timestamps are unusable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    audioPath, audioSha256: sha256, voiceId: String(manifest.voiceId), voiceUsed: String(manifest.voiceUsed ?? ""),
    modelId: String(manifest.modelId ?? ""), text: RAM_FIT_TAKE_TEXT, alignment, lineTimings,
    providerReportedCharacterCost: typeof manifest.providerReportedCharacterCost === "number" ? manifest.providerReportedCharacterCost : null,
  };
}

/** Where each line's characters start in the full take text. */
function lineOffsets(): Map<SceneId, number> {
  const offsets = new Map<SceneId, number>();
  let offset = 0;
  for (const line of APPROVED_RAM_FIT_LINES) {
    offsets.set(line.id, offset);
    offset += line.text.length + 1;
  }
  return offsets;
}

/** Seconds into a line at which `phrase` starts or ends, from the character timestamps. */
export function phraseTime(alignment: Alignment, timings: readonly LineTiming[], id: SceneId, phrase: string, at: "start" | "end"): number {
  const line = APPROVED_RAM_FIT_LINES.find((entry) => entry.id === id)!;
  const index = line.text.indexOf(phrase);
  if (index < 0) throw new TakeError(`"${phrase}" is not in the ${id} line.`);
  const global = lineOffsets().get(id)! + index;
  const lineStart = timings.find((timing) => timing.id === id)!.start;
  const seconds = at === "start" ? alignment.character_start_times_seconds[global] : alignment.character_end_times_seconds[global + phrase.length - 1];
  return seconds - lineStart;
}

/** Locked-animation needs, in seconds after each shot starts (from scene.browser.js). */
export const LOCKED = Object.freeze({
  /** The stick must be seen moving before it jams, and the jam must land inside the first second. */
  jamEarliest: 0.35,
  jamLatest: 1.0,
  /** The pull-back takes 0.75 s; the DDR4 stick leaves 0.5 s before the DDR5 stick seats. */
  fix1Earliest: 1.25,
  /** The DDR4 stick needs 0.85 s to leave and come back between the two fixes. */
  fixGap: 0.85,
  /** The most the pause at "here," may be lengthened so the second fix still lands on "board". */
  maxCommaPause: 0.5,
  /** Where line 3 may be split for that pause: after this text, before the next word. */
  commaAfter: "Use DDR5 RAM here,",
  /** Each tick pops for 0.4 s after its fix. */
  afterFix2: 0.55,
  /** The notch push-in (0.55 s) and labels (to 0.8 s), then a beat to read them. */
  notchMinimum: 1.4,
  /** The payoff message builds over 1.0 s; the real card then needs about a second on screen. */
  proofAt: 1.1,
  proofOnScreen: 1.0,
  ctaMinimum: 1.6,
  /** Each line starts this long after its cut, and a shot ends this long after its line. */
  lead: 0.05,
  breath: 0.22,
});

export interface TakePlan {
  readonly scenes: PilotScene[];
  readonly events: { readonly jam: number; readonly fix1: number; readonly fix2: number };
  readonly proofAt: number;
  /** Where each line (or part of a line, if its comma pause was lengthened) is cut from the take and placed in the video. */
  readonly voice: readonly { readonly id: SceneId; readonly takeStart: number; readonly takeEnd: number; readonly at: number }[];
  readonly captions: readonly { readonly text: string; readonly start: number; readonly end: number }[];
  readonly adjustments: readonly string[];
  /** Seconds added to Liam's pause after "here," (0 when his own pause was long enough). */
  readonly commaPause: number;
}

/** The locked cut, retimed to the take. */
export function planFromTake(take: Pick<LoadedRamFitTake, "alignment" | "lineTimings">, scenes: readonly PilotScene[]): TakePlan {
  const timings = take.lineTimings;
  const timing = (id: SceneId) => timings.find((entry) => entry.id === id)!;
  const length = (id: SceneId) => timing(id).end - timing(id).start;
  const anchor = (id: SceneId, event: "jam" | "fix1" | "fix2") => {
    const scene = scenes.find((entry) => entry.id === id)!;
    const spec = scene.anchors?.find((entry) => entry.event === event);
    if (!spec) throw new TakeError(`The ${id} shot has no ${event} anchor.`);
    return phraseTime(take.alignment, timings, id, spec.phrase, spec.at);
  };
  const adjustments: string[] = [];
  const delay = new Map<SceneId, number>();
  const duration = new Map<SceneId, number>();

  // Shot 1: the jam lands on "won't", inside the first second.
  const wont = anchor("fail", "jam");
  let failDelay = LOCKED.lead;
  if (failDelay + wont < LOCKED.jamEarliest) { failDelay = LOCKED.jamEarliest - wont; adjustments.push(`Line 1 starts ${failDelay.toFixed(2)} s in so the stick is seen moving before the jam.`); }
  const jam = failDelay + wont;
  if (jam > LOCKED.jamLatest) throw new TakeError(`"won't" is said ${jam.toFixed(2)} s in; the jam must land inside the first second. Not rendered.`);
  delay.set("fail", failDelay);
  duration.set("fail", failDelay + length("fail") + LOCKED.breath);

  delay.set("notch", LOCKED.lead);
  duration.set("notch", Math.max(LOCKED.notchMinimum, LOCKED.lead + length("notch") + LOCKED.breath));

  // Shot 3: each fix seats as its words are said; the line waits for the pull-back if it must.
  const fix1Rel = anchor("choice", "fix1"), fix2Rel = anchor("choice", "fix2");
  let choiceDelay = LOCKED.lead;
  if (choiceDelay + fix1Rel < LOCKED.fix1Earliest) { choiceDelay = LOCKED.fix1Earliest - fix1Rel; adjustments.push(`Line 3 starts ${choiceDelay.toFixed(2)} s into its shot so the pull-back finishes first.`); }
  const fix1Offset = choiceDelay + fix1Rel;
  // Too close for the stick to come back: lengthen the comma pause, never move the beat off "board".
  const commaPause = Math.max(0, LOCKED.fixGap - (fix2Rel - fix1Rel));
  if (commaPause > LOCKED.maxCommaPause + 1e-9) {
    throw new TakeError(`"DDR5 RAM here" and "DDR4 board" end ${(fix2Rel - fix1Rel).toFixed(2)} s apart; seating both on their words would need a ${commaPause.toFixed(2)} s longer pause at "here," (at most ${LOCKED.maxCommaPause} s). Not rendered.`);
  }
  const choiceLine = APPROVED_RAM_FIT_LINES.find((entry) => entry.id === "choice")!;
  if (!choiceLine.text.startsWith(LOCKED.commaAfter)) throw new TakeError(`Line 3 no longer starts "${LOCKED.commaAfter}".`);
  const commaIndex = lineOffsets().get("choice")! + LOCKED.commaAfter.length - 1;
  /** Take seconds where the comma ends and the next word starts: the pause is lengthened in that silence. */
  const commaEnd = take.alignment.character_end_times_seconds[commaIndex];
  const resumeAt = take.alignment.character_start_times_seconds[commaIndex + 2];
  if (commaPause > 0) adjustments.push(`The pause after "here," is ${commaPause.toFixed(2)} s longer than Liam's, so the DDR4 stick can come back and seat as "DDR4 board" ends.`);
  const fix2Offset = choiceDelay + fix2Rel + commaPause;
  delay.set("choice", choiceDelay);
  duration.set("choice", Math.max(choiceDelay + length("choice") + commaPause + LOCKED.breath, fix2Offset + LOCKED.afterFix2));

  delay.set("payoff", LOCKED.lead);
  duration.set("payoff", Math.max(LOCKED.lead + length("payoff") + LOCKED.breath, LOCKED.proofAt + LOCKED.proofOnScreen));
  delay.set("cta", LOCKED.lead);
  duration.set("cta", Math.max(LOCKED.ctaMinimum, LOCKED.lead + length("cta") + 0.6));

  // Lay the shots end to end.
  const round = (value: number) => Math.round(value * 1000) / 1000;
  let cursor = 0;
  const retimed: PilotScene[] = scenes.map((scene) => {
    const start = cursor;
    cursor = round(cursor + duration.get(scene.id)!);
    return { ...scene, startSecond: start, endSecond: cursor };
  });
  const startOf = (id: SceneId) => retimed.find((scene) => scene.id === id)!.startSecond;

  const voice = APPROVED_RAM_FIT_LINES.flatMap((line) => {
    const span = timing(line.id);
    const at = round(startOf(line.id) + delay.get(line.id)!);
    if (line.id !== "choice" || commaPause === 0) return [{ id: line.id, takeStart: span.start, takeEnd: span.end, at }];
    return [
      { id: line.id, takeStart: span.start, takeEnd: commaEnd, at },
      { id: line.id, takeStart: resumeAt, takeEnd: span.end, at: round(at + (resumeAt - span.start) + commaPause) },
    ];
  });
  /** Where a take moment of a line is heard in the video. */
  const heardAt = (id: SceneId, takeSeconds: number) => {
    const part = [...voice].reverse().find((entry) => entry.id === id && takeSeconds >= entry.takeStart - 1e-9) ?? voice.find((entry) => entry.id === id)!;
    return part.at + takeSeconds - part.takeStart;
  };

  // Captions: each chunk from its first word to the next chunk, the last to the end of its shot.
  // The opening hook alone may be on screen from frame one, if line 1 starts within jamEarliest.
  const offsets = lineOffsets();
  const captions = retimed.flatMap((scene) => {
    const line = APPROVED_RAM_FIT_LINES.find((entry) => entry.id === scene.id)!;
    if (scene.captions.join(" ") !== line.text) throw new TakeError(`The ${scene.id} captions do not spell its line.`);
    let within = 0;
    const starts = scene.captions.map((chunk) => {
      const global = offsets.get(scene.id)! + within;
      within += chunk.length + 1;
      return round(heardAt(scene.id, take.alignment.character_start_times_seconds[global]));
    });
    const hookFromFrameOne = scene.id === "fail" && starts[0] - scene.startSecond <= LOCKED.jamEarliest + 1e-9;
    return scene.captions.map((text, index) => ({
      text,
      start: index === 0 && hookFromFrameOne ? scene.startSecond : starts[index],
      end: index === scene.captions.length - 1 ? scene.endSecond : starts[index + 1],
    }));
  });

  return {
    scenes: retimed,
    events: { jam: round(startOf("fail") + jam), fix1: round(startOf("choice") + fix1Offset), fix2: round(startOf("choice") + fix2Offset) },
    commaPause: round(commaPause),
    proofAt: LOCKED.proofAt,
    voice,
    captions,
    adjustments,
  };
}
