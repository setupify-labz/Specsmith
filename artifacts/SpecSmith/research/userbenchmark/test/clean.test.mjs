// Tests for the UserBenchmark data-cleaning pipeline.
//
// The rules under test are the ones that make the pipeline safe to trust:
// never cross the desktop/laptop boundary, never guess a hardware id, never
// collapse two rows that disagree, never present a composite score as FPS,
// and never mutate the raw dataset.

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, assert } from './harness.mjs';
import {
  FORM_FACTOR,
  MATCH,
  classifyFormFactor,
  normalizeKey,
  resolveComponent,
} from '../lib/hardware-normalize.mjs';
import {
  FLAG,
  MAX_BENCH_PERCENT,
  METRIC_DEFINITIONS,
  findDuplicates,
  findOutliers,
  inspectRow,
} from '../lib/clean-observations.mjs';
import { cleanRow, renderSummary } from '../clean.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const datasetDir = path.join(here, '..', 'dataset');

/** A tiny stand-in catalog. Real catalogs are large; the rules are the same. */
const GPU_CATALOG = [
  { id: 'rtx3060', name: 'GeForce RTX 3060' },
  { id: 'rtx3060ti', name: 'GeForce RTX 3060 Ti' },
  { id: 'gtx1060', name: 'GeForce GTX 1060 6GB' },
];
const CPU_CATALOG = [
  { id: 'i7-8700k', name: 'Intel Core i7-8700K' },
  { id: 'r5-5600x', name: 'AMD Ryzen 5 5600X' },
];

const row = (over = {}) => ({
  gameId: '1',
  gameName: 'Test Game',
  componentKind: 'gpu',
  componentName: 'Nvidia RTX 3060',
  componentRatingId: '1',
  samples: 10,
  benchPercent: 50,
  valuePercent: 40,
  priceUsd: 300,
  ...over,
});

describe('hardware-normalize: form factor is a hard boundary', () => {
  it('classifies a mobile GPU as laptop', () => {
    assert.equal(classifyFormFactor('Nvidia RTX 3060 (Mobile)', 'gpu'), FORM_FACTOR.LAPTOP);
    assert.equal(classifyFormFactor('Nvidia GTX 1060 Max-Q', 'gpu'), FORM_FACTOR.LAPTOP);
  });

  it('classifies Intel U/H/HQ CPUs as laptop', () => {
    assert.equal(classifyFormFactor('Intel Core i7-8750H', 'cpu'), FORM_FACTOR.LAPTOP);
    assert.equal(classifyFormFactor('Intel Core i5-8250U', 'cpu'), FORM_FACTOR.LAPTOP);
    assert.equal(classifyFormFactor('Intel Core i7-7700HQ', 'cpu'), FORM_FACTOR.LAPTOP);
  });

  it('classifies integrated graphics as integrated', () => {
    assert.equal(classifyFormFactor('Intel UHD Graphics 630', 'gpu'), FORM_FACTOR.INTEGRATED);
    assert.equal(classifyFormFactor('AMD RX Vega 11 (Ryzen iGPU)', 'gpu'), FORM_FACTOR.INTEGRATED);
  });

  it('classifies a plain desktop part as desktop', () => {
    assert.equal(classifyFormFactor('Nvidia RTX 3060', 'gpu'), FORM_FACTOR.DESKTOP);
    assert.equal(classifyFormFactor('Intel Core i7-8700K', 'cpu'), FORM_FACTOR.DESKTOP);
  });

  it('NEVER matches a laptop part to a desktop catalog id', () => {
    // The desktop sibling IS in the catalog — the block is deliberate, not a
    // side effect of the part being absent.
    const desktop = resolveComponent('Nvidia RTX 3060', 'gpu', GPU_CATALOG);
    assert.equal(desktop.catalogId, 'rtx3060');

    const laptop = resolveComponent('Nvidia RTX 3060 (Mobile)', 'gpu', GPU_CATALOG);
    assert.equal(laptop.matchType, MATCH.BLOCKED_FORM_FACTOR);
    assert.equal(laptop.catalogId, null);
    assert.equal(laptop.formFactor, FORM_FACTOR.LAPTOP);
  });

  it('never matches integrated graphics into the discrete catalog', () => {
    const r = resolveComponent('Intel UHD Graphics 630', 'gpu', GPU_CATALOG);
    assert.equal(r.matchType, MATCH.BLOCKED_FORM_FACTOR);
    assert.equal(r.catalogId, null);
  });
});

