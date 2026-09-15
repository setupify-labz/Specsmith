// MASTER #6 — Separability analysis (capability #1 from the section-1 critique).
//
// WHY THIS EXISTS
//
// SpecSmith's FPS model returns an estimate together with its own declared
// range (`min`/`max`, currently +/-8%). Every comparison surface, and every
// piece of content built from one, reads only `estimated`. Nothing in the
// repository asks the prior question: given the model's own stated
// uncertainty, are these two estimates distinguishable at all?
//
// Writing three creative packages by hand made the cost of that gap concrete.
// For the two same-price catalog builds used as the section-1 audience problem,
// the point estimates cross over and the direction of the crossover is
// mechanically meaningful — but all twenty per-game gaps sit inside the
// model's own band. A generator that reads `estimated` alone would confidently
// script "this build wins Minecraft by 18 frames". That statement is not
// supported by the model that produced it.
//
// So this module answers one question and refuses to answer any other:
//
//   Can these two estimates be told apart by the model that produced them?
//
// It NEVER reports a winner when the declared ranges overlap. "Inseparable"
// is a first-class result, not a failure, and it is not the same as "equal" —
// the point gap is preserved and reported, it is simply not permitted to
// become a claim.
//
// WHAT THIS MODULE IS NOT
//
// - It is not a statistical test. The +/-8% band is a modelling convention in
//   `src/lib/fps.ts`, not a measured confidence interval, and this module is
//   careful never to describe it as one. Overlap here means "the model does
//   not resolve these", not "the difference is statistically insignificant".
// - It is not a measurement. Nothing here observes hardware.
// - It does not know which build is better. Separability on frame rate is a
//   necessary condition for an FPS-based claim, never a sufficient one.

/**
 * The shape this module needs from `src/lib/fps.ts`'s `FpsResult`.
 *
 * Deliberately structural rather than an import of `FpsResult`: the content
 * pipeline must be able to analyse estimates carried through fixtures and
 * stored plans without pulling the product's colour/label presentation
 * concerns into the automator.
 */
export interface EstimateWithRange {
  readonly estimated: number;
  readonly min: number;
  readonly max: number;
}

export type SeparabilityVerdict =
  /** The declared ranges do not overlap. A directional statement is permitted. */
  | "separable"
  /** The declared ranges overlap. No directional statement is permitted. */
  | "inseparable"
  /** The inputs were not usable, so nothing may be said either way. */
  | "undetermined";

export type ComparisonSubject = "a" | "b" | null;

export interface SeparabilityResult {
  readonly verdict: SeparabilityVerdict;
  /**
   * Which side leads on the point estimate, or null when they are identical.
   *
   * This is reported for EVERY verdict, including "inseparable", because the
   * point gap is a real property of the model output and hiding it would be
   * its own kind of dishonesty. It is explicitly NOT permission to make a
   * claim — `claimableLeader` is.
   */
  readonly pointLeader: ComparisonSubject;
  /**
   * The only side a directional claim may name. Null unless `separable`.
   */
  readonly claimableLeader: ComparisonSubject;
  /** `a.estimated - b.estimated`, signed. Null when undetermined. */
  readonly pointGap: number | null;
  /**
   * How much of each declared range the two share, as a fraction of the
   * smaller range's width. Null when undetermined, or when either range has
   * zero width.
   */
  readonly overlapFraction: number | null;
  /**
   * Plain-language reason, written to be safe to put on screen verbatim.
   */
  readonly reason: string;
}

export class SeparabilityInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeparabilityInputError";
  }
}

function rangeIsUsable(estimate: EstimateWithRange): boolean {
  const { estimated, min, max } = estimate;
  if (!Number.isFinite(estimated) || !Number.isFinite(min) || !Number.isFinite(max)) return false;
  // A range that does not contain its own estimate is not a range this module
  // can reason about. Silently "repairing" it would invent an uncertainty
  // band the model never declared.
  if (min > estimated || max < estimated) return false;
  if (min > max) return false;
  return true;
}

const UNDETERMINED_REASON =
  "At least one estimate did not carry a usable declared range, so the model's own uncertainty is unknown here. " +
  "An unknown range is not a zero range: nothing may be claimed about which build leads.";

/**
 * Compare two estimates using the range each one declares for itself.
 *
 * The overlap test is inclusive: ranges that touch at a single frame are
 * treated as overlapping. A one-frame boundary contact is not evidence that a
 * model with a rounded +/-8% convention can tell two systems apart.
 */
