// The Creative Director layer: a structured critique of one creative, bound to
// its exact identity and media.
//
// THE RULE THAT SHAPES EVERYTHING HERE
// -------------------------------------
// Every score carries PROVENANCE, and the provenance is not decoration. A
// caption's characters-per-second is an objective measurement; whether a frame
// is beautifully composed is not, and no amount of arithmetic turns the second
// into the first. Dimensions this code cannot honestly measure are emitted as
// `not-assessed` WITH A REASON rather than given a plausible number, because a
// fabricated 7.5 is worse than an admitted gap: it looks like evidence.
//
// That is also why `productionQualityScore` never reads a view count. How well
// a video was constructed and how audiences responded are different questions,
// and collapsing them is how a viral ugly video teaches a system to make more
// ugly videos.
//
// HOW THIS MAKES THE FINAL VIDEO BETTER
// --------------------------------------
// It runs on the real generated storyboard and caption cues before render, and
// on the real media afterwards. Its named weaknesses are the input to
// beatRepair.ts, which rewrites only the beats named — so a weak hook costs one
// beat's regeneration rather than a whole video's.

import { scanForSlop, type SlopReport } from "./antiSlop.ts";
import {
  CAPTION_LINE_MAX_CHARS,
  CAPTION_MAX_LINES as RENDERER_CAPTION_MAX_LINES,
  wrapCaptionForRender,
  type CaptionCue,
} from "../captionRender.ts";
import type { PlatformScriptStoryboard, StoryboardBeat, VideoPlatform } from "../types.ts";

/** Where a score came from. The difference between these is the whole point. */
export type ScoreProvenance =
  | "objective-measurement"
  | "model-judgment"
  | "human-rating"
  | "performance-derived";

export interface DimensionScore {
  readonly dimension: string;
  /** 0-10, or null when this dimension was not assessed. */
  readonly score: number | null;
  readonly provenance: ScoreProvenance | "not-assessed";
  /** The measured values behind the score, so a reviewer can check the arithmetic. */
  readonly measured?: Record<string, number | string>;
  /** Required when score is null: what would be needed to assess it. */
  readonly reason?: string;
}

export interface BeatQuality {
  readonly index: number;
  readonly purpose: StoryboardBeat["purpose"];
  readonly durationSeconds: number;
  readonly scores: DimensionScore[];
  readonly weaknesses: string[];
}

export interface CreativeQualityReview {
  readonly creativeId: string;
  readonly packageId: string;
  readonly platform: VideoPlatform;
  /** The exact bytes this review describes, when a render exists. */
  readonly mediaSha256: string | null;
  readonly reviewedAt: string;

  readonly beats: BeatQuality[];
  readonly overall: DimensionScore[];
  /**
   * 0-10 from CONSTRUCTION evidence only. It cannot see a view count, and
   * nothing in this module imports the learner.
   */
  readonly productionQualityScore: number;
  /** How much of the picture was actually measurable, 0-1. */
  readonly confidence: number;
  readonly strengths: string[];
  readonly weaknesses: string[];
  readonly recommendedFixes: RecommendedFix[];
  readonly slop: SlopReport;
  /** Dimensions a machine must not score. Named so they cannot be forgotten. */
  readonly requiresHumanJudgment: string[];
}

export interface RecommendedFix {
  /** Which beats to change. Empty means a whole-video concern. */
  readonly beats: number[];
  readonly issue: string;
  readonly fix: string;
  readonly dimension: string;
}

/**
 * Pacing envelopes per platform.
 *
 * Not one universal ideal: a YouTube Short tolerates a slower build than a
 * TikTok, and pretending otherwise produces content that fits nowhere. These
 * are starting envelopes to be revised from evidence once published creatives
 * exist — they are explicitly NOT derived from performance data today, because
 * there is none.
 */
