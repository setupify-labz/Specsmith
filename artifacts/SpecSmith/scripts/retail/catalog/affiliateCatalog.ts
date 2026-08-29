import {
  AFFILIATE_PART_CATALOG_SCHEMA_VERSION,
  AFFILIATE_PART_TARGET,
  parseAffiliatePartCatalog,
  type AffiliatePart,
  type AffiliatePartCatalog,
  type RetailPartCategory,
} from '../../../src/lib/retail/partCatalog';
import { AVAILABILITY_UNKNOWN, isHttpUrl, isTrackedAffiliateUrl } from '../../../src/lib/retail/offerSnapshot';
import { childText, type XmlElement } from '../rakuten/parseProductSearchXml';
import { classifyListingCondition } from '../rakuten/listingKind';
import { readCategory } from '../rakuten/admitOffer';
import { NEWEGG_MID, type NeweggOffer } from '../rakuten/types';
import { RETAIL_CATEGORY_CONFIG } from './catalogConfig';

export type CatalogAdmission =
  | { status: 'accepted'; part: AffiliatePart }
  | { status: 'rejected'; reason: 'merchant' | 'category' | 'required-field' | 'condition' | 'kind' | 'url' };

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
        && !has(title, /\b(combo|bundle|starter kit)\b|\band\b.*\bmotherboard\b/);
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
      canonicalPartId: null,
      specsVerified: false,
    },
  };
}

export function gpuOfferToAffiliatePart(offer: NeweggOffer): AffiliatePart {
  return {
    id: safeId('gpu', offer.sku),
    category: 'gpu',
    merchant: 'Newegg',
    name: offer.productName,
    imageUrl: offer.imageUrl,
    trackedAffiliateUrl: offer.trackedAffiliateUrl,
    fetchedAt: offer.fetchedAt,
    availability: AVAILABILITY_UNKNOWN,
    canonicalPartId: offer.canonicalGpuId,
    specsVerified: true,
  };
}

export class AffiliateCatalogFailure extends Error {
  constructor(readonly code: 'category-shortfall' | 'duplicate-part' | 'count-mismatch' | 'catalog-invalid') {
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
