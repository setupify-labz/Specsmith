// Adapter: research/userbenchmark's cleaning-pipeline output -> the
// production-safe ThirdPartyComponentObservation type.
//
// READ-ONLY BOUNDARY. This file performs no file I/O and is not imported by
// the FPS estimator, the Verified Benchmarks lookup, or any production page —
// see types.ts for why UserBenchmark data cannot be either of those systems.
// It exists so that IF a caller someday hands it rows from
// research/userbenchmark/clean/cleaned-observations.jsonl, the conversion is
// pure, tested, and cannot silently admit an uncertain record — not so that
// conversion happens automatically today. Nothing currently calls this code.

import {
  PRODUCTION_ADMISSIBLE_MATCH_TYPES,
  THIRD_PARTY_METRIC_DEFINITIONS,
  THIRD_PARTY_TIER,
  type CanonicalMatchType,
  type ThirdPartyComponentKind,
  type ThirdPartyComponentObservation,
  type ThirdPartyFormFactor,
} from './types';

/**
 * Shape of one row from research/userbenchmark/clean/cleaned-observations.jsonl
 * (review-queue.jsonl rows are a superset carrying `reviewReasons`, which this
 * adapter ignores in favor of recomputing admissibility from `flags` itself).
 *
 * This is an INPUT contract only — plain data, no methods, no dependency on
 * the research pipeline's code. The adapter takes already-parsed JS objects;
 * it never touches node:fs.
 */
export interface CleanedUserBenchmarkRow {
  gameId: string;
  gameName: string;
  componentKind: string;
  canonicalId: string | null;
  matchType: string;
  matchReason: string;
  formFactor: string;
  source: {
    componentName: string;
    componentRatingId?: string | null;
    componentPageUrl?: string | null;
    samples?: number | null;
    benchPercent?: number | null;
    valuePercent?: number | null;
    priceUsd?: number | null;
    priceStore?: string | null;
  };
  flags: Array<{ flag: string; field: string; detail: string }>;
  provenance: {
    sourceUrl?: string;
    sourceFile?: string;
    sourceContentSha256?: string;
    parserVersion?: string;
  } | null;
}

/**
 * Thrown when a row's matchType/componentKind/formFactor is not one of the
 * values the cleaning pipeline is known to emit. This is a REFUSAL, not a
 * best-effort coercion — an unrecognized value most likely means the pipeline
 * grew a new vocabulary this adapter has not been taught about yet, and
 * guessing which existing bucket it belongs in would risk marking an
 * unresolved case admissible by accident.
 */
export class UnrecognizedCleanedRowError extends Error {}

const KNOWN_MATCH_TYPES: ReadonlySet<string> = new Set(['exact', 'fuzzy-high-confidence', 'unmatched', 'blocked-form-factor']);
const KNOWN_FORM_FACTORS: ReadonlySet<string> = new Set(['desktop', 'laptop', 'integrated', 'unknown']);

function toComponentKind(v: string): ThirdPartyComponentKind {
  if (v === 'gpu' || v === 'cpu') return v;
  throw new UnrecognizedCleanedRowError(`Unrecognized componentKind "${v}" — refusing to guess whether this is a GPU or CPU row.`);
}

function toMatchType(v: string): CanonicalMatchType {
  if (KNOWN_MATCH_TYPES.has(v)) return v as CanonicalMatchType;
  throw new UnrecognizedCleanedRowError(`Unrecognized matchType "${v}" — the cleaning pipeline's vocabulary changed; refusing to guess admissibility rather than default to inadmissible or admissible silently.`);
}

function toFormFactor(v: string): ThirdPartyFormFactor {
  if (KNOWN_FORM_FACTORS.has(v)) return v as ThirdPartyFormFactor;
  throw new UnrecognizedCleanedRowError(`Unrecognized formFactor "${v}".`);
}