describe('hardware-normalize: exact before fuzzy, never guess', () => {
  it('matches exactly when the normalized name is identical', () => {
    const r = resolveComponent('Nvidia GeForce RTX 3060', 'gpu', GPU_CATALOG);
    assert.equal(r.matchType, MATCH.EXACT);
    assert.equal(r.catalogId, 'rtx3060');
  });

  it('prefers the exact match over a variant that could reach another entry', () => {
    // "RTX 3060" normalizes identically to the 3060 entry. It must land there
    // and never on the 3060 Ti, which is a different card.
    const r = resolveComponent('Nvidia RTX 3060', 'gpu', GPU_CATALOG);
    assert.equal(r.matchType, MATCH.EXACT);
    assert.equal(r.catalogId, 'rtx3060');
  });

  it('treats punctuation differences as exact, not fuzzy', () => {
    // normalizeKey drops every separator, so "1060-6GB" and "1060 6GB" are
    // the same key. This is equality, not tolerance.
    const r = resolveComponent('Nvidia GTX 1060-6GB', 'gpu', GPU_CATALOG);
    assert.equal(r.matchType, MATCH.EXACT);
    assert.equal(r.catalogId, 'gtx1060');
  });

  it('accepts a VRAM-suffix variant only when it resolves to exactly one entry', () => {
    // UserBenchmark names carry the memory size; catalog entries often do not.
    const catalog = [{ id: 'gtx1070', name: 'GeForce GTX 1070' }];
    const r = resolveComponent('Nvidia GTX 1070 8GB', 'gpu', catalog);
    assert.equal(r.matchType, MATCH.FUZZY_HIGH);
    assert.equal(r.catalogId, 'gtx1070');
    assert.includes(r.reason, 'exactly one');
  });

  it('lets an exact match win over any variant', () => {
    // Both entries are reachable: 'b' exactly, 'a' by dropping the VRAM
    // suffix. The exact one must win, without the variant ever being tried.
    const catalog = [
      { id: 'a', name: 'GeForce GTX 1070' },
      { id: 'b', name: 'GeForce GTX 1070 8GB' },
    ];
    const r = resolveComponent('Nvidia GTX 1070 8GB', 'gpu', catalog);
    assert.equal(r.matchType, MATCH.EXACT);
    assert.equal(r.catalogId, 'b');
  });

  it('leaves an unknown part unmatched rather than picking the nearest name', () => {
    const r = resolveComponent('Nvidia RTX 4090', 'gpu', GPU_CATALOG);
    assert.equal(r.matchType, MATCH.UNMATCHED);
    assert.equal(r.catalogId, null);
    assert.includes(r.reason, 'nearest-looking');
  });

  it('leaves an ambiguous name unmatched and reports every candidate', () => {
    const dupes = [
      { id: 'a', name: 'GeForce RTX 3060' },
      { id: 'b', name: 'Nvidia GeForce RTX 3060' },
    ];
    const r = resolveComponent('RTX 3060', 'gpu', dupes);
    assert.equal(r.matchType, MATCH.UNMATCHED);
    assert.equal(r.catalogId, null);
    assert.deepEqual(r.candidates, ['a', 'b']);
  });

  it('does not conflate 3060 with 3060 Ti', () => {
    assert.ok(normalizeKey('RTX 3060') !== normalizeKey('RTX 3060 Ti'), '3060 and 3060 Ti must not share a key');
    const r = resolveComponent('Nvidia RTX 3060 Ti', 'gpu', GPU_CATALOG);
    assert.equal(r.catalogId, 'rtx3060ti');
  });

  it('matches CPUs by the same rules', () => {
    assert.equal(resolveComponent('Intel Core i7-8700K', 'cpu', CPU_CATALOG).catalogId, 'i7-8700k');
    assert.equal(resolveComponent('AMD Ryzen 5 5600X', 'cpu', CPU_CATALOG).catalogId, 'r5-5600x');
    assert.equal(resolveComponent('AMD Ryzen 9 9950X', 'cpu', CPU_CATALOG).matchType, MATCH.UNMATCHED);
  });
});

