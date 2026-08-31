import { useMemo, useState } from 'react';
import { ShoppingCart } from 'lucide-react';

import type { AffiliatePart, RetailPartCategory } from '../../lib/retail/partCatalog';
import { groupByCategory } from '../../lib/retail/retailShopping';
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

  const byCategory = useMemo(() => groupByCategory(parts), [parts]);
  const byId = useMemo(() => new Map(parts.map((part) => [part.id, part])), [parts]);

  const counts = useMemo(() => {
    const result: Partial<Record<RetailPartCategory, number>> = {};
    for (const [category, list] of byCategory) result[category] = list.length;
    return result;
  }, [byCategory]);

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
      {/* Mobile category controls. */}
      <div className="mb-4 lg:hidden">
        <CategoryChips {...navProps} />
      </div>

      <div className="flex gap-6">
        {/* Left rail — desktop only. */}
        <div className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-20">
            <CategoryRail {...navProps} />
          </div>
        </div>

        {/* Centre catalogue. */}
        <div className="min-w-0 flex-1">
          <RetailCatalog
            category={active}
            parts={byCategory.get(active) ?? []}
            selectedId={selection[active] ?? null}
            now={clock}
            onToggle={(id) => onSelect(active, selection[active] === id ? null : id)}
          />
        </div>

        {/* Right summary — desktop only, sticky rather than independently scrolling. */}
        <div className="hidden w-72 shrink-0 xl:block">
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
            className="flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold"
            style={{ background: 'var(--ff-accent-solid)', color: 'var(--ff-accent-text)' }}
          >
            <ShoppingCart size={16} aria-hidden="true" />
            View build ({selectedParts.length})
          </button>
        </div>
      </div>
    </div>
  );
}
