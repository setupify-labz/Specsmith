// Adapter: research/userbenchmark's ACCEPTED EFPS corpus -> the persisted
// third-party EFPS record type.
//
// Pure and deterministic: no file I/O, no clock, no randomness. The same input
// rows always produce byte-identical output, which is what makes the ingestion
// script idempotent (see scripts/thirdParty/ingest-efps.mjs).
//
// WHAT IT REFUSES
// ---------------
// Only rows the research pipeline already ACCEPTED may cross. A rejected
// record (recordType absent, or a quarantined foreign/default EFPS block) is
// refused outright rather than downgraded, because the whole point of the
// quarantine is that those numbers belong to a different game. Component-table
// rows are refused too: their benchPercent/valuePercent are not FPS, and this
// is the one code path that could otherwise put a percent score into an FPS
// field.

import {
  EFPS_METRIC_DEFINITION,
  EFPS_NOT_MEASURED_WARNING,
  THIRD_PARTY_TIER,
  type EfpsClassification,
  type EfpsDatapoint,
  type EfpsHardwareResolution,
  type ThirdPartyEfpsRecord,
} from './efpsTypes';
import {
  isSafelyResolved,
  resolveEfpsToken,
  type EfpsTokenResolution,
} from './efpsHardwareMap';

/** Raw shapes as emitted by research/userbenchmark/dataset/efps*.jsonl. */
export interface RawEfpsProvenance {
  gameId?: string;
  sourceUrl?: string;
  sourceFile?: string;
  sourceContentSha256?: string;
  parserVersion?: string;
  extractorVersion?: string;
  extractionMethod?: string;
  rawSourceIdentifier?: string;
}

export interface RawEfpsDirectRow {
  recordType: string;
  gameId: string;
  gameName: string;
  efpsGameToken: string;
  exactTitle: string;
  exactValue: string;
  fps: number;
  gpu: string;
  cpu: string;
  efpsUrl: string;
  rawUrlPayload: string;
  quality?: string;
  provenance: RawEfpsProvenance;
}

export interface RawEfpsComparisonSide {
  label: string;
  fps: number;
  gpu: string;
  cpu: string;
}

export interface RawEfpsComparisonRow {
  recordType: string;
  gameId: string;
  gameName: string;
  efpsGameToken: string;
  exactTitle: string;
  exactValue: string;
  sides: RawEfpsComparisonSide[];
  efpsUrl: string;
  rawUrlPayload: string;
  quality?: string;
  provenance: RawEfpsProvenance;
}

export type RawEfpsRow = RawEfpsDirectRow | RawEfpsComparisonRow;

/** Thrown for anything that is not an already-accepted EFPS row. */
export class EfpsAdmissionError extends Error {}

const DIRECT_TYPE = 'efps-direct';
const COMPARISON_TYPE = 'efps-comparison';

/**
 * The admission rule, recorded on every record so it is auditable.
 *
 * Token agreement — never sample count, never position on the page. The larger
 * corpus settled this: a 68,277-sample game carries a borrowed block while a
 * 54,796-sample game publishes its own, so size predicts nothing.
 */
export const EFPS_ADMISSION_RULE =
  "The EFPS payload's embedded game token agrees with the page's own identity. Blocks whose token names a different game are UserBenchmark's default (usually CS:GO's) and are rejected upstream as efps-game-token-mismatch — 54 of the 59 captured games carry one.";

/**
 * Why no EFPS record can expose a canonical catalog id today.
 *
 * Stated once, attached to every record, so the gap is visible in the data
 * rather than only in a comment.
 */
export const EFPS_TOKEN_NAMESPACE_REASON =
  'EFPS identifies hardware with UserBenchmark shorthand ("2060S", "3600", "5700-XT"), a different namespace from the component-table names the cleaning pipeline resolves. Tokens are resolved to canonical ids ONLY through the explicit, versioned alias table in efpsHardwareMap.ts — never by similarity, and never by digit overlap, which would map "580" (an AMD RX 580) onto Intel Arc A580. A token with no catalog counterpart, more than one plausible candidate, or no desktop evidence stays blocked with a null canonical id.';

const isComparison = (row: RawEfpsRow): row is RawEfpsComparisonRow => row.recordType === COMPARISON_TYPE;

function requireString(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new EfpsAdmissionError(`EFPS row is missing required field "${field}" — refusing to store a record whose provenance is incomplete.`);
  }
  return v;
}

