import { describe, expect, it } from 'vitest';

import { checkPartPricing, type AffiliatePart } from './partCatalog';
import {
  AVAILABILITY_UNKNOWN_LABEL,
  PRICE_FRESHNESS_MS,
  STALE_PRICE_LABEL,
  formatAmount,
  formatCheckedAt,
  priceView,
  subtotalLabel,
  summarizeBuildPrices,
} from './partPricing';

const NOW = Date.parse('2026-08-30T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const HOUR = 60 * 60 * 1000;

const part = (over: Partial<AffiliatePart> = {}): AffiliatePart => ({
  id: 'newegg-gpu-n82e16814500639',
  category: 'gpu',
  merchant: 'Newegg',
  name: 'ZOTAC SOLID OC GeForce RTX 5090',
  imageUrl: 'https://c1.neweggimages.com/example.jpg',
  trackedAffiliateUrl: 'https://click.linksynergy.com/link?id=site&offerid=1',
  fetchedAt: ago(HOUR),
  availability: 'unknown',
  retailPrice: 1999.99,
  salePrice: null,
  currency: 'USD',
  canonicalPartId: 'rtx5090',
  specsVerified: true,
  ...over,
});

describe('retail and sale prices are parsed under closed rules', () => {
  it('accepts a plain retail price with no sale', () => {
    expect(checkPartPricing({ retailPrice: 1999.99, salePrice: null, currency: 'USD' })).toEqual({ ok: true });
  });

  it('accepts a genuine discount', () => {
    expect(checkPartPricing({ retailPrice: 1999.99, salePrice: 1799.99, currency: 'USD' })).toEqual({ ok: true });
  });

  it('refuses a zero retail price — the feed writes 0 for absence, never for free', () => {
    expect(checkPartPricing({ retailPrice: 0, salePrice: null, currency: 'USD' })).toEqual({
      ok: false,
      problem: 'retail-price-not-positive',
    });
  });

  it('refuses a negative retail price', () => {
    expect(checkPartPricing({ retailPrice: -1, salePrice: null, currency: 'USD' })).toEqual({
      ok: false,
      problem: 'retail-price-not-positive',
    });
  });

  it('refuses a malformed retail price', () => {
    for (const bad of ['1999.99', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      expect(checkPartPricing({ retailPrice: bad, salePrice: null, currency: 'USD' }), String(bad)).toEqual({
        ok: false,
        problem: 'retail-price-not-a-number',
      });
    }
  });

  it('refuses a malformed sale price rather than dropping it silently', () => {
    for (const bad of ['1799', Number.NaN, 0, -5]) {
      expect(checkPartPricing({ retailPrice: 1999.99, salePrice: bad, currency: 'USD' }), String(bad)).toEqual({
        ok: false,
        problem: 'sale-price-invalid',
      });
    }
  });

  it('refuses a sale price that is not actually lower', () => {
    // A card strikes the retail price through whenever a sale price exists, so
    // an equal or higher "sale" would render a discount that is not one.
    expect(checkPartPricing({ retailPrice: 1999.99, salePrice: 1999.99, currency: 'USD' })).toEqual({
      ok: false,
      problem: 'sale-price-not-lower',
    });
    expect(checkPartPricing({ retailPrice: 1999.99, salePrice: 2099.99, currency: 'USD' })).toEqual({
      ok: false,
      problem: 'sale-price-not-lower',
    });
  });

  it('refuses a missing or malformed currency', () => {
    for (const bad of ['usd', 'US', 'USDD', 'US$', '', ' USD', null, 840]) {
      expect(checkPartPricing({ retailPrice: 1999.99, salePrice: null, currency: bad }), String(bad)).toEqual({
        ok: false,
        problem: 'currency-invalid',
      });
    }
  });
});

describe('a price belongs to one exact SKU', () => {
  it('two SKUs of the same canonical model keep their own prices', () => {
    // The duplicate-looking "RTX 5090" rows the builder shows side by side are
    // different listings at different prices. Nothing may average, copy or
    // promote one of them to the model.
    const cheaper = part({ id: 'newegg-gpu-a', retailPrice: 1899.99 });
    const dearer = part({ id: 'newegg-gpu-b', retailPrice: 2299.99 });
    expect(cheaper.canonicalPartId).toBe(dearer.canonicalPartId);
    expect(priceView(cheaper, NOW)).toMatchObject({ displayAmount: 1899.99 });
    expect(priceView(dearer, NOW)).toMatchObject({ displayAmount: 2299.99 });
  });

  it('the displayed amount comes from the part itself, never from a sibling', () => {
    const view = priceView(part({ retailPrice: 1234.56, salePrice: null }), NOW);
    expect(view).toMatchObject({ status: 'fresh', displayAmount: 1234.56, strikeThroughAmount: null });
  });
});

describe('a sale is shown as primary only when it is real', () => {
  it('shows the sale price large and strikes the retail price through', () => {
    const view = priceView(part({ retailPrice: 1999.99, salePrice: 1799.99 }), NOW);
    expect(view).toMatchObject({ status: 'fresh', displayAmount: 1799.99, strikeThroughAmount: 1999.99 });
  });

  it('shows only the retail price when nothing is discounted', () => {
    const view = priceView(part({ salePrice: null }), NOW);
    expect(view).toMatchObject({ displayAmount: 1999.99, strikeThroughAmount: null });
  });

  it('formats money in the merchant currency, never as a bare number', () => {
    expect(formatAmount(1799.99, 'USD')).toContain('1,799.99');
    expect(formatAmount(1799.99, 'USD')).toMatch(/\$/);
  });
});

describe('a stale price is hidden, not caveated', () => {
  it('shows the price inside the freshness window', () => {
    expect(priceView(part({ fetchedAt: ago(PRICE_FRESHNESS_MS - HOUR) }), NOW).status).toBe('fresh');
  });

  it('hides the price past the window and carries no number at all', () => {
    const view = priceView(part({ fetchedAt: ago(PRICE_FRESHNESS_MS + HOUR) }), NOW);
    expect(view).toEqual({ status: 'stale', reason: 'expired' });
    // Nothing a caller could render as a price survives.
    expect(JSON.stringify(view)).not.toContain('1999');
  });

  it('refuses a future timestamp rather than treating it as fresh', () => {
    const future = new Date(NOW + 48 * HOUR).toISOString();
    expect(priceView(part({ fetchedAt: future }), NOW)).toEqual({ status: 'stale', reason: 'future-timestamp' });
  });

  it('refuses an unreadable timestamp', () => {
    expect(priceView(part({ fetchedAt: 'yesterday' }), NOW)).toEqual({ status: 'stale', reason: 'unreadable-timestamp' });
  });

  it('the fallback wording sends the shopper to the merchant and claims nothing', () => {
    expect(STALE_PRICE_LABEL).toBe('See current price at Newegg');
    for (const forbidden of [/in stock/i, /out of stock/i, /\bavailable\b/i, /unavailable/i, /sold out/i]) {
      expect(STALE_PRICE_LABEL, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it('states the evidence behind a shown price', () => {
    const view = priceView(part(), NOW);
    expect(view.status).toBe('fresh');
    if (view.status !== 'fresh') return;
    expect(formatCheckedAt(view.checkedAt)).toMatch(/^Price checked /);
    expect(formatCheckedAt(view.checkedAt)).toContain('UTC');
  });
});

describe('nothing here claims stock', () => {
  it('the availability label says only that availability is unknown', () => {
    expect(AVAILABILITY_UNKNOWN_LABEL).toBe('Availability unknown');
    for (const forbidden of [/in stock/i, /out of stock/i, /ships/i, /\bavailable now\b/i]) {
      expect(AVAILABILITY_UNKNOWN_LABEL, String(forbidden)).not.toMatch(forbidden);
    }
  });
});

describe('the build summary distinguishes a total from a partial one', () => {
  it('totals a build whose every item has a fresh verified price', () => {
    const summary = summarizeBuildPrices([part({ id: 'a', retailPrice: 100 }), part({ id: 'b', retailPrice: 250.5 })], NOW);
    expect(summary.complete).toBe(true);
    expect(summary.knownTotal).toBe(350.5);
    expect(summary.countedItems).toBe(2);
    expect(summary.excluded).toEqual([]);
    expect(subtotalLabel(summary)).toBe('Current price subtotal');
  });

  it('excludes a stale item, names it, and refuses to call the figure a total', () => {
    const summary = summarizeBuildPrices(
      [part({ id: 'fresh-one', retailPrice: 100 }), part({ id: 'stale-one', retailPrice: 900, fetchedAt: ago(PRICE_FRESHNESS_MS + HOUR) })],
      NOW,
    );
    expect(summary.complete).toBe(false);
    // The hidden item is excluded, never counted as zero: unknown is not free.
    expect(summary.knownTotal).toBe(100);
    expect(summary.countedItems).toBe(1);
    expect(summary.excluded).toEqual([{ partId: 'stale-one', reason: 'stale-price' }]);
    expect(subtotalLabel(summary)).toBe('Known-price subtotal');
  });

  it('sums nothing when selected items disagree about currency', () => {
    // Adding them would invent an exchange rate.
    const summary = summarizeBuildPrices([part({ id: 'a', currency: 'USD' }), part({ id: 'b', currency: 'CAD' })], NOW);
    expect(summary.mixedCurrency).toBe(true);
    expect(summary.complete).toBe(false);
    expect(summary.knownTotal).toBe(0);
    expect(summary.currency).toBeNull();
  });

  it('an empty build is not a complete build', () => {
    const summary = summarizeBuildPrices([], NOW);
    expect(summary.complete).toBe(false);
    expect(summary.knownTotal).toBe(0);
  });
});
