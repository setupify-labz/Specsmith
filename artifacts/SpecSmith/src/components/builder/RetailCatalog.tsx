import { useMemo, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';

import type { AffiliatePart, RetailPartCategory } from '../../lib/retail/partCatalog';
import {
  CATEGORY_LABELS,
  EMPTY_FILTERS,
  PRODUCT_BATCH_SIZE,
  brandsIn,
  filterAndSort,
  type CatalogFilters,
  type ProductSort,
} from '../../lib/retail/retailShopping';
import { WHITE_EMPTY_MESSAGE, isColorNeutralCategory } from '../../lib/retail/whiteBuild';
import ProductDetailDrawer from './ProductDetailDrawer';
import RetailProductCard from './RetailProductCard';

interface Props {
  category: RetailPartCategory;
  /** True when the White build collection is on, which changes the empty state. */
  whiteOnly?: boolean;
  parts: readonly AffiliatePart[];
  selectedId: string | null;
  now: number;
  onToggle: (id: string) => void;
}

/**
 * The centre column: one category's products, and only retailer SKUs.
 *
 * `parts` is AffiliatePart[], so there is no argument through which a
 * canonical/reference row could reach this grid.
 *
 * NO NESTED SCROLLER. The grid grows down the page and the page itself
 * scrolls. The old layout put a `max-h-[400px] overflow-y-auto` box inside an
 * accordion inside the page, which meant three scrollbars competing for the
 * same wheel gesture.
 */
export default function RetailCatalog({ category, whiteOnly = false, parts, selectedId, now, onToggle }: Props) {
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_FILTERS);
  const [visible, setVisible] = useState(PRODUCT_BATCH_SIZE);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const brands = useMemo(() => brandsIn(parts), [parts]);
  const results = useMemo(() => filterAndSort(parts, filters), [parts, filters]);
  const shown = results.slice(0, visible);
  const detailPart = detailId === null ? undefined : parts.find((part) => part.id === detailId);

  // Any change to what is being filtered starts the batching over, so "Load
  // more" never reveals products from a previous query.
  const update = (next: Partial<CatalogFilters>) => {
    setFilters((prev) => ({ ...prev, ...next }));
    setVisible(PRODUCT_BATCH_SIZE);
  };

  const toggleBrand = (brand: string) =>
    update({ brands: filters.brands.includes(brand) ? filters.brands.filter((b) => b !== brand) : [...filters.brands, brand] });

  return (
    <section aria-labelledby="catalog-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 id="catalog-heading" className="text-xl font-semibold" style={{ color: 'var(--ff-text)' }}>
          {CATEGORY_LABELS[category]}
        </h1>
        <p className="text-sm" style={{ color: 'var(--ff-text-2)' }} data-testid="result-count">
          {results.length === parts.length
            ? `${results.length} products`
            : `${results.length} of ${parts.length} products`}
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--ff-text-3)' }}
          />
          <input
            type="search"
            value={filters.search}
            onChange={(event) => update({ search: event.target.value })}
            placeholder={`Search ${CATEGORY_LABELS[category].toLowerCase()}s`}
            aria-label={`Search ${CATEGORY_LABELS[category]}`}
            data-testid="catalog-search"
            className="w-full rounded-lg py-3 pl-9 pr-3 text-sm"
            style={{ background: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
          />
        </div>
        <select
          value={filters.sort}
          onChange={(event) => update({ sort: event.target.value as ProductSort })}
          aria-label="Sort products"
          data-testid="catalog-sort"
          className="rounded-lg px-3 py-3 text-sm"
          style={{ background: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
        >
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
          <option value="name">Name</option>
        </select>
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          data-testid="catalog-filter-toggle"
          className="flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-sm"
          style={{ background: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          Filters
        </button>
      </div>

      {filtersOpen && (
        <div
          data-testid="catalog-filters"
          className="flex flex-col gap-3 rounded-lg p-3"
          style={{ background: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium" style={{ color: 'var(--ff-text-2)' }}>Price</span>
            <input
              type="number"
              min={0}
              inputMode="decimal"
              value={filters.minPrice ?? ''}
              onChange={(event) => update({ minPrice: event.target.value === '' ? null : Number(event.target.value) })}
              placeholder="Min"
              aria-label="Minimum price"
              data-testid="filter-min-price"
              className="w-24 rounded px-2 py-1.5 text-sm"
              style={{ background: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
            />
            <span style={{ color: 'var(--ff-text-3)' }}>–</span>
            <input
              type="number"
              min={0}
              inputMode="decimal"
              value={filters.maxPrice ?? ''}
              onChange={(event) => update({ maxPrice: event.target.value === '' ? null : Number(event.target.value) })}
              placeholder="Max"
              aria-label="Maximum price"
              data-testid="filter-max-price"
              className="w-24 rounded px-2 py-1.5 text-sm"
              style={{ background: 'var(--ff-input-bg)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
            />
          </div>
          {/* Brand is offered because it is read from the merchant's own title.
              No spec-based filter is offered for a category whose specs the
              feed does not verify — an invented filter is worse than none. */}
          <div className="flex flex-wrap gap-1.5">
            {brands.slice(0, 14).map((brand) => {
              const on = filters.brands.includes(brand);
              return (
                <button
                  key={brand}
                  type="button"
                  onClick={() => toggleBrand(brand)}
                  aria-pressed={on}
                  data-testid={`filter-brand-${brand}`}
                  className="ff-accent-control rounded-full px-2.5 py-1 text-xs"
                  style={{
                    background: on ? 'var(--ff-accent-solid)' : 'var(--ff-card)',
                    color: on ? 'var(--ff-on-accent)' : 'var(--ff-text-2)',
                    border: `1px solid ${on ? 'var(--ff-accent)' : 'var(--ff-border)'}`,
                  }}
                >
                  {brand}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {results.length === 0 ? (
        // Two different emptinesses. "Your filters match nothing" is the user's
        // doing; "no listing here states a white finish" is ours, and saying so
        // is better than padding the collection with guesses.
        //
        // The white message is only ever right for a category the collection
        // actually filters. A colour-neutral one is never narrowed by finish,
        // so an empty result there is the user's filters and blaming it on
        // missing white stock would be a false explanation.
        <p className="py-10 text-center text-sm" style={{ color: 'var(--ff-text-2)' }} data-testid="catalog-empty">
          {whiteOnly && parts.length === 0 && !isColorNeutralCategory(category)
            ? WHITE_EMPTY_MESSAGE
            : 'No products match these filters.'}
        </p>
      ) : (
        <>
          {/* One column on a phone, two from md, three on a large desktop.
              NOT FOUR. At the shell's 1760px ceiling the centre column is about
              1050px wide, so a fourth card would be roughly 250px — under the
              300px the review set as the floor for a card that still reads.
              Columns are added rather than cards enlarged: the card's own type
              and image frame are unchanged at every width. */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3" data-testid="product-grid">
            {shown.map((part) => (
              <RetailProductCard
                key={part.id}
                part={part}
                selected={part.id === selectedId}
                now={now}
                onToggle={onToggle}
                onOpenDetails={setDetailId}
              />
            ))}
          </div>

          {visible < results.length && (
            <button
              type="button"
              onClick={() => setVisible((count) => count + PRODUCT_BATCH_SIZE)}
              data-testid="load-more"
              className="mx-auto rounded-lg px-5 py-2.5 text-sm font-semibold"
              style={{ background: 'var(--ff-surface)', border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
            >
              Load more ({results.length - visible} remaining)
            </button>
          )}
        </>
      )}

      {detailPart !== undefined && (
        <ProductDetailDrawer
          part={detailPart}
          now={now}
          selected={detailPart.id === selectedId}
          onClose={() => setDetailId(null)}
          onToggle={onToggle}
        />
      )}

      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ff-text-3)' }}>
        Affiliate disclosure: SpecSmith may earn a commission from purchases made through retailer links. Your price is not increased.
      </p>
    </section>
  );
}
