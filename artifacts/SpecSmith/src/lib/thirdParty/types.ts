// Third-party, crowd-sourced component data — a namespace of its own,
// independent of both `../benchmarks` (BenchmarkRecord/VerifiedFpsResult) and
// `../measured` (MeasuredObservation, tier 'measured'/'community').
//
// WHY THIS CANNOT BE EITHER OF THE OTHER TWO SYSTEMS
// ----------------------------------------------------
// `../benchmarks/types.ts` (BenchmarkRecord) describes ONE cited, dated
// publication reporting a real averageFps for one hardware/settings
// combination: it requires `evidenceQuality` (A-D), `verificationMethod`, and
// a single `source.url`. `../measured/types.ts` (tier 'measured'/'community')
// describes a frame-time run SpecSmith itself performed, or a community
// collector run — either way, something SpecSmith can vouch for having
// actually happened on real hardware it controls or a run it supervised.
//
// UserBenchmark's data is neither. It is a large, ANONYMOUS, crowd-aggregated
// dataset with no single dated publication and no evidence grade — and, more
// fundamentally, it contains NO FPS AT ALL. UserBenchmark's own `benchPercent`
// and `valuePercent` fields are composite standing/value scores relative to
// other hardware on the same page, never a frames-per-second measurement (see
// THIRD_PARTY_METRIC_DEFINITIONS below). Putting UserBenchmark data into
// BenchmarkRecord.averageFps would fabricate a measurement UserBenchmark
// never made; putting it into ObservationTier 'measured' would claim
// SpecSmith performed a run it did not.
//
// So this is a THIRD, independent namespace. Nothing here is importable as a
// BenchmarkRecord, a VerifiedFpsResult, or a MeasuredObservation, and no
// literal `'MEASURED'`/`'measured'` value appears anywhere in this file.
// Nothing in ../benchmarks or ../measured imports from here, and nothing here
// is wired into the FPS estimator, the Verified Benchmarks lookup, or any
// production page — this file defines the boundary; it does not cross it.

/**
 * Fixed to this one value. Distinct on purpose from ObservationTier's
 * 'measured'/'community' (../measured/types.ts) and from VerifiedFpsResult's
 * ResultState 'MEASURED' (../benchmarks/types.ts) — grepping the codebase for
 * either of those strings must never turn up this file.
 */
export type ThirdPartyDataTier = 'third-party-crowd-sourced';
export const THIRD_PARTY_TIER: ThirdPartyDataTier = 'third-party-crowd-sourced';

export type ThirdPartyComponentKind = 'gpu' | 'cpu';

/**
 * Mirrors research/userbenchmark/lib/hardware-normalize.mjs's MATCH values
 * verbatim, so the adapter can refuse rather than guess when the cleaning
 * pipeline's vocabulary ever changes underneath it.
 */
export type CanonicalMatchType = 'exact' | 'fuzzy-high-confidence' | 'unmatched' | 'blocked-form-factor';

/**
 * Which matchTypes may expose a canonicalId at the PRODUCTION boundary.
 *
 * Exact-match only, for now. This is deliberately narrower than "confident":
 * per hardware-normalize.mjs's own doctrine, 'fuzzy-high-confidence' is not a
 * similarity search — only a formatting variant (separator/Ti/Super/VRAM-
 * suffix) that resolves to exactly one catalog entry, a spelling tolerance
 * rather than an uncertain guess — so it is a legitimate, confident state for
 * the CLEANING PIPELINE to report. But "legitimate input state" and "safe to
 * expose to production" are different questions, and this boundary answers
 * the second one conservatively: until fuzzy matches have been reviewed at
 * scale, admitting only exact matches is the smaller, more reversible claim.
 * Widening this set later is a one-line, deliberate decision — not a default
 * this file falls into by treating "confident" as automatically "admissible".
 *
 * 'unmatched' and 'blocked-form-factor' are never admissible by construction.
 */
export const PRODUCTION_ADMISSIBLE_MATCH_TYPES: ReadonlySet<CanonicalMatchType> = new Set(['exact']);

export type ThirdPartyFormFactor = 'desktop' | 'laptop' | 'integrated' | 'unknown';

/**
 * What UserBenchmark's own numbers actually mean. Travels with every record
 * so a downstream reader cannot mistake a composite score for a measured
 * frame rate — this is the one rule the whole module exists to protect, and
 * it is enforced again in a test that scans every field name for "fps".
 */
export const THIRD_PARTY_METRIC_DEFINITIONS = Object.freeze({
  benchPercent:
    "UserBenchmark composite performance score (0-100) for this component within this game's sample set. NOT frames per second. Must never be converted to FPS or displayed alongside it as though comparable.",
  valuePercent:
    'UserBenchmark price/performance score, expressed as a percentage of a baseline. NOT frames per second, and not bounded at 100 (a part offering better-than-baseline value legitimately scores above it).',
  samples: 'Number of user submissions UserBenchmark aggregated into this row. Not a performance measurement.',
  priceUsd: 'Retail price in USD as displayed by UserBenchmark at capture time. Volatile; not a performance metric.',
});

export interface ThirdPartySourceValues {
  /** Fixed. This module exists for UserBenchmark; a different third-party source would get its own adapter, not a variant publisher string here. */
  publisher: 'UserBenchmark';
  componentName: string;
  componentRatingId: string | null;
  componentPageUrl: string | null;
  samples: number | null;
  benchPercent: number | null;
  valuePercent: number | null;
  priceUsd: number | null;
  priceStore: string | null;
}

export interface ThirdPartyProvenance {
  sourceUrl: string;
  sourceFile: string;
  sourceContentSha256: string;
  parserVersion: string;
}

/**
 * One component's third-party, crowd-sourced standing for one game.
 *
 * NOT a BenchmarkRecord: no averageFps (UserBenchmark publishes none), no
 * evidenceQuality, no verificationMethod, no single citable source.url.
 * NOT a MeasuredObservation: `tier` is fixed at 'third-party-crowd-sourced'
 * and can never be 'measured' or 'community'.
 */
export interface ThirdPartyComponentObservation {
  tier: ThirdPartyDataTier;
  gameId: string;
  gameName: string;
  componentKind: ThirdPartyComponentKind;

  /**
   * A SpecSmith catalog id (matching gpus.json/cpus.json) — populated ONLY
   * when `admissible` is true. Force-nulled otherwise, even if the upstream
   * cleaning-pipeline row carried one; see the adapter's doc comment for the
   * exact rule and why nulling (not merely flagging) is required.
   */
  canonicalId: string | null;
  matchType: CanonicalMatchType;
  matchReason: string;
  formFactor: ThirdPartyFormFactor;

  /**
   * Whether this record may be treated as usable, resolved third-party data.
   * False for anything unmatched, form-factor-blocked (laptop/integrated),
   * malformed, an outlier, a suspicious duplicate, or anything else the
   * cleaning pipeline routed to its review queue. A false record still
   * carries every other field — nothing is hidden — but callers MUST check
   * this flag (or call `admissibleThirdPartyRecords`) before using one.
   */
  admissible: boolean;
  /** Why `admissible` is false. Empty exactly when `admissible` is true. */
  inadmissibleReasons: string[];

  /** UserBenchmark's own published values, verbatim. Never repaired or inferred. */
  source: ThirdPartySourceValues;
  metricDefinitions: typeof THIRD_PARTY_METRIC_DEFINITIONS;
  notFpsWarning: string;
  provenance: ThirdPartyProvenance | null;
}
