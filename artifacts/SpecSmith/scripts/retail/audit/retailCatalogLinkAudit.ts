// Audits every part in the published affiliate catalog (`retail-parts.json`)
// for link exactness and attribution.
//
// This is the ONE place in the repository where a purchase link is meant to
// already be exact — every part's `trackedAffiliateUrl` is a Rakuten-tracked
// deep link the network generated for one specific Newegg SKU (see
// `AffiliatePart` in `src/lib/retail/partCatalog.ts`). This module checks
// that promise rather than assuming it: it decodes the tracked link's `murl`
// destination and compares its `item=` id against the SKU embedded in the
// part's own `id`, which is exactly the check that would catch a listing
// whose tracked link had been swapped or mismatched from its catalog entry.

import type { AffiliatePart, AffiliatePartCatalog } from '../../../src/lib/retail/partCatalog';
import { classifyTrackedNeweggUrl } from './linkIntegrity';
import { statusFor, type LinkAuditRow } from './linkAuditReport';

/**
 * Recovers the Newegg item id a catalog part's own id was derived from.
 *
 * `affiliateCatalog.ts`'s `safeId` builds the id as
 * `newegg-{category}-{sku.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`. Every
 * real Newegg SKU seen in this feed (e.g. `N82E16814932765`) is already pure
 * alphanumeric, so lower-casing round-trips cleanly; a part id that does not
 * match this shape at all returns null rather than a guessed id.
 */
export function expectedItemIdFromPartId(partId: string, category: string): string | null {
  const prefix = `newegg-${category}-`;
  if (!partId.startsWith(prefix)) return null;
  const suffix = partId.slice(prefix.length);
  if (suffix === '' || !/^[a-z0-9-]+$/.test(suffix)) return null;
  return suffix.toUpperCase();
}

export function auditCatalogPartLink(part: AffiliatePart): LinkAuditRow {
  if (part.id.trim() === '' || part.name.trim() === '') {
    return {
      partId: part.id || '(missing id)',
      intendedProduct: part.name || '(missing name)',
      source: 'retail-parts-catalog',
      category: part.category,
      retailer: 'Newegg',
      urlType: 'unverifiable',
      attributed: false,
      evidence: 'no-intended-identity',
      // No usable id at all — there is nothing to be self-consistent WITH.
      identityEvidence: 'shape-only',
      priceSource: 'retailer-feed',
      status: 'fail',
    };
  }

  const expectedItemId = expectedItemIdFromPartId(part.id, part.category);
  const classification = classifyTrackedNeweggUrl(part.trackedAffiliateUrl, expectedItemId ?? undefined);

  return {
    partId: part.id,
    intendedProduct: part.name,
    source: 'retail-parts-catalog',
    category: part.category,
    retailer: 'Newegg',
    ...classification,
    // Checked against `part.id` — reconstructed from the SAME upstream
    // listing as the link itself, so this is self-consistency, not
    // independent verification. See the caveat in `linkIntegrity.ts`'s
    // module doc and `LinkIdentityEvidence` in `linkAuditReport.ts`.
    identityEvidence: expectedItemId !== null ? 'self-consistent' : 'shape-only',
    // The merchant's own listing price, stamped with `part.fetchedAt` — see `AffiliatePart` in partCatalog.ts.
    priceSource: 'retailer-feed',
    status: statusFor(classification.urlType, classification.attributed),
  };
}

export function auditRetailPartsCatalog(catalog: AffiliatePartCatalog): LinkAuditRow[] {
  return catalog.parts.map(auditCatalogPartLink);
}