describe('clean-observations: flags rather than repairs', () => {
  it('passes a well-formed row with no flags', () => {
    assert.deepEqual(inspectRow(row()), []);
  });

  it('flags a missing required field', () => {
    const flags = inspectRow(row({ componentName: '' }));
    assert.equal(flags.length, 1);
    assert.equal(flags[0].flag, FLAG.MISSING_FIELD);
    assert.equal(flags[0].field, 'componentName');
  });

  it('accepts an absent score as a source gap, not a defect', () => {
    // UserBenchmark renders "-" for rows it has no score for.
    assert.deepEqual(inspectRow(row({ benchPercent: null, valuePercent: null })), []);
  });

  it('flags a non-numeric score as malformed', () => {
    const flags = inspectRow(row({ benchPercent: 'fast' }));
    assert.equal(flags[0].flag, FLAG.MALFORMED);
  });

  it('flags a benchPercent above 100 as impossible', () => {
    // benchPercent is a standing within one page's sample set, so it is bounded.
    assert.equal(inspectRow(row({ benchPercent: 140 }))[0].flag, FLAG.IMPOSSIBLE);
  });

  it('flags a negative score of either kind as impossible', () => {
    assert.equal(inspectRow(row({ valuePercent: -3 }))[0].flag, FLAG.IMPOSSIBLE);
    assert.equal(inspectRow(row({ benchPercent: -1 }))[0].flag, FLAG.IMPOSSIBLE);
  });

  // Regression: valuePercent was checked against the same 0-100 bound as
  // benchPercent, which flagged 254 faithfully-parsed rows across the 59-game
  // corpus as impossible. It is price/performance against a baseline and
  // legitimately exceeds 100 — the Arma 3 page publishes "39% | 102%" for the
  // GTX 1070-Ti, and the corpus reaches 131%. The source is right; the rule
  // was wrong, and a rule like that invites someone to "repair" correct data.
  it('ACCEPTS a valuePercent above 100, which UserBenchmark really publishes', () => {
    for (const v of [101, 102, 118, 131, 250]) {
      assert.deepEqual(inspectRow(row({ valuePercent: v })), [], `valuePercent ${v} must not be flagged`);
    }
  });

  it('still rejects a non-numeric valuePercent', () => {
    assert.equal(inspectRow(row({ valuePercent: 'cheap' }))[0].flag, FLAG.MALFORMED);
  });

  it('flags a negative sample count and a non-positive price', () => {
    assert.equal(inspectRow(row({ samples: -1 }))[0].flag, FLAG.IMPOSSIBLE);
    assert.equal(inspectRow(row({ priceUsd: 0 }))[0].flag, FLAG.IMPOSSIBLE);
  });

  it('repairs nothing — the input row is returned unmodified', () => {
    const r = row({ benchPercent: 140 });
    inspectRow(r);
    assert.equal(r.benchPercent, 140, 'inspectRow must not clamp or correct');
  });
});

describe('clean-observations: duplicate classification', () => {
  it('collapses only rows that agree on every compared value', () => {
    const { exact, suspicious } = findDuplicates([row(), row()]);
    assert.equal(exact.length, 1);
    assert.equal(suspicious.length, 0);
    assert.deepEqual(exact[0].duplicateIndexes, [1]);
    assert.equal(exact[0].keptIndex, 0);
  });

  it('never collapses rows that disagree', () => {
    const { exact, suspicious } = findDuplicates([row(), row({ benchPercent: 51 })]);
    assert.equal(exact.length, 0);
    assert.equal(suspicious.length, 1);
    assert.deepEqual(suspicious[0].indexes, [0, 1]);
    assert.includes(suspicious[0].detail, 'choosing would be a guess');
  });

  it('keys on game and component together, so the same card in two games is not a duplicate', () => {
    const { exact, suspicious } = findDuplicates([row({ gameId: '1' }), row({ gameId: '2' })]);
    assert.equal(exact.length, 0);
    assert.equal(suspicious.length, 0);
  });

  it('treats names differing only by case as the same component', () => {
    const { exact } = findDuplicates([row(), row({ componentName: 'nvidia rtx 3060' })]);
    assert.equal(exact.length, 1);
  });
});

describe('clean-observations: outliers are reported, never removed', () => {
  const peers = (values) =>
    values.map((v, i) => row({ benchPercent: v, componentName: `GPU ${i}` }));

  it('flags a value far from its per-game median', () => {
    const found = findOutliers(peers([50, 51, 50, 52, 49, 51, 99]));
    assert.equal(found.length, 1);
    assert.equal(found[0].value, 99);
    assert.includes(found[0].detail, 'not removed');
  });

  it('returns findings only — the caller still holds every row', () => {
    const rows = peers([50, 51, 50, 52, 49, 51, 99]);
    findOutliers(rows);
    assert.equal(rows.length, 7, 'findOutliers must not drop rows');
  });

  it('does not compare scores across games', () => {
    // Each game has a low-spread group of its own; combined they would look
    // like outliers of each other. Grouped per game, none is.
    const a = peers([50, 51, 50, 52, 49, 51]).map((r) => ({ ...r, gameId: 'a' }));
    const b = peers([10, 11, 10, 12, 9, 11]).map((r) => ({ ...r, gameId: 'b' }));
    assert.equal(findOutliers([...a, ...b]).length, 0);
  });

  it('stays silent when there are too few peers to judge', () => {
    assert.equal(findOutliers(peers([50, 99])).length, 0);
  });
});

