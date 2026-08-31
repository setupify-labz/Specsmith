// The shopping catalogue's rules, with no React in them.
//
// BROWSER-SAFE AND PURE. Search, filters, sorting, batching and the category
// grouping all live here so they can be tested directly, without mounting a
// component or waiting for a fetch.
//
// THE RULE THIS FILE EXISTS TO ENFORCE
// ------------------------------------
// When the affiliate catalogue loads, the shopping grid shows EXACTLY the
// retailer SKUs in it and nothing else. The old canonical arrays — gpus.json
// and friends — never enter it. They carry a hand-maintained `price_usd`, a
// `/images/gpus/*.png` placeholder and no tracked link, so a canonical row
// beside a real listing reads as a cheaper, worse-looking version of the same
// card. That is what produced the "RTX 5090 — $3,979" row.
//
// This is NOT a rule against duplicates. ASUS, MSI, ZOTAC and Gigabyte
// versions of one GPU are four different things a person can buy at four
// different prices, and all four belong in the grid with their own images,
// titles and prices. What may not appear is the abstract model alongside them.
//
// CANONICAL PARTS STILL MATTER — INTERNALLY
// -----------------------------------------
// They remain the source of FPS estimates, compatibility rules, specifications
// and legacy saved-build migration. Selecting a SKU resolves to its canonical
// model through `canonicalPartId` when the catalogue verified one. That
// resolution happens in the builder, never in the grid, so the canonical part
// can inform an estimate without ever becoming a second selectable product.
//
// A SKU with no verified mapping keeps its place in the grid and is marked
// unverified. The mapping is never guessed.

import type { AffiliatePart, RetailPartCategory } from './partCatalog';

/** How the navigation is grouped. Order is the order shown. */
export interface CategoryGroup {
  label: string;
  categories: RetailPartCategory[];
}

export const CATEGORY_GROUPS: readonly CategoryGroup[] = [
  { label: 'Core components', categories: ['gpu', 'cpu', 'motherboard', 'ram', 'storage'] },
  { label: 'Power and cooling', categories: ['psu', 'case', 'cooler'] },
  { label: 'Peripherals', categories: ['monitor', 'keyboard', 'mouse', 'headset'] },
];

export const CATEGORY_LABELS: Readonly<Record<RetailPartCategory, string>> = {
  gpu: 'Graphics card',
  cpu: 'Processor',
  motherboard: 'Motherboard',
  ram: 'Memory',
  storage: 'Storage',
  psu: 'Power supply',
  case: 'Case',
  cooler: 'CPU cooler',
  monitor: 'Monitor',
  keyboard: 'Keyboard',
  mouse: 'Mouse',
  headset: 'Headset',
};

/** Short label for the mobile chip row, where horizontal space is the constraint. */
export const CATEGORY_SHORT_LABELS: Readonly<Record<RetailPartCategory, string>> = {
  gpu: 'GPU',
  cpu: 'CPU',
  motherboard: 'Board',
  ram: 'RAM',
  storage: 'Storage',
  psu: 'PSU',
  case: 'Case',
  cooler: 'Cooler',
  monitor: 'Monitor',
  keyboard: 'Keyboard',
  mouse: 'Mouse',
  headset: 'Headset',
};

/** Products added per batch. One screenful plus a little, then "Load more". */
export const PRODUCT_BATCH_SIZE = 24;

/**
 * Groups the catalogue by category.
 *
 * Takes AffiliatePart[] and returns AffiliatePart[] — there is no parameter
 * through which a canonical part could arrive, which is how "retail only" is
 * enforced rather than remembered.
 */
export function groupByCategory(parts: readonly AffiliatePart[]): Map<RetailPartCategory, AffiliatePart[]> {
  const grouped = new Map<RetailPartCategory, AffiliatePart[]>();
  for (const part of parts) {
    const list = grouped.get(part.category);
    if (list) list.push(part);
    else grouped.set(part.category, [part]);
  }
  return grouped;
}

