import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  EfpsAdmissionError,
  efpsRecordId,
  hardwareJoinableEfpsRecords,
  toThirdPartyEfpsRecord,
  toThirdPartyEfpsRecords,
  type RawEfpsComparisonRow,
  type RawEfpsDirectRow,
  type RawEfpsRow,
} from './efpsAdapter';
import { canonicalEfpsRecordBytes, THIRD_PARTY_TIER } from './efpsTypes';

const here = path.dirname(fileURLToPath(import.meta.url));
const datasetDir = path.join(here, '..', '..', '..', 'research', 'userbenchmark', 'dataset');

const provenance = {
  gameId: '3680',
  sourceUrl: 'https://www.userbenchmark.com/PCGame/FPS-Estimates-X/3680/0.0.0.0.0',
  sourceFile: 'FPS-Estimates-X-3680.html',
  sourceContentSha256: 'a'.repeat(64),
  parserVersion: 'ub-research/2.0.0',
  extractorVersion: 'ub-efps/1.0.0',
  extractionMethod: 'efps:direct',
  rawSourceIdentifier: 'efps[0]',
};

const directRow = (over: Partial<RawEfpsDirectRow> = {}): RawEfpsDirectRow => ({
  recordType: 'efps-direct',
  gameId: '3680',
  gameName: 'Counter-Strike: Global Offensive',
  efpsGameToken: 'CSGO',
  exactTitle: 'CSGO 3600 2060S',
  exactValue: '233',
  fps: 233,
  gpu: '2060S',
  cpu: '3600',
  efpsUrl: 'https://www.userbenchmark.com/EFps/,,,_,,,_CSGO,2060S,3600,',
  rawUrlPayload: ',,,_,,,_CSGO,2060S,3600,',
  provenance,
  ...over,
});

const comparisonRow = (over: Partial<RawEfpsComparisonRow> = {}): RawEfpsComparisonRow => ({
  recordType: 'efps-comparison',
  gameId: '3680',
  gameName: 'Counter-Strike: Global Offensive',
  efpsGameToken: 'CSGO',
  exactTitle: 'CSGO 5700-XT vs 1660-Ti - 9400F',
  exactValue: '211 vs 219',
  sides: [
    { label: '5700-XT', fps: 211, gpu: '5700-XT', cpu: '9400F' },
    { label: '1660-Ti', fps: 219, gpu: '1660-Ti', cpu: '9400F' },
  ],
  efpsUrl: 'https://www.userbenchmark.com/EFps/,1660-Ti,,_,5700-XT,,_CSGO,,9400F,',
  rawUrlPayload: ',1660-Ti,,_,5700-XT,,_CSGO,,9400F,',
  provenance: { ...provenance, extractionMethod: 'efps:comparison', rawSourceIdentifier: 'efps[1]' },
  ...over,
});

describe('EFPS is third-party crowd-sourced, never measured or verified', () => {
  it('carries the third-party tier and never a measured-shaped one', () => {
    const r = toThirdPartyEfpsRecord(directRow());
    expect(r.tier).toBe(THIRD_PARTY_TIER);
    expect(r.tier).toBe('third-party-crowd-sourced');
    expect(r.tier).not.toBe('measured');
    expect(r.tier).not.toBe('MEASURED');
  });

  it('names its FPS field as the source\'s own, and says plainly it is not measured', () => {
    const r = toThirdPartyEfpsRecord(directRow());
    expect(r.datapoints[0].sourceReportedFps).toBe(233);
    expect(r.metricDefinition).toMatch(/crowd-aggregated/i);
    expect(r.notMeasuredWarning).toMatch(/not a SpecSmith measurement/i);
    expect(r.notMeasuredWarning).toMatch(/does not feed the FPS estimator/i);
  });

  it('has no field that could hold an evidence grade or verification method', () => {
    const r = toThirdPartyEfpsRecord(directRow()) as unknown as Record<string, unknown>;
    for (const forbidden of ['evidenceQuality', 'verificationMethod', 'averageFps', 'state', 'record']) {
      expect(Object.keys(r)).not.toContain(forbidden);
    }
  });
});