describe('clean.mjs: cleaned records carry meaning, not conclusions', () => {
  const resolution = resolveComponent('Nvidia RTX 3060', 'gpu', GPU_CATALOG);
  const cleaned = cleanRow(row(), resolution, []);

  it('copies the publisher values through verbatim', () => {
    assert.equal(cleaned.source.publisher, 'UserBenchmark');
    assert.equal(cleaned.source.componentName, 'Nvidia RTX 3060');
    assert.equal(cleaned.source.benchPercent, 50);
    assert.equal(cleaned.source.samples, 10);
  });

  it('labels every metric and never presents a score as FPS', () => {
    assert.deepEqual(cleaned.metricDefinitions, METRIC_DEFINITIONS);
    assert.includes(cleaned.metricDefinitions.benchPercent, 'NOT frames per second');
    assert.includes(cleaned.notFpsWarning, 'not frames per second');
  });

  it('emits no FPS-named field anywhere in the record', () => {
    const keys = [];
    const walk = (v) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [k, sub] of Object.entries(v)) { keys.push(k); walk(sub); }
      }
    };
    walk(cleaned);
    const fpsish = keys.filter((k) => /fps/i.test(k) && k !== 'notFpsWarning');
    assert.deepEqual(fpsish, [], 'a cleaned UB record must expose no FPS field');
  });

  it('records how the hardware was resolved, including when it was not', () => {
    assert.equal(cleaned.matchType, MATCH.EXACT);
    assert.equal(cleaned.canonicalId, 'rtx3060');

    const un = cleanRow(row({ componentName: 'Nvidia RTX 4090' }), resolveComponent('Nvidia RTX 4090', 'gpu', GPU_CATALOG), []);
    assert.equal(un.matchType, MATCH.UNMATCHED);
    assert.equal(un.canonicalId, null);
    assert.ok(un.matchReason.length > 0, 'an unmatched row must say why');
  });
});

describe('clean.mjs: summary report', () => {
  const s = {
    totalRawRows: 100, cleanedRows: 98, exactMatches: 10, fuzzyMatches: 2,
    unmatchedRows: 80, formFactorBlocked: 8, exactDuplicates: 2,
    suspiciousDuplicates: 1, outliers: 3, rowsNeedingReview: 90,
    byKind: { gpu: { raw: 50, exact: 10, fuzzy: 2, unmatched: 30, blocked: 8, review: 45 } },
  };
  const md = renderSummary(s);

  it('reports every count the brief asks for', () => {
    for (const label of [
      'Total raw rows', 'Cleaned rows', 'Exact matches', 'Fuzzy matches',
      'Unmatched rows', 'Exact duplicates collapsed', 'Suspicious duplicate groups',
      'Outliers reported', 'Rows needing review',
    ]) {
      assert.includes(md, label);
    }
  });

  it('states plainly that these are not frame rates', () => {
    assert.includes(md, 'not');
    assert.includes(md, 'frames per second');
  });
});

describe('clean pipeline: the raw dataset is read-only', () => {
  it('opens no dataset file for writing', async () => {
    const src = await fs.readFile(path.join(here, '..', 'clean.mjs'), 'utf-8');
    assert.ok(/readJsonl\(path\.join\(datasetDir/.test(src), 'dataset is read through readJsonl');
    const writesToDataset = /write\w*\([^)]*datasetDir/.test(src);
    assert.notOk(writesToDataset, 'clean.mjs must never write into dataset/');
  });

  it('leaves the observation files byte-identical across a full run', async () => {
    // The strong form of the guarantee: actually run the pipeline end to end
    // and compare digests either side of it.
    const names = ['gpu-observations.jsonl', 'cpu-observations.jsonl'];
    const digest = async () =>
      Promise.all(names.map(async (f) =>
        createHash('sha256').update(await fs.readFile(path.join(datasetDir, f))).digest('hex')));

    const before = await digest();
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(here, '..', 'clean.mjs')], { stdio: 'ignore' });
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`clean.mjs exited ${code}`))));
    });
    assert.deepEqual(await digest(), before, 'clean.mjs must not alter the raw dataset');
  });
});
