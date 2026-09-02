import { getAffiliateUrl, getNeweggUrl } from './fps';

/**
 * Whether a purchase CTA's destination is a confirmed exact product page, a
 * generic retailer search, or has no valid destination at all. Every
 * Amazon/Newegg CTA the primary builder renders carries one of these —
 * callers must not infer trust from button copy alone (see PartCard.tsx /
 * BuildSummary.tsx, which render off `RetailerLink.state`, never off href
 * shape or label text).
 *
 * `exact` is a claim about PRODUCT IDENTITY only (the URL's own shape names
 * one specific product, checked below) — never about revenue attribution.
 * See `RetailerLink.sponsored` for that, a separate, independently-computed
 * field. Conflating the two — as an earlier version of this file did, by
 * trusting any nonempty override URL as both exact and sponsored — is
 * exactly the trust bug #85/#86 exist to catch; a read-only, CI-evidenced
 * audit under scripts/ classifies these same shapes for the wider
 * catalogue (see linkIntegrity.ts's classifiers there). This file cannot
 * import that module (src/ may not depend on the scripts/ tier — see the
 * header of `src/lib/retail/offerSnapshot.ts`), so the fail-closed shape
 * checks below are a browser-safe, intentionally-scoped-down
 * reimplementation of the same product-page-vs-search-vs-malformed rules
 * for the one override this component accepts (`trackedAffiliateUrl`).
 */
export type RetailerLinkState = 'exact' | 'fallback-search' | 'unavailable';

export interface RetailerLink {
  state: RetailerLinkState;
  href: string | null;
  /**
   * True only when this destination is verified to carry SpecSmith's own
   * affiliate attribution — never inferred from a URL merely being present,
   * "looking like" a product link, or being classified `exact`. Determines
   * `rel="sponsored"` and whether copy may call a link an "affiliate link".
   */
  sponsored: boolean;
}

const NEWEGG_HOSTS = ['www.newegg.com', 'newegg.com'];

/** Newegg's product-page shape: `.../p/<ITEM-ID>`. Its search shape is `/p/pl`. */
const NEWEGG_PRODUCT_PATH_ITEM_ID = /\/p\/([A-Za-z0-9-]+)\/?$/;

/**
 * True only for a URL that is, by its own shape, unambiguously a single
 * Newegg product page — https, newegg.com/www.newegg.com host, a
 * `/.../p/<id>` path (never the `/p/pl` search-results shape), and — when
 * the id is redundantly repeated as an `item=` query parameter, as every
 * real tracked Newegg listing in this repository does — that query id
 * AGREES with the path id. A URL this cannot place confidently (malformed,
 * wrong domain, search-shaped, or a path/query id disagreement — the exact
 * shape a swapped or corrupted link takes) returns false: never guess
 * toward `exact`. Mirrors `classifyDirectNeweggUrl` from the scripts/
 * tier's linkIntegrity.ts, scoped to the one thing this component needs
 * (a boolean), since that module cannot be imported here.
 */
function isExactNeweggProductUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (!NEWEGG_HOSTS.includes(url.hostname)) return false;
  if (url.pathname === '/p/pl' || url.pathname === '/p/pl/') return false;

  const match = url.pathname.match(NEWEGG_PRODUCT_PATH_ITEM_ID);
  if (!match) return false;
  const pathId = match[1];
  const queryId = url.searchParams.get('item');
  if (queryId !== null && queryId.toUpperCase() !== pathId.toUpperCase()) return false;
  return true;
}

/**
 * Amazon has no per-part tracked deep link anywhere in this app today — see
 * AMAZON_AFFILIATE_TAG's placeholder-tag note in fps.ts — so every Amazon
 * CTA here is a generic search. It is still genuinely `sponsored`: this
 * component builds the URL itself with SpecSmith's own configured
 * `AMAZON_AFFILIATE_TAG`, so — unlike an externally-supplied override —
 * there is nothing to verify; the code is the attribution's own source.
 */
export function getAmazonLink(query: string): RetailerLink {
  const trimmed = query.trim();
  if (!trimmed) return { state: 'unavailable', href: null, sponsored: false };
  return { state: 'fallback-search', href: getAffiliateUrl(trimmed), sponsored: true };
}

/**
 * `exact` only when the caller's `trackedAffiliateUrl` passes
 * `isExactNeweggProductUrl` above — never merely for being nonempty.
 * `sponsored` is false even then: unlike the Amazon URL this module builds
 * itself, a caller-supplied Newegg URL carries no tracking parameter this
 * component can verify as SpecSmith's own (that verification — a Rakuten
 * publisher SID match — belongs to the separate retail-parts.json/
 * RetailBuilder pipeline this issue does not touch; see
 * `classifyTrackedNeweggUrl` in the scripts/ tier's linkIntegrity.ts).
 * Overclaiming sponsorship here would repeat the exact bug this rewrite
 * fixes, just on a different field.
 */
export function getNeweggLink(query: string, trackedAffiliateUrl?: string): RetailerLink {
  const trimmedOverride = trackedAffiliateUrl?.trim();
  if (trimmedOverride && isExactNeweggProductUrl(trimmedOverride)) {
    return { state: 'exact', href: trimmedOverride, sponsored: false };
  }
  const trimmed = query.trim();
  if (!trimmed) return { state: 'unavailable', href: null, sponsored: false };
  return { state: 'fallback-search', href: getNeweggUrl(trimmed), sponsored: false };
}
