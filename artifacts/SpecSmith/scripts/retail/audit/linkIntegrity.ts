// Classifies a single purchase-link URL against a closed set of outcomes.
//
// PURE. No I/O, no fetch, no credential, no clock. Every classifier here
// decides from the URL's own shape — host, path, query — never by asking the
// retailer. That is what lets this run in CI with no API key: it cannot tell
// you a listing is in stock or still on sale, but it can tell you, today and
// deterministically, whether a link even POINTS AT a specific product versus
// a search box, and whether it carries SpecSmith's OWN attribution — not
// merely *an* attribution, see the `attributed` doc below — that makes a
// click worth anything.
//
// WHAT "exact" DOES AND DOES NOT PROVE
// -------------------------------------
// `urlType: 'exact'` means the URL's own SHAPE names one specific product
// page rather than a search box — a structural fact about the link, checked
// (when an `expectedItemId` is supplied) against the id the LINK ITSELF
// declares in two places that must agree (its path segment and its `item=`
// query parameter — see `classifyDirectNeweggUrl`). What it does NOT prove is
// that the product behind that id is the one SpecSmith actually intended:
// for a `retail-parts-catalog` row, `expectedItemId` is reconstructed from
// the catalog's own `id` field, which was itself derived from the SAME
// upstream listing as the link — so a match there is INTERNAL
// SELF-CONSISTENCY (the record does not contradict itself), not independent
// verification against a separately sourced identifier (a manufacturer part
// number from a second source, say). This repository has no such second
// source today. Callers that want to say more than "self-consistent" must
// carry that distinction themselves — see `identityEvidence` on
// `LinkAuditRow` in `linkAuditReport.ts`.
//
// WHAT THIS FILE MAY NOT DO
// --------------------------
// Never widen a classification by guessing. A URL this code cannot place
// confidently is 'ambiguous' or 'unverifiable', not 'exact'. And never treat
// *some* attribution as SpecSmith's own: `attributed` is true only when the
// URL carries SpecSmith's OWN known identifier(s) — `AMAZON_AFFILIATE_TAG`
// from `src/lib/fps.ts`, or this repository's own Rakuten publisher SID,
// below — never merely "a tag/id param is present". A link carrying someone
// else's affiliate id would otherwise pass as attributed.

import { TRACKED_LINK_HOSTS } from '../../../src/lib/retail/offerSnapshot';
import { AMAZON_AFFILIATE_TAG } from '../../../src/lib/fps';

/**
 * SpecSmith's own Rakuten publisher SID, as it appears in the `id=` query
 * parameter of every real tracked link this repository ships — verified
 * identical across all 500 rows of `public/data/retail-parts.json` at the
 * time this constant was written. It is a PUBLIC identifier, not a
 * credential: it appears in every outbound click URL on the live site by
 * design, the same way a UTM parameter does. It is the same value read at
 * runtime from `RAKUTEN_PUBLISHER_SID` (see `PUBLISHER_SID_ENV_VAR` in
 * `scripts/retail/rakuten/accessTokenRequest.ts`) for the separate token
 * request; it is hardcoded here, rather than read from the environment,
 * because this audit must run with no credential and no environment access
 * — see `audit-retailer-links.test.ts`'s "reads no environment variable"
 * guard.
 */
export const SPECSMITH_RAKUTEN_PUBLISHER_SID = 'ptE95Z94djU';

/**
 * The Rakuten advertiser id for Newegg, as the `offerid` query parameter's
 * prefix (`<advertiser-id>.<per-listing-id>`) on every real tracked link in
 * `public/data/retail-parts.json`. Distinct from `NEWEGG_MID` in
 * `scripts/retail/rakuten/types.ts`, which is Newegg's OWN merchant id inside
 * the Product Search feed — this is Rakuten's id for the same merchant as an
 * advertiser program, a different namespace.
 */
export const NEWEGG_RAKUTEN_ADVERTISER_ID = '1786142';

