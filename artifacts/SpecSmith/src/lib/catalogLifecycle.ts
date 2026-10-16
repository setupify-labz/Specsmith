// Which canonical parts in src/data/ may be RECOMMENDED for purchase.
//
// The catalog audit ledger (src/data/catalogAudit.json) records, per part id,
// its validity, its lifecycle and whether it is eligible for recommendations,
// with the reason and sources for each. Two rules:
//
// - FAIL CLOSED. Only ids on the eligible list are recommendable. An unknown,
//   unaudited or newly added part is ineligible until the ledger says otherwise.
// - AGE IS A LABEL, NOT A VERDICT. Older ("legacy") parts stay eligible and are
//   labelled; a part is ineligible only for a recorded concrete reason
//   (invalid, ambiguous variant, or unsuitable for the job).
//
// The app reads only catalogLifecycle.json (eligible ids + labels) so the
// ledger's notes never ship in the client bundle. catalogLifecycle.test.ts
// keeps it in step with the ledger. This module imports it statically, for
// prerendered guide pages; the Builder loads it lazily through
// hooks/useCatalogLifecycle.ts to keep it out of the Builder's initial bundle.

import lifecycleData from '../data/catalogLifecycle.json';
import { createCatalogLifecycle } from './catalogLifecycleCore';

export type { CatalogLabel } from './catalogLifecycleCore';

const lifecycle = createCatalogLifecycle(lifecycleData);

export const isRecommendable = lifecycle.isRecommendable;
export const recommendable = lifecycle.recommendable;
export const catalogLabel = lifecycle.catalogLabel;
export const catalogLabelText = lifecycle.catalogLabelText;
