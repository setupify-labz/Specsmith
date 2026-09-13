// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import catalogData from '../../../public/data/retail-parts.json';
import { parseAffiliatePartCatalog, type RetailPartCategory } from '../../lib/retail/partCatalog';
import RetailBuilder from './RetailBuilder';

// Switching the White build collection changes WHICH PRODUCTS EXIST, so every
// piece of browsing state chosen against the old set can be left pointing at
// listings the new set does not contain: a search, a brand chip, a price
// range, a "Load more" page, an open product detail.
//
// This is issue #102's problem with a different trigger — a stale "0 of 21
// products" painted over a view the shopper never filtered — and it has the
// same answer: the catalogue is remounted, so all of it clears in the render
// the new collection first appears.
//
// The one thing that must NOT clear is the build. Selected parts live in
// `selection`, above the catalogue, and a remount cannot reach them.

const parsed = parseAffiliatePartCatalog(catalogData);
if (!parsed.ok) throw new Error(`published catalogue invalid: ${parsed.problem}`);
const catalog = parsed.catalog;
const FRESH_NOW = Math.max(...catalog.parts.map((part) => Date.parse(part.fetchedAt))) + 60_000;

afterEach(cleanup);

/** Drives the builder with real selection state, as the page does. */
function renderBuilder(initial: Partial<Record<RetailPartCategory, string | null>> = {}) {
  let selection = { ...initial };
  const onSelect = vi.fn((category: RetailPartCategory, id: string | null) => {
    selection = { ...selection, [category]: id };
    view.rerender(<RetailBuilder parts={catalog.parts} selection={selection} onSelect={onSelect} now={FRESH_NOW} />);
  });
  const view = render(
    <RetailBuilder parts={catalog.parts} selection={selection} onSelect={onSelect} now={FRESH_NOW} />,
  );
  return { view, selection: () => selection };
}

const toggleWhite = () => fireEvent.click(screen.getByTestId('white-build-toggle'));
const shownIds = () =>
  screen.queryAllByTestId('retail-product-card').map((card) => card.getAttribute('data-part-id'));

