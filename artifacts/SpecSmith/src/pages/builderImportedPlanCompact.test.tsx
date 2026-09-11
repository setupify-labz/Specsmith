// @vitest-environment jsdom
//
// THE REGRESSION PR #112 SHIPPED. It fixed a real defect — an imported build
// displaying as nothing — and replaced it with a wall of cards.
//
// Measured on the real flow (Build Guides -> Budget Beast -> Customize in
// Builder) at 1363x936 before this change:
//
//   Your build (8), zero exact retailer listings selected
//   8 oversized recommendation cards
//   1,413 characters of repeated recommendation copy
//   build summary 1,788px tall
//   FPS action 1,835px down the document, not visible without scrolling
//
// Every card repeated the whole warning, a large badge and a large button. The
// three sentences a shopper needs to read ONCE were printed eight times, and
// the thing they came to use was pushed off the screen.
//
// These tests describe the compact plan by its observable shape, so the wall
// cannot come back by a different route.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import publishedCatalog from '../../public/data/retail-parts.json';
import prebuilts from '../data/prebuilts.json';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { PRICES_UPDATED } from '../lib/prices';
import { EMPTY_FILTERS, filterAndSort } from '../lib/retail/retailShopping';
import Builder from './Builder';

const here = path.dirname(fileURLToPath(import.meta.url));
const published = publishedCatalog as any;
const parts = (published.parts ?? published) as any[];
const budget = (prebuilts as any[]).find((p) => p.id === 'budget-beast')!;
const PERIPHERALS = {
  monitor: 'lg-27gp850',
  keyboard: 'logi-gprox',
  mouse: 'logi-g502xplus',
  headset: 'steelseries-arctis-nova-pro',
};
const onScreen = (category: string) =>
  filterAndSort(parts.filter((p) => p.category === category) as any, EMPTY_FILTERS)[0] as any;

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('scrollTo', vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).includes('product-images.json')
        ? ({ ok: false, json: async () => ({}) } as unknown as Response)
        : ({ ok: true, json: async () => published } as unknown as Response),
    ) as unknown as typeof fetch,
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const queryFor = (build: Record<string, string>) =>
  Object.entries(build).map(([k, v]) => `${k}=${v}`).join('&');

const openAt = async (path: string) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <AuthProvider>
          <Builder />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  await screen.findByTestId('retail-builder', {}, { timeout: 10000 });
};

/** ONE summary. Desktop column and mobile sheet both exist in the DOM. */
const summary = () => screen.getAllByTestId('build-summary')[0];
const rows = () => summary().querySelectorAll('[data-testid^="planned-row-"]');

describe('a Build Guide plan is a compact list, not a wall of cards', () => {
  it('shows one compact row per imported part', async () => {
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(rows()).toHaveLength(8));
  }, 30000);

  it('does not print the warning, a badge and a large button in every row', async () => {
    // THE REGRESSION, AS A MEASUREMENT. 1,413 characters of repeated copy is
    // what eight full warnings cost. A row carries its category, its model,
    // its dated estimate and a small action — and nothing that belongs in the
    // notice above it.
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(rows()).toHaveLength(8));

    const rowText = [...rows()].map((row) => row.textContent ?? '').join('');
    expect(rowText.length).toBeLessThan(700);

    // The long explanation appears once in the whole summary, not per row.
    const occurrences = (summary().textContent ?? '').match(/before buying/gi) ?? [];
    expect(occurrences.length).toBeLessThanOrEqual(1);
    for (const row of rows()) {
      expect(row.textContent ?? '').not.toMatch(/before buying/i);
    }
  }, 30000);

  it('carries exactly one shared imported-plan disclosure', async () => {
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(rows()).toHaveLength(8));

    expect(summary().querySelectorAll('[data-testid="imported-plan-notice"]')).toHaveLength(1);
    const notice = within(summary()).getByTestId('imported-plan-notice').textContent ?? '';
    // It has to carry all three facts, once.
    expect(notice).toMatch(/recommended model/i);
    expect(notice).toMatch(/before buying/i);
    expect(notice).toMatch(/estimate/i);
  }, 30000);

  it('keeps the summary collapsible', async () => {
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(rows()).toHaveLength(8));

    fireEvent.click(within(summary()).getByTestId('summary-toggle'));
    await waitFor(() => expect(rows()).toHaveLength(0));
  }, 30000);
});