export const PACING_ENVELOPES: Record<VideoPlatform, { hookMax: number; beatMin: number; beatMax: number; maxDeadTime: number }> = {
  "youtube-shorts": { hookMax: 3.0, beatMin: 1.5, beatMax: 8.0, maxDeadTime: 1.5 },
  tiktok: { hookMax: 2.0, beatMin: 1.2, beatMax: 6.0, maxDeadTime: 1.0 },
  "instagram-reels": { hookMax: 2.5, beatMin: 1.2, beatMax: 7.0, maxDeadTime: 1.2 },
};

/** Comfortable adult reading speed for burned-in captions, characters per second. */
export const CPS_COMFORTABLE = 20;
export const CPS_MAX = 28;
// Taken from the renderer rather than restated, so this module can never grade
// a caption against a rule the burned-in output does not follow.
export const CAPTION_MAX_LINES = RENDERER_CAPTION_MAX_LINES;
export const CAPTION_MAX_CHARS_PER_LINE = CAPTION_LINE_MAX_CHARS;

const clamp = (value: number) => Math.max(0, Math.min(10, value));
const round1 = (value: number) => Math.round(value * 10) / 10;

/** Dimensions that genuinely need eyes or ears. Never machine-scored. */
export const HUMAN_ONLY_DIMENSIONS = [
  "composition-quality",
  "subject-prominence",
  "visual-polish",
  "voice-naturalness",
  "overall-perceived-production-quality",
] as const;

function notAssessed(dimension: string, reason: string): DimensionScore {
  return { dimension, score: null, provenance: "not-assessed", reason };
}

/** Pacing, measured from the real beat timings. */
function pacingScores(storyboard: PlatformScriptStoryboard): DimensionScore[] {
  const envelope = PACING_ENVELOPES[storyboard.platform];
  const beats = storyboard.beats;
  const durations = beats.map((beat) => beat.endSecond - beat.startSecond);

  const hook = durations[0] ?? 0;
  // A hook longer than the envelope has spent the viewer's patience before the
  // story starts.
  const hookScore = hook <= envelope.hookMax ? 10 : clamp(10 - (hook - envelope.hookMax) * 3);

  const tooLong = durations.filter((duration) => duration > envelope.beatMax).length;
  const tooShort = durations.filter((duration) => duration < envelope.beatMin).length;
  const beatScore = clamp(10 - (tooLong + tooShort) * 2.5);

  // Dead time: gaps between the end of one beat and the start of the next.
  let deadTime = 0;
  for (let i = 1; i < beats.length; i += 1) {
    const gap = beats[i].startSecond - beats[i - 1].endSecond;
    if (gap > 0) deadTime += gap;
  }
  const deadScore = deadTime <= envelope.maxDeadTime ? 10 : clamp(10 - (deadTime - envelope.maxDeadTime) * 4);

  const total = beats.length ? beats[beats.length - 1].endSecond - beats[0].startSecond : 0;
  const changesPer10s = total > 0 ? (beats.length / total) * 10 : 0;

  return [
    { dimension: "hook-duration", score: round1(hookScore), provenance: "objective-measurement", measured: { hookSeconds: round1(hook), envelopeMax: envelope.hookMax } },
    { dimension: "beat-duration", score: round1(beatScore), provenance: "objective-measurement", measured: { tooLong, tooShort, beatCount: beats.length } },
    { dimension: "dead-time", score: round1(deadScore), provenance: "objective-measurement", measured: { deadTimeSeconds: round1(deadTime), allowed: envelope.maxDeadTime } },
    { dimension: "visual-change-frequency", score: round1(clamp(changesPer10s < 1.5 ? changesPer10s * 5 : changesPer10s > 6 ? 10 - (changesPer10s - 6) : 10)), provenance: "objective-measurement", measured: { changesPer10Seconds: round1(changesPer10s) } },
  ];
}

