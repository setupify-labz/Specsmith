import { useEffect, useState } from 'react';

import {
  indexManifest,
  type ProductImageEntry,
  type ProductImageManifest,
} from '../lib/retail/processedImages';

export const PRODUCT_IMAGE_MANIFEST_URL = '/data/product-images.json';

/**
 * Approved local cut-outs, indexed by part id.
 *
 * An empty map is the correct answer to every failure — missing file, bad
 * JSON, network error — because every card then loads the merchant's own
 * image, which is what it did before cut-outs existed. There is deliberately
 * no error state for a caller to handle: not having cut-outs is not a fault.
 */
export function useProductImageManifest(): Map<string, ProductImageEntry> {
  const [byPart, setByPart] = useState<Map<string, ProductImageEntry>>(() => new Map());

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(PRODUCT_IMAGE_MANIFEST_URL, {
          cache: 'no-cache',
          signal: controller.signal,
        });
        if (!response.ok) return;
        const raw = (await response.json()) as ProductImageManifest;
        if (!Array.isArray(raw?.entries)) return;
        setByPart(indexManifest(raw));
      } catch {
        // Keep the empty map: merchant images.
      }
    })();
    return () => controller.abort();
  }, []);

  return byPart;
}
