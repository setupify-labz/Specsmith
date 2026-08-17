import { describe, it, expect } from 'vitest';
import { validateBenchmarkRecord, validateAllBenchmarkRecords, validateGameFeatureProfiles } from './validate';
import { getAllBenchmarkRecords, getVerifiedGames } from './lookup';
import type { BenchmarkRecord, GameFeatureProfile } from './types';
import gpuData from '../../data/gpus.json';
import cpuData from '../../data/cpus.json';

const knownGpuIds = new Set((gpuData as { id: string }[]).map((g) => g.id));
const knownCpuIds = new Set((cpuData as { id: string }[]).map((c) => c.id));
// The namespace benchmarkRecord.gameId must resolve against is
// gameFeatureProfiles.json, not games.json — see validate.ts's doc comment
// on validateBenchmarkRecord for why they're deliberately independent.
const knownVerifiedGameIds = new Set(getVerifiedGames().map((p) => p.gameId));

// Part 1: the real "honest database" itself must always be clean. This is
// a regression gate — if a future hand-edit to benchmarkRecords.json or
// gameFeatureProfiles.json introduces a typo or a dangling reference,
// `pnpm test` fails here instead of the bad data silently shipping.
describe('real bundled benchmark data is internally consistent', () => {
  it('every benchmarkRecords.json entry passes validation', () => {
    const issues = validateAllBenchmarkRecords(getAllBenchmarkRecords(), knownGpuIds, knownCpuIds, knownVerifiedGameIds);
    expect(issues).toEqual([]);
  });

  it('every gameFeatureProfiles.json entry passes validation', () => {
    const issues = validateGameFeatureProfiles(getVerifiedGames());
    expect(issues).toEqual([]);
  });
});

// Part 2: synthetic fixtures (never written to the real JSON) proving the
// validator actually catches each class of problem it claims to catch.
// Uses its own tiny catalog, independent of the real data files, so these
// tests exercise the validator's logic in isolation.
const knownGameIds = new Set(['game-a']);
const validRecord: BenchmarkRecord = {
  id: 'fixture-valid',
  gameId: 'game-a',
  cpuId: 'r5-5600',
  gpuId: 'rtx3060',
  resolution: '1080p',
  preset: 'ultra',
  rayTracing: false,
  upscaler: 'native',
  frameGeneration: false,
  averageFps: 100,
  source: { url: 'https://example.test/article', publisher: 'Example Publisher', accessedAt: '2026-01-01' },
  evidenceQuality: 'B',
  verificationMethod: 'search-summary',
  confirmedFields: ['cpu', 'gpu', 'resolution', 'preset', 'averageFps', 'sourceUrl'],
};

