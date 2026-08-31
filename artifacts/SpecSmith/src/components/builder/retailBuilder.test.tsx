// @vitest-environment jsdom
//
// The retail builder is the first UI in this repository with behavioural tests:
// category switching, load-more and the image fallback are not things a pure
// function can demonstrate. The environment is requested per file, so the
// several hundred existing logic suites keep running in Node.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import catalogData from '../../../public/data/retail-parts.json';
import { parseAffiliatePartCatalog, type AffiliatePart, type RetailPartCategory } from '../../lib/retail/partCatalog';
import { PRICE_FRESHNESS_MS } from '../../lib/retail/partPricing';
import { PRODUCT_BATCH_SIZE } from '../../lib/retail/retailShopping';
import RetailBuilder from './RetailBuilder';
import RetailProductCard from './RetailProductCard';

const parsed = parseAffiliatePartCatalog(catalogData);
if (!parsed.ok) throw new Error(`published catalogue invalid: ${parsed.problem}`);
const catalog = parsed.catalog;

/** A moment at which the whole published catalogue is fresh. */
const FRESH_NOW = Math.max(...catalog.parts.map((part) => Date.parse(part.fetchedAt))) + 60_000;

const gpuParts = catalog.parts.filter((part) => part.category === 'gpu');

afterEach(cleanup);

function renderBuilder(selection: Partial<Record<RetailPartCategory, string | null>> = {}) {
  const onSelect = vi.fn();
  const view = render(
    <RetailBuilder parts={catalog.parts} selection={selection} onSelect={onSelect} now={FRESH_NOW} />,
  );
  return { onSelect, view };
}

describe('the shopping grid shows only retailer SKUs', () => {
  it('renders products from the catalogue and no canonical model row', () => {
    renderBuilder();
    const cards = screen.getAllByTestId('retail-product-card');
    expect(cards.length).toBe(PRODUCT_BATCH_SIZE);
    // Every rendered card is a Newegg SKU id, never a canonical id like "rtx5090".
    for (const card of cards) {
      expect(card.getAttribute('data-part-id')).toMatch(/^newegg-/);
    }
  });

  it('shows no hand-maintained estimate anywhere in the grid', () => {
    renderBuilder();
    // The canonical RTX 5090 estimate that used to appear as its own row.
    expect(document.body.textContent).not.toContain('$3,979');
  });

  it('gives every card its own image, price and tracked link', () => {
    renderBuilder();
    const card = screen.getAllByTestId('retail-product-card')[0];
    const id = card.getAttribute('data-part-id');
    const part = catalog.parts.find((p) => p.id === id)!;

    // alt="" makes the image decorative — the title carries the accessible
    // name — so it is queried as an element rather than by role.
    expect(card.querySelector('img')?.getAttribute('src')).toBe(part.imageUrl);
    expect(within(card).getByTestId('view-at-newegg').getAttribute('href')).toBe(part.trackedAffiliateUrl);
    expect(within(card).getByTestId('price-checked').textContent).toMatch(/^Price checked /);
    expect(within(card).getByTestId('availability').textContent).toBe('Availability unknown');
  });

  it('keeps several retailer variants of one model visible and distinct', () => {
    // ASUS, MSI, ZOTAC and Gigabyte versions of one GPU are four products.
    const shared = new Map<string, AffiliatePart[]>();
    for (const part of gpuParts) {
      if (!part.canonicalPartId) continue;
      shared.set(part.canonicalPartId, [...(shared.get(part.canonicalPartId) ?? []), part]);
    }
    const model = [...shared.entries()].find(([, list]) => list.length > 1);
    expect(model).toBeDefined();
    if (!model) return;

    const [canonicalId, variants] = model;
    renderBuilder();
    fireEvent.change(screen.getByTestId('catalog-search'), { target: { value: variants[0].name.split(/\s+/)[1] ?? '' } });

    // No card carries the canonical id, however many variants are on screen.
    for (const card of screen.getAllByTestId('retail-product-card')) {
      expect(card.getAttribute('data-part-id')).not.toBe(canonicalId);
    }
  });

  it('selecting a SKU does not add a canonical row to the grid', () => {
    const chosen = gpuParts.find((part) => part.canonicalPartId) ?? gpuParts[0];
    renderBuilder({ gpu: chosen.id });
    // Narrow to the chosen product so it is on screen regardless of sort order.
    fireEvent.change(screen.getByTestId('catalog-search'), { target: { value: chosen.name.slice(0, 24) } });
    const ids = screen.getAllByTestId('retail-product-card').map((card) => card.getAttribute('data-part-id'));
    expect(ids).toContain(chosen.id);
    expect(ids).not.toContain(chosen.canonicalPartId);
    // Exactly one card is marked selected.
    expect(ids.filter((id) => id === chosen.id)).toHaveLength(1);
  });
});

