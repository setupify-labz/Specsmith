// Ingests the ACCEPTED UserBenchmark EFPS corpus into the third-party store.
//
//   npx tsx scripts/thirdParty/ingest-efps.ts [--check]
//
// Reads   research/userbenchmark/dataset/efps.jsonl
//         research/userbenchmark/dataset/efps-comparisons.jsonl
// Writes  src/data/thirdPartyEfps.json
//
// DETERMINISTIC AND IDEMPOTENT
// ----------------------------
// No clock, no counter, no randomness anywhere in the output. Record ids come
// from source content, records are sorted by id, and the file is serialized
// through the same canonical function the store exposes for verification. Two
// runs over the same corpus therefore produce byte-identical output, and
// running it twice changes nothing — which `--check` asserts in CI without
// writing.
//
// It reads ONLY the accepted corpus. rejected-records.jsonl is never opened:
// quarantined blocks belong to a different game, and the safest way to keep
// them out is to have no code path that reads them.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  EFPS_ADMISSION_RULE,
  EFPS_TOKEN_NAMESPACE_REASON,
  toThirdPartyEfpsRecords,
  type RawEfpsRow,
} from '../../src/lib/thirdParty/efpsAdapter';
import {
  EFPS_HARDWARE_MAP_VERSION,
  declaredCanonicalIds,
  type EfpsTokenKind,
} from '../../src/lib/thirdParty/efpsHardwareMap';
import {
  canonicalEfpsRecordBytes,
  EFPS_METRIC_DEFINITION,
  EFPS_NOT_MEASURED_WARNING,
  EFPS_SCHEMA_VERSION,
  type PersistedEfpsDatapoint,
  type PersistedEfpsRecord,
  type PersistedEfpsSource,
  type PersistedEfpsStore,
} from '../../src/lib/thirdParty/efpsTypes';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const datasetDir = path.join(repoRoot, 'research', 'userbenchmark', 'dataset');
const outFile = path.join(repoRoot, 'src', 'data', 'thirdPartyEfps.json');

const STORE_NOTE =
  'Third-party crowd-sourced FPS estimates from UserBenchmark. SEPARATE STORE by design: SpecSmith measurements live in measuredObservations.json, cited third-party publications in benchmarkRecords.json, and estimator base data in games.json — none of them are merged with this. These figures do not feed the FPS estimator or the verified-benchmark lookup.';

/**
 * Verifies every canonical id the token map claims actually exists in the
 * catalog, with the name the map says it denotes.
 *
 * This check lives HERE rather than in the map because the third-party
 * boundary forbids src/lib/thirdParty from importing the estimator's base data
 * (separation.test.ts enforces it). The script is node-side and outside the
 * bundle, so it can read the catalog and refuse to write a store whose
 * mappings point at parts SpecSmith does not have — which is exactly what
 * would happen if a catalog entry were later renamed or removed.
 */
function verifyDeclaredIdsAgainstCatalog(): void {
  const catalogs: Record<EfpsTokenKind, { id: string; name: string; brand: string }[]> = {
    gpu: JSON.parse(fs.readFileSync(path.join(repoRoot, 'src', 'data', 'gpus.json'), 'utf-8')),
    cpu: JSON.parse(fs.readFileSync(path.join(repoRoot, 'src', 'data', 'cpus.json'), 'utf-8')),
  };

  for (const kind of ['gpu', 'cpu'] as const) {
    for (const { token, canonicalId, denotes } of declaredCanonicalIds(kind)) {
      const entry = catalogs[kind].find((e) => e.id === canonicalId);
      if (!entry) {
        throw new Error(
          `Token map (v${EFPS_HARDWARE_MAP_VERSION}) maps ${kind} token "${token}" to "${canonicalId}", which is not in ${kind}s.json. Refusing to write a store containing an id the catalog does not have.`,
        );
      }
      // The map says the token denotes e.g. "AMD Ryzen 5 3600"; the catalog
      // stores brand and name separately. Comparing the two catches a mapping
      // that points at a real id belonging to a different part.
      const full = `${entry.brand} ${entry.name}`.toLowerCase();
      const claimed = denotes.toLowerCase();
      if (!full.includes(claimed.replace(/^amd |^intel |^nvidia /, ''))) {
        throw new Error(
          `Token map claims ${kind} token "${token}" denotes "${denotes}", but catalog id "${canonicalId}" is "${entry.brand} ${entry.name}". Refusing to write a mapping whose target does not match its stated part.`,
        );
      }
    }
  }
}

function readJsonl(file: string): RawEfpsRow[] {
  return fs
    .readFileSync(file, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RawEfpsRow);
}

