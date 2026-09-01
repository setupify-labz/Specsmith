import { useMemo, useState } from 'react';
import { Sparkles, ShoppingCart } from 'lucide-react';

import type { AffiliatePart, RetailPartCategory } from '../../lib/retail/partCatalog';
import { groupByCategory } from '../../lib/retail/retailShopping';
import { WHITE_COLLECTION_NOTE, whiteParts } from '../../lib/retail/whiteBuild';
import { CategoryChips, CategoryRail } from './CategoryNav';
import RetailBuildSummary from './RetailBuildSummary';
import RetailCatalog from './RetailCatalog';

interface Props {
  /** The 500-part retailer catalogue. Retail SKUs only — canonical parts never reach here. */
  parts: readonly AffiliatePart[];
  /** Selected SKU id per category. */
  selection: Readonly<Partial<Record<RetailPartCategory, string | null>>>;
  onSelect: (category: RetailPartCategory, id: string | null) => void;
  /** Injected so freshness is deterministic in tests. */
  now?: number;
}

/**
 * The shopping interface: navigation, one category's catalogue, and the build.
 *
 * Desktop is three columns — rail, catalogue, sticky summary. Mobile is one
 * column with a scrollable chip row at the top and a sticky "View build"
 * button at the bottom. Exactly one category is shown at a time in both.
 *
 * The page scrolls; nothing inside it does. The summary is `position: sticky`,
 * which keeps it in view without creating a second scroll region.
 */
export default function RetailBuilder({ parts, selection, onSelect, now }: Props) {
  const [active, setActive] = useState<RetailPartCategory>('gpu');
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const [mobileSummaryOpen, setMobileSummaryOpen] = useState(false);
  const clock = now ?? Date.now();

  // THE WHITE COLLECTION IS A FILTER, NOT A CATEGORY. The twelve categories
  // stay exactly as they are; switching it on narrows each one to the listings
  // whose own merchant title states a white finish. Every SKU keeps its price,
  // its image and its link, because it is the same SKU.
  const [whiteOnly, setWhiteOnly] = useState(false);
  const visibleParts = useMemo(() => (whiteOnly ? whiteParts(parts) : [...parts]), [parts, whiteOnly]);

  const byCategory = useMemo(() => groupByCategory(visibleParts), [visibleParts]);
  const byId = useMemo(() => new Map(parts.map((part) => [part.id, part])), [parts]);

  const counts = useMemo(() => {
    const result: Partial<Record<RetailPartCategory, number>> = {};
    for (const [category, list] of byCategory) result[category] = list.length;
    return result;
  }, [byCategory]);

  const whiteTotal = useMemo(() => whiteParts(parts).length, [parts]);

  const selectedParts = useMemo(
    () =>
      (Object.entries(selection) as [RetailPartCategory, string | null][])
        .flatMap(([category, id]) => {
          if (!id) return [];
          const part = byId.get(id);
          // A selection that is not in the current catalogue — a saved draft
          // naming a SKU that has since dropped out — is skipped rather than
          // rendered from stale memory.
          return part ? [{ category, part }] : [];
        })
        .sort((a, b) => a.category.localeCompare(b.category)),
    [selection, byId],
  );

  const summary = (
    <RetailBuildSummary
      selectedParts={selectedParts}
      now={clock}
      collapsed={summaryCollapsed}
      onToggleCollapsed={() => setSummaryCollapsed((value) => !value)}
      onRemove={(category) => onSelect(category, null)}
    />
  );

  const navProps = { active, counts, selected: selection, onSelect: setActive };

  return (
    <div data-testid="retail-builder">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setWhiteOnly((on) => !on)}
          aria-pressed={whiteOnly}
          data-testid="white-build-toggle"
          className="ff-accent-control flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold"
          style={{
            background: whiteOnly ? 'var(--ff-accent-solid)' : 'var(--ff-card)',
            color: whiteOnly ? 'var(--ff-on-accent)' : 'var(--ff-text-2)',
            border: `1px solid ${whiteOnly ? 'var(--ff-accent)' : 'var(--ff-border)'}`,
          }}
        >
          <Sparkles size={15} aria-hidden="true" />
          White build
          <span style={{ opacity: 0.8 }}>{whiteTotal}</span>
        </button>
        {whiteOnly && (
          <p className="text-[11px] leading-snug" style={{ color: 'var(--ff-text-3)', maxWidth: '52ch' }} data-testid="white-build-note">
            {WHITE_COLLECTION_NOTE}
          </p>
        )}
      </div>

      {/* Mobile category controls. */}
      <div className="mb-4 lg:hidden">
        <CategoryChips {...navProps} />
      </div>

      <div className="flex gap-6">
        {/* Left rail — desktop only. */}
        {/* 224px, widening to 240px on a large desktop — the review's 220-250 band. */}
        <div className="hidden w-56 shrink-0 lg:block 2xl:w-60">
          <div className="sticky top-20">
            <CategoryRail {...navProps} />
          </div>
        </div>

        {/* Centre catalogue. */}
        <div className="min-w-0 flex-1">
          <RetailCatalog
            category={active}
            whiteOnly={whiteOnly}
            parts={byCategory.get(active) ?? []}
            selectedId={selection[active] ?? null}
            now={clock}
            onToggle={(id) => onSelect(active, selection[active] === id ? null : id)}
          />
        </div>

        {/* Right summary — desktop only, sticky rather than independently scrolling. */}
        {/* 320px, widening to 360px — the review's 320-380 band. It was 288px,
            which cropped the longer merchant titles in the summary. */}
        <div className="hidden w-80 shrink-0 xl:block 2xl:w-[360px]">
          <div className="sticky top-20">{summary}</div>
        </div>
      </div>

      {/* Mobile / tablet: the summary opens over the page from a sticky button,
          so the build is always one tap away without stealing vertical space
          from the products. */}
      <div className="xl:hidden">
        {mobileSummaryOpen && (
          <div className="fixed inset-0 z-40 flex items-end" style={{ background: 'rgba(0,0,0,0.55)' }}>
            <button
              type="button"
              aria-label="Close build summary"
              className="absolute inset-0"
              onClick={() => setMobileSummaryOpen(false)}
            />
            <div className="relative z-10 max-h-[80vh] w-full overflow-y-auto p-3">{summary}</div>
          </div>
        )}
        <div
          className="sticky bottom-0 z-30 -mx-4 mt-6 px-4 py-3"
          style={{ background: 'var(--ff-nav-bg)', borderTop: '1px solid var(--ff-border)' }}
        >
          <button
            type="button"
            onClick={() => setMobileSummaryOpen((open) => !open)}
            data-testid="view-build"
            className="ff-accent-control flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold"
            style={{ background: 'var(--ff-accent-solid)', color: 'var(--ff-on-accent)' }}
          >
            <ShoppingCart size={16} aria-hidden="true" />
            View build ({selectedParts.length})
          </button>
        </div>
      </div>
    </div>
  );
}
