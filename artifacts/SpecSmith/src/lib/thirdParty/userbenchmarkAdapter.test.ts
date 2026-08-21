import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  UnrecognizedCleanedRowError,
  admissibleThirdPartyRecords,
  toThirdPartyComponentObservation,
  toThirdPartyComponentObservations,
  type CleanedUserBenchmarkRow,
} from './userbenchmarkAdapter';
import { THIRD_PARTY_TIER } from './types';

const here = path.dirname(fileURLToPath(import.meta.url));

const row = (over: Partial<CleanedUserBenchmarkRow> = {}): CleanedUserBenchmarkRow => ({
  gameId: '1',
  gameName: 'Test Game',
  componentKind: 'gpu',
  canonicalId: 'rtx3060',
  matchType: 'exact',
  matchReason: 'Normalized name is identical to exactly one catalog entry.',
  formFactor: 'desktop',
  source: {
    componentName: 'Nvidia RTX 3060',
    componentRatingId: '123',
    componentPageUrl: 'https://gpu.userbenchmark.com/x/Rating/123',
    samples: 500,
    benchPercent: 62,
    valuePercent: 108,
    priceUsd: 300,
    priceStore: 'Amazon',
  },
  flags: [],
  provenance: {
    sourceUrl: 'https://www.userbenchmark.com/PCGame/FPS-Estimates-Test/1/0.0.0.0.0',
    sourceFile: 'FPS-Estimates-Test-1.html',
    sourceContentSha256: 'a'.repeat(64),
    parserVersion: 'ub-research/2.0.0',
  },
  ...over,
});

describe('admissibility: exact match, zero flags, and nothing looser — for now', () => {
  it('exact + zero flags is admissible', () => {
    const r = toThirdPartyComponentObservation(row());
    expect(r.matchType).toBe('exact');
    expect(r.admissible).toBe(true);
    expect(r.canonicalId).toBe('rtx3060');
    expect(r.inadmissibleReasons).toEqual([]);
  });

  it('exact + any flag is inadmissible, canonicalId nulled', () => {
    const r = toThirdPartyComponentObservation(row({
      flags: [{ flag: 'outlier', field: 'benchPercent', detail: 'benchPercent 95 against a per-game median of 12' }],
    }));
    expect(r.matchType).toBe('exact');
    expect(r.admissible).toBe(false);
    expect(r.canonicalId).toBeNull();
    expect(r.inadmissibleReasons.some((x) => x.includes('outlier'))).toBe(true);
  });

  it('fuzzy-high-confidence is STILL INADMISSIBLE even with zero flags — production admissibility is exact-only for now', () => {
    // fuzzy-high-confidence remains a legitimate CLEANING-PIPELINE state (see
    // hardware-normalize.mjs's doctrine: it is a spelling tolerance, not a
    // similarity search) — this is not a test that the state is wrong to
    // produce. It is a test that this production boundary does not yet trust
    // it: "confident enough for the pipeline" and "admissible to production"
    // are kept as two separate questions, and this one is answered narrowly.
    const r = toThirdPartyComponentObservation(row({ matchType: 'fuzzy-high-confidence' }));
    expect(r.admissible).toBe(false);
    expect(r.canonicalId).toBeNull();
    expect(r.inadmissibleReasons.some((x) => x.includes('not admissible at the production boundary'))).toBe(true);
  });

  it('fuzzy-high-confidence + a flag is (still) inadmissible, for the same reason twice over', () => {
    const r = toThirdPartyComponentObservation(row({
      matchType: 'fuzzy-high-confidence',
      flags: [{ flag: 'suspicious-duplicate', field: 'componentName', detail: 'x' }],
    }));
    expect(r.admissible).toBe(false);
    expect(r.canonicalId).toBeNull();
    expect(r.inadmissibleReasons).toHaveLength(2);
  });

  it('is INADMISSIBLE for an unmatched row, and nulls canonicalId even if the input carried one', () => {
    // Adversarial input: canonicalId is present but matchType says unmatched.
    // A naive passthrough would leak it; the adapter must not.
    const r = toThirdPartyComponentObservation(row({ matchType: 'unmatched', canonicalId: 'rtx3060' }));
    expect(r.admissible).toBe(false);
    expect(r.canonicalId).toBeNull();
    expect(r.inadmissibleReasons.length).toBeGreaterThan(0);
  });

  it('is INADMISSIBLE for a form-factor-blocked row (laptop), canonicalId nulled', () => {
    const r = toThirdPartyComponentObservation(row({ matchType: 'blocked-form-factor', formFactor: 'laptop', canonicalId: 'rtx3060' }));
    expect(r.admissible).toBe(false);
    expect(r.canonicalId).toBeNull();
    expect(r.formFactor).toBe('laptop');
  });

  it('is INADMISSIBLE for a form-factor-blocked row (integrated), canonicalId nulled', () => {
    const r = toThirdPartyComponentObservation(row({ matchType: 'blocked-form-factor', formFactor: 'integrated', canonicalId: 'igpu' }));
    expect(r.admissible).toBe(false);
    expect(r.canonicalId).toBeNull();
  });

  it('is INADMISSIBLE for an exact match that is ALSO an outlier — matchType alone is not enough', () => {
    // The case a naive "matchType === exact" check would get wrong.
    const r = toThirdPartyComponentObservation(row({
      flags: [{ flag: 'outlier', field: 'benchPercent', detail: 'benchPercent 95 against a per-game median of 12' }],
    }));
    expect(r.admissible).toBe(false);
    expect(r.canonicalId).toBeNull();
    expect(r.inadmissibleReasons.some((x) => x.includes('outlier'))).toBe(true);
  });

  it('is INADMISSIBLE for an exact match that is a suspicious duplicate', () => {
    const r = toThirdPartyComponentObservation(row({
      flags: [{ flag: 'suspicious-duplicate', field: 'componentName', detail: 'Another row shares this (game, component) but reports different values.' }],
    }));
    expect(r.admissible).toBe(false);
    expect(r.canonicalId).toBeNull();
  });

  it('is INADMISSIBLE for a malformed value', () => {
    const r = toThirdPartyComponentObservation(row({
      flags: [{ flag: 'malformed', field: 'samples', detail: 'samples is "N/A", not an integer.' }],
    }));
    expect(r.admissible).toBe(false);
    expect(r.canonicalId).toBeNull();
  });

  it('any row with flags is inadmissible regardless of how many flags', () => {
    const r = toThirdPartyComponentObservation(row({
      flags: [
        { flag: 'outlier', field: 'benchPercent', detail: 'x' },
        { flag: 'suspicious-duplicate', field: 'componentName', detail: 'y' },
      ],
    }));
    expect(r.admissible).toBe(false);
    expect(r.inadmissibleReasons).toHaveLength(2);
  });
});

