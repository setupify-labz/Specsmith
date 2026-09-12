/**
 * Taking a guide's reviewed listings into the Builder.
 *
 * The old handoff put the guide's editorial MODEL ids into the URL. The
 * Builder could not put a model in a cart, so it showed a recommendation card
 * per slot and asked the shopper to find a listing for all eight — a guide
 * that answered nothing. This hands over exact listing ids, which the Builder
 * treats as ordinary selected parts with the usual remove and replace
 * controls, an automatic subtotal, and no second state model.
 */

import type { RetailPartCategory } from '../retail/partCatalog';
import { RETAIL_PART_CATEGORIES } from '../retail/partCatalog';

/** Where the Builder keeps the shopper's working build. */
export const BUILDER_DRAFT_KEY = 'specsmith-builder-draft';

/** The Builder URL for a set of exact listing ids, optionally opening one category. */
export function builderUrlFor(
  selection: Readonly<Record<string, string>>,
  openCategory?: RetailPartCategory,
): string {
  const params = new URLSearchParams();
  for (const [category, id] of Object.entries(selection)) params.set(category, id);
  if (openCategory) params.set('open', openCategory);
  const query = params.toString();
  return query ? `/builder?${query}` : '/builder';
}

/**
 * Whether the shopper already has a build worth asking about.
 *
 * Read defensively: this is browser storage, it can hold anything, and a
 * parse failure must not throw in a render path or — worse — be treated as
 * "empty" and license overwriting a build that is actually there. An
 * unreadable draft counts as occupied, so the shopper is asked.
 */
export function hasExistingBuild(raw: string | null): boolean {
  if (raw === null || raw.trim() === '') return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return true;
  }
  if (typeof parsed !== 'object' || parsed === null) return true;
  const record = parsed as Record<string, unknown>;
  return RETAIL_PART_CATEGORIES.some((category) => {
    const value = record[category];
    return typeof value === 'string' && value.trim() !== '';
  });
}

/** Reads the draft from storage without letting a storage error escape. */
export function readDraft(storage: Pick<Storage, 'getItem'> | undefined): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(BUILDER_DRAFT_KEY);
  } catch {
    // Private mode, blocked site data. Unknown, so treat as occupied above.
    return '{}';
  }
}