/**
 * The manufacturer, read from the first word of the merchant's title.
 *
 * Deliberately shallow. A brand filter is a convenience, and a clever
 * normalizer that mapped "GIGABYTE AORUS" onto some canonical vendor list
 * would be inventing product knowledge the feed did not give us.
 */
export function brandOf(part: AffiliatePart): string {
  const first = part.name.trim().split(/\s+/)[0] ?? '';
  return first.replace(/[^A-Za-z0-9-]/g, '');
}

/** Every brand present, most common first, then alphabetical. */
export function brandsIn(parts: readonly AffiliatePart[]): string[] {
  const counts = new Map<string, number>();
  for (const part of parts) {
    const brand = brandOf(part);
    if (brand) counts.set(brand, (counts.get(brand) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([brand]) => brand);
}

/** The amount a shopper would pay, for sorting and range filtering. */
export const effectiveAmount = (part: AffiliatePart): number => part.salePrice ?? part.retailPrice;

export type ProductSort = 'price-asc' | 'price-desc' | 'name';

export interface CatalogFilters {
  search: string;
  brands: readonly string[];
  minPrice: number | null;
  maxPrice: number | null;
  sort: ProductSort;
}

export const EMPTY_FILTERS: CatalogFilters = {
  search: '',
  brands: [],
  minPrice: null,
  maxPrice: null,
  sort: 'price-asc',
};

/**
 * Applies search, brand and price filters, then sorts.
 *
 * Search matches every whitespace-separated term against the title, so
 * "asus 5090" finds an ASUS RTX 5090 without the shopper having to guess the
 * merchant's word order.
 */
export function filterAndSort(parts: readonly AffiliatePart[], filters: CatalogFilters): AffiliatePart[] {
  const terms = filters.search.toLowerCase().split(/\s+/).filter(Boolean);
  const brands = new Set(filters.brands);

  const matched = parts.filter((part) => {
    const haystack = part.name.toLowerCase();
    if (!terms.every((term) => haystack.includes(term))) return false;
    if (brands.size > 0 && !brands.has(brandOf(part))) return false;
    const amount = effectiveAmount(part);
    if (filters.minPrice !== null && amount < filters.minPrice) return false;
    if (filters.maxPrice !== null && amount > filters.maxPrice) return false;
    return true;
  });

  const sorted = [...matched];
  switch (filters.sort) {
    case 'price-asc':
      sorted.sort((a, b) => effectiveAmount(a) - effectiveAmount(b) || a.name.localeCompare(b.name));
      break;
    case 'price-desc':
      sorted.sort((a, b) => effectiveAmount(b) - effectiveAmount(a) || a.name.localeCompare(b.name));
      break;
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }
  return sorted;
}

/**
 * A merchant title trimmed for the card, with the full one kept for the reader.
 *
 * Newegg titles repeat the model three times and end in a part number. The
 * card shows a readable prefix; the COMPLETE title stays available as the
 * element's accessible name and title attribute, so nothing is hidden from a
 * screen reader or from someone checking they have the right card.
 */
export function shortenTitle(name: string, maxLength = 68): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  const cut = clean.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * How confident the builder may be about a SKU's performance and fit.
 *
 * 'verified' means the catalogue linked this listing to a canonical part whose
 * specifications SpecSmith already holds. 'unverified' means it did not, which
 * is a normal outcome for a keyboard or a case — it is stated on the card
 * rather than papered over, and never guessed from the title.
 */
export type SpecConfidence = 'verified' | 'unverified';

export const confidenceOf = (part: AffiliatePart): SpecConfidence =>
  part.specsVerified && part.canonicalPartId !== null ? 'verified' : 'unverified';

/** The canonical part a SKU maps to, or null. Used for estimates, never for display as a product. */
export const canonicalIdFor = (part: AffiliatePart): string | null =>
  confidenceOf(part) === 'verified' ? part.canonicalPartId : null;

export const UNVERIFIED_NOTICE =
  'Performance and compatibility are unverified for this exact product.';
