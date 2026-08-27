import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildProductSearchUrl,
  fetchProductSearchXml,
  RakutenAuthError,
  RakutenRequestError,
  readAccessToken,
  redactToken,
} from './client';
import { fetchNeweggOffersForGpu, keywordForGpu, loadGpuCatalog } from './index';
import { ACCESS_TOKEN_ENV_VAR, NEWEGG_MID, type CatalogGpu } from './types';

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

describe('fetchNeweggOffersForGpu', () => {
  it('runs the whole pipeline over a captured response and returns rejections alongside offers', async () => {
    const result = await fetchNeweggOffersForGpu(gpu('rtx4070'), catalog, {
      env,
      fetch: okFetch(fixture('newegg-rtx4070-page.xml')),
      now: () => new Date('2026-08-20T12:04:11Z'),
    });
    expect(result.itemsSeen).toBe(8);
    expect(result.offers.map((o) => o.sku)).toEqual(['N82E16814932663']);
    expect(result.rejected).toHaveLength(7);
    expect(result.offers[0].fetchedAt).toBe('2026-08-20T12:04:11.000Z');
    expect(result.keyword).toBe('NVIDIA GeForce RTX 4070 graphics card');
  });

  it('emits no token anywhere in the returned records', async () => {
    const result = await fetchNeweggOffersForGpu(gpu('rtx4070'), catalog, {
      env,
      fetch: okFetch(fixture('newegg-rtx4070-page.xml')),
      now: () => new Date('2026-08-20T12:04:11Z'),
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});
