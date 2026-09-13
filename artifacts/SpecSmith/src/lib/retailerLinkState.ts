import { getAffiliateUrl, getNeweggUrl } from './fps';

/**
 * Whether a purchase CTA's destination is a confirmed exact product page, a
 * generic retailer search, or has no valid destination at all. Every
 * Amazon/Newegg CTA the primary builder renders carries one of these —
 * callers must not infer trust from button copy alone (see PartCard.tsx /
 * BuildSummary.tsx, which render off `RetailerLink.state`, never off href
 * shape or label text).
 *
 * `exact` is a claim about PRODUCT IDENTITY: not just that a URL has the
 * shape of a real product page, but that it has been independently bound
 * to the SPECIFIC intended part — otherwise a validly-shaped URL for the
 * wrong product would announce itself as "the exact product page" (the
 * wrong-variant trust bug #88's round-2 review caught: a well-shaped Newegg
 * `/p/<id>` URL proves a product page exists at that address, not that it
 * is the part it's attached to). This canonical/primary-builder path (the
 * `PartSelector` → `PartCard` grid, `BuildSummary` sidebar) has no
 * independently-verified catalog binding between a part and a specific
 * retailer item id today — that verification (a Rakuten-attribution and
 * item-id match against the canonical model) exists only in the separate
 * retail-parts.json / RetailBuilder pipeline this issue doesn't touch (see
 * `classifyTrackedNeweggUrl` in the scripts/ tier's linkIntegrity.ts). So
 * `getNeweggLink` below never returns `exact`: per data-integrity rules,
 * prefer no exact-product claim over an unverified one. `exact` stays a
 * valid, tested state on `RetailerLinkCta` (see its own tests) for the day
 * a trusted per-part binding is wired in — it just isn't reachable from
 * this file until then.
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

/**
 * Amazon has no per-part tracked deep link anywhere in this app today — see
 * AMAZON_AFFILIATE_TAG's placeholder-tag note in fps.ts, which is itself a
 * placeholder pending Amazon Associates account approval. `sponsored` is
 * therefore false: constructing a URL with a not-yet-approved tag is not
 * evidence of an owned, live revenue relationship, and claiming `rel="sponsored"`
 * plus an "affiliate link"/commission-disclosure claim for a link that earns
 * nothing would itself be the false attribution claim #88 exists to prevent.
 * Flip this back to `true` once the Associates account is actually approved
 * and `AMAZON_AFFILIATE_TAG` is the real tag.
 */
export function getAmazonLink(query: string): RetailerLink {
  const trimmed = query.trim();
  if (!trimmed) return { state: 'unavailable', href: null, sponsored: false };
  return { state: 'fallback-search', href: getAffiliateUrl(trimmed), sponsored: false };
}

/**
 * Always `fallback-search` (or `unavailable` for an empty query) — see the
 * `exact` doc comment above for why. `trackedAffiliateUrl` is accepted so a
 * future trusted-binding lookup has somewhere to plug in, but today it is
 * not used to change the returned state.
 */
export function getNeweggLink(query: string, _trackedAffiliateUrl?: string): RetailerLink {
  const trimmed = query.trim();
  if (!trimmed) return { state: 'unavailable', href: null, sponsored: false };
  return { state: 'fallback-search', href: getNeweggUrl(trimmed), sponsored: false };
}
