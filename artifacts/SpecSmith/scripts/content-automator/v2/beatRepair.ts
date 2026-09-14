// Beat-level targeted repair.
//
// WHY REPAIR IS BEAT-SCOPED AND NOT VIDEO-SCOPED
// -----------------------------------------------
// The cheap way to act on a bad review is to regenerate the whole creative.
// That is also the way to lose the parts that were already good, and it makes
// every revision uncomparable to its parent: if everything changed, nothing is
// attributable. This module changes ONLY the beats a review named, and asserts
// that every other beat survives byte for byte. A weak hook costs one beat.
//
// WHY THE REWRITES ARE RULES AND NOT A MODEL
// -------------------------------------------
// Every transform here is deterministic and reversible in principle: delete a
// phrase the slop scanner located, clamp a duration to a published envelope,
// truncate a caption at a word boundary, state a route that is already known.
// None of them invents a claim, a number, or a visual. Where a fix genuinely
// requires new creative material — a fresh visual direction for a repeated
// shot, say — this module REFUSES and reports the fix as unrepairable rather
// than fabricating content and calling it an improvement.
//
// WHY A REVISION CAN BE REJECTED
// -------------------------------
// A repair pass that does not measurably improve the review is not kept. The
// parent is returned instead, with the reason recorded. Otherwise "we ran the
// repair loop" quietly becomes a substitute for "the creative got better".

import {
  CAPTION_MAX_CHARS_PER_LINE,
  CAPTION_MAX_LINES,
  PACING_ENVELOPES,
  type CreativeQualityReview,
  type RecommendedFix,
} from "./creativeQualityReview.ts";
import { wrapCaptionForRender } from "../captionRender.ts";
import type { PlatformScriptStoryboard, StoryboardBeat } from "../types.ts";

/** A single applied change, at the granularity a reviewer can check. */
export interface BeatChange {
  readonly beatIndex: number;
  readonly field: "narration" | "onScreenText" | "timing";
  readonly transform: string;
  readonly before: string;
  readonly after: string;
  /** The review finding this change answers. */
  readonly becauseOf: string;
}

/**
 * The lineage of one revision.
 *
 * `parentCreativeId` is what makes a revision comparable to what it replaced.
 * Without it a repaired creative is indistinguishable from a fresh one, and no
 * later analysis can ask whether repair helped.
 */
export interface RevisionLineage {
  readonly creativeId: string;
  readonly parentCreativeId: string;
  readonly revisionId: string;
  readonly pass: number;
  readonly changedBeats: number[];
  readonly changeReason: string;
  readonly beforeQualityScore: number;
  readonly afterQualityScore: number;
  /** Dimensions this pass moved, so the record shows WHAT improved. */
  readonly improvedDimensions: string[];
  /** Any dimension the pass made worse. A non-empty list rejects the pass. */
  readonly regressedDimensions: string[];
  readonly bestDimensionGain: number;
  readonly accepted: boolean;
  /** Present when `accepted` is false: why the revision was discarded. */
  readonly rejectionReason?: string;
}

export interface RepairPassResult {
  readonly lineage: RevisionLineage;
  readonly changes: BeatChange[];
  readonly storyboard: PlatformScriptStoryboard;
  readonly review: CreativeQualityReview;
  /** Fixes this module refused to apply, and why. Never silently dropped. */
  readonly unrepairable: { readonly fix: RecommendedFix; readonly reason: string }[];
}

export interface RepairResult {
  readonly finalStoryboard: PlatformScriptStoryboard;
  readonly finalReview: CreativeQualityReview;
  readonly finalCreativeId: string;
  readonly passes: RepairPassResult[];
  /** Why the loop stopped: a stop condition, never an exhausted budget alone. */
  readonly stoppedBecause:
    | "no-fixes-remaining"
    | "quality-target-met"
    | "no-further-improvement"
    | "max-passes-reached";
  readonly unrepairable: { readonly fix: RecommendedFix; readonly reason: string }[];
}

