import { getAffiliateUrl, getNeweggUrl } from './fps';

/**
 * Whether a purchase CTA's destination is a confirmed exact product page, a
 * generic retailer search, or has no valid destination at all. Every
 * Amazon/Newegg CTA the primary builder renders carries one of these —
 * callers must not infer trust from button copy alone (see PartCard.tsx /
 * BuildSummary.tsx, which render off `RetailerLink.state`, never off href
 * shape or label text).
 */
export type RetailerLinkState = 'exact' | 'fallback-search' | 'unavailable';

export interface RetailerLink {
  state: RetailerLinkState;
  href: string | null;
}

/**
 * Amazon has no per-part tracked deep link anywhere in the primary builder
 * today — see AMAZON_AFFILIATE_TAG's placeholder-tag note in fps.ts — so
 * every Amazon CTA here is a generic search, never an exact product page.
 */
export function getAmazonLink(query: string): RetailerLink {
  const trimmed = query.trim();
  if (!trimmed) return { state: 'unavailable', href: null };
  return { state: 'fallback-search', href: getAffiliateUrl(trimmed) };
}

/**
 * Newegg is 'exact' only when the caller supplies a real tracked deep link
 * (the existing per-part `affiliateUrl`, e.g. a verified retailer SKU
 * link). No canonical GPU/CPU/component record in this repository carries
 * one today, so this resolves to 'fallback-search' for every part the
 * canonical-fallback builder path renders — that is the actual state of
 * the data, not a placeholder to be swapped later.
 */
export function getNeweggLink(query: string, trackedAffiliateUrl?: string): RetailerLink {
  if (trackedAffiliateUrl) return { state: 'exact', href: trackedAffiliateUrl };
  const trimmed = query.trim();
  if (!trimmed) return { state: 'unavailable', href: null };
  return { state: 'fallback-search', href: getNeweggUrl(trimmed) };
}