describe('validateBenchmarkRecord — catches real problem classes', () => {
  it('accepts a well-formed record with zero errors', () => {
    expect(validateBenchmarkRecord(validRecord, knownGpuIds, knownCpuIds, knownGameIds)).toEqual([]);
  });

  it('rejects an unknown gpuId', () => {
    const errors = validateBenchmarkRecord({ ...validRecord, gpuId: 'rtx9999-fake' }, knownGpuIds, knownCpuIds, knownGameIds);
    expect(errors.some((e) => e.includes('gpuId'))).toBe(true);
  });

  it('rejects an unknown cpuId', () => {
    const errors = validateBenchmarkRecord({ ...validRecord, cpuId: 'fake-cpu' }, knownGpuIds, knownCpuIds, knownGameIds);
    expect(errors.some((e) => e.includes('cpuId'))).toBe(true);
  });

  it('rejects an unknown gameId', () => {
    const errors = validateBenchmarkRecord({ ...validRecord, gameId: 'not-a-real-game' }, knownGpuIds, knownCpuIds, knownGameIds);
    expect(errors.some((e) => e.includes('gameId'))).toBe(true);
  });

  it('rejects an invalid evidenceQuality outside A-D', () => {
    const errors = validateBenchmarkRecord({ ...validRecord, evidenceQuality: 'E' as never }, knownGpuIds, knownCpuIds, knownGameIds);
    expect(errors.some((e) => e.includes('evidenceQuality'))).toBe(true);
  });

  it('rejects a confirmedFields entry that is not a real provenance field', () => {
    const errors = validateBenchmarkRecord(
      { ...validRecord, confirmedFields: ['cpu', 'notARealField' as never] },
      knownGpuIds, knownCpuIds, knownGameIds,
    );
    expect(errors.some((e) => e.includes('unknown field'))).toBe(true);
  });

  it('rejects a duplicate entry within confirmedFields', () => {
    const errors = validateBenchmarkRecord(
      { ...validRecord, confirmedFields: ['cpu', 'cpu', 'gpu'] },
      knownGpuIds, knownCpuIds, knownGameIds,
    );
    expect(errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  it('rejects a non-positive averageFps', () => {
    expect(validateBenchmarkRecord({ ...validRecord, averageFps: 0 }, knownGpuIds, knownCpuIds, knownGameIds).length).toBeGreaterThan(0);
    expect(validateBenchmarkRecord({ ...validRecord, averageFps: -5 }, knownGpuIds, knownCpuIds, knownGameIds).length).toBeGreaterThan(0);
  });

  it('rejects onePercentLow greater than averageFps', () => {
    const errors = validateBenchmarkRecord({ ...validRecord, averageFps: 60, onePercentLow: 90 }, knownGpuIds, knownCpuIds, knownGameIds);
    expect(errors.some((e) => e.includes('onePercentLow'))).toBe(true);
  });

  it('rejects a source.url that is not http(s)', () => {
    const errors = validateBenchmarkRecord(
      { ...validRecord, source: { ...validRecord.source, url: 'not a url' } },
      knownGpuIds, knownCpuIds, knownGameIds,
    );
    expect(errors.some((e) => e.includes('source.url'))).toBe(true);
  });

  it('rejects a non-ISO source.accessedAt', () => {
    const errors = validateBenchmarkRecord(
      { ...validRecord, source: { ...validRecord.source, accessedAt: '08/16/2026' } },
      knownGpuIds, knownCpuIds, knownGameIds,
    );
    expect(errors.some((e) => e.includes('accessedAt'))).toBe(true);
  });

  it('rejects upscalerMode set alongside upscaler "native"', () => {
    const errors = validateBenchmarkRecord({ ...validRecord, upscalerMode: 'Quality' }, knownGpuIds, knownCpuIds, knownGameIds);
    expect(errors.some((e) => e.includes('upscalerMode'))).toBe(true);
  });

  it('rejects frameGeneration=true without nativeVsDisplayed confirmed (spec rule 9)', () => {
    const errors = validateBenchmarkRecord(
      { ...validRecord, frameGeneration: true }, // confirmedFields unchanged — doesn't include nativeVsDisplayed
      knownGpuIds, knownCpuIds, knownGameIds,
    );
    expect(errors.some((e) => e.includes('nativeVsDisplayed'))).toBe(true);
  });

  it('accepts frameGeneration=true when nativeVsDisplayed IS confirmed', () => {
    const errors = validateBenchmarkRecord(
      { ...validRecord, frameGeneration: true, confirmedFields: [...validRecord.confirmedFields, 'nativeVsDisplayed'] },
      knownGpuIds, knownCpuIds, knownGameIds,
    );
    expect(errors).toEqual([]);
  });
});

describe('validateAllBenchmarkRecords — cross-record rules', () => {
  it('rejects duplicate ids across records', () => {
    const issues = validateAllBenchmarkRecords([validRecord, { ...validRecord }], knownGpuIds, knownCpuIds, knownGameIds);
    expect(issues.some((i) => i.message.includes('unique'))).toBe(true);
  });
});

describe('validateGameFeatureProfiles — catches real problem classes', () => {
  const validProfile: GameFeatureProfile = {
    gameId: 'cyberpunk2077',
    name: 'Cyberpunk 2077',
    dlss: { status: 'supported' },
    fsr: { status: 'supported' },
    xess: { status: 'supported' },
    frameGeneration: { status: 'supported' },
    rayTracing: { status: 'supported' },
  };

  it('accepts a well-formed profile with zero errors', () => {
    expect(validateGameFeatureProfiles([validProfile])).toEqual([]);
  });

  it('rejects a conditional status with no requirements listed', () => {
    const issues = validateGameFeatureProfiles([{ ...validProfile, rayTracing: { status: 'conditional' } }]);
    expect(issues.some((i) => i.message.includes('conditional'))).toBe(true);
  });

  it('rejects duplicate gameId across profiles', () => {
    const issues = validateGameFeatureProfiles([validProfile, { ...validProfile }], knownGameIds);
    expect(issues.some((i) => i.message.includes('one profile per game'))).toBe(true);
  });
});
