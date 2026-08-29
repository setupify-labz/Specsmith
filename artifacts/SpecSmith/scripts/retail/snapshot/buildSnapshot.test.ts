import { describe, it, expect } from 'vitest';

import { AVAILABILITY_UNKNOWN, OFFER_SNAPSHOT_SCHEMA_VERSION, type GpuOfferSnapshot } from '../../../src/lib/retail/offerSnapshot';
import { RAKUTEN_ADAPTER_VERSION, type NeweggOffer } from '../rakuten/types';
import {
  MAX_SHRINK_RATIO,
  MIN_BASELINE_GPUS_WITH_OFFERS,
  MIN_BASELINE_OFFERS,
  buildSnapshot,
  describeRefusal,
  snapshotSize,
  toSnapshotOffer,
  type GpuSweepOutcome,
} from './buildSnapshot';

const GENERATED_AT = '2026-08-29T12:00:00.000Z';

const accepted = (gpuId: string, sku: string, over: Partial<NeweggOffer> = {}): NeweggOffer => ({
  status: 'accepted',
  sku,
  upc: '735858492157',
  productName: `Card for ${gpuId}`,
  categoryPrimary: 'Computers',
  categorySecondary: 'Components~~Video Cards & Adapters',
  categorySecondaryLeaf: 'Video Cards & Adapters',
  retailPrice: 599.99,
  salePrice: null,
  currency: 'USD',
  imageUrl: 'https://c1.neweggimages.com/productimage/example.jpg',
  trackedAffiliateUrl: `https://click.linksynergy.com/link?id=EXAMPLE&murl=https%3A%2F%2Fwww.newegg.com%2Fp%2F${sku}`,
  canonicalGpuId: gpuId,
  mid: '44583',
  fetchedAt: GENERATED_AT,
  adapterVersion: RAKUTEN_ADAPTER_VERSION,
  ...over,
});

const ok = (gpuId: string, offers: NeweggOffer[], over: Partial<Extract<GpuSweepOutcome, { status: 'ok' }>> = {}): GpuSweepOutcome => ({
  gpuId,
  status: 'ok',
  offers,
  emptyResult: offers.length === 0,
  itemsSeen: offers.length,
  ...over,
});

const failed = (gpuId: string): GpuSweepOutcome => ({
  gpuId,
  status: 'failed',
  failure: { category: 'paging', httpStatus: null, pagingReason: 'missing-total-pages' },
});

/** A previous snapshot of a given size, for the collapse baseline. */
const previousWith = (gpuCount: number, offersPerGpu = 2): GpuOfferSnapshot => ({
  schemaVersion: OFFER_SNAPSHOT_SCHEMA_VERSION,
  adapterVersion: RAKUTEN_ADAPTER_VERSION,
  generatedAt: '2026-08-28T12:00:00.000Z',
  availability: AVAILABILITY_UNKNOWN,
  gpus: Array.from({ length: gpuCount }, (_, i) => ({
    gpuId: `gpu${i}`,
    result: 'offers' as const,
    offers: Array.from({ length: offersPerGpu }, (_, j) => toSnapshotOffer(accepted(`gpu${i}`, `SKU${i}-${j}`))),
  })),
});

describe('only accepted offers are persisted, and only what a reader needs', () => {
  it('writes the merchant fields and drops the admission evidence', () => {
    const offer = toSnapshotOffer(accepted('rtx5070', 'N82E16814137837'));
    expect(Object.keys(offer).sort()).toEqual(
      ['availability', 'currency', 'fetchedAt', 'imageUrl', 'productName', 'retailPrice', 'salePrice', 'sku', 'trackedAffiliateUrl', 'upc'].sort(),
    );
    // The category fields and the merchant id were evidence, spent when the
    // listing was admitted. The canonical id becomes the group key.
    const asText = JSON.stringify(offer);
    expect(asText).not.toContain('Video Cards');
    expect(asText).not.toContain('44583');
    expect(asText).not.toContain('canonicalGpuId');
  });

  it('carries availability unknown on every stored offer', () => {
    expect(toSnapshotOffer(accepted('rtx5070', 'A')).availability).toBe('unknown');
  });

  it('a GPU whose listings were all rejected is stored as such, with no offers', () => {
    // The rejected listings themselves are never persisted — they are other
    // cards, and their prices are not this card's price.
    const built = buildSnapshot({
      outcomes: [ok('arca750', [], { emptyResult: false, itemsSeen: 1 })],
      generatedAt: GENERATED_AT,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.snapshot.gpus).toEqual([{ gpuId: 'arca750', result: 'listings-all-rejected', offers: [] }]);
  });

  it('separates "no matching listing" from "listings came back and none matched"', () => {
    const built = buildSnapshot({
      outcomes: [ok('rtx4090', [], { emptyResult: true, itemsSeen: 0 }), ok('arca750', [], { emptyResult: false, itemsSeen: 3 })],
      generatedAt: GENERATED_AT,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.snapshot.gpus.map((g) => g.result)).toEqual(['no-matching-listing', 'listings-all-rejected']);
  });

  it('stamps the schema and adapter versions so old records stay detectable', () => {
    const built = buildSnapshot({ outcomes: [ok('rtx5070', [accepted('rtx5070', 'A')])], generatedAt: GENERATED_AT });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.snapshot.schemaVersion).toBe(OFFER_SNAPSHOT_SCHEMA_VERSION);
    expect(built.snapshot.adapterVersion).toBe(RAKUTEN_ADAPTER_VERSION);
    expect(built.snapshot.generatedAt).toBe(GENERATED_AT);
  });

  it('refuses an offer filed under a GPU it was not verified against', () => {
    // A defect rather than a condition, and the one that would put an RTX 4060
    // price on the RTX 4090's row.
    const built = buildSnapshot({ outcomes: [ok('rtx4090', [accepted('rtx4060', 'A')])], generatedAt: GENERATED_AT });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.refusal.code).toBe('offer-gpu-mismatch');
  });
});

