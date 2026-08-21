// Read-only access to the persisted third-party EFPS store.
//
// The store is its OWN file (src/data/thirdPartyEfps.json), deliberately
// separate from:
//   benchmarkRecords.json      cited third-party publications (../benchmarks)
//   measuredObservations.json  SpecSmith's own runs (../measured)
//   games.json / gpus.json / cpus.json   the estimator's base data
//
// Nothing here writes. Ingestion lives in scripts/thirdParty/ingest-efps.mjs,
// outside anything Vite bundles, so this module stays browser-safe and cannot
// mutate the corpus at runtime.
//
// Reading this store does not make EFPS influence anything: no estimator
// coefficient, no verified-benchmark lookup, and no production page consults
// it. It exists so the data is safely storable and readable ahead of any
// decision about what, if anything, to do with it.

import storeData from '../../data/thirdPartyEfps.json';
import {
  EFPS_SCHEMA_VERSION,
  THIRD_PARTY_TIER,
  canonicalEfpsRecordBytes,
  type EfpsClassification,
  type PersistedEfpsStore,
  type ThirdPartyEfpsRecord,
  type ThirdPartyEfpsStore,
} from './efpsTypes';

export { canonicalEfpsRecordBytes };

const persisted = storeData as unknown as PersistedEfpsStore;

/**
 * Expands the normalized on-disk form back into full records.
 *
 * The four invariant strings and the per-page provenance are stored once and
 * re-attached here, so a consumer always sees a complete
 * ThirdPartyEfpsRecord — the normalization is a storage detail, never a
 * missing field. A test asserts these rehydrated records are deep-equal to
 * what the adapter produced before persistence.
 */
export function rehydrateEfpsStore(p: PersistedEfpsStore): ThirdPartyEfpsStore {
  const records: ThirdPartyEfpsRecord[] = p.records.map((r) => {
    const src = p.sources[r.sourceRef];
    return {
      tier: THIRD_PARTY_TIER,
      id: r.id,
      classification: r.classification,
      gameId: src.gameId,
      gameName: src.gameName,
      datapoints: r.datapoints,
      hardwareJoinable: false,
      hardware: {
        status: 'token-namespace-unresolved',
        canonicalGpuId: null,
        canonicalCpuId: null,
        formFactor: 'unknown',
        reason: p.constants.hardwareResolutionReason,
      },
      ownership: {
        efpsGameToken: r.efpsGameToken,
        tokenAgreesWithPage: true,
        admissionRule: p.constants.admissionRule,
      },
      provenance: {
        publisher: 'UserBenchmark',
        gameId: src.gameId,
        gameName: src.gameName,
        sourceUrl: src.sourceUrl,
        sourceFile: src.sourceFile,
        sourceContentSha256: src.sourceContentSha256,
        parserVersion: src.parserVersion,
        extractorVersion: src.extractorVersion,
        extractionMethod: r.extractionMethod,
        rawSourceIdentifier: r.rawSourceIdentifier,
      },
      source: {
        exactTitle: r.exactTitle,
        exactValue: r.exactValue,
        efpsUrl: r.efpsUrl,
        rawUrlPayload: r.rawUrlPayload,
      },
      metricDefinition: p.constants.metricDefinition,
      notMeasuredWarning: p.constants.notMeasuredWarning,
    };
  });
  return {
    schemaVersion: p.schemaVersion,
    note: p.note,
    contentSha256: p.contentSha256,
    counts: p.counts,
    records,
  };
}

// Lazy and memoized: rehydrating 1000 records at module load would cost every
// importer, including ones that only want the summary — and it would make a
// malformed store throw during import rather than at the call that needs it.
let memo: ThirdPartyEfpsStore | null = null;
const storeOf = (): ThirdPartyEfpsStore => (memo ??= rehydrateEfpsStore(persisted));

export function getEfpsStore(): ThirdPartyEfpsStore {
  return storeOf();
}

export function getAllEfpsRecords(): ThirdPartyEfpsRecord[] {
  return storeOf().records;
}

export function getEfpsRecordsForGame(gameId: string): ThirdPartyEfpsRecord[] {
  return storeOf().records.filter((r) => r.gameId === gameId);
}

export function getEfpsRecordsByClassification(classification: EfpsClassification): ThirdPartyEfpsRecord[] {
  return storeOf().records.filter((r) => r.classification === classification);
}

/**
 * The subset whose hardware may be joined to SpecSmith catalog ids.
 *
 * Empty today, and that is the honest answer rather than a placeholder: EFPS
 * hardware tokens live in a namespace the cleaning pipeline has not resolved.
 * Any future consumer must go through this function rather than reading
 * `records` directly, so the gap cannot be skipped by accident.
 */
export function getHardwareJoinableEfpsRecords(): ThirdPartyEfpsRecord[] {
  return storeOf().records.filter((r) => r.hardwareJoinable && r.hardware.canonicalGpuId !== null && r.hardware.canonicalCpuId !== null);
}

export interface EfpsStoreSummary {
  schemaVersion: number;
  total: number;
  direct: number;
  comparison: number;
  /** Individual FPS figures: direct contributes 1, comparison contributes 2. */
  datapoints: number;
  hardwareJoinable: number;
  games: { gameId: string; gameName: string; total: number }[];
}

export function getEfpsStoreSummary(): EfpsStoreSummary {
  const byGame = new Map<string, { gameId: string; gameName: string; total: number }>();
  let datapoints = 0;
  for (const r of storeOf().records) {
    datapoints += r.datapoints.length;
    const g = byGame.get(r.gameId);
    if (g) g.total += 1;
    else byGame.set(r.gameId, { gameId: r.gameId, gameName: r.gameName, total: 1 });
  }
  return {
    schemaVersion: storeOf().schemaVersion,
    total: storeOf().records.length,
    direct: storeOf().records.filter((r) => r.classification === 'direct').length,
    comparison: storeOf().records.filter((r) => r.classification === 'comparison').length,
    datapoints,
    hardwareJoinable: getHardwareJoinableEfpsRecords().length,
    games: [...byGame.values()].sort((a, b) => (a.gameId < b.gameId ? -1 : 1)),
  };
}

/** True when the store's declared schemaVersion matches this code's. */
export function efpsStoreSchemaMatches(): boolean {
  return storeOf().schemaVersion === EFPS_SCHEMA_VERSION;
}
