import { useState } from 'react';
import { ExternalLink, ImageOff } from 'lucide-react';
import { Link } from 'react-router-dom';

import {
  AVAILABILITY_UNKNOWN_LABEL,
  STALE_PRICE_LABEL,
  formatAmount,
  formatCheckedAt,
  priceView,
} from '../../lib/retail/partPricing';
import { CATEGORY_LABELS } from '../../lib/retail/retailShopping';
import {
  CHOOSE_REPLACEMENT_LABEL,
  LISTING_UNAVAILABLE_LABEL,
  LISTINGS_UNCHECKABLE_LABEL,
  LISTING_CHECKING_LABEL,
  type GuideSlotState,
} from '../../lib/guides/guideSlots';

interface Props {
  state: GuideSlotState;
  /** Where "Choose replacement in Builder" goes for this slot. */
  replacementHref: string;
  /**
   * Called before the replacement link navigates. Returning true means the
   * caller has taken over — it is asking the shopper something first — and
   * the navigation is cancelled.
   */
  onReplacementIntercept?: () => boolean;
  now: number;
}

/**
 * One slot of a build guide, told truthfully.
 *
 * A guide slot used to render an editorial model name and a dated estimate
 * beside two links to retailer SEARCH pages. It now shows the exact listing a
 * reviewer bound — its real name, its feed-supplied image, the price actually
 * observed, and when that observation was made — or it says the listing is
 * unavailable and offers the Builder. There is no third option: no estimate
 * standing in for a price, no similar product, no search box.
 */
