import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, ExternalLink, ImageOff, Trash2 } from 'lucide-react';

import type { AffiliatePart, RetailPartCategory } from '../../lib/retail/partCatalog';
import {
  AVAILABILITY_UNKNOWN_LABEL,
  STALE_PRICE_LABEL,
  formatAmount,
  priceView,
  subtotalLabel,
  summarizeBuildPrices,
} from '../../lib/retail/partPricing';
import { CATEGORY_LABELS, confidenceOf, shortenTitle } from '../../lib/retail/retailShopping';

interface Props {
  selectedParts: { category: RetailPartCategory; part: AffiliatePart }[];
  now: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onRemove: (category: RetailPartCategory) => void;
}

/**
 * The build, and what its prices can honestly be said to add up to.
 *
 * THE SUBTOTAL RULE. A figure is called a "Current price subtotal" only when
 * every selected item has a fresh, verified retailer price. If any item's
 * price is hidden, the figure becomes a "Known-price subtotal" and the
 * excluded items are named. Excluded means excluded — never counted as zero,
 * because unknown is not free and a total that quietly omits a line looks
 * complete while understating the build.
 *
 * Nothing here falls back to the catalogue's old hand-maintained estimates.
 * Those describe a part; these describe a listing, and mixing them would put
 * an editorial number in a column headed by real ones.
 */
export default function RetailBuildSummary({ selectedParts, now, collapsed, onToggleCollapsed, onRemove }: Props) {
  const parts = selectedParts.map((entry) => entry.part);
  const summary = summarizeBuildPrices(parts, now);
  const excludedIds = new Set(summary.excluded.map((item) => item.partId));

  return (
    <aside
      aria-label="Your build"
      data-testid="build-summary"
      className="rounded-xl"
      style={{ background: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}
    >
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        data-testid="summary-toggle"
        className="flex w-full items-center justify-between gap-2 px-4 py-3"
      >
        <span className="text-sm font-semibold" style={{ color: 'var(--ff-text)' }}>
          Your build ({selectedParts.length})
        </span>
        {collapsed ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-3 border-t px-4 py-3" style={{ borderColor: 'var(--ff-border)' }}>
          {selectedParts.length === 0 ? (
            <p className="py-4 text-center text-sm" style={{ color: 'var(--ff-text-2)' }}>
              Nothing selected yet. Choose a category and add a product.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {selectedParts.map(({ category, part }) => {
                const view = priceView(part, now);
                return (
                  <li key={category} className="flex gap-2" data-testid={`summary-item-${category}`}>
                    <SummaryThumbnail part={part} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--ff-text-3)' }}>
                        {CATEGORY_LABELS[category]}
                      </p>
                      {/* The EXACT selected SKU, by its own merchant title. */}
                      <p
                        className="text-xs leading-snug"
                        style={{ color: 'var(--ff-text)' }}
                        title={part.name}
                        aria-label={part.name}
                        data-testid={`summary-title-${category}`}
                      >
                        {shortenTitle(part.name, 44)}
                      </p>
                      {view.status === 'fresh' ? (
                        <p className="text-xs font-semibold" style={{ color: 'var(--ff-text)' }} data-testid={`summary-price-${category}`}>
                          {formatAmount(view.displayAmount, view.currency)}
                        </p>
                      ) : (
                        <a
                          href={part.trackedAffiliateUrl}
                          target="_blank"
                          rel="sponsored noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs"
                          style={{ color: 'var(--ff-text-2)' }}
                          data-testid={`summary-stale-${category}`}
                        >
                          {STALE_PRICE_LABEL}
                          <ExternalLink size={10} aria-hidden="true" />
                        </a>
                      )}
                      {confidenceOf(part) === 'unverified' && (
                        <p className="text-[10px]" style={{ color: 'var(--ff-amber)' }} data-testid={`summary-unverified-${category}`}>
                          Specs unverified
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemove(category)}
                      aria-label={`Remove ${CATEGORY_LABELS[category]}`}
                      className="self-start p-1"
                      style={{ color: 'var(--ff-text-3)' }}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="border-t pt-3" style={{ borderColor: 'var(--ff-border)' }}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs" style={{ color: 'var(--ff-text-2)' }} data-testid="subtotal-label">
                {subtotalLabel(summary)}
              </span>
              <span className="text-lg font-semibold" style={{ color: 'var(--ff-text)' }} data-testid="subtotal-amount">
                {summary.currency === null ? '—' : formatAmount(summary.knownTotal, summary.currency)}
              </span>
            </div>

            {/* When the figure is partial, say so and say which items are out. */}
            {!summary.complete && selectedParts.length > 0 && (
              <p
                className="mt-1 flex items-start gap-1 text-[11px] leading-relaxed"
                style={{ color: 'var(--ff-amber)' }}
                data-testid="subtotal-exclusions"
              >
                <AlertTriangle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>
                  {summary.mixedCurrency
                    ? 'Selected items use different currencies, so no subtotal is shown.'
                    : `Excludes ${summary.excluded.length} item(s) whose price is older than the freshness window: ${selectedParts
                        .filter(({ part }) => excludedIds.has(part.id))
                        .map(({ category }) => CATEGORY_LABELS[category])
                        .join(', ')}. Check the retailer for those.`}
                </span>
              </p>
            )}

            <p className="mt-2 text-[11px]" style={{ color: 'var(--ff-text-3)' }} data-testid="summary-availability">
              {AVAILABILITY_UNKNOWN_LABEL} for every item. Prices come from the retailer feed and the merchant page is the source of truth.
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}

/**
 * A 56px picture of the EXACT selected listing.
 *
 * THE ONE RULE. `part.imageUrl` and nothing else. A canonical/reference image
 * would be a picture of the model rather than of the thing in the build, and
 * on a page whose whole argument is that variants are distinct products,
 * showing the wrong variant's photograph would undo it.
 *
 * A failed image loses the picture and nothing else: the tile keeps its size,
 * so the row does not reflow, and the title, price and controls beside it are
 * untouched.
 */
function SummaryThumbnail({ part }: { part: AffiliatePart }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      data-testid="summary-thumb"
      data-part-id={part.id}
      className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg"
      style={{ background: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}
    >
      {failed ? (
        <ImageOff size={16} aria-hidden="true" data-testid="summary-thumb-fallback" style={{ color: 'var(--ff-text-3)' }} />
      ) : (
        <img
          src={part.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="max-h-full max-w-full object-contain p-1"
        />
      )}
    </div>
  );
}
