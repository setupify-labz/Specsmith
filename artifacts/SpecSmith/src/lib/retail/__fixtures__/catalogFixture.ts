/**
 * A schema-valid affiliate catalogue built from nothing.
 *
 * WHY NOT THE PUBLISHED FILE. `public/data/retail-parts.json` is regenerated
 * from a live feed. The listings in it rotate: a SKU present today is gone
 * next week, and the refresh that lands the identity/specifications split will
 * deliberately write `specsVerified: false` on every row. A test that reads
 * that file to find one particular RTX 5070 is therefore testing the state of
 * a retailer's inventory, and will fail for reasons that have nothing to do
 * with the behaviour it names.
 *
 * So the behaviour is pinned here instead. The fixture is synthetic and fixed,
 * and the one listing the split is about is built to order — in both the
 * legacy shape (`specsVerified: true`, the conflation as published) and the
 * shape the next regeneration writes (`false`). Neither may reach a
 * compatibility decision, and the tests assert that of both.
 *
 * This is NOT a claim about a real product. The figures below are named after
 * a real card because that is the case that exposed the defect, but nothing
 * here is published, priced, or shown to anyone.
 */

import {
  AFFILIATE_PART_CATALOG_SCHEMA_VERSION,
  AFFILIATE_PART_CATEGORY_TARGETS,
  RETAIL_PART_CATEGORIES,
  type AffiliatePart,
  type RetailPartCategory,
} from '../partCatalog';

/**
 * The canonical `rtx5070` figures, as a fixture.
 *
 * Held here rather than read from `src/data/gpus.json` for the same reason:
 * the editorial record may legitimately be revised, and these tests are about
 * what happens to a per-unit figure, not about which figure it currently is.
 * `canonicalRecordStillCarriesPerUnitFields` in the test file checks the real
 * record still has fields to withhold, so the withholding cannot go vacuous.
 */
export const CANONICAL_RTX5070 = {
  id: 'rtx5070',
  name: 'NVIDIA GeForce RTX 5070',
  // An editorial figure for a generic RTX 5070. Board partners differ: MSI
  // publishes 302 mm for the Ventus 3X OC. Twelve millimetres decides whether
  // a card goes into a case.
  length_mm: 290,
  // Exact-unit power draw is likewise not established from this record. MSI
  // publishes 250 W for that same card, which happens to match — a match is
  // not a measurement, and the next partner card need not agree.
  tdp_watts: 250,
  tier: 6,
  gpu_multiplier: 1.35,
  benchmark_score: 24000,
  price_usd: 599,
  vram_gb: 12,
} as const;

/** A case that fits the canonical figure and would not fit a 302 mm card. */
export const CASE_295MM = {
  id: 'fixture-case-295',
  name: 'Fixture Case 295mm',
  gpu_clearance_mm: 295,
  cooler_clearance_mm: 170,
  motherboard_support: ['ATX', 'Micro-ATX', 'Mini-ITX'],
  form_factor: 'Mid Tower',
  price_usd: 99,
} as const;

export const RTX5070_LISTING_ID = 'newegg-gpu-fixture-rtx5070-oc';

/**
 * One exact retailer listing of an RTX 5070.
 *
 * @param specsVerified the published flag. `true` is the legacy conflated
 *   value; `false` is what the next regeneration writes. The split must hold
 *   for both, so tests build one of each rather than depending on whichever a
 *   real catalogue happens to carry today.
 */
export const rtx5070Listing = (specsVerified: boolean): AffiliatePart => ({
  id: RTX5070_LISTING_ID,
  category: 'gpu',
  merchant: 'Newegg',
  name: 'Fixture Brand GeForce RTX 5070 12G OC Graphics Card',
  imageUrl: 'https://c1.neweggimages.com/fixture-rtx5070.jpg',
  trackedAffiliateUrl: 'https://click.linksynergy.com/link?id=fixture&offerid=gpu-5070',
  fetchedAt: '2026-09-01T00:00:00.000Z',
  availability: 'unknown',
  retailPrice: 649.99,
  salePrice: null,
  currency: 'USD',
  canonicalPartId: 'rtx5070',
  specsVerified,
  imageContentRatio: null,
  imageSha256: null,
  upc: null,
});

/** A listing the matcher could not identify. Its performance is not guessed. */
export const unmappedListing = (): AffiliatePart => ({
  ...rtx5070Listing(false),
  id: 'newegg-keyboard-fixture-unmapped',
  category: 'keyboard',
  name: 'Fixture Brand Mechanical Keyboard',
  // Distinct image and link: the reader refuses a catalogue with a duplicate
  // affiliate URL, which is the right rule — two rows pointing at one product
  // page are one product listed twice.
  imageUrl: 'https://c1.neweggimages.com/fixture-keyboard.jpg',
  trackedAffiliateUrl: 'https://click.linksynergy.com/link?id=fixture&offerid=keyboard-unmapped',
  canonicalPartId: null,
  specsVerified: false,
});

const filler = (category: RetailPartCategory, index: number): AffiliatePart => ({
  id: `newegg-${category}-fixture-${index}`,
  category,
  merchant: 'Newegg',
  name: `Fixture ${category} ${index}`,
  imageUrl: `https://c1.neweggimages.com/${category}-${index}.jpg`,
  trackedAffiliateUrl: `https://click.linksynergy.com/link?id=fixture&offerid=${category}-${index}`,
  fetchedAt: '2026-09-01T00:00:00.000Z',
  availability: 'unknown',
  retailPrice: 100 + index,
  salePrice: null,
  currency: 'USD',
  // Only GPUs carry a canonical mapping, which is what the generator produces:
  // the model matcher runs on the GPU adapter alone.
  canonicalPartId: category === 'gpu' ? 'rtx5070' : null,
  specsVerified: false,
  imageContentRatio: null,
  imageSha256: null,
  upc: null,
});

/**
 * A complete catalogue meeting every per-category target, with the caller's
 * listings substituted in at the front of their categories.
 *
 * The reader enforces exact counts, so a fixture cannot simply hold three
 * parts; the fillers exist to satisfy that and carry no meaning.
 */
export function catalogueContaining(...listings: AffiliatePart[]) {
  const byCategory = new Map<RetailPartCategory, AffiliatePart[]>();
  for (const listing of listings) {
    byCategory.set(listing.category, [...(byCategory.get(listing.category) ?? []), listing]);
  }

  const parts = RETAIL_PART_CATEGORIES.flatMap((category) => {
    const chosen = byCategory.get(category) ?? [];
    const remaining = AFFILIATE_PART_CATEGORY_TARGETS[category] - chosen.length;
    if (remaining < 0) throw new Error(`too many fixture listings for ${category}`);
    return [...chosen, ...Array.from({ length: remaining }, (_, index) => filler(category, index))];
  });

  return {
    schemaVersion: AFFILIATE_PART_CATALOG_SCHEMA_VERSION,
    generatedAt: '2026-09-01T00:00:00.000Z',
    merchant: 'Newegg' as const,
    availability: 'unknown' as const,
    parts,
  };
}
