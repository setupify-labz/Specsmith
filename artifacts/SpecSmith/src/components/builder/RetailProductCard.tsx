import { Check, ExternalLink, ImageOff, Plus } from 'lucide-react';

import type { AffiliatePart } from '../../lib/retail/partCatalog';
import {
  AVAILABILITY_UNKNOWN_LABEL,
  STALE_PRICE_LABEL,
  formatAmount,
  formatCheckedAt,
  priceView,
} from '../../lib/retail/partPricing';
import { imageZoom } from '../../lib/retail/imageFraming';
import { confidenceOf, shortenTitle, unverifiedNoticeFor } from '../../lib/retail/retailShopping';
import type { ProductImageEntry } from '../../lib/retail/processedImages';
import { useResolvedProductImage } from '../../hooks/useResolvedProductImage';

interface Props {
  part: AffiliatePart;
  selected: boolean;
  now: number;
  onToggle: (id: string) => void;
  /** Opens the product detail view. The card itself stays a card. */
  onOpenDetails?: (id: string) => void;
  /**
   * Approved local cut-outs, indexed by part id.
   *
   * Absent means every card loads the merchant's own image, which is the
   * behaviour this component had before cut-outs existed.
   */
  processedImages?: Map<string, ProductImageEntry> | null;
}

/**
 * One exact retailer listing.
 *
 * Everything shown belongs to THIS SKU: its own image, its own title, its own
 * price and the instant that price was read. Nothing is inherited from a
 * canonical model, and no hand-maintained estimate is used as a fallback — a
 * price this card cannot stand behind is replaced by a link to the merchant,
 * not by an older number from somewhere else.
 *
 * The card is not one big button. "Add to build" and "View at Newegg" are two
 * separate controls, because an invisible overlay covering the whole card
 * makes the destination of a click unguessable and swallows the link.
 */