describe('a partial sweep is never published', () => {
  it('refuses when any GPU request failed', () => {
    const built = buildSnapshot({
      outcomes: [ok('rtx5070', [accepted('rtx5070', 'A')]), failed('rtx5080')],
      generatedAt: GENERATED_AT,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.refusal.code).toBe('gpu-request-failed');
    expect(built.refusal.failedGpus).toBe(1);
  });

  it('refuses even when the failures are the only thing wrong and everything else looks fine', () => {
    const outcomes = [...Array.from({ length: 20 }, (_, i) => ok(`gpu${i}`, [accepted(`gpu${i}`, `SKU${i}`)])), failed('gpu99')];
    const built = buildSnapshot({ outcomes, generatedAt: GENERATED_AT });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.refusal.code).toBe('gpu-request-failed');
  });

  it('refuses a sweep that covered nothing', () => {
    const built = buildSnapshot({ outcomes: [], generatedAt: GENERATED_AT });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.refusal.code).toBe('no-gpus-swept');
  });

  it('publishes when every GPU answered, including the ones with no offers', () => {
    const built = buildSnapshot({
      outcomes: [ok('rtx5070', [accepted('rtx5070', 'A')]), ok('rtx4090', [], { emptyResult: true, itemsSeen: 0 })],
      generatedAt: GENERATED_AT,
    });
    expect(built.ok).toBe(true);
  });
});