describe('Bench% / Value% can never populate an FPS field', () => {
  it('refuses a component-table row outright', () => {
    // The only shape that carries benchPercent/valuePercent. It has no route
    // into this type at all — the adapter rejects it on recordType.
    const componentRow = {
      recordType: 'ub-cleaned-observation',
      gameId: '3680',
      gameName: 'CS:GO',
      efpsGameToken: 'CSGO',
      exactTitle: 'x',
      exactValue: 'x',
      fps: 62,
      gpu: 'x',
      cpu: 'x',
      efpsUrl: 'x',
      rawUrlPayload: 'x',
      benchPercent: 62,
      valuePercent: 108,
      provenance,
    } as unknown as RawEfpsRow;
    expect(() => toThirdPartyEfpsRecord(componentRow)).toThrow(EfpsAdmissionError);
    expect(() => toThirdPartyEfpsRecord(componentRow)).toThrow(/not frames per second/i);
  });

  it('ignores a stray benchPercent even when smuggled onto an otherwise valid EFPS row', () => {
    const smuggled = { ...directRow(), benchPercent: 62, valuePercent: 108 } as unknown as RawEfpsRow;
    const r = toThirdPartyEfpsRecord(smuggled);
    // The real published FPS survives; the percent scores are simply not read.
    expect(r.datapoints[0].sourceReportedFps).toBe(233);
    expect(JSON.stringify(r)).not.toContain('benchPercent');
    expect(JSON.stringify(r)).not.toContain('valuePercent');
  });

  it('the EFPS record type shares no field name with the component observation type', () => {
    // Structural guarantee that a percent score has nowhere to land.
    const efps = Object.keys(toThirdPartyEfpsRecord(directRow()));
    const componentOnly = ['benchPercent', 'valuePercent', 'matchType', 'canonicalId', 'admissible'];
    expect(efps.filter((k) => componentOnly.includes(k))).toEqual([]);
  });
});

describe('rejected EFPS cannot cross the boundary', () => {
  it('refuses a row carrying a rejectionReason', () => {
    const rejected = { ...directRow(), rejectionReason: 'efps-game-token-mismatch' } as unknown as RawEfpsRow;
    expect(() => toThirdPartyEfpsRecord(rejected)).toThrow(/quarantined EFPS block may never be admitted/i);
  });

  it('refuses an unknown recordType rather than defaulting it to direct', () => {
    expect(() => toThirdPartyEfpsRecord({ ...directRow(), recordType: 'efps-maybe' } as RawEfpsRow)).toThrow(EfpsAdmissionError);
  });

  it('records the ownership proof that justified admission', () => {
    const r = toThirdPartyEfpsRecord(directRow());
    expect(r.ownership.efpsGameToken).toBe('CSGO');
    expect(r.ownership.tokenAgreesWithPage).toBe(true);
    expect(r.ownership.admissionRule).toMatch(/token agrees/i);
    expect(r.ownership.admissionRule).toMatch(/efps-game-token-mismatch/);
  });
});

