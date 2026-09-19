// Beat-level targeted repair. Deterministic repairs only; anything requiring
// new creative material is refused and surfaced to the caller.

import {
  CAPTION_MAX_CHARS_PER_LINE,
  CAPTION_MAX_LINES,
  PACING_ENVELOPES,
  type CreativeQualityReview,
  type RecommendedFix,
} from "./creativeQualityReview.ts";
import { wrapCaptionForRender } from "../captionRender.ts";
import type { PlatformScriptStoryboard, StoryboardBeat } from "../types.ts";

export interface BeatChange {
  readonly beatIndex: number;
  readonly field: "narration" | "onScreenText" | "timing";
  readonly transform: string;
  readonly before: string;
  readonly after: string;
  readonly becauseOf: string;
}

export interface RevisionLineage {
  readonly creativeId: string;
  readonly parentCreativeId: string;
  readonly revisionId: string;
  readonly pass: number;
  readonly changedBeats: number[];
  readonly changeReason: string;
  readonly beforeQualityScore: number;
  readonly afterQualityScore: number;
  readonly improvedDimensions: string[];
  readonly regressedDimensions: string[];
  readonly bestDimensionGain: number;
  readonly accepted: boolean;
  readonly rejectionReason?: string;
}

export interface RepairPassResult {
  readonly lineage: RevisionLineage;
  readonly changes: BeatChange[];
  readonly storyboard: PlatformScriptStoryboard;
  readonly review: CreativeQualityReview;
  readonly unrepairable: { readonly fix: RecommendedFix; readonly reason: string }[];
}

export interface RepairResult {
  readonly finalStoryboard: PlatformScriptStoryboard;
  readonly finalReview: CreativeQualityReview;
  readonly finalCreativeId: string;
  readonly passes: RepairPassResult[];
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
  readonly review: (storyboard: PlatformScriptStoryboard) => CreativeQualityReview;
  readonly ctaRoute: string;
  readonly maxPasses?: number;
  readonly minImprovement?: number;
  readonly qualityTarget?: number;
}

const DEFAULT_MAX_PASSES = 3;
const DEFAULT_MIN_IMPROVEMENT = 0.1;
const DEFAULT_QUALITY_TARGET = 9;
const round1 = (value: number) => Math.round(value * 10) / 10;

function collapseWhitespace(text: string): string {
  return text.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}

function removePhrase(text: string, phrase: string): string {
  const index = text.toLowerCase().indexOf(phrase.toLowerCase());
  if (index < 0) return text;
  return collapseWhitespace(text.slice(0, index) + text.slice(index + phrase.length));
}

function fitsRenderedEnvelope(text: string): boolean {
  const lines = wrapCaptionForRender(text).split("\\N");
  return lines.length <= CAPTION_MAX_LINES && lines.every((line) => line.length <= CAPTION_MAX_CHARS_PER_LINE);
}

const CLAUSE_BOUNDARY = /[:;•—.!?]/g;

function shortenCaptionAtClause(text: string): string | null {
  const flat = collapseWhitespace(text.replace(/\n+/g, " "));
  if (fitsRenderedEnvelope(flat)) return null;

  const candidates: string[] = [];
  for (const match of flat.matchAll(CLAUSE_BOUNDARY)) {
    const cut = collapseWhitespace(flat.slice(0, match.index));
    if (cut.length > 0) candidates.push(cut);
  }
  const fitting = candidates.filter((candidate) => fitsRenderedEnvelope(candidate));
  if (fitting.length === 0) return null;
  return fitting.reduce((longest, candidate) => (candidate.length > longest.length ? candidate : longest));
}

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

function applyFixes(
  storyboard: PlatformScriptStoryboard,
  review: CreativeQualityReview,
  ctaRoute: string,
): { storyboard: PlatformScriptStoryboard; changes: BeatChange[]; unrepairable: { fix: RecommendedFix; reason: string }[] } {
  let beats = [...storyboard.beats];
  const changes: BeatChange[] = [];
  const unrepairable: { fix: RecommendedFix; reason: string }[] = [];

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

  const envelope = PACING_ENVELOPES[storyboard.platform];
  const hookFix = clampHook(beats, envelope.hookMax);
  if (hookFix) {
    beats = hookFix.beats;
    changes.push(...hookFix.changes);
  }

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

  const ctaIndex = beats.findIndex((beat) => beat.purpose === "cta");
  const cta = beats[ctaIndex];
  if (cta && !cta.narration.toLowerCase().includes(ctaRoute.toLowerCase())) {
    const before = cta.narration;
    const after = collapseWhitespace(`${before.replace(/[.\s]+$/, "")}. Open ${ctaRoute}.`);
    beats[ctaIndex] = { ...cta, narration: after };
    changes.push({ beatIndex: ctaIndex, field: "narration", transform: "state-cta-route", before, after, becauseOf: "The CTA beat did not state the exact route." });
  }

  const REFUSALS: Record<string, string> = {
    "visual-repetition": "A distinct visual direction is new creative material. Inventing one here would be fabrication dressed as a repair.",
    "shot-uniqueness": "A distinct visual direction is new creative material.",
    "information-density": "Cutting narration to reduce words-per-second changes what the video claims. Only the generator may decide which idea to drop.",
    "caption-readability": "Shortening further would cut mid-sentence. Rewrite the caption upstream, or give the beat more time.",
    "caption-density": "The caption has no clause boundary short enough to cut at. Cutting mid-sentence would leave a fragment; rewrite it upstream.",
  };
  for (const fix of review.recommendedFixes) {
    const reason = REFUSALS[fix.dimension];
    const captionStillBroken = beats.some((entry) => entry.onScreenText.trim().length > 0 && !fitsRenderedEnvelope(entry.onScreenText));
    const alreadyActedOn = fix.dimension.startsWith("caption-") && !captionStillBroken;
    if (reason && !alreadyActedOn) unrepairable.push({ fix, reason });
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
    if (JSON.stringify(beat) !== JSON.stringify(after.beats[index])) {
      throw new Error(`Repair modified beat ${index + 1}, which no fix named. Changed beats were [${changedBeats.join(", ")}].`);
    }
  }
}

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

    // Clearing a hard failure is necessary, but it is not permission to damage
    // another measured quality dimension. Every accepted repair must be
    // non-regressive; then either a hard failure was cleared or a measured
    // dimension improved by the minimum amount.
    const accepted = regressedDimensions.length === 0 && (slopResolved > 0 || bestDimensionGain >= minImprovement);
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
              ? `Regressed ${regressedDimensions.join(", ")}; clearing a hard failure does not permit a measured regression.`
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

    // A high average may not hide a known defect. The quality target is only a
    // valid stop when the re-review has no remaining named fixes.
    if (
      currentReview.productionQualityScore >= qualityTarget &&
      currentReview.slop.passable &&
      currentReview.recommendedFixes.length === 0
    ) {
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
