import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  efpsStoreSchemaMatches,
  getAllEfpsRecords,
  getEfpsRecordsByClassification,
  getEfpsRecordsForGame,
  getEfpsStore,
  getEfpsStoreSummary,
  getHardwareJoinableEfpsRecords,
  rehydrateEfpsStore,
} from './efpsStore';
import { canonicalEfpsRecordBytes, EFPS_SCHEMA_VERSION, type PersistedEfpsStore } from './efpsTypes';
import { EFPS_HARDWARE_MAP_VERSION } from './efpsHardwareMap';
import { toThirdPartyEfpsRecords, type RawEfpsRow } from './efpsAdapter';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(here, '..', '..');
const datasetDir = path.join(srcRoot, '..', 'research', 'userbenchmark', 'dataset');
const storeFile = path.join(srcRoot, 'data', 'thirdPartyEfps.json');
const readJsonl = (p: string) => fs.readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('the persisted EFPS store', () => {
  it('holds exactly the accepted corpus: 1000 = 135 direct + 865 comparison', () => {
    const s = getEfpsStoreSummary();
    expect(s.total).toBe(1000);
    expect(s.direct).toBe(135);
    expect(s.comparison).toBe(865);
    expect(s.games).toHaveLength(5);
  });

  it('carries 1,865 individual FPS figures — comparisons publish two each', () => {
    // 135 direct x1 + 865 comparison x2. Worth stating separately from the
    // record count so neither number is mistaken for the other.
    expect(getEfpsStoreSummary().datapoints).toBe(135 + 865 * 2);
  });

  it('declares the schema version this code expects', () => {
    expect(efpsStoreSchemaMatches()).toBe(true);
    expect(getEfpsStore().schemaVersion).toBe(EFPS_SCHEMA_VERSION);
  });

  it('says in the data itself that it is separate from the other stores', () => {
    const note = getEfpsStore().note;
    expect(note).toMatch(/measuredObservations\.json/);
    expect(note).toMatch(/benchmarkRecords\.json/);
    expect(note).toMatch(/do not feed the FPS estimator/i);
  });

  it('every stored record is third-party tier and not hardware-joinable', () => {
    const records = getAllEfpsRecords();
    expect(records).toHaveLength(1000);
    expect(records.every((r) => r.tier === 'third-party-crowd-sourced')).toBe(true);
    expect(records.every((r) => r.hardwareJoinable === false)).toBe(true);
    expect(getHardwareJoinableEfpsRecords()).toHaveLength(0);
  });

  it('every stored record keeps its page hash and ownership proof', () => {
    for (const r of getAllEfpsRecords()) {
      expect(r.provenance.sourceContentSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(r.provenance.sourceFile).toMatch(/\.html$/);
      expect(r.ownership.tokenAgreesWithPage).toBe(true);
      expect(r.ownership.efpsGameToken.length).toBeGreaterThan(0);
    }
  });

  it('filters by game and classification', () => {
    expect(getEfpsRecordsForGame('3680')).toHaveLength(200);
    expect(getEfpsRecordsForGame('nope')).toHaveLength(0);
    expect(getEfpsRecordsByClassification('direct')).toHaveLength(135);
    expect(getEfpsRecordsByClassification('comparison')).toHaveLength(865);
  });
});

describe('hardware token resolution in the persisted store', () => {
  it('reports the real token coverage: 0/16 GPU, 2/11 CPU', () => {
    const s = getEfpsStoreSummary();
    expect(s.gpuTokens).toHaveLength(16);
    expect(s.cpuTokens).toHaveLength(11);
    expect(s.gpuTokens.filter((t) => t.resolved)).toHaveLength(0);
    expect(s.cpuTokens.filter((t) => t.resolved).map((t) => t.token).sort()).toEqual(['3600', '3700X']);
  });

  it('no record is joinable, because no GPU token has a catalog counterpart', () => {
    // The both-sides rule doing its job: 110 datapoints have a resolved CPU,
    // and not one of them is joinable.
    const s = getEfpsStoreSummary();
    expect(s.joinableDatapoints).toBe(0);
    expect(s.hardwareJoinable).toBe(0);
    expect(getHardwareJoinableEfpsRecords()).toHaveLength(0);
    const cpuResolved = getAllEfpsRecords().flatMap((r) => r.datapoints).filter((d) => d.hardware.cpu.status === 'resolved');
    expect(cpuResolved).toHaveLength(110);
    expect(cpuResolved.every((d) => d.hardware.joinable === false)).toBe(true);
  });

  it('keeps every original shorthand token, resolved or not', () => {
    for (const r of getAllEfpsRecords()) {
      for (const d of r.datapoints) {
        expect(d.gpuToken.length).toBeGreaterThan(0);
        expect(d.cpuToken.length).toBeGreaterThan(0);
        expect(d.hardware.gpu.token).toBe(d.gpuToken);
        expect(d.hardware.cpu.token).toBe(d.cpuToken);
      }
    }
  });

  it('never reports desktop form factor while anything is unresolved', () => {
    // Desktop/laptop/integrated separation: 'unknown' must not round up.
    for (const r of getAllEfpsRecords()) {
      expect(r.hardware.formFactor).toBe('unknown');
      expect(r.hardware.formFactor).not.toBe('desktop');
    }
  });

  it('gives a two-GPU comparison no single record-level GPU id', () => {
    const twoGpu = getAllEfpsRecords().filter(
      (r) => r.classification === 'comparison' && r.datapoints[0].gpuToken !== r.datapoints[1].gpuToken,
    );
    expect(twoGpu).toHaveLength(580);
    expect(twoGpu.every((r) => r.hardware.canonicalGpuId === null)).toBe(true);
  });

  it('records the block reason for every unresolved token', () => {
    for (const t of [...getEfpsStoreSummary().gpuTokens, ...getEfpsStoreSummary().cpuTokens]) {
      if (t.resolved) continue;
      expect(t.canonicalId).toBeNull();
      expect(t.blockReason, `${t.token} must say why it is blocked`).toBeTruthy();
      expect((t.detail ?? '').length).toBeGreaterThan(0);
    }
  });

  it('the committed review report is not stale', () => {
    // The report states the store's content hash and token counts; if the
    // corpus or the map moves without regenerating it, this catches the drift.
    const report = fs.readFileSync(path.join(srcRoot, '..', 'research', 'userbenchmark', 'efps-token-resolution.md'), 'utf-8');
    expect(report).toContain(getEfpsStore().contentSha256);
    expect(report).toContain(`Token map version: **${EFPS_HARDWARE_MAP_VERSION}**`);
  });

  it('the store declares the map version it was built under', () => {
    expect(getEfpsStore().hardwareMapVersion).toBe(EFPS_HARDWARE_MAP_VERSION);
    expect(getEfpsStore().counts.hardware).toEqual({
      uniqueGpuTokens: 16,
      uniqueCpuTokens: 11,
      resolvedGpuTokens: 0,
      resolvedCpuTokens: 2,
      joinableDatapoints: 0,
      totalDatapoints: 1865,
    });
  });
});

describe('the store file is its own database', () => {
  it('is a separate file from every other data store', () => {
    for (const other of ['benchmarkRecords.json', 'measuredObservations.json', 'games.json', 'gpus.json', 'cpus.json']) {
      expect(fs.existsSync(path.join(srcRoot, 'data', other))).toBe(true);
    }
    expect(fs.existsSync(storeFile)).toBe(true);
    // And none of those other stores mention EFPS.
    for (const other of ['benchmarkRecords.json', 'measuredObservations.json', 'games.json']) {
      const text = fs.readFileSync(path.join(srcRoot, 'data', other), 'utf-8');
      expect(text).not.toContain('ub-efps-');
      expect(text).not.toContain('third-party-crowd-sourced');
    }
  });

  it('leaves the measured store empty and benchmarkRecords free of UserBenchmark', () => {
    const measured = JSON.parse(fs.readFileSync(path.join(srcRoot, 'data', 'measuredObservations.json'), 'utf-8'));
    expect(measured.observations).toHaveLength(0);
    const bench = JSON.parse(fs.readFileSync(path.join(srcRoot, 'data', 'benchmarkRecords.json'), 'utf-8'));
    expect(bench.some((r: { source?: { publisher?: string } }) => r.source?.publisher === 'UserBenchmark')).toBe(false);
  });
});

describe('normalization is lossless', () => {
  it('rehydrates to exactly what the adapter produced before persistence', () => {
    // The on-disk form stores the invariant strings once and references the
    // source page by index. This proves that is a storage detail only: the
    // rehydrated records are deep-equal to a fresh conversion of the corpus.
    const rows = [
      ...readJsonl(path.join(datasetDir, 'efps.jsonl')),
      ...readJsonl(path.join(datasetDir, 'efps-comparisons.jsonl')),
    ] as RawEfpsRow[];
    expect(getAllEfpsRecords()).toEqual(toThirdPartyEfpsRecords(rows));
  });

  it('the declared contentSha256 matches a hash recomputed from the rehydrated records', () => {
    const recomputed = createHash('sha256').update(canonicalEfpsRecordBytes(getAllEfpsRecords())).digest('hex');
    expect(recomputed).toBe(getEfpsStore().contentSha256);
  });

  it('stores each captured page once rather than per record', () => {
    const persisted = JSON.parse(fs.readFileSync(storeFile, 'utf-8')) as PersistedEfpsStore;
    expect(persisted.sources).toHaveLength(5);
    expect(persisted.records).toHaveLength(1000);
    // Every record points at a real source entry.
    expect(persisted.records.every((r) => persisted.sources[r.sourceRef] !== undefined)).toBe(true);
  });

  it('rehydration is a pure function of the persisted input', () => {
    const persisted = JSON.parse(fs.readFileSync(storeFile, 'utf-8')) as PersistedEfpsStore;
    expect(rehydrateEfpsStore(persisted).records).toEqual(rehydrateEfpsStore(persisted).records);
  });
});

describe('ingestion is deterministic and idempotent', () => {
  it('re-converting the corpus reproduces the persisted content hash exactly', () => {
    // The strong form: not "the file did not change", but "rebuilding from the
    // source corpus lands on the same hash the file claims".
    const rows = [
      ...readJsonl(path.join(datasetDir, 'efps.jsonl')),
      ...readJsonl(path.join(datasetDir, 'efps-comparisons.jsonl')),
    ] as RawEfpsRow[];
    const rebuilt = createHash('sha256').update(canonicalEfpsRecordBytes(toThirdPartyEfpsRecords(rows))).digest('hex');
    expect(rebuilt).toBe(getEfpsStore().contentSha256);
  });

  it('carries no timestamp or other run-varying field', () => {
    // A wall-clock stamp would make every re-run produce a different file and
    // silently break idempotency — the failure this store is built to avoid.
    const text = fs.readFileSync(storeFile, 'utf-8');
    expect(text).not.toMatch(/"generatedAt"|"ingestedAt"|"timestamp"/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('record ids are stable, unique, and derived from source content', () => {
    const ids = getAllEfpsRecords().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('ub-efps-'))).toBe(true);
    // Sorted order is what makes the file independent of input order.
    expect([...ids].sort()).toEqual(ids);
  });
});
