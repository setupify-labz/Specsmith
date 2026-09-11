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
import RetailEstimateAction from './RetailEstimateAction';
import type { ProductImageEntry } from '../../lib/retail/processedImages';
import { PRICES_UPDATED } from '../../lib/prices';
import {
  CHOOSE_LISTING_LABEL,
  IMPORTED_BADGE,
  IMPORTED_PRICE_NOTE,
  type ImportedRecommendation,
} from '../../lib/retail/importedBuild';
import { useResolvedProductImage } from '../../hooks/useResolvedProductImage';

interface Props {
  selectedParts: { category: RetailPartCategory; part: AffiliatePart }[];
  now: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onRemove: (category: RetailPartCategory) => void;
  /**
   * The FPS estimate, rendered inside the build it describes.
   *
   * It lives here rather than at page level so it sits with the parts it
   * estimates from, in BOTH places this summary appears: the desktop sticky
   * column and the mobile drawer. Optional so the summary can still be
   * rendered on its own in a test.
   */
  estimate?: { canEstimate: boolean; onEstimate: () => void };
  /** Approved local cut-outs, indexed by part id. Absent means merchant images. */
  processedImages?: Map<string, ProductImageEntry> | null;
  /**
   * Canonical models carried in from a guide, the quiz, a shared link or a
   * saved build, which the shopper has not yet replaced with a listing.
   */
  imported?: readonly ImportedRecommendation[];
  /** Opens the category a recommendation belongs to, so a listing can be chosen. */
  onChooseListing?: (category: string) => void;
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
export default function RetailBuildSummary({
  selectedParts,
  now,
  collapsed,
  onToggleCollapsed,
  onRemove,
  estimate,
  processedImages,
  imported = [],
  onChooseListing,
}: Props) {
  const parts = selectedParts.map((entry) => entry.part);
  // IMPORTED MODELS ARE NOT PASSED IN HERE, and that is the point. The subtotal
  // is computed from exact listings only, so an editorial estimate cannot reach
  // a figure headed by retailer prices — no filtering afterwards, no flag to
  // forget: the number is built from a list an estimate never enters.
  const summary = summarizeBuildPrices(parts, now);
  const excludedIds = new Set(summary.excluded.map((item) => item.partId));
  const chosenCount = selectedParts.length + imported.length;

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
          Your build ({chosenCount})
        </span>
        {collapsed ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-3 border-t px-4 py-3" style={{ borderColor: 'var(--ff-border)' }}>
          {imported.length > 0 && (
            <ul className="flex flex-col gap-3" data-testid="imported-recommendations">
              {imported.map((recommendation) => (
                <ImportedItem
                  key={recommendation.category}
                  recommendation={recommendation}
                  onChooseListing={onChooseListing}
                />
              ))}
            </ul>
          )}

          {chosenCount === 0 ? (
            <p className="py-4 text-center text-sm" style={{ color: 'var(--ff-text-2)' }}>
              Nothing selected yet. Choose a category and add a product.
            </p>
          ) : selectedParts.length === 0 ? null : (
            <ul className="flex flex-col gap-3">
              {selectedParts.map(({ category, part }) => {
                const view = priceView(part, now);
                return (
                  <li key={category} className="flex gap-2" data-testid={`summary-item-${category}`}>
                    <SummaryThumbnail part={part} processedImages={processedImages} />
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

            {estimate !== undefined && (
              <div data-testid="summary-estimate">
                <RetailEstimateAction canEstimate={estimate.canEstimate} onEstimate={estimate.onEstimate} />
              </div>
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
 * A model carried in from elsewhere on the site, shown as a recommendation.
 *
 * WHAT IT MUST NOT LOOK LIKE. Not a purchase. It carries no image — there is no
 * listing to photograph — no retailer link, no availability, and no price that
 * could be mistaken for one a shopper can pay today. What it does carry is the
 * model's name, an estimate labelled as an estimate, and the one control that
 * turns it into a real decision.
 *
 * The estimate is shown at all rather than hidden because it is what made the
 * guide recommend this part, and dropping it would leave the shopper unable to
 * tell a £120 recommendation from a £900 one. It is shown STRUCK THROUGH of
 * nothing and beside its own sentence instead: `IMPORTED_PRICE_NOTE` travels
 * with the number wherever it appears.
 */
function ImportedItem({
  recommendation,
  onChooseListing,
}: {
  recommendation: ImportedRecommendation;
  onChooseListing?: (category: string) => void;
}) {
  const { category, name, estimatedPrice } = recommendation;
  return (
    <li
      className="flex flex-col gap-1.5 rounded-lg p-2.5"
      data-testid={`imported-item-${category}`}
      data-category={category}
      style={{ border: '1px dashed var(--ff-border)', background: 'var(--ff-surface)' }}
    >
      <div className="flex items-center gap-2">
        <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--ff-text-3)' }}>
          {CATEGORY_LABELS[category as RetailPartCategory]}
        </p>
        <span
          data-testid={`imported-badge-${category}`}
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={{ background: 'var(--ff-card-hover)', color: 'var(--ff-text-2)' }}
        >
          {IMPORTED_BADGE}
        </span>
      </div>

      <p
        className="text-xs leading-snug"
        style={{ color: 'var(--ff-text)' }}
        title={name}
        data-testid={`imported-title-${category}`}
      >
        {shortenTitle(name, 44)}
      </p>

      {typeof estimatedPrice === 'number' ? (
        <p className="text-[11px]" style={{ color: 'var(--ff-text-2)' }} data-testid={`imported-price-${category}`}>
          {/* USD explicitly: the field behind this is `price_usd`, an
              editorial figure in dollars, and it must not silently inherit
              whatever currency a retailer listing happened to use. */}
          <span style={{ color: 'var(--ff-text-3)' }}>Estimated</span> {formatAmount(estimatedPrice, 'USD')}
          {/* WHEN the estimate is from, next to the number itself. An editorial
              figure with no date reads as current, which is the one thing it is
              not; a retailer listing beside it carries a checked-at timestamp,
              and this is the equivalent honesty for a figure that has none. */}
          {' · updated '}
          <span data-testid={`imported-updated-${category}`}>{PRICES_UPDATED}</span>
          {' — '}
          {IMPORTED_PRICE_NOTE}
        </p>
      ) : (
        <p className="text-[11px]" style={{ color: 'var(--ff-text-3)' }} data-testid={`imported-price-${category}`}>
          No estimate recorded for this model.
        </p>
      )}

      <button
        type="button"
        data-testid={`choose-listing-${category}`}
        // EVERY ONE OF THESE SAYS WHICH CATEGORY IT IS FOR. A build carried in
        // from a guide shows up to twelve of these buttons at once, and a
        // screen-reader user moving between them heard "Choose current
        // listing" twelve times with nothing to tell them apart. The visible
        // text stays short because the label beside it is already on screen;
        // the accessible name has to carry what the eye gets from position.
        aria-label={`${CHOOSE_LISTING_LABEL} for ${CATEGORY_LABELS[category as RetailPartCategory]}`}
        onClick={() => onChooseListing?.(category)}
        disabled={onChooseListing === undefined}
        className="ff-accent-control mt-0.5 inline-flex w-fit items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold"
        style={{ background: 'var(--ff-accent-solid)', color: 'var(--ff-on-accent)' }}
      >
        {CHOOSE_LISTING_LABEL}
      </button>
    </li>
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
function SummaryThumbnail({
  part,
  processedImages,
}: {
  part: AffiliatePart;
  processedImages?: Map<string, ProductImageEntry> | null;
}) {
  // Same ladder and same backdrop as the card and the drawer. A tile showing
  // the merchant's photograph beside a card showing its cut-out would read as
  // two different products.
  const image = useResolvedProductImage(part, processedImages);
  return (
    <div
      data-testid="summary-thumb"
      data-part-id={part.id}
      className="retail-photo-frame flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg"
      style={{ border: '1px solid var(--ff-border)' }}
    >
      {image.failed ? (
        <ImageOff size={16} aria-hidden="true" data-testid="summary-thumb-fallback" style={{ color: 'var(--ff-text-3)' }} />
      ) : (
        <img
          src={image.src}
          alt=""
          loading="lazy"
          decoding="async"
          data-image-source={image.source}
          onError={image.onError}
          className="max-h-full max-w-full object-contain p-1"
        />
      )}
    </div>
  );
}