/** Caption and typography load, measured from the real cues. */
function captionScores(cues: readonly CaptionCue[]): DimensionScore[] {
  if (cues.length === 0) {
    return [notAssessed("caption-readability", "No caption cues were generated for this creative.")];
  }

  let worstCps = 0;
  let overLineLimit = 0;
  let overCharLimit = 0;
  let totalWords = 0;
  let shortestDwell = Number.POSITIVE_INFINITY;

  for (const cue of cues) {
    const dwell = Math.max(0.001, cue.endSecond - cue.startSecond);
    const text = cue.text ?? "";
    const cps = text.length / dwell;
    worstCps = Math.max(worstCps, cps);
    shortestDwell = Math.min(shortestDwell, dwell);
    totalWords += text.trim().split(/\s+/).filter(Boolean).length;

    // Measure the lines the renderer will actually produce. Splitting the raw
    // text on newlines would grade a wrapping the viewer never sees: the
    // renderer discards newlines and re-wraps at its own width.
    const lines = wrapCaptionForRender(text).split("\\N");
    if (lines.length > CAPTION_MAX_LINES) overLineLimit += 1;
    if (lines.some((line) => line.length > CAPTION_MAX_CHARS_PER_LINE)) overCharLimit += 1;
  }

  // Simultaneous captions: two cues overlapping in time is two things to read
  // at once, which at phone size is one thing too many.
  let overlaps = 0;
  const sorted = [...cues].sort((a, b) => a.startSecond - b.startSecond);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].startSecond < sorted[i - 1].endSecond) overlaps += 1;
  }

  const readability = worstCps <= CPS_COMFORTABLE ? 10 : worstCps >= CPS_MAX ? 3 : clamp(10 - (worstCps - CPS_COMFORTABLE) * (7 / (CPS_MAX - CPS_COMFORTABLE)));
  const density = clamp(10 - overCharLimit * 2 - overLineLimit * 3);

  return [
    { dimension: "caption-readability", score: round1(readability), provenance: "objective-measurement", measured: { worstCharsPerSecond: round1(worstCps), comfortable: CPS_COMFORTABLE, shortestDwellSeconds: round1(shortestDwell) } },
    { dimension: "caption-density", score: round1(density), provenance: "objective-measurement", measured: { cuesOverLineLimit: overLineLimit, cuesOverCharLimit: overCharLimit, totalWords } },
    { dimension: "simultaneous-text-load", score: round1(clamp(10 - overlaps * 5)), provenance: "objective-measurement", measured: { overlappingCuePairs: overlaps } },
    { dimension: "text-hierarchy", score: null, provenance: "not-assessed", reason: "Requires seeing the rendered frame: relative type size and weight are a composition property, not a property of the cue text." },
  ];
}

/**
 * Narrative structure, measured from the beat purposes the generator assigned.
 *
 * A short-form video that never commits the viewer to anything, or that ends
 * without asking for the next step, is structurally broken however well each
 * individual beat is written. These are ordering facts about the storyboard,
 * not judgments about the writing, which is why they can be measured at all.
 */
function narrativeScores(beats: readonly StoryboardBeat[]): DimensionScore[] {
  const purposes = beats.map((beat) => beat.purpose);
  const opensOnHook = purposes[0] === "hook";
  const endsOnCta = purposes.at(-1) === "cta";
  const hasPayoff = purposes.includes("payoff") || purposes.includes("reversal");
  const hasEvidence = purposes.includes("evidence");

  // A purpose appearing twice in a row is the same narrative move repeated,
  // which stalls the story even when the beats are individually fine.
  let repeatedPurposeRuns = 0;
  for (let i = 1; i < purposes.length; i += 1) {
    if (purposes[i] === purposes[i - 1]) repeatedPurposeRuns += 1;
  }

  const structure = clamp(
    (opensOnHook ? 3 : 0) + (endsOnCta ? 3 : 0) + (hasEvidence ? 2 : 0) + (hasPayoff ? 2 : 0) - repeatedPurposeRuns,
  );

  return [
    {
      dimension: "narrative-structure",
      score: round1(structure),
      provenance: "objective-measurement",
      measured: {
        opensOnHook: opensOnHook ? 1 : 0,
        endsOnCta: endsOnCta ? 1 : 0,
        hasEvidenceBeat: hasEvidence ? 1 : 0,
        hasPayoffOrReversal: hasPayoff ? 1 : 0,
        repeatedPurposeRuns,
        order: purposes.join(" -> "),
      },
    },
    {
      dimension: "narrative-satisfaction",
      score: null,
      provenance: "not-assessed",
      reason: "Whether the payoff actually satisfies the promise is a judgment about meaning, not about beat ordering. A machine counting purposes has not watched the video.",
    },
  ];
}

