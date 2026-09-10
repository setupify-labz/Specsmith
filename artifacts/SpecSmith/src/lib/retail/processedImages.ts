// Which picture a product card should actually load.
//
// BROWSER-SAFE AND PURE. No decoding, no fetching, no React — this is the rule
// that decides between a locally-hosted cut-out and the merchant's own image,
// so it can be tested directly.
//
// THE RULE
// --------
// A processed image is used only when ALL of the following hold:
//
//   1. a manifest entry names this exact part id;
//   2. that entry's `sourceUrl` equals the part's CURRENT imageUrl, so a
//      catalogue that now points somewhere else abandons the old cut-out;
//   2b. AND the catalogue's recorded SHA-256 of the bytes at that URL equals
//      the hash of the bytes the cut-out was made from. URL equality alone is
//      not version matching: merchants replace the picture behind a stable URL,
//      and a stale cut-out beside a new listing is a wrong product photo. A
//      part whose version the catalogue could not record is refused outright;
//   3. the entry actually produced a file (`outcome: 'processed'`);
//   4. a human has approved that file for display.
//
// Anything else resolves to the merchant's original URL. There is no "probably
// the same picture" branch: a cut-out is bound to the exact bytes it was made
// from, and the URL is the only handle on those bytes the browser has.
//
// APPROVAL IS NOT A FORMALITY
// ---------------------------
// Two separate things a machine cannot settle gate every cut-out: whether it
// LOOKS right (`approved`), and whether the affiliate programme permits
// modifying and self-hosting that merchant's photograph (`rightsBasis`). Both
// are required, and `rightsBasis` is free text because the answer is a clause
// or a written permission, not a flag someone can flip absent-mindedly.
//
// Until both are recorded the site serves the merchant's own unmodified image
// from the merchant's own CDN, which is what an affiliate feed is for and is
// unambiguously allowed. That is why this PR is safe to review with the
// licence question still open: nothing can display without an answer to it.

/** One entry as published in `public/data/product-images.json`. */
export interface ProductImageEntry {
  partId: string;
  /** The merchant image this cut-out was made from, exactly as the catalogue had it. */
  sourceUrl: string;
  /** SHA-256 of the source bytes. Provenance for a reviewer; the browser cannot verify it. */
  sourceSha256: string;
  outcome: 'processed' | 'kept-original';
  /** Same-origin path, present only when `outcome` is 'processed'. */
  processedPath?: string;
  /**
   * SHA-256 of the OUTPUT bytes, which is also the file's name.
   *
   * Content-addressing the output rather than the input is what makes a
   * regenerated cut-out a different URL. Two runs of a changed algorithm over
   * the same merchant photograph produce the same `sourceSha256` and different
   * `processedSha256`, so the new file cannot be shadowed by a CDN still
   * holding the old one under a name derived from the input.
   */
  processedSha256?: string;
  /** A person has confirmed the cut-out looks right. */
  approved?: boolean;
  /**
   * The recorded basis for modifying and self-hosting this merchant's
   * photograph — the clause, permission or written confirmation relied on.
   *
   * Required for display alongside `approved`, so a cut-out cannot reach the
   * page on someone's assumption that it was probably fine. An empty string is
   * not a basis.
   */
  rightsBasis?: string;
  reason?: string;
}

export interface ProductImageManifest {
  generatedAt: string;
  source: string;
  entries: ProductImageEntry[];
}

/** A part, narrowed to the fields this decision needs. */
export interface ImageSubject {
  id: string;
  imageUrl: string;
  /**
   * SHA-256 of the bytes currently at `imageUrl`, recorded by the catalogue
   * build. Null when that build could not measure the picture.
   */
  imageSha256?: string | null;
}

export type ImageChoice =
  | { kind: 'processed'; src: string; fallbackSrc: string; entry: ProductImageEntry }
  | { kind: 'original'; src: string; reason: OriginalReason };

export type OriginalReason =
  | 'no-manifest'
  | 'no-entry-for-part'
  | 'source-image-changed'
  /** The catalogue does not say which version of the picture it is serving. */
  | 'source-version-unknown'
  /** The bytes at that URL are not the bytes the cut-out was made from. */
  | 'source-bytes-changed'
  | 'not-processed'
  | 'not-approved'
  /** Approved, but no licence basis for modifying and self-hosting was recorded. */
  | 'no-rights-basis';

