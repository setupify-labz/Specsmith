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
//   2. that entry's `sourceUrl` is byte-identical to the part's CURRENT
//      imageUrl — so if the merchant re-photographs a product or the catalogue
//      refresh points at a different picture, the cut-out made from the OLD
//      picture is abandoned rather than shown against the new listing;
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

/** A part, narrowed to the two fields this decision needs. */
export interface ImageSubject {
  id: string;
  imageUrl: string;
}

export type ImageChoice =
  | { kind: 'processed'; src: string; fallbackSrc: string; entry: ProductImageEntry }
  | { kind: 'original'; src: string; reason: OriginalReason };

export type OriginalReason =
  | 'no-manifest'
  | 'no-entry-for-part'
  | 'source-image-changed'
  | 'not-processed'
  | 'not-approved'
  /** Approved, but no licence basis for modifying and self-hosting was recorded. */
  | 'no-rights-basis';

/** Index a manifest by part id once, rather than scanning it per card. */
export function indexManifest(manifest: ProductImageManifest | null | undefined): Map<string, ProductImageEntry> {
  const byPart = new Map<string, ProductImageEntry>();
  for (const entry of manifest?.entries ?? []) {
    // First entry wins; a duplicate part id is a manifest defect, and silently
    // preferring the later one would make which picture you get depend on file
    // order.
    if (!byPart.has(entry.partId)) byPart.set(entry.partId, entry);
  }
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
  if (entry.outcome !== 'processed' || !entry.processedPath) {
    return { kind: 'original', src: original, reason: 'not-processed' };
  }
  if (entry.approved !== true) return { kind: 'original', src: original, reason: 'not-approved' };
  if (!entry.rightsBasis || entry.rightsBasis.trim() === '') {
    return { kind: 'original', src: original, reason: 'no-rights-basis' };
  }

  return { kind: 'processed', src: entry.processedPath, fallbackSrc: original, entry };
}