describe('uncertain hardware mappings cannot become admissible', () => {
  it('never exposes a canonical id, and says why', () => {
    for (const row of [directRow(), comparisonRow()]) {
      const r = toThirdPartyEfpsRecord(row);
      expect(r.hardwareJoinable).toBe(false);
      expect(r.hardware.canonicalGpuId).toBeNull();
      expect(r.hardware.canonicalCpuId).toBeNull();
      expect(r.hardware.status).toBe('token-namespace-unresolved');
      expect(r.hardware.reason).toMatch(/different namespace/i);
    }
  });

  it('keeps form factor "unknown", which is not "desktop"', () => {
    // EFPS shorthand carries no mobile/integrated marker either way, so the
    // desktop/laptop/integrated boundary is preserved by refusing to claim one.
    const r = toThirdPartyEfpsRecord(directRow());
    expect(r.hardware.formFactor).toBe('unknown');
    expect(r.hardware.formFactor).not.toBe('desktop');
  });

  it('does not resolve the CPU token "3600" despite the lookalike component name', () => {
    // The cleaning pipeline resolved "AMD Ryzen 5 3600" -> r5-3600. The EFPS
    // token "3600" merely resembles it; treating that as a resolution would be
    // an unreviewed fuzzy match.
    const r = toThirdPartyEfpsRecord(directRow({ cpu: '3600' }));
    expect(r.datapoints[0].cpuToken).toBe('3600');
    expect(r.hardware.canonicalCpuId).toBeNull();
  });

  it('exposes an empty hardware-joinable set', () => {
    const records = toThirdPartyEfpsRecords([directRow(), comparisonRow()]);
    expect(hardwareJoinableEfpsRecords(records)).toEqual([]);
  });
});

describe('classification and datapoints', () => {
  it('keeps a direct row as one datapoint', () => {
    const r = toThirdPartyEfpsRecord(directRow());
    expect(r.classification).toBe('direct');
    expect(r.datapoints).toHaveLength(1);
    expect(r.datapoints[0].label).toBeNull();
  });

  it('keeps a comparison as one record carrying both published sides', () => {
    const r = toThirdPartyEfpsRecord(comparisonRow());
    expect(r.classification).toBe('comparison');
    expect(r.datapoints).toHaveLength(2);
    expect(r.datapoints.map((d) => d.sourceReportedFps)).toEqual([211, 219]);
    expect(r.datapoints.map((d) => d.label)).toEqual(['5700-XT', '1660-Ti']);
  });

  it('refuses a comparison that does not have exactly two sides', () => {
    const oneSided = comparisonRow({ sides: [{ label: 'a', fps: 100, gpu: 'x', cpu: 'y' }] });
    expect(() => toThirdPartyEfpsRecord(oneSided)).toThrow(/exactly 2/);
  });

  it('refuses an impossible FPS rather than storing it', () => {
    expect(() => toThirdPartyEfpsRecord(directRow({ fps: 0 }))).toThrow(/non-positive/);
    expect(() => toThirdPartyEfpsRecord(directRow({ fps: Number.NaN }))).toThrow(EfpsAdmissionError);
  });
});

describe('provenance is required, never invented', () => {
  it('refuses a row missing its source hash', () => {
    const noHash = directRow({ provenance: { ...provenance, sourceContentSha256: undefined } });
    expect(() => toThirdPartyEfpsRecord(noHash)).toThrow(/sourceContentSha256/);
  });

  it('carries page, hash, and extractor identity through', () => {
    const r = toThirdPartyEfpsRecord(directRow());
    expect(r.provenance.sourceContentSha256).toBe('a'.repeat(64));
    expect(r.provenance.sourceFile).toBe('FPS-Estimates-X-3680.html');
    expect(r.provenance.extractorVersion).toBe('ub-efps/1.0.0');
    expect(r.provenance.publisher).toBe('UserBenchmark');
  });

  it('keeps UserBenchmark\'s own strings verbatim', () => {
    const r = toThirdPartyEfpsRecord(directRow());
    expect(r.source.exactTitle).toBe('CSGO 3600 2060S');
    expect(r.source.exactValue).toBe('233');
    expect(r.source.rawUrlPayload).toBe(',,,_,,,_CSGO,2060S,3600,');
  });
});

describe('determinism', () => {
  it('derives ids only from source content', () => {
    expect(efpsRecordId(directRow())).toBe(efpsRecordId(directRow()));
    expect(efpsRecordId(directRow())).not.toBe(efpsRecordId(comparisonRow()));
  });

  it('sorts records into a stable order regardless of input order', () => {
    const a = toThirdPartyEfpsRecords([directRow(), comparisonRow()]);
    const b = toThirdPartyEfpsRecords([comparisonRow(), directRow()]);
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
    expect(canonicalEfpsRecordBytes(a)).toBe(canonicalEfpsRecordBytes(b));
  });

  it('refuses duplicate ids rather than silently keeping one', () => {
    expect(() => toThirdPartyEfpsRecords([directRow(), directRow()])).toThrow(/Duplicate EFPS record id/);
  });
});