describe('switching the White build collection resets what belongs to the old one', () => {
  it('clears a search that was typed against the full catalogue', () => {
    renderBuilder();
    fireEvent.change(screen.getByTestId('catalog-search'), { target: { value: 'rtx 3050' } });
    expect((screen.getByTestId('catalog-search') as HTMLInputElement).value).toBe('rtx 3050');
    const narrowed = shownIds().length;
    expect(narrowed).toBeGreaterThan(0);

    toggleWhite();

    // The box is empty and the results are the collection's own, not the
    // intersection of a stale query with a new product set.
    expect((screen.getByTestId('catalog-search') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('result-count').textContent).not.toContain('of');
  });

  it('clears a brand filter, and the filter panel it was chosen in', () => {
    renderBuilder();
    fireEvent.click(screen.getByTestId('catalog-filter-toggle'));
    const brand = screen.getAllByTestId(/^filter-brand-/)[0];
    const brandName = brand.getAttribute('data-testid');
    fireEvent.click(brand);
    expect(brand.getAttribute('aria-pressed')).toBe('true');

    toggleWhite();

    // The panel is closed again, so the chip is not merely unpressed but out
    // of view — the whole panel belonged to the previous collection.
    expect(screen.queryByTestId('catalog-filters')).toBeNull();
    fireEvent.click(screen.getByTestId('catalog-filter-toggle'));
    const after = screen.queryByTestId(brandName!);
    if (after !== null) expect(after.getAttribute('aria-pressed')).toBe('false');
  });

  it('clears a price range typed against the old set', () => {
    renderBuilder();
    fireEvent.click(screen.getByTestId('catalog-filter-toggle'));
    fireEvent.change(screen.getByTestId('filter-max-price'), { target: { value: '400' } });
    expect((screen.getByTestId('filter-max-price') as HTMLInputElement).value).toBe('400');

    toggleWhite();

    fireEvent.click(screen.getByTestId('catalog-filter-toggle'));
    expect((screen.getByTestId('filter-max-price') as HTMLInputElement).value).toBe('');
  });

  it('returns to the first page instead of holding a page that no longer exists', () => {
    renderBuilder();
    const firstPage = shownIds().length;
    fireEvent.click(screen.getByTestId('load-more'));
    expect(shownIds().length).toBeGreaterThan(firstPage);

    toggleWhite();

    // The white GPU collection is smaller than one page, so paging is gone
    // entirely rather than stranded on page two.
    expect(shownIds().length).toBeLessThanOrEqual(firstPage);
    expect(screen.queryByTestId('load-more')).toBeNull();
  });

  it('closes an open product detail, which may describe a listing now absent', () => {
    renderBuilder();
    fireEvent.click(screen.getAllByTestId('view-details')[0]);
    expect(screen.getByTestId('product-detail')).toBeDefined();

    toggleWhite();

    expect(screen.queryByTestId('product-detail')).toBeNull();
  });

  it('resets again on the way back out', () => {
    // Not a one-way property: leaving the collection changes the product set
    // just as much as entering it did.
    renderBuilder();
    toggleWhite();
    fireEvent.change(screen.getByTestId('catalog-search'), { target: { value: 'asus' } });
    expect((screen.getByTestId('catalog-search') as HTMLInputElement).value).toBe('asus');

    toggleWhite();

    expect((screen.getByTestId('catalog-search') as HTMLInputElement).value).toBe('');
  });
});

describe('what the reset must never touch', () => {
  it('keeps every selected part, in and out of the collection', () => {
    const gpu = catalog.parts.find((part) => part.category === 'gpu')!;
    const cpu = catalog.parts.find((part) => part.category === 'cpu')!;
    const { selection } = renderBuilder({ gpu: gpu.id, cpu: cpu.id });

    const summary = screen.getAllByTestId('build-summary')[0];
    expect(within(summary).getByTestId('summary-item-gpu')).toBeDefined();
    expect(within(summary).getByTestId('summary-item-cpu')).toBeDefined();

    toggleWhite();
    expect(selection()).toEqual({ gpu: gpu.id, cpu: cpu.id });
    const inCollection = screen.getAllByTestId('build-summary')[0];
    expect(within(inCollection).getByTestId('summary-item-gpu')).toBeDefined();
    expect(within(inCollection).getByTestId('summary-item-cpu')).toBeDefined();

    toggleWhite();
    expect(selection()).toEqual({ gpu: gpu.id, cpu: cpu.id });
    const back = screen.getAllByTestId('build-summary')[0];
    expect(within(back).getByTestId('summary-item-gpu')).toBeDefined();
    expect(within(back).getByTestId('summary-price-gpu').textContent).toContain(
      (gpu.salePrice ?? gpu.retailPrice).toLocaleString('en-US', { minimumFractionDigits: 2 }),
    );
  });

  it('keeps a selected part even when the collection no longer lists it', () => {
    // A black GPU stays in the build while the White collection is on. The
    // build is what the shopper chose; the collection is only what they are
    // browsing.
    const blackGpu = catalog.parts.find(
      (part) => part.category === 'gpu' && !/white|snow/i.test(part.name),
    )!;
    const { selection } = renderBuilder({ gpu: blackGpu.id });

    toggleWhite();

    expect(shownIds()).not.toContain(blackGpu.id);
    expect(selection().gpu).toBe(blackGpu.id);
    expect(within(screen.getAllByTestId('build-summary')[0]).getByTestId('summary-item-gpu')).toBeDefined();
  });

  it('leaves the chosen category alone', () => {
    // The collection changes the products, not where the shopper is.
    renderBuilder();
    fireEvent.click(screen.getByTestId('category-rail-psu'));
    expect(screen.getByTestId('category-rail-psu').getAttribute('data-active')).toBe('true');

    toggleWhite();

    expect(screen.getByTestId('category-rail-psu').getAttribute('data-active')).toBe('true');
  });
});