describe('refuses rather than guesses on unrecognized values', () => {
  it('throws on an unrecognized componentKind', () => {
    expect(() => toThirdPartyComponentObservation(row({ componentKind: 'motherboard' }))).toThrow(UnrecognizedCleanedRowError);
  });

  it('throws on an unrecognized matchType', () => {
    expect(() => toThirdPartyComponentObservation(row({ matchType: 'probably-fine' }))).toThrow(UnrecognizedCleanedRowError);
  });

  it('throws on an unrecognized formFactor', () => {
    expect(() => toThirdPartyComponentObservation(row({ formFactor: 'handheld' }))).toThrow(UnrecognizedCleanedRowError);
  });
});

describe('preserves source values verbatim; never infers a missing one', () => {
  it('copies benchPercent/valuePercent/samples/price through unchanged', () => {
    const r = toThirdPartyComponentObservation(row());
    expect(r.source.benchPercent).toBe(62);
    expect(r.source.valuePercent).toBe(108);
    expect(r.source.samples).toBe(500);
    expect(r.source.priceUsd).toBe(300);
    expect(r.source.publisher).toBe('UserBenchmark');
  });

  it('leaves an absent field null rather than defaulting it', () => {
    const r = toThirdPartyComponentObservation(row({
      source: { componentName: 'Nvidia RTX 3060', samples: null, benchPercent: null, valuePercent: null, priceUsd: null, priceStore: null },
    }));
    expect(r.source.benchPercent).toBeNull();
    expect(r.source.valuePercent).toBeNull();
    expect(r.source.priceUsd).toBeNull();
  });

  it('does not invent a value when valuePercent exceeds 100 — passes it through as-is', () => {
    // Real UserBenchmark data reaches 131%; the adapter must not clamp it.
    const r = toThirdPartyComponentObservation(row({ source: { ...row().source, valuePercent: 131 } }));
    expect(r.source.valuePercent).toBe(131);
  });

  it('carries provenance through, or null when absent', () => {
    const r = toThirdPartyComponentObservation(row());
    expect(r.provenance?.sourceContentSha256).toBe('a'.repeat(64));
    const noProv = toThirdPartyComponentObservation(row({ provenance: null }));
    expect(noProv.provenance).toBeNull();
  });
});

