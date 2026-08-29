import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGpuCatalog } from '../rakuten';
import { ACCESS_TOKEN_ENV_VAR, type CatalogGpu } from '../rakuten/types';
import type { Clock } from '../coverage/rateLimiter';
import { buildSnapshot } from './buildSnapshot';
import { sweepOffers } from './sweepOffers';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'rakuten', '__fixtures__');
const fixture = (name: string) => fs.readFileSync(path.join(fixtures, name), 'utf-8');

const catalog = loadGpuCatalog();
const gpu = (id: string): CatalogGpu => catalog.find((g) => g.id === id)!;

const env = { [ACCESS_TOKEN_ENV_VAR]: 'test-token-not-a-real-credential' } as NodeJS.ProcessEnv;

function fakeClock(): Clock {
  let t = Date.parse('2026-08-29T09:00:00.000Z');
  return { now: () => t, sleep: async (ms) => void (t += ms) };
}

const EMPTY = '<result><TotalMatches>0</TotalMatches><TotalPages>0</TotalPages><PageNumber>0</PageNumber></result>';

/** Answers per request in order, so one GPU can fail while the others succeed. */
const serve = (bodies: Array<{ body: string; status?: number }>) => {
  let i = 0;
  return (async () => {
    const next = bodies[Math.min(i, bodies.length - 1)];
    i += 1;
    return new Response(next.body, { status: next.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;
};

describe('the sweep keeps the offers and records the failures', () => {
  it('returns accepted offers for a GPU the feed answers for', async () => {
    const sweep = await sweepOffers({
      catalog: [gpu('rtx5070')],
      env,
      clock: fakeClock(),
      fetch: serve([{ body: fixture('newegg-rtx5070-live-shape.xml') }]),
    });

    expect(sweep.outcomes).toHaveLength(1);
    const outcome = sweep.outcomes[0];
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.offers.length).toBeGreaterThan(0);
    // Rejections are counted by the coverage tool and never carried here: a
    // snapshot holding refused listings would be publishing other cards' prices.
    expect(outcome.offers.every((o) => o.canonicalGpuId === 'rtx5070')).toBe(true);
    expect(outcome.offers.every((o) => o.status === 'accepted')).toBe(true);
  });

  it('records an empty result as a successful zero, not a failure', async () => {
    const sweep = await sweepOffers({ catalog: [gpu('rtx4090')], env, clock: fakeClock(), fetch: serve([{ body: EMPTY }]) });
    const outcome = sweep.outcomes[0];
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome).toMatchObject({ emptyResult: true, itemsSeen: 0 });
    expect(outcome.offers).toEqual([]);
  });

  it('records a failing GPU as failed and keeps sweeping the rest', async () => {
    // One bad request must not cost the other measurements — and must not be
    // silently indistinguishable from a GPU that genuinely has no listings.
    const sweep = await sweepOffers({
      catalog: [gpu('rtx5070'), gpu('rtx4090')],
      env,
      clock: fakeClock(),
      fetch: serve([{ body: fixture('newegg-rtx5070-live-shape.xml') }, { body: 'server error', status: 500 }]),
    });

    expect(sweep.outcomes.map((o) => o.status)).toEqual(['ok', 'failed']);
    const failure = sweep.outcomes[1];
    if (failure.status !== 'failed') return;
    expect(failure.failure).toEqual({ category: 'http-status', httpStatus: 500, pagingReason: null });
  });

  it('a partial sweep produces no snapshot, end to end', async () => {
    const sweep = await sweepOffers({
      catalog: [gpu('rtx5070'), gpu('rtx4090')],
      env,
      clock: fakeClock(),
      fetch: serve([{ body: fixture('newegg-rtx5070-live-shape.xml') }, { body: 'nope', status: 503 }]),
    });

    const built = buildSnapshot({ outcomes: sweep.outcomes, generatedAt: sweep.finishedAt });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.refusal.code).toBe('gpu-request-failed');
    expect(built.refusal.failedGpus).toBe(1);
  });

  it('a complete sweep produces a snapshot the browser parser accepts', async () => {
    const sweep = await sweepOffers({
      catalog: [gpu('rtx5070'), gpu('rtx4090')],
      env,
      clock: fakeClock(),
      fetch: serve([{ body: fixture('newegg-rtx5070-live-shape.xml') }, { body: EMPTY }]),
    });

    const built = buildSnapshot({ outcomes: sweep.outcomes, generatedAt: sweep.finishedAt });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.snapshot.gpus.map((g) => g.gpuId)).toEqual(['rtx5070', 'rtx4090']);
    expect(built.snapshot.gpus[1]).toEqual({ gpuId: 'rtx4090', result: 'no-matching-listing', offers: [] });
    // Every stored offer keeps its own fetch time, which is what the reader's
    // staleness rule is measured against.
    for (const offer of built.snapshot.gpus[0].offers) {
      expect(Number.isFinite(Date.parse(offer.fetchedAt))).toBe(true);
      expect(offer.availability).toBe('unknown');
    }
  });

  it('paces through the shared limiter rather than firing as fast as the network allows', async () => {
    const clock = fakeClock();
    const before = clock.now();
    await sweepOffers({
      catalog: [gpu('rtx5070'), gpu('rtx4090'), gpu('rtx5080')],
      env,
      clock,
      requestsPerMinute: 60,
      fetch: serve([{ body: EMPTY }]),
    });
    // 60/minute is a one-second gap; three requests cannot finish instantly.
    expect(clock.now() - before).toBeGreaterThan(0);
  });
});
