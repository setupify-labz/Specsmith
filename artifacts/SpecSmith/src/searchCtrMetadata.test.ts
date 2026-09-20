import { describe, expect, it } from 'vitest';
import { getRouteMeta } from './lib/seo';

const expected = {
  '/': {
    title: 'Free PC Builder & FPS Calculator | SpecSmith',
    intent: [/PC Builder/i, /FPS Calculator/i],
    description: [/compatibility/i, /estimate FPS/i],
  },
  '/builder': {
    title: 'PC Build Calculator & FPS Estimator | SpecSmith',
    intent: [/PC Build Calculator/i, /FPS Estimator/i],
    description: [/compatibility/i, /estimate FPS/i],
  },
  '/compare': {
    title: 'Compare PC Builds & Estimated FPS | SpecSmith',
    intent: [/Compare PC Builds/i, /Estimated FPS/i],
    description: [/side by side/i, /estimated FPS/i],
  },
  '/about': {
    title: 'What Is SpecSmith? FPS Estimates Explained',
    intent: [/What Is SpecSmith/i, /FPS Estimates/i],
    description: [/compatibility checks/i, /limits/i],
  },
  '/gpu-tier-list': {
    title: 'Gaming GPU Tier List — Graphics Cards Ranked | SpecSmith',
    intent: [/Gaming GPU Tier List/i, /Graphics Cards Ranked/i],
    description: [/raw benchmark performance/i, /NVIDIA RTX/i, /AMD Radeon/i],
  },
  '/cpu-tier-list': {
    title: 'Gaming CPU Tier List — Processors Ranked | SpecSmith',
    intent: [/Gaming CPU Tier List/i, /Processors Ranked/i],
    description: [/raw benchmark performance/i, /AMD Ryzen/i, /Intel/i],
  },
} as const;

describe('search CTR metadata for proven landing pages', () => {
  it.each(Object.entries(expected))('%s has a specific, readable search snippet', (path, contract) => {
    const meta = getRouteMeta(path);

    expect(meta.title).toBe(contract.title);
    for (const phrase of contract.intent) expect(meta.title).toMatch(phrase);
    for (const phrase of contract.description) expect(meta.description).toMatch(phrase);
    expect(meta.title.length).toBeGreaterThanOrEqual(40);
    expect(meta.title.length).toBeLessThanOrEqual(60);
    expect(meta.description.length).toBeGreaterThanOrEqual(120);
    expect(meta.description.length).toBeLessThanOrEqual(160);
    expect(meta.canonicalOverride).toBeUndefined();
  });

  it('keeps every targeted title and description unique', () => {
    const metadata = Object.keys(expected).map(getRouteMeta);

    expect(new Set(metadata.map((meta) => meta.title)).size).toBe(metadata.length);
    expect(new Set(metadata.map((meta) => meta.description)).size).toBe(metadata.length);
  });

  it('does not promise measured benchmarks, exhaustive compatibility, or live prices', () => {
    const copy = Object.keys(expected)
      .map((path) => {
        const meta = getRouteMeta(path);
        return `${meta.title} ${meta.description}`;
      })
      .join(' ');

    expect(copy).not.toMatch(/measured benchmark/i);
    expect(copy).not.toMatch(/guaranteed compatibility/i);
    expect(copy).not.toMatch(/live (?:price|pricing)/i);
    expect(copy).not.toMatch(/accurate FPS/i);
  });
});
