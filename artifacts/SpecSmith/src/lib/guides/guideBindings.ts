/**
 * What each Build Guide slot actually points at, decided by hand.
 *
 * WHY THIS FILE EXISTS. A guide used to name an editorial model — "RX 6600",
 * "Corsair RM750x" — and the Builder turned that into a recommendation card
 * with a dated estimate beside it, leaving the shopper to find a real listing
 * for all eight slots themselves. A guide is supposed to be a reviewed answer,
 * so a slot now names an EXACT retailer listing or says plainly that it has
 * none.
 *
 * NOTHING HERE IS DERIVED. Every binding below was read off the catalogue by a
 * person comparing the listing title to the intended product, and each carries
 * the date that happened. There is no name similarity scoring, no price
 * proximity, no "closest tier", no image or benchmark matching. A model name
 * is not a listing: "RX 6600" identifies a chip, while a listing identifies a
 * box on a shelf at a price, and only the second is something to buy.
 *
 * WHEN A BOUND SKU DISAPPEARS the slot becomes unavailable and the guide says
 * so. It does NOT fall back to a similar product, a search page, or the old
 * editorial estimate. The catalogue is refreshed nightly and listings drop out
 * of it — that is ordinary, and quietly swapping in a different processor
 * because the reviewed one sold out is exactly the behaviour this file exists
 * to prevent.
 */

import type { RetailPartCategory } from '../retail/partCatalog';

/** Why a guide slot carries no binding. */
export type UnboundReason =
  /** The catalogue carries no listing for this exact product. */
  | 'no-exact-listing'
  /** The product itself needs an editorial decision before it can be bound. */
  | 'needs-editorial-review';

export interface GuideSlotBinding {
  readonly guideId: string;
  readonly category: RetailPartCategory;
  /** The stable SpecSmith canonical identity this slot has always named. */
  readonly canonicalPartId: string;
  readonly manufacturer: string;
  /** The exact model, as the manufacturer names it. */
  readonly exactModel: string;
  /**
   * The manufacturer part number, ONLY where the listing states one.
   *
   * Null is a real answer and appears often. An MPN that the feed does not
   * provide is not something to reconstruct from a model name — a wrong
   * ordering code is worse than an absent one, because it looks like proof.
   */
  readonly manufacturerPartNumber: string | null;
  /** The approved retail listing id in `retail-parts.json`. */
  readonly neweggPartId: string;
  /** ISO date this binding was reviewed by a person. */
  readonly reviewedOn: string;
  /** Why this exact component belongs in this guide. Factual, and short. */
  readonly why: string;
}

export interface GuideSlotUnbound {
  readonly guideId: string;
  readonly category: RetailPartCategory;
  readonly canonicalPartId: string;
  readonly reason: UnboundReason;
  /** What the reviewer found. Shown to editors, not to shoppers. */
  readonly note: string;
  readonly reviewedOn: string;
}

const REVIEWED = '2026-09-12';

/**
 * THE REVIEWED BINDINGS.
 *
 * Five, out of forty guide slots. That is not an oversight: the published
 * catalogue simply does not carry the products these guides were written
 * around. See `GUIDE_SLOTS_NEEDING_EDITORIAL_REVIEW` and the coverage note at
 * the bottom of this file.
 */
export const GUIDE_SLOT_BINDINGS: readonly GuideSlotBinding[] = [
  {
    guideId: 'budget-beast',
    category: 'cpu',
    canonicalPartId: 'r5-5600',
    manufacturer: 'AMD',
    exactModel: 'Ryzen 5 5600',
    manufacturerPartNumber: '100-100000927CBX',
    neweggPartId: 'newegg-cpu-9sic7xkm1g7929',
    reviewedOn: REVIEWED,
    why:
      'The listing names the Ryzen 5 5600 and states its ordering code, 100-100000927CBX. ' +
      'A second listing for the same processor was rejected: it is an OEM tray part with ' +
      'no stated ordering code, so its identity rests on the title alone.',
  },
  {
    guideId: '1440p-sweetspot',
    category: 'cpu',
    canonicalPartId: 'r7-7700x',
    manufacturer: 'AMD',
    exactModel: 'Ryzen 7 7700X',
    manufacturerPartNumber: '100-100000591WOF',
    neweggPartId: 'newegg-cpu-9sia2w0jsh9712',
    reviewedOn: REVIEWED,
    why:
      'The listing names the Ryzen 7 7700X and states the boxed ordering code ' +
      '100-100000591WOF. Socket AM5, 105 W, matching the board and cooler this guide pairs it with.',
  },
  {
    guideId: '4k-monster',
    category: 'cpu',
    canonicalPartId: 'r9-7950x3d',
    manufacturer: 'AMD',
    exactModel: 'Ryzen 9 7950X3D',
    manufacturerPartNumber: '100-100000908WOZ',
    neweggPartId: 'newegg-cpu-9sic3drkn76378',
    reviewedOn: REVIEWED,
    why:
      'The listing names the Ryzen 9 7950X3D and states ordering code 100-100000908WOZ. ' +
      'It is an OEM tray part, so it ships without retail packaging — stated here rather ' +
      'than left for the shopper to discover at the basket.',
  },
  {
    guideId: 'ultimate-rig',
    category: 'cpu',
    canonicalPartId: 'r9-7950x3d',
    manufacturer: 'AMD',
    exactModel: 'Ryzen 9 7950X3D',
    manufacturerPartNumber: '100-100000908WOZ',
    neweggPartId: 'newegg-cpu-9sic3drkn76378',
    reviewedOn: REVIEWED,
    why:
      'The same reviewed listing as the 4K Monster guide, which names this processor too. ' +
      'It is an OEM tray part and ships without retail packaging.',
  },
  {
    guideId: '4k-monster',
    category: 'case',
    canonicalPartId: 'fdtorrent',
    manufacturer: 'Fractal Design',
    exactModel: 'Torrent (Black)',
    manufacturerPartNumber: null,
    neweggPartId: 'newegg-case-n82e16811352143',
    reviewedOn: REVIEWED,
    why:
      'The listing names the Fractal Design Torrent in black, the high-airflow mid tower ' +
      'this guide selects. The feed states no part number for it, so none is recorded.',
  },
];

