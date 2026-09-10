import { useEffect, useState } from 'react';

import {
  chooseProductImage,
  type ImageSubject,
  type ProductImageEntry,
} from '../lib/retail/processedImages';

export interface ResolvedProductImage {
  /** The URL to put in `src` right now. */
  src: string;
  /** True once nothing loadable is left, so the caller shows its placeholder. */
  failed: boolean;
  /** Whose picture this currently is, for tests and for evidence in a capture. */
  source: 'processed' | 'merchant';
  onError: () => void;
}

/**
 * Which picture to load for a listing, and what to do when it will not load.
 *
 * ONE LADDER, THREE PLACES. The card, the detail drawer and the build summary
 * all show the same product, so they must make the same choice and degrade the
 * same way: approved cut-out, then the merchant's own image, then the
 * placeholder. Written once because three copies of a fallback ladder is how
 * one of them ends up showing a broken image where the others show a photo.
 *
 * A MISSING CUT-OUT COSTS THE CUT-OUT, NEVER THE PICTURE. If the local file is
 * gone or corrupt, the merchant URL is tried before anything is called failed —
 * the shopper loses an improvement they never knew about, not the product.
 */
export function useResolvedProductImage(
  part: ImageSubject,
  processedImages?: Map<string, ProductImageEntry> | null,
): ResolvedProductImage {
  const choice = chooseProductImage(part, processedImages);
  const [src, setSrc] = useState(choice.src);
  const [failed, setFailed] = useState(false);

  // Re-resolve when the chosen URL changes — a different part in the same
  // rendered slot, or a manifest that arrived after the first paint.
  useEffect(() => {
    setSrc(choice.src);
    setFailed(false);
  }, [choice.src]);

  return {
    src,
    failed,
    source: src === part.imageUrl ? 'merchant' : 'processed',
    onError: () => {
      if (src !== part.imageUrl) setSrc(part.imageUrl);
      else setFailed(true);
    },
  };
}
