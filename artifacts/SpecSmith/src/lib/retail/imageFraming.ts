/**
 * How large to draw a retailer photograph so products look the same size.
 *
 * THE PROBLEM THIS SOLVES. Two GPUs, two cards, one box each, `object-contain`
 * on both — and one card still looks half the size of its neighbour. Nothing
 * is wrong with the layout: the difference is inside the image. A merchant
 * photograph that fills its frame and one that floats in a wide white margin
 * are the same file dimensions and pass every measurement of the <img>
 * element, but the products in them are not the same size on screen.
 *
 * THE FIX. `imageContentRatio` records how much of the frame the product
 * actually spans, measured from the pixels when the catalogue is built. A
 * sparse image is drawn LARGER by exactly the factor that brings its product
 * up to the same span as everything else. The image element grows past its
 * container and the container clips it — but what gets clipped is the empty
 * margin that made the product look small, not the product.
 *
 * WHY IT CANNOT CROP THE PRODUCT. Three guards, all of them conservative:
 *
 *  - The target is `CONTENT_TARGET_SPAN`, not 1.0, so the product is enlarged
 *    to a little under the full frame and keeps a margin on every side.
 *  - `MAX_ZOOM` caps the enlargement, so a mis-measured ratio cannot produce
 *    an arbitrary blow-up.
 *  - Below `MIN_TRUSTED_RATIO` nothing is enlarged at all. A product that
 *    genuinely occupies a fifth of its frame would need a 4x zoom to normalize
 *    and is far more likely to be a measurement that went wrong.
 *
 * A null ratio — unmeasured, undecodable, or off-centre — always yields 1.
 */

/** Ratios at or above this are already well framed; leave them alone. */
export const WELL_FRAMED_RATIO = 0.92;

/** What share of the frame a normalized product should span. Under 1 on purpose. */
export const CONTENT_TARGET_SPAN = 0.92;

/** The most any image may be enlarged, however sparse it measures. */
export const MAX_ZOOM = 1.6;

/** Below this, a ratio is treated as unreliable rather than as very sparse. */
export const MIN_TRUSTED_RATIO = 0.5;

/**
 * The factor to draw an image at, given how much of its frame its product spans.
 *
 * Always at least 1: this enlarges sparse images, it never shrinks generous
 * ones, because shrinking would waste space in every card to accommodate a few.
 */
export function imageZoom(contentRatio: number | null): number {
  if (contentRatio === null) return 1;
  if (!Number.isFinite(contentRatio) || contentRatio <= 0) return 1;
  if (contentRatio >= WELL_FRAMED_RATIO) return 1;
  if (contentRatio < MIN_TRUSTED_RATIO) return 1;
  return Math.min(MAX_ZOOM, CONTENT_TARGET_SPAN / contentRatio);
}

/**
 * The span the product ends up with after `imageZoom` is applied.
 *
 * Used by tests and by the screenshot audit to state the outcome in the same
 * terms as the input: did normalization actually bring the sparse images up?
 */
export function normalizedSpan(contentRatio: number | null): number | null {
  if (contentRatio === null || !Number.isFinite(contentRatio) || contentRatio <= 0) return null;
  return contentRatio * imageZoom(contentRatio);
}