export type LinkUrlType =
  /** The URL's shape names one specific product page (see the module doc for what this does and does not prove). */
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
  | 'tracked-link-foreign-affiliate-ids'
  | 'search-path-shape'
  | 'product-path-shape'
  | 'product-path-and-query-id-disagree'
  | 'product-path-item-id-mismatch'
  | 'product-path-no-item-id'
  | 'unrecognized-path-shape'
  | 'affiliate-tag-present'
  | 'affiliate-tag-missing'
  | 'affiliate-tag-foreign'
  | 'no-intended-identity';

export interface LinkClassification {
  urlType: LinkUrlType;
  /** True only when SpecSmith's OWN known identifier is present — never merely "some" tag/id. See the module doc. */
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
 * search shape is `/s` with a `k` query parameter. `attributed` requires the
 * `tag` query parameter to equal `AMAZON_AFFILIATE_TAG` EXACTLY — a nonempty
 * but foreign tag (someone else's affiliate id) is `attributed: false`, with
 * its own evidence code, never conflated with "no tag at all".
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

  const tag = (url.searchParams.get('tag') ?? '').trim();
  const attributed = tag === AMAZON_AFFILIATE_TAG;
  const attributionEvidence: LinkEvidence = tag === '' ? 'affiliate-tag-missing' : attributed ? 'affiliate-tag-present' : 'affiliate-tag-foreign';

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
 * `scripts/retail/catalog/affiliateCatalog.ts`.
 *
 * REAL LISTINGS CAN CARRY TWO DIFFERENT, BOTH-VALID IDS: a marketplace SKU
 * (`item=9SIAWKTKFU6722`) and a catalog product id in the path
 * (`/p/274-000M-001T4`) — see the `TRACKED_DUAL_ITEM_ID` fixture in
 * `linkIntegrity.test.ts`. So both are read, and BOTH must agree with each
 * other before either is trusted: silently preferring one (as an earlier
 * version of this function did) let a URL whose path and query named two
 * DIFFERENT products still pass as exact.
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
    const pathItemId = productMatch[1];
    const queryItemId = url.searchParams.get('item');
    if (queryItemId !== null && queryItemId.toUpperCase() !== pathItemId.toUpperCase()) {
      // The path names one product and the query names another. Trusting
      // either would be a guess — this is exactly the shape a swapped or
      // corrupted link takes, and the whole point of reading both fields.
      return { urlType: 'ambiguous', attributed: false, evidence: 'product-path-and-query-id-disagree' };
    }
    const itemId = queryItemId ?? pathItemId;
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
 * `attributed` requires BOTH the `id` query parameter to equal
 * `SPECSMITH_RAKUTEN_PUBLISHER_SID` exactly AND `offerid` to start with
 * `NEWEGG_RAKUTEN_ADVERTISER_ID` — a nonempty but foreign id/offerid (another
 * publisher's or another advertiser's) is `attributed: false`, never
 * conflated with "missing". The destination is read from `murl`, decoded,
 * and classified the same way a direct link would be — this is what lets a
 * mismatched-identity or search-page `murl` be caught even though the outer
 * host is always linksynergy.
 *
 * `expectedItemId`, when given, is compared against the destination's own
 * declared id (see `classifyDirectNeweggUrl`) — the check that catches a
 * listing whose tracked link was swapped or mismatched from the SKU its
 * catalog id names. See the module doc for what this comparison does and
 * does not prove.
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

  const id = (url.searchParams.get('id') ?? '').trim();
  const offerid = (url.searchParams.get('offerid') ?? '').trim();
  const attributed = id === SPECSMITH_RAKUTEN_PUBLISHER_SID && offerid.startsWith(`${NEWEGG_RAKUTEN_ADVERTISER_ID}.`);
  // Only ever read when NOT attributed (see the return below), so this never
  // needs a case for the attributed outcome.
  const unattributedEvidence: LinkEvidence = id === '' || offerid === '' ? 'tracked-link-missing-affiliate-ids' : 'tracked-link-foreign-affiliate-ids';

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
  const evidence: LinkEvidence = attributed ? inner.evidence : unattributedEvidence;
  return { urlType: inner.urlType, attributed, evidence };
}