/** Where every processed file must live. */
export const PROCESSED_PATH_PREFIX = '/images/products/';

/**
 * The only path a processed entry may name, derived from the OUTPUT's hash.
 *
 * Named after what the file contains, not what it was made from: an improved
 * algorithm re-cutting the same photograph must produce a new URL, or a cache
 * holding the old cut-out would go on serving it indefinitely.
 */
export function expectedProcessedPath(processedSha256: string): string {
  return `${PROCESSED_PATH_PREFIX}${processedSha256}.png`;
}

export type ManifestRejectionReason =
  | 'not-an-object'
  | 'entries-not-an-array'
  | 'entry-not-an-object'
  | 'bad-part-id'
  | 'bad-source-url'
  | 'bad-source-hash'
  | 'bad-processed-hash'
  | 'bad-outcome'
  | 'bad-approved-flag'
  | 'bad-rights-basis'
  | 'missing-processed-path'
  | 'processed-path-not-ours'
  | 'unexpected-processed-path'
  | 'duplicate-part-id';

export interface ManifestRejection {
  partId: string | null;
  reason: ManifestRejectionReason;
  detail: string;
}

export interface ParsedProductImageManifest {
  entries: ProductImageEntry[];
  /** Everything thrown away, and why. Surfaced so a bad file is diagnosable. */
  rejections: ManifestRejection[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isSha256 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

/**
 * Validates a product-image manifest before any of it is believed.
 *
 * THIS FILE IS AN INPUT, NOT A CONFIGURATION. It decides which URL the browser
 * loads into an <img> on a page about things people buy, so it is parsed with
 * the same suspicion as any other untrusted document: a manifest that has been
 * tampered with, half-written by a crashed run, or hand-edited must not be able
 * to point a card anywhere.
 *
 * The processed path is not "checked" so much as DERIVED. An entry may name
 * exactly one path — `/images/products/<its own sourceSha256>.png` — and any
 * other string is rejected whatever it looks like. That single equality is what
 * rules out absolute URLs to another origin, protocol-relative `//evil.test`,
 * `../` traversal, a path belonging to a different image, and a file name that
 * disagrees with the hash it claims, without needing a rule per attack.
 *
 * Duplicates are dropped ENTIRELY rather than resolved. Two entries for one
 * part is a defect, and picking either would make which picture a shopper sees
 * depend on file order.
 */
export function parseProductImageManifest(raw: unknown): ParsedProductImageManifest {
  const rejections: ManifestRejection[] = [];
  const reject = (partId: string | null, reason: ManifestRejectionReason, detail: string) => {
    rejections.push({ partId, reason, detail });
  };

  if (!isObject(raw)) {
    reject(null, 'not-an-object', 'The manifest is not a JSON object.');
    return { entries: [], rejections };
  }
  if (!Array.isArray(raw.entries)) {
    reject(null, 'entries-not-an-array', 'The manifest has no `entries` array.');
    return { entries: [], rejections };
  }

  const accepted: ProductImageEntry[] = [];
  for (const candidate of raw.entries) {
    if (!isObject(candidate)) {
      reject(null, 'entry-not-an-object', 'An entry is not an object.');
      continue;
    }
    const { partId, sourceUrl, sourceSha256, processedSha256, outcome, processedPath, approved, rightsBasis, reason } =
      candidate;

    if (typeof partId !== 'string' || partId.trim() === '') {
      reject(null, 'bad-part-id', 'An entry has no usable part id.');
      continue;
    }
    if (typeof sourceUrl !== 'string' || !/^https?:\/\//i.test(sourceUrl)) {
      reject(partId, 'bad-source-url', `${partId}: sourceUrl is not an http(s) URL.`);
      continue;
    }
    if (!isSha256(sourceSha256)) {
      reject(partId, 'bad-source-hash', `${partId}: sourceSha256 is not a 64-character hex digest.`);
      continue;
    }
    if (outcome !== 'processed' && outcome !== 'kept-original') {
      reject(partId, 'bad-outcome', `${partId}: outcome ${JSON.stringify(outcome)} is not a known outcome.`);
      continue;
    }
    if (approved !== undefined && typeof approved !== 'boolean') {
      reject(partId, 'bad-approved-flag', `${partId}: approved must be a boolean when present.`);
      continue;
    }
    if (rightsBasis !== undefined && typeof rightsBasis !== 'string') {
      reject(partId, 'bad-rights-basis', `${partId}: rightsBasis must be a string when present.`);
      continue;
    }

    if (outcome === 'processed') {
      if (typeof processedPath !== 'string' || processedPath === '') {
        reject(partId, 'missing-processed-path', `${partId}: a processed entry names no file.`);
        continue;
      }
      if (!isSha256(processedSha256)) {
        reject(partId, 'bad-processed-hash', `${partId}: processedSha256 is not a 64-character hex digest.`);
        continue;
      }
      const expected = expectedProcessedPath(processedSha256);
      if (processedPath !== expected) {
        // One equality covers other origins, protocol-relative hosts,
        // traversal, and a name that disagrees with its own hash.
        reject(
          partId,
          'processed-path-not-ours',
          `${partId}: processedPath ${JSON.stringify(processedPath)} is not ${expected}.`,
        );
        continue;
      }
    } else if (processedPath !== undefined) {
      reject(
        partId,
        'unexpected-processed-path',
        `${partId}: an entry that kept the original must not name a processed file.`,
      );
      continue;
    }

    accepted.push({
      partId,
      sourceUrl,
      sourceSha256,
      outcome,
      ...(typeof processedPath === 'string' ? { processedPath } : {}),
      ...(isSha256(processedSha256) ? { processedSha256 } : {}),
      ...(typeof approved === 'boolean' ? { approved } : {}),
      ...(typeof rightsBasis === 'string' ? { rightsBasis } : {}),
      ...(typeof reason === 'string' ? { reason } : {}),
    });
  }

  const seen = new Map<string, number>();
  for (const entry of accepted) seen.set(entry.partId, (seen.get(entry.partId) ?? 0) + 1);
  const entries = accepted.filter((entry) => {
    if ((seen.get(entry.partId) ?? 0) > 1) return false;
    return true;
  });
  for (const [partId, count] of seen) {
    if (count > 1) {
      reject(partId, 'duplicate-part-id', `${partId}: ${count} entries name this part; all are discarded.`);
    }
  }

  return { entries, rejections };
}

/**
 * Validates a manifest and indexes what survives, by part id.
 *
 * Takes `unknown` deliberately: there is no shape to trust before parsing.
 */
export function indexManifest(raw: unknown): Map<string, ProductImageEntry> {
  const byPart = new Map<string, ProductImageEntry>();
  for (const entry of parseProductImageManifest(raw).entries) byPart.set(entry.partId, entry);
  return byPart;
}

/**
 * Decides which image URL a card should load.
 *
 * Always returns something loadable: the fallback is the merchant's own URL,
 * which is what the card used before any of this existed.
 */
export function chooseProductImage(
  part: ImageSubject,
  byPart: Map<string, ProductImageEntry> | null | undefined,
): ImageChoice {
  const original = part.imageUrl;
  if (!byPart || byPart.size === 0) return { kind: 'original', src: original, reason: 'no-manifest' };

  const entry = byPart.get(part.id);
  if (!entry) return { kind: 'original', src: original, reason: 'no-entry-for-part' };

  // The cut-out belongs to one specific photograph. If the catalogue now points
  // somewhere else, this cut-out is of a different picture.
  if (entry.sourceUrl !== original) {
    return { kind: 'original', src: original, reason: 'source-image-changed' };
  }
  // A URL identifies a LOCATION, not a version. A merchant can replace the
  // photograph behind an unchanged URL whenever it likes — a new angle, a new
  // cooler revision, a different card entirely — and a cut-out made from the
  // old bytes would then be shown beside the new listing. So the catalogue's
  // recorded hash of what is actually at that URL must equal the hash of the
  // bytes this cut-out was made from.
  if (!part.imageSha256) {
    return { kind: 'original', src: original, reason: 'source-version-unknown' };
  }
  if (part.imageSha256 !== entry.sourceSha256) {
    return { kind: 'original', src: original, reason: 'source-bytes-changed' };
  }
  if (entry.outcome !== 'processed' || !entry.processedPath) {
    return { kind: 'original', src: original, reason: 'not-processed' };
  }
  if (entry.approved !== true) return { kind: 'original', src: original, reason: 'not-approved' };
  if (!entry.rightsBasis || entry.rightsBasis.trim() === '') {
    return { kind: 'original', src: original, reason: 'no-rights-basis' };
  }

  return { kind: 'processed', src: entry.processedPath, fallbackSrc: original, entry };
}
