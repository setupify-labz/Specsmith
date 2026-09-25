// @vitest-environment jsdom
//
// The mobile Builder's "View build" bar and build sheet, at phone width.
//
// Measured in Chromium at 390x844 on the production build before this change:
// - the bar was `sticky bottom-0` inside a wrapper holding nothing but the
//   bar, so it had no room to stick and sat after the last product, about
//   12,000px down. With one part or six, a shopper never saw it while
//   browsing;
// - the analytics choice panel (fixed, bottom, z-100) covered the lower part
//   of the page and of the open sheet, including the sheet's last control;
// - selected names were cut in the string at 44 characters ("Intel Core
//   i3-4160 - Core i3 4th Gen…"), and each remove control was 21x21px.
//
// The layout itself is verified in a real browser. These tests pin the
// structure that makes it work, so a refactor cannot quietly undo it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import catalogData from '../../../public/data/retail-parts.json';
import { parseAffiliatePartCatalog, type RetailPartCategory } from '../../lib/retail/partCatalog';
import { PRICE_FRESHNESS_MS, STALE_PRICE_LABEL, formatAmount } from '../../lib/retail/partPricing';
import RetailBuilder from './RetailBuilder';

const parsed = parseAffiliatePartCatalog(catalogData);
if (!parsed.ok) throw new Error(`fixture catalog invalid: ${parsed.problem}`);
const catalog = parsed.catalog;
/** A moment at which the whole published catalogue is fresh. */
const FRESH_NOW = Math.max(...catalog.parts.map((part) => Date.parse(part.fetchedAt))) + 60_000;
const LONG = catalog.parts.find((p) => p.category === 'cpu' && p.name.length > 80)!;
const GPU = catalog.parts.find((p) => p.category === 'gpu')!;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderBuilder(selection: Partial<Record<RetailPartCategory, string | null>>, now = FRESH_NOW) {
  const onSelect = vi.fn();
  render(<RetailBuilder parts={catalog.parts} selection={selection} onSelect={onSelect} now={now} />);
  return { onSelect };
}

const openSheet = () => {
  fireEvent.click(screen.getByTestId('view-build'));
  return screen.getByTestId('build-sheet');
};

describe('the View build bar is on screen, above any bottom overlay', () => {
  it('is fixed to the viewport, not sticky inside a wrapper it cannot stick in', () => {
    renderBuilder({ gpu: GPU.id });
    const bar = screen.getByTestId('view-build-bar');
    expect(bar.className).toMatch(/\bfixed\b/);
    expect(bar.className).not.toMatch(/\bsticky\b/);
    expect(bar.style.bottom).toBe('var(--ff-bottom-overlay-height, 0px)');
    expect(screen.getByTestId('view-build').textContent).toContain('View build (1)');
  });

  it('reserves room at the end of the page so the last product can scroll clear of it', () => {
    renderBuilder({ gpu: GPU.id });
    const spacer = screen.getByTestId('view-build-bar').parentElement!.firstElementChild as HTMLElement;
    expect(spacer.getAttribute('aria-hidden')).toBe('true');
    expect(spacer.style.height).toBe('calc(76px + var(--ff-bottom-overlay-height, 0px))');
  });

  it('is mobile/tablet only: the desktop column keeps the sticky summary and no bar', () => {
    renderBuilder({ gpu: GPU.id });
    expect(screen.getByTestId('view-build-bar').closest('.xl\\:hidden')).not.toBeNull();
  });
});

describe('the build sheet', () => {
  it('ends above the bottom overlay and never grows under the site header', () => {
    renderBuilder({ gpu: GPU.id });
    const sheet = openSheet();
    expect(sheet.parentElement!.style.bottom).toBe('var(--ff-bottom-overlay-height, 0px)');
    expect(sheet.style.maxHeight).toBe('min(80vh, calc(100dvh - 112px - var(--ff-bottom-overlay-height, 0px)))');
    // Tapping the backdrop still closes it.
    fireEvent.click(screen.getByTestId('close-build-summary'));
    expect(screen.queryByTestId('build-sheet')).toBeNull();
  });

  it('shows the WHOLE merchant title, clamped by CSS to three lines', () => {
    renderBuilder({ cpu: LONG.id });
    const title = within(openSheet()).getByTestId('summary-title-cpu');
    expect(title.textContent).toBe(LONG.name);
    expect(title.className).toContain('line-clamp-3');
    expect(title.getAttribute('title')).toBe(LONG.name);
    expect(title.getAttribute('aria-label')).toBe(LONG.name);
  });

  it('gives each remove control a 40px touch target, and it still removes', () => {
    const { onSelect } = renderBuilder({ cpu: LONG.id, gpu: GPU.id });
    const sheet = openSheet();
    const remove = within(sheet).getByTestId('summary-remove-cpu');
    expect(remove.className).toMatch(/\bh-10\b/);
    expect(remove.className).toMatch(/\bw-10\b/);
    expect(remove.getAttribute('aria-label')).toBe('Remove Processor');
    fireEvent.click(remove);
    expect(onSelect).toHaveBeenCalledWith('cpu', null);
  });

  it('keeps the #160 price wording: a fresh retailer price, or no figure when stale', () => {
    renderBuilder({ gpu: GPU.id });
    const fresh = within(openSheet()).getByTestId('summary-price-gpu');
    const view = GPU.salePrice ?? GPU.retailPrice;
    expect(fresh.textContent).toBe(formatAmount(view, GPU.currency));
    cleanup();

    renderBuilder({ gpu: GPU.id }, Date.parse(GPU.fetchedAt) + PRICE_FRESHNESS_MS + 60 * 60 * 1000);
    const sheet = openSheet();
    expect(within(sheet).queryByTestId('summary-price-gpu')).toBeNull();
    expect(within(sheet).getByTestId('summary-stale-gpu').textContent).toContain(STALE_PRICE_LABEL);
  });
});

describe('the desktop column is unchanged', () => {
  it('still shortens the title in the sidebar and keeps its small remove control', () => {
    renderBuilder({ cpu: LONG.id });
    const column = screen.getAllByTestId('build-summary').find((s) => !s.closest('[data-testid="build-sheet"]'))!;
    const title = within(column).getByTestId('summary-title-cpu');
    expect(title.textContent!.length).toBeLessThanOrEqual(44);
    expect(title.textContent!.endsWith('…')).toBe(true);
    expect(title.className).toBe('text-xs leading-snug');
    expect(within(column).getByTestId('summary-remove-cpu').className).toBe('self-start p-1');
  });
});
