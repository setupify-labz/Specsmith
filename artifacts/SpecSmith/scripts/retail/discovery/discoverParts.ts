// Turns raw feed listings into a STAGED review queue (issue #192).
//
// Nothing here publishes. A staged candidate is a lead for a human reviewer:
// it is never written to src/data or public/data, and it cannot be
// recommended, because recommendation eligibility fails closed on the audited
// ledger (issue #190).
//
// THE SAME GATES AS THE PUBLISHED CATALOGUE, minus pricing. Merchant, exact
// category leaf, non-new condition, tracked-link shape and title/destination
// identity conflicts are checked exactly as admitAffiliatePart checks them.
// Price is deliberately not part of a staged record: an observed feed price is
// not a verified offer (issue #194), and a staging file is the wrong place for
// a number someone might later mistake for one.
//
// DEDUPLICATION IS EXACT OR NOT AT ALL. Listings merge only when they share a
// UPC (the one manufacturer-assigned identifier the feed carries) AND their
// titles do not disagree about model or capacity. A shared UPC with
// disagreeing titles is not merged: it goes to `ambiguous` for a person to
// resolve. Without a UPC a listing stands alone, keyed by its retailer SKU —
// prefer no match over a guessed one (CLAUDE.md).

import { isTrackedAffiliateUrl } from '../../../src/lib/retail/offerSnapshot';
import { detectIdentityConflict } from '../../../src/lib/retail/identityConflict';
import { childText, type XmlElement } from '../rakuten/parseProductSearchXml';
import { readCategory, readShortDescription } from '../rakuten/admitOffer';
import { classifyListing, classifyListingCondition } from '../rakuten/listingKind';
import { findGpuMentions, mentionKey, verifyGpuModel } from '../rakuten/gpuModelMatch';
import { NEWEGG_MID, type CatalogGpu } from '../rakuten/types';
import { isSelectableBuilderPart, normalizeCatalogName, readUpc } from '../catalog/affiliateCatalog';
import { resolveCpuIdentity, type CanonicalCpuLike } from '../catalog/cpuIdentityBinding';
import type { RetailPartCategory } from '../../../src/lib/retail/partCatalog';
import type { DiscoveryCategory, DiscoverySearch } from './discoveryConfig';
import { classifyGeneration, GENERATION_ORDER, type GenerationVerdict } from './generation';

export const STAGING_SCHEMA_VERSION = 1;

export type DiscoveryRejection =
  | 'merchant'
  | 'category'
  | 'required-field'
  | 'condition'
  | 'kind'
  | 'url'
  | 'identity-conflict';

export interface DiscoveredListing {
  category: DiscoveryCategory;
  retailer: 'Newegg';
  retailerSku: string;
  title: string;
  upc: string | null;
  trackedAffiliateUrl: string;
  imageUrl: string | null;
  capturedAt: string;
  search: { keyword: string; categoryLeaf: string };
}

export type CanonicalProposal =
  | { status: 'proposed'; canonicalId: string; basis: string }
  | { status: 'none'; basis: string }
  | { status: 'ambiguous'; candidates: string[]; basis: string };

export interface StagedCandidate {
  status: 'staged';
  dedupeKey: string;
  identifier: 'upc' | 'retailer-sku-only';
  category: DiscoveryCategory;
  title: string;
  upc: string | null;
  generation: GenerationVerdict;
  canonical: CanonicalProposal;
  /** Every listing merged under this key (one unless several share a UPC). */
  listings: DiscoveredListing[];
}

export interface AmbiguousGroup {
  dedupeKey: string;
  reason: 'upc-title-conflict';
  detail: string;
  listings: DiscoveredListing[];
}

export interface CatalogContext {
  gpus: readonly CatalogGpu[];
  cpus: readonly CanonicalCpuLike[];
}

const FAN_INCLUDE = /\b(case fan|pc fan|cooling fan|computer fan|chassis fan|\d{2,3}\s?mm fan|fan\b.*\b(120|140|92|80|200)\s?mm)\b/;
const FAN_EXCLUDE = /\b(cpu cooler|aio|liquid|laptop|notebook|fan controller|fan hub|splitter|cable|grill|filter|replacement blade|desk fan|ceiling)\b/;