describe('category navigation', () => {
  it('starts on graphics cards and shows one category at a time', () => {
    renderBuilder();
    expect(screen.getByTestId('category-rail-gpu').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('category-rail-cpu').getAttribute('data-active')).toBe('false');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Graphics card');
    for (const card of screen.getAllByTestId('retail-product-card')) {
      expect(card.getAttribute('data-part-id')).toMatch(/^newegg-gpu-/);
    }
  });

  it('switches the centre column when another category is chosen', () => {
    renderBuilder();
    fireEvent.click(screen.getByTestId('category-rail-keyboard'));

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Keyboard');
    expect(screen.getByTestId('category-rail-keyboard').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('category-rail-gpu').getAttribute('data-active')).toBe('false');
    for (const card of screen.getAllByTestId('retail-product-card')) {
      expect(card.getAttribute('data-part-id')).toMatch(/^newegg-keyboard-/);
    }
  });

  it('offers all twelve categories in both the rail and the mobile chips', () => {
    renderBuilder();
    for (const category of ['gpu', 'cpu', 'motherboard', 'ram', 'storage', 'psu', 'case', 'cooler', 'monitor', 'keyboard', 'mouse', 'headset']) {
      expect(screen.getByTestId(`category-rail-${category}`)).toBeDefined();
      expect(screen.getByTestId(`category-chip-${category}`)).toBeDefined();
    }
  });

  it('mobile chips select a category too', () => {
    renderBuilder();
    fireEvent.click(screen.getByTestId('category-chip-monitor'));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Monitor');
    expect(screen.getByTestId('category-chip-monitor').getAttribute('data-active')).toBe('true');
  });

  it('shows a sticky View build action carrying the selection count', () => {
    renderBuilder({ gpu: gpuParts[0].id });
    expect(screen.getByTestId('view-build').textContent).toContain('View build (1)');
  });
});

describe('batching', () => {
  it('renders one batch, then extends it on Load more', () => {
    renderBuilder();
    expect(screen.getAllByTestId('retail-product-card')).toHaveLength(PRODUCT_BATCH_SIZE);

    fireEvent.click(screen.getByTestId('load-more'));
    expect(screen.getAllByTestId('retail-product-card').length).toBeGreaterThan(PRODUCT_BATCH_SIZE);
  });

  it('resets to the first batch when the search changes', () => {
    renderBuilder();
    fireEvent.click(screen.getByTestId('load-more'));
    expect(screen.getAllByTestId('retail-product-card').length).toBeGreaterThan(PRODUCT_BATCH_SIZE);

    fireEvent.change(screen.getByTestId('catalog-search'), { target: { value: 'rtx' } });
    expect(screen.getAllByTestId('retail-product-card').length).toBeLessThanOrEqual(PRODUCT_BATCH_SIZE);
  });

  it('has no nested scrolling product panel', () => {
    const { view } = renderBuilder();
    const grid = screen.getByTestId('product-grid');
    // The old layout wrapped the list in `max-h-[400px] overflow-y-auto`.
    expect(grid.className).not.toMatch(/overflow-y-auto|max-h-\[/);
    expect(view.container.querySelectorAll('[class*="max-h-[400px]"]')).toHaveLength(0);
  });
});

describe('a card states its price honestly', () => {
  const cardFor = (part: AffiliatePart, now: number) =>
    render(<RetailProductCard part={part} selected={false} now={now} onToggle={() => {}} />);

  it('shows a sale price primary with the retail price struck through', () => {
    const onSale = catalog.parts.find((part) => part.salePrice !== null);
    expect(onSale).toBeDefined();
    if (!onSale) return;
    cardFor(onSale, Date.parse(onSale.fetchedAt) + 1000);

    expect(screen.getByTestId('price-primary').textContent).toContain(
      onSale.salePrice!.toLocaleString('en-US', { minimumFractionDigits: 2 }),
    );
    expect(screen.getByTestId('price-struck').textContent).toContain(
      onSale.retailPrice.toLocaleString('en-US', { minimumFractionDigits: 2 }),
    );
  });

  it('shows no strike-through when there is no discount', () => {
    const plain = catalog.parts.find((part) => part.salePrice === null)!;
    cardFor(plain, Date.parse(plain.fetchedAt) + 1000);
    expect(screen.queryByTestId('price-struck')).toBeNull();
  });

  it('hides a stale price and points at the merchant instead', () => {
    const part = gpuParts[0];
    cardFor(part, Date.parse(part.fetchedAt) + PRICE_FRESHNESS_MS + 60_000);

    expect(screen.queryByTestId('price-primary')).toBeNull();
    expect(screen.getByTestId('price-stale').textContent).toBe('See current price at Newegg');
    // No number survives anywhere on the card.
    expect(document.body.textContent).not.toContain(String(Math.floor(part.retailPrice)));
  });

  it('never claims stock', () => {
    cardFor(gpuParts[0], FRESH_NOW);
    const text = document.body.textContent ?? '';
    for (const forbidden of ['In stock', 'Out of stock', 'Available now', 'Sold out']) {
      expect(text).not.toContain(forbidden);
    }
    expect(screen.getByTestId('availability').textContent).toBe('Availability unknown');
  });

  it('offers Add to build and View at Newegg as two separate controls', () => {
    cardFor(gpuParts[0], FRESH_NOW);
    expect(screen.getByTestId('add-to-build').tagName).toBe('BUTTON');
    const link = screen.getByTestId('view-at-newegg');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('rel')).toContain('sponsored');
  });

  it('keeps the product when its image fails, showing a neutral placeholder', () => {
    const part = gpuParts[0];
    const { container } = cardFor(part, FRESH_NOW);
    fireEvent.error(container.querySelector('img')!);

    expect(screen.getByTestId('image-placeholder')).toBeDefined();
    // The product is still there: title, price and both actions survive.
    expect(screen.getByTestId('price-primary')).toBeDefined();
    expect(screen.getByTestId('add-to-build')).toBeDefined();
    expect(screen.getByTestId('view-at-newegg')).toBeDefined();
  });

  it('shows the full merchant title as the accessible name', () => {
    const long = catalog.parts.find((part) => part.name.length > 80)!;
    cardFor(long, FRESH_NOW);
    expect(screen.getByRole('heading', { level: 3 }).getAttribute('aria-label')).toBe(long.name);
  });
});

