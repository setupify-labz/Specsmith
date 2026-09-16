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
export function isSelectableBuilderPart(category: RetailPartCategory, name: string): boolean {
  const title = normalizeCatalogName(name);
  switch (category) {
    case 'gpu':
      return true; // GPU candidates have already passed the stricter GPU adapter.
    case 'cpu':
      return has(title, /\b(processor|ryzen|athlon|celeron|pentium|intel core)\b/)
        && !has(title, /\b(combo|bundle|starter kit)\b|\band\b.*\bmotherboard\b|\band\s+(asus|msi|gigabyte|asrock|biostar)\b/);
    case 'motherboard':
      return has(title, /\b(motherboard|mainboard)\b/)
        && !has(title, /\b(combo|comb|bundle|starter kit|laptop|notebook|thinkcentre|replacement|extension cable)\b|motherboard\s+set\b|motherboard\b.*\bcpu\b.*\b(2x\d+gb|\d+gb ram|memory set)\b|motherboard\s+(and|with)\s+.*\b(cpu|processor|ram|memory)\b/);
    case 'ram':
      return has(title, /\b(ram|memory)\b/)
        && !has(title, /\b(laptop|notebook|sodimm|so dimm)\b/);
    case 'storage':
      return has(title, /\b(ssd|solid state drive)\b/)
        && !has(title, /\b(enclosure|adapter|cable|dock|duplicator|carrying case)\b/);
    case 'psu':
      return has(title, /\b(atx|sfx|computer|desktop|workstation|pc)\b.*\b(power supply|psu)\b|\b(power supply|psu)\b.*\b(atx|sfx|computer|desktop|workstation|pc)\b/)
        && !has(title, /\b(ups|backup battery|mining|server|switching converter|power supply tester)\b/);
    case 'case':
      return has(title, /\b(computer case|pc case|tower case|gaming case|desktop chassis|computer chassis)\b/)
        && !has(title, /\b(carrying|protective|fan only)\b/);
    case 'cooler':
      return has(title, /\b(cpu cooler|cpu air cooler|liquid cpu cooler|aio liquid|processor cooler|cpu heatsink)\b/)
        && !has(title, /\b(case fan|laptop|notebook|router|switch|replacement)\b/);
    case 'monitor':
      return has(title, /\b(monitor|display)\b/)
        && !has(title, /\b(stand|mount|arm|screen protector|replacement panel)\b/);
    case 'keyboard':
      return has(title, /\bkeyboard\b/)
        && !has(title, /\b(cable|keycap|keycaps|switch tester|wrist rest|keyboard case)\b|^custom switch\b|\bswitches\b.*\b(pcs|housing)\b|\bswitches?\s*\(/);
    case 'mouse':
      return has(title, /\b(mouse|mice)\b/)
        && !has(title, /\b(mouse pad|mousepad|desk mat|skates|grips|feet|replacement cable)\b/);
    case 'headset':
      return has(title, /\b(headset|headphones)\b/)
        && !has(title, /\b(hook|holder|stand|battery|replacement|earpads|ear pads|earpad|ear pad|ear cushion|cushion cover|cooling gel|charging dock)\b|\bears universal\b/);
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
): Promise<{ parts: AffiliatePart[]; measured: number; problems: Record<string, number> }> {
  const results = new Array<number | null>(parts.length).fill(null);
  // The hash of the bytes each ratio was measured from, so the published part
  // records WHICH version of the photograph it describes.
  const hashes = new Array<string | null>(parts.length).fill(null);
  const problems: Record<string, number> = {};
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
 * How the quota was filled, per category. For the run's log, so a selection
 * that quietly stopped considering most of the feed is visible.
 */
export interface CatalogSelectionReport {
  category: RetailPartCategory;
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
  published: number;
}

export function buildAffiliatePartCatalog(
  candidates: ReadonlyMap<RetailPartCategory, readonly AffiliatePart[]>,
  generatedAt: string,
  report?: CatalogSelectionReport[],
  scopes: ReadonlyMap<RetailPartCategory, CategoryPriceScope> = loadCategoryScopes(),
): AffiliatePartCatalog {
  const selected: AffiliatePart[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  // A catalogue is written from one sweep, so a listing whose reading is
  // already outside the freshness window at publication time was read too long
  // ago to be published as current. It is refused here rather than written and
  // hidden by the card later: a file full of listings the reader will withhold
  // is a publication that looks successful and shows nothing.
  const publishedAt = Date.parse(generatedAt);
  const isStaleAtPublication = (part: AffiliatePart): boolean => {
    const read = Date.parse(part.fetchedAt);
    if (!Number.isFinite(read) || !Number.isFinite(publishedAt)) return true;
    if (read - publishedAt > MAX_CLOCK_SKEW_MS) return true;
    return publishedAt - read > PRICE_FRESHNESS_MS;
  };

  for (const config of RETAIL_CATEGORY_CONFIG) {
    const all = candidates.get(config.category) ?? [];
    const fresh = all.filter((part) => !isStaleAtPublication(part));
    const scope = scopes.get(config.category);
    // No scope, no publication. A category whose bounds nobody set is a
    // category where any listing at any price would be admitted, which is the
    // state this replaced.
    if (scope === undefined) throw new AffiliateCatalogFailure('category-shortfall');
    const outcome = selectBestListings(fresh, config.quota, scope, (part) =>
      ids.has(part.id) || names.has(listingIdentity(part)),
    );
    if (outcome.selected.length < config.quota) throw new AffiliateCatalogFailure('category-shortfall');
    for (const part of outcome.selected) {
      ids.add(part.id);
      names.add(listingIdentity(part));
    }
    selected.push(...outcome.selected);
    report?.push({
      category: config.category,
      considered: outcome.considered,
      distinctProducts: outcome.distinctProducts,
      consolidated: outcome.consolidated,
      outOfScope: outcome.outOfScope,
      coverage: outcome.coverage,
      coverageGroups: outcome.coverageGroups,
      stale: all.length - fresh.length,
      published: outcome.selected.length,
    });
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