describe('collapse protection keeps a known-good snapshot in place', () => {
  const sweepOf = (gpuCount: number, offersPerGpu = 2): GpuSweepOutcome[] =>
    Array.from({ length: gpuCount }, (_, i) =>
      ok(
        `gpu${i}`,
        Array.from({ length: offersPerGpu }, (_, j) => accepted(`gpu${i}`, `SKU${i}-${j}`)),
      ),
    );

  it('refuses a sweep that lost most of the GPUs that had offers', () => {
    const built = buildSnapshot({
      outcomes: [...sweepOf(3), ...Array.from({ length: 17 }, (_, i) => ok(`gpu${i + 3}`, [], { emptyResult: true, itemsSeen: 0 }))],
      generatedAt: GENERATED_AT,
      previous: previousWith(20),
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.refusal.code).toBe('gpu-coverage-collapse');
    expect(built.refusal.gpusWithOffers).toBe(3);
    expect(built.refusal.previousGpusWithOffers).toBe(20);
  });

  it('refuses a whole-store wipe — every GPU answering with nothing', () => {
    // The dangerous shape: an upstream outage answering 200 with an empty
    // catalogue looks exactly like a successful sweep finding nothing.
    const built = buildSnapshot({
      outcomes: Array.from({ length: 20 }, (_, i) => ok(`gpu${i}`, [], { emptyResult: true, itemsSeen: 0 })),
      generatedAt: GENERATED_AT,
      previous: previousWith(20),
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.refusal.code).toBe('gpu-coverage-collapse');
    expect(built.refusal.offers).toBe(0);
  });

  it('refuses a collapse in offer COUNT even when the same GPUs still have one each', () => {
    // Coverage holds at 10 GPUs; the store goes from 40 offers to 10. A
    // GPU-count-only guard would wave this through.
    const built = buildSnapshot({
      outcomes: sweepOf(10, 1),
      generatedAt: GENERATED_AT,
      previous: previousWith(10, 4),
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.refusal.code).toBe('offer-count-collapse');
    expect(built.refusal.offers).toBe(10);
    expect(built.refusal.previousOffers).toBe(40);
  });

  it('allows an ordinary shrink — feeds move between runs', () => {
    // 20 GPUs to 15, 40 offers to 30. Normal, and refusing it would make the
    // guard something people turn off.
    const built = buildSnapshot({ outcomes: sweepOf(15), generatedAt: GENERATED_AT, previous: previousWith(20) });
    expect(built.ok).toBe(true);
  });

  it('allows a drop of exactly half, and refuses one past it', () => {
    expect(buildSnapshot({ outcomes: sweepOf(10), generatedAt: GENERATED_AT, previous: previousWith(20) }).ok).toBe(true);
    expect(buildSnapshot({ outcomes: sweepOf(9), generatedAt: GENERATED_AT, previous: previousWith(20) }).ok).toBe(false);
    expect(MAX_SHRINK_RATIO).toBe(0.5);
  });

  it('allows growth, however large', () => {
    expect(buildSnapshot({ outcomes: sweepOf(40), generatedAt: GENERATED_AT, previous: previousWith(20) }).ok).toBe(true);
  });

  it('does not fire when there is no previous snapshot — the first run has no baseline', () => {
    const built = buildSnapshot({ outcomes: sweepOf(1), generatedAt: GENERATED_AT, previous: null });
    expect(built.ok).toBe(true);
  });

  it('does not fire on a baseline too small to mean anything', () => {
    // 4 GPUs down to 0 is a 100% drop and says almost nothing; the floor is
    // what stops the guard from firing on noise.
    const tiny = previousWith(MIN_BASELINE_GPUS_WITH_OFFERS - 1, 1);
    expect(snapshotSize(tiny).gpusWithOffers).toBeLessThan(MIN_BASELINE_GPUS_WITH_OFFERS);
    expect(snapshotSize(tiny).offers).toBeLessThan(MIN_BASELINE_OFFERS);
    const built = buildSnapshot({
      outcomes: Array.from({ length: 4 }, (_, i) => ok(`gpu${i}`, [], { emptyResult: true, itemsSeen: 0 })),
      generatedAt: GENERATED_AT,
      previous: tiny,
    });
    expect(built.ok).toBe(true);
  });

  it('checks failures BEFORE collapse, so the actionable reason is the one reported', () => {
    const built = buildSnapshot({
      outcomes: [...Array.from({ length: 19 }, (_, i) => ok(`gpu${i}`, [], { emptyResult: true, itemsSeen: 0 })), failed('gpu19')],
      generatedAt: GENERATED_AT,
      previous: previousWith(20),
    });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.refusal.code).toBe('gpu-request-failed');
  });
});

describe('what a refusal may say', () => {
  it('carries counts and a closed code — never a URL, a name or a price', () => {
    const built = buildSnapshot({
      outcomes: [ok('rtx5070', [accepted('rtx5070', 'N82E16814137837')]), failed('rtx5080')],
      generatedAt: GENERATED_AT,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;

    const line = describeRefusal(built.refusal);
    for (const forbidden of ['linksynergy', 'neweggimages', 'N82E16814137837', '599.99', 'Card for']) {
      expect(line, forbidden).not.toContain(forbidden);
      expect(JSON.stringify(built.refusal), forbidden).not.toContain(forbidden);
    }
    expect(line).toContain('[gpu-request-failed]');
    expect(Object.keys(built.refusal).sort()).toEqual(
      ['code', 'failedGpus', 'gpusWithOffers', 'offers', 'previousGpusWithOffers', 'previousOffers', 'problem'].sort(),
    );
  });
});

describe('the built snapshot is validated by the browser rules before it can be published', () => {
  it('refuses a candidate the reader would refuse', () => {
    // A price the feed could publish and the schema will not accept. Catching
    // it here means the file that replaces a working one is known readable.
    const built = buildSnapshot({
      outcomes: [ok('rtx5070', [accepted('rtx5070', 'A', { salePrice: 0 })])],
      generatedAt: GENERATED_AT,
    });
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.refusal.code).toBe('schema-invalid');
    expect(built.refusal.problem).toBe('offer-invalid');
  });

  it('refuses a candidate whose timestamp is not an instant', () => {
    const built = buildSnapshot({ outcomes: [ok('rtx5070', [accepted('rtx5070', 'A')])], generatedAt: 'just now' });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.refusal.code).toBe('schema-invalid');
  });
});