export function isFanListing(title: string): boolean {
  const t = normalizeCatalogName(title).replace(/(\d+) mm/g, '$1mm');
  return FAN_INCLUDE.test(t) && !FAN_EXCLUDE.test(t);
}

/** The builder-kind gate, per category. GPUs use the stricter GPU listing classifier. */
function isPartOfKind(category: DiscoveryCategory, title: string, description: string): boolean {
  if (category === 'fan') return isFanListing(title);
  if (category === 'gpu') return classifyListing(title, description).issue === null && findGpuMentions(title).length > 0;
  return isSelectableBuilderPart(category as RetailPartCategory, title);
}

export function admitDiscoveredListing(
  item: XmlElement,
  search: DiscoverySearch,
  capturedAt: string,
): { status: 'accepted'; listing: DiscoveredListing } | { status: 'rejected'; reason: DiscoveryRejection } {
  if (childText(item, 'mid') !== NEWEGG_MID) return { status: 'rejected', reason: 'merchant' };
  if (readCategory(item).secondaryLeaf !== search.categoryLeaf) return { status: 'rejected', reason: 'category' };

  const sku = childText(item, 'sku');
  const title = childText(item, 'productname');
  const trackedAffiliateUrl = childText(item, 'linkurl');
  if (!sku || !title || !trackedAffiliateUrl) return { status: 'rejected', reason: 'required-field' };
  if (classifyListingCondition(title).issue) return { status: 'rejected', reason: 'condition' };
  if (!isPartOfKind(search.category, title, readShortDescription(item) ?? '')) return { status: 'rejected', reason: 'kind' };
  if (!isTrackedAffiliateUrl(trackedAffiliateUrl)) return { status: 'rejected', reason: 'url' };
  if (detectIdentityConflict(title, trackedAffiliateUrl)) return { status: 'rejected', reason: 'identity-conflict' };

  const imageUrl = childText(item, 'imageurl');
  return {
    status: 'accepted',
    listing: {
      category: search.category,
      retailer: 'Newegg',
      retailerSku: sku,
      title,
      upc: readUpc(childText(item, 'upccode')),
      trackedAffiliateUrl,
      imageUrl: imageUrl && /^https:\/\//.test(imageUrl) ? imageUrl : null,
      capturedAt,
      search: { keyword: search.keyword, categoryLeaf: search.categoryLeaf },
    },
  };
}

/** UPC-A (12) and EAN-13 (13) forms of one code differ only by leading zeros. */
export function normalizeUpc(upc: string): string {
  return upc.replace(/^0+/, '') || '0';
}

/** Facts two titles must agree on to be the same product: GPU model and capacities. */
interface IdentityFacts {
  models: string;
  capacities: string;
}

function identityFacts(title: string): IdentityFacts {
  const models = findGpuMentions(title).map(mentionKey).sort().join(',');
  const capacities = [...new Set([...title.matchAll(/\b(\d{1,4})\s?(GB|TB)\b/gi)].map((m) => `${m[1]}${m[2].toUpperCase()}`))].sort().join(',');
  return { models, capacities };
}

/**
 * Two titles disagree only when BOTH state a fact and state it differently.
 * A title that omits the capacity is silent, not contradictory: sellers of
 * the same UPC often differ only in how much they write.
 */
function titlesDisagree(a: IdentityFacts, b: IdentityFacts): boolean {
  const differs = (x: string, y: string) => x !== '' && y !== '' && x !== y;
  return differs(a.models, b.models) || differs(a.capacities, b.capacities);
}