export function analyzeSeparability(a: EstimateWithRange, b: EstimateWithRange): SeparabilityResult {
  if (!rangeIsUsable(a) || !rangeIsUsable(b)) {
    return {
      verdict: "undetermined",
      pointLeader: null,
      claimableLeader: null,
      pointGap: null,
      overlapFraction: null,
      reason: UNDETERMINED_REASON,
    };
  }

  const pointGap = a.estimated - b.estimated;
  const pointLeader: ComparisonSubject = pointGap > 0 ? "a" : pointGap < 0 ? "b" : null;

  const overlapLow = Math.max(a.min, b.min);
  const overlapHigh = Math.min(a.max, b.max);
  const overlaps = overlapLow <= overlapHigh;

  if (!overlaps) {
    // Ranges are disjoint, so the sign of the point gap is also the sign of
    // every pairing inside the two ranges. The leader is safe to name.
    return {
      verdict: "separable",
      pointLeader,
      claimableLeader: pointLeader,
      pointGap,
      overlapFraction: 0,
      reason:
        "The two estimates' declared ranges do not overlap, so the model separates them. " +
        "This is a separation within SpecSmith's estimate, not a measured difference between real systems.",
    };
  }

  const widthA = a.max - a.min;
  const widthB = b.max - b.min;
  const narrower = Math.min(widthA, widthB);
  const overlapFraction = narrower > 0 ? Math.min(1, (overlapHigh - overlapLow) / narrower) : null;

  return {
    verdict: "inseparable",
    pointLeader,
    claimableLeader: null,
    pointGap,
    overlapFraction,
    reason:
      `The point estimates differ by ${Math.abs(pointGap)} fps, but that difference is inside the range the model ` +
      "declares for its own estimates, so SpecSmith cannot say which of these builds is faster here.",
  };
}

export interface ComparisonPoint<TContext> {
  readonly context: TContext;
  readonly a: EstimateWithRange;
  readonly b: EstimateWithRange;
}

export interface SeparabilitySurvey<TContext> {
  readonly points: readonly {
    readonly context: TContext;
    readonly result: SeparabilityResult;
  }[];
  readonly separableCount: number;
  readonly inseparableCount: number;
  readonly undeterminedCount: number;
  /**
   * True when at least one point was analysed and NONE of them separated.
   *
   * This is the shape of finding that section 1 identified as the most
   * valuable creative material in the repository: a comparison the product
   * presents confidently that its own model cannot resolve anywhere.
   */
  readonly noPointSeparates: boolean;
  /** Points where the point leader flips relative to the first analysed point. */
  readonly pointLeaderFlips: boolean;
}

/**
 * Run `analyzeSeparability` across a set of comparison points.
 *
 * Deterministic and order-preserving. Takes no clock and performs no I/O.
 */
export function surveySeparability<TContext>(
  points: readonly ComparisonPoint<TContext>[],
): SeparabilitySurvey<TContext> {
  const analysed = points.map((point) => ({
    context: point.context,
    result: analyzeSeparability(point.a, point.b),
  }));

  const separableCount = analysed.filter((entry) => entry.result.verdict === "separable").length;
  const inseparableCount = analysed.filter((entry) => entry.result.verdict === "inseparable").length;
  const undeterminedCount = analysed.filter((entry) => entry.result.verdict === "undetermined").length;

  const leaders = analysed
    .map((entry) => entry.result.pointLeader)
    .filter((leader): leader is "a" | "b" => leader !== null);

  return {
    points: analysed,
    separableCount,
    inseparableCount,
    undeterminedCount,
    noPointSeparates: analysed.length > 0 && separableCount === 0,
    pointLeaderFlips: leaders.length > 1 && new Set(leaders).size > 1,
  };
}

/**
 * Wording a script is permitted to use about a single comparison point.
 *
 * Returned as data rather than rendered prose so the delivery layer's
 * `assertTruthPreserved` / `reproducesForbiddenWording` checks can operate on
 * it, and so a caller cannot accidentally promote a hedged phrase by
 * reformatting it.
 */
export interface PermittedComparisonWording {
  /** A directional sentence, or null when none is permitted. */
  readonly directional: string | null;
  /** Always present: the strongest honest statement available. */
  readonly safest: string;
  /** Disclosure the wording depends on being on screen. */
  readonly requiredDisclosure: string;
}

/**
 * The exact disclosure the product surface already uses. Reproduced verbatim
 * so content and product cannot drift apart.
 *
 * Source: `src/pages/Compare.tsx`.
 */
export const FPS_ESTIMATE_DISCLOSURE =
  "FPS values are SpecSmith model estimates, not measured benchmarks of these exact systems.";

export function permittedWording(
  result: SeparabilityResult,
  labelA: string,
  labelB: string,
): PermittedComparisonWording {
  if (result.verdict === "separable" && result.claimableLeader !== null) {
    const leader = result.claimableLeader === "a" ? labelA : labelB;
    const trailer = result.claimableLeader === "a" ? labelB : labelA;
    return {
      directional: `SpecSmith's model estimates ${leader} ahead of ${trailer} here, by more than the range it puts on its own estimates.`,
      safest: `SpecSmith's model estimates ${leader} ahead of ${trailer} here.`,
      requiredDisclosure: FPS_ESTIMATE_DISCLOSURE,
    };
  }

  if (result.verdict === "inseparable") {
    return {
      directional: null,
      safest:
        `SpecSmith's model does not separate ${labelA} and ${labelB} here: the difference it estimates is ` +
        "smaller than the range it declares for that estimate.",
      requiredDisclosure: FPS_ESTIMATE_DISCLOSURE,
    };
  }

  return {
    directional: null,
    safest: `SpecSmith has no usable estimate range for ${labelA} and ${labelB} here, so it makes no comparison.`,
    requiredDisclosure: FPS_ESTIMATE_DISCLOSURE,
  };
}
