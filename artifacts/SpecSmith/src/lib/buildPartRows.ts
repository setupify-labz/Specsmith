import { getPartName, getPartSearchQuery } from './prebuilts';
import { catalogLabelText, isRecommendable } from './catalogLifecycle';

const PART_CATEGORIES = ['gpu', 'cpu', 'motherboard', 'ram', 'storage', 'psu', 'case', 'cooler', 'monitor', 'keyboard', 'mouse', 'headset'];

export interface BuildPartRow {
  category: string;
  id: string;
  name: string;
  /** Retailer search query for a buy link, or null when the part must not get one. */
  buyQuery: string | null;
  /** Catalog audit label shown alongside, e.g. "Exact variant unconfirmed". */
  label: string | null;
}

/**
 * The part rows for a build someone else made: a gallery build (staff pick or
 * user submission) or a shared build link. A buy link is a purchase
 * recommendation, so it appears only for parts the catalog audit lists as
 * eligible; unknown or ineligible ids keep their name but get no link (fails
 * closed). A gallery STAFF PICK badge is a provenance label (SpecSmith-seeded,
 * not a user's), so it stays regardless.
 */
export function buildPartRows(buildState: Record<string, string | null | undefined>): BuildPartRow[] {
  return PART_CATEGORIES
    .map((category) => [category, buildState[category] ?? ''] as const)
    .filter(([, id]) => id)
    .map(([category, id]) => ({
      category,
      id,
      name: getPartName(category, id),
      buyQuery: isRecommendable(id) ? getPartSearchQuery(category, id) : null,
      label: catalogLabelText(id),
    }));
}