// The real corpus, converted through the real adapter.
describe('against the real 59-game EFPS corpus', () => {
  const directPath = path.join(datasetDir, 'efps.jsonl');
  const comparisonPath = path.join(datasetDir, 'efps-comparisons.jsonl');
  const rejectedPath = path.join(datasetDir, 'rejected-records.jsonl');
  const hasCorpus = fs.existsSync(directPath) && fs.existsSync(comparisonPath);
  const readJsonl = (p: string) => fs.readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

  it.runIf(hasCorpus)('matches the expected accepted totals: 1000 = 135 direct + 865 comparison', () => {
    const direct = readJsonl(directPath);
    const comparison = readJsonl(comparisonPath);
    expect(direct).toHaveLength(135);
    expect(comparison).toHaveLength(865);

    const records = toThirdPartyEfpsRecords([...direct, ...comparison] as RawEfpsRow[]);
    expect(records).toHaveLength(1000);
    expect(records.filter((r) => r.classification === 'direct')).toHaveLength(135);
    expect(records.filter((r) => r.classification === 'comparison')).toHaveLength(865);
  });

  it.runIf(hasCorpus)('admits EFPS from exactly the 5 games that own their block', () => {
    const records = toThirdPartyEfpsRecords([...readJsonl(directPath), ...readJsonl(comparisonPath)] as RawEfpsRow[]);
    const games = [...new Set(records.map((r) => r.gameId))].sort();
    expect(games).toEqual(['3680', '3727', '3789', '3944', '3954']);
    // Every owning game contributes the same shape: 27 direct + 173 comparison.
    for (const g of games) {
      const forGame = records.filter((r) => r.gameId === g);
      expect(forGame.filter((r) => r.classification === 'direct')).toHaveLength(27);
      expect(forGame.filter((r) => r.classification === 'comparison')).toHaveLength(173);
    }
  });

  it.runIf(fs.existsSync(rejectedPath))('leaves all 10,800 rejected records rejected, and never ingests them', () => {
    const rejected = readJsonl(rejectedPath);
    expect(rejected).toHaveLength(10_800);
    expect(new Set(rejected.map((r) => r.reason))).toEqual(new Set(['efps-game-token-mismatch']));
    // 54 non-owning games x 200 blocks each.
    expect(new Set(rejected.map((r) => r.gameId)).size).toBe(54);
    // And none of them can be admitted even if handed over directly.
    for (const r of rejected.slice(0, 25)) {
      expect(() => toThirdPartyEfpsRecord(r as RawEfpsRow)).toThrow(EfpsAdmissionError);
    }
  });

  it.runIf(hasCorpus)('gives every real record full provenance and zero canonical ids', () => {
    const records = toThirdPartyEfpsRecords([...readJsonl(directPath), ...readJsonl(comparisonPath)] as RawEfpsRow[]);
    expect(records.every((r) => /^[0-9a-f]{64}$/.test(r.provenance.sourceContentSha256))).toBe(true);
    expect(records.every((r) => r.provenance.sourceFile.endsWith('.html'))).toBe(true);
    expect(hardwareJoinableEfpsRecords(records)).toHaveLength(0);
    expect(records.every((r) => r.hardware.formFactor === 'unknown')).toBe(true);
  });

  it.runIf(hasCorpus)('produces a stable content hash across repeated conversions', () => {
    const rows = [...readJsonl(directPath), ...readJsonl(comparisonPath)] as RawEfpsRow[];
    const h = (rs: RawEfpsRow[]) => createHash('sha256').update(canonicalEfpsRecordBytes(toThirdPartyEfpsRecords(rs))).digest('hex');
    expect(h(rows)).toBe(h([...rows].reverse()));
  });
});
