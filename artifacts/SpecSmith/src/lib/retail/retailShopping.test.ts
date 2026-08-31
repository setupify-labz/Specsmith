import { describe, expect, it } from 'vitest';

import catalogData from '../../../public/data/retail-parts.json';
import { parseAffiliatePartCatalog, type AffiliatePart } from './partCatalog';
import { priceView, summarizeBuildPrices } from './partPricing';
import {
  CATEGORY_GROUPS,
  EMPTY_FILTERS,
  PRODUCT_BATCH_SIZE,
  brandOf,
  brandsIn,
  canonicalIdFor,
  confidenceOf,
  filterAndSort,
  groupByCategory,
  shortenTitle,
} from './retailShopping';

import gpuData from '../../data/gpus.json';

const parsed = parseAffiliatePartCatalog(catalogData);
if (!parsed.ok) throw new Error(`published catalogue invalid: ${parsed.problem}`);
const catalog = parsed.catalog;

/** Canonical GPU ids and their editorial prices — the data that must not leak into the grid. */
const canonicalGpus = gpuData as { id: string; name: string; price_usd: number }[];

describe('the shopping grid contains retailer SKUs and nothing else', () => {
  it('every product in the grid is a Newegg SKU with its own image, link and price', () => {
    const grouped = groupByCategory(catalog.parts);
    const all = [...grouped.values()].flat();
    expect(all).toHaveLength(500);
    for (const part of all) {
      expect(part.id.startsWith('newegg-')).toBe(true);
      expect(part.merchant).toBe('Newegg');
      expect(part.imageUrl).toMatch(/^https:\/\//);
      expect(part.trackedAffiliateUrl).toMatch(/^https:\/\/(click|www)\.linksynergy\.com\//);
      expect(part.retailPrice).toBeGreaterThan(0);
    }
  });

  it('no canonical/reference part id appears in the grid', () => {
    // The exact failure being prevented: `[...canonical, ...skuParts]` used to
    // put "rtx5090" — a model, not a listing — in the product list.
    const gridIds = new Set(catalog.parts.map((part) => part.id));
    for (const canonical of canonicalGpus) {
      expect(gridIds.has(canonical.id), `${canonical.id} is a canonical model and must not be a product`).toBe(false);
    }
  });

  it('no hand-maintained price_usd value is carried by any product', () => {
    // A retail card must never render an editorial estimate as a retailer
    // price. The schema has nowhere to put one, which is checked here against
    // the real published file.
    for (const part of catalog.parts) {
      expect(Object.keys(part)).not.toContain('price_usd');
    }
    const serialized = JSON.stringify(catalog.parts);
    expect(serialized).not.toContain('price_usd');
  });

  it('grid prices never equal the canonical estimate by construction', () => {
    // Not a claim that the numbers always differ — a listing may coincidentally
    // match. It checks that the price on a card is read from the part itself,
    // so the two sources cannot be confused.
    const gpu = catalog.parts.find((part) => part.category === 'gpu');
    expect(gpu).toBeDefined();
    if (!gpu) return;
    const view = priceView(gpu, Date.parse(gpu.fetchedAt) + 1000);
    expect(view.status).toBe('fresh');
    if (view.status !== 'fresh') return;
    expect(view.displayAmount).toBe(gpu.salePrice ?? gpu.retailPrice);
  });
});

describe('multiple retailer variants of one model stay separate', () => {
  it('keeps every ASUS/MSI/ZOTAC/Gigabyte listing of a shared canonical model', () => {
    const byCanonical = new Map<string, AffiliatePart[]>();
    for (const part of catalog.parts) {
      if (!part.canonicalPartId) continue;
      const list = byCanonical.get(part.canonicalPartId) ?? [];
      list.push(part);
      byCanonical.set(part.canonicalPartId, list);
    }
    const shared = [...byCanonical.values()].filter((list) => list.length > 1);
    expect(shared.length).toBeGreaterThan(0);

    for (const variants of shared) {
      // Same model, different products: ids, titles and links must all differ.
      expect(new Set(variants.map((v) => v.id)).size).toBe(variants.length);
      expect(new Set(variants.map((v) => v.name)).size).toBe(variants.length);
      expect(new Set(variants.map((v) => v.trackedAffiliateUrl)).size).toBe(variants.length);
      // Each keeps its own price — none inherits a sibling's.
      for (const variant of variants) expect(variant.retailPrice).toBeGreaterThan(0);
    }
  });

  it('selecting one variant does not add its canonical model as a second product', () => {
    const variants = catalog.parts.filter((part) => part.canonicalPartId === 'rtx5090');
    if (variants.length === 0) return;
    const chosen = variants[0];
    // The canonical id is available for the estimator...
    expect(canonicalIdFor(chosen)).toBe('rtx5090');
    // ...but is not itself a product in the grid.
    expect(catalog.parts.some((part) => part.id === 'rtx5090')).toBe(false);
  });
});

describe('unverified products are kept and marked, never invented', () => {
  it('a SKU without a verified canonical mapping resolves to null', () => {
    const unverified = catalog.parts.find((part) => !part.specsVerified);
    expect(unverified).toBeDefined();
    if (!unverified) return;
    expect(confidenceOf(unverified)).toBe('unverified');
    expect(canonicalIdFor(unverified)).toBeNull();
  });

  it('GPU listings carry a verified mapping, peripherals generally do not', () => {
    const gpus = catalog.parts.filter((part) => part.category === 'gpu');
    expect(gpus.every((part) => confidenceOf(part) === 'verified')).toBe(true);
    const keyboards = catalog.parts.filter((part) => part.category === 'keyboard');
    expect(keyboards.every((part) => confidenceOf(part) === 'unverified')).toBe(true);
  });
});

describe('category navigation covers the catalogue exactly once', () => {
  it('the three groups list all twelve categories with no repeats', () => {
    const listed = CATEGORY_GROUPS.flatMap((group) => group.categories);
    expect(listed).toHaveLength(12);
    expect(new Set(listed).size).toBe(12);
    expect(CATEGORY_GROUPS.map((group) => group.label)).toEqual([
      'Core components',
      'Power and cooling',
      'Peripherals',
    ]);
  });

  it('every catalogue category appears in the navigation', () => {
    const listed = new Set(CATEGORY_GROUPS.flatMap((group) => group.categories));
    for (const part of catalog.parts) expect(listed.has(part.category)).toBe(true);
  });

  it('grouping shows one category at a time and counts each product once', () => {
    const grouped = groupByCategory(catalog.parts);
    const total = [...grouped.values()].reduce((sum, list) => sum + list.length, 0);
    expect(total).toBe(500);
    expect(grouped.get('gpu')?.every((part) => part.category === 'gpu')).toBe(true);
  });
});

describe('search, filters and sorting', () => {
  const gpus = groupByCategory(catalog.parts).get('gpu') ?? [];

  it('matches every search term against the title in any order', () => {
    const results = filterAndSort(gpus, { ...EMPTY_FILTERS, search: 'rtx 5090' });
    expect(results.length).toBeGreaterThan(0);
    for (const part of results) {
      const name = part.name.toLowerCase();
      expect(name).toContain('rtx');
      expect(name).toContain('5090');
    }
  });

  it('filters by brand and by price range', () => {
    const brands = brandsIn(gpus);
    expect(brands.length).toBeGreaterThan(1);
    const brand = brands[0];
    const byBrand = filterAndSort(gpus, { ...EMPTY_FILTERS, brands: [brand] });
    expect(byBrand.every((part) => brandOf(part) === brand)).toBe(true);

    const capped = filterAndSort(gpus, { ...EMPTY_FILTERS, maxPrice: 800 });
    expect(capped.every((part) => (part.salePrice ?? part.retailPrice) <= 800)).toBe(true);
  });

  it('sorts by price in both directions and by name', () => {
    const asc = filterAndSort(gpus, { ...EMPTY_FILTERS, sort: 'price-asc' });
    const amounts = asc.map((part) => part.salePrice ?? part.retailPrice);
    expect([...amounts].sort((a, b) => a - b)).toEqual(amounts);

    const desc = filterAndSort(gpus, { ...EMPTY_FILTERS, sort: 'price-desc' });
    expect(desc[0].salePrice ?? desc[0].retailPrice).toBeGreaterThanOrEqual(asc[0].salePrice ?? asc[0].retailPrice);

    const byName = filterAndSort(gpus, { ...EMPTY_FILTERS, sort: 'name' });
    expect(byName.map((p) => p.name)).toEqual([...byName.map((p) => p.name)].sort((a, b) => a.localeCompare(b)));
  });
});

describe('batching', () => {
  it('shows about two dozen products first and reveals the rest in batches', () => {
    const gpus = groupByCategory(catalog.parts).get('gpu') ?? [];
    expect(gpus.length).toBeGreaterThan(PRODUCT_BATCH_SIZE);
    expect(PRODUCT_BATCH_SIZE).toBeGreaterThanOrEqual(20);
    expect(PRODUCT_BATCH_SIZE).toBeLessThanOrEqual(24);

    const first = gpus.slice(0, PRODUCT_BATCH_SIZE);
    expect(first).toHaveLength(PRODUCT_BATCH_SIZE);
    const second = gpus.slice(0, PRODUCT_BATCH_SIZE * 2);
    expect(second.length).toBeGreaterThan(first.length);
    // The second batch is a superset — "Load more" adds, never reshuffles.
    expect(second.slice(0, PRODUCT_BATCH_SIZE)).toEqual(first);
  });
});

describe('titles are shortened for display without being lost', () => {
  it('trims a long merchant title and marks the elision', () => {
    const long = catalog.parts.find((part) => part.name.length > 80);
    expect(long).toBeDefined();
    if (!long) return;
    const short = shortenTitle(long.name);
    expect(short.length).toBeLessThanOrEqual(69);
    expect(short.endsWith('…')).toBe(true);
    // The complete title is still the source, kept for the accessible name.
    expect(long.name.startsWith(short.replace('…', '').trim())).toBe(true);
  });

  it('leaves a short title untouched', () => {
    expect(shortenTitle('ASUS RTX 5070')).toBe('ASUS RTX 5070');
  });
});

describe('the build summary uses the exact selected SKU', () => {
  it('keeps the chosen listing and its own price', () => {
    const gpus = groupByCategory(catalog.parts).get('gpu') ?? [];
    const chosen = gpus[0];
    const now = Date.parse(chosen.fetchedAt) + 60_000;
    const summary = summarizeBuildPrices([chosen], now);
    expect(summary.complete).toBe(true);
    expect(summary.knownTotal).toBe(chosen.salePrice ?? chosen.retailPrice);
    expect(summary.currency).toBe(chosen.currency);
  });

  it('never substitutes an editorial estimate when a price is hidden', () => {
    const gpus = groupByCategory(catalog.parts).get('gpu') ?? [];
    const chosen = gpus.find((part) => part.canonicalPartId === 'rtx5090') ?? gpus[0];
    // Far past the freshness window.
    const now = Date.parse(chosen.fetchedAt) + 40 * 60 * 60 * 1000;
    const summary = summarizeBuildPrices([chosen], now);

    expect(summary.complete).toBe(false);
    expect(summary.knownTotal).toBe(0);
    expect(summary.excluded).toEqual([{ partId: chosen.id, reason: 'stale-price' }]);

    // The canonical estimate for the same model is NOT used as a fallback.
    const canonical = canonicalGpus.find((gpu) => gpu.id === chosen.canonicalPartId);
    if (canonical) expect(summary.knownTotal).not.toBe(canonical.price_usd);
  });
});
