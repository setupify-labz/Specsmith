// UserBenchmark EFPS — third-party, crowd-sourced FPS estimates.
//
// EXTENDS the boundary in ./types.ts (same tier constant, same isolation
// rules); it does not open a second door around it.
//
// HOW THIS DIFFERS FROM ThirdPartyComponentObservation
// -----------------------------------------------------
// ./types.ts models UserBenchmark's COMPONENT TABLE rows, whose benchPercent
// and valuePercent are composite standing/value scores and are NOT frames per
// second — that type deliberately has no FPS field at all.
//
// EFPS is a different UserBenchmark dataset: its published numbers genuinely
// ARE frames-per-second estimates ("CSGO 3600 2060S -> 233"). So this type DOES
// carry an FPS field. That makes the naming load-bearing:
// `sourceReportedFps` says whose number it is, and the tier says what kind of
// evidence it is. It is UserBenchmark's crowd-aggregated estimate — not a
// SpecSmith measurement, not a cited third-party publication's benchmark run.
//
// The two datasets are kept in separate types precisely so that no code path
// can move a benchPercent into an FPS field: ThirdPartyComponentObservation has
// nowhere to put one, and this type has no percent-score field to read one
// from. A test asserts the two share no field name.
//
// WHAT THIS IS NOT
// ----------------
// Not a BenchmarkRecord (no cited publication, no evidence grade, no
// verificationMethod). Not a MeasuredObservation (SpecSmith ran nothing). Not
// ResultState 'MEASURED' — that literal never appears here. Nothing in
// ../benchmarks or ../measured imports this file, and nothing here is wired
// into the FPS estimator, the verified-benchmark lookup, or any production
// page: this defines storage and read access, not influence.

import { THIRD_PARTY_TIER, type ThirdPartyDataTier, type ThirdPartyFormFactor } from './types';

export { THIRD_PARTY_TIER };
export type { ThirdPartyDataTier };

/** Schema version of the persisted EFPS store. Bump on any shape change. */
export const EFPS_SCHEMA_VERSION = 1;

/**
 * Direct: one page-published datapoint (one hardware pair -> one FPS).
 * Comparison: one page-published A-vs-B entry carrying TWO datapoints that
 * share a CPU or GPU.
 *
 * Kept as the source's own unit of publication rather than flattened, so the
 * record count matches the corpus exactly (135 direct + 865 comparison = 1000)
 * and a reader can always tell whether two figures were published together as
 * a controlled comparison or independently.
 */
export type EfpsClassification = 'direct' | 'comparison';

/**
 * Why the record's hardware tokens are (or are not) resolvable to SpecSmith
 * catalog ids.
 *
 * EFPS identifies hardware with its own shorthand — "2060S", "3600",
 * "5700-XT" — which is a DIFFERENT namespace from the component-table names
 * ("Nvidia GTX 1050-Ti") that research/userbenchmark's cleaning pipeline
 * resolves. The cleaning pipeline has never resolved an EFPS token, so today
 * every EFPS record carries 'token-namespace-unresolved'.
 *
 * The tempting shortcut is exactly the thing to refuse: the EFPS CPU token
 * "3600" looks like the component row "AMD Ryzen 5 3600", which the pipeline
 * DID resolve. Treating that resemblance as a resolution would be inventing a
 * token->catalog matcher here, in production, with no review — the fuzzy
 * matching this boundary exists to keep out. Resolution belongs upstream in
 * the cleaning pipeline where it can be reviewed at scale; until it happens
 * there, canonical ids stay null.
 */
export type EfpsHardwareResolutionStatus =
  | 'token-namespace-unresolved'
  | 'resolved-by-cleaning-pipeline';

export interface EfpsHardwareResolution {
  status: EfpsHardwareResolutionStatus;
  /** SpecSmith catalog id, or null. Null whenever status is not 'resolved-by-cleaning-pipeline'. */
  canonicalGpuId: string | null;
  canonicalCpuId: string | null;
  /**
   * Form factor of the parts, when known. EFPS shorthand carries no mobile or
   * integrated marker in either direction, so this is 'unknown' — which is NOT
   * 'desktop', and is one of the reasons a record is not hardware-joinable.
   */
  formFactor: ThirdPartyFormFactor;
  reason: string;
}

/** One published FPS figure and the hardware pair it belongs to. */
export interface EfpsDatapoint {
  /**
   * UserBenchmark's own crowd-aggregated FPS estimate, verbatim.
   *
   * NOT measured by SpecSmith and NOT a cited publication's benchmark result.
   * Never populated from benchPercent/valuePercent — those live on a different
   * type entirely and are not frames per second.
   */
  sourceReportedFps: number;
  /** UserBenchmark's EFPS shorthand, verbatim (e.g. "2060S"). Not a catalog id. */
  gpuToken: string;
  cpuToken: string;
  /** The side label as published, for comparison records (e.g. "5700-XT"). */
  label: string | null;
}

/**
 * Proof of why this record survived the EFPS ownership quarantine.
 *
 * UserBenchmark serves a DEFAULT EFPS block on most game pages — 54 of the 59
 * captured games carry CS:GO's dataset rather than their own. Attributing
 * those to the wrong game would be the single worst error available here, so
 * the research pipeline accepts a block only when its embedded game token
 * agrees with the page's own identity, and rejects every other one
 * ('efps-game-token-mismatch'). This records that agreement per record so the
 * admission is auditable rather than assumed.
 */
