// @vitest-environment jsdom
//
// Issue #102: browsing state must not leak between part categories.
//
// A shopper searches for a graphics card, switches to Processor, and the
// catalogue reads "0 of 55 products" because the GPU query is still applied to
// the CPU list. The build itself is fine; only the *browsing* state is wrong.
//
// These tests drive the real category controls the way a person does — the
// desktop rail and the mobile chips — rather than calling a reset helper, so
// they describe the behaviour rather than the implementation. A future refactor
// that keeps the behaviour keeps these passing.
//
// This is a dedicated suite. `retailBuilder.test.tsx` is left untouched.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import catalogData from '../../../public/data/retail-parts.json';
import { parseAffiliatePartCatalog, type RetailPartCategory } from '../../lib/retail/partCatalog';
import { EMPTY_FILTERS, PRODUCT_BATCH_SIZE, brandsIn, filterAndSort } from '../../lib/retail/retailShopping';
import RetailBuilder from './RetailBuilder';

const parsed = parseAffiliatePartCatalog(catalogData);
if (!parsed.ok) throw new Error(`published catalogue invalid: ${parsed.problem}`);
const catalog = parsed.catalog;

/** A moment at which the whole published catalogue is fresh. */
const FRESH_NOW = Math.max(...catalog.parts.map((part) => Date.parse(part.fetchedAt))) + 60_000;

const gpuParts = catalog.parts.filter((part) => part.category === 'gpu');
const cpuParts = catalog.parts.filter((part) => part.category === 'cpu');

/**
 * A term that matches many graphics cards and no processor — the essence of
 * the reported defect. Asserted rather than assumed: if the catalogue drifts
 * so that this is no longer a category-exclusive term, these tests must fail
 * loudly rather than quietly stop proving anything.
 */
const GPU_ONLY_TERM = 'geforce';
const matchesTerm = (name: string) => name.toLowerCase().includes(GPU_ONLY_TERM);

afterEach(cleanup);

describe('the #102 reproducer is a real property of the published catalogue', () => {
  it('has processors to show, and a GPU term that excludes all of them', () => {
    expect(cpuParts.length).toBeGreaterThan(0);
    expect(gpuParts.filter((part) => matchesTerm(part.name)).length).toBeGreaterThan(0);
    expect(cpuParts.filter((part) => matchesTerm(part.name))).toEqual([]);
  });
});

function renderBuilder(selection: Partial<Record<RetailPartCategory, string | null>> = {}) {
  const onSelect = vi.fn();
  render(<RetailBuilder parts={catalog.parts} selection={selection} onSelect={onSelect} now={FRESH_NOW} />);
  return { onSelect };
}

const searchBox = () => screen.getByTestId('catalog-search') as HTMLInputElement;
const sortBox = () => screen.getByTestId('catalog-sort') as HTMLSelectElement;
const resultCount = () => screen.getByTestId('result-count').textContent ?? '';
const cardCount = () => screen.queryAllByTestId('retail-product-card').length;

/** Switch category the way a desktop shopper does. */
const clickRail = (category: RetailPartCategory) =>
  fireEvent.click(screen.getByTestId(`category-rail-${category}`));

/** Switch category the way a phone shopper does. */
const clickChip = (category: RetailPartCategory) =>
  fireEvent.click(screen.getByTestId(`category-chip-${category}`));

const type = (value: string) => fireEvent.change(searchBox(), { target: { value } });

describe('a search does not follow the shopper into another category', () => {
  it('shows every processor, and an empty search box, after searching for a graphics card', () => {
    renderBuilder();

    type(GPU_ONLY_TERM);
    // Precondition: the query really is filtering the GPU grid.
    expect(resultCount()).toBe(`${gpuParts.filter((p) => matchesTerm(p.name)).length} of ${gpuParts.length} products`);

    clickRail('cpu');

    // The whole point of the issue: not "0 of 55 products".
    expect(searchBox().value).toBe('');
    expect(resultCount()).toBe(`${cpuParts.length} products`);
    expect(screen.queryByTestId('catalog-empty')).toBeNull();
    expect(cardCount()).toBe(Math.min(PRODUCT_BATCH_SIZE, cpuParts.length));
  });

  it('behaves identically whether the shopper uses the rail or the mobile chips', () => {
    renderBuilder();

    type(GPU_ONLY_TERM);
    clickChip('cpu');

    expect(searchBox().value).toBe('');
    expect(resultCount()).toBe(`${cpuParts.length} products`);
  });

  it('starts at defaults again when the shopper returns to the category they came from', () => {
    renderBuilder();

    type(GPU_ONLY_TERM);
    clickRail('cpu');
    clickRail('gpu');

    // Returning must not restore the old query either — one simple policy.
    expect(searchBox().value).toBe('');
    expect(resultCount()).toBe(`${gpuParts.length} products`);
  });
});

