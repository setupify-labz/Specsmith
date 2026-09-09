import { useEffect, useState } from 'react';

import { indexManifest, type ProductImageEntry } from '../lib/retail/processedImages';

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
        // Whatever comes back is parsed and validated before any of it is
        // believed — see parseProductImageManifest. The hook does not do its
        // own shape check, because a half-check here is how an unvalidated
        // entry reaches an <img>.
        setByPart(indexManifest(await response.json()));
      } catch {
        // Keep the empty map: merchant images.
      }
    })();
    return () => controller.abort();
  }, []);

  return byPart;
}