export default function GuidePartRow({
  state,
  replacementHref,
  onReplacementIntercept,
  now,
}: Props) {
  // EVERY HOOK RUNS EVERY RENDER. This sat below the unavailable-slot return,
  // so the component ran a different number of hooks depending on the slot's
  // status — and a slot changes status the moment the catalogue arrives, which
  // is exactly when React would find the count had changed. Same defect class
  // as the not-found crash on the guide page itself.
  const [imageFailed, setImageFailed] = useState(false);
  const categoryLabel = CATEGORY_LABELS[state.category];

  // Nothing has been able to look yet. Not a claim that anything is missing —
  // and the two reasons read differently, because "checking" over a request
  // that already failed is a spinner that never stops.
  if (state.status === 'unchecked') {
    const stillComing = state.reason === 'loading';
    return (
      <div
        data-testid={`guide-slot-${state.category}`}
        data-slot-status="unchecked"
        data-unchecked-reason={state.reason}
        className="rounded-lg p-3"
        style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}
      >
        <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--ff-text-3)' }}>
          {categoryLabel}
        </div>
        <div
          className="text-xs font-semibold"
          data-testid={`guide-unchecked-${state.category}`}
          {...(stillComing ? { 'aria-busy': true } : {})}
          style={{ color: stillComing ? 'var(--ff-text-2)' : 'var(--ff-amber)' }}
        >
          {stillComing ? LISTING_CHECKING_LABEL : LISTINGS_UNCHECKABLE_LABEL}
        </div>
      </div>
    );
  }

  if (state.status !== 'available') {
    return (
      <div
        data-testid={`guide-slot-${state.category}`}
        data-slot-status={state.status}
        className="rounded-lg p-3"
        style={{ backgroundColor: 'var(--ff-card)', border: '1px dashed var(--ff-border)' }}
      >
        <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--ff-text-3)' }}>
          {categoryLabel}
        </div>
        {/* No price, no stale figure, no search link. The guide has nothing
            buyable here and says so in as many words. */}
        <div
          className="text-xs font-semibold mb-2"
          data-testid={`guide-unavailable-${state.category}`}
          style={{ color: 'var(--ff-amber)' }}
        >
          {LISTING_UNAVAILABLE_LABEL}
        </div>
        <Link
          to={replacementHref}
          onClick={(event) => {
            // Loading a replacement loads this guide, which replaces whatever
            // build the shopper already has. The page asks first; if it takes
            // over, this navigation is cancelled.
            if (onReplacementIntercept?.()) event.preventDefault();
          }}
          data-testid={`guide-replacement-${state.category}`}
          data-category={state.category}
          aria-label={`${CHOOSE_REPLACEMENT_LABEL} for ${categoryLabel.toLowerCase()}`}
          className="ff-accent-control inline-flex w-full items-center justify-center rounded-md px-2 py-1.5 text-[10px] font-semibold"
          style={{ color: 'var(--ff-accent-text)', border: '1px solid var(--ff-border)' }}
        >
          {CHOOSE_REPLACEMENT_LABEL}
        </Link>
      </div>
    );
  }

  const { part, binding } = state;
  const view = priceView(part, now);

  return (
    <div
      data-testid={`guide-slot-${state.category}`}
      data-slot-status="available"
      data-part-id={part.id}
      className="rounded-lg p-3"
      style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}
    >
      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--ff-text-3)' }}>
        {categoryLabel}
      </div>

      {/* The merchant's own photograph of this exact listing, from the feed. */}
      <div
        className="mb-2 flex h-24 items-center justify-center overflow-hidden rounded"
        style={{ backgroundColor: 'var(--ff-image-frame, var(--ff-surface))' }}
      >
        {imageFailed ? (
          <div
            data-testid={`guide-image-fallback-${state.category}`}
            className="flex flex-col items-center gap-1 text-[10px]"
            style={{ color: 'var(--ff-text-3)' }}
          >
            <ImageOff size={18} aria-hidden="true" />
            No image
          </div>
        ) : (
          <img
            src={part.imageUrl}
            alt={part.name}
            loading="lazy"
            onError={() => setImageFailed(true)}
            data-testid={`guide-image-${state.category}`}
            className="max-h-24 w-auto object-contain"
          />
        )}
      </div>

      {/* The listing's own name, not the editorial model name. */}
      <div className="text-xs font-medium leading-tight mb-1.5" data-testid={`guide-name-${state.category}`} style={{ color: 'var(--ff-text)' }}>
        {part.name}
      </div>

      {view.status === 'fresh' ? (
        <div className="mb-1.5">
          <span className="text-sm font-bold" data-testid={`guide-price-${state.category}`} style={{ color: 'var(--ff-text)' }}>
            {formatAmount(view.displayAmount, view.currency)}
          </span>
          {view.strikeThroughAmount !== null && (
            <span className="ml-1.5 text-[11px] line-through" style={{ color: 'var(--ff-text-3)' }}>
              {formatAmount(view.strikeThroughAmount, view.currency)}
            </span>
          )}
          {/* The evidence behind the number, beside the number. */}
          <div className="text-[10px]" data-testid={`guide-checked-${state.category}`} style={{ color: 'var(--ff-text-3)' }}>
            {formatCheckedAt(view.checkedAt)}
          </div>
        </div>
      ) : (
        <div className="mb-1.5 text-[11px] font-semibold" data-testid={`guide-price-stale-${state.category}`} style={{ color: 'var(--ff-text-2)' }}>
          {STALE_PRICE_LABEL}
        </div>
      )}

      {/* Availability is shown ONLY when the feed establishes it. It does not,
          for any listing today, so this states the absence rather than
          implying stock. */}
      <div className="text-[10px] mb-2" data-testid={`guide-availability-${state.category}`} style={{ color: 'var(--ff-text-3)' }}>
        {part.availability === 'unknown' ? AVAILABILITY_UNKNOWN_LABEL : part.availability}
      </div>

      {/* Why a reviewer chose this exact component. */}
      <p className="text-[10px] leading-snug mb-2" data-testid={`guide-why-${state.category}`} style={{ color: 'var(--ff-text-2)' }}>
        {binding.why}
      </p>

      <a
        href={part.trackedAffiliateUrl}
        target="_blank"
        rel="noopener noreferrer sponsored"
        data-testid={`guide-newegg-${state.category}`}
        aria-label={`View ${part.name} at Newegg`}
        className="inline-flex items-center gap-1 text-[10px] font-semibold"
        style={{ color: 'var(--ff-newegg)' }}
      >
        View at Newegg <ExternalLink size={9} aria-hidden="true" />
      </a>
    </div>
  );
}
