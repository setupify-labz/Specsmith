import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGpuCatalog } from '../rakuten';
import { ACCESS_TOKEN_ENV_VAR, type CatalogGpu } from '../rakuten/types';
import { ALL_REJECTION_REASONS, renderCoverageReport, scrubMessage } from './coverageReport';
import { measureCoverage } from './measureCoverage';
import { parseArgs, selectGpus } from './measure-coverage';
import type { Clock } from './rateLimiter';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'rakuten', '__fixtures__');
const fixture = (name: string) => fs.readFileSync(path.join(fixtures, name), 'utf-8');

const catalog = loadGpuCatalog();
const gpu = (id: string): CatalogGpu => catalog.find((g) => g.id === id)!;

const TOKEN = 'test-token-not-a-real-credential';
const env = { [ACCESS_TOKEN_ENV_VAR]: TOKEN } as NodeJS.ProcessEnv;

function fakeClock(): Clock {
  let t = Date.parse('2026-08-27T09:00:00.000Z');
  return { now: () => t, sleep: async (ms) => void (t += ms) };
}

/** Serves the RTX 5070 page for every keyword. */
const servePage = (body: string) => (async () => new Response(body, { status: 200 })) as unknown as typeof globalThis.fetch;

/** Serves per-GPU bodies keyed by the keyword's catalog part, defaulting to an empty result. */
const EMPTY = '<result><TotalMatches>0</TotalMatches><TotalPages>1</TotalPages><PageNumber>1</PageNumber></result>';