function requireFps(v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new EfpsAdmissionError(`EFPS ${where} has a non-positive or non-finite FPS value (${JSON.stringify(v)}) — refusing rather than storing an impossible figure.`);
  }
  return v;
}

/**
 * Deterministic record id.
 *
 * Derived only from the source payload (game + classification + the EFPS URL
 * payload, which uniquely identifies the published entry). No counter, no
 * timestamp, no hash of mutable metadata — so re-running ingestion over the
 * same corpus produces the same ids, which is what makes the store idempotent.
 */
export function efpsRecordId(row: RawEfpsRow): string {
  const kind = isComparison(row) ? 'cmp' : 'dir';
  return `ub-efps-${row.gameId}-${kind}-${row.rawUrlPayload}`;
}

/**
 * Attaches token resolution to a datapoint, leaving the tokens themselves
 * untouched.
 *
 * Resolution is per-datapoint rather than per-record because a comparison
 * record's two sides need not share hardware: 580 of the 865 comparisons pit
 * two different GPUs against one another and 285 pit two different CPUs. A
 * single record-level pair would have to pick one side and would therefore be
 * wrong about the other.
 */
export function withHardware(d: Omit<EfpsDatapoint, 'hardware'>): EfpsDatapoint {
  const gpu = resolveEfpsToken(d.gpuToken, 'gpu');
  const cpu = resolveEfpsToken(d.cpuToken, 'cpu');
  return {
    ...d,
    hardware: {
      gpu,
      cpu,
      // Both sides, or neither. A datapoint with a resolved CPU and an unknown
      // GPU describes no hardware pair anyone can look up.
      joinable: isSafelyResolved(gpu) && isSafelyResolved(cpu),
    },
  };
}

/** The one id every datapoint agrees on, or null if they do not all agree. */
function sharedCanonicalId(resolutions: readonly EfpsTokenResolution[]): string | null {
  if (!resolutions.every(isSafelyResolved)) return null;
  const ids = new Set(resolutions.map((r) => r.canonicalId));
  // A two-GPU comparison has two ids and therefore no single record-level GPU.
  // Returning either one would silently attribute both figures to one part.
  return ids.size === 1 ? [...ids][0] : null;
}

/** Record-level summary of the per-datapoint resolutions. */
export function aggregateHardware(
  datapoints: readonly EfpsDatapoint[],
  reason: string = EFPS_TOKEN_NAMESPACE_REASON,
): EfpsHardwareResolution {
  const gpus = datapoints.map((d) => d.hardware.gpu);
  const cpus = datapoints.map((d) => d.hardware.cpu);
  const allResolved = datapoints.every((d) => d.hardware.joinable);
  const anyResolved = [...gpus, ...cpus].some(isSafelyResolved);

  return {
    status: allResolved ? 'resolved' : anyResolved ? 'partial' : 'unresolved',
    canonicalGpuId: sharedCanonicalId(gpus),
    canonicalCpuId: sharedCanonicalId(cpus),
    // 'desktop' requires EVERY token to have resolved as desktop. One
    // unresolved token means the record's form factor is genuinely unknown,
    // and unknown must never round up to desktop.
    formFactor: allResolved ? 'desktop' : 'unknown',
    reason,
  };
}

/**
 * Converts one ACCEPTED EFPS row into a stored third-party record.
 *
 * Throws EfpsAdmissionError for anything else — a component-table row, a
 * rejected/quarantined block, or a row missing the provenance needed to prove
 * where it came from.
 */
