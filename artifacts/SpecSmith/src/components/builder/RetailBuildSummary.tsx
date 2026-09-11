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
  ESTIMATED_PREFIX,
  IMPORTED_PLAN_HEADING,
  IMPORTED_PLAN_NOTICE,
  chooseListingLabel,
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
/**
 * How tall the planned-part list may grow.
 *
 * Eight compact rows fit inside this, so an ordinary guide plan never produces
 * a scrolling region at all. Twelve scroll within it — one deliberate box,
 * which is what keeps the FPS action on screen at 1366x768 instead of 1,835px
 * down the document.
 *
 * Measured, not guessed: a two-line row is ~34px, so eight come to ~272px and
 * sit inside this cap with room to spare.
 */
const PLAN_ROWS_MAX_HEIGHT_PX = 300;

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
        <div className="flex flex-col gap-2 border-t px-4 py-2.5" style={{ borderColor: 'var(--ff-border)' }}>
          {imported.length > 0 && (
            <section aria-label={IMPORTED_PLAN_HEADING} data-testid="imported-plan">
              {/* SAID ONCE. This is the copy that used to be repeated inside
                  every card. As one notice it is read once by eye and announced
                  once by a screen reader, instead of eight or twelve times. */}
              <p
                data-testid="imported-plan-notice"
                className="mb-1.5 rounded-lg px-2 py-1.5 text-[11px] leading-snug"
                style={{
                  background: 'var(--ff-surface)',
                  border: '1px dashed var(--ff-border)',
                  color: 'var(--ff-text-2)',
                }}
              >
                {IMPORTED_PLAN_NOTICE}
              </p>

              {/* BOUNDED ON PURPOSE. Capped at roughly eight rows: at eight or
                  fewer nothing scrolls and no nested region exists, and a
                  twelve-part plan scrolls inside this one deliberate box
                  rather than pushing the FPS action off the screen. */}
              <ul
                data-testid="planned-rows"
                className="divide-y overflow-y-auto"
                style={{ maxHeight: `${PLAN_ROWS_MAX_HEIGHT_PX}px`, borderColor: 'var(--ff-border)' }}
              >
                {imported.map((recommendation) => (
                  <PlannedRow
                    key={recommendation.category}
                    recommendation={recommendation}
                    onChooseListing={onChooseListing}
                  />
                ))}
              </ul>
            </section>
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

          <div className="border-t pt-2" style={{ borderColor: 'var(--ff-border)' }}>
            {/* THE RETAILER SUBTOTAL IS ABOUT RETAILER LISTINGS. With none
                chosen there is nothing to total, and a row reading
                "Known-price subtotal —" beside a footnote about retailer
                availability is a hundred pixels of the sidebar saying nothing
                — pixels that were pushing the FPS action off the screen. It
                returns the moment a listing does, and it has never included an
                editorial estimate. */}
            {selectedParts.length > 0 && (
            <div className="flex items-baseline justify-between gap-2" data-testid="retailer-subtotal">
              <span className="text-xs" style={{ color: 'var(--ff-text-2)' }} data-testid="subtotal-label">
                {subtotalLabel(summary)}
              </span>
              <span className="text-lg font-semibold" style={{ color: 'var(--ff-text)' }} data-testid="subtotal-amount">
                {summary.currency === null ? '—' : formatAmount(summary.knownTotal, summary.currency)}
              </span>
            </div>
            )}

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

            {selectedParts.length > 0 && (
              <p className="mt-2 text-[11px]" style={{ color: 'var(--ff-text-3)' }} data-testid="summary-availability">
                {AVAILABILITY_UNKNOWN_LABEL} for every item. Prices come from the retailer feed and the merchant page is the source of truth.
              </p>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

/**
 * One planned part: a compact row, not a card.
 *
 * WHAT IT REPLACED, AND WHY. Every recommendation used to be a card carrying
 * the full warning, a large badge and a large button. At eight parts that was
 * 1,413 characters of identical copy, a summary 1,788px tall, and the FPS
 * action 1,835px down the document — measured on the real Build Guide flow at
 * 1363x936. The fix for "an imported build shows nothing" had become "an
 * imported build shows nothing else".
 *
 * A row carries only what differs between rows: which category, which model,
 * what it was estimated at and when. The three sentences that are the same for
 * every row live once, in the notice above the list.
 *
 * IT STILL CLAIMS NOTHING. No image, no retailer link, no availability — there
 * is no listing to have any of those, and that has not changed.
 */
function PlannedRow({
  recommendation,
  onChooseListing,
}: {
  recommendation: ImportedRecommendation;
  onChooseListing?: (category: string) => void;
}) {
  const { category, name, estimatedPrice } = recommendation;
  const categoryLabel = CATEGORY_LABELS[category as RetailPartCategory];
  return (
    <li
      className="flex items-center gap-2 py-1"
      data-testid={`planned-row-${category}`}
      data-category={category}
    >
      <div className="min-w-0 flex-1">
        {/* TWO LINES, NOT THREE. Category and model share a line: at eight rows
            the third line cost 128px of a sidebar that has to hold the FPS
            action too. The category still reads first, which is how a shopper
            scans a parts list. */}
        <p className="flex items-baseline gap-1.5 truncate text-xs leading-tight">
          <span
            className="shrink-0 text-[10px] uppercase tracking-wide"
            style={{ color: 'var(--ff-text-3)' }}
            data-testid={`planned-category-${category}`}
          >
            {categoryLabel}
          </span>
          <span
            className="truncate"
            style={{ color: 'var(--ff-text)' }}
            title={name}
            data-testid={`planned-name-${category}`}
          >
            {shortenTitle(name, 28)}
          </span>
        </p>
        {/* The estimate keeps its word and its date on the row, because a bare
            number beside a retailer price is exactly the confusion the notice
            above is trying to prevent. */}
        <p
          className="text-[10px] leading-none"
          style={{ color: 'var(--ff-text-3)' }}
          data-testid={`planned-price-${category}`}
        >
          {typeof estimatedPrice === 'number'
            ? `${ESTIMATED_PREFIX} ${formatAmount(estimatedPrice, 'USD')} · ${PRICES_UPDATED}`
            : 'No estimate recorded'}
        </p>
      </div>

      <button
        type="button"
        data-testid={`choose-listing-${category}`}
        aria-label={chooseListingLabel(categoryLabel)}
        onClick={() => onChooseListing?.(category)}
        disabled={onChooseListing === undefined}
        className="ff-accent-control shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold"
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
