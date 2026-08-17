import { describe, it, expect } from 'vitest';
import { lookupVerifiedFps, matchesUpscalerMode, getAllBenchmarkRecords, type VerifiedFpsQuery } from './lookup';
import type { BenchmarkRecord } from './types';

// All fixtures below are synthetic, in-memory-only test data — never written
// to benchmarkRecords.json (the real, evidence-only "honest database"). They
// exist purely to exercise lookupVerifiedFps's matching logic in isolation,
// via the injectable `records` parameter lookupVerifiedFps accepts for
// exactly this purpose. gameId is a fake id ("test-game") that doesn't exist
// in the real gameFeatureProfiles.json, so the feature-support gating
// (UNSUPPORTED/CONDITIONAL) is a no-op here and every test is purely about
// record-matching correctness.

const baseRecord: BenchmarkRecord = {
  id: 'fixture-native',
  gameId: 'test-game',
  cpuId: 'cpu-a',
  gpuId: 'gpu-a',
  resolution: '1080p',
  preset: 'ultra',
  rayTracing: false,
  upscaler: 'native',
  frameGeneration: false,
  averageFps: 100,
  source: { url: 'https://example.test/fixture', publisher: 'Fixture Publisher', accessedAt: '2026-01-01' },
  evidenceQuality: 'B',
  verificationMethod: 'search-summary',
  confirmedFields: ['cpu', 'gpu', 'resolution', 'preset', 'averageFps', 'sourceUrl'],
};

const baseQuery: VerifiedFpsQuery = {
  gameId: 'test-game',
  cpuId: 'cpu-a',
  gpuId: 'gpu-a',
  resolution: '1080p',
  preset: 'ultra',
  rayTracing: false,
  upscaler: 'native',
  frameGeneration: false,
};

const dlssQualityRecord: BenchmarkRecord = {
  ...baseRecord,
  id: 'fixture-dlss-quality',
  upscaler: 'dlss',
  upscalerMode: 'Quality',
};

describe('lookupVerifiedFps — exact-match correctness (Priority 3)', () => {
  it('1. exact native match => MEASURED', () => {
    const result = lookupVerifiedFps(baseQuery, [baseRecord]);
    expect(result.state).toBe('MEASURED');
    expect(result.record?.id).toBe('fixture-native');
  });

  it('2. exact upscaler + exact mode match => MEASURED', () => {
    const query: VerifiedFpsQuery = { ...baseQuery, upscaler: 'dlss', upscalerMode: 'Quality' };
    const result = lookupVerifiedFps(query, [dlssQualityRecord]);
    expect(result.state).toBe('MEASURED');
    expect(result.record?.id).toBe('fixture-dlss-quality');
  });

  it('3. same upscaler but different mode => NOT_AVAILABLE', () => {
    const query: VerifiedFpsQuery = { ...baseQuery, upscaler: 'dlss', upscalerMode: 'Performance' };
    const result = lookupVerifiedFps(query, [dlssQualityRecord]);
    expect(result.state).toBe('NOT_AVAILABLE');
  });

  it('4a. missing mode vs specified mode: record has no confirmed mode, query asks for one => NOT_AVAILABLE', () => {
    const recordWithNoMode: BenchmarkRecord = { ...baseRecord, id: 'fixture-dlss-no-mode', upscaler: 'dlss', upscalerMode: undefined };
    const query: VerifiedFpsQuery = { ...baseQuery, upscaler: 'dlss', upscalerMode: 'Quality' };
    const result = lookupVerifiedFps(query, [recordWithNoMode]);
    expect(result.state).toBe('NOT_AVAILABLE');
  });

  it('4b. missing mode vs specified mode: record has a confirmed mode, query does not ask for one => NOT_AVAILABLE (unspecified must not mean "any mode")', () => {
    const query: VerifiedFpsQuery = { ...baseQuery, upscaler: 'dlss' }; // upscalerMode intentionally omitted
    const result = lookupVerifiedFps(query, [dlssQualityRecord]);
    expect(result.state).toBe('NOT_AVAILABLE');
  });

  it('5. frame generation mismatch => NOT_AVAILABLE', () => {
    const query: VerifiedFpsQuery = { ...baseQuery, frameGeneration: true };
    const result = lookupVerifiedFps(query, [baseRecord]);
    expect(result.state).toBe('NOT_AVAILABLE');
  });

  it('6. resolution mismatch => NOT_AVAILABLE', () => {
    const query: VerifiedFpsQuery = { ...baseQuery, resolution: '4k' };
    const result = lookupVerifiedFps(query, [baseRecord]);
    expect(result.state).toBe('NOT_AVAILABLE');
  });

  it('7. preset mismatch => NOT_AVAILABLE', () => {
    const query: VerifiedFpsQuery = { ...baseQuery, preset: 'low' };
    const result = lookupVerifiedFps(query, [baseRecord]);
    expect(result.state).toBe('NOT_AVAILABLE');
  });

  it('8. ray tracing mismatch => NOT_AVAILABLE', () => {
    const query: VerifiedFpsQuery = { ...baseQuery, rayTracing: true };
    const result = lookupVerifiedFps(query, [baseRecord]);
    expect(result.state).toBe('NOT_AVAILABLE');
  });

  it('9. CPU mismatch => NOT_AVAILABLE', () => {
    const query: VerifiedFpsQuery = { ...baseQuery, cpuId: 'cpu-b' };
    const result = lookupVerifiedFps(query, [baseRecord]);
    expect(result.state).toBe('NOT_AVAILABLE');
  });

  it('10. GPU mismatch => NOT_AVAILABLE', () => {
    const query: VerifiedFpsQuery = { ...baseQuery, gpuId: 'gpu-b' };
    const result = lookupVerifiedFps(query, [baseRecord]);
    expect(result.state).toBe('NOT_AVAILABLE');
  });

  it('never falls back to a formula/interpolated result — NOT_AVAILABLE has no record attached', () => {
    const result = lookupVerifiedFps({ ...baseQuery, gpuId: 'nonexistent-gpu' }, [baseRecord]);
    expect(result.state).toBe('NOT_AVAILABLE');
    expect(result.record).toBeUndefined();
  });
});

