// Browser-safe schema for the image-and-link retail catalog.
//
// This is deliberately NOT a price snapshot. The user-facing feature is a
// verified retailer image and tracked affiliate destination. Prices and stock
// are omitted because neither can stay true for the lifetime of a committed
// static catalog. The merchant page is the source of truth after a click.

import { AVAILABILITY_UNKNOWN, isHttpUrl, isInstant, isTrackedAffiliateUrl } from './offerSnapshot';

export const AFFILIATE_PART_CATALOG_SCHEMA_VERSION = 1;
export const AFFILIATE_PART_CATALOG_URL = '/data/retail-parts.json';
export const AFFILIATE_PART_TARGET = 500;

export const RETAIL_PART_CATEGORIES = [
  'gpu',
  'cpu',
  'motherboard',
  'ram',
  'storage',
  'psu',
  'case',
  'cooler',
  'monitor',
  'keyboard',
  'mouse',
  'headset',
] as const;

export type RetailPartCategory = (typeof RETAIL_PART_CATEGORIES)[number];

export interface AffiliatePart {
  /** Stable, repository-safe identity derived from category + Newegg SKU. */
  id: string;
  category: RetailPartCategory;
  merchant: 'Newegg';
  /** Merchant title, unchanged. */
  name: string;
  imageUrl: string;
  /** Network-generated redirect; attribution is already encoded in it. */
  trackedAffiliateUrl: string;
  fetchedAt: string;
  availability: typeof AVAILABILITY_UNKNOWN;
  /** Present only when the existing SpecSmith catalog verified the specs. */
  canonicalPartId: string | null;
  specsVerified: boolean;
}

export interface AffiliatePartCatalog {
  schemaVersion: number;
  generatedAt: string;
  merchant: 'Newegg';
  availability: typeof AVAILABILITY_UNKNOWN;
  parts: AffiliatePart[];
}

export type AffiliateCatalogProblem =
  | 'not-an-object'
  | 'schema-version-unsupported'
  | 'generated-at-invalid'
  | 'merchant-invalid'
  | 'availability-not-unknown'
  | 'parts-not-an-array'
  | 'part-invalid'
  | 'duplicate-part-id';

export type AffiliateCatalogParse =
  | { ok: true; catalog: AffiliatePartCatalog }
  | { ok: false; problem: AffiliateCatalogProblem };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

const isCategory = (value: unknown): value is RetailPartCategory =>
  typeof value === 'string' && (RETAIL_PART_CATEGORIES as readonly string[]).includes(value);

function parsePart(raw: unknown): AffiliatePart | null {
  if (!isObject(raw)) return null;
  const { id, category, merchant, name, imageUrl, trackedAffiliateUrl, fetchedAt, availability, canonicalPartId, specsVerified } = raw;
  if (!isText(id) || !/^newegg-[a-z]+-[a-z0-9-]+$/.test(id)) return null;
  if (!isCategory(category) || merchant !== 'Newegg' || !isText(name)) return null;
  if (!isHttpUrl(imageUrl) || !isTrackedAffiliateUrl(trackedAffiliateUrl)) return null;
  if (!isInstant(fetchedAt) || availability !== AVAILABILITY_UNKNOWN) return null;
  if (canonicalPartId !== null && !isText(canonicalPartId)) return null;
  if (typeof specsVerified !== 'boolean' || specsVerified !== (canonicalPartId !== null)) return null;
  return {
    id,
    category,
    merchant: 'Newegg',
    name,
    imageUrl: imageUrl as string,
    trackedAffiliateUrl: trackedAffiliateUrl as string,
    fetchedAt,
    availability: AVAILABILITY_UNKNOWN,
    canonicalPartId: canonicalPartId as string | null,
    specsVerified,
  };
}

export function parseAffiliatePartCatalog(raw: unknown): AffiliateCatalogParse {
  if (!isObject(raw)) return { ok: false, problem: 'not-an-object' };
  if (raw.schemaVersion !== AFFILIATE_PART_CATALOG_SCHEMA_VERSION) {
    return { ok: false, problem: 'schema-version-unsupported' };
  }
  if (!isInstant(raw.generatedAt)) return { ok: false, problem: 'generated-at-invalid' };
  if (raw.merchant !== 'Newegg') return { ok: false, problem: 'merchant-invalid' };
  if (raw.availability !== AVAILABILITY_UNKNOWN) return { ok: false, problem: 'availability-not-unknown' };
  if (!Array.isArray(raw.parts)) return { ok: false, problem: 'parts-not-an-array' };

  const parts: AffiliatePart[] = [];
  const ids = new Set<string>();
  for (const candidate of raw.parts) {
    const part = parsePart(candidate);
    if (!part) return { ok: false, problem: 'part-invalid' };
    if (ids.has(part.id)) return { ok: false, problem: 'duplicate-part-id' };
    ids.add(part.id);
    parts.push(part);
  }
  return {
    ok: true,
    catalog: {
      schemaVersion: AFFILIATE_PART_CATALOG_SCHEMA_VERSION,
      generatedAt: raw.generatedAt as string,
      merchant: 'Newegg',
      availability: AVAILABILITY_UNKNOWN,
      parts,
    },
  };
}
