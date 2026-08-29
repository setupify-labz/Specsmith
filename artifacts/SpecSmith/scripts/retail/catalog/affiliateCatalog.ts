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
  | { status: 'rejected'; reason: 'merchant' | 'category' | 'required-field' | 'condition' | 'url' };

const safeId = (category: RetailPartCategory, sku: string): string =>
  `newegg-${category}-${sku.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/-+$/g, '');

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
  for (const config of RETAIL_CATEGORY_CONFIG) {
    const unique = (candidates.get(config.category) ?? []).filter((part) => {
      if (ids.has(part.id)) return false;
      ids.add(part.id);
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