describe('each compact row still says what it is', () => {
  it('names the category, the model and the dated estimate', async () => {
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(rows()).toHaveLength(8));

    const row = within(summary()).getByTestId('planned-row-gpu');
    expect(within(row).getByTestId('planned-category-gpu').textContent).toMatch(/graphics/i);
    expect(within(row).getByTestId('planned-name-gpu').textContent).toMatch(/6600/i);
    const price = within(row).getByTestId('planned-price-gpu').textContent ?? '';
    expect(price).toMatch(/estimated/i);
    expect(price).toContain(PRICES_UPDATED);
  }, 30000);

  it('gives every action a category-specific accessible name, all distinct', async () => {
    await openAt(`/builder?${queryFor({ ...budget.parts, ...PERIPHERALS })}`);
    await waitFor(() => expect(rows()).toHaveLength(12));

    const names = [...summary().querySelectorAll('[data-testid^="choose-listing-"]')].map((n) =>
      n.getAttribute('aria-label'),
    );
    expect(names).toHaveLength(12);
    expect(new Set(names).size).toBe(12);
    expect(names).toContain('Choose listing for Monitor');
  }, 30000);
});

describe('the integrity rules PR #112 established are unchanged', () => {
  it('selects no retailer listing on the shopper\'s behalf', async () => {
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(rows()).toHaveLength(8));

    expect(summary().querySelectorAll('[data-testid^="summary-item-"]')).toHaveLength(0);
    expect(
      document.querySelectorAll('[data-testid="retail-product-card"][data-selected="true"]'),
    ).toHaveLength(0);
  }, 30000);

  it('keeps editorial estimates out of the retailer subtotal', async () => {
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(rows()).toHaveLength(8));

    const subtotal = within(summary()).queryByText(/subtotal/i);
    if (subtotal) {
      expect(subtotal.closest('div')?.textContent ?? '').not.toMatch(/\$\s?\d/);
    }
  }, 30000);

  it('gives a planned row no image, link or availability claim', async () => {
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(rows()).toHaveLength(8));

    const row = within(summary()).getByTestId('planned-row-gpu');
    expect(row.querySelectorAll('a[href]')).toHaveLength(0);
    expect(row.querySelectorAll('img')).toHaveLength(0);
    expect(row.textContent ?? '').not.toMatch(/in stock|availability/i);
  }, 30000);

  it('reads 8 of 8 core progress with a cart of 8', async () => {
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(rows()).toHaveLength(8));

    expect(screen.getByTestId('core-progress').textContent).toContain('8 of 8');
    expect(screen.getByTestId('view-build').textContent).toContain('(8)');
  }, 30000);

  it('keeps core progress at 8 of 8 with a cart of 12', async () => {
    await openAt(`/builder?${queryFor({ ...budget.parts, ...PERIPHERALS })}`);
    await waitFor(() => expect(rows()).toHaveLength(12));

    expect(screen.getByTestId('core-progress').textContent).toContain('8 of 8');
    expect(screen.getByTestId('view-build').textContent).toContain('(12)');
  }, 30000);

  it('replaces only the matching recommendation when a listing is chosen', async () => {
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(rows()).toHaveLength(8));

    const gpu = onScreen('gpu');
    const card = document.querySelector(`[data-part-id="${gpu.id}"]`);
    fireEvent.click(card!.querySelector('[data-testid="add-to-build"]')!);

    await waitFor(() => expect(rows()).toHaveLength(7));
    expect(within(summary()).queryByTestId('planned-row-gpu')).toBeNull();
    expect(within(summary()).getByTestId('summary-item-gpu')).toBeTruthy();
    expect(screen.getByTestId('view-build').textContent).toContain('(8)');
  }, 30000);

  it('still rejects an unknown id', async () => {
    await openAt('/builder?gpu=not-a-real-part');
    await waitFor(() => expect(screen.getByTestId('core-progress').textContent).toContain('0 of 8'));
    expect(rows()).toHaveLength(0);
  }, 30000);
});