export function buildStore(): PersistedEfpsStore {
  verifyDeclaredIdsAgainstCatalog();

  const rows = [
    ...readJsonl(path.join(datasetDir, 'efps.jsonl')),
    ...readJsonl(path.join(datasetDir, 'efps-comparisons.jsonl')),
  ];

  // Full records first: the hash is computed over the COMPLETE form, so it
  // certifies what a reader gets back after rehydration, not the compressed
  // shape that happens to be on disk.
  const records = toThirdPartyEfpsRecords(rows);
  const contentSha256 = createHash('sha256').update(canonicalEfpsRecordBytes(records)).digest('hex');

  // Normalize: one entry per captured page, referenced by index.
  const sourceKeyOf = (r: (typeof records)[number]) => r.provenance.sourceContentSha256;
  const sourceIndex = new Map<string, number>();
  const sources: PersistedEfpsSource[] = [];
  for (const r of records) {
    const key = sourceKeyOf(r);
    if (sourceIndex.has(key)) continue;
    sourceIndex.set(key, sources.length);
    sources.push({
      gameId: r.provenance.gameId,
      gameName: r.provenance.gameName,
      sourceUrl: r.provenance.sourceUrl,
      sourceFile: r.provenance.sourceFile,
      sourceContentSha256: r.provenance.sourceContentSha256,
      parserVersion: r.provenance.parserVersion,
      extractorVersion: r.provenance.extractorVersion,
    });
  }

  const persistedRecords: PersistedEfpsRecord[] = records.map((r) => ({
    id: r.id,
    classification: r.classification,
    sourceRef: sourceIndex.get(sourceKeyOf(r))!,
    efpsGameToken: r.ownership.efpsGameToken,
    extractionMethod: r.provenance.extractionMethod,
    rawSourceIdentifier: r.provenance.rawSourceIdentifier,
    // Resolution is derived from the token map on read, so only the source's
    // own figures are stored — one copy of the rules, not 1,865.
    datapoints: r.datapoints.map(
      ({ sourceReportedFps, gpuToken, cpuToken, label }): PersistedEfpsDatapoint => ({
        sourceReportedFps,
        gpuToken,
        cpuToken,
        label,
      }),
    ),
    exactTitle: r.source.exactTitle,
    exactValue: r.source.exactValue,
    efpsUrl: r.source.efpsUrl,
    rawUrlPayload: r.source.rawUrlPayload,
  }));

  const allDatapoints = records.flatMap((r) => r.datapoints);
  const distinct = (kind: 'gpu' | 'cpu', onlyResolved: boolean) =>
    new Set(
      allDatapoints
        .filter((d) => !onlyResolved || (kind === 'gpu' ? d.hardware.gpu : d.hardware.cpu).status === 'resolved')
        .map((d) => (kind === 'gpu' ? d.gpuToken : d.cpuToken)),
    ).size;

  return {
    schemaVersion: EFPS_SCHEMA_VERSION,
    hardwareMapVersion: EFPS_HARDWARE_MAP_VERSION,
    note: STORE_NOTE,
    contentSha256,
    counts: {
      total: records.length,
      direct: records.filter((r) => r.classification === 'direct').length,
      comparison: records.filter((r) => r.classification === 'comparison').length,
      hardwareJoinable: records.filter((r) => r.hardwareJoinable).length,
      games: new Set(records.map((r) => r.gameId)).size,
      hardware: {
        uniqueGpuTokens: distinct('gpu', false),
        uniqueCpuTokens: distinct('cpu', false),
        resolvedGpuTokens: distinct('gpu', true),
        resolvedCpuTokens: distinct('cpu', true),
        joinableDatapoints: allDatapoints.filter((d) => d.hardware.joinable).length,
        totalDatapoints: allDatapoints.length,
      },
    },
    constants: {
      metricDefinition: EFPS_METRIC_DEFINITION,
      notMeasuredWarning: EFPS_NOT_MEASURED_WARNING,
      admissionRule: EFPS_ADMISSION_RULE,
      hardwareResolutionReason: EFPS_TOKEN_NAMESPACE_REASON,
    },
    sources,
    records: persistedRecords,
  };
}

/** The exact bytes written to disk — one definition, so --check cannot drift. */
export function serializeStore(store: PersistedEfpsStore): string {
  return `${JSON.stringify(store, null, 2)}\n`;
}

function main(argv: string[]): void {
  const checkOnly = argv.includes('--check');
  const store = buildStore();
  const serialized = serializeStore(store);

  const existing = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf-8') : null;
  const unchanged = existing === serialized;

  console.log(`EFPS records: ${store.counts.total} (${store.counts.direct} direct, ${store.counts.comparison} comparison) across ${store.counts.games} games`);
  const h = store.counts.hardware;
  console.log(`Token map v${EFPS_HARDWARE_MAP_VERSION}: GPU ${h.resolvedGpuTokens}/${h.uniqueGpuTokens} tokens resolved, CPU ${h.resolvedCpuTokens}/${h.uniqueCpuTokens} tokens resolved`);
  console.log(`Datapoints with both sides resolved: ${h.joinableDatapoints}/${h.totalDatapoints}`);
  console.log(`Hardware-joinable records: ${store.counts.hardwareJoinable} (blocked: ${store.counts.total - store.counts.hardwareJoinable})`);
  console.log(`contentSha256: ${store.contentSha256}`);

  if (checkOnly) {
    if (!existing) {
      console.error(`\n${path.relative(repoRoot, outFile)} does not exist. Run without --check to create it.`);
      process.exitCode = 1;
      return;
    }
    if (!unchanged) {
      console.error(`\n${path.relative(repoRoot, outFile)} is out of date with the corpus. Re-run ingestion.`);
      process.exitCode = 1;
      return;
    }
    console.log('\nStore is up to date and byte-identical — ingestion is idempotent.');
    return;
  }

  fs.writeFileSync(outFile, serialized);
  console.log(`\n${unchanged ? 'Unchanged (idempotent re-run)' : 'Wrote'}: ${path.relative(repoRoot, outFile)}`);
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main(process.argv.slice(2));
