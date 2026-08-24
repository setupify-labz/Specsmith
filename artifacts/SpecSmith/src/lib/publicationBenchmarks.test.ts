import { describe, expect, it } from 'vitest';
import { getAllBenchmarkRecords } from './benchmarks/lookup';
import { getCommunityBenchmarkRecords } from './communityBenchmarks';
import {
  formatPublicationResolution,
  getPublicationBenchmarkRecords,
  getPublicationBenchmarksForBuild,
  publicationLowMetricLabel,
  validatePublicationBenchmarkRecords,
} from './publicationBenchmarks';

describe('publication benchmark store', () => {
  it('contains the 66 reviewed publication records and validates cleanly', () => {
    const records = getPublicationBenchmarkRecords();
    expect(records).toHaveLength(66);
    expect(validatePublicationBenchmarkRecords(records)).toEqual([]);
    expect(records.every((record) => record.evidenceTier === 'third_party_publication_measured')).toBe(true);
    expect(records.every((record) => record.source.verificationMethod === 'direct-fetch')).toBe(true);
  });

  it('uses exact CPU + GPU matching only', () => {
    expect(getPublicationBenchmarksForBuild('rtx5070ti', 'r7-9800x3d').length).toBeGreaterThan(0);
    expect(getPublicationBenchmarksForBuild('rtx5070ti', 'r7-7800x3d')).toEqual([]);
  });

  it('preserves exact resolution and the source low-metric meaning', () => {
    const records = getPublicationBenchmarksForBuild('rtx5080', 'r7-9800x3d');
    const marvel = records.find((record) => record.gameId === 'marvelrivals');
    expect(marvel).toBeDefined();
    expect(formatPublicationResolution(marvel!)).toBe('4K');
    expect(marvel?.lowMetric).toBe('minimum_fps');
    expect(publicationLowMetricLabel(marvel?.lowMetric)).toBe('Minimum');
  });

  it('does not invent ray tracing or upscaling when the source did not state them', () => {
    const records = getPublicationBenchmarksForBuild('rtx5070ti', 'r7-9800x3d');
    const rdr2 = records.find((record) => record.gameId === 'rdr2');
    expect(rdr2?.rayTracing).toBeNull();
    expect(rdr2?.upscaler).toBeNull();
  });

  it('retains explicit RT + DLSS Quality when the source states them', () => {
    const records = getPublicationBenchmarksForBuild('rtx5080', 'r7-9800x3d');
    const alanWake = records.find((record) => record.gameId === 'alanwake2');
    expect(alanWake?.rayTracing).toBe(true);
    expect(alanWake?.upscaler).toBe('dlss');
    expect(alanWake?.upscalerMode).toBe('Quality');
  });

  it('excludes source rows whose attribution was internally ambiguous', () => {
    const records = getPublicationBenchmarkRecords();
    expect(records.some((record) => record.source.url.includes('rx-9070-xt-vs-rtx-5070-ti') && record.gameId === 'blackmythwukong')).toBe(false);
    expect(records.some((record) => record.source.url.includes('rtx-5080-vs-rtx-4080-super') && record.gameId === 'starwarsjedisurvivor')).toBe(false);
  });

  it('brings the cited/community gameplay corpus to at least 100 records without counting estimates', () => {
    const total = getAllBenchmarkRecords().length
      + getCommunityBenchmarkRecords().length
      + getPublicationBenchmarkRecords().length;
    expect(total).toBeGreaterThanOrEqual(100);
  });
});
