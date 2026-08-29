import { describe, it, expect } from 'vitest';

import { AVAILABILITY_UNKNOWN, DEFAULT_MAX_SNAPSHOT_AGE_MS, OFFER_SNAPSHOT_SCHEMA_VERSION } from './offerSnapshot';
import { OFFER_SNAPSHOT_URL, loadOfferSnapshot } from './offerSnapshotLoader';

const NOW = Date.parse('2026-08-29T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const HOUR = 60 * 60 * 1000;

const validSnapshot = (generatedAt = ago(HOUR)) => ({
  schemaVersion: OFFER_SNAPSHOT_SCHEMA_VERSION,
  adapterVersion: 2,
  generatedAt,
  availability: AVAILABILITY_UNKNOWN,
  gpus: [
    {
      gpuId: 'rtx5070',
      result: 'offers',
      offers: [
        {
          sku: 'N82E16814137837',
          upc: null,
          productName: 'ASUS TUF Gaming GeForce RTX 5070 12GB',
          retailPrice: 599.99,
          salePrice: null,
          currency: 'USD',
          imageUrl: 'https://c1.neweggimages.com/productimage/example.jpg',
          trackedAffiliateUrl: 'https://click.linksynergy.com/link?id=EXAMPLE&murl=https%3A%2F%2Fwww.newegg.com',
          fetchedAt: generatedAt,
          availability: AVAILABILITY_UNKNOWN,
        },
      ],
    },
  ],
});

const respondWith = (body: unknown, init: ResponseInit = {}) =>
  (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init,
    })) as unknown as typeof globalThis.fetch;

describe('the browser loader', () => {
  it('fetches the published path and returns fresh offers', async () => {
    let seen: { url?: string; init?: RequestInit } = {};
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify(validSnapshot()), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const view = await loadOfferSnapshot({ fetch: fetchImpl, now: NOW });

    expect(seen.url).toBe(OFFER_SNAPSHOT_URL);
    // Revalidate rather than serve a copy: a cached snapshot is by definition
    // an older one.
    expect(seen.init?.cache).toBe('no-cache');
    expect(view.status).toBe('ok');
    if (view.status === 'ok') expect(view.snapshot.gpus[0].offers).toHaveLength(1);
  });

  it('reports a missing file as absent, not as an error', async () => {
    // Normal before the first sweep has ever run.
    const view = await loadOfferSnapshot({ fetch: respondWith('', { status: 404 }), now: NOW });
    expect(view.status).toBe('absent');
  });

  it('reports a network failure as absent rather than throwing', async () => {
    const boom = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof globalThis.fetch;
    await expect(loadOfferSnapshot({ fetch: boom, now: NOW })).resolves.toEqual({ status: 'absent' });
  });

  it('reports a non-JSON 200 as invalid — a truncated download is a defect, not an absence', async () => {
    const view = await loadOfferSnapshot({ fetch: respondWith('<html>error page</html>'), now: NOW });
    expect(view.status).toBe('invalid');
  });

  it('refuses a stale published snapshot, and hands back no price', async () => {
    const stale = validSnapshot(ago(DEFAULT_MAX_SNAPSHOT_AGE_MS + HOUR));
    const view = await loadOfferSnapshot({ fetch: respondWith(stale), now: NOW });
    expect(view.status).toBe('stale');
    expect(JSON.stringify(view)).not.toContain('599.99');
    expect(JSON.stringify(view)).not.toContain('linksynergy');
  });

  it('refuses a malformed published snapshot with a closed problem code', async () => {
    const broken = { ...validSnapshot(), availability: 'in-stock' };
    const view = await loadOfferSnapshot({ fetch: respondWith(broken), now: NOW });
    expect(view.status).toBe('invalid');
    if (view.status === 'invalid') expect(view.problem).toBe('availability-not-unknown');
  });

  it('never throws, whatever the server does', async () => {
    const responses = [
      respondWith('', { status: 500 }),
      respondWith('', { status: 403 }),
      respondWith('null'),
      respondWith('[]'),
      respondWith('{'),
    ];
    for (const fetchImpl of responses) {
      const view = await loadOfferSnapshot({ fetch: fetchImpl, now: NOW });
      expect(['absent', 'invalid', 'stale', 'ok']).toContain(view.status);
    }
  });

  it('publishes under /data/, not under the immutably cached /assets/', async () => {
    // public/_headers caches /assets/* forever; this file changes under a
    // fixed name on a schedule, which is the opposite requirement.
    expect(OFFER_SNAPSHOT_URL.startsWith('/data/')).toBe(true);
    expect(OFFER_SNAPSHOT_URL).not.toContain('/assets/');
  });
});
