import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildProductSearchUrl,
  fetchAllProductSearchPages,
  fetchProductSearchXml,
  MAX_PAGES_PER_SEARCH,
  RakutenAuthError,
  RakutenRequestError,
  readAccessToken,
  redactToken,
} from './client';
import { fetchNeweggOffersForGpu, keywordForGpu, loadGpuCatalog } from './index';
import { ACCESS_TOKEN_ENV_VAR, NEWEGG_MID, REQUIRED_CATEGORY_LEAF, type CatalogGpu } from './types';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const fixture = (name: string) => fs.readFileSync(path.join(fixtures, name), 'utf-8');

const catalog = loadGpuCatalog();
const gpu = (id: string): CatalogGpu => catalog.find((g) => g.id === id)!;
const TOKEN = 'test-token-not-a-real-credential';
const env = { [ACCESS_TOKEN_ENV_VAR]: TOKEN } as NodeJS.ProcessEnv;

const okFetch = (body: string, seen?: { url?: string; init?: RequestInit }) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    if (seen) {
      seen.url = String(url);
      seen.init = init;
    }
    return new Response(body, { status: 200 });
  }) as unknown as typeof globalThis.fetch;

describe('readAccessToken', () => {
  it('reads the token from the process environment', () => {
    expect(readAccessToken(env)).toBe(TOKEN);
  });

  it('throws when unset, and names the variable without echoing any value', () => {
    expect(() => readAccessToken({} as NodeJS.ProcessEnv)).toThrow(RakutenAuthError);
    expect(() => readAccessToken({ [ACCESS_TOKEN_ENV_VAR]: '   ' } as NodeJS.ProcessEnv)).toThrow(ACCESS_TOKEN_ENV_VAR);
  });

  it('does not accept a VITE_-prefixed variable, which Vite would inline into the bundle', () => {
    expect(() => readAccessToken({ VITE_RAKUTEN_API_ACCESS_TOKEN: TOKEN } as NodeJS.ProcessEnv)).toThrow(RakutenAuthError);
  });
});

describe('buildProductSearchUrl', () => {
  it('pins the merchant to Newegg and carries no credential', () => {
    const url = buildProductSearchUrl({ keyword: 'NVIDIA GeForce RTX 4070 graphics card', max: 100 });
    expect(new URL(url).searchParams.get('mid')).toBe(NEWEGG_MID);
    expect(new URL(url).searchParams.get('keyword')).toBe('NVIDIA GeForce RTX 4070 graphics card');
    expect(new URL(url).searchParams.get('cat')).toBe(REQUIRED_CATEGORY_LEAF);
    expect(url).not.toContain(TOKEN);
    expect(url.toLowerCase()).not.toContain('token');
  });
});

