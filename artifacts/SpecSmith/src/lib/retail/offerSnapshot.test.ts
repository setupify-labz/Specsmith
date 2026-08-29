import { describe, it, expect } from 'vitest';

import {
  AVAILABILITY_NOTICE,
  CURRENCY_PATTERN,
  TRACKED_LINK_HOSTS,
  isCurrencyCode,
  isTrackedAffiliateUrl,
  AVAILABILITY_UNKNOWN,
  DEFAULT_MAX_SNAPSHOT_AGE_MS,
  MAX_CLOCK_SKEW_MS,
  OFFER_SNAPSHOT_SCHEMA_VERSION,
  effectivePrice,
  offersForGpu,
  parseOfferSnapshot,
  viewSnapshot,
  type GpuOfferSnapshot,
  type SnapshotOffer,
} from './offerSnapshot';

const NOW = Date.parse('2026-08-29T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const HOUR = 60 * 60 * 1000;

const offer = (over: Partial<SnapshotOffer> = {}): SnapshotOffer => ({
  sku: 'N82E16814137837',
  upc: '735858492157',
  productName: 'ASUS TUF Gaming GeForce RTX 5070 12GB GDDR7',
  retailPrice: 599.99,
  salePrice: null,
  currency: 'USD',
  imageUrl: 'https://c1.neweggimages.com/productimage/example.jpg',
  trackedAffiliateUrl: 'https://click.linksynergy.com/link?id=EXAMPLE&offerid=1&murl=https%3A%2F%2Fwww.newegg.com%2Fp%2FN82E16814137837',
  fetchedAt: ago(HOUR),
  availability: AVAILABILITY_UNKNOWN,
  ...over,
});

const snapshot = (over: Partial<GpuOfferSnapshot> = {}): GpuOfferSnapshot => ({
  schemaVersion: OFFER_SNAPSHOT_SCHEMA_VERSION,
  adapterVersion: 2,
  generatedAt: ago(HOUR),
  availability: AVAILABILITY_UNKNOWN,
  gpus: [
    { gpuId: 'rtx5070', result: 'offers', offers: [offer()] },
    { gpuId: 'rtx4090', result: 'no-matching-listing', offers: [] },
    { gpuId: 'arca750', result: 'listings-all-rejected', offers: [] },
  ],
  ...over,
});

/** What a browser actually receives: JSON, not the object that produced it. */
const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('availability is unknown and cannot be made to say otherwise', () => {
  it('every offer carries the literal unknown', () => {
    const parsed = parseOfferSnapshot(asJson(snapshot()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const gpu of parsed.snapshot.gpus) {
      for (const o of gpu.offers) expect(o.availability).toBe('unknown');
    }
    expect(parsed.snapshot.availability).toBe('unknown');
  });

  it('refuses a snapshot claiming stock at the top level', () => {
    for (const claim of ['in-stock', 'available', 'out-of-stock', true, 1, null]) {
      const parsed = parseOfferSnapshot(asJson(snapshot({ availability: claim as never })));
      expect(parsed.ok, String(claim)).toBe(false);
      if (!parsed.ok) expect(parsed.problem).toBe('availability-not-unknown');
    }
  });

  it('refuses an OFFER claiming stock, even inside an otherwise valid snapshot', () => {
    // The interesting case: a writer that learned to publish availability
    // would do it here, per listing, not on the header.
    const withClaim = snapshot({
      gpus: [{ gpuId: 'rtx5070', result: 'offers', offers: [offer({ availability: 'in-stock' as never })] }],
    });
    const parsed = parseOfferSnapshot(asJson(withClaim));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.problem).toBe('offer-invalid');
  });

  it('the notice says availability is unknown and claims nothing about stock', () => {
    expect(AVAILABILITY_NOTICE).toMatch(/availability is unknown/i);
    // Wording, checked rather than trusted: this string is what a page shows
    // beside a price, and it is the one place a reassuring phrase could creep
    // in and become a claim the data does not support.
    for (const forbidden of [/\bin stock\b/i, /\bavailable now\b/i, /\bships\b/i, /\bbuy now\b/i, /\bguarantee/i]) {
      expect(AVAILABILITY_NOTICE, String(forbidden)).not.toMatch(forbidden);
    }
    expect(AVAILABILITY_NOTICE).toMatch(/not an inventory/i);
  });

  it('describes a zero-offer GPU as "no matching listing", never as absent stock', () => {
    const parsed = parseOfferSnapshot(asJson(snapshot()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const results = parsed.snapshot.gpus.map((g) => g.result);
    expect(results).toContain('no-matching-listing');
    expect(results).toContain('listings-all-rejected');
    // The two zeroes stay distinguishable, and neither is a stock word.
    expect(results.join(' ')).not.toMatch(/stock/i);
  });
});

describe('stale data never reaches a reader', () => {
  it('accepts a snapshot inside the age budget', () => {
    const view = viewSnapshot(asJson(snapshot()), { now: NOW });
    expect(view.status).toBe('ok');
    if (view.status === 'ok') expect(view.ageMs).toBe(HOUR);
  });

  it('refuses one past the budget, and carries no offers when it does', () => {
    const old = ago(DEFAULT_MAX_SNAPSHOT_AGE_MS + 1000);
    const view = viewSnapshot(asJson(snapshot({ generatedAt: old, gpus: [{ gpuId: 'rtx5070', result: 'offers', offers: [offer({ fetchedAt: old })] }] })), {
      now: NOW,
    });
    expect(view.status).toBe('stale');
    // The whole point: nothing a caller can render a price from.
    expect(offersForGpu(view, 'rtx5070')).toEqual([]);
    expect(JSON.stringify(view)).not.toContain('599.99');
  });

  it('measures age from the OLDEST offer, not the header', () => {
    // A writer that carried yesterday's offers forward under today's date is
    // the failure a header-only check cannot see.
    const view = viewSnapshot(
      asJson(
        snapshot({
          generatedAt: ago(60_000),
          gpus: [{ gpuId: 'rtx5070', result: 'offers', offers: [offer({ fetchedAt: ago(DEFAULT_MAX_SNAPSHOT_AGE_MS + 1000) })] }],
        }),
      ),
      { now: NOW },
    );
    expect(view.status).toBe('stale');
  });

  it('one stale offer makes the whole snapshot stale, rather than being quietly dropped', () => {
    // Dropping it would publish a partially current price list that looks
    // complete. Refusing the file says what is actually true.
    const view = viewSnapshot(
      asJson(
        snapshot({
          gpus: [
            { gpuId: 'rtx5070', result: 'offers', offers: [offer()] },
            { gpuId: 'rtx5080', result: 'offers', offers: [offer({ sku: 'N82E16814126789', fetchedAt: ago(30 * HOUR) })] },
          ],
        }),
      ),
      { now: NOW },
    );
    expect(view.status).toBe('stale');
    expect(offersForGpu(view, 'rtx5070')).toEqual([]);
  });

  it('honours a caller-supplied budget in both directions', () => {
    const raw = asJson(snapshot({ generatedAt: ago(3 * HOUR), gpus: [{ gpuId: 'rtx5070', result: 'offers', offers: [offer({ fetchedAt: ago(3 * HOUR) })] }] }));
    expect(viewSnapshot(raw, { now: NOW, maxAgeMs: 4 * HOUR }).status).toBe('ok');
    expect(viewSnapshot(raw, { now: NOW, maxAgeMs: 2 * HOUR }).status).toBe('stale');
  });

  it('refuses a future date rather than treating it as maximally fresh', () => {
    // Otherwise the easiest way to defeat the staleness rule would be to write
    // a date far enough ahead.
    const future = new Date(NOW + MAX_CLOCK_SKEW_MS + 60_000).toISOString();
    const view = viewSnapshot(asJson(snapshot({ generatedAt: future })), { now: NOW });
    expect(view.status).toBe('invalid');
    if (view.status === 'invalid') expect(view.problem).toBe('generated-at-invalid');
  });

  it('tolerates small clock skew', () => {
    const slightlyAhead = new Date(NOW + 60_000).toISOString();
    expect(viewSnapshot(asJson(snapshot({ generatedAt: slightlyAhead })), { now: NOW }).status).toBe('ok');
  });

  it('the age budget is a day and a bit, not a week', () => {
    expect(DEFAULT_MAX_SNAPSHOT_AGE_MS).toBeGreaterThan(24 * HOUR);
    expect(DEFAULT_MAX_SNAPSHOT_AGE_MS).toBeLessThan(48 * HOUR);
  });
});

describe('a malformed snapshot is refused with a closed problem code', () => {
  const refuses = (mutate: (s: GpuOfferSnapshot) => unknown, problem: string) => {
    const parsed = parseOfferSnapshot(asJson(mutate(snapshot())));
    expect(parsed.ok, problem).toBe(false);
    if (!parsed.ok) expect(parsed.problem).toBe(problem);
  };

  it('rejects things that are not snapshots at all', () => {
    for (const bad of [null, undefined, 42, 'a string', [], true]) {
      const parsed = parseOfferSnapshot(bad);
      expect(parsed.ok, String(bad)).toBe(false);
      if (!parsed.ok) expect(parsed.problem).toBe('not-an-object');
    }
  });

  it('rejects an unknown schema version', () => {
    refuses((s) => ({ ...s, schemaVersion: OFFER_SNAPSHOT_SCHEMA_VERSION + 1 }), 'schema-version-unsupported');
    refuses((s) => ({ ...s, schemaVersion: '1' }), 'schema-version-unsupported');
    refuses(({ schemaVersion: _drop, ...rest }) => rest, 'schema-version-unsupported');
  });

  it('rejects a missing or unparseable timestamp', () => {
    refuses((s) => ({ ...s, generatedAt: 'yesterday' }), 'generated-at-invalid');
    refuses((s) => ({ ...s, generatedAt: '' }), 'generated-at-invalid');
    refuses((s) => ({ ...s, generatedAt: 1_724_000_000_000 }), 'generated-at-invalid');
  });

  it('rejects a bad adapter version', () => {
    refuses((s) => ({ ...s, adapterVersion: 0 }), 'adapter-version-invalid');
    refuses((s) => ({ ...s, adapterVersion: 1.5 }), 'adapter-version-invalid');
    refuses((s) => ({ ...s, adapterVersion: 'v2' }), 'adapter-version-invalid');
  });

  it('rejects a broken gpu list', () => {
    refuses((s) => ({ ...s, gpus: 'none' }), 'gpus-not-an-array');
    refuses((s) => ({ ...s, gpus: [{ gpuId: '', result: 'offers', offers: [] }] }), 'gpu-entry-invalid');
    refuses((s) => ({ ...s, gpus: [{ gpuId: 'rtx5070', result: 'sold-out', offers: [] }] }), 'gpu-entry-invalid');
    refuses((s) => ({ ...s, gpus: [{ gpuId: 'rtx5070', result: 'offers' }] }), 'gpu-entry-invalid');
  });

  it('rejects the same GPU twice — a reader would silently take one of them', () => {
    refuses(
      (s) => ({
        ...s,
        gpus: [
          { gpuId: 'rtx5070', result: 'offers', offers: [offer()] },
          { gpuId: 'rtx5070', result: 'no-matching-listing', offers: [] },
        ],
      }),
      'duplicate-gpu-id',
    );
  });

  it('rejects a result that contradicts its own offer list', () => {
    refuses((s) => ({ ...s, gpus: [{ gpuId: 'rtx5070', result: 'offers', offers: [] }] }), 'result-contradicts-offers');
    refuses((s) => ({ ...s, gpus: [{ gpuId: 'rtx5070', result: 'no-matching-listing', offers: [offer()] }] }), 'result-contradicts-offers');
  });

  it('rejects an offer missing a required field', () => {
    for (const field of ['sku', 'productName', 'currency', 'retailPrice', 'imageUrl', 'trackedAffiliateUrl', 'fetchedAt', 'availability'] as const) {
      const broken = { ...offer() } as Record<string, unknown>;
      delete broken[field];
      const parsed = parseOfferSnapshot(asJson({ ...snapshot(), gpus: [{ gpuId: 'rtx5070', result: 'offers', offers: [broken] }] }));
      expect(parsed.ok, field).toBe(false);
      if (!parsed.ok) expect(parsed.problem, field).toBe('offer-invalid');
    }
  });

  it('rejects a price that is not a price', () => {
    for (const bad of ['599.99', -1, Number.NaN, Number.POSITIVE_INFINITY, null]) {
      const parsed = parseOfferSnapshot(asJson({ ...snapshot(), gpus: [{ gpuId: 'rtx5070', result: 'offers', offers: [offer({ retailPrice: bad as never })] }] }));
      expect(parsed.ok, String(bad)).toBe(false);
    }
  });

  it('rejects a zero sale price — the feed writes 0 for "no sale", not for "free"', () => {
    const parsed = parseOfferSnapshot(asJson({ ...snapshot(), gpus: [{ gpuId: 'rtx5070', result: 'offers', offers: [offer({ salePrice: 0 })] }] }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.problem).toBe('offer-invalid');
  });

  it('rejects a URL that is not http(s) — an href is where a bad file becomes a bad page', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'not a url', '/relative/path']) {
      for (const field of ['imageUrl', 'trackedAffiliateUrl'] as const) {
        const parsed = parseOfferSnapshot(
          asJson({ ...snapshot(), gpus: [{ gpuId: 'rtx5070', result: 'offers', offers: [offer({ [field]: bad })] }] }),
        );
        expect(parsed.ok, `${field}=${bad}`).toBe(false);
      }
    }
  });

  it('accepts a null upc and a genuine sale price', () => {
    const parsed = parseOfferSnapshot(
      asJson({ ...snapshot(), gpus: [{ gpuId: 'rtx5070', result: 'offers', offers: [offer({ upc: null, salePrice: 549.99 })] }] }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.snapshot.gpus[0].offers[0].upc).toBeNull();
    expect(effectivePrice(parsed.snapshot.gpus[0].offers[0])).toBe(549.99);
  });

  it('effectivePrice falls back to the retail price when nothing is discounted', () => {
    expect(effectivePrice(offer())).toBe(599.99);
  });

  it('offersForGpu returns nothing for an unknown id, and nothing from a bad snapshot', () => {
    const view = viewSnapshot(asJson(snapshot()), { now: NOW });
    expect(offersForGpu(view, 'no-such-gpu')).toEqual([]);
    expect(offersForGpu({ status: 'absent' }, 'rtx5070')).toEqual([]);
    expect(offersForGpu({ status: 'invalid', problem: 'not-an-object' }, 'rtx5070')).toEqual([]);
  });
});

describe('the parser keeps the invariants the adapter admitted the listing under', () => {
  const withOffer = (over: Partial<SnapshotOffer>) =>
    parseOfferSnapshot(asJson({ ...snapshot(), gpus: [{ gpuId: 'rtx5070', result: 'offers', offers: [offer(over)] }] }));

  describe('a retail price is strictly above zero', () => {
    it('refuses zero — the number a shopping page must never show', () => {
      // The adapter refuses a listing whose <price> is zero or less. This is
      // the same rule at the point where a file becomes a price tag, because
      // the browser reads a file it did not write.
      const parsed = withOffer({ retailPrice: 0 });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.problem).toBe('offer-invalid');
    });

    it('refuses a negative price', () => {
      expect(withOffer({ retailPrice: -0.01 }).ok).toBe(false);
      expect(withOffer({ retailPrice: -599.99 }).ok).toBe(false);
    });

    it('refuses a sale price of zero, which the feed writes for "no sale"', () => {
      expect(withOffer({ salePrice: 0 }).ok).toBe(false);
      expect(withOffer({ salePrice: -1 }).ok).toBe(false);
    });

    it('accepts the smallest real price, so the rule is > 0 and not > 1', () => {
      // Mutation-resistant in the other direction: a check tightened to some
      // arbitrary floor would reject a legitimately cheap listing.
      expect(withOffer({ retailPrice: 0.01 }).ok).toBe(true);
      expect(withOffer({ retailPrice: 0.01, salePrice: 0.01 }).ok).toBe(true);
    });
  });

  describe('a tracked affiliate link points at the network, over https', () => {
    it('accepts exactly the two documented hosts', () => {
      expect([...TRACKED_LINK_HOSTS].sort()).toEqual(['click.linksynergy.com', 'www.linksynergy.com']);
      for (const host of TRACKED_LINK_HOSTS) {
        expect(withOffer({ trackedAffiliateUrl: `https://${host}/link?id=EXAMPLE` }).ok, host).toBe(true);
      }
    });

    it('refuses a lookalike host that merely CONTAINS the real one', () => {
      // The whole reason the comparison is an exact hostname rather than a
      // prefix, a substring or a suffix. Each of these defeats one of those.
      const lookalikes = [
        'https://click.linksynergy.com.evil.test/link',
        'https://evil.test/click.linksynergy.com',
        'https://evil.test/?next=https://click.linksynergy.com',
        'https://notclick.linksynergy.com/link',
        'https://linksynergy.com.evil.test/link',
        'https://click.linksynergy.evil.test/link',
        'https://evil.test#click.linksynergy.com',
      ];
      for (const url of lookalikes) {
        expect(withOffer({ trackedAffiliateUrl: url }).ok, url).toBe(false);
        expect(isTrackedAffiliateUrl(url), url).toBe(false);
      }
    });

    it('refuses a subdomain of an allowed host, and the bare domain', () => {
      for (const url of ['https://a.click.linksynergy.com/link', 'https://linksynergy.com/link', 'https://click.linksynergy.com.br/link']) {
        expect(isTrackedAffiliateUrl(url), url).toBe(false);
      }
    });

    it('refuses http, and every other scheme', () => {
      for (const url of [
        'http://click.linksynergy.com/link',
        'ftp://click.linksynergy.com/link',
        'javascript:alert(1)',
        'data:text/html,<script>',
        '//click.linksynergy.com/link',
        'click.linksynergy.com/link',
      ]) {
        expect(isTrackedAffiliateUrl(url), url).toBe(false);
      }
    });

    it('refuses an untracked merchant link — a buy button that earns nothing', () => {
      expect(withOffer({ trackedAffiliateUrl: 'https://www.newegg.com/p/N82E16814137837' }).ok).toBe(false);
    });

    it('accepts an allowed host written in mixed case, which is the same host', () => {
      // URL parsing lowercases the hostname, so this is not a hole; asserted
      // so a future "fix" does not add a case-sensitive comparison.
      expect(isTrackedAffiliateUrl('https://CLICK.LinkSynergy.COM/link?id=EXAMPLE')).toBe(true);
    });

    it('leaves the image URL to any http(s) host — a merchant CDN is not ours to pin', () => {
      expect(withOffer({ imageUrl: 'https://c1.neweggimages.com/x.jpg' }).ok).toBe(true);
      expect(withOffer({ imageUrl: 'https://images.example.test/x.jpg' }).ok).toBe(true);
      expect(withOffer({ imageUrl: 'javascript:alert(1)' }).ok).toBe(false);
    });
  });

  describe('a currency is exactly three uppercase letters', () => {
    it('accepts real ISO 4217 codes', () => {
      for (const code of ['USD', 'CAD', 'GBP', 'EUR']) {
        expect(withOffer({ currency: code }).ok, code).toBe(true);
      }
    });

    it('refuses the wrong case, the wrong length, and anything that is not letters', () => {
      for (const bad of ['usd', 'Usd', 'US', 'USDD', 'US1', 'U$D', '$', 'US ', ' USD', 'USD ', '', '   ']) {
        expect(withOffer({ currency: bad }).ok, JSON.stringify(bad)).toBe(false);
        expect(isCurrencyCode(bad), JSON.stringify(bad)).toBe(false);
      }
    });

    it('is anchored at both ends', () => {
      // Mutation-resistant: an unanchored /[A-Z]{3}/ passes all of these.
      for (const bad of ['xUSD', 'USDx', 'aUSDa', 'USD\nEUR']) {
        expect(CURRENCY_PATTERN.test(bad), bad).toBe(false);
      }
    });

    it('refuses a currency that is not a string at all', () => {
      for (const bad of [null, 840, ['USD']]) {
        expect(withOffer({ currency: bad as never }).ok, String(bad)).toBe(false);
      }
    });
  });
});
