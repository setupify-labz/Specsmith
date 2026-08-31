import { useState } from 'react';
import { Check, ExternalLink, ImageOff, Plus } from 'lucide-react';

import type { AffiliatePart } from '../../lib/retail/partCatalog';
import {
  AVAILABILITY_UNKNOWN_LABEL,
  STALE_PRICE_LABEL,
  formatAmount,
  formatCheckedAt,
  priceView,
} from '../../lib/retail/partPricing';
import { UNVERIFIED_NOTICE, confidenceOf, shortenTitle } from '../../lib/retail/retailShopping';

interface Props {
  part: AffiliatePart;
  selected: boolean;
  now: number;
  onToggle: (id: string) => void;
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
export default function RetailProductCard({ part, selected, now, onToggle }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
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
      {/* Fixed-ratio box: every image occupies the same space and is contained
          rather than cropped or stretched, so a tall PSU and a wide monitor
          still line up in the grid. */}
      <div
        className="relative flex items-center justify-center rounded-t-xl overflow-hidden"
        style={{ aspectRatio: '4 / 3', background: 'var(--ff-surface)' }}
      >
        {imageFailed ? (
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
            src={part.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
            className="max-h-full max-w-full object-contain p-3"
          />
        )}
        {confidence === 'unverified' && (
          <span
            className="absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: 'var(--ff-surface)', color: 'var(--ff-text-2)', border: '1px solid var(--ff-border)' }}
            title={UNVERIFIED_NOTICE}
          >
            Specs unverified
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        {/* The shortened title is what is shown; the complete merchant title is
            the accessible name, so nothing is withheld from a screen reader. */}
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

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => onToggle(part.id)}
            data-testid="add-to-build"
            className="flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold transition-colors"
            style={{
              background: selected ? 'var(--ff-accent-solid)' : 'var(--ff-surface)',
              color: selected ? 'var(--ff-accent-text)' : 'var(--ff-text)',
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