describe('the build summary', () => {
  it('keeps the exact selected SKU and its own price', () => {
    const chosen = gpuParts.find((part) => part.salePrice === null) ?? gpuParts[0];
    renderBuilder({ gpu: chosen.id });

    const summary = screen.getAllByTestId('build-summary')[0];
    expect(within(summary).getByTestId('summary-item-gpu')).toBeDefined();
    expect(within(summary).getByTestId('summary-price-gpu').textContent).toContain(
      (chosen.salePrice ?? chosen.retailPrice).toLocaleString('en-US', { minimumFractionDigits: 2 }),
    );
    expect(within(summary).getByTestId('subtotal-label').textContent).toBe('Current price subtotal');
  });

  it('falls back to a known-price subtotal and names the excluded item', () => {
    const chosen = gpuParts[0];
    render(
      <RetailBuilder
        parts={catalog.parts}
        selection={{ gpu: chosen.id }}
        onSelect={() => {}}
        now={Date.parse(chosen.fetchedAt) + PRICE_FRESHNESS_MS + 60_000}
      />,
    );
    const summary = screen.getAllByTestId('build-summary')[0];
    expect(within(summary).getByTestId('subtotal-label').textContent).toBe('Known-price subtotal');
    expect(within(summary).getByTestId('subtotal-exclusions').textContent).toContain('Graphics card');
    expect(within(summary).getByTestId('summary-stale-gpu').textContent).toContain('See current price at Newegg');
  });

  it('never substitutes an editorial estimate for a hidden price', () => {
    const chosen = gpuParts[0];
    render(
      <RetailBuilder
        parts={catalog.parts}
        selection={{ gpu: chosen.id }}
        onSelect={() => {}}
        now={Date.parse(chosen.fetchedAt) + PRICE_FRESHNESS_MS + 60_000}
      />,
    );
    const summary = screen.getAllByTestId('build-summary')[0];
    expect(within(summary).getByTestId('subtotal-amount').textContent).toBe('—');
  });

  it('marks an unverified SKU rather than inventing a mapping', () => {
    const unverified = catalog.parts.find((part) => part.category === 'keyboard')!;
    renderBuilder({ keyboard: unverified.id });
    const summary = screen.getAllByTestId('build-summary')[0];
    expect(within(summary).getByTestId('summary-unverified-keyboard')).toBeDefined();
  });
});