export interface RepairInput {
  readonly creativeId: string;
  readonly storyboard: PlatformScriptStoryboard;
  /**
   * Re-reviews a candidate storyboard. Supplied by the caller so caption cues
   * and the CTA route keep ONE source of truth (the production plan) rather
   * than this module deriving a second, drifting copy of them.
   */
  readonly review: (storyboard: PlatformScriptStoryboard) => CreativeQualityReview;
  readonly ctaRoute: string;
  /** Hard ceiling on passes. Default 3: past that, the generator is the problem. */
  readonly maxPasses?: number;
  /** A pass must gain at least this much to be kept. Default 0.1. */
  readonly minImprovement?: number;
  /** Stop early once the score reaches this. Default 9. */
  readonly qualityTarget?: number;
}

const DEFAULT_MAX_PASSES = 3;
const DEFAULT_MIN_IMPROVEMENT = 0.1;
const DEFAULT_QUALITY_TARGET = 9;

const round1 = (value: number) => Math.round(value * 10) / 10;

function collapseWhitespace(text: string): string {
  return text.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}

/**
 * Removes one exact located phrase.
 *
 * It deletes the evidence string the scanner actually matched rather than
 * re-running a pattern, so a change can never remove text no finding pointed at.
 */
function removePhrase(text: string, phrase: string): string {
  const index = text.toLowerCase().indexOf(phrase.toLowerCase());
  if (index < 0) return text;
  return collapseWhitespace(text.slice(0, index) + text.slice(index + phrase.length));
}

/**
 * Does the caption fit the envelope the renderer will actually impose?
 *
 * It asks the real renderer's wrapper rather than counting characters against a
 * rule of its own, so a "fixed" caption cannot still overflow the frame.
 */
function fitsRenderedEnvelope(text: string): boolean {
  const lines = wrapCaptionForRender(text).split("\\N");
  return lines.length <= CAPTION_MAX_LINES && lines.every((line) => line.length <= CAPTION_MAX_CHARS_PER_LINE);
}

/** Clause separators a caption can be cut at without leaving a fragment. */
const CLAUSE_BOUNDARY = /[:;•—.!?]/g;

/**
 * Shortens a caption ONLY at a clause boundary.
 *
 * Cutting at an arbitrary word boundary is what produces captions like "Pick
 * the GPU before SpecSmith reveals the" — shorter, measurably "fixed", and
 * meaningless. This keeps a complete clause or refuses, and refusing is
 * reported rather than swallowed.
 */
function shortenCaptionAtClause(text: string): string | null {
  const flat = collapseWhitespace(text.replace(/\n+/g, " "));
  if (fitsRenderedEnvelope(flat)) return null;

  const candidates: string[] = [];
  for (const match of flat.matchAll(CLAUSE_BOUNDARY)) {
    const cut = collapseWhitespace(flat.slice(0, match.index));
    if (cut.length > 0) candidates.push(cut);
  }
  // Longest clause that still fits: keeps as much meaning as the frame allows.
  const fitting = candidates.filter((candidate) => fitsRenderedEnvelope(candidate));
  if (fitting.length === 0) return null;
  return fitting.reduce((longest, candidate) => (candidate.length > longest.length ? candidate : longest));
}

/**
 * Shortens the hook to its platform envelope and redistributes the reclaimed
 * time PROPORTIONALLY across the remaining beats.
 *
 * Total duration is deliberately preserved: the render, the narration budget
 * and the caption cues are all timed against it, so a repair that quietly
 * shortened the video would break things far from here.
 *
 * The time is spread rather than handed to the next beat alone. An earlier
 * version dumped all of it on beat 2, which turned a hook overrun into a beat
 * overrun — the repair loop's own per-dimension check rejected the result,
 * which is how this was found.
 */