/**
 * Converts one cleaning-pipeline row into the production-safe third-party
 * type.
 *
 * ADMISSIBILITY — the rule this whole adapter exists to enforce:
 *
 *   admissible === true  only when BOTH:
 *     (a) matchType is in PRODUCTION_ADMISSIBLE_MATCH_TYPES — currently
 *         'exact' ONLY. 'fuzzy-high-confidence' is a legitimate resolution
 *         for the cleaning pipeline to report (see hardware-normalize.mjs's
 *         doctrine — it is a spelling tolerance, not a similarity search),
 *         but it is deliberately NOT admissible at this production boundary
 *         yet. Confident-for-the-pipeline and safe-for-production are
 *         different questions; see types.ts for why the narrower answer is
 *         the current one.
 *     (b) the row carries zero flags — no malformed value, no impossible
 *         value, no outlier, no suspicious duplicate, no unmatched-hardware
 *         or form-factor-blocked flag. Any flag at all means this exact row
 *         appears in review-queue.jsonl, so "zero flags" and "not in the
 *         review queue" are the same condition by construction.
 *
 * Every other combination is admissible === false — and canonicalId is
 * FORCE-NULLED on the output even when the input row carried one. This
 * matters specifically for the case a naive passthrough would get wrong: a
 * row can be an 'exact' match while ALSO being an outlier or a suspicious
 * duplicate. Checking matchType alone would let that row's catalog id leak
 * through; nulling it here is what stops that. The same nulling is what stops
 * a 'fuzzy-high-confidence' row's id from leaking through too.
 *
 * Never infers, repairs, or guesses a missing value — an unrecognized
 * matchType/componentKind/formFactor throws (UnrecognizedCleanedRowError)
 * rather than being coerced into the closest-looking known value.
 */
export function toThirdPartyComponentObservation(row: CleanedUserBenchmarkRow): ThirdPartyComponentObservation {
  const componentKind = toComponentKind(row.componentKind);
  const matchType = toMatchType(row.matchType);
  const formFactor = toFormFactor(row.formFactor);

  const flags = row.flags ?? [];
  const productionAdmissibleMatch = PRODUCTION_ADMISSIBLE_MATCH_TYPES.has(matchType);
  const admissible = productionAdmissibleMatch && flags.length === 0;

  const inadmissibleReasons: string[] = [];
  if (!productionAdmissibleMatch) {
    inadmissibleReasons.push(`matchType "${matchType}" is not admissible at the production boundary — only 'exact' qualifies today.`);
  }
  for (const f of flags) inadmissibleReasons.push(`${f.flag}: ${f.detail}`);

  return {
    tier: THIRD_PARTY_TIER,
    gameId: row.gameId,
    gameName: row.gameName,
    componentKind,
    canonicalId: admissible ? row.canonicalId : null,
    matchType,
    matchReason: row.matchReason,
    formFactor,
    admissible,
    inadmissibleReasons,
    source: {
      publisher: 'UserBenchmark',
      componentName: row.source.componentName,
      componentRatingId: row.source.componentRatingId ?? null,
      componentPageUrl: row.source.componentPageUrl ?? null,
      samples: row.source.samples ?? null,
      benchPercent: row.source.benchPercent ?? null,
      valuePercent: row.source.valuePercent ?? null,
      priceUsd: row.source.priceUsd ?? null,
      priceStore: row.source.priceStore ?? null,
    },
    metricDefinitions: THIRD_PARTY_METRIC_DEFINITIONS,
    notFpsWarning:
      'benchPercent and valuePercent are UserBenchmark composite scores, not frames per second. No conversion between them and FPS is performed, and none is possible.',
    provenance: row.provenance
      ? {
          sourceUrl: row.provenance.sourceUrl ?? '',
          sourceFile: row.provenance.sourceFile ?? '',
          sourceContentSha256: row.provenance.sourceContentSha256 ?? '',
          parserVersion: row.provenance.parserVersion ?? '',
        }
      : null,
  };
}

export function toThirdPartyComponentObservations(rows: readonly CleanedUserBenchmarkRow[]): ThirdPartyComponentObservation[] {
  return rows.map(toThirdPartyComponentObservation);
}

/** Convenience filter: only records safe to actually use for anything. */
export function admissibleThirdPartyRecords(
  records: readonly ThirdPartyComponentObservation[],
): ThirdPartyComponentObservation[] {
  return records.filter((r) => r.admissible);
}
