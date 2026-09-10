import {
  AFFILIATE_PART_CATALOG_URL,
  parseAffiliatePartCatalog,
  type AffiliateCatalogProblem,
  type AffiliatePartCatalog,
} from './partCatalog';
import { detectIdentityConflict, type IdentityConflict } from './identityConflict';

/**
 * What the browser currently knows about the retailer catalogue.
 *
 * `loading` IS NOT A COSMETIC ADDITION — it is the defect in issue #104. The
 * view began at `absent`, which is also what a confirmed failure returns, so
 * the page could not tell "the fetch has not answered yet" from "there is no
 * catalogue". Every visit therefore rendered the legacy canonical builder for
 * as long as the request took and then swapped it for the retail one, which
 * looks like two different builders fighting over the page.
 *
 * `loadAffiliatePartCatalog` never returns `loading`: it resolves to what it
 * found. Loading is the state BEFORE it has answered, which is why it belongs
 * to the caller holding the promise rather than to the function.
 */
export type AffiliateCatalogView =
  | { status: 'ok'; catalog: AffiliatePartCatalog; quarantined?: Array<{ partId: string; reason: IdentityConflict }> }
  /** The request is in flight and nothing is known yet. Not a failure. */
  | { status: 'loading' }
  | { status: 'absent' }
  | { status: 'invalid'; problem: AffiliateCatalogProblem };

/** The confirmed failures — everything that is neither loading nor usable. */
export type AffiliateCatalogFailureView = Extract<AffiliateCatalogView, { status: 'absent' | 'invalid' }>;

export const isCatalogFailure = (view: AffiliateCatalogView): view is AffiliateCatalogFailureView =>
  view.status === 'absent' || view.status === 'invalid';

export interface LoadAffiliateCatalogOptions {
  fetch?: typeof globalThis.fetch;
  url?: string;
  signal?: AbortSignal;
}

export async function loadAffiliatePartCatalog(options: LoadAffiliateCatalogOptions = {}): Promise<AffiliateCatalogView> {
  const doFetch = options.fetch ?? globalThis.fetch;
  try {
    const response = await doFetch(options.url ?? AFFILIATE_PART_CATALOG_URL, {
      cache: 'no-cache',
      signal: options.signal,
    });
    if (!response.ok) return { status: 'absent' };
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      return { status: 'invalid', problem: 'not-an-object' };
    }
    const parsed = parseAffiliatePartCatalog(raw);
    if (!parsed.ok) return { status: 'invalid', problem: parsed.problem };
    const quarantined: Array<{ partId: string; reason: IdentityConflict }> = [];
    const parts = parsed.catalog.parts.filter((part) => {
      const reason = detectIdentityConflict(part.name, part.trackedAffiliateUrl);
      if (!reason) return true;
      quarantined.push({ partId: part.id, reason });
      return false;
    });
    // Validate the stored schema first; quarantine the entire conflicting
    // listing (including price, image and mapping) from the usable view.
    return quarantined.length
      ? { status: 'ok', catalog: { ...parsed.catalog, parts }, quarantined }
      : { status: 'ok', catalog: parsed.catalog };
  } catch {
    return { status: 'absent' };
  }
}