function clampHook(beats: StoryboardBeat[], hookMax: number): { beats: StoryboardBeat[]; changes: BeatChange[] } | null {
  const hook = beats[0];
  if (!hook || beats.length < 2) return null;
  const duration = hook.endSecond - hook.startSecond;
  if (duration <= hookMax) return null;

  const totalEnd = beats.at(-1)!.endSecond;
  const newHookEnd = round1(hook.startSecond + hookMax);
  const remainingBefore = totalEnd - hook.endSecond;
  const remainingAfter = totalEnd - newHookEnd;
  if (remainingBefore <= 0 || remainingAfter <= 0) return null;
  const scale = remainingAfter / remainingBefore;

  const updated: StoryboardBeat[] = [{ ...hook, endSecond: newHookEnd }];
  const changes: BeatChange[] = [{
    beatIndex: 0,
    field: "timing",
    transform: "clamp-hook-to-envelope",
    before: `${hook.startSecond}-${hook.endSecond}`,
    after: `${hook.startSecond}-${newHookEnd}`,
    becauseOf: `Hook ran ${round1(duration)}s against a ${hookMax}s envelope.`,
  }];

  let cursor = newHookEnd;
  for (let index = 1; index < beats.length; index += 1) {
    const beat = beats[index];
    const scaled = (beat.endSecond - beat.startSecond) * scale;
    // The last beat is pinned to the original end so rounding cannot drift the
    // total duration away from what everything downstream was timed against.
    const end = index === beats.length - 1 ? totalEnd : round1(cursor + scaled);
    updated.push({ ...beat, startSecond: cursor, endSecond: end });
    changes.push({
      beatIndex: index,
      field: "timing",
      transform: "redistribute-reclaimed-hook-time",
      before: `${beat.startSecond}-${beat.endSecond}`,
      after: `${cursor}-${end}`,
      becauseOf: "Absorbing the time reclaimed from the hook, keeping total duration unchanged.",
    });
    cursor = end;
  }

  return { beats: updated, changes };
}

/** Applies every repairable fix a review named. One pass, no re-review. */
function applyFixes(
  storyboard: PlatformScriptStoryboard,
  review: CreativeQualityReview,
  ctaRoute: string,
): { storyboard: PlatformScriptStoryboard; changes: BeatChange[]; unrepairable: { fix: RecommendedFix; reason: string }[] } {
  let beats = [...storyboard.beats];
  const changes: BeatChange[] = [];
  const unrepairable: { fix: RecommendedFix; reason: string }[] = [];

  // 1. Delete located slop. The evidence string is the exact matched text.
  for (const finding of review.slop.findings) {
    const match = /^beat-(\d+)\.(onScreenText|narration)$/.exec(finding.location);
    if (!match) continue;
    if (finding.code === "repeated-caption") {
      unrepairable.push({
        fix: { beats: [Number(match[1]) - 1], dimension: finding.code, issue: finding.message, fix: "Write distinct on-screen text for this beat." },
        reason: "Replacing a repeated caption requires new copy. This module does not invent copy; regenerate the beat upstream.",
      });
      continue;
    }
    const index = Number(match[1]) - 1;
    const field = match[2] as "onScreenText" | "narration";
    const beat = beats[index];
    if (!beat) continue;
    const before = beat[field];
    const after = removePhrase(before, finding.evidence);
    if (after === before || after.length === 0) continue;
    beats[index] = { ...beat, [field]: after };
    changes.push({ beatIndex: index, field, transform: `remove-${finding.code}`, before, after, becauseOf: finding.message });
  }

  // 2. Clamp an over-long hook.
  const envelope = PACING_ENVELOPES[storyboard.platform];
  const hookFix = clampHook(beats, envelope.hookMax);
  if (hookFix) {
    beats = hookFix.beats;
    changes.push(...hookFix.changes);
  }

  // 3. Shorten captions past the rendered envelope, at a clause boundary only.
  for (const [index, beat] of beats.entries()) {
    const shortened = shortenCaptionAtClause(beat.onScreenText);
    if (shortened === null) continue;
    changes.push({
      beatIndex: index,
      field: "onScreenText",
      transform: "shorten-caption-at-clause",
      before: beat.onScreenText,
      after: shortened,
      becauseOf: `Caption exceeded ${CAPTION_MAX_LINES} rendered lines of ${CAPTION_MAX_CHARS_PER_LINE} characters.`,
    });
    beats[index] = { ...beat, onScreenText: shortened };
  }

  // 4. Name the route in the CTA beat. The route is known, not invented.
  const ctaIndex = beats.findIndex((beat) => beat.purpose === "cta");
  const cta = beats[ctaIndex];
  if (cta && !cta.narration.toLowerCase().includes(ctaRoute.toLowerCase())) {
    const before = cta.narration;
    const after = collapseWhitespace(`${before.replace(/[.\s]+$/, "")}. Open ${ctaRoute}.`);
    beats[ctaIndex] = { ...cta, narration: after };
    changes.push({ beatIndex: ctaIndex, field: "narration", transform: "state-cta-route", before, after, becauseOf: "The CTA beat did not state the exact route." });
  }

  // 5. Fixes needing new creative material are refused, loudly. A refusal that
  //    is recorded is useful; a refusal that is silent is indistinguishable
  //    from the problem not existing.
  const REFUSALS: Record<string, string> = {
    "visual-repetition": "A distinct visual direction is new creative material. Inventing one here would be fabrication dressed as a repair.",
    "shot-uniqueness": "A distinct visual direction is new creative material.",
    "information-density": "Cutting narration to reduce words-per-second changes what the video claims. Only the generator may decide which idea to drop.",
    "caption-readability": "Shortening further would cut mid-sentence. Rewrite the caption upstream, or give the beat more time.",
    "caption-density": "The caption has no clause boundary short enough to cut at. Cutting mid-sentence would leave a fragment; rewrite it upstream.",
  };
  for (const fix of review.recommendedFixes) {
    const reason = REFUSALS[fix.dimension];
    // A caption concern is refused only if a caption STILL overflows after this
    // pass. Checking "did we change some caption" instead would hide a second
    // broken caption behind a first one that was fixed.
    const captionStillBroken = beats.some((entry) => entry.onScreenText.trim().length > 0 && !fitsRenderedEnvelope(entry.onScreenText));
    const alreadyActedOn = fix.dimension.startsWith("caption-") && !captionStillBroken;
    if (reason && !alreadyActedOn) {
      unrepairable.push({ fix, reason });
    }
    if (fix.fix.startsWith("No automated repair rule exists")) {
      unrepairable.push({ fix, reason: "No deterministic repair rule covers this dimension; it must be regenerated upstream." });
    }
  }
  for (const fix of review.recommendedFixes) {
    if (fix.dimension === "narration-visual-sync" && fix.issue.startsWith("Beat has no narration")) {
      unrepairable.push({ fix, reason: "Writing missing narration is new creative material; regenerate the beat upstream." });
    }
  }

  return { storyboard: { ...storyboard, beats }, changes, unrepairable };
}