describe('matchesUpscalerMode — pure function rules (Priority 3)', () => {
  it('native: mode is not applicable and always matches, regardless of either side', () => {
    expect(matchesUpscalerMode('native', undefined, undefined)).toBe(true);
    expect(matchesUpscalerMode('native', 'Quality', undefined)).toBe(true);
    expect(matchesUpscalerMode('native', undefined, 'Quality')).toBe(true);
  });

  it('DLSS Quality must not match DLSS Performance', () => {
    expect(matchesUpscalerMode('dlss', 'Quality', 'Performance')).toBe(false);
  });

  it('FSR Quality must not match FSR Balanced', () => {
    expect(matchesUpscalerMode('fsr', 'Quality', 'Balanced')).toBe(false);
  });

  it('XeSS modes must not be conflated', () => {
    expect(matchesUpscalerMode('xess', 'Ultra Quality', 'Quality')).toBe(false);
  });

  it('identical non-native modes match', () => {
    expect(matchesUpscalerMode('dlss', 'Quality', 'Quality')).toBe(true);
  });

  it('a query that specifies Quality does not match a record with an unspecified mode', () => {
    expect(matchesUpscalerMode('dlss', 'Quality', undefined)).toBe(false);
  });

  it('a query that specifies Performance does not match a record with an unspecified mode', () => {
    expect(matchesUpscalerMode('dlss', 'Performance', undefined)).toBe(false);
  });

  it('an unspecified query mode must NOT silently mean "all modes" — does not match a record with a specified Quality mode', () => {
    expect(matchesUpscalerMode('dlss', undefined, 'Quality')).toBe(false);
  });

  it('an unspecified query mode must NOT silently mean "all modes" — does not match a record with a specified Performance mode', () => {
    expect(matchesUpscalerMode('dlss', undefined, 'Performance')).toBe(false);
  });

  it('both sides unspecified for a non-native upscaler DOES match — two honest "no mode claimed" states agree, this is not a wildcard match against a confirmed mode', () => {
    expect(matchesUpscalerMode('dlss', undefined, undefined)).toBe(true);
    expect(matchesUpscalerMode('fsr', undefined, undefined)).toBe(true);
    expect(matchesUpscalerMode('xess', undefined, undefined)).toBe(true);
  });
});

