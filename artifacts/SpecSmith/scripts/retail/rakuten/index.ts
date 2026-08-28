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
import { fetchAllProductSearchPages, type ProductSearchDeps } from './client';
import { findItems, parseProductSearchXml } from './parseProductSearchXml';
import type { CatalogGpu, NeweggOffer, OfferAdmission, RejectedOffer } from './types';

const here = path.dirname(fileURLToPath(import.meta.url));
const gpuCatalogPath = path.join(here, '..', '..', '..', 'src', 'data', 'gpus.json');

/**
 * The GPU catalog, read from disk.
 *
 * Reading the shipped `src/data/gpus.json` rather than keeping a parts list of
 * its own is the point: a card the catalog does not sell is a card this adapter
 * has no business pricing.
 *
 * It supplies the parts to price and their canonical ids — NOT the matching
 * rules. `verifyGpuModel` deliberately consults only the one entry being
 * verified, so no admission decision can turn on which OTHER SKUs happen to be
 * tracked; see its memory-size doc comment for the RTX 5060 Ti case that
 * settled this.
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
  /** Total <item> elements across every page. */
  itemsSeen: number;
  /**
   * Response documents actually fetched and parsed.
   *
   * Counts what happened, not what the feed claimed: an empty result is one
   * document reporting zero pages, so this is 1 while `feedTotalPages` is 0.
   */
  pagesRead: number;
  /** The feed's own <TotalPages>. 0 for an empty result. */
  feedTotalPages: number;
  /** Rakuten's own TotalMatches, for comparison against itemsSeen. */
  totalMatches: number | null;
  /**
   * True when the feed returned no matching listing for this keyword.
   *
   * A definite, successful answer with zero offers — NOT a failure, and not
   * the same as a page whose listings were all rejected. Both show zero
   * accepted offers for different reasons.
   *
   * It says nothing about stock. The Product Search feed is a catalogue of
   * listings Rakuten publishes for this merchant, not an inventory: a part can
   * be sitting on a shelf and absent from the feed. Availability is unknown
   * here and stays unknown.
   */
  emptyResult: boolean;
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
  deps: ProductSearchDeps & { max?: number } = {},
): Promise<OfferSearchResult> {
  const keyword = keywordForGpu(gpu);
  const { pages, fetchedAt, totalMatches, totalPages, emptyResult } = await fetchAllProductSearchPages(
    { keyword, max: deps.max ?? 100 },
    deps,
  );
  const items = pages.flatMap((xml) => findItems(parseProductSearchXml(xml)));
  const { offers, rejected } = partition(admitOffers(items, gpu, fetchedAt));
  return {
    gpuId: gpu.id,
    keyword,
    fetchedAt,
    offers,
    rejected,
    itemsSeen: items.length,
    pagesRead: pages.length,
    feedTotalPages: totalPages,
    totalMatches,
    emptyResult,
  };
}

export { admitOffer, admitOffers, readCategory, readShortDescription, secondaryCategoryLeaf } from './admitOffer';
export {
  ALL_EMPTY_RESULT_VARIANTS,
  EMPTY_RESULT_OBSERVATIONS,
  ALL_PAGING_ERROR_CODES,
  assertPagingConsistent,
  OBSERVED_EMPTY_RESULT_VARIANTS,
  buildProductSearchUrl,
  classifyEmptyResult,
  fetchAllProductSearchPages,
  fetchProductSearchXml,
  MAX_PAGES_PER_SEARCH,
  readAccessToken,
  redactToken,
  RakutenAuthError,
  RakutenPagingError,
  RakutenRequestError,
  type EmptyResultVariant,
  type NotEmptyReason,
  type PagingErrorCode,
} from './client';
export { classifyListing } from './listingKind';
export { catalogMention, findGpuMentions, findMemorySizes, mentionKey, verifyGpuModel } from './gpuModelMatch';
export {
  childText,
  decodeXmlText,
  findItems,
  type XmlElement,
  parsePagingInteger,
  parseProductSearchXml,
  RakutenXmlError,
  readPageInfo,
  readPrice,
} from './parseProductSearchXml';
export * from './types';
