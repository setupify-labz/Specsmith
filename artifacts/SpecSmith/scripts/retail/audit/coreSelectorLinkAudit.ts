// Audits the purchase links shown by the CORE builder selectors — every
// canonical GPU, CPU, motherboard, RAM, storage, PSU, case, cooler, monitor,
// keyboard, mouse and headset a shopper can pick in `Builder.tsx`,
// `QuizFlow.tsx`, the matchup pages, and the "best X for game" / prebuilt /
// component-guide pages.
//
// THIS CALLS THE REAL UI FUNCTIONS, NOT A COPY OF THEM
// ------------------------------------------------------
// `getAffiliateUrl`, `getNeweggUrl` and `buildPartQuery` are imported from
// `src/lib/fps.ts` — the exact functions every one of those pages calls to
// build its "Amazon" / "Newegg" buy button. Reimplementing their logic here
// would let this audit and the real UI silently drift apart; importing them
// means a future change to how those links are built is audited automatically,
// and `linkClassifier.behavior.test.ts` guards the assumption that no
// canonical part record carries an `affiliateUrl` of its own (the one thing
// that would make this classification stop being deterministic).

import { getAffiliateUrl, getNeweggUrl, buildPartQuery } from '../../../src/lib/fps';
import type { RetailPartCategory } from '../../../src/lib/retail/partCatalog';
import { classifyAmazonUrl, classifyDirectNeweggUrl } from './linkIntegrity';
import { statusFor, type LinkAuditRow } from './linkAuditReport';

export interface CoreSelectorCatalogEntry {
  id: string;
  name: string;
  brand?: string;
  category: RetailPartCategory;
}

function unverifiableRow(entry: CoreSelectorCatalogEntry, retailer: 'Amazon' | 'Newegg'): LinkAuditRow {
  return {
    partId: entry.id || '(missing id)',
    intendedProduct: entry.name || '(missing name)',
    source: 'core-selector',
    category: entry.category,
    retailer,
    urlType: 'unverifiable',
    attributed: false,
    evidence: 'no-intended-identity',
    identityEvidence: 'shape-only',
    priceSource: 'editorial-estimate',
    status: 'fail',
  };
}

export function auditCoreSelectorEntry(entry: CoreSelectorCatalogEntry): LinkAuditRow[] {
  if (entry.id.trim() === '' || entry.name.trim() === '') {
    return [unverifiableRow(entry, 'Amazon'), unverifiableRow(entry, 'Newegg')];
  }

  const query = buildPartQuery(entry.name, entry.brand, entry.category);
  const amazon = classifyAmazonUrl(getAffiliateUrl(query));
  const newegg = classifyDirectNeweggUrl(getNeweggUrl(query));

  // No per-part affiliate link exists for a canonical part at all (see the
  // module doc), so there is nothing to compare a destination id against —
  // every core-selector row's identity evidence is 'shape-only'. The price
  // shown beside these buy buttons is `price_usd` from `src/data/*.json`,
  // SpecSmith's own hand-maintained estimate, never a live retailer price.
  return [
    {
      partId: entry.id,
      intendedProduct: entry.name,
      source: 'core-selector',
      category: entry.category,
      retailer: 'Amazon',
      ...amazon,
      identityEvidence: 'shape-only',
      priceSource: 'editorial-estimate',
      status: statusFor(amazon.urlType, amazon.attributed),
    },
    {
      partId: entry.id,
      intendedProduct: entry.name,
      source: 'core-selector',
      category: entry.category,
      retailer: 'Newegg',
      ...newegg,
      identityEvidence: 'shape-only',
      priceSource: 'editorial-estimate',
      status: statusFor(newegg.urlType, newegg.attributed),
    },
  ];
}

export function auditCoreSelectorCatalog(entries: readonly CoreSelectorCatalogEntry[]): LinkAuditRow[] {
  return entries.flatMap(auditCoreSelectorEntry);
}