export interface EfpsOwnership {
  /** The game token embedded in the EFPS payload (e.g. "CSGO"). */
  efpsGameToken: string;
  /** Token agreement is the admission rule — never sample count, never position. */
  tokenAgreesWithPage: boolean;
  admissionRule: string;
}

export interface EfpsSourceProvenance {
  publisher: 'UserBenchmark';
  gameId: string;
  gameName: string;
  sourceUrl: string;
  sourceFile: string;
  /** SHA-256 of the captured page bytes this record was extracted from. */
  sourceContentSha256: string;
  parserVersion: string;
  extractorVersion: string;
  extractionMethod: string;
  rawSourceIdentifier: string;
}

export interface ThirdPartyEfpsRecord {
  /** Fixed. Never 'measured', never 'community', never ResultState 'MEASURED'. */
  tier: ThirdPartyDataTier;
  /** Stable, deterministic id derived from the source payload — see the adapter. */
  id: string;
  classification: EfpsClassification;
  gameId: string;
  gameName: string;

  /** One datapoint for 'direct', two for 'comparison'. */
  datapoints: EfpsDatapoint[];

  /**
   * Whether this record's hardware may be joined to SpecSmith catalog ids.
   * False for every record today; see EfpsHardwareResolutionStatus. A record
   * being stored and readable does NOT make it hardware-joinable.
   */
  hardwareJoinable: boolean;
  hardware: EfpsHardwareResolution;

  ownership: EfpsOwnership;
  provenance: EfpsSourceProvenance;

  /** UserBenchmark's own strings, verbatim, so the record is checkable. */
  source: {
    exactTitle: string;
    exactValue: string;
    efpsUrl: string;
    rawUrlPayload: string;
  };

  metricDefinition: string;
  notMeasuredWarning: string;
}

export interface EfpsStoreCounts {
  total: number;
  direct: number;
  comparison: number;
  hardwareJoinable: number;
  games: number;
}

/**
 * The in-memory shape a reader gets: every record fully populated.
 *
 * This is the API contract. The on-disk form is normalized (see
 * PersistedEfpsStore); efpsStore.ts rehydrates one into the other, so a
 * consumer never has to know the difference.
 */
export interface ThirdPartyEfpsStore {
  schemaVersion: number;
  /** What this store is, stated in the data itself and not only in code. */
  note: string;
  /** Deterministic content hash over the canonicalised records. */
  contentSha256: string;
  counts: EfpsStoreCounts;
  records: ThirdPartyEfpsRecord[];
}

// ---------------------------------------------------------------------------
// Persisted (normalized) form
// ---------------------------------------------------------------------------
//
// Four strings are byte-identical on all 1000 records — the metric definition,
// the not-measured warning, the admission rule, and the hardware-resolution
// reason — and the per-page provenance repeats across only 5 distinct source
// pages. Writing all of that out 1000 times cost 1.4 MB of the 2.9 MB file and
// added nothing a reader could not reconstruct.
//
// So the persisted form holds each constant once and references the source
// page by index. This is a normalization, not a loss: efpsStore.ts rehydrates
// every field, and a test asserts the rehydrated records are deep-equal to
// what the adapter produced before persistence.

/** One captured page, referenced by index from each record. */
export interface PersistedEfpsSource {
  gameId: string;
  gameName: string;
  sourceUrl: string;
  sourceFile: string;
  sourceContentSha256: string;
  parserVersion: string;
  extractorVersion: string;
}

export interface PersistedEfpsRecord {
  id: string;
  classification: EfpsClassification;
  /** Index into PersistedEfpsStore.sources. */
  sourceRef: number;
  efpsGameToken: string;
  extractionMethod: string;
  rawSourceIdentifier: string;
  datapoints: EfpsDatapoint[];
  exactTitle: string;
  exactValue: string;
  efpsUrl: string;
  rawUrlPayload: string;
}

export interface PersistedEfpsStore {
  schemaVersion: number;
  note: string;
  contentSha256: string;
  counts: EfpsStoreCounts;
  /** The invariant strings, stored once instead of 1000 times. */
  constants: {
    metricDefinition: string;
    notMeasuredWarning: string;
    admissionRule: string;
    hardwareResolutionReason: string;
  };
  sources: PersistedEfpsSource[];
  records: PersistedEfpsRecord[];
}

export const EFPS_METRIC_DEFINITION =
  "UserBenchmark's crowd-aggregated FPS estimate for this hardware pair in this game, as published on the game's FPS-Estimates page. Third-party and source-derived: SpecSmith did not measure it, and it is not a cited benchmark publication's result.";

export const EFPS_NOT_MEASURED_WARNING =
  'This is a third-party crowd-sourced estimate, not a SpecSmith measurement and not a verified benchmark record. It must never be presented as either, and it does not feed the FPS estimator.';

/**
 * Canonical serialization of the FULL record list, used for the content hash.
 *
 * Lives here rather than in efpsStore.ts so the ingest script can compute the
 * hash without importing the store — which would otherwise mean parsing the
 * very file it is about to write. Key order is normalized by the replacer, so
 * a record's bytes never depend on the order its properties were built in.
 */
export function canonicalEfpsRecordBytes(records: readonly ThirdPartyEfpsRecord[]): string {
  return JSON.stringify(records, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }
    return value;
  });
}
