import {
  AFFILIATE_PART_CATALOG_URL,
  parseAffiliatePartCatalog,
  type AffiliateCatalogProblem,
  type AffiliatePartCatalog,
} from './partCatalog';
import { detectIdentityConflict, type IdentityConflict } from './identityConflict';

export type AffiliateCatalogView =
  | { status: 'ok'; catalog: AffiliatePartCatalog; quarantined?: Array<{ partId: string; reason: IdentityConflict }> }
  | { status: 'absent' }
  | { status: 'invalid'; problem: AffiliateCatalogProblem };

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