export function proposeCanonical(listing: DiscoveredListing, context: CatalogContext, shortDescription = ''): CanonicalProposal {
  if (listing.category === 'gpu') {
    const matches = context.gpus
      .filter((gpu) => verifyGpuModel({ productName: listing.title, shortDescription }, gpu).ok)
      .map((gpu) => gpu.id);
    if (matches.length === 1) return { status: 'proposed', canonicalId: matches[0], basis: 'verifyGpuModel: model, suffix and capacity agree' };
    if (matches.length > 1) return { status: 'ambiguous', candidates: matches, basis: 'verifyGpuModel matched more than one catalogue GPU' };
    return { status: 'none', basis: 'no catalogue GPU verified against this title (possibly a new model)' };
  }
  if (listing.category === 'cpu') {
    const outcome = resolveCpuIdentity(
      { retailPartId: `staged-${listing.retailerSku}`, name: listing.title, trackedAffiliateUrl: listing.trackedAffiliateUrl },
      context.cpus,
    );
    return outcome.bound
      ? { status: 'proposed', canonicalId: outcome.canonicalCpuId, basis: 'reviewed CPU identity binding' }
      : { status: 'none', basis: `no reviewed CPU identity binding (${outcome.refusal})` };
  }
  return { status: 'none', basis: 'no canonical matcher for this category yet' };
}

export interface StagingRun {
  candidates: StagedCandidate[];
  ambiguous: AmbiguousGroup[];
}

/**
 * Deduplicates accepted listings and orders the review queue.
 * `descriptions` maps retailer SKU to the listing's short description, which
 * the GPU matcher reads for memory capacity.
 */
export function stageListings(
  listings: readonly DiscoveredListing[],
  context: CatalogContext,
  descriptions: ReadonlyMap<string, string> = new Map(),
): StagingRun {
  // The same retailer SKU seen twice (e.g. on two searches) is one listing.
  const bySku = new Map<string, DiscoveredListing>();
  for (const listing of listings) if (!bySku.has(listing.retailerSku)) bySku.set(listing.retailerSku, listing);

  const groups = new Map<string, DiscoveredListing[]>();
  for (const listing of bySku.values()) {
    const key = listing.upc ? `upc:${normalizeUpc(listing.upc)}` : `sku:${listing.retailerSku}`;
    groups.set(key, [...(groups.get(key) ?? []), listing]);
  }

  const candidates: StagedCandidate[] = [];
  const ambiguous: AmbiguousGroup[] = [];
  for (const [dedupeKey, group] of groups) {
    const facts = group.map((listing) => identityFacts(listing.title));
    const categories = new Set(group.map((listing) => listing.category));
    const conflict = facts.some((a, i) => facts.slice(i + 1).some((b) => titlesDisagree(a, b)));
    if (conflict || categories.size > 1) {
      ambiguous.push({
        dedupeKey,
        reason: 'upc-title-conflict',
        detail: 'Listings share a UPC but their titles disagree about category, model or capacity; not merged.',
        listings: group,
      });
      continue;
    }
    const first = group[0];
    candidates.push({
      status: 'staged',
      dedupeKey,
      identifier: first.upc ? 'upc' : 'retailer-sku-only',
      category: first.category,
      title: first.title,
      upc: first.upc,
      generation: classifyGeneration(first.category, first.title),
      canonical: proposeCanonical(first, context, descriptions.get(first.retailerSku) ?? ''),
      listings: group,
    });
  }

  const rank = (c: StagedCandidate) => GENERATION_ORDER.indexOf(c.generation.tier);
  candidates.sort((a, b) => rank(a) - rank(b) || a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  ambiguous.sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));
  return { candidates, ambiguous };
}

export interface SearchReport {
  category: DiscoveryCategory;
  keyword: string;
  categoryLeaf: string;
  leafObserved: boolean;
  outcome: 'ok' | 'request-failed';
  listingsSeen: number;
  accepted: number;
  rejected: Partial<Record<DiscoveryRejection, number>>;
}

export interface StagingFile {
  schemaVersion: typeof STAGING_SCHEMA_VERSION;
  /** Fixed marker: a staging file is never a publishable catalogue. */
  publication: 'staged-not-published';
  source: 'rakuten-linkshare-newegg';
  generatedAt: string;
  searches: SearchReport[];
  candidates: StagedCandidate[];
  ambiguous: AmbiguousGroup[];
}