/**
 * Shot diversity within one video.
 *
 * Measured from what actually differs between beats: the visual direction the
 * plan specifies and the on-screen text. Identical values across consecutive
 * beats mean the viewer is looking at the same thing while being told it is a
 * new idea.
 */
function diversityScores(beats: readonly StoryboardBeat[]): DimensionScore[] {
  const directions = beats.map((beat) => beat.visualDirection.trim().toLowerCase());
  const texts = beats.map((beat) => beat.onScreenText.trim().toLowerCase()).filter(Boolean);

  const uniqueDirections = new Set(directions).size;
  const uniqueTexts = new Set(texts).size;

  let longestRun = 1;
  let run = 1;
  for (let i = 1; i < directions.length; i += 1) {
    run = directions[i] === directions[i - 1] ? run + 1 : 1;
    longestRun = Math.max(longestRun, run);
  }

  const uniquenessRatio = directions.length ? uniqueDirections / directions.length : 0;
  // A run of 3+ identical visual directions is the template signature.
  const repetitionPenalty = longestRun >= 3 ? (longestRun - 2) * 3 : 0;

  return [
    { dimension: "shot-uniqueness", score: round1(clamp(uniquenessRatio * 10)), provenance: "objective-measurement", measured: { uniqueVisualDirections: uniqueDirections, beatCount: directions.length } },
    { dimension: "visual-repetition", score: round1(clamp(10 - repetitionPenalty)), provenance: "objective-measurement", measured: { longestIdenticalRun: longestRun } },
    { dimension: "caption-uniqueness", score: round1(clamp(texts.length ? (uniqueTexts / texts.length) * 10 : 10)), provenance: "objective-measurement", measured: { uniqueOnScreenTexts: uniqueTexts, captionedBeats: texts.length } },
  ];
}

/** Narration-to-visual sync and information density, per beat and overall. */
function comprehensionScores(beats: readonly StoryboardBeat[], ctaRoute: string): DimensionScore[] {
  let beatsWithoutNarration = 0;
  let beatsWithoutVisual = 0;
  let worstWordsPerSecond = 0;

  for (const beat of beats) {
    const duration = Math.max(0.001, beat.endSecond - beat.startSecond);
    const words = beat.narration.trim().split(/\s+/).filter(Boolean).length;
    if (words === 0) beatsWithoutNarration += 1;
    if (!beat.visualDirection.trim()) beatsWithoutVisual += 1;
    worstWordsPerSecond = Math.max(worstWordsPerSecond, words / duration);
  }

  // Roughly 3 words/second is brisk narration; beyond 4 the viewer cannot also
  // read a caption and look at a chart.
  const densityScore = worstWordsPerSecond <= 3 ? 10 : clamp(10 - (worstWordsPerSecond - 3) * 3);

  const cta = beats.find((beat) => beat.purpose === "cta");
  const ctaMentionsRoute = cta ? `${cta.onScreenText} ${cta.narration}`.toLowerCase().includes(ctaRoute.toLowerCase()) : false;

  return [
    { dimension: "narration-visual-sync", score: round1(clamp(10 - beatsWithoutNarration * 2 - beatsWithoutVisual * 3)), provenance: "objective-measurement", measured: { beatsWithoutNarration, beatsWithoutVisual } },
    { dimension: "information-density", score: round1(densityScore), provenance: "objective-measurement", measured: { peakWordsPerSecond: round1(worstWordsPerSecond) } },
    { dimension: "cta-clarity", score: cta ? (ctaMentionsRoute ? 10 : 5) : 0, provenance: "objective-measurement", measured: { hasCtaBeat: cta ? 1 : 0, statesRoute: ctaMentionsRoute ? 1 : 0, route: ctaRoute } },
  ];
}

