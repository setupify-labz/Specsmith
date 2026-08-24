import { describe, expect, it } from 'vitest';
import {
  formatCommunityResolution,
  getCommunityBenchmarkRecords,
  getCommunityBenchmarksForBuild,
  validateCommunityBenchmarkRecords,
} from './communityBenchmarks';

describe('community benchmark store', () => {
  it('keeps the 11 source-verified community sessions isolated and valid', () => {
    const records = getCommunityBenchmarkRecords();
    expect(records).toHaveLength(11);
    expect(validateCommunityBenchmarkRecords(records)).toEqual([]);
    expect(records.every((record) => record.evidenceTier === 'third_party_community_measured')).toBe(true);
  });

  it('looks up exact CPU + GPU pairs only', () => {
    const repeated = getCommunityBenchmarksForBuild('rx9070xt', 'r7-7800x3d');
    expect(repeated).toHaveLength(2);
    expect(repeated.every((record) => record.gameId === 'cs2')).toBe(true);

    expect(getCommunityBenchmarksForBuild('rx9070xt', 'r7-9800x3d')).toEqual([]);
  });

  it('preserves exact resolution instead of forcing a normalized tier', () => {
    const [record] = getCommunityBenchmarksForBuild('rtx3070', 'r7-9800x3d');
    expect(formatCommunityResolution(record)).toBe('1080p');
    expect(record.width).toBe(1920);
    expect(record.height).toBe(1080);
  });

  it('preserves partial source settings and provenance', () => {
    const [record] = getCommunityBenchmarksForBuild('rtx4070ti', 'i5-14600kf');
    expect(record.settingsCompleteness).toBe('partial');
    expect(record.observedSettings).toEqual({ Reflex: 'Enabled', MSAA: '4x MSAA', Shadows: 'High' });
    expect(record.source.publisher).toBe('HowManyFPS');
    expect(record.source.license).toBe('CC BY 4.0');
  });
});
