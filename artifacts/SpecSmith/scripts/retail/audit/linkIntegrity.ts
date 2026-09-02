// Classifies a single purchase-link URL against a closed set of outcomes.
//
// PURE. No I/O, no fetch, no credential, no clock. Every classifier here
// decides from the URL's own shape — host, path, query — never by asking the
// retailer. That is what lets this run in CI with no API key: it cannot tell
// you a listing is in stock or still on sale, but it can tell you, today and
// deterministically, whether a link even POINTS AT a specific product versus
// a search box, and whether it carries the attribution that makes a click
// worth anything.
//
// WHAT THIS FILE MAY NOT DO
// --------------------------
// Never widen a classification by guessing. A URL this code cannot place
// confidently is 'ambiguous' or 'unverifiable', not 'exact' — a wrong variant
// shown as correct is worse than an honest "we don't know" (see the module
// doc on the CLI for why this fails closed).

import { TRACKED_LINK_HOSTS } from '../../../src/lib/retail/offerSnapshot';

export type LinkUrlType =
  /** Resolves to one specific product page for the intended item. */
  | 'exact'
  /** A retailer search/listing page — the right product is *likely* the top result, never guaranteed. */
  | 'fallback-search'
  /** No URL was supplied at all. */
  | 'missing'
  /** Present but not a parseable URL, or a tracked link whose destination does not parse. */
  | 'malformed'
  /** Points somewhere other than the expected retailer, including a nested redirector. */
  | 'wrong-domain'
  /** A shape this classifier does not recognize as either a product page or a search page. */
  | 'ambiguous'
  /** The destination could not be checked at all (e.g. no intended-product identity to compare against). */
  | 'unverifiable';

export const ALL_LINK_URL_TYPES: readonly LinkUrlType[] = [
  'exact',
  'fallback-search',
  'missing',
  'malformed',
  'wrong-domain',
  'ambiguous',
  'unverifiable',
];

/** Closed reasons a classification was reached. Never free text — see the module doc. */
export type LinkEvidence =
  | 'no-url-supplied'
  | 'url-does-not-parse'
  | 'not-https'
  | 'host-not-allowed'
  | 'host-looks-like-nested-redirector'
  | 'tracked-link-missing-destination-param'
  | 'tracked-link-destination-does-not-parse'
  | 'tracked-link-destination-wrong-host'
  | 'tracked-link-missing-affiliate-ids'
  | 'search-path-shape'
  | 'product-path-shape'
  | 'product-path-item-id-mismatch'
  | 'product-path-no-item-id'
  | 'unrecognized-path-shape'
  | 'affiliate-tag-present'
  | 'affiliate-tag-missing'
  | 'no-intended-identity';

export interface LinkClassification {
  urlType: LinkUrlType;
  /** Whether the network's own attribution (its tracking id, or a retailer tag param) is present. */
  attributed: boolean;
  evidence: LinkEvidence;
}

const AMAZON_HOSTS = ['www.amazon.com', 'amazon.com'];
const NEWEGG_HOSTS = ['www.newegg.com', 'newegg.com'];

/** True for a host that names another tracking/redirect hop rather than a retailer. */
const looksLikeRedirector = (host: string): boolean =>
  /(^|\.)(click|redirect|track|go|link|r)\./i.test(host) || TRACKED_LINK_HOSTS.includes(host);

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Classifies a direct (untracked) Amazon URL.
 *
 * Amazon's product-page shape is `/dp/<ASIN>` or `/gp/product/<ASIN>`; its
 * search shape is `/s` with a `k` query parameter. Attribution is the `tag`
 * query parameter SpecSmith's own affiliate tag — see `AMAZON_AFFILIATE_TAG`
 * in `src/lib/fps.ts`. This function checks for A tag being present, not that
 * it equals a specific value, so it stays correct if the tag is rotated.
 */
export function classifyAmazonUrl(raw: string | null | undefined): LinkClassification {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return { urlType: 'missing', attributed: false, evidence: 'no-url-supplied' };
  }
  const url = tryParseUrl(raw);
  if (!url) return { urlType: 'malformed', attributed: false, evidence: 'url-does-not-parse' };
  if (url.protocol !== 'https:') return { urlType: 'malformed', attributed: false, evidence: 'not-https' };

  if (!AMAZON_HOSTS.includes(url.hostname)) {
    const evidence: LinkEvidence = looksLikeRedirector(url.hostname) ? 'host-looks-like-nested-redirector' : 'host-not-allowed';
    return { urlType: 'wrong-domain', attributed: false, evidence };
  }

  const attributed = (url.searchParams.get('tag') ?? '').trim() !== '';
  const attributionEvidence: LinkEvidence = attributed ? 'affiliate-tag-present' : 'affiliate-tag-missing';

  if (url.pathname === '/s') {
    return { urlType: 'fallback-search', attributed, evidence: 'search-path-shape' };
  }
  if (/^\/(dp|gp\/product)\/[A-Z0-9]{6,}/i.test(url.pathname)) {
    return { urlType: 'exact', attributed, evidence: attributed ? 'product-path-shape' : attributionEvidence };
  }
  return { urlType: 'ambiguous', attributed, evidence: 'unrecognized-path-shape' };
}