export default function RetailProductCard({
  part,
  selected,
  now,
  onToggle,
  onOpenDetails,
  processedImages,
}: Props) {
  // The cut-out/merchant/placeholder ladder, shared with the detail drawer and
  // the build summary so all three degrade identically.
  const image = useResolvedProductImage(part, processedImages);
  const zoom = imageZoom(part.imageContentRatio);
  const view = priceView(part, now);
  const confidence = confidenceOf(part);
  const shortTitle = shortenTitle(part.name);

  return (
    <article
      data-testid="retail-product-card"
      data-part-id={part.id}
      data-selected={selected ? 'true' : 'false'}
      className="flex flex-col rounded-xl border transition-colors"
      style={{
        // A selected card is marked by a real border and tint, not by an
        // overlay that would intercept the link underneath it.
        borderColor: selected ? 'var(--ff-accent)' : 'var(--ff-border)',
        background: selected ? 'var(--ff-accent-10)' : 'var(--ff-card)',
        borderWidth: selected ? 2 : 1,
      }}
    >
      {/* The image frame. Every image occupies the same space and is contained
          rather than cropped or stretched, so a tall PSU and a wide monitor
          still line up in the grid.

          SHORTER ON A PHONE. A 4:3 frame is 268px across a 358px-wide phone
          card, which pushed the title, price and buttons below the fold and
          made a single product fill the screen. Below `md` the frame is a
          fixed 240px, so image, title, price and both actions are visible
          together; from `md` up — where cards sit two to a row and there is
          room — it goes back to 4:3. `object-contain` holds in both. */}
      {/* The frame is BOTH the intuitive detail trigger and the surface a
          cut-out is composited against. Its colour comes from the shared
          .retail-photo-frame class rather than an inline style, because the
          drawer and the build summary have to composite against exactly the
          same colour — three copies of one declaration is how they drift. */}
      <button
        type="button"
        onClick={() => onOpenDetails?.(part.id)}
        aria-label={`View details for ${part.name}`}
        data-testid="open-details-image"
        disabled={onOpenDetails === undefined}
        className="retail-photo-frame ff-accent-control relative flex h-[240px] w-full items-center justify-center rounded-t-xl overflow-hidden md:h-auto md:aspect-[4/3]"
      >
        {image.failed ? (
          // A broken image loses the picture, never the product: the card keeps
          // its title, price and actions.
          <div
            data-testid="image-placeholder"
            className="flex flex-col items-center gap-1"
            style={{ color: 'var(--ff-text-3)' }}
          >
            <ImageOff size={22} aria-hidden="true" />
            <span className="text-[11px]">No image</span>
          </div>
        ) : (
          <img
            src={image.src}
            alt=""
            loading="lazy"
            decoding="async"
            data-image-source={image.source}
            onError={image.onError}
            className="object-contain p-3"
            style={{
              // Normally 100% — the image is contained in the frame and that
              // is that. For a photograph measured as floating in a wide
              // margin, the element is grown by exactly enough to bring the
              // PRODUCT up to the size of its neighbours'; the surplus margin
              // then falls outside the frame and is clipped. imageFraming.ts
              // explains why this cannot clip the product itself.
              maxHeight: `${zoom * 100}%`,
              maxWidth: `${zoom * 100}%`,
            }}
          />
        )}
        {confidence === 'unverified' && (
          <span
            className="absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: 'var(--ff-surface)', color: 'var(--ff-text-2)', border: '1px solid var(--ff-border)' }}
            title={unverifiedNoticeFor(part)}
          >
            Specs unverified
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col gap-2 p-3">
        {/* The shortened title is what is shown; the complete merchant title is
            the accessible name, so nothing is withheld from a screen reader. */}
        {/* TWO TRIGGERS, NOT THREE. The image is the intuitive one — a
            product photograph is the thing people click — and "View details"
            is the explicit one. The title used to be a third button, which
            gave every card three tab stops that all did the same thing; a
            keyboard user crossing a 24-card grid met 72 stops to reach the
            same 24 destinations. It is a heading again. */}
        <h3
          className="text-sm font-medium leading-snug"
          style={{ color: 'var(--ff-text)' }}
          title={part.name}
          aria-label={part.name}
        >
          {shortTitle}
        </h3>

        <div className="mt-auto flex flex-col gap-1">
          {view.status === 'fresh' ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-semibold" style={{ color: 'var(--ff-text)' }} data-testid="price-primary">
                  {formatAmount(view.displayAmount, view.currency)}
                </span>
                {view.strikeThroughAmount !== null && (
                  <span className="text-xs line-through" style={{ color: 'var(--ff-text-3)' }} data-testid="price-struck">
                    {formatAmount(view.strikeThroughAmount, view.currency)}
                  </span>
                )}
              </div>
              <p className="text-[11px]" style={{ color: 'var(--ff-text-3)' }} data-testid="price-checked">
                {formatCheckedAt(view.checkedAt)}
              </p>
            </>
          ) : (
            // Past the freshness window there is no number at all — not a
            // greyed one, not a "last known" one.
            <p className="text-sm font-medium" style={{ color: 'var(--ff-text-2)' }} data-testid="price-stale">
              {STALE_PRICE_LABEL}
            </p>
          )}
          <p className="text-[11px]" style={{ color: 'var(--ff-text-3)' }} data-testid="availability">
            {AVAILABILITY_UNKNOWN_LABEL}
          </p>
        </div>

        {onOpenDetails !== undefined && (
          <button
            type="button"
            onClick={() => onOpenDetails(part.id)}
            data-testid="view-details"
            className="ff-accent-control self-start rounded text-[11px] font-medium underline"
            style={{ color: 'var(--ff-text-2)' }}
          >
            View details
          </button>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => onToggle(part.id)}
            data-testid="add-to-build"
            className="ff-accent-control flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold transition-colors"
            style={{
              background: selected ? 'var(--ff-accent-solid)' : 'var(--ff-surface)',
              color: selected ? 'var(--ff-on-accent)' : 'var(--ff-text)',
              border: '1px solid var(--ff-border)',
            }}
          >
            {selected ? <Check size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}
            {selected ? 'In build' : 'Add to build'}
          </button>
          <a
            href={part.trackedAffiliateUrl}
            target="_blank"
            rel="sponsored noopener noreferrer"
            data-testid="view-at-newegg"
            className="flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold"
            style={{ background: 'var(--ff-newegg)', color: '#111' }}
          >
            View at Newegg
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
      </div>
    </article>
  );
}
