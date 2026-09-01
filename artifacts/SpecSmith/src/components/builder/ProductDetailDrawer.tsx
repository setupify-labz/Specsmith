import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, ImageOff, X } from 'lucide-react';

import type { AffiliatePart } from '../../lib/retail/partCatalog';
import { AVAILABILITY_UNKNOWN_LABEL, STALE_PRICE_LABEL, formatAmount, formatCheckedAt, priceView } from '../../lib/retail/partPricing';
import { imageAltText, verifiedImages } from '../../lib/retail/productImages';
import { imageZoom } from '../../lib/retail/imageFraming';
import { UNVERIFIED_NOTICE, confidenceOf } from '../../lib/retail/retailShopping';

interface Props {
  part: AffiliatePart;
  now: number;
  onClose: () => void;
  onToggle: (id: string) => void;
  selected: boolean;
}

/** How far a touch must travel before it counts as a swipe rather than a tap. */
const SWIPE_THRESHOLD_PX = 40;

/**
 * The product detail view: a modal holding the listing's images and facts.
 *
 * ON THE GALLERY. It renders however many verified images it is given. Today
 * that is always one, because the feed publishes one — see productImages.ts —
 * and with one image there are no previous/next controls, no thumbnail strip
 * and no "1 of 1" counter, because chrome implying more pictures exist is a
 * claim about the data. The multi-image path is real and tested; it is simply
 * not reachable from the current catalogue, and the view says so.
 *
 * ON FOCUS. Opening moves focus into the dialog and closing returns it to
 * whatever opened it, so a keyboard user is never dropped back at the top of
 * a 500-product grid. Escape closes, and arrow keys move between images when
 * there is more than one.
 */
export default function ProductDetailDrawer({ part, now, onClose, onToggle, selected }: Props) {
  const images = verifiedImages(part);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const touchStartX = useRef<number | null>(null);
  const view = priceView(part, now);
  const zoom = imageZoom(part.imageContentRatio);
  const many = images.length > 1;

  const step = useCallback(
    (delta: number) => setIndex((current) => (current + delta + images.length) % images.length),
    [images.length],
  );

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (!many) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Focus goes back where it came from, not to the top of the document.
      opener?.focus?.();
    };
  }, [many, onClose, step]);

  const current = images[index];
  const currentFailed = failed[index] === true;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      data-testid="product-detail-backdrop"
    >
      <button type="button" aria-label="Close product details" className="absolute inset-0" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={part.name}
        tabIndex={-1}
        data-testid="product-detail"
        className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl p-4 sm:rounded-2xl"
        style={{ background: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}
        onTouchStart={(event) => {
          touchStartX.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          const start = touchStartX.current;
          touchStartX.current = null;
          if (start === null || !many) return;
          const delta = (event.changedTouches[0]?.clientX ?? start) - start;
          if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
          step(delta < 0 ? 1 : -1);
        }}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold leading-snug" style={{ color: 'var(--ff-text)' }}>
            {part.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close product details"
            data-testid="product-detail-close"
            className="ff-accent-control shrink-0 rounded-lg p-1.5"
            style={{ color: 'var(--ff-text-2)', background: 'var(--ff-surface)' }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div
          className="relative flex items-center justify-center overflow-hidden rounded-xl"
          style={{ aspectRatio: '4 / 3', background: 'var(--ff-surface)' }}
          data-testid="detail-image-frame"
        >
          {currentFailed || current === undefined ? (
            <div className="flex flex-col items-center gap-1" style={{ color: 'var(--ff-text-3)' }} data-testid="detail-image-placeholder">
              <ImageOff size={26} aria-hidden="true" />
              <span className="text-xs">No image</span>
            </div>
          ) : (
            <img
              src={current}
              alt={imageAltText(part.name, index, images.length)}
              decoding="async"
              onError={() => setFailed((state) => ({ ...state, [index]: true }))}
              className="object-contain p-4"
              style={{ maxHeight: `${zoom * 100}%`, maxWidth: `${zoom * 100}%` }}
              data-testid="detail-image"
            />
          )}

          {many && (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous image"
                data-testid="detail-prev"
                className="ff-accent-control absolute left-2 rounded-full p-2"
                style={{ background: 'var(--ff-card)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next image"
                data-testid="detail-next"
                className="ff-accent-control absolute right-2 rounded-full p-2"
                style={{ background: 'var(--ff-card)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </>
          )}
        </div>

        {many ? (
          <>
            <p className="mt-2 text-center text-xs" style={{ color: 'var(--ff-text-2)' }} data-testid="detail-position" aria-live="polite">
              {index + 1} of {images.length}
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-2" data-testid="detail-thumbnails">
              {images.map((url, thumbIndex) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setIndex(thumbIndex)}
                  aria-label={`Show image ${thumbIndex + 1} of ${images.length}`}
                  aria-current={thumbIndex === index ? 'true' : undefined}
                  data-testid={`detail-thumb-${thumbIndex}`}
                  className="ff-accent-control h-12 w-12 overflow-hidden rounded-lg"
                  style={{
                    background: 'var(--ff-surface)',
                    border: `1px solid ${thumbIndex === index ? 'var(--ff-accent)' : 'var(--ff-border)'}`,
                  }}
                >
                  <img src={url} alt="" className="h-full w-full object-contain p-0.5" />
                </button>
              ))}
            </div>
          </>
        ) : (
          // One verified image. Saying why is better than silently showing a
          // gallery with nothing to page through.
          <p className="mt-2 text-center text-[11px]" style={{ color: 'var(--ff-text-3)' }} data-testid="detail-single-image-note">
            The retailer feed publishes one image for this listing.
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2">
          {view.status === 'fresh' ? (
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-semibold" style={{ color: 'var(--ff-text)' }} data-testid="detail-price">
                {formatAmount(view.displayAmount, view.currency)}
              </span>
              {view.strikeThroughAmount !== null && (
                <span className="text-sm line-through" style={{ color: 'var(--ff-text-3)' }}>
                  {formatAmount(view.strikeThroughAmount, view.currency)}
                </span>
              )}
              <span className="text-[11px]" style={{ color: 'var(--ff-text-3)' }}>{formatCheckedAt(view.checkedAt)}</span>
            </div>
          ) : (
            <p className="text-sm font-medium" style={{ color: 'var(--ff-text-2)' }} data-testid="detail-price-stale">
              {STALE_PRICE_LABEL}
            </p>
          )}
          <p className="text-[11px]" style={{ color: 'var(--ff-text-3)' }}>{AVAILABILITY_UNKNOWN_LABEL}</p>
          {confidenceOf(part) === 'unverified' && (
            <p className="text-[11px]" style={{ color: 'var(--ff-amber)' }}>{UNVERIFIED_NOTICE}</p>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => onToggle(part.id)}
            data-testid="detail-add-to-build"
            className="ff-accent-control flex flex-1 items-center justify-center rounded-lg px-3 py-2.5 text-sm font-semibold"
            style={{
              background: selected ? 'var(--ff-accent-solid)' : 'var(--ff-surface)',
              color: selected ? 'var(--ff-on-accent)' : 'var(--ff-text)',
              border: '1px solid var(--ff-border)',
            }}
          >
            {selected ? 'In build' : 'Add to build'}
          </button>
          <a
            href={part.trackedAffiliateUrl}
            target="_blank"
            rel="sponsored noopener noreferrer"
            data-testid="detail-view-at-newegg"
            className="ff-accent-control flex items-center justify-center gap-1 rounded-lg px-3 py-2.5 text-sm font-semibold"
            style={{ background: 'var(--ff-newegg)', color: '#111' }}
          >
            View at Newegg
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  );
}