describe('Bench% and Value% are never exposed or named as FPS', () => {
  it('no field name anywhere on a produced record contains "fps", except the explicit warning', () => {
    const r = toThirdPartyComponentObservation(row());
    const names: string[] = [];
    const walk = (o: unknown, p = '') => {
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        for (const [k, v] of Object.entries(o)) { names.push(p + k); walk(v, p + k + '.'); }
      }
    };
    walk(r);
    const fpsish = names.filter((n) => /fps/i.test(n) && !n.endsWith('notFpsWarning'));
    expect(fpsish).toEqual([]);
  });

  it('metricDefinitions explicitly states both metrics are not FPS', () => {
    const r = toThirdPartyComponentObservation(row());
    expect(r.metricDefinitions.benchPercent).toMatch(/not frames per second/i);
    expect(r.metricDefinitions.valuePercent).toMatch(/not frames per second/i);
    expect(r.notFpsWarning).toMatch(/not frames per second/i);
  });

  it('the tier is the fixed third-party value, never anything measured-shaped', () => {
    const r = toThirdPartyComponentObservation(row());
    expect(r.tier).toBe(THIRD_PARTY_TIER);
    expect(r.tier).toBe('third-party-crowd-sourced');
  });
});

describe('admissibleThirdPartyRecords', () => {
  it('keeps only exact + zero-flag records — fuzzy-high-confidence is excluded even flag-free', () => {
    const rows = [
      row({ gameId: '1' }),
      row({ gameId: '2', matchType: 'unmatched', canonicalId: null }),
      row({ gameId: '3', flags: [{ flag: 'outlier', field: 'benchPercent', detail: 'x' }] }),
      row({ gameId: '4', matchType: 'fuzzy-high-confidence' }),
    ];
    const out = admissibleThirdPartyRecords(toThirdPartyComponentObservations(rows));
    expect(out.map((r) => r.gameId)).toEqual(['1']);
    expect(out.every((r) => r.canonicalId !== null)).toBe(true);
  });
});

// Runs the real adapter against the real cleaning-pipeline output, so the
// boundary is proven against actual UserBenchmark data, not only synthetic
// fixtures. Read-only: this test file never writes into research/userbenchmark.
describe('against the real cleaned-observations.jsonl corpus', () => {
  const cleanedPath = path.join(here, '..', '..', '..', 'research', 'userbenchmark', 'clean', 'cleaned-observations.jsonl');
  const summaryPath = path.join(here, '..', '..', '..', 'research', 'userbenchmark', 'clean', 'summary.json');
  const hasCorpus = fs.existsSync(cleanedPath) && fs.existsSync(summaryPath);

  it.runIf(hasCorpus)('converts every real row without throwing', () => {
    const rows: CleanedUserBenchmarkRow[] = fs.readFileSync(cleanedPath, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(() => toThirdPartyComponentObservations(rows)).not.toThrow();
  });

  it.runIf(hasCorpus)('admits EXACTLY the exact-match count, not exact+fuzzy', () => {
    const rows: CleanedUserBenchmarkRow[] = fs.readFileSync(cleanedPath, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    const observations = toThirdPartyComponentObservations(rows);
    const admissible = admissibleThirdPartyRecords(observations);
    expect(admissible.length).toBe(summary.exactMatches);
    expect(admissible.every((r) => r.matchType === 'exact')).toBe(true);
  });

  it.runIf(hasCorpus)('never admits a laptop or integrated row', () => {
    const rows: CleanedUserBenchmarkRow[] = fs.readFileSync(cleanedPath, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const admissible = admissibleThirdPartyRecords(toThirdPartyComponentObservations(rows));
    expect(admissible.every((r) => r.formFactor === 'desktop' || r.formFactor === 'unknown')).toBe(true);
  });

  it.runIf(hasCorpus)('never admits an unmatched or blocked row', () => {
    const rows: CleanedUserBenchmarkRow[] = fs.readFileSync(cleanedPath, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const admissible = admissibleThirdPartyRecords(toThirdPartyComponentObservations(rows));
    expect(admissible.every((r) => r.matchType === 'exact')).toBe(true);
  });

  it.runIf(hasCorpus)('would exclude a fuzzy-high-confidence row even if the real corpus contained one', () => {
    // The live corpus currently has 0 fuzzy matches (see summary.json), so the
    // count-based test above cannot by itself distinguish "fuzzy is excluded"
    // from "fuzzy just never appears." This proves the exclusion directly: take
    // a REAL admitted row and flip only its matchType to fuzzy-high-confidence
    // (canonicalId and flags untouched) — it must become inadmissible.
    const rows: CleanedUserBenchmarkRow[] = fs.readFileSync(cleanedPath, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const realExact = rows.find((r) => r.matchType === 'exact' && r.flags.length === 0);
    expect(realExact, 'expected at least one real exact-match, flag-free row to mutate').toBeTruthy();

    const asExact = toThirdPartyComponentObservation(realExact!);
    expect(asExact.admissible).toBe(true);

    const asFuzzy = toThirdPartyComponentObservation({ ...realExact!, matchType: 'fuzzy-high-confidence' });
    expect(asFuzzy.admissible).toBe(false);
    expect(asFuzzy.canonicalId).toBeNull();
  });
});