describe('measureCoverage over a fake fetch', () => {
  it('reports accepted, rejected and per-reason counts for one GPU', async () => {
    const report = await measureCoverage({
      catalog: [gpu('rtx5070')],
      env,
      clock: fakeClock(),
      fetch: servePage(fixture('newegg-rtx5070-live-shape.xml')),
    });

    expect(report.gpusMeasured).toBe(1);
    const row = report.gpus[0];
    expect(row).toMatchObject({ gpuId: 'rtx5070', status: 'ok', accepted: 4, rejected: 3, itemsSeen: 7, pagesRead: 1 });
    expect(row.rejectionsByReason['variant-suffix-mismatch']).toBe(1);
    expect(row.rejectionsByReason['memory-capacity-mismatch']).toBe(1);
    expect(row.rejectionsByReason['incomplete-record']).toBe(1);
    expect(report.totals).toMatchObject({ accepted: 4, rejected: 3, itemsSeen: 7, pages: 1, requests: 1, failures: 0 });
    expect(report.zeroOfferGpuIds).toEqual([]);
  });

  it('lists every rejection reason, including the ones that scored zero', () => {
    // A histogram that omits its zeroes hides the gates that never fire, which
    // are exactly the ones worth questioning.
    const empty = ALL_REJECTION_REASONS.map((r) => [r, 0]);
    expect(Object.keys(Object.fromEntries(empty))).toHaveLength(ALL_REJECTION_REASONS.length);
  });

  it('walks the whole catalog sequentially and names the GPUs with no offers', async () => {
    const three = [gpu('rtx5070'), gpu('rtx4090'), gpu('rx7600')];
    const bodies: Record<string, string> = { rtx5070: fixture('newegg-rtx5070-live-shape.xml') };
    const seenOrder: string[] = [];
    const fetch = (async (url: string | URL) => {
      const keyword = new URL(String(url)).searchParams.get('keyword') ?? '';
      const match = three.find((g) => keyword.includes(g.name));
      seenOrder.push(match?.id ?? 'unknown');
      return new Response(bodies[match?.id ?? ''] ?? EMPTY, { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const report = await measureCoverage({ catalog: three, env, clock: fakeClock(), fetch });

    expect(seenOrder).toEqual(['rtx5070', 'rtx4090', 'rx7600']);
    expect(report.zeroOfferGpuIds).toEqual(['rtx4090', 'rx7600']);
    expect(report.totals.requests).toBe(3);
  });

  it('records a failed GPU instead of aborting the run, and separates it from "no offers"', async () => {
    const two = [gpu('rtx5070'), gpu('rtx4090')];
    const fetch = (async (url: string | URL) => {
      const keyword = new URL(String(url)).searchParams.get('keyword') ?? '';
      if (keyword.includes('RTX 4090')) return new Response('server exploded', { status: 500 });
      return new Response(fixture('newegg-rtx5070-live-shape.xml'), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const report = await measureCoverage({ catalog: two, env, clock: fakeClock(), fetch });

    expect(report.gpus[0]).toMatchObject({ gpuId: 'rtx5070', status: 'ok', accepted: 4 });
    expect(report.gpus[1]).toMatchObject({ gpuId: 'rtx4090', status: 'failed', failureKind: 'RakutenRequestError' });
    expect(report.totals.failures).toBe(1);
    expect(report.totals.httpErrors).toBe(1);
    // It has zero offers AND it failed; the report says both rather than
    // letting a transport failure masquerade as a coverage finding.
    expect(report.zeroOfferGpuIds).toContain('rtx4090');
    expect(renderCoverageReport(report)).toContain('FAILED RakutenRequestError');
  });

  it('counts 429s and still completes the run', async () => {
    let first = true;
    const fetch = (async () => {
      if (first) {
        first = false;
        return new Response('', { status: 429 });
      }
      return new Response(fixture('newegg-rtx5070-live-shape.xml'), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const report = await measureCoverage({
      catalog: [gpu('rtx5070')],
      env,
      clock: fakeClock(),
      fetch,
      backoffMs: 10,
    });

    expect(report.totals.rateLimited).toBe(1);
    expect(report.totals.requests).toBe(2);
    expect(report.gpus[0]).toMatchObject({ status: 'ok', accepted: 4 });
  });

  it('measures a total runtime from the injected clock', async () => {
    const report = await measureCoverage({
      catalog: [gpu('rtx5070'), gpu('rtx4090')],
      env,
      clock: fakeClock(),
      requestsPerMinute: 1,
      fetch: servePage(EMPTY),
    });
    // The second request had to wait out the 1-per-minute window.
    expect(report.durationMs).toBeGreaterThanOrEqual(60_000);
    expect(report.totals.waitedMs).toBeGreaterThanOrEqual(60_000);
    expect(renderCoverageReport(report)).toContain('rate-limit waiting');
  });
});

describe('the report never leaks a credential or a tracked link', () => {
  it('renders offers with real linksynergy URLs without reproducing any of them', async () => {
    const report = await measureCoverage({
      catalog: [gpu('rtx5070')],
      env,
      clock: fakeClock(),
      fetch: servePage(fixture('newegg-rtx5070-live-shape.xml')),
    });

    // Sanity: the fixture really does carry the things that must not appear.
    const source = fixture('newegg-rtx5070-live-shape.xml');
    expect(source).toContain('click.linksynergy.com');
    expect(source).toContain('REDACTED_SITE_ID');

    for (const text of [renderCoverageReport(report), JSON.stringify(report)]) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain('linksynergy');
      expect(text).not.toContain('offerid');
      expect(text).not.toContain('REDACTED_SITE_ID');
      expect(text).not.toContain('neweggimages');
      expect(text).not.toMatch(/https?:\/\//);
    }
  });

  it('scrubs URLs and identifiers out of a failure message', () => {
    expect(scrubMessage('HTTP 500 from https://api.linksynergy.com/productsearch/1.0?id=ABC123')).toBe('HTTP 500 from [url]');
    expect(scrubMessage('offerid=9876543.1 rejected')).toBe('[redacted-param] rejected');
    expect(scrubMessage('x'.repeat(500))).toHaveLength(301);
  });

  it('a failure message from a real HTTP error carries no URL into the report', async () => {
    const fetch = (async () =>
      new Response('unauthorized; see https://api.linksynergy.com/token?id=SECRET', { status: 401 })) as unknown as typeof globalThis.fetch;
    const report = await measureCoverage({ catalog: [gpu('rtx5070')], env, clock: fakeClock(), fetch });
    expect(report.gpus[0].failureMessage).not.toMatch(/https?:\/\//);
    expect(report.gpus[0].failureMessage).not.toContain('SECRET');
  });
});

describe('CLI argument handling', () => {
  it('defaults to the whole catalog at the safe pacing', () => {
    const options = parseArgs([]);
    expect(options).toEqual({ limit: null, gpuIds: [], requestsPerMinute: 90, json: false });
    expect(selectGpus(catalog, options)).toHaveLength(catalog.length);
  });

  it('honours --limit and --gpu', () => {
    expect(selectGpus(catalog, parseArgs(['--limit', '3'])).map((g) => g.id)).toHaveLength(3);
    expect(selectGpus(catalog, parseArgs(['--gpu', 'rtx5070', '--gpu', 'rx7600'])).map((g) => g.id)).toEqual([
      'rtx5070',
      'rx7600',
    ]);
  });

  it('refuses to be pointed above the published rate limit', () => {
    expect(() => parseArgs(['--requests-per-minute', '101'])).toThrow(/exceeds Rakuten/);
    expect(() => parseArgs(['--requests-per-minute', '0'])).toThrow(/positive integer/);
  });

  it('refuses an unknown flag and a missing value', () => {
    expect(() => parseArgs(['--store'])).toThrow(/Unknown argument/);
    expect(() => parseArgs(['--limit'])).toThrow(/requires a value/);
  });

  it('refuses a GPU id the catalog does not have', () => {
    expect(() => selectGpus(catalog, parseArgs(['--gpu', 'rtx9999']))).toThrow(/No catalog GPU/);
  });
});
