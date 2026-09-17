import {
  AFFILIATE_PART_CATALOG_SCHEMA_VERSION,
  AFFILIATE_PART_TARGET,
  parseAffiliatePartCatalog,
  type AffiliatePart,
  type AffiliatePartCatalog,
  type RetailPartCategory,
} from '../../../src/lib/retail/partCatalog';
import { AVAILABILITY_UNKNOWN, isHttpUrl, isTrackedAffiliateUrl } from '../../../src/lib/retail/offerSnapshot';
import { checkPartPricing } from '../../../src/lib/retail/partCatalog';
import { childText, readPrice, type XmlElement } from '../rakuten/parseProductSearchXml';
import { classifyListingCondition } from '../rakuten/listingKind';
import { readCategory } from '../rakuten/admitOffer';
import { NEWEGG_MID, type NeweggOffer } from '../rakuten/types';
import { RETAIL_CATEGORY_CONFIG } from './catalogConfig';
import type { ImageMeasurement } from './imageContent';
import { detectIdentityConflict } from '../../../src/lib/retail/identityConflict';
import { MAX_CLOCK_SKEW_MS } from '../../../src/lib/retail/offerSnapshot';
import { PRICE_FRESHNESS_MS } from '../../../src/lib/retail/partPricing';
import { listingIdentity, normalizeCatalogName, selectBestListings } from './listingSelection';
import { loadCategoryScopes, type CategoryPriceScope } from './categoryScope';
import {
  consumerProductVerdict,
  isCpuBoardBundle,
  isMultipack,
  isOpenBenchChassis,
  isServerBoard,
  isServerClassProcessor,
  screenConsumerProducts,
} from './consumerProductGate';
import { screenCompleteProducts } from './completeProductGate';

// Re-exported so the rules have one definition and one import path.
export {
  completeProductVerdict,
  isBoardAccessory,
  isBoardComponentBundle,
  isHardwareMonitorScreen,
  isMouseComponent,
  isMultiSocketServerBoard,
  isWearableDeviceCase,
  screenCompleteProducts,
  type IncompleteRejection,
} from './completeProductGate';

export {
  consumerProductVerdict,
  isCpuBoardBundle,
  isMultipack,
  isOpenBenchChassis,
  isServerBoard,
  isServerClassProcessor,
  screenConsumerProducts,
  type ConsumerRejection,
} from './consumerProductGate';

export { normalizeCatalogName } from './listingSelection';

export type CatalogAdmission =
  | { status: 'accepted'; part: AffiliatePart }
  | {
      status: 'rejected';
      reason: 'merchant' | 'category' | 'required-field' | 'condition' | 'kind' | 'url' | 'price' | 'identity-conflict';
    };