/**
 * Newegg's product-page shape: a merchant-chosen slug segment followed by
 * `/p/<ITEM-ID>`, e.g. `/gigabyte-.../p/N82E16814932765`. The item id also
 * appears (redundantly) as an `item=` query parameter on every real listing
 * this repository's generator admits — see `admitAffiliatePart` in
 * `scripts/retail/catalog/affiliateCatalog.ts` — but the path segment is the
 * one part of the shape that cannot be blank, so it is read from there.
 */
const PRODUCT_PATH_ITEM_ID = /\/p\/([A-Za-z0-9-]+)\/?$/;

/**
 * Classifies a direct (untracked) newegg.com URL.
 *
 * Newegg's product-page shape is `.../p/<SKU>` (see `PRODUCT_PATH_ITEM_ID`);
 * its search-results shape is `/p/pl` (product-list). An untracked
 * newegg.com link, exact or not, earns nothing — see `NEWEGG_AFFILIATE_ID` in
 * `src/lib/fps.ts` — so `attributed` is always false here; a tracked link is
 * classified by `classifyTrackedNeweggUrl` instead.
 */
export function classifyDirectNeweggUrl(raw: string | null | undefined, expectedItemId?: string): LinkClassification {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return { urlType: 'missing', attributed: false, evidence: 'no-url-supplied' };
  }
  const url = tryParseUrl(raw);
  if (!url) return { urlType: 'malformed', attributed: false, evidence: 'url-does-not-parse' };
  if (url.protocol !== 'https:') return { urlType: 'malformed', attributed: false, evidence: 'not-https' };

  if (!NEWEGG_HOSTS.includes(url.hostname)) {
    const evidence: LinkEvidence = looksLikeRedirector(url.hostname) ? 'host-looks-like-nested-redirector' : 'host-not-allowed';
    return { urlType: 'wrong-domain', attributed: false, evidence };
  }

  if (url.pathname === '/p/pl' || url.pathname === '/p/pl/') {
    return { urlType: 'fallback-search', attributed: false, evidence: 'search-path-shape' };
  }
  const productMatch = url.pathname.match(PRODUCT_PATH_ITEM_ID);
  if (productMatch) {
    const itemId = url.searchParams.get('item') ?? productMatch[1];
    if (!itemId) return { urlType: 'ambiguous', attributed: false, evidence: 'product-path-no-item-id' };
    if (expectedItemId && itemId.toUpperCase() !== expectedItemId.toUpperCase()) {
      return { urlType: 'ambiguous', attributed: false, evidence: 'product-path-item-id-mismatch' };
    }
    return { urlType: 'exact', attributed: false, evidence: 'product-path-shape' };
  }
  return { urlType: 'ambiguous', attributed: false, evidence: 'unrecognized-path-shape' };
}

/**
 * Classifies a Rakuten-tracked Newegg deep link (a `click.linksynergy.com` /
 * `www.linksynergy.com` redirect, per `TRACKED_LINK_HOSTS`).
 *
 * Attribution lives in the tracking hop itself (`id` and `offerid` query
 * parameters — see `NeweggOffer.trackedAffiliateUrl` in
 * `scripts/retail/rakuten/types.ts`), so it is checked on the OUTER url. The
 * destination is read from `murl`, decoded, and classified the same way a
 * direct link would be — this is what lets a wrong-variant or a search-page
 * `murl` be caught even though the outer host is always linksynergy.
 *
 * `expectedItemId`, when given, is compared against the destination's own
 * `item=` parameter — the check that catches a listing whose tracked link was
 * swapped or mismatched from the SKU its catalog id names.
 */
export function classifyTrackedNeweggUrl(raw: string | null | undefined, expectedItemId?: string): LinkClassification {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return { urlType: 'missing', attributed: false, evidence: 'no-url-supplied' };
  }
  const url = tryParseUrl(raw);
  if (!url) return { urlType: 'malformed', attributed: false, evidence: 'url-does-not-parse' };
  if (url.protocol !== 'https:') return { urlType: 'malformed', attributed: false, evidence: 'not-https' };
  if (!TRACKED_LINK_HOSTS.includes(url.hostname)) {
    return { urlType: 'wrong-domain', attributed: false, evidence: 'host-not-allowed' };
  }

  const attributed = (url.searchParams.get('id') ?? '').trim() !== '' && (url.searchParams.get('offerid') ?? '').trim() !== '';

  const murl = url.searchParams.get('murl');
  if (!murl) {
    return { urlType: 'ambiguous', attributed, evidence: 'tracked-link-missing-destination-param' };
  }
  const destination = tryParseUrl(murl);
  if (!destination) {
    return { urlType: 'malformed', attributed, evidence: 'tracked-link-destination-does-not-parse' };
  }
  if (!NEWEGG_HOSTS.includes(destination.hostname)) {
    return { urlType: 'wrong-domain', attributed, evidence: 'tracked-link-destination-wrong-host' };
  }

  const inner = classifyDirectNeweggUrl(murl, expectedItemId);
  const evidence: LinkEvidence = attributed ? inner.evidence : 'tracked-link-missing-affiliate-ids';
  return { urlType: inner.urlType, attributed, evidence };
}
