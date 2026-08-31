import { Check } from 'lucide-react';

import type { RetailPartCategory } from '../../lib/retail/partCatalog';
import {
  CATEGORY_GROUPS,
  CATEGORY_LABELS,
  CATEGORY_SHORT_LABELS,
} from '../../lib/retail/retailShopping';
import { CATEGORY_ICONS } from './categoryIcons';

interface Props {
  active: RetailPartCategory;
  counts: Readonly<Partial<Record<RetailPartCategory, number>>>;
  selected: Readonly<Partial<Record<RetailPartCategory, string | null>>>;
  onSelect: (category: RetailPartCategory) => void;
}

/**
 * The left rail on desktop.
 *
 * One category is active at a time, and the whole point of the rail is that
 * choosing another REPLACES the centre column rather than expanding a section
 * below the current one. Hundreds of products stacked in accordions is the
 * layout this removes.
 *
 * Each row carries the four things a shopper needs before clicking: an icon,
 * the category name, whether a part is already chosen, and how many products
 * are available.
 */
export function CategoryRail({ active, counts, selected, onSelect }: Props) {
  return (
    <nav aria-label="Product categories" data-testid="category-rail" className="flex flex-col gap-5">
      {CATEGORY_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <h2
            className="px-2 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--ff-text-3)' }}
          >
            {group.label}
          </h2>
          {group.categories.map((category) => {
            const Icon = CATEGORY_ICONS[category];
            const isActive = category === active;
            const chosen = Boolean(selected[category]);
            return (
              <button
                key={category}
                type="button"
                onClick={() => onSelect(category)}
                aria-current={isActive ? 'true' : undefined}
                data-testid={`category-rail-${category}`}
                data-active={isActive ? 'true' : 'false'}
                className="flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors"
                style={{
                  background: isActive ? 'var(--ff-accent-10)' : 'transparent',
                  color: isActive ? 'var(--ff-text)' : 'var(--ff-text-2)',
                  // The active row is unmistakable: tinted, bordered on the
                  // leading edge, and bold.
                  boxShadow: isActive ? 'inset 3px 0 0 0 var(--ff-accent)' : undefined,
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                <Icon size={15} aria-hidden="true" />
                <span className="flex-1">{CATEGORY_LABELS[category]}</span>
                {chosen ? (
                  <Check size={14} aria-hidden="true" style={{ color: 'var(--ff-green)' }} aria-label="Part selected" />
                ) : (
                  <span className="text-[11px]" style={{ color: 'var(--ff-text-3)' }}>
                    {counts[category] ?? 0}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/**
 * The mobile equivalent: one horizontally scrollable row of chips.
 *
 * A drawer would hide the categories behind a tap; a chip row keeps them
 * visible and thumb-reachable. This row scrolls sideways — it is not a nested
 * vertical scroller inside the product list, which is the thing that made the
 * old layout unusable on a phone.
 */
export function CategoryChips({ active, counts, selected, onSelect }: Props) {
  return (
    <nav
      aria-label="Product categories"
      data-testid="category-chips"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
      style={{ scrollbarWidth: 'none' }}
    >
      {CATEGORY_GROUPS.flatMap((group) => group.categories).map((category) => {
        const Icon = CATEGORY_ICONS[category];
        const isActive = category === active;
        const chosen = Boolean(selected[category]);
        return (
          <button
            key={category}
            type="button"
            onClick={() => onSelect(category)}
            aria-current={isActive ? 'true' : undefined}
            data-testid={`category-chip-${category}`}
            data-active={isActive ? 'true' : 'false'}
            className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs whitespace-nowrap"
            style={{
              background: isActive ? 'var(--ff-accent-solid)' : 'var(--ff-card)',
              color: isActive ? 'var(--ff-accent-text)' : 'var(--ff-text-2)',
              border: `1px solid ${isActive ? 'var(--ff-accent)' : 'var(--ff-border)'}`,
              fontWeight: isActive ? 600 : 400,
            }}
          >
            <Icon size={13} aria-hidden="true" />
            {CATEGORY_SHORT_LABELS[category]}
            {chosen ? (
              <Check size={12} aria-hidden="true" style={{ color: isActive ? 'inherit' : 'var(--ff-green)' }} />
            ) : (
              <span style={{ opacity: 0.65 }}>{counts[category] ?? 0}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
