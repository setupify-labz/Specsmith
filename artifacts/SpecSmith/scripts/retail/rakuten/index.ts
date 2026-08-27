// Server-only entry point: catalog GPU -> verified Newegg offers.
//
//   import { fetchNeweggOffersForGpu } from './scripts/retail/rakuten';
//
// Composes the four pieces — client (token), parser (XML), listingKind +
// gpuModelMatch (admission) — and adds nothing of its own beyond the catalog
// read and the keyword. Everything below the client is pure, so the whole
// pipeline can be exercised against the fixtures without a network.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPartQuery } from '../../../src/lib/fps';
import { admitOffers } from './admitOffer';
import { fetchProductSearchXml, type ProductSearchDeps } from './client';
import { findItems, parseProductSearchXml } from './parseProductSearchXml';
import type { CatalogGpu, NeweggOffer, OfferAdmission, RejectedOffer } from './types';

const here = path.dirname(fileURLToPath(import.meta.url));
const gpuCatalogPath = path.join(here, '..', '..', '..', 'src', 'data', 'gpus.json');

/**
 * The GPU catalog, read from disk.
 *
 * Reading the shipped `src/data/gpus.json` rather than keeping a parts list of
 * its own is the point: a card the catalog does not sell is a card this adapter
 * has no business pricing, and a catalog rename or a new size-split SKU changes
 * the matcher's behaviour on the next run with no second list to update.
 */
export function loadGpuCatalog(file: string = gpuCatalogPath): CatalogGpu[] {
  const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'));
  if (!Array.isArray(raw)) throw new Error(`${file} is not an array of GPU entries.`);
  return raw.map((e) => {
    const g = e as Partial<CatalogGpu>;
    if (typeof g.id !== 'string' || typeof g.name !== 'string' || typeof g.brand !== 'string' || typeof g.vram_gb !== 'number') {
      throw new Error(`Malformed GPU catalog entry: ${JSON.stringify(e)}`);
    }
    return { id: g.id, name: g.name, brand: g.brand, vram_gb: g.vram_gb };
  });
}

/**
 * The search keyword for a catalog part.
 *
 * Reuses `src/lib/fps.ts`'s buildPartQuery — the same function that builds the
 * on-site Amazon/Newegg search links — rather than growing a second, silently
 * diverging idea of how a part should be spelled to a retailer. That function
 * is pure and browser-safe, so importing it here costs nothing and keeps one
 * definition of "how SpecSmith names this part to a shop".
 */
export function keywordForGpu(gpu: CatalogGpu): string {
  return buildPartQuery(gpu.name, gpu.brand, 'gpu');
}

export interface OfferSearchResult {
  gpuId: string;
  keyword: string;
  fetchedAt: string;
  /** Listings that passed every gate. */
  offers: NeweggOffer[];
  /** Listings that did not, each with the first gate it failed. Never discarded. */
  rejected: RejectedOffer[];
  /** Total <item> elements in the response. */
  itemsSeen: number;
}

/** Splits a mixed admission list. */
export function partition(admissions: readonly OfferAdmission[]): { offers: NeweggOffer[]; rejected: RejectedOffer[] } {
  return {
    offers: admissions.filter((a): a is NeweggOffer => a.status === 'accepted'),
    rejected: admissions.filter((a): a is RejectedOffer => a.status === 'rejected'),
  };
}

/**
 * Fetches and verifies Newegg offers for one catalog GPU.
 *
 * Rejections are RETURNED, not logged and dropped. A run that admits 2 of 40
 * listings is either a well-behaved filter or a broken matcher, and the only
 * way to tell them apart is to be able to read the 38 reasons.
 */
export async function fetchNeweggOffersForGpu(
  gpu: CatalogGpu,
  catalog: readonly CatalogGpu[],
  deps: ProductSearchDeps & { max?: number } = {},
): Promise<OfferSearchResult> {
  const keyword = keywordForGpu(gpu);
  const { xml, fetchedAt } = await fetchProductSearchXml({ keyword, max: deps.max ?? 100 }, deps);
  const items = findItems(parseProductSearchXml(xml));
  const { offers, rejected } = partition(admitOffers(items, gpu, catalog, fetchedAt));
  return { gpuId: gpu.id, keyword, fetchedAt, offers, rejected, itemsSeen: items.length };
}

export { admitOffer, admitOffers, readCategory } from './admitOffer';
export { buildProductSearchUrl, fetchProductSearchXml, readAccessToken, redactToken, RakutenAuthError, RakutenRequestError } from './client';
export { classifyListing } from './listingKind';
export { catalogMention, findGpuMentions, findMemorySizes, mentionKey, requiresExplicitMemorySize, verifyGpuModel } from './gpuModelMatch';
export { childText, decodeXmlText, findItems, parseProductSearchXml, RakutenXmlError, readPrice } from './parseProductSearchXml';
export * from './types';
