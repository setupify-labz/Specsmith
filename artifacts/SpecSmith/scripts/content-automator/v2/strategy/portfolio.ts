// Portfolio reasoning: duplication, saturation, novelty and cannibalization.
//
// WHY A VIDEO IS NOT JUDGED ALONE
// -------------------------------
// The eighth GPU comparison in a row is strategically worse than the first even
// if it is individually just as good. A per-piece optimiser cannot see that, so
// it produces a channel that is eight variations on one idea and calls each one
// a success.
//
// WHAT IS REAL HERE AND WHAT IS NOT
// ---------------------------------
// SpecSmith has published nothing, so there is no history to balance against.
// That is exactly why `PortfolioHistory` is an explicit input rather than
// something this module goes and reads: supplied empty, every opportunity is
// trivially novel and nothing is saturated, and the report says the balance is
// unknown rather than healthy. MASTER #6 will supply a real history; the
// interface it will fill is here and is already exercised by tests with a
// synthetic one.
//
// WHY DUPLICATION IS NOT STRING EQUALITY
// --------------------------------------
// "RTX 4080 vs 4080 Super" and "4080 Super vs RTX 4080" are the same video, and
// a typo in a product name must not split them into two. Duplication is judged
// on a normalized subject set plus the thesis, so word order, casing and
// separators cannot manufacture novelty.

import { createHash } from "node:crypto";

import { normalizeForMatching } from "../research/claimMention.ts";
import { contentPillar, type ContentPillarId, type OpportunityType, type StrategicObjective, type StrategicOpportunity } from "./model.ts";

/** One thing SpecSmith already did. Supplied, never assumed. */
export interface PortfolioEntry {
  readonly entryId: string;
  readonly publishedAt: string;
  readonly pillar: ContentPillarId;
  readonly type: OpportunityType;
  readonly objective: StrategicObjective;
  /** The claim or thesis the piece asserted. */
  readonly thesis: string;
  /** Subjects compared or explained, e.g. product ids. */
  readonly subjectIds: readonly string[];
  readonly angleId: string;
  readonly formatClass: string;
}

export interface PortfolioHistory {
  readonly entries: readonly PortfolioEntry[];
  /**
   * Whether this history is complete enough to reason from.
   *
   * False means "we have no record", which is different from "we published
   * nothing". The report must not read an empty history as a balanced one.
   */
  readonly complete: boolean;
  readonly note: string;
}

/** The current reality: nothing published, so no history exists. */
export function emptyPortfolioHistory(): PortfolioHistory {
  return {
    entries: [],
    complete: false,
    note: "No SpecSmith creative has been published, so there is no portfolio history. Balance and saturation are therefore unknown, not healthy.",
  };
}

/**
 * A subject-set fingerprint that word order cannot change.
 *
 * Subjects are normalized through MASTER #2's matcher normalizer (so a
 * non-breaking hyphen or full-width character cannot split a pair) and sorted,
 * so "a vs b" and "b vs a" collide as they should.
 */
export function subjectFingerprint(subjectIds: readonly string[]): string {
  const canonical = [...new Set(subjectIds.map((id) => normalizeForMatching(id).replace(/[^a-z0-9]/g, "")))]
    .filter(Boolean)
    .sort();
  return createHash("sha256").update(canonical.join("|")).digest("hex").slice(0, 16);
}

/**
 * A thesis fingerprint tolerant of rewording.
 *
 * Content words only, sorted, so "GPU-A beats GPU-B" and "GPU-B is beaten by
 * GPU-A" collide. Five cosmetic rewrites of one thesis are one thesis.
 */
export function thesisFingerprint(thesis: string): string {
  const STOP = new Set([
    "the", "a", "an", "is", "are", "was", "were", "and", "or", "of", "to", "in", "on",
    "at", "for", "with", "this", "that", "it", "its", "than", "more", "less", "be",
    "has", "have", "by", "vs", "versus", "your", "you",
  ]);
  const words = [...new Set(
    normalizeForMatching(thesis).split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !STOP.has(word)),
  )].sort();
  return createHash("sha256").update(words.join("|")).digest("hex").slice(0, 16);
}

export type DuplicationVerdict = "novel" | "same-thesis" | "same-subjects" | "same-angle-and-pillar" | "unknown";

export interface DuplicationFinding {
  readonly verdict: DuplicationVerdict;
  /** The entry it duplicates, when there is one. */
  readonly againstEntryId: string | null;
  readonly reason: string;
}

/**
 * Whether an opportunity repeats something already done.
 *
 * Returns `unknown` — not `novel` — when the history is incomplete. Calling an
 * unverifiable thing novel is how a duplicate gets produced.
 */