/**
 * Asserts the repair touched only what it said it touched.
 *
 * This is the load-bearing guarantee of the module, so it is checked rather
 * than asserted in a comment: any beat outside `changedBeats` must be
 * byte-identical after serialization.
 */
export function assertUntouchedBeatsPreserved(
  before: PlatformScriptStoryboard,
  after: PlatformScriptStoryboard,
  changedBeats: readonly number[],
): void {
  if (before.beats.length !== after.beats.length) {
    throw new Error(`Repair changed the beat count (${before.beats.length} -> ${after.beats.length}); repair must never add or remove beats.`);
  }
  for (const [index, beat] of before.beats.entries()) {
    if (changedBeats.includes(index)) continue;
    const serializedBefore = JSON.stringify(beat);
    const serializedAfter = JSON.stringify(after.beats[index]);
    if (serializedBefore !== serializedAfter) {
      throw new Error(`Repair modified beat ${index + 1}, which no fix named. Changed beats were [${changedBeats.join(", ")}].`);
    }
  }
}

/** Runs repair passes until a real stop condition, not until a budget runs out. */
export function repairCreative(input: RepairInput): RepairResult {
  const maxPasses = input.maxPasses ?? DEFAULT_MAX_PASSES;
  const minImprovement = input.minImprovement ?? DEFAULT_MIN_IMPROVEMENT;
  const qualityTarget = input.qualityTarget ?? DEFAULT_QUALITY_TARGET;

  let currentStoryboard = input.storyboard;
  let currentReview = input.review(currentStoryboard);
  let currentCreativeId = input.creativeId;
  const passes: RepairPassResult[] = [];
  const unrepairable: { fix: RecommendedFix; reason: string }[] = [];
  let stoppedBecause: RepairResult["stoppedBecause"] = "max-passes-reached";

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    // The quality target is deliberately NOT checked here. An averaged score
    // can sit above target while a caption still runs off the frame, and an
    // earlier version of this loop declared such a creative finished without
    // applying a single fix the review had named. Named fixes are attempted
    // first; the target only stops FURTHER passes, below.
    if (currentReview.recommendedFixes.length === 0) {
      stoppedBecause = "no-fixes-remaining";
      break;
    }

    const applied = applyFixes(currentStoryboard, currentReview, input.ctaRoute);
    for (const entry of applied.unrepairable) {
      if (!unrepairable.some((seen) => seen.fix.dimension === entry.fix.dimension && seen.fix.issue === entry.fix.issue)) {
        unrepairable.push(entry);
      }
    }

    if (applied.changes.length === 0) {
      stoppedBecause = "no-further-improvement";
      break;
    }

    const changedBeats = [...new Set(applied.changes.map((change) => change.beatIndex))].sort((a, b) => a - b);
    assertUntouchedBeatsPreserved(currentStoryboard, applied.storyboard, changedBeats);

    const candidateReview = input.review(applied.storyboard);
    const before = currentReview.productionQualityScore;
    const after = candidateReview.productionQualityScore;
    const slopResolved = currentReview.slop.hardFailures.length - candidateReview.slop.hardFailures.length;

    // Judge the pass on the DIMENSIONS it moved, not on the overall average.
    //
    // The average is taken across every measured dimension, so fixing one real
    // defect moves it by a fraction that shrinks as dimensions are added — an
    // earlier version of this loop started rejecting genuine caption repairs
    // purely because two narrative dimensions had been introduced elsewhere.
    // A repair is good if something got better and nothing got worse.
    const deltas = new Map<string, number>();
    for (const score of candidateReview.overall) {
      if (score.score === null) continue;
      const previous = currentReview.overall.find((entry) => entry.dimension === score.dimension);
      if (previous?.score == null) continue;
      deltas.set(score.dimension, round1(score.score - previous.score));
    }
    const improvedDimensions = [...deltas.entries()].filter(([, delta]) => delta > 0).map(([dimension]) => dimension);
    const regressedDimensions = [...deltas.entries()].filter(([, delta]) => delta < 0).map(([dimension]) => dimension);
    const bestDimensionGain = Math.max(0, ...deltas.values());
    const accepted = slopResolved > 0 || (bestDimensionGain >= minImprovement && regressedDimensions.length === 0);
    const revisionId = `${currentCreativeId}-r${pass}`;

    const lineage: RevisionLineage = {
      creativeId: revisionId,
      parentCreativeId: currentCreativeId,
      revisionId,
      pass,
      changedBeats,
      changeReason: applied.changes.map((change) => change.transform).join(", "),
      beforeQualityScore: before,
      afterQualityScore: after,
      accepted,
      improvedDimensions,
      regressedDimensions,
      bestDimensionGain,
      ...(accepted
        ? {}
        : {
            rejectionReason: regressedDimensions.length
              ? `Regressed ${regressedDimensions.join(", ")} and cleared no hard failure.`
              : `Best dimension gain was ${bestDimensionGain} (under the ${minImprovement} minimum) and no hard failure was cleared.`,
          }),
    };

    passes.push({ lineage, changes: applied.changes, storyboard: applied.storyboard, review: candidateReview, unrepairable: applied.unrepairable });

    if (!accepted) {
      stoppedBecause = "no-further-improvement";
      break;
    }

    currentStoryboard = applied.storyboard;
    currentReview = candidateReview;
    currentCreativeId = revisionId;

    if (currentReview.productionQualityScore >= qualityTarget && currentReview.slop.passable) {
      stoppedBecause = "quality-target-met";
      break;
    }
  }

  return {
    finalStoryboard: currentStoryboard,
    finalReview: currentReview,
    finalCreativeId: currentCreativeId,
    passes,
    stoppedBecause,
    unrepairable,
  };
}