const safeId = (category: RetailPartCategory, sku: string): string =>
  `newegg-${category}-${sku.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/-+$/g, '');


const has = (title: string, pattern: RegExp): boolean => pattern.test(title);

/**
 * The feed's `<upccode>`, kept only when it is actually a UPC.
 *
 * A SUPPORTING identifier, never an identity on its own: two listings of the
 * same card share a UPC, and plenty of listings carry none at all, so nothing
 * may be resolved from this field alone. It travels so that a later reviewer
 * confirming an exact SKU has one more thing to check against.
 *
 * Merchants put "N/A", a dash, or a padded string in the element. The reader
 * REFUSES a part whose upc is present but malformed, so anything that is not a
 * bare 8-14 digit code becomes null here rather than costing the listing its
 * place in the catalogue.
 */
export function readUpc(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return /^[0-9]{8,14}$/.test(trimmed) ? trimmed : null;
}

/**
 * Rakuten's category leaf is necessary but not sufficient: the retailer puts
 * replacement batteries, stands, cables and bundles in the same leaves as the
 * component they relate to. These rules only admit a product that can occupy
 * the named slot in the PC builder. They intentionally use product-kind words,
 * never model/spec inference.
 */

/**
 * Memory the builder should not be recommending, without rejecting a current
 * kit that merely MENTIONS an older standard.
 *
 * "DDR3" in a title is not enough on its own. A DDR5 listing saying "DDR3 not
 * supported" is a current kit, and a substring test reads its compatibility
 * note as its specification — the same polarity mistake as scanning for a word
 * without asking which way the sentence points. So a legacy generation is
 * disqualifying only when no current one is named.
 *
 * The bare word "ddr" is deliberately NOT matched. It was, and it rejected
 * "Kingston FURY Beast DDR 5", because a merchant who spaces the generation
 * out leaves "ddr" standing alone.
 */
export function isLegacyMemory(title: string): boolean {
  const legacy = /\bddr\s?[23]\b/.test(title);
  const current = /\bddr\s?[45]\b/.test(title);
  return legacy && !current;
}

/** Accessory nouns that, standing before the device, name the product itself. */
const HEADSET_ACCESSORY = /\b(cable|cord|cushion|pad|adapter|splitter|case|pouch)\b/;
const HEADSET_DEVICE = /\b(headset|headphones)\b/;

/**
 * Whether an accessory noun names the PRODUCT rather than something in the box.
 *
 * Word ORDER decides it, because that is what actually separates the two:
 *
 *   "3.5mm Earphone CABLE ... for G633 Gaming HEADSET"  -> the cable is the product
 *   "Gaming HEADSET with detachable audio CABLE"        -> the cable is included
 *
 * The rule this replaces tested adjacency — `cable for … headset` — which read
 * the first as a headset (the real title says "cable WITH inline control FOR")
 * and the second correctly, but also rejected every wireless headset described
 * as having a "USB adapter for PC … headphones". Those are among the most
 * common listings in the category.
 */
export function accessoryLeadsHeadset(title: string): boolean {
  const accessory = HEADSET_ACCESSORY.exec(title);
  if (accessory === null) return false;
  const device = HEADSET_DEVICE.exec(title);
  return device !== null && accessory.index < device.index;
}


export function isSelectableBuilderPart(category: RetailPartCategory, name: string): boolean {
  const title = normalizeCatalogName(name);
  switch (category) {
    case 'gpu':
      return true; // GPU candidates have already passed the stricter GPU adapter.
    case 'cpu':
      return has(title, /\b(processor|ryzen|athlon|celeron|pentium|intel core)\b/)
        && !has(title, /\b(combo|bundle|starter kit)\b|\band\b.*\bmotherboard\b|\band\s+(asus|msi|gigabyte|asrock|biostar)\b/)
        // A CPU listing naming a board is selling both. Bare, not "and a
        // motherboard": the bundles that got through wrote it as "+", "with",
        // and as a second clause the older pattern did not reach.
        && !isCpuBoardBundle(title)
        && !isServerClassProcessor(title);
    case 'motherboard':
      return has(title, /\b(motherboard|mainboard)\b/)
        && !isServerBoard(title)
        && !has(title, /\b(combo|comb|bundle|starter kit|laptop|notebook|thinkcentre|replacement|extension cable)\b|motherboard\s+set\b|motherboard\b.*\bcpu\b.*\b(2x\d+gb|\d+gb ram|memory set)\b|motherboard\s+(and|with)\s+.*\b(cpu|processor|ram|memory)\b/);
    case 'ram':
      return has(title, /\b(ram|memory)\b/)
        && !has(title, /\b(laptop|notebook|sodimm|so dimm)\b/)
        && !isLegacyMemory(title);
    case 'storage':
      return has(title, /\b(ssd|solid state drive)\b/)
        && !has(title, /\b(enclosure|adapter|cable|dock|duplicator|carrying case|datacenter|data center)\b|\benterprise\s+(?:ssd|nvme|sata|drive)\b|\bd[3-7]\s+[sp]\d{4}\b|\bd7\s+[a-z]{1,3}\d+\b/);
    case 'psu':
      return has(title, /\b(atx|sfx|computer|desktop|workstation|pc)\b.*\b(power supply|psu)\b|\b(power supply|psu)\b.*\b(atx|sfx|computer|desktop|workstation|pc)\b/)
        && !has(title, /\b(ups|backup battery|mining|server|switching converter|power supply tester|breakout board|distribution board)\b|\b(?:adapter|converter)\s+board\b/);
    case 'case':
      return has(title, /\b(computer case|pc case|tower case|gaming case|desktop chassis|computer chassis)\b/)
        && !has(title, /\b(carrying|protective|fan only)\b|\brack\s?mount(?:ed|able)?\b|\b(?:server|storage|nas)\s+(?:chassis|series)\b/)
        && !isOpenBenchChassis(title);
    case 'cooler':
      return has(title, /\b(cpu cooler|cpu air cooler|liquid cpu cooler|aio liquid|processor cooler|cpu heatsink)\b/)
        && !has(title, /\b(case fan|laptop|notebook|router|switch|replacement)\b/);
    case 'monitor':
      return has(title, /\b(monitor|display)\b/)
        && !has(title, /\b(stand|mount|arm|screen protector|replacement panel)\b/)
        && !isMultipack(title);
    case 'keyboard':
      return has(title, /\bkeyboard\b/)
        && !has(title, /\b(cable|keycap|keycaps|switch tester|wrist rest|keyboard case)\b|^custom switch\b|\bswitches\b.*\b(pcs|housing)\b|\bswitches?\s*\(/);
    case 'mouse':
      return has(title, /\b(mouse|mice)\b/)
        && !has(title, /\b(mouse pad|mousepad|desk mat|skates|grips|feet|replacement cable)\b/);
    case 'headset':
      return has(title, /\b(headset|headphones)\b/)
        && !has(title, /\b(hook|holder|stand|battery|replacement|earpads|ear pads|earpad|ear pad|ear cushion|cushion cover|cooling gel|charging dock)\b|\bears universal\b/)
        && !accessoryLeadsHeadset(title);
  }
}

export function admitAffiliatePart(
  item: XmlElement,
  category: RetailPartCategory,
  expectedLeaf: string,
  fetchedAt: string,
): CatalogAdmission {
  if (childText(item, 'mid') !== NEWEGG_MID) return { status: 'rejected', reason: 'merchant' };
  if (readCategory(item).secondaryLeaf !== expectedLeaf) return { status: 'rejected', reason: 'category' };

  const sku = childText(item, 'sku');
  const name = childText(item, 'productname');
  const imageUrl = childText(item, 'imageurl');
  const trackedAffiliateUrl = childText(item, 'linkurl');
  if (!sku || !name || !imageUrl || !trackedAffiliateUrl) return { status: 'rejected', reason: 'required-field' };
  if (classifyListingCondition(name).issue) return { status: 'rejected', reason: 'condition' };
  if (!isSelectableBuilderPart(category, name)) return { status: 'rejected', reason: 'kind' };
  if (!isHttpUrl(imageUrl) || !isTrackedAffiliateUrl(trackedAffiliateUrl)) return { status: 'rejected', reason: 'url' };
  if (detectIdentityConflict(name, trackedAffiliateUrl)) return { status: 'rejected', reason: 'identity-conflict' };

  const pricing = readListingPricing(item);
  if (!pricing) return { status: 'rejected', reason: 'price' };

  return {
    status: 'accepted',
    part: {
      id: safeId(category, sku),
      category,
      merchant: 'Newegg',
      name,
      imageUrl,
      trackedAffiliateUrl,
      fetchedAt,
      availability: AVAILABILITY_UNKNOWN,
      retailPrice: pricing.retailPrice,
      salePrice: pricing.salePrice,
      currency: pricing.currency,
      canonicalPartId: null,
      // Non-GPU listings have no model matcher, so neither identity nor
      // specifications are established for them.
      specsVerified: false,
      // The merchant's item number verbatim, beside the slug derived from it.
      sku,
      upc: readUpc(childText(item, 'upccode')),
      // The Product Search feed publishes no dimensions and no specification
      // block, so nothing is established for this listing. Filling this from a
      // canonical model record is the defect partIdentity.ts exists for.
      unitSpecs: null,
      // Measured from the pixels later, once the quota is settled: there is no
      // reason to download five thousand candidate images to publish five
      // hundred. See attachImageContentRatios.
      imageContentRatio: null,
      // Measured together with the ratio, from the same fetched bytes.
      imageSha256: null,
    },
  };
}

/**
 * Reads `<price>` and `<saleprice>` off a listing, or refuses it.
 *
 * The same rules the GPU adapter's `admitOffer` already applies, reached here
 * through the SAME `readPrice` parser rather than a second reader:
 *
 *   - the retail price must parse, be above zero, and carry its own currency;
 *   - `saleprice=0` means "no sale running", not "free", so it becomes null;
 *   - a sale price must carry a currency of its own and match the retail one,
 *     because the two elements can legitimately differ and a discount silently
 *     relabelled into another currency is a wrong price that looks normal;
 *   - a sale price at or above the retail price is not a discount, and is
 *     dropped rather than displayed as one.
 *
 * A listing that fails any of these is REJECTED, not published without a
 * price: the generator simply takes the next qualified candidate, so the
 * catalogue reaches its quota with every part priced.
 */
export function readListingPricing(
  item: XmlElement,
): { retailPrice: number; salePrice: number | null; currency: string } | null {
  const price = readPrice(item, 'price');
  if (!price || price.amount === null || !price.currency) return null;

  const sale = readPrice(item, 'saleprice');
  let salePrice: number | null = null;
  if (sale && sale.amount !== null && sale.amount > 0) {
    // A discount in a different currency is not a discount we can render
    // beside the retail figure, so the listing loses the sale rather than the
    // price. Same-currency is the only comparable case.
    if (sale.currency && sale.currency === price.currency && sale.amount < price.amount) {
      salePrice = sale.amount;
    }
  }

  const pricing = { retailPrice: price.amount, salePrice, currency: price.currency };
  return checkPartPricing(pricing).ok ? pricing : null;
}

/**
 * A verified GPU offer, narrowed to a catalogue part.
 *
 * The offer already carries `retailPrice`, `salePrice` and `currency`, admitted
 * under the adapter's own price rules; they are carried through here rather
 * than re-derived. Returns null when the offer's pricing would not satisfy the
 * published schema — a sale price not below retail, say — so the generator
 * takes another candidate instead of publishing a part the reader would refuse.
 */
export function gpuOfferToAffiliatePart(offer: NeweggOffer): AffiliatePart | null {
  if (detectIdentityConflict(offer.productName, offer.trackedAffiliateUrl)) return null;
  // The adapter permits a sale price equal to or above the retail price; the
  // catalogue does not, because a card would strike the retail price through
  // and show a "discount" that is not one. Drop the sale, keep the listing.
  const salePrice = offer.salePrice !== null && offer.salePrice < offer.retailPrice ? offer.salePrice : null;
  const pricing = { retailPrice: offer.retailPrice, salePrice, currency: offer.currency };
  if (!checkPartPricing(pricing).ok) return null;

  return {
    id: safeId('gpu', offer.sku),
    category: 'gpu',
    merchant: 'Newegg',
    name: offer.productName,
    imageUrl: offer.imageUrl,
    trackedAffiliateUrl: offer.trackedAffiliateUrl,
    fetchedAt: offer.fetchedAt,
    availability: AVAILABILITY_UNKNOWN,
    retailPrice: pricing.retailPrice,
    salePrice: pricing.salePrice,
    currency: pricing.currency,
    canonicalPartId: offer.canonicalGpuId,
    // IDENTITY, not measurement. The matcher established which chip this
    // listing is, which is what `canonicalPartId` above records and what the
    // FPS estimator needs. Nothing measured the board that ships in the box —
    // its length, its power draw — so this flag stays false and the
    // compatibility checks that would need those figures are withheld rather
    // than answered from the generic model record. See src/lib/retail/partIdentity.ts.
    specsVerified: false,
    sku: offer.sku,
    upc: readUpc(offer.upc),
    // Identity was established by the model matcher; no dimension of the board
    // in the box was. See attachUnitSpecs in unitSpecs.ts.
    unitSpecs: null,
    imageContentRatio: null,
    imageSha256: null,
  };
}

/**
 * Measures every published part's photograph and records how much of its frame
 * the product spans.
 *
 * BEST EFFORT, ON PURPOSE. This runs inside the daily price refresh. An image
 * host that is slow, a format without a decoder, a product sitting off-centre
 * — none of those are reasons to withhold five hundred prices, so each one
 * simply leaves that part's ratio null and the card frames the image exactly
 * as it arrives today. The returned tally is for the run's log, so a
 * measurement that quietly stopped working is visible rather than silent.
 *
 * Requests go out `concurrency` at a time. The images are public files on a
 * CDN and carry no credential of ours; the limit is politeness and a bound on
 * how long the step can take, not a rate limit anyone imposed.
 */
export async function attachImageContentRatios(
  parts: readonly AffiliatePart[],
  measure: (url: string) => Promise<ImageMeasurement>,
  concurrency = 8,
): Promise<{
  parts: AffiliatePart[];
  measured: number;
  problems: Record<string, number>;
  failures: { id: string; sku: string | null; problem: string; imageUrl: string }[];
}> {
  const results = new Array<number | null>(parts.length).fill(null);
  // The hash of the bytes each ratio was measured from, so the published part
  // records WHICH version of the photograph it describes.
  const hashes = new Array<string | null>(parts.length).fill(null);
  const problems: Record<string, number> = {};
  /** The problem each part hit, positionally, so failures can be named. */
  const failureOf = new Array<string | undefined>(parts.length).fill(undefined);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= parts.length) return;
      const outcome = await measure(parts[index].imageUrl);
      if (outcome.ok) {
        results[index] = outcome.contentRatio;
        hashes[index] = outcome.sha256 ?? null;
      } else {
        problems[outcome.problem] = (problems[outcome.problem] ?? 0) + 1;
        failureOf[index] = outcome.problem;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  return {
    parts: parts.map((part, index) => ({
      ...part,
      imageContentRatio: results[index],
      imageSha256: hashes[index],
    })),
    measured: results.filter((value) => value !== null).length,
    problems,
    // WHICH parts, not just how many. The counts alone said "11 off-centre, 2
    // unsupported-format" and named none of them, so nobody could check
    // whether those thirteen images were fine or broken without opening the
    // catalogue file itself.
    failures: parts.flatMap((part, index) =>
      results[index] === null && failureOf[index] !== undefined
        ? [{ id: part.id, sku: part.sku, problem: failureOf[index] as string, imageUrl: part.imageUrl }]
        : [],
    ),
  };
}

export class AffiliateCatalogFailure extends Error {
  constructor(
    readonly code:
      | 'category-shortfall'
      | 'duplicate-part'
      | 'count-mismatch'
      /** A selected part carries pricing the published schema would refuse. */
      | 'price-missing'
      | 'catalog-invalid',
  ) {
    super(code);
  }
}

/**
 * Whether a listing's reading is still current at the instant it would be
 * published.
 *
 * A catalogue is written from one sweep, so a listing read before the
 * freshness window opened was read too long ago to be published as current.
 * It is refused at build time rather than written and hidden by the card
 * later: a file of listings the reader will withhold is a publication that
 * looks successful and shows nothing.
 *
 * A reading stamped in the future is refused too, rather than treated as
 * maximally fresh — otherwise the cheapest way to make an old price look
 * current would be to write tomorrow's date on it.
 */
export function isFreshAtPublication(part: AffiliatePart, generatedAt: string): boolean {
  const publishedAt = Date.parse(generatedAt);
  const read = Date.parse(part.fetchedAt);
  if (!Number.isFinite(read) || !Number.isFinite(publishedAt)) return false;
  if (read - publishedAt > MAX_CLOCK_SKEW_MS) return false;
  return publishedAt - read <= PRICE_FRESHNESS_MS;
}

/**
 * How the quota was filled, per category. For the run's log, so a selection
 * that quietly stopped considering most of the feed is visible.
 */
export interface CatalogSelectionReport {
  category: RetailPartCategory;
  /** Slots the category asked for. Never lowered to match what was found. */
  quota: number;
  /** Candidates evaluated — ALL of them, not a prefix. */
  considered: number;
  /** Rejected as outside the category's declared scope, by reason. */
  outOfScope: Record<string, number>;
  /** How coverage was spread: by verified attribute, or by fixed scope tier. */
  coverage: 'verified-attribute' | 'scope-tier';
  /** Distinct groups the slots were cycled over. */
  coverageGroups: number;
  /** Distinct products among them, after duplicate listings were consolidated. */
  distinctProducts: number;
  /** Listings dropped because another listing of the same product was cheaper. */
  consolidated: number;
  /** Candidates refused because their reading was already stale at publication. */
  stale: number;
  /** Refused by the consumer-product gate, by reason, BEFORE selection ran. */
  notConsumerProduct: Record<string, number>;
  /** A few real titles per reason, so a rule can be checked rather than trusted. */
  notConsumerProductTitles: { reason: string; name: string }[];
  /** Refused by the complete-product gate, by reason, BEFORE selection ran. */
  notCompleteProduct: Record<string, number>;
  /**
   * EVERY refusal, with its SKU and its complete untruncated title.
   *
   * Renamed from `notCompleteProductTitles`, which was a sample of at most
   * three clipped titles per reason and carried no identifier. Run
   * 35284766312 refused three legitimate products — an ASUS Pro WS W790-ACE
   * on "server-grade", a 15.6-inch portable monitor on "secondary screen",
   * and a complete iRocks mouse on the switch fitted inside it — and the
   * report could not say which listings they were. The name changed with the
   * shape on purpose: a field called `…Titles` that also holds SKUs, and a
   * sample that reads like a complete list, are both the kind of quiet
   * mismatch that hid the retailPrice/salePrice defect.
   */
  notCompleteProductRejections: { reason: string; sku: string | null; name: string }[];
  published: number;
  /** What the selected listings cost, low to high. Null when none was selected. */
  range: CatalogSelectionRange | null;
}

/**
 * Adds the per-category price range to the selection report.
 *
 * Reported rather than inferred by a reader: the range is the fastest way to
 * see whether a category's coverage actually spans its scope or has collapsed
 * to one end of it.
 */
export interface CatalogSelectionRange {
  lowUsd: number;
  highUsd: number;
}

/**
 * Chooses what each category would publish, and reports why, WITHOUT refusing.
 *
 * Split out of `buildAffiliatePartCatalog` so a dry run and a real build make
 * the same choices through the same code. The publication GATES stay in the
 * builder: this function never throws, so a shortfall is something a caller
 * can look at rather than something that stops the run before it can be
 * measured. A build still refuses — see below — it just refuses after the
 * report exists instead of instead of it.
 */
export function planCatalogSelection(
  candidates: ReadonlyMap<RetailPartCategory, readonly AffiliatePart[]>,
  generatedAt: string,
  scopes: ReadonlyMap<RetailPartCategory, CategoryPriceScope> = loadCategoryScopes(),
): { selected: AffiliatePart[]; report: CatalogSelectionReport[] } {
  const selected: AffiliatePart[] = [];
  const report: CatalogSelectionReport[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();

  for (const config of RETAIL_CATEGORY_CONFIG) {
    const supplied = candidates.get(config.category) ?? [];
    // THE CONSUMER-PRODUCT GATE, BEFORE ANYTHING COMPETES FOR A SLOT.
    //
    // Applied here rather than only at admission because the GPU sweep does
    // not go through admission at all, and because a listing rejected after
    // selection would already have taken a slot — leaving a hole in a full
    // quota while good candidates sat unexamined.
    const screened = screenConsumerProducts(supplied);
    // AND THE COMPLETE-PRODUCT GATE, AT THE SAME POINT AND FOR THE SAME REASON.
    //
    // Two gates rather than one because they ask different questions and a
    // reviewer needs to see which one fired: a TPM module is a consumer
    // product, and rejecting it under a `notConsumerProduct` tally would have
    // reported something untrue about it. Order does not affect the outcome —
    // both are pure — but running the consumer gate first keeps the existing
    // tallies comparable with previous runs.
    const complete = screenCompleteProducts(screened.kept);
    const all = complete.kept;
    const fresh = all.filter((part) => isFreshAtPublication(part, generatedAt));
    const scope = scopes.get(config.category);
    // No scope, no publication. A category whose bounds nobody set is a
    // category where any listing at any price would be admitted, which is the
    // state this replaced. Reported as a total shortfall rather than thrown,
    // so a dry run names the category instead of dying on the first one.
    if (scope === undefined) {
      report.push({
        category: config.category,
        quota: config.quota,
        considered: supplied.length,
        outOfScope: { 'no-scope-declared': all.length },
        coverage: 'scope-tier',
        coverageGroups: 0,
        distinctProducts: 0,
        consolidated: 0,
        stale: all.length - fresh.length,
        notConsumerProduct: screened.rejected,
        notConsumerProductTitles: screened.rejectedTitles,
        notCompleteProduct: complete.rejected,
        notCompleteProductRejections: complete.rejections,
        published: 0,
        range: null,
      });
      continue;
    }
    const outcome = selectBestListings(fresh, config.quota, scope, (part) =>
      ids.has(part.id) || names.has(listingIdentity(part)),
    );
    for (const part of outcome.selected) {
      ids.add(part.id);
      names.add(listingIdentity(part));
    }
    selected.push(...outcome.selected);
    const prices = outcome.selected.map((part) => part.salePrice ?? part.retailPrice);
    report.push({
      category: config.category,
      quota: config.quota,
      considered: outcome.considered,
      outOfScope: outcome.outOfScope,
      coverage: outcome.coverage,
      coverageGroups: outcome.coverageGroups,
      distinctProducts: outcome.distinctProducts,
      consolidated: outcome.consolidated,
      stale: all.length - fresh.length,
      notConsumerProduct: screened.rejected,
      notConsumerProductTitles: screened.rejectedTitles,
      notCompleteProduct: complete.rejected,
      notCompleteProductRejections: complete.rejections,
      published: outcome.selected.length,
      range: prices.length === 0 ? null : { lowUsd: Math.min(...prices), highUsd: Math.max(...prices) },
    });
  }

  return { selected, report };
}

export function buildAffiliatePartCatalog(
  candidates: ReadonlyMap<RetailPartCategory, readonly AffiliatePart[]>,
  generatedAt: string,
  report?: CatalogSelectionReport[],
  scopes: ReadonlyMap<RetailPartCategory, CategoryPriceScope> = loadCategoryScopes(),
): AffiliatePartCatalog {
  const plan = planCatalogSelection(candidates, generatedAt, scopes);
  report?.push(...plan.report);
  const selected = plan.selected;
  // The quota gate, applied after the plan exists so the plan can be reported.
  if (plan.report.some((row) => row.published < row.quota)) {
    throw new AffiliateCatalogFailure('category-shortfall');
  }
  if (new Set(selected.map((part) => part.id)).size !== selected.length) throw new AffiliateCatalogFailure('duplicate-part');
  if (selected.length !== AFFILIATE_PART_TARGET) throw new AffiliateCatalogFailure('count-mismatch');

  // 500 PARTS AND 500 PRICES. Checked as its own gate, before the schema
  // parse, so the failure names the actual problem: `catalog-invalid` would
  // say only that something in a 500-part document did not validate, and a
  // missing price is the one fault worth naming on its own.
  const priced = selected.filter((part) =>
    checkPartPricing({ retailPrice: part.retailPrice, salePrice: part.salePrice, currency: part.currency }).ok,
  );
  if (priced.length !== AFFILIATE_PART_TARGET) throw new AffiliateCatalogFailure('price-missing');

  const catalog: AffiliatePartCatalog = {
    schemaVersion: AFFILIATE_PART_CATALOG_SCHEMA_VERSION,
    generatedAt,
    merchant: 'Newegg',
    availability: AVAILABILITY_UNKNOWN,
    parts: selected,
  };
  const parsed = parseAffiliatePartCatalog(JSON.parse(JSON.stringify(catalog)));
  if (!parsed.ok) throw new AffiliateCatalogFailure('catalog-invalid');
  return parsed.catalog;
}