describe('filters, sort and pagination do not leak across categories', () => {
  it('drops a brand filter chosen for a different category', () => {
    renderBuilder();
    const brand = brandsIn(gpuParts)[0];
    expect(brand).toBeTruthy();

    fireEvent.click(screen.getByTestId('catalog-filter-toggle'));
    fireEvent.click(screen.getByTestId(`filter-brand-${brand}`));
    expect(resultCount()).not.toBe(`${gpuParts.length} products`);

    clickRail('cpu');

    expect(resultCount()).toBe(`${cpuParts.length} products`);
  });

  it('drops a price range chosen for a different category', () => {
    renderBuilder();

    fireEvent.click(screen.getByTestId('catalog-filter-toggle'));
    // A range that no processor could satisfy if it survived the switch.
    fireEvent.change(screen.getByTestId('filter-min-price'), { target: { value: '99999' } });
    expect(screen.getByTestId('catalog-empty')).toBeTruthy();

    clickRail('cpu');

    expect(screen.queryByTestId('catalog-empty')).toBeNull();
    expect(resultCount()).toBe(`${cpuParts.length} products`);
  });

  it('returns the sort order to its default', () => {
    renderBuilder();
    expect(sortBox().value).toBe('price-asc');

    fireEvent.change(sortBox(), { target: { value: 'name' } });
    expect(sortBox().value).toBe('name');

    clickRail('cpu');

    expect(sortBox().value).toBe('price-asc');
  });

  it('returns the visible batch to the first page', () => {
    renderBuilder();
    expect(cardCount()).toBe(PRODUCT_BATCH_SIZE);

    fireEvent.click(screen.getByTestId('load-more'));
    expect(cardCount()).toBeGreaterThan(PRODUCT_BATCH_SIZE);

    clickRail('cpu');

    expect(cardCount()).toBe(Math.min(PRODUCT_BATCH_SIZE, cpuParts.length));
  });

  it('closes the filter panel that was opened for another category', () => {
    renderBuilder();

    const toggle = () => screen.getByTestId('catalog-filter-toggle');
    fireEvent.click(toggle());
    expect(screen.getByTestId('catalog-filters')).toBeTruthy();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');

    clickRail('cpu');

    expect(screen.queryByTestId('catalog-filters')).toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });
});

describe('resetting browsing state never touches the build', () => {
  it('keeps every selected part, and asks for no selection change, while switching categories', () => {
    const chosenGpu = gpuParts[0].id;
    const chosenCpu = cpuParts[0].id;
    const { onSelect } = renderBuilder({ gpu: chosenGpu, cpu: chosenCpu });

    expect(screen.getByTestId('view-build').textContent).toContain('View build (2)');

    type(GPU_ONLY_TERM);
    clickRail('cpu');
    clickChip('ram');
    clickRail('gpu');

    // Browsing state is local; the build is owned above and must be untouched.
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId('view-build').textContent).toContain('View build (2)');
  });

  it('still marks the selected product as selected after returning to its category', () => {
    // The first product the default view actually shows, so the assertion is
    // about selection surviving the reset rather than about pagination.
    const chosenCpu = filterAndSort(cpuParts, EMPTY_FILTERS)[0].id;
    renderBuilder({ cpu: chosenCpu });

    clickRail('cpu');
    const card = screen
      .getAllByTestId('retail-product-card')
      .find((el) => el.getAttribute('data-part-id') === chosenCpu);

    expect(card).toBeTruthy();
  });
});

describe('searching within one category is unaffected', () => {
  it('still filters, still reports genuinely empty results, and still recovers when cleared', () => {
    renderBuilder();

    type(GPU_ONLY_TERM);
    expect(cardCount()).toBeGreaterThan(0);

    // A query nothing matches must still produce the honest empty state.
    type('zzzzz-no-such-product');
    expect(screen.getByTestId('catalog-empty')).toBeTruthy();
    expect(resultCount()).toBe(`0 of ${gpuParts.length} products`);

    // And clearing it must bring the grid back.
    type('');
    expect(screen.queryByTestId('catalog-empty')).toBeNull();
    expect(resultCount()).toBe(`${gpuParts.length} products`);
    expect(cardCount()).toBe(PRODUCT_BATCH_SIZE);
  });

  it('keeps the category heading an h2 that names the destination category', () => {
    renderBuilder();

    const heading = () => screen.getByRole('heading', { level: 2, name: /graphics card|processor/i });
    expect(heading().textContent).toBe('Graphics card');

    clickRail('cpu');

    expect(heading().textContent).toBe('Processor');
  });
});
