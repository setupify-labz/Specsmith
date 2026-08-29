import {
  AFFILIATE_PART_CATALOG_URL,
  parseAffiliatePartCatalog,
  type AffiliateCatalogProblem,
  type AffiliatePartCatalog,
} from './partCatalog';

export type AffiliateCatalogView =
  | { status: 'ok'; catalog: AffiliatePartCatalog }
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
    return parsed.ok ? { status: 'ok', catalog: parsed.catalog } : { status: 'invalid', problem: parsed.problem };
  } catch {
    return { status: 'absent' };
  }
}