export function toThirdPartyEfpsRecord(row: RawEfpsRow): ThirdPartyEfpsRecord {
  if (row.recordType !== DIRECT_TYPE && row.recordType !== COMPARISON_TYPE) {
    throw new EfpsAdmissionError(
      `recordType "${row.recordType}" is not an accepted EFPS record. Only "${DIRECT_TYPE}" and "${COMPARISON_TYPE}" may cross this boundary — component-table rows carry benchPercent/valuePercent, which are composite scores and not frames per second.`,
    );
  }

  // The upstream quarantine only ever writes accepted rows into efps*.jsonl,
  // but a caller could hand this function anything, so the ownership claim is
  // re-checked here rather than trusted.
  const token = requireString(row.efpsGameToken, 'efpsGameToken');
  if (typeof (row as { rejectionReason?: unknown }).rejectionReason === 'string') {
    throw new EfpsAdmissionError('Row carries a rejectionReason — a quarantined EFPS block may never be admitted.');
  }

  const p = row.provenance ?? {};
  const provenance = {
    publisher: 'UserBenchmark' as const,
    gameId: requireString(row.gameId, 'gameId'),
    gameName: requireString(row.gameName, 'gameName'),
    sourceUrl: requireString(p.sourceUrl, 'provenance.sourceUrl'),
    sourceFile: requireString(p.sourceFile, 'provenance.sourceFile'),
    sourceContentSha256: requireString(p.sourceContentSha256, 'provenance.sourceContentSha256'),
    parserVersion: requireString(p.parserVersion, 'provenance.parserVersion'),
    extractorVersion: requireString(p.extractorVersion, 'provenance.extractorVersion'),
    extractionMethod: requireString(p.extractionMethod, 'provenance.extractionMethod'),
    rawSourceIdentifier: requireString(p.rawSourceIdentifier, 'provenance.rawSourceIdentifier'),
  };

  const classification: EfpsClassification = isComparison(row) ? 'comparison' : 'direct';

  const datapoints: EfpsDatapoint[] = isComparison(row)
    ? row.sides.map((s, i) => withHardware({
        sourceReportedFps: requireFps(s.fps, `comparison side ${i}`),
        gpuToken: requireString(s.gpu, `sides[${i}].gpu`),
        cpuToken: requireString(s.cpu, `sides[${i}].cpu`),
        label: s.label ?? null,
      }))
    : [withHardware({
        sourceReportedFps: requireFps(row.fps, 'direct row'),
        gpuToken: requireString(row.gpu, 'gpu'),
        cpuToken: requireString(row.cpu, 'cpu'),
        label: null,
      })];

  if (isComparison(row) && datapoints.length !== 2) {
    throw new EfpsAdmissionError(`Comparison record has ${datapoints.length} sides; a published A-vs-B entry must have exactly 2.`);
  }

  return {
    tier: THIRD_PARTY_TIER,
    id: efpsRecordId(row),
    classification,
    gameId: provenance.gameId,
    gameName: provenance.gameName,
    datapoints,
    hardwareJoinable: datapoints.every((d) => d.hardware.joinable),
    hardware: aggregateHardware(datapoints),
    ownership: {
      efpsGameToken: token,
      tokenAgreesWithPage: true,
      admissionRule: EFPS_ADMISSION_RULE,
    },
    provenance,
    source: {
      exactTitle: requireString(row.exactTitle, 'exactTitle'),
      exactValue: requireString(row.exactValue, 'exactValue'),
      efpsUrl: requireString(row.efpsUrl, 'efpsUrl'),
      rawUrlPayload: requireString(row.rawUrlPayload, 'rawUrlPayload'),
    },
    metricDefinition: EFPS_METRIC_DEFINITION,
    notMeasuredWarning: EFPS_NOT_MEASURED_WARNING,
  };
}

/**
 * Converts a whole corpus, sorted into a stable order.
 *
 * Sorting by id (which is derived purely from source content) is what makes
 * the persisted file independent of input file order, so ingestion is
 * reproducible even if the upstream JSONL is regenerated in a different order.
 */
export function toThirdPartyEfpsRecords(rows: readonly RawEfpsRow[]): ThirdPartyEfpsRecord[] {
  const records = rows.map(toThirdPartyEfpsRecord);
  const ids = new Set<string>();
  for (const r of records) {
    if (ids.has(r.id)) {
      throw new EfpsAdmissionError(`Duplicate EFPS record id "${r.id}" — two rows claim the same published entry, so one of them is not what it says it is.`);
    }
    ids.add(r.id);
  }
  return records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Records whose hardware may be joined to SpecSmith catalog ids.
 *
 * Empty today: no EFPS GPU token has a catalog counterpart, so no record can
 * satisfy the both-sides rule. The re-check of the two ids is deliberate
 * belt-and-braces — a caller cannot get a joinable record by flipping the
 * boolean alone.
 */
export function hardwareJoinableEfpsRecords(records: readonly ThirdPartyEfpsRecord[]): ThirdPartyEfpsRecord[] {
  return records.filter((r) => r.hardwareJoinable && r.hardware.canonicalGpuId !== null && r.hardware.canonicalCpuId !== null);
}
