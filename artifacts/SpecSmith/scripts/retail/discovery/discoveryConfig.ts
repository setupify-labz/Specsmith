// Which feed searches discovery runs (issue #192).
//
// The twelve builder categories reuse the published catalogue's own keyword
// and category-leaf pairs (catalogConfig.ts), observed from the live feed on
// 2026-08-29, so discovery looks exactly where the catalogue already shops.
//
// FANS ARE NEW. The leaf below is the cooling leaf the CPU-cooler search
// already lands in; it has NOT been observed for case-fan listings
// specifically. A wrong leaf cannot stage anything wrong — admission requires
// the exact leaf — it can only stage nothing, and the run report records a
// zero for the category so that is visible rather than silent.

import { RETAIL_CATEGORY_CONFIG } from '../catalog/catalogConfig';
import type { RetailPartCategory } from '../../../src/lib/retail/partCatalog';

export type DiscoveryCategory = RetailPartCategory | 'fan';

export interface DiscoverySearch {
  category: DiscoveryCategory;
  keyword: string;
  categoryLeaf: string;
  /** True only for a leaf observed on the live feed for this category. */
  leafObserved: boolean;
}

export const DISCOVERY_SEARCHES: readonly DiscoverySearch[] = [
  ...RETAIL_CATEGORY_CONFIG.map((config) => ({
    category: config.category as DiscoveryCategory,
    keyword: config.keyword,
    categoryLeaf: config.categoryLeaf,
    leafObserved: true,
  })),
  { category: 'fan', keyword: 'case fan', categoryLeaf: 'Computer System Cooling Parts', leafObserved: false },
];

/** Listings requested per search. One page keeps a run within the feed's rate limits. */
export const DISCOVERY_PAGE_SIZE = 100;
