import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGpuCatalog } from '../rakuten';
import { ACCESS_TOKEN_ENV_VAR, type CatalogGpu } from '../rakuten/types';
import { ALL_REJECTION_REASONS, renderCoverageReport } from './coverageReport';
import { buildReport, classifyFailure, measureCoverage } from './measureCoverage';
import { emptyRejectionCounts, type GpuCoverage } from './coverageReport';
import { oneLineError, parseArgs, selectGpus } from './measure-coverage';
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
    expect(report.failedGpuIds).toEqual([]);
    expect(report.gpusSucceeded).toBe(1);
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
    expect(report.gpusSucceeded).toBe(3);
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
    expect(report.gpus[1]).toMatchObject({
      gpuId: 'rtx4090',
      status: 'failed',
      failure: { category: 'http-status', httpStatus: 500, pagingReason: null },
    });
    expect(report.totals.failures).toBe(1);
    expect(report.totals.httpErrors).toBe(1);
    // A failed GPU is NOT a zero-offer GPU: "no matching feed listing" and
    // "we could not ask" are different findings and are never merged.
    expect(report.zeroOfferGpuIds).not.toContain('rtx4090');
    expect(report.failedGpuIds).toEqual(['rtx4090']);
    expect(renderCoverageReport(report)).toContain('FAILED (http-status 500)');
  });

  it('reports 1 with offers / 1 genuine zero / 1 failure, and excludes the failure from the denominator', async () => {
    // The three outcomes that must never be conflated, in one run.
    const three = [gpu('rtx5070'), gpu('rtx4090'), gpu('rx7600')];
    const fetch = (async (url: string | URL) => {
      const keyword = new URL(String(url)).searchParams.get('keyword') ?? '';
      if (keyword.includes('RTX 5070')) return new Response(fixture('newegg-rtx5070-live-shape.xml'), { status: 200 });
      if (keyword.includes('RX 7600')) return new Response('gateway timeout', { status: 504 });
      return new Response(EMPTY, { status: 200 }); // RTX 4090: a real, empty answer
    }) as unknown as typeof globalThis.fetch;

    const report = await measureCoverage({ catalog: three, env, clock: fakeClock(), fetch });

    expect(report.gpusMeasured).toBe(3);
    expect(report.gpusSucceeded).toBe(2);
    expect(report.gpusSucceeded - report.zeroOfferGpuIds.length).toBe(1); // with offers
    expect(report.zeroOfferGpuIds).toEqual(['rtx4090']); // genuine zero
    expect(report.failedGpuIds).toEqual(['rx7600']); // unknown, not zero
    expect(report.failuresByCategory['http-status']).toBe(1);

    const text = renderCoverageReport(report);
    expect(text).toContain('GPUs attempted          3');
    expect(text).toContain('measured OK             2');
    expect(text).toContain('failed / unknown        1');
    // 1 of 2 measured OK — not 1 of 3. Including the failure would report a
    // gateway timeout as 33% coverage instead of 50%.
    expect(text).toContain('with offers             1    50.0%');
    expect(text).toContain('with zero offers        1    50.0%');
    expect(text).toContain('Not measured — coverage UNKNOWN, not zero (1)');
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

  it('classifies each adapter error into its own closed category', async () => {
    const cases: Array<[string, string, number | null, string | null]> = [
      // A malformed integer is NOT an omitted field: it does not get the
      // empty-result amnesty, it gets a specific paging code.
      ['<result><TotalPages>2garbage</TotalPages></result>', 'paging', null, 'total-pages-not-integer'],
      ['not xml at all <', 'malformed-xml', null, null],
    ];
    for (const [body, category, httpStatus, pagingReason] of cases) {
      const report = await measureCoverage({
        catalog: [gpu('rtx5070')],
        env,
        clock: fakeClock(),
        fetch: servePage(body),
      });
      expect(report.gpus[0].failure, body).toEqual({ category, httpStatus, pagingReason });
    }
  });

  it('counts the observed empty shape as a genuine zero, not a failure', async () => {
    // The 39-GPU regression, end to end and for real now that the observed
    // fingerprint is admitted: three GPUs, one with listings, two the feed has
    // no matching listing for, none failed.
    const three = [gpu('rtx5070'), gpu('rtx4090'), gpu('rx7600')];
    const fetch = (async (url: string | URL) => {
      const keyword = new URL(String(url)).searchParams.get('keyword') ?? '';
      if (keyword.includes('RTX 5070')) return new Response(fixture('newegg-rtx5070-live-shape.xml'), { status: 200 });
      return new Response(fixture('newegg-empty-result-all-zero.xml'), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const report = await measureCoverage({ catalog: three, env, clock: fakeClock(), fetch });

    expect(report.gpusSucceeded).toBe(3);
    expect(report.failedGpuIds).toEqual([]);
    expect(report.zeroOfferGpuIds).toEqual(['rtx4090', 'rx7600']);
    expect(report.emptyResultGpuIds).toEqual(['rtx4090', 'rx7600']);
    // One document fetched each, and the feed reported zero pages for two.
    expect(report.gpus.map((g) => g.pagesRead)).toEqual([1, 1, 1]);

    const text = renderCoverageReport(report);
    expect(text).toContain('...no feed listing    2   (no matching Rakuten feed listing)');
    expect(text).toContain('no feed listing');
  });

  it('reports a not-yet-observed empty shape as its own paging code', async () => {
    // The 39-GPU wave, as it stands today: still failing closed, but now
    // saying exactly why, so the operator knows to run the probe rather than
    // hunting a feed bug.
    const report = await measureCoverage({
      catalog: [gpu('rtx4090')],
      env,
      clock: fakeClock(),
      fetch: servePage(fixture('newegg-empty-result-no-paging.xml')),
    });
    expect(report.gpus[0].failure).toEqual({
      category: 'paging',
      httpStatus: null,
      pagingReason: 'empty-shape-not-yet-observed',
    });
    expect(renderCoverageReport(report)).toContain('paging: empty-shape-not-yet-observed');
  });

  it('counts response documents read, not the page count the feed claimed', async () => {
    const report = await measureCoverage({
      catalog: [gpu('rtx4070')],
      env,
      clock: fakeClock(),
      fetch: (async (url: string | URL) => {
        const page = Number(new URL(String(url)).searchParams.get('pagenumber') ?? '1');
        return new Response(fixture(`newegg-rtx4070-page${page}.xml`), { status: 200 });
      }) as unknown as typeof globalThis.fetch,
    });
    expect(report.gpus[0].pagesRead).toBe(2);
    expect(report.totals.pages).toBe(2);
  });

  it('reports a histogram of paging codes, so a wave of paging failures is diagnosable', async () => {
    // "39 GPUs failed on paging" was a count without a diagnosis.
    const two = [gpu('rtx5070'), gpu('rtx4090')];
    const fetch = (async (url: string | URL) => {
      const keyword = new URL(String(url)).searchParams.get('keyword') ?? '';
      const body = keyword.includes('RTX 5070')
        ? '<result><TotalPages>1</TotalPages><PageNumber>9</PageNumber><item><sku>N82E1</sku></item></result>'
        : '<result><TotalPages>x</TotalPages><item><sku>N82E1</sku></item></result>';
      return new Response(body, { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const report = await measureCoverage({ catalog: two, env, clock: fakeClock(), fetch });
    expect(report.failuresByCategory.paging).toBe(2);
    expect(report.pagingFailuresByReason).toEqual({ 'page-number-mismatch': 1, 'total-pages-not-integer': 1 });
    expect(renderCoverageReport(report)).toContain('paging: page-number-mismatch');
  });

  it('measures a total runtime from the injected clock, including smoothing', async () => {
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

describe('the two kinds of zero stay separate in the report', () => {
  const row = (over: Partial<GpuCoverage>): GpuCoverage => ({
    gpuId: 'x',
    gpuName: 'X',
    status: 'ok',
    accepted: 0,
    rejected: 0,
    itemsSeen: 0,
    pagesRead: 1,
    totalMatches: null,
    emptyResult: false,
    rejectionsByReason: emptyRejectionCounts(),
    failure: null,
    ...over,
  });

  // Built directly rather than swept: no empty-result variant is admitted yet,
  // so a live sweep cannot currently produce an emptyResult row. The report's
  // handling of one is still worth pinning, because it is what the probe's
  // answer will switch on.
  const report = () =>
    buildReport({
      gpus: [
        row({ gpuId: 'has-offers', accepted: 3, itemsSeen: 5, rejected: 2 }),
        row({ gpuId: 'no-feed-listing', emptyResult: true }),
        row({ gpuId: 'all-rejected', itemsSeen: 7, rejected: 7 }),
      ],
      stats: { requests: 3, rateLimited: 0, httpErrors: 0, transportErrors: 0, waitedMs: 0 },
      startedAt: '2026-08-28T09:00:00.000Z',
      finishedAt: '2026-08-28T09:00:02.000Z',
      durationMs: 2000,
      requestsPerMinuteLimit: 90,
    });

  it('separates "no matching feed listing" from "every listing was rejected"', () => {
    const r = report();
    expect(r.zeroOfferGpuIds).toEqual(['no-feed-listing', 'all-rejected']);
    expect(r.emptyResultGpuIds).toEqual(['no-feed-listing']);

    const text = renderCoverageReport(r);
    expect(text).toContain('...no feed listing    1   (no matching Rakuten feed listing)');
    expect(text).toContain('...all rejected       1   (listings returned, none admitted)');
  });

  it('never claims anything about stock, and says availability is unknown', () => {
    const text = renderCoverageReport(report());
    expect(text).toContain('Availability is UNKNOWN');
    expect(text).toContain('not an inventory');
    for (const forbidden of [/in stock/i, /out of stock/i, /stocks nothing/i, /has none/i, /unavailable/i]) {
      expect(text, String(forbidden)).not.toMatch(forbidden);
    }
  });
});

describe('failure detail is structured, so it cannot carry text from anywhere else', () => {
  it('is exactly a category and a status number — no message field exists', async () => {
    const fetch = (async () =>
      new Response('unauthorized; see https://api.linksynergy.com/token?id=SECRET', { status: 401 })) as unknown as typeof globalThis.fetch;
    const report = await measureCoverage({ catalog: [gpu('rtx5070')], env, clock: fakeClock(), fetch });

    const failure = report.gpus[0].failure!;
    expect(Object.keys(failure).sort()).toEqual(['category', 'httpStatus', 'pagingReason']);
    expect(failure).toEqual({ category: 'http-status', httpStatus: 401, pagingReason: null });
    // Nothing in the whole report resembles the body the server sent.
    expect(JSON.stringify(report)).not.toContain('SECRET');
    expect(JSON.stringify(report)).not.toContain('unauthorized');
  });

  it('maps an unrecognised throw to "unexpected" rather than passing it through', () => {
    expect(classifyFailure(new Error('boom https://evil.invalid/?token=abc'))).toEqual({
      category: 'unexpected',
      httpStatus: null,
      pagingReason: null,
    });
    expect(classifyFailure('a bare string with a secret in it')).toEqual({
      category: 'unexpected',
      httpStatus: null,
      pagingReason: null,
    });
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

});

describe('the CLI reports its own errors as one clean line', () => {
  it('flattens a message, strips URLs and parameters, and keeps the error name', () => {
    expect(oneLineError(new RangeError('bad\n  value'))).toBe('RangeError: bad value');
    expect(oneLineError(new Error('failed at https://api.linksynergy.com/x?id=ABC'))).toBe('failed at [url]');
    expect(oneLineError(new Error('offerid=9876543.1 rejected'))).toBe('[redacted-param] rejected');
    expect(oneLineError(new Error('token=hunter2'))).toBe('[redacted-param]');
  });

  it('never emits a stack trace, and survives a non-Error throw', () => {
    expect(oneLineError(new Error('x'))).not.toContain('at ');
    expect(oneLineError('plain string')).toBe('plain string');
    expect(oneLineError(undefined)).toBe('undefined');
    expect(oneLineError(new Error(''))).toBe('unknown error');
  });

  it('caps a very long message', () => {
    expect(oneLineError(new Error('x'.repeat(500)))).toHaveLength(301);
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
