// @vitest-environment jsdom
//
// The manifest boundary, exercised where it actually runs.
//
// product-images.json decides which URL the browser loads into an <img> on a
// page about things people buy. It is treated as an untrusted document: these
// tests drive the real hook against real fetch responses, because validating in
// a pure function is only useful if the thing that fetches actually calls it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';

import { useProductImageManifest, PRODUCT_IMAGE_MANIFEST_URL } from './useProductImageManifest';
import { expectedProcessedPath } from '../lib/retail/processedImages';

const SHA = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

const validEntry = (over: Record<string, unknown> = {}) => ({
  partId: 'newegg-gpu-a',
  sourceUrl: 'https://c1.neweggimages.test/a.png',
  sourceSha256: SHA,
  outcome: 'processed',
  processedPath: expectedProcessedPath(SHA),
  approved: true,
  rightsBasis: 'test fixture',
  ...over,
});

function serve(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      expect(String(url)).toContain(PRODUCT_IMAGE_MANIFEST_URL);
      return { ok, json: async () => body } as unknown as Response;
    }) as unknown as typeof fetch,
  );
}

const load = async (body: unknown, ok = true) => {
  serve(body, ok);
  const { result } = renderHook(() => useProductImageManifest());
  await waitFor(() => expect(result.current).toBeInstanceOf(Map));
  // Give the effect's promise a turn to settle before asserting emptiness.
  await new Promise((r) => setTimeout(r, 0));
  return result;
};

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('a well-formed manifest is indexed', () => {
  it('accepts an entry whose path is derived from its own hash', async () => {
    const result = await load({ generatedAt: 'x', source: 'catalogue', entries: [validEntry()] });
    await waitFor(() => expect(result.current.size).toBe(1));
    expect(result.current.get('newegg-gpu-a')?.processedPath).toBe(expectedProcessedPath(SHA));
  });

  it('accepts a kept-original entry that names no file', async () => {
    const result = await load({
      entries: [validEntry({ outcome: 'kept-original', processedPath: undefined, approved: undefined })],
    });
    await waitFor(() => expect(result.current.size).toBe(1));
    expect(result.current.get('newegg-gpu-a')?.outcome).toBe('kept-original');
  });
});

describe('a processed path may only ever be our own derived file', () => {
  it.each([
    ['another origin', 'https://evil.test/images/products/a.png'],
    ['a protocol-relative host', `//evil.test${expectedProcessedPath(SHA)}`],
    ['directory traversal', '/images/products/../../etc/passwd'],
    ['traversal that ends in the right name', `/images/products/../../${SHA}.png`],
    ['a different image entirely', expectedProcessedPath(OTHER)],
    ['the right folder but a wrong name', '/images/products/something-else.png'],
    ['a data URI', 'data:image/png;base64,AAAA'],
    ['a javascript URI', 'javascript:alert(1)'],
    ['a path outside the folder', '/uploads/a.png'],
  ])('rejects %s', async (_label, processedPath) => {
    const result = await load({ entries: [validEntry({ processedPath })] });
    expect(result.current.size).toBe(0);
  });
});

describe('malformed entries are dropped, not repaired', () => {
  it.each([
    ['a non-object entry', 'nonsense'],
    ['no part id', validEntry({ partId: '' })],
    ['a non-http source', validEntry({ sourceUrl: 'ftp://x/a.png' })],
    ['a short hash', validEntry({ sourceSha256: 'abc' })],
    ['an uppercase hash', validEntry({ sourceSha256: SHA.toUpperCase() })],
    ['an unknown outcome', validEntry({ outcome: 'maybe' })],
    ['a processed entry with no file', validEntry({ processedPath: undefined })],
    ['a kept entry that names a file', validEntry({ outcome: 'kept-original' })],
    ['a non-boolean approved flag', validEntry({ approved: 'yes' })],
    ['a non-string rights basis', validEntry({ rightsBasis: 42 })],
  ])('rejects %s', async (_label, entry) => {
    const result = await load({ entries: [entry] });
    expect(result.current.size).toBe(0);
  });

  it('keeps the good entries in a file that also contains bad ones', async () => {
    const result = await load({
      entries: [validEntry({ partId: 'bad', processedPath: 'https://evil.test/x.png' }), validEntry()],
    });
    await waitFor(() => expect(result.current.size).toBe(1));
    expect(result.current.has('newegg-gpu-a')).toBe(true);
    expect(result.current.has('bad')).toBe(false);
  });
});

describe('duplicates are discarded rather than resolved', () => {
  it('drops every entry naming the same part', async () => {
    // Picking either would make which picture a shopper sees depend on file
    // order, which is not a decision this code is entitled to make.
    const result = await load({
      entries: [validEntry(), validEntry({ sourceSha256: OTHER, processedPath: expectedProcessedPath(OTHER) })],
    });
    expect(result.current.size).toBe(0);
  });
});

describe('a manifest that is not there, or not a manifest, means merchant images', () => {
  it.each([
    ['the file is missing', null, false],
    ['the body is not an object', '"a string"', true],
    ['there is no entries array', { generatedAt: 'x' }, true],
    ['entries is not an array', { entries: {} }, true],
    ['the body is null', null, true],
  ])('returns an empty map when %s', async (_label, body, ok) => {
    const result = await load(body, ok as boolean);
    expect(result.current.size).toBe(0);
  });

  it('returns an empty map when the JSON itself is unparseable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      })) as unknown as typeof fetch,
    );
    const { result } = renderHook(() => useProductImageManifest());
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.size).toBe(0);
  });
});