/** Objective audio facts, when an ffmpeg measurement is available. */
export interface AudioEvidence {
  readonly integratedLufs?: number;
  readonly truePeakDbfs?: number;
  readonly silenceIntervals?: number;
  readonly clippedSamples?: number;
}

function audioScores(audio: AudioEvidence | undefined): DimensionScore[] {
  if (!audio) {
    return [
      notAssessed("audio-polish", "No audio measurement was supplied; nothing was rendered, or ffmpeg evidence was not collected."),
      notAssessed("voice-naturalness", "Voice naturalness is a listening judgment. SpecSmith never scores it by machine — see PR #92's human audio gate."),
    ];
  }

  const scores: DimensionScore[] = [];
  if (audio.truePeakDbfs !== undefined) {
    // Above -1 dBFS risks inter-sample clipping on platform re-encode.
    const headroom = audio.truePeakDbfs <= -1 ? 10 : clamp(10 - (audio.truePeakDbfs + 1) * 5);
    scores.push({ dimension: "audio-headroom", score: round1(headroom), provenance: "objective-measurement", measured: { truePeakDbfs: audio.truePeakDbfs } });
  }
  if (audio.integratedLufs !== undefined) {
    // Short-form platforms normalise toward about -14 LUFS.
    const delta = Math.abs(audio.integratedLufs - -14);
    scores.push({ dimension: "loudness-target", score: round1(clamp(10 - delta)), provenance: "objective-measurement", measured: { integratedLufs: audio.integratedLufs, target: -14 } });
  }
  if (audio.silenceIntervals !== undefined) {
    scores.push({ dimension: "dead-air", score: round1(clamp(10 - audio.silenceIntervals * 2)), provenance: "objective-measurement", measured: { silenceIntervals: audio.silenceIntervals } });
  }
  if (audio.clippedSamples !== undefined) {
    scores.push({ dimension: "clipping", score: audio.clippedSamples === 0 ? 10 : 0, provenance: "objective-measurement", measured: { clippedSamples: audio.clippedSamples } });
  }
  scores.push(notAssessed("voice-naturalness", "Voice naturalness is a listening judgment. SpecSmith never scores it by machine — see PR #92's human audio gate."));
  return scores;
}

export interface ReviewInput {
  readonly creativeId: string;
  readonly packageId: string;
  readonly storyboard: PlatformScriptStoryboard;
  readonly captionCues?: readonly CaptionCue[];
  readonly mediaSha256?: string | null;
  readonly audio?: AudioEvidence;
  readonly ctaRoute: string;
  readonly now?: Date;
}