// Regression coverage for the bcbab44 review findings — reachability
// bugs found by testing the real bundled data through the real query
// shape VerifiedBenchmarkPanel.tsx sends (no upscalerMode/settingsVariant
// control exists in that UI, so both are always omitted from a real
// query — these tests simulate exactly that, not a synthetic fixture).
describe('reachability regression: unspecified-upscalerMode records (Avatar: Frontiers of Pandora)', () => {
  const records = getAllBenchmarkRecords();
  const avatarRecords = records.filter((r) => r.gameId === 'avatarfop');

  it('both avatarfop records exist and have no confirmed upscalerMode (the source never states one)', () => {
    expect(avatarRecords).toHaveLength(2);
    for (const r of avatarRecords) {
      expect(r.upscaler).toBe('dlss');
      expect(r.upscalerMode).toBeUndefined();
    }
  });

  it('both avatarfop records are reachable via the exact query shape the UI sends (no upscalerMode field)', () => {
    for (const r of avatarRecords) {
      const query: VerifiedFpsQuery = {
        gameId: r.gameId, cpuId: r.cpuId, gpuId: r.gpuId,
        resolution: r.resolution, preset: r.preset,
        rayTracing: r.rayTracing, upscaler: r.upscaler,
        frameGeneration: r.frameGeneration,
        // upscalerMode intentionally omitted — VerifiedBenchmarkPanel never sends it.
      };
      const result = lookupVerifiedFps(query, records);
      expect(result.state).toBe('MEASURED');
      expect(result.record?.id).toBe(r.id);
    }
  });

  it('a query that DOES specify a mode still correctly finds nothing (unconfirmed record mode is not a wildcard)', () => {
    const r = avatarRecords[0];
    const query: VerifiedFpsQuery = {
      gameId: r.gameId, cpuId: r.cpuId, gpuId: r.gpuId,
      resolution: r.resolution, preset: r.preset,
      rayTracing: r.rayTracing, upscaler: r.upscaler,
      upscalerMode: 'Quality',
      frameGeneration: r.frameGeneration,
    };
    const result = lookupVerifiedFps(query, records);
    expect(result.state).toBe('NOT_AVAILABLE');
  });
});

describe('reachability regression: settingsVariant distinguishes the Marvel Rivals Lumen GI records', () => {
  const records = getAllBenchmarkRecords();

  it('the baseline (Lumen GI on) record is reachable with no settingsVariant in the query', () => {
    const query: VerifiedFpsQuery = {
      gameId: 'marvelrivals', cpuId: 'r5-5600', gpuId: 'rtx3060',
      resolution: '1080p', preset: 'ultra', rayTracing: false,
      upscaler: 'native', frameGeneration: false,
    };
    const result = lookupVerifiedFps(query, records);
    expect(result.state).toBe('MEASURED');
    expect(result.record?.id).toBe('mr-rtx3060-r55600-1080p-ultra-native');
    expect(result.record?.averageFps).toBe(60);
  });

  it('the Lumen GI off record is independently reachable when the query asks for that variant', () => {
    const query: VerifiedFpsQuery = {
      gameId: 'marvelrivals', cpuId: 'r5-5600', gpuId: 'rtx3060',
      resolution: '1080p', preset: 'ultra', rayTracing: false,
      upscaler: 'native', frameGeneration: false,
      settingsVariant: 'Lumen Global Illumination off',
    };
    const result = lookupVerifiedFps(query, records);
    expect(result.state).toBe('MEASURED');
    expect(result.record?.id).toBe('mr-rtx3060-r55600-1080p-ultra-lumengi-off');
    expect(result.record?.averageFps).toBe(113);
  });

  it('averageFps and every other field on both records is unchanged from before this fix — only settingsVariant was added', () => {
    const native = records.find((r) => r.id === 'mr-rtx3060-r55600-1080p-ultra-native');
    const lumenOff = records.find((r) => r.id === 'mr-rtx3060-r55600-1080p-ultra-lumengi-off');
    expect(native?.averageFps).toBe(60);
    expect(native?.settingsVariant).toBeUndefined();
    expect(lumenOff?.averageFps).toBe(113);
    expect(lumenOff?.settingsVariant).toBe('Lumen Global Illumination off');
  });
});
