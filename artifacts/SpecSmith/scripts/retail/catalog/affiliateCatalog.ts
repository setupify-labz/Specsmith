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

export type CatalogAdmission =
  | { status: 'accepted'; part: AffiliatePart }
  | {
      status: 'rejected';
      reason: 'merchant' | 'category' | 'required-field' | 'condition' | 'kind' | 'url' | 'price';
    };

const safeId = (category: RetailPartCategory, sku: string): string =>
  `newegg-${category}-${sku.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/-+$/g, '');

export const normalizeCatalogName = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const has = (title: string, pattern: RegExp): boolean => pattern.test(title);

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
      specsVerified: false,
      // Measured from the pixels later, once the quota is settled: there is no
      // reason to download five thousand candidate images to publish five
      // hundred. See attachImageContentRatios.
      imageContentRatio: null,
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
    specsVerified: true,
    imageContentRatio: null,
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
      } else {
        problems[outcome.problem] = (problems[outcome.problem] ?? 0) + 1;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  return {
    parts: parts.map((part, index) => ({ ...part, imageContentRatio: results[index] })),
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

export function buildAffiliatePartCatalog(
  candidates: ReadonlyMap<RetailPartCategory, readonly AffiliatePart[]>,
  generatedAt: string,
): AffiliatePartCatalog {
  const selected: AffiliatePart[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const config of RETAIL_CATEGORY_CONFIG) {
    const unique = (candidates.get(config.category) ?? []).filter((part) => {
      const name = normalizeCatalogName(part.name);
      if (ids.has(part.id) || names.has(name)) return false;
      ids.add(part.id);
      names.add(name);
      return true;
    });
    if (unique.length < config.quota) throw new AffiliateCatalogFailure('category-shortfall');
    selected.push(...unique.slice(0, config.quota));
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