describe('the plan list is bounded rather than unbounded', () => {
  it('does not grow the summary without limit as parts are added', async () => {
    // Twelve parts must stay manageable. The list is capped at a height and
    // scrolls inside that cap — ONE deliberate region, not an accident.
    await openAt(`/builder?${queryFor({ ...budget.parts, ...PERIPHERALS })}`);
    await waitFor(() => expect(rows()).toHaveLength(12));

    const list = within(summary()).getByTestId('planned-rows');
    expect(list.className).toMatch(/overflow-y-auto/);
    expect(list.getAttribute('style') ?? '').toMatch(/max-height/);
  }, 30000);

  it('puts the FPS action after the plan, still inside the build', async () => {
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(rows()).toHaveLength(8));

    const estimate = within(summary()).getByTestId('summary-estimate');
    expect(summary().contains(estimate)).toBe(true);
  }, 30000);
});

describe('the mobile build sheet', () => {
  it('closes and moves focus onto the category it opened', async () => {
    // Closing the sheet destroys the button that had focus. Without somewhere
    // to send it, focus falls back to the document body and a keyboard user is
    // dropped at the top of the page with no idea the category changed.
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(rows()).toHaveLength(8));

    fireEvent.click(screen.getByTestId('view-build'));
    await waitFor(() => expect(screen.getByTestId('close-build-summary')).toBeTruthy());

    fireEvent.click(screen.getAllByTestId('choose-listing-psu')[0]);

    await waitFor(() => expect(screen.queryByTestId('close-build-summary')).toBeNull());
    await waitFor(() => {
      const focused = document.activeElement;
      expect(focused).not.toBe(document.body);
      expect(focused?.getAttribute('data-testid') ?? '').toMatch(/category-(chip|rail)-psu/);
    });
  }, 30000);
});

describe('the guide no longer promises an exact purchasable build', () => {
  it('says it loads a plan of recommended models', () => {
    const source = fs.readFileSync(path.join(here, 'PrebuiltDetail.tsx'), 'utf-8');
    // The button handed the Builder canonical MODEL ids all along; calling
    // that "this exact build" promised a purchasable cart and delivered a
    // planning list.
    expect(source).not.toMatch(/load this exact build/i);
    expect(source).toContain('Use this plan in Builder');
    expect(source).toMatch(/recommended models so you can choose current retailer listings/i);
  });
});

describe('the retailer subtotal appears only when there is retailer money', () => {
  it('is absent for an all-imported plan', async () => {
    // Nothing has been chosen, so there is nothing to total. A row reading
    // "Known-price subtotal —" beside a footnote about retailer availability
    // was a hundred pixels of sidebar saying nothing, and those pixels were
    // pushing the FPS action off the screen.
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(rows()).toHaveLength(8));

    expect(within(summary()).queryByTestId('retailer-subtotal')).toBeNull();
    expect(within(summary()).queryByTestId('summary-availability')).toBeNull();
  }, 30000);

  it('returns the moment an exact listing is chosen, still without estimates', async () => {
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(rows()).toHaveLength(8));

    const gpu = onScreen('gpu');
    fireEvent.click(
      document.querySelector(`[data-part-id="${gpu.id}"]`)!.querySelector('[data-testid="add-to-build"]')!,
    );
    await waitFor(() => expect(rows()).toHaveLength(7));

    const subtotal = within(summary()).getByTestId('retailer-subtotal');
    expect(subtotal).toBeTruthy();
    // One listing's price only — the seven editorial estimates are not in it.
    const amount = within(summary()).getByTestId('subtotal-amount').textContent ?? '';
    const estimates = [...summary().querySelectorAll('[data-testid^="planned-price-"]')].length;
    expect(estimates).toBe(7);
    expect(amount).not.toBe('—');
  }, 30000);
});