/**
 * Slots a reviewer looked at and deliberately did not bind.
 *
 * THE GPUs ARE THE HEADLINE. Not one of the five guides' graphics cards exists
 * in the published catalogue, which carries RTX 3050, 3060, 5050, 5060,
 * 5060 Ti, 5070, 5070 Ti, 5080, RX 9070 and RX 9070 XT and nothing else. A
 * 50-series card is not a substitute for the 40-series card a guide was
 * written around: it is a different product at a different price with
 * different performance, and swapping it in because it is the nearest thing on
 * the shelf is precisely the guess this architecture forbids.
 *
 * Listed per guide so an editor can see what a guide needs, rather than
 * discovering it one empty slot at a time.
 */
export const GUIDE_SLOTS_NEEDING_EDITORIAL_REVIEW: readonly GuideSlotUnbound[] = [
  { guideId: 'budget-beast', category: 'gpu', canonicalPartId: 'rx6600', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No RX 6600 in the catalogue. Nearest AMD cards carried are RX 9070 / 9070 XT, a different generation and price class.' },
  { guideId: 'budget-beast', category: 'motherboard', canonicalPartId: 'b550tom', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No B550 Tomahawk. The only B550 carried is an MPG B550I Mini-ITX board, a different form factor.' },
  { guideId: 'budget-beast', category: 'ram', canonicalPartId: 'cr16ddr4', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No Crucial 16GB DDR4-3200 kit. The nearest Crucial listing is a 32GB (2x16GB) kit — twice the capacity, a different product.' },
  { guideId: 'budget-beast', category: 'storage', canonicalPartId: 'sgbar2', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No Seagate Barracuda 2TB listing in the catalogue.' },
  { guideId: 'budget-beast', category: 'psu', canonicalPartId: 'crm750', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No Corsair RM750x. The catalogue carries an RM750e, a different model in the same family.' },
  { guideId: 'budget-beast', category: 'case', canonicalPartId: 'nzxth510', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No NZXT H510 listing in the catalogue.' },
  { guideId: 'budget-beast', category: 'cooler', canonicalPartId: 'cmh212', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No Cooler Master Hyper 212 listing in the catalogue.' },

  { guideId: '1080p-champion', category: 'gpu', canonicalPartId: 'rtx4060ti', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No RTX 4060 Ti. The catalogue carries no 40-series card at all; a 5060 Ti is a different product, not a newer copy of this one.' },
  { guideId: '1080p-champion', category: 'cpu', canonicalPartId: 'i5-13600k', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No i5-13600K listing in the catalogue.' },
  { guideId: '1080p-champion', category: 'motherboard', canonicalPartId: 'b760mds3h', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No Gigabyte B760M DS3H. Four other B760 boards are carried, all different models from other makers.' },
  { guideId: '1080p-champion', category: 'ram', canonicalPartId: 'gr32ddr4', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No G.Skill Ripjaws 32GB DDR4-3600 kit in the catalogue.' },
  { guideId: '1080p-champion', category: 'storage', canonicalPartId: 'wdblack1', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No WD Black SN850X 1TB listing in the catalogue.' },
  { guideId: '1080p-champion', category: 'psu', canonicalPartId: 'evga850', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No EVGA SuperNOVA 850 G6 listing in the catalogue.' },
  { guideId: '1080p-champion', category: 'case', canonicalPartId: 'cor4000d', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No Corsair 4000D Airflow listing in the catalogue.' },
  { guideId: '1080p-champion', category: 'cooler', canonicalPartId: 'bqdrp4', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No be quiet! Dark Rock Pro 4 listing in the catalogue.' },

  { guideId: '1440p-sweetspot', category: 'gpu', canonicalPartId: 'rtx4070s', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No RTX 4070 Super in the catalogue.' },
  { guideId: '1440p-sweetspot', category: 'motherboard', canonicalPartId: 'b650aorus', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No B650 board of any model in the catalogue, so the AM5 board this guide pairs with its processor cannot be bound.' },
  { guideId: '1440p-sweetspot', category: 'ram', canonicalPartId: 'kf16ddr5', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No Kingston Fury Beast 16GB DDR5-5200 kit in the catalogue.' },
  { guideId: '1440p-sweetspot', category: 'storage', canonicalPartId: 's990pro2', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No Samsung 990 Pro 2TB listing in the catalogue.' },
  { guideId: '1440p-sweetspot', category: 'psu', canonicalPartId: 'sea1000', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No Seasonic Focus GX-1000 listing in the catalogue.' },
  { guideId: '1440p-sweetspot', category: 'case', canonicalPartId: 'lio11', reason: 'needs-editorial-review', reviewedOn: REVIEWED,
    note: 'Lian Li O11 listings exist but none is the plain PC-O11 Dynamic this guide names: one is an O11 Vision Compact, the others are third-party bundles and custom-art resells. An editor should decide which O11 variant this guide means.' },
  { guideId: '1440p-sweetspot', category: 'cooler', canonicalPartId: 'corh100i', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No Corsair H100i Elite listing in the catalogue.' },

  { guideId: '4k-monster', category: 'gpu', canonicalPartId: 'rtx4080s', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No RTX 4080 Super in the catalogue.' },
  { guideId: '4k-monster', category: 'motherboard', canonicalPartId: 'x670ecross', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No ASUS ROG Crosshair X670E listing in the catalogue.' },
  { guideId: '4k-monster', category: 'ram', canonicalPartId: 'gz32ddr5', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No G.Skill Trident Z5 32GB DDR5-6000 kit in the catalogue.' },
  { guideId: '4k-monster', category: 'storage', canonicalPartId: 'wdblack2', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No WD Black SN850X 2TB listing in the catalogue.' },
  { guideId: '4k-monster', category: 'psu', canonicalPartId: 'corhx1200', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No Corsair HX1200 listing in the catalogue.' },
  { guideId: '4k-monster', category: 'cooler', canonicalPartId: 'corh150i', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No Corsair H150i Elite listing in the catalogue.' },

  { guideId: 'ultimate-rig', category: 'gpu', canonicalPartId: 'rtx5090', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No RTX 5090 in the catalogue. The largest card carried is a 5080, which is a different product and not a stand-in for the card this guide is built around.' },
  { guideId: 'ultimate-rig', category: 'motherboard', canonicalPartId: 'x670emeg', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No MSI MEG X670E ACE listing in the catalogue.' },
  { guideId: 'ultimate-rig', category: 'ram', canonicalPartId: 'gz64ddr5', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No G.Skill Ripjaws 64GB DDR5-6000 kit in the catalogue.' },
  { guideId: 'ultimate-rig', category: 'storage', canonicalPartId: 'wdblack2', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No WD Black SN850X 2TB listing in the catalogue.' },
  { guideId: 'ultimate-rig', category: 'psu', canonicalPartId: 'tt1650', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No Thermaltake Toughpower GF3 1650W listing in the catalogue.' },
  { guideId: 'ultimate-rig', category: 'case', canonicalPartId: 'bqdbp900', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No be quiet! Dark Base Pro 900 listing in the catalogue.' },
  { guideId: 'ultimate-rig', category: 'cooler', canonicalPartId: 'corh150i', reason: 'no-exact-listing', reviewedOn: REVIEWED,
    note: 'No Corsair H150i Elite listing in the catalogue.' },
];

/** The binding for one guide slot, or null when a reviewer did not bind it. */
export function bindingFor(guideId: string, category: RetailPartCategory): GuideSlotBinding | null {
  return (
    GUIDE_SLOT_BINDINGS.find((b) => b.guideId === guideId && b.category === category) ?? null
  );
}

/** The reviewer's note for an unbound slot, or null when the slot is bound. */
export function unboundFor(guideId: string, category: RetailPartCategory): GuideSlotUnbound | null {
  return (
    GUIDE_SLOTS_NEEDING_EDITORIAL_REVIEW.find(
      (s) => s.guideId === guideId && s.category === category,
    ) ?? null
  );
}

/** Every slot of a guide that a reviewer flagged. */
export function editorialReviewFor(guideId: string): readonly GuideSlotUnbound[] {
  return GUIDE_SLOTS_NEEDING_EDITORIAL_REVIEW.filter((s) => s.guideId === guideId);
}
