/**
 * The verified images for a listing.
 *
 * WHAT THE FEED ACTUALLY GIVES US — the finding that shapes this whole file.
 * A Rakuten/Newegg product record carries exactly ONE image element,
 * `<imageurl>`. There is no gallery field, no additional-views field, no
 * image-set field. Every fixture in scripts/retail/rakuten/__fixtures__ has
 * one `<imageurl>` per `<item>`, and the published catalogue has one
 * `imageUrl` per part.
 *
 * So the catalogue schema does NOT gain an `images` collection. Adding one
 * would mean populating it, and the only ways to populate it would be to
 * scrape the retailer's product pages, to guess at CDN URL patterns, or to
 * repeat the one image we have until a carousel looks full. All three produce
 * a gallery that is a lie about the data behind it.
 *
 * The detail view therefore shows the one verified image, and shows it
 * WITHOUT carousel chrome, because controls that step through a single image
 * are an invitation to look for something that is not there. The gallery
 * component underneath supports as many images as it is given — that part is
 * real and tested — so the day a feed carries more, the view already works.
 */

import type { AffiliatePart } from './partCatalog';

/** An image URL we are willing to render: https, and shaped like a URL. */
export function isRenderableImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  // https only. An http image on an https page is blocked by the browser
  // anyway, so admitting one would just produce a silent broken image.
  return url.protocol === 'https:';
}

/**
 * Removes duplicates while keeping the first occurrence.
 *
 * Compared after trimming and by exact URL: two records of the same picture
 * differing only in query string are not provably the same image, and merging
 * them on a guess is the kind of cleverness that loses a real photograph.
 */
export function dedupeImageUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of urls) {
    const url = typeof raw === 'string' ? raw.trim() : '';
    if (!isRenderableImageUrl(url) || seen.has(url)) continue;
    seen.add(url);
    kept.push(url);
  }
  return kept;
}

/**
 * Every verified image for this exact SKU, in order, deduplicated.
 *
 * Today this returns one URL for every part in the catalogue, because one is
 * all the feed publishes. It is written as a list rather than a single value
 * so that the detail view has one shape to render and the limitation lives
 * here, in one documented place, instead of being spread across the UI.
 */
export function verifiedImages(part: Pick<AffiliatePart, 'imageUrl'>): string[] {
  return dedupeImageUrls([part.imageUrl]);
}

/** Alt text for a product image: the merchant's own title, never invented. */
export function imageAltText(title: string, index: number, total: number): string {
  return total > 1 ? `${title} — image ${index + 1} of ${total}` : title;
}