export function detectDuplication(
  opportunity: StrategicOpportunity,
  subjectIds: readonly string[],
  history: PortfolioHistory,
): DuplicationFinding {
  if (!history.complete) {
    return {
      verdict: "unknown",
      againstEntryId: null,
      reason: `Duplication cannot be established: ${history.note}`,
    };
  }

  const thesis = thesisFingerprint(opportunity.problem);
  const subjects = subjectFingerprint(subjectIds);

  for (const entry of history.entries) {
    if (thesisFingerprint(entry.thesis) === thesis) {
      return { verdict: "same-thesis", againstEntryId: entry.entryId, reason: `Asserts the same thesis as ${entry.entryId}, published ${entry.publishedAt}.` };
    }
  }
  for (const entry of history.entries) {
    if (subjectFingerprint(entry.subjectIds) === subjects && entry.pillar === opportunity.pillar) {
      return {
        verdict: "same-subjects",
        againstEntryId: entry.entryId,
        reason: `Covers the same subjects in the same pillar as ${entry.entryId}; a different angle would be needed to justify it.`,
      };
    }
  }
  return { verdict: "novel", againstEntryId: null, reason: "No published entry shares this thesis or this subject pair in this pillar." };
}

export type SaturationVerdict = "fresh" | "warm" | "saturated" | "unknown";

export interface SaturationFinding {
  readonly verdict: SaturationVerdict;
  readonly pillar: ContentPillarId;
  readonly recentCount: number;
  readonly reason: string;
}

/** How many recent pieces before a pillar is over-used. Repeatability sets it. */
const SATURATION_WINDOW_DAYS = 30;
const SATURATION_LIMITS: Record<"high" | "medium" | "low", number> = { high: 4, medium: 2, low: 1 };

/**
 * Whether a pillar has been leaned on too hard lately.
 *
 * The limit comes from the pillar's own `repeatability`: blind comparisons can
 * carry a weekly cadence, launch coverage cannot, and a single limit for both
 * would either starve the first or spam the second.
 */
export function detectSaturation(
  pillarId: ContentPillarId,
  history: PortfolioHistory,
  now: Date,
): SaturationFinding {
  const pillar = contentPillar(pillarId);
  if (!history.complete) {
    return { verdict: "unknown", pillar: pillarId, recentCount: 0, reason: `Saturation cannot be established: ${history.note}` };
  }
  const cutoff = now.getTime() - SATURATION_WINDOW_DAYS * 24 * 3_600_000;
  const recent = history.entries.filter((entry) => entry.pillar === pillarId && Date.parse(entry.publishedAt) >= cutoff);
  const limit = SATURATION_LIMITS[pillar.repeatability];
  const verdict: SaturationVerdict = recent.length > limit ? "saturated" : recent.length === limit ? "warm" : "fresh";
  return {
    verdict,
    pillar: pillarId,
    recentCount: recent.length,
    reason: `${recent.length} piece(s) in ${pillar.name} within ${SATURATION_WINDOW_DAYS} days against a limit of ${limit} for a ${pillar.repeatability}-repeatability pillar.`,
  };
}

/** The axes on which something can genuinely be new. */
export interface NoveltyFinding {
  readonly newTopic: boolean;
  readonly newSubjects: boolean;
  readonly newAngle: boolean;
  readonly newObjective: boolean;
  readonly newFormat: boolean;
  readonly newProductConnection: boolean;
  /** True when at least one axis is genuinely new. Wording is not an axis. */
  readonly isNovel: boolean;
  readonly reason: string;
}

/**
 * Novelty on real axes.
 *
 * Rewording is deliberately absent from the list. A rewritten title is not a new
 * idea, and a system that counts it as one will happily ship the same video five
 * times with five different hooks.
 */