describe('fetchProductSearchXml', () => {
  it('sends the token as a Bearer header and never in the URL', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    await fetchProductSearchXml({ keyword: 'RTX 4070' }, { env, fetch: okFetch('<result/>', seen), now: () => new Date('2026-08-20T12:00:00Z') });
    expect(seen.url).not.toContain(TOKEN);
    expect((seen.init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('stamps fetchedAt from the injected clock', async () => {
    const res = await fetchProductSearchXml({ keyword: 'RTX 4070' }, { env, fetch: okFetch('<result/>'), now: () => new Date('2026-08-20T12:00:00Z') });
    expect(res.fetchedAt).toBe('2026-08-20T12:00:00.000Z');
  });

  it('refuses to send an empty Bearer header when the token is missing', async () => {
    await expect(
      fetchProductSearchXml({ keyword: 'RTX 4070' }, { env: {} as NodeJS.ProcessEnv, fetch: okFetch('<result/>') }),
    ).rejects.toThrow(RakutenAuthError);
  });

  it('redacts the token out of an HTTP error body', async () => {
    const leaky = (async () => new Response(`unauthorized for ${TOKEN}`, { status: 401 })) as unknown as typeof globalThis.fetch;
    const err = await fetchProductSearchXml({ keyword: 'x' }, { env, fetch: leaky }).catch((e) => e as RakutenRequestError);
    expect(err).toBeInstanceOf(RakutenRequestError);
    expect((err as RakutenRequestError).httpStatus).toBe(401);
    expect((err as Error).message).not.toContain(TOKEN);
    expect((err as Error).message).toContain('[REDACTED]');
  });

  it('redacts the token out of a network error', async () => {
    const boom = (async () => {
      throw new Error(`ECONNRESET while sending Bearer ${TOKEN}`);
    }) as unknown as typeof globalThis.fetch;
    const err = await fetchProductSearchXml({ keyword: 'x' }, { env, fetch: boom }).catch((e) => e as Error);
    expect(err.message).not.toContain(TOKEN);
  });
});

describe('redactToken', () => {
  it('replaces every occurrence and is a no-op for an empty token', () => {
    expect(redactToken(`a ${TOKEN} b ${TOKEN}`, TOKEN)).toBe('a [REDACTED] b [REDACTED]');
    expect(redactToken('unchanged', '')).toBe('unchanged');
  });
});

describe('keywordForGpu', () => {
  it('reuses src/lib/fps.ts buildPartQuery rather than inventing a second spelling', () => {
    expect(keywordForGpu(gpu('rtx4070'))).toBe('NVIDIA GeForce RTX 4070 graphics card');
    expect(keywordForGpu(gpu('rx7800xt'))).toBe('AMD Radeon RX 7800 XT graphics card');
  });
});

/** Serves page N of the two-page RTX 4070 fixture, recording which pages were asked for. */
const pagedFetch = (asked: number[]) =>
  (async (url: string | URL) => {
    const page = Number(new URL(String(url)).searchParams.get('pagenumber') ?? '1');
    asked.push(page);
    return new Response(fixture(`newegg-rtx4070-page${page}.xml`), { status: 200 });
  }) as unknown as typeof globalThis.fetch;

describe('fetchAllProductSearchPages', () => {
  it('walks every page the response reports', async () => {
    const asked: number[] = [];
    const result = await fetchAllProductSearchPages({ keyword: 'RTX 4070' }, { env, fetch: pagedFetch(asked), now: () => new Date('2026-08-27T03:12:44Z') });
    expect(asked).toEqual([1, 2]);
    expect(result.pages).toHaveLength(2);
    expect(result.totalPages).toBe(2);
    expect(result.totalMatches).toBe(8);
  });

  it('stamps one fetchedAt for the whole search, not one per page', async () => {
    let tick = 0;
    const result = await fetchAllProductSearchPages(
      { keyword: 'RTX 4070' },
      { env, fetch: pagedFetch([]), now: () => new Date(Date.UTC(2026, 7, 27, 3, 12, tick++)) },
    );
    expect(result.fetchedAt).toBe('2026-08-27T03:12:00.000Z');
  });

  it('throws rather than assuming one page when TotalPages is missing', async () => {
    await expect(
      fetchAllProductSearchPages({ keyword: 'x' }, { env, fetch: okFetch('<result><item><sku>a</sku></item></result>') }),
    ).rejects.toThrow(/TotalPages/);
  });

  it('throws when the feed reports more pages than the guard allows, instead of reading a prefix', async () => {
    const many = `<result><TotalPages>${MAX_PAGES_PER_SEARCH + 1}</TotalPages><PageNumber>1</PageNumber></result>`;
    await expect(fetchAllProductSearchPages({ keyword: 'x' }, { env, fetch: okFetch(many) })).rejects.toThrow(/guard/);
  });

  it('throws when a page comes back as a different page than requested', async () => {
    const wrong = (async (url: string | URL) => {
      const page = Number(new URL(String(url)).searchParams.get('pagenumber') ?? '1');
      // Always answers "page 1", so page 2 would silently duplicate page 1.
      return new Response(`<result><TotalPages>2</TotalPages><PageNumber>1</PageNumber><item><sku>p${page}</sku></item></result>`, { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    await expect(fetchAllProductSearchPages({ keyword: 'x' }, { env, fetch: wrong })).rejects.toThrow(/page 2/);
  });
});

describe('fetchNeweggOffersForGpu', () => {
  it('runs the whole pipeline across every page and returns rejections alongside offers', async () => {
    const asked: number[] = [];
    const result = await fetchNeweggOffersForGpu(gpu('rtx4070'), {
      env,
      fetch: pagedFetch(asked),
      now: () => new Date('2026-08-27T03:12:44Z'),
    });
    expect(asked).toEqual([1, 2]);
    expect(result.pagesRead).toBe(2);
    expect(result.totalMatches).toBe(8);
    expect(result.itemsSeen).toBe(8);
    expect(result.offers.map((o) => o.sku)).toEqual(['N82E16814932663']);
    expect(result.rejected).toHaveLength(7);
    expect(result.offers[0].fetchedAt).toBe('2026-08-27T03:12:44.000Z');
    expect(result.keyword).toBe('NVIDIA GeForce RTX 4070 graphics card');
  });

  it('would have missed page 2 entirely if it stopped at the first page', async () => {
    // The regression this guards: every listing on page 2 is one the search
    // is responsible for judging, and four of them are here.
    const result = await fetchNeweggOffersForGpu(gpu('rtx4070'), { env, fetch: pagedFetch([]), now: () => new Date('2026-08-27T03:12:44Z') });
    expect(result.rejected.map((r) => r.sku)).toContain('N82E16814126692'); // RTX 4070 Ti, page 2
  });

  it('emits no token anywhere in the returned records', async () => {
    const result = await fetchNeweggOffersForGpu(gpu('rtx4070'), {
      env,
      fetch: pagedFetch([]),
      now: () => new Date('2026-08-27T03:12:44Z'),
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});
