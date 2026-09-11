import { AlertTriangle, RotateCw } from 'lucide-react';

import type { AffiliateCatalogFailureView } from '../../lib/retail/partCatalogLoader';

interface Props {
  view: AffiliateCatalogFailureView;
  onRetry: () => void;
}

/**
 * Shown above the canonical fallback when the catalogue genuinely failed.
 *
 * WHY THE FALLBACK IS NOT ENOUGH ON ITS OWN. Before issue #104 the fallback
 * appeared silently, and it appeared during ordinary loading too — so it could
 * not say anything, because most of the time nothing was wrong. Now that it
 * only appears after the fetch has answered, it can be honest: something did
 * fail, these parts are the offline set, and here is a way to try again.
 *
 * IT DOES NOT DIAGNOSE FOR THE SHOPPER. "absent" and "invalid" are meaningful
 * to us and meaningless to a person buying a graphics card; both mean the same
 * thing to them — the live listings are not available right now. The
 * distinction is exposed as a `data-` attribute for tests and for anyone
 * reading the DOM, not as prose in front of a shopper.
 *
 * WHAT IT PROMISES IS ONLY WHAT IT KNOWS. It does not say the network is down,
 * blame the retailer, or predict when listings return. It says the live
 * listings could not be loaded and that what is shown below carries estimated
 * prices instead — which is exactly the difference the shopper needs in order
 * to read the page correctly.
 */
export default function CatalogFailureNotice({ view, onRetry }: Props) {
  return (
    <div
      role="status"
      data-testid="catalog-failure-notice"
      data-failure={view.status}
      className="mb-4 flex flex-wrap items-center gap-3 rounded-xl p-3"
      style={{
        background: 'var(--ff-card)',
        border: '1px solid var(--ff-border)',
        color: 'var(--ff-text-2)',
      }}
    >
      <AlertTriangle size={16} aria-hidden="true" style={{ color: 'var(--ff-text-2)' }} />
      <p className="min-w-0 flex-1 text-xs leading-relaxed">
        Live retailer listings could not be loaded, so the parts below show{' '}
        <strong style={{ color: 'var(--ff-text)' }}>estimated</strong> prices rather than current
        ones, and no retailer availability.
      </p>
      <button
        type="button"
        onClick={onRetry}
        data-testid="catalog-retry"
        className="ff-accent-control flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
        style={{ background: 'var(--ff-accent-solid)', color: 'var(--ff-on-accent)' }}
      >
        <RotateCw size={14} aria-hidden="true" />
        Try again
      </button>
    </div>
  );
}