/** Produces the full review. Pure: no I/O, no network, no learner. */
export function reviewCreativeQuality(input: ReviewInput): CreativeQualityReview {
  const { storyboard } = input;
  const slop = scanForSlop({
    title: storyboard.title,
    beats: storyboard.beats.map((beat) => ({ onScreenText: beat.onScreenText, narration: beat.narration })),
    finalCta: storyboard.finalCta,
  });

  const overall: DimensionScore[] = [
    ...pacingScores(storyboard),
    ...captionScores(input.captionCues ?? []),
    ...diversityScores(storyboard.beats),
    ...narrativeScores(storyboard.beats),
    ...comprehensionScores(storyboard.beats, input.ctaRoute),
    ...audioScores(input.audio),
    // Named explicitly so their absence is visible in the artifact rather than
    // being an omission a reader has to notice.
    notAssessed("composition-quality", "Requires seeing the rendered frames. A machine measuring text length cannot judge composition."),
    notAssessed("subject-prominence", "Requires seeing the rendered frames."),
    notAssessed("visual-polish", "Requires seeing the rendered frames."),
    notAssessed("branding-consistency", "Requires comparing rendered frames against a brand reference; no visual brand reference is captured in this repository yet."),
    notAssessed("overall-perceived-production-quality", "This is the human judgment the other dimensions inform. Machine scores do not substitute for it."),
  ];

  const beats: BeatQuality[] = storyboard.beats.map((beat, index): BeatQuality => {
    const duration = beat.endSecond - beat.startSecond;
    const words = beat.narration.trim().split(/\s+/).filter(Boolean).length;
    const weaknesses: string[] = [];

    const envelope = PACING_ENVELOPES[storyboard.platform];
    if (index === 0 && duration > envelope.hookMax) weaknesses.push(`Hook runs ${round1(duration)}s, over the ${envelope.hookMax}s envelope for ${storyboard.platform}.`);
    if (duration > envelope.beatMax) weaknesses.push(`Beat runs ${round1(duration)}s, over the ${envelope.beatMax}s maximum.`);
    if (duration < envelope.beatMin) weaknesses.push(`Beat runs ${round1(duration)}s, under the ${envelope.beatMin}s minimum — too short to land.`);
    if (words === 0) weaknesses.push("Beat has no narration.");
    if (words / Math.max(0.001, duration) > 4) weaknesses.push(`Narration runs at ${round1(words / duration)} words/second; too dense to follow while reading a caption.`);
    if (!beat.onScreenText.trim()) weaknesses.push("Beat has no on-screen text.");
    for (const finding of slop.findings.filter((entry) => entry.location.startsWith(`beat-${index + 1}.`))) {
      weaknesses.push(`${finding.code}: ${finding.message}`);
    }

    return {
      index,
      purpose: beat.purpose,
      durationSeconds: round1(duration),
      scores: [
        { dimension: "beat-duration", score: round1(duration >= envelope.beatMin && duration <= envelope.beatMax ? 10 : 4), provenance: "objective-measurement", measured: { durationSeconds: round1(duration) } },
        { dimension: "information-density", score: round1(clamp(words / Math.max(0.001, duration) <= 3 ? 10 : 10 - (words / duration - 3) * 3)), provenance: "objective-measurement", measured: { words, wordsPerSecond: round1(words / Math.max(0.001, duration)) } },
      ],
      weaknesses,
    };
  });

  const assessed = overall.filter((score) => score.score !== null);
  const productionQualityScore = assessed.length
    ? round1(assessed.reduce((sum, score) => sum + (score.score ?? 0), 0) / assessed.length)
    : 0;

  const strengths = assessed.filter((score) => (score.score ?? 0) >= 9).map((score) => `${score.dimension} is strong (${score.score}/10).`);
  const weaknesses = [
    ...assessed.filter((score) => (score.score ?? 10) < 6).map((score) => `${score.dimension} is weak (${score.score}/10).`),
    ...slop.hardFailures.map((finding) => `${finding.code} at ${finding.location}: ${finding.message}`),
  ];

  return {
    creativeId: input.creativeId,
    packageId: input.packageId,
    platform: storyboard.platform,
    mediaSha256: input.mediaSha256 ?? null,
    reviewedAt: (input.now ?? new Date()).toISOString(),
    beats,
    overall,
    productionQualityScore,
    // Confidence is the share of dimensions that were genuinely measurable.
    // It is not a claim about how good the video is.
    confidence: round1(assessed.length / overall.length),
    strengths,
    weaknesses,
    recommendedFixes: buildFixes(beats, overall, slop),
    slop,
    requiresHumanJudgment: [...HUMAN_ONLY_DIMENSIONS],
  };
}