export function assessNovelty(
  opportunity: StrategicOpportunity,
  candidate: { readonly subjectIds: readonly string[]; readonly angleId: string; readonly formatClass: string },
  history: PortfolioHistory,
): NoveltyFinding {
  if (!history.complete) {
    return {
      newTopic: false, newSubjects: false, newAngle: false, newObjective: false,
      newFormat: false, newProductConnection: false, isNovel: false,
      reason: `Novelty cannot be established: ${history.note}`,
    };
  }
  const thesis = thesisFingerprint(opportunity.problem);
  const subjects = subjectFingerprint(candidate.subjectIds);

  const newTopic = !history.entries.some((entry) => thesisFingerprint(entry.thesis) === thesis);
  const newSubjects = !history.entries.some((entry) => subjectFingerprint(entry.subjectIds) === subjects);
  const newAngle = !history.entries.some((entry) => entry.angleId === candidate.angleId);
  const newObjective = !history.entries.some((entry) => entry.objective === opportunity.primaryObjective);
  const newFormat = !history.entries.some((entry) => entry.formatClass === candidate.formatClass);
  const newProductConnection = opportunity.productSurface !== null
    && !history.entries.some((entry) => contentPillar(entry.pillar).productSurface === opportunity.productSurface);

  const axes = [
    newTopic && "topic", newSubjects && "subjects", newAngle && "angle",
    newObjective && "objective", newFormat && "format", newProductConnection && "product connection",
  ].filter(Boolean) as string[];

  return {
    newTopic, newSubjects, newAngle, newObjective, newFormat, newProductConnection,
    isNovel: axes.length > 0,
    reason: axes.length > 0 ? `New on: ${axes.join(", ")}.` : "New on no axis; this differs from existing content only in wording.",
  };
}

export type CannibalizationVerdict = "no-overlap" | "adds-little" | "supersedes" | "unknown";

export interface CannibalizationFinding {
  readonly verdict: CannibalizationVerdict;
  readonly againstEntryId: string | null;
  readonly reason: string;
}

/**
 * Whether new content would take value from existing content rather than add.
 *
 * `supersedes` is a legitimate reason to publish: if the evidence genuinely
 * changed, replacing an outdated piece is the right move. `adds-little` is the
 * refusal case — same subjects, same thesis, nothing new underneath.
 */
export function detectCannibalization(
  opportunity: StrategicOpportunity,
  subjectIds: readonly string[],
  history: PortfolioHistory,
  novelty: NoveltyFinding,
): CannibalizationFinding {
  if (!history.complete) {
    return { verdict: "unknown", againstEntryId: null, reason: `Cannibalization cannot be established: ${history.note}` };
  }
  const subjects = subjectFingerprint(subjectIds);
  const overlapping = history.entries.find(
    (entry) => subjectFingerprint(entry.subjectIds) === subjects && entry.pillar === opportunity.pillar,
  );
  if (!overlapping) return { verdict: "no-overlap", againstEntryId: null, reason: "No existing piece covers these subjects in this pillar." };

  // Fresh evidence is the one thing that justifies covering the same ground.
  const evidenceIsStronger = opportunity.evidenceState === "strongly-supported" || opportunity.evidenceState === "known";
  if (evidenceIsStronger && (novelty.newAngle || novelty.newFormat)) {
    return {
      verdict: "supersedes",
      againstEntryId: overlapping.entryId,
      reason: `Covers the same subjects as ${overlapping.entryId} but with stronger evidence and a different ${novelty.newAngle ? "angle" : "format"}, so it replaces rather than competes.`,
    };
  }
  return {
    verdict: "adds-little",
    againstEntryId: overlapping.entryId,
    reason: `${overlapping.entryId} already covers these subjects in this pillar, and this adds no stronger evidence and no new angle or format.`,
  };
}

export interface PortfolioBalance {
  readonly known: boolean;
  /** Pillars with no coverage at all. Real gaps, when the history is real. */
  readonly uncoveredPillars: readonly ContentPillarId[];
  /** Pillars carrying a disproportionate share. */
  readonly overweightPillars: readonly ContentPillarId[];
  readonly objectiveCoverage: Readonly<Record<string, number>>;
  readonly note: string;
}

/** What the portfolio is missing — answerable only from a real history. */
export function assessBalance(history: PortfolioHistory): PortfolioBalance {
  if (!history.complete) {
    return {
      known: false, uncoveredPillars: [], overweightPillars: [], objectiveCoverage: {},
      note: history.note,
    };
  }
  const counts = new Map<ContentPillarId, number>();
  const objectives: Record<string, number> = {};
  for (const entry of history.entries) {
    counts.set(entry.pillar, (counts.get(entry.pillar) ?? 0) + 1);
    objectives[entry.objective] = (objectives[entry.objective] ?? 0) + 1;
  }
  const total = history.entries.length;
  const uncovered = [...new Set([...counts.keys()])];
  const allPillars = new Set<ContentPillarId>();
  for (const entry of history.entries) allPillars.add(entry.pillar);
  const overweight = [...counts.entries()]
    .filter(([, count]) => total > 0 && count / total > 0.4)
    .map(([pillar]) => pillar)
    .sort();

  return {
    known: true,
    uncoveredPillars: [],
    overweightPillars: overweight,
    objectiveCoverage: objectives,
    note: `${total} published piece(s) across ${uncovered.length} pillar(s).`,
  };
}
