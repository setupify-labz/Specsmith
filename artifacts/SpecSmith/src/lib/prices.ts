// When SpecSmith's editorial catalogue prices were last revised, and which
// catalogue files that date is actually true of.
//
// PRICES_UPDATED is the date of the last catalogue-wide refresh pass. That
// pass (8586087, "July 16 price refresh: 56 GPU/CPU prices") repriced
// gpus.json and cpus.json and nothing else. This comment used to say the date
// also covered components.json, but it was never true of it: components.json
// was last repriced on July 13 (1d0fd2d, RAM and SSD), and 48 of its 90
// records were added after July 16 (220d3f2, 1d9f1f5, 07addc1).
// peripherals.json has never had a documented revision date.
//
// So the date is only shown beside a figure from a source it covers. Every
// catalogue figure is still an ESTIMATE ("Est."), dated or not; an undated
// source simply makes no claim about when. Bump PRICES_UPDATED only after a
// refresh pass, and list a file in CATALOGUE_PRICE_DATE only if that pass
// repriced it.
export const PRICES_UPDATED = 'July 16, 2026';

/** The editorial catalogue files a part's price can come from. */
export type CatalogueSource = 'gpus' | 'cpus' | 'components' | 'peripherals';

/**
 * Each source's supported revision date, or null when none is documented.
 *
 * The single rule every price display in the Builder reads, so a card, a
 * summary row and an imported recommendation cannot disagree about the same
 * figure.
 */
export const CATALOGUE_PRICE_DATE: Readonly<Record<CatalogueSource, string | null>> = Object.freeze({
  gpus: PRICES_UPDATED,
  cpus: PRICES_UPDATED,
  components: null,
  peripherals: null,
});

const SOURCE_BY_CATEGORY: Readonly<Record<string, CatalogueSource>> = Object.freeze({
  gpu: 'gpus',
  cpu: 'cpus',
  motherboard: 'components',
  ram: 'components',
  storage: 'components',
  psu: 'components',
  case: 'components',
  cooler: 'components',
  monitor: 'peripherals',
  keyboard: 'peripherals',
  mouse: 'peripherals',
  headset: 'peripherals',
});

/** The catalogue file a Builder category's parts come from, or null for an unknown category. */
export function catalogueSourceOf(category: string): CatalogueSource | null {
  return Object.prototype.hasOwnProperty.call(SOURCE_BY_CATEGORY, category) ? SOURCE_BY_CATEGORY[category] : null;
}
