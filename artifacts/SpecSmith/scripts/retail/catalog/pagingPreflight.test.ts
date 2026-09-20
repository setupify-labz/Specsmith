import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { RetailCategoryConfig } from './catalogConfig';
import { inspectPageOne, PREFLIGHT_CATEGORIES, preflightQuery, resolvePreflightOutputPath, runPagingPreflight } from './pagingPreflight';

const configs: RetailCategoryConfig[] = [
  { category: 'motherboard', keyword: 'motherboard', categoryLeaf: 'Motherboards', quota: 45 },
  { category: 'ram', keyword: 'desktop memory', categoryLeaf: 'RAM', quota: 45 },
  { category: 'keyboard', keyword: 'mechanical keyboard', categoryLeaf: 'Keyboards', quota: 25 },
];

const page = (totalPages: string, totalMatches: string, pageNumber = '1') =>
  `<result><TotalMatches>${totalMatches}</TotalMatches><TotalPages>${totalPages}</TotalPages><PageNumber>${pageNumber}</PageNumber><item><sku>x</sku></item></result>`;

describe('page-one catalogue paging preflight', () => {
  it('constructs an explicitly page-one-only request', () => {
    expect(preflightQuery(configs[0])).toEqual({
      keyword: 'motherboard', categoryLeaf: 'Motherboards', max: 100, pageNumber: 1,
    });
  });

  it('measures only the three failed categories and identifies results beyond the current walker', async () => {
    const calls: string[] = [];
    const report = await inspectPageOne(configs, async (config) => {
      calls.push(config.category);
      const totals = config.category === 'ram' ? ['63', '6201'] : config.category === 'keyboard' ? ['41', '4077'] : ['55', '5432'];
      return { xml: page(totals[0], totals[1]), fetchedAt: '2026-09-16T00:00:00.000Z', requestUrl: 'https://example.invalid' };
    }, '2026-09-16T00:00:00.000Z');

    expect(PREFLIGHT_CATEGORIES).toEqual(['motherboard', 'ram', 'keyboard']);
    expect(calls).toEqual(['motherboard', 'ram', 'keyboard']);
    expect(report.pagesRequestedPerCategory).toBe(1);
    expect(report.catalogueWritten).toBe(false);
    expect(report.rows.map((row) => [row.category, row.totalPages, row.exceedsCurrentWalkerLimit])).toEqual([
      ['motherboard', 55, true], ['ram', 63, true], ['keyboard', 41, true],
    ]);
    expect(report.rows.every((row) => row.pagesRequested === 1)).toBe(true);
  });

  it('fails closed on a malformed or contradictory page-one header', async () => {
    await expect(inspectPageOne(configs.slice(0, 1), async () => ({
      xml: page('many', '5432'), fetchedAt: '2026-09-16T00:00:00.000Z', requestUrl: 'https://example.invalid',
    }), '2026-09-16T00:00:00.000Z')).rejects.toMatchObject({ code: 'total-pages-not-integer' });

    await expect(inspectPageOne(configs.slice(0, 1), async () => ({
      xml: page('55', '5432', '2'), fetchedAt: '2026-09-16T00:00:00.000Z', requestUrl: 'https://example.invalid',
    }), '2026-09-16T00:00:00.000Z')).rejects.toMatchObject({ code: 'page-number-mismatch' });
  });

  it('writes only its report outside the repository and never creates a catalogue', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'paging-preflight-'));
    const out = path.join(directory, 'report.json');
    const calls: string[] = [];
    await runPagingPreflight(out, () => new Date('2026-09-16T00:00:00.000Z'), async (config) => {
      calls.push(config.category);
      return { xml: page('51', '5001'), fetchedAt: '2026-09-16T00:00:00.000Z', requestUrl: 'https://example.invalid' };
    });

    expect(calls).toEqual(['motherboard', 'ram', 'keyboard']);
    expect(fs.readdirSync(directory)).toEqual(['report.json']);
    expect(JSON.parse(fs.readFileSync(out, 'utf-8'))).toMatchObject({ catalogueWritten: false, pagesRequestedPerCategory: 1 });
  });

  it('refuses output inside the checkout and refuses overwriting evidence', async () => {
    expect(() => resolvePreflightOutputPath('public/data/preflight.json')).toThrow('output-inside-repository');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'paging-preflight-existing-'));
    const out = path.join(directory, 'report.json');
    fs.writeFileSync(out, 'existing');
    let calls = 0;
    await expect(runPagingPreflight(out, undefined, async () => {
      calls += 1;
      return { xml: page('1', '1'), fetchedAt: '2026-09-16T00:00:00.000Z', requestUrl: 'https://example.invalid' };
    })).rejects.toThrow('output-exists');
    expect(calls).toBe(0);
    expect(fs.readFileSync(out, 'utf-8')).toBe('existing');
  });
});