/** Turns named weaknesses into the exact, beat-scoped changes repair can apply. */
function buildFixes(beats: BeatQuality[], overall: DimensionScore[], slop: SlopReport): RecommendedFix[] {
  const fixes: RecommendedFix[] = [];
  const dimension = (name: string) => overall.find((score) => score.dimension === name);

  const hook = dimension("hook-duration");
  if (hook?.score !== null && hook !== undefined && hook.score < 8) {
    fixes.push({ beats: [0], dimension: "hook-duration", issue: `Hook is ${hook.measured?.hookSeconds}s against a ${hook.measured?.envelopeMax}s envelope.`, fix: "Shorten beat 1 to the envelope, moving any setup into beat 2." });
  }

  const repetition = dimension("visual-repetition");
  if (repetition?.score !== null && repetition !== undefined && repetition.score < 7) {
    const run = Number(repetition.measured?.longestIdenticalRun ?? 0);
    fixes.push({ beats: [], dimension: "visual-repetition", issue: `${run} consecutive beats share one visual direction.`, fix: "Give the middle beats distinct visual directions so each idea looks like a new idea." });
  }

  // Trigger on the MEASUREMENT, not on the derived score. A single overflowing
  // caption is a defect whether or not the averaged score crosses a threshold,
  // and an earlier version of this function stayed silent at 8/10 while a
  // caption ran off the frame.
  const density = dimension("caption-density");
  const overChar = Number(density?.measured?.cuesOverCharLimit ?? 0);
  const overLine = Number(density?.measured?.cuesOverLineLimit ?? 0);
  if (overChar > 0 || overLine > 0) {
    fixes.push({
      beats: [],
      dimension: "caption-density",
      issue: `${overChar} caption(s) exceed ${CAPTION_MAX_CHARS_PER_LINE} characters per rendered line and ${overLine} exceed ${CAPTION_MAX_LINES} lines.`,
      fix: `Shorten the offending captions to ${CAPTION_MAX_LINES} rendered lines of at most ${CAPTION_MAX_CHARS_PER_LINE} characters.`,
    });
  }

  const readability = dimension("caption-readability");
  if (readability?.score != null && readability.score < 8) {
    fixes.push({
      beats: [],
      dimension: "caption-readability",
      issue: `Fastest caption runs at ${readability.measured?.worstCharsPerSecond} characters per second against a comfortable ${CPS_COMFORTABLE}.`,
      fix: "Shorten the caption at a clause boundary, or give the beat more time.",
    });
  }

  const infoDensity = dimension("information-density");
  if (infoDensity?.score != null && infoDensity.score < 7) {
    fixes.push({
      beats: [],
      dimension: "information-density",
      issue: `Narration peaks at ${infoDensity.measured?.peakWordsPerSecond} words per second.`,
      fix: "Cut the densest beat's narration to the single idea it needs, or lengthen the beat.",
    });
  }

  const cta = dimension("cta-clarity");
  if (cta?.score !== null && cta !== undefined && cta.score < 10) {
    const ctaBeat = beats.find((beat) => beat.purpose === "cta");
    fixes.push({ beats: ctaBeat ? [ctaBeat.index] : [], dimension: "cta-clarity", issue: "The CTA beat does not state the exact route.", fix: "Name the SpecSmith route explicitly in the final beat." });
  }

  for (const finding of slop.hardFailures) {
    const match = /^beat-(\d+)\./.exec(finding.location);
    fixes.push({
      beats: match ? [Number(match[1]) - 1] : [],
      dimension: finding.code,
      issue: `${finding.message} (${JSON.stringify(finding.evidence)})`,
      fix: "Rewrite the offending line without the flagged pattern.",
    });
  }

  // Catch-all: any measured dimension scoring below 7 that no rule above named
  // still gets an entry. Without this, adding a dimension silently creates a
  // weakness nothing ever acts on.
  for (const score of overall) {
    if (score.score === null || score.score >= 7) continue;
    if (fixes.some((fix) => fix.dimension === score.dimension)) continue;
    fixes.push({
      beats: [],
      dimension: score.dimension,
      issue: `${score.dimension} scored ${score.score}/10.`,
      fix: "No automated repair rule exists for this dimension; regenerate the creative upstream.",
    });
  }

  for (const beat of beats) {
    for (const weakness of beat.weaknesses) {
      if (weakness.startsWith("Beat has no narration") || weakness.startsWith("Beat has no on-screen text")) {
        fixes.push({ beats: [beat.index], dimension: "narration-visual-sync", issue: weakness, fix: "Supply the missing element for this beat." });
      }
    }
  }

  return fixes;
}
