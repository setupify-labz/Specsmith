// A deliberately narrow, short-lived review record for accepted GPU offers.
//
// This is not the public snapshot. It exists only so a human can inspect the
// merchant title behind every accepted match before the first price file is
// published. Prices, URLs and retailer identifiers are deliberately absent.

import { catalogMention, findGpuMentions, findMemorySizes, mentionKey } from '../rakuten/gpuModelMatch';
import type { CatalogGpu, NeweggOffer } from '../rakuten/types';

export const ACCEPTED_OFFER_AUDIT_SCHEMA_VERSION = 1;
export const REFUSED_TITLE = '[title refused by sanitizer]';

export interface AcceptedOfferAuditRow {
  gpuId: string;
  catalogName: string;
  title: string;
  titleRefused: boolean;
  detectedModel: string;
  detectedSuffixes: string[];
  modelMentionCount: number;
  expectedMemoryGb: number;
  titleMemoryGb: number[];
  memoryFromDescriptionOnly: boolean;
}

export const AUDIT_ROW_KEYS: readonly (keyof AcceptedOfferAuditRow)[] = [
  'gpuId',
  'catalogName',
  'title',
  'titleRefused',
  'detectedModel',
  'detectedSuffixes',
  'modelMentionCount',
  'expectedMemoryGb',
  'titleMemoryGb',
  'memoryFromDescriptionOnly',
];

export interface AcceptedOfferAuditFile {
  schemaVersion: typeof ACCEPTED_OFFER_AUDIT_SCHEMA_VERSION;
  generatedAt: string;
  catalogGpuCount: number;
  acceptedOfferCount: number;
  refusedTitleCount: number;
  rows: AcceptedOfferAuditRow[];
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const WORKFLOW_COMMAND = /::[a-z][a-z0-9_-]*::/i;
const FORMULA_PREFIX = /^[\s\uFEFF]*[=+\-@]/;
const URL = /\b(?:https?:\/\/|www\.)\S+/gi;
const LEADING_PRICE = /(?:[$€£¥]\s*\d+(?:[,.]\d{1,2})?)/g;
const TRAILING_PRICE = /\b\d+(?:[,.]\d{1,2})?\s*(?:USD|CAD|EUR|GBP|JPY)\b/gi;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Makes the one upstream-controlled field safe to keep in a JSON artifact.
 *
 * Known SKU/UPC values and URLs are removed. A title carrying a control
 * character, a GitHub workflow-command shape or a spreadsheet-formula prefix
 * is refused whole: preserving questionable text is unnecessary for deciding
 * whether the GPU model is correct, and the artifact may later be opened by a
 * human-facing tool.
 */
export function sanitizeAuditTitle(
  raw: string,
  identifiers: readonly (string | null | undefined)[] = [],
): { title: string; refused: boolean } {
  if (CONTROL_CHARACTERS.test(raw) || WORKFLOW_COMMAND.test(raw) || FORMULA_PREFIX.test(raw)) {
    return { title: REFUSED_TITLE, refused: true };
  }

  let title = raw
    .replace(URL, '[url removed]')
    .replace(LEADING_PRICE, '[price removed]')
    .replace(TRAILING_PRICE, '[price removed]');
  for (const identifier of identifiers) {
    if (!identifier || identifier.length < 4) continue;
    title = title.replace(new RegExp(escapeRegExp(identifier), 'gi'), '[identifier removed]');
  }
  title = title.replace(/\s+/g, ' ').trim();
  if (title === '' || title.length > 300 || FORMULA_PREFIX.test(title) || WORKFLOW_COMMAND.test(title)) {
    return { title: REFUSED_TITLE, refused: true };
  }
  return { title, refused: false };
}

export function buildAuditRow(gpu: CatalogGpu, offer: NeweggOffer): AcceptedOfferAuditRow {
  const title = sanitizeAuditTitle(offer.productName, [offer.sku, offer.upc]);
  const mentions = findGpuMentions(offer.productName);
  const detected = mentions.length === 1 ? mentionKey(mentions[0]) : mentions.map(mentionKey).join(' | ');
  const memory = findMemorySizes(offer.productName);

  return {
    gpuId: gpu.id,
    catalogName: gpu.name,
    title: title.title,
    titleRefused: title.refused,
    detectedModel: detected,
    detectedSuffixes: mentions.length === 1 ? [...mentions[0].suffixes] : [],
    modelMentionCount: mentions.length,
    expectedMemoryGb: gpu.vram_gb,
    titleMemoryGb: memory,
    // An accepted offer must state exactly one matching capacity in the title
    // or short description. NeweggOffer intentionally does not retain the
    // description, so no title capacity means the accepted evidence came from
    // that description only; this is review evidence, not a new inference.
    memoryFromDescriptionOnly: memory.length === 0,
  };
}

export function buildAcceptedOfferAudit(
  catalog: readonly CatalogGpu[],
  offers: readonly NeweggOffer[],
  generatedAt: string,
): AcceptedOfferAuditFile {
  const byId = new Map(catalog.map((gpu) => [gpu.id, gpu]));
  const rows = offers.map((offer) => {
    const gpu = byId.get(offer.canonicalGpuId);
    if (!gpu) throw new Error('accepted-offer-audit: offer references an unexpected catalogue GPU');
    const target = mentionKey(catalogMention(gpu));
    const row = buildAuditRow(gpu, offer);
    if (row.modelMentionCount !== 1 || row.detectedModel !== target) {
      throw new Error('accepted-offer-audit: accepted offer no longer satisfies model evidence');
    }
    return row;
  });

  rows.sort((a, b) => a.gpuId.localeCompare(b.gpuId) || a.title.localeCompare(b.title));
  return {
    schemaVersion: ACCEPTED_OFFER_AUDIT_SCHEMA_VERSION,
    generatedAt,
    catalogGpuCount: catalog.length,
    acceptedOfferCount: rows.length,
    refusedTitleCount: rows.filter((row) => row.titleRefused).length,
    rows,
  };
}

/** Counts only. Safe for a CI log. */
export function describeAudit(file: AcceptedOfferAuditFile): string {
  return `Audit artifact prepared: ${file.catalogGpuCount} catalogue GPU(s), ${file.acceptedOfferCount} accepted offer(s), ${file.refusedTitleCount} refused title(s).`;
}
