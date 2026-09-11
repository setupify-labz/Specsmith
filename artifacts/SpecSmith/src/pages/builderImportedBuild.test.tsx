// @vitest-environment jsdom
//
// A build arriving from elsewhere on the site.
//
// THE DEFECT. Build Guides, the Quiz, Build Crate, shared links and saved
// builds all hand `/builder` CANONICAL model ids, because those are what the
// rest of the site reasons about. The retail builder recognises only exact
// retailer SKU ids. Loading Budget Beast therefore passed eight parts and
// displayed none: "View build (0)", "Core build: 0 of 8 parts selected", zero
// thumbnails. The shopper's whole build vanished on arrival.
//
// Every test here drives the real page through a real entry point, because the
// bug lived in the seam between them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import publishedCatalog from '../../public/data/retail-parts.json';
import prebuilts from '../data/prebuilts.json';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { encodeBuild } from '../lib/sharing';
import { PRICES_UPDATED } from '../lib/prices';
import { EMPTY_FILTERS, filterAndSort } from '../lib/retail/retailShopping';
import Builder from './Builder';

const published = publishedCatalog as any;
const parts = (published.parts ?? published) as any[];
const budget = (prebuilts as any[]).find((p) => p.id === 'budget-beast')!;
const CORE = ['gpu', 'cpu', 'motherboard', 'ram', 'storage', 'psu', 'case', 'cooler'] as const;

/** The first card the default view actually renders — the grid paginates. */
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

const counter = () => screen.getByTestId('core-progress').textContent ?? '';
const summaryCount = () => screen.getByTestId('view-build').textContent ?? '';
// The compact planned-part rows. These were oversized cards until the plan was
// made compact; the assertions below are about BEHAVIOUR and survived that
// change unaltered — only what they point at moved.
const recommendations = () => document.querySelectorAll('[data-testid^="planned-row-"]');

const queryFor = (build: Record<string, string>) =>
  Object.entries(build).map(([k, v]) => `${k}=${v}`).join('&');

describe('a Build Guide prebuilt — Budget Beast', () => {
  it('shows all eight imported parts instead of nothing', async () => {
    await openAt(`/builder?${queryFor(budget.parts)}`);

    await waitFor(() => expect(recommendations()).toHaveLength(8));
    expect(counter()).toContain('8 of 8');
    expect(summaryCount()).toContain('(8)');
  }, 30000);

  it('labels the whole plan once, rather than badging every row', async () => {
    // This asserted a badge inside each of eight cards. The badge is gone on
    // purpose: eight identical labels were part of the 1,413 characters of
    // repeated copy. The property it was protecting — a shopper is told these
    // are recommendations, not listings — is now carried by one notice.
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(recommendations()).toHaveLength(8));

    const notices = document.querySelectorAll('[data-testid="imported-plan-notice"]');
    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect(notices[0].textContent).toMatch(/recommended model/i);
    for (const category of CORE) {
      expect(screen.getByTestId(`planned-row-${category}`)).toBeTruthy();
    }
  }, 30000);

  it('names the canonical model the guide actually recommended', async () => {
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(recommendations()).toHaveLength(8));
    // Not a retailer listing that happens to look similar — the model itself.
    expect(screen.getByTestId('planned-name-gpu').textContent).toMatch(/6600/i);
  }, 30000);
});

describe('an imported estimate is never a retailer price', () => {
  it('says the price is an estimate and not a current listing', async () => {
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(recommendations()).toHaveLength(8));

    // The row keeps the word "Estimated" and the date; the sentence explaining
    // what that means is in the shared notice, said once.
    const price = screen.getByTestId('planned-price-gpu').textContent ?? '';
    expect(price).toMatch(/estimated/i);
    expect(price).toContain(PRICES_UPDATED);
    const notice = document.querySelector('[data-testid="imported-plan-notice"]')?.textContent ?? '';
    expect(notice).toMatch(/not live retailer prices/i);
  }, 30000);

  it('keeps them out of the retailer subtotal entirely', async () => {
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(recommendations()).toHaveLength(8));

    const summary = screen.getAllByTestId('build-summary')[0];
    // Eight recommendations, no retailer listing: there is no retailer money to
    // total, and the summary must not invent one from editorial estimates.
    expect(within(summary).queryByText(/current price subtotal/i)).toBeNull();
    const subtotalRow = within(summary).queryByText(/subtotal/i);
    if (subtotalRow) {
      const row = subtotalRow.closest('div')?.textContent ?? '';
      expect(row).not.toMatch(/\$\s?\d/);
    }
  }, 30000);

  it('offers no retailer link or availability for a recommendation', async () => {
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(recommendations()).toHaveLength(8));

    const item = screen.getByTestId('planned-row-gpu');
    expect(item.querySelectorAll('a[href]')).toHaveLength(0);
    expect(item.querySelectorAll('img')).toHaveLength(0);
    expect(item.textContent).not.toMatch(/in stock|availability/i);
  }, 30000);
});

describe('choosing a current listing', () => {
  it('opens the category the recommendation belongs to', async () => {
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(recommendations()).toHaveLength(8));

    fireEvent.click(screen.getByTestId('choose-listing-psu'));
    await waitFor(() => {
      expect(screen.getByTestId('category-rail-psu').getAttribute('data-active')).toBe('true');
    });
  }, 30000);

  it('replaces that recommendation once a real listing is picked', async () => {
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(recommendations()).toHaveLength(8));

    const gpu = onScreen('gpu');
    const card = document.querySelector(`[data-part-id="${gpu.id}"]`);
    expect(card, 'the GPU card is not on screen').toBeTruthy();
    fireEvent.click(card!.querySelector('[data-testid="add-to-build"]')!);

    // The GPU slot is now an exact SKU; the other seven are untouched.
    await waitFor(() => expect(screen.queryByTestId('planned-row-gpu')).toBeNull());
    expect(recommendations()).toHaveLength(7);
    expect(screen.getByTestId('summary-item-gpu')).toBeTruthy();
    // And the totals still agree — one listing plus seven recommendations.
    expect(counter()).toContain('8 of 8');
    expect(summaryCount()).toContain('(8)');
  }, 30000);
});

describe('nothing is guessed', () => {
  it('chooses no retailer variant on the shopper\'s behalf', async () => {
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(recommendations()).toHaveLength(8));

    // Eight recommendations and NOT ONE selected listing: no card is marked as
    // in the build, because no purchase decision has been made yet.
    expect(document.querySelectorAll('[data-testid^="summary-item-"]')).toHaveLength(0);
    expect(
      document.querySelectorAll('[data-testid="retail-product-card"][data-selected="true"]'),
    ).toHaveLength(0);
  }, 30000);

  it('rejects an id nobody recognises', async () => {
    await openAt('/builder?gpu=not-a-real-part&cpu=also-invented');
    await waitFor(() => expect(counter()).toContain('0 of 8'));
    expect(recommendations()).toHaveLength(0);
    expect(summaryCount()).toContain('(0)');
  }, 30000);

  it('rejects the unknown half and keeps the recognised half', async () => {
    await openAt(`/builder?gpu=${budget.parts.gpu}&cpu=stale-id-from-an-old-link`);
    await waitFor(() => expect(recommendations()).toHaveLength(1));
    expect(counter()).toContain('1 of 8');
    expect(summaryCount()).toContain('(1)');
  }, 30000);
});

describe('every entry point that hands over canonical ids', () => {
  it('the quiz, which passes a GPU and a CPU', async () => {
    await openAt(`/builder?gpu=${budget.parts.gpu}&cpu=${budget.parts.cpu}`);
    await waitFor(() => expect(recommendations()).toHaveLength(2));
    expect(counter()).toContain('2 of 8');
  }, 30000);

  it('a shared build link', async () => {
    const encoded = encodeBuild(budget.parts, 'Budget Beast');
    await openAt(`/builder?b=${encodeURIComponent(encoded)}`);
    await waitFor(() => expect(recommendations()).toHaveLength(8));
    expect(counter()).toContain('8 of 8');
    expect(summaryCount()).toContain('(8)');
  }, 30000);

  it('a saved build in local storage — the gallery and dashboard path', async () => {
    window.localStorage.setItem('specsmith-builder-draft', JSON.stringify(budget.parts));
    await openAt('/builder');
    await waitFor(() => expect(recommendations()).toHaveLength(8));
    expect(counter()).toContain('8 of 8');
  }, 30000);

  it('a build mixing an exact listing with imported models', async () => {
    // Build Crate hands over whatever the shopper has; after one real purchase
    // decision the build is legitimately half listings, half recommendations.
    const mixed = { ...budget.parts, gpu: onScreen('gpu').id };
    await openAt(`/builder?${queryFor(mixed)}`);

    await waitFor(() => expect(recommendations()).toHaveLength(7));
    expect(screen.getByTestId('summary-item-gpu')).toBeTruthy();
    expect(counter()).toContain('8 of 8');
    expect(summaryCount()).toContain('(8)');
  }, 30000);
});

describe('the estimator and the compatibility check stay fail-closed', () => {
  it('does not treat a recommendation as a modelled part', async () => {
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(recommendations()).toHaveLength(8));

    // Whatever the estimate control decides, it must decide it from the
    // canonical mapping as it always did — this change adds no new route by
    // which an unmodelled part could be treated as modelled.
    const estimate = screen.getByTestId('summary-estimate');
    expect(estimate).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/verified retailer price/i);
  }, 30000);
});

describe('on a phone', () => {
  it('closes the build sheet when a listing is chosen', async () => {
    // The summary is a sheet ACROSS the catalogue at phone widths. Switching
    // the category underneath it and leaving it open shows the shopper the
    // same drawer they just tapped in, so the action appears to do nothing.
    await openAt(`/builder?${queryFor(budget.parts)}`);
    await waitFor(() => expect(recommendations()).toHaveLength(8));

    // Open the sheet, as a phone shopper does before they can see the summary.
    fireEvent.click(screen.getByTestId('view-build'));
    await waitFor(() => expect(screen.getByTestId('close-build-summary')).toBeTruthy());

    fireEvent.click(screen.getAllByTestId('choose-listing-psu')[0]);

    await waitFor(() => expect(screen.queryByTestId('close-build-summary')).toBeNull());
    expect(screen.getByTestId('category-rail-psu').getAttribute('data-active')).toBe('true');
  }, 30000);
});

// ---------------------------------------------------------------------------
// Peripherals, and the accessible names on twelve identical-looking buttons.
// ---------------------------------------------------------------------------

const PERIPHERALS = {
  monitor: 'lg-27gp850',
  keyboard: 'logi-gprox',
  mouse: 'logi-g502xplus',
  headset: 'steelseries-arctis-nova-pro',
} as const;

const fullTwelve = { ...budget.parts, ...PERIPHERALS } as Record<string, string>;

describe('peripherals are imported too', () => {
  it('recognises a monitor, keyboard, mouse and headset from a query link', async () => {
    await openAt(`/builder?${queryFor(PERIPHERALS as unknown as Record<string, string>)}`);

    await waitFor(() => expect(recommendations()).toHaveLength(4));
    for (const category of Object.keys(PERIPHERALS)) {
      expect(screen.getByTestId(`planned-row-${category}`)).toBeTruthy();
    }
  }, 30000);

  it('shows all twelve when a build carries the lot', async () => {
    await openAt(`/builder?${queryFor(fullTwelve)}`);
    await waitFor(() => expect(recommendations()).toHaveLength(12));
  }, 30000);

  it('keeps the progress bar on the eight core parts', async () => {
    // The eight-slot rule PR #111 settled is not reopened: a headset does not
    // make the machine more complete.
    await openAt(`/builder?${queryFor(fullTwelve)}`);
    await waitFor(() => expect(recommendations()).toHaveLength(12));

    expect(counter()).toContain('8 of 8');
    const bar = document.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('8');
    expect(bar.getAttribute('aria-valuemax')).toBe('8');
  }, 30000);

  it('counts peripherals in the cart total', async () => {
    // The cart is what the shopper is carrying, which is all twelve.
    await openAt(`/builder?${queryFor(fullTwelve)}`);
    await waitFor(() => expect(recommendations()).toHaveLength(12));

    expect(summaryCount()).toContain('(12)');
  }, 30000);

  it('arrives the same way from a shared link', async () => {
    const encoded = encodeBuild(fullTwelve, 'Everything');
    await openAt(`/builder?b=${encodeURIComponent(encoded)}`);

    await waitFor(() => expect(recommendations()).toHaveLength(12));
    expect(summaryCount()).toContain('(12)');
    expect(counter()).toContain('8 of 8');
  }, 30000);

  it('arrives the same way from a saved build', async () => {
    window.localStorage.setItem('specsmith-builder-draft', JSON.stringify(fullTwelve));
    await openAt('/builder');

    await waitFor(() => expect(recommendations()).toHaveLength(12));
    expect(summaryCount()).toContain('(12)');
    expect(counter()).toContain('8 of 8');
  }, 30000);

  it('is replaced by an exact peripheral SKU, leaving the rest alone', async () => {
    await openAt(`/builder?${queryFor(fullTwelve)}`);
    await waitFor(() => expect(recommendations()).toHaveLength(12));

    // Open the monitor category and pick a real listing.
    fireEvent.click(screen.getAllByTestId('choose-listing-monitor')[0]);
    await waitFor(() => {
      expect(screen.getByTestId('category-rail-monitor').getAttribute('data-active')).toBe('true');
    });
    const listing = onScreen('monitor');
    const card = await waitFor(() => {
      const found = document.querySelector(`[data-part-id="${listing.id}"]`);
      expect(found, 'the monitor card is not on screen').toBeTruthy();
      return found!;
    });
    fireEvent.click(card.querySelector('[data-testid="add-to-build"]')!);

    await waitFor(() => expect(screen.queryByTestId('planned-row-monitor')).toBeNull());
    expect(recommendations()).toHaveLength(11);
    expect(screen.getByTestId('summary-item-monitor')).toBeTruthy();
    // Twelve parts still, and the core progress is untouched by a peripheral.
    expect(summaryCount()).toContain('(12)');
    expect(counter()).toContain('8 of 8');
  }, 30000);
});

describe('the estimate carries its date', () => {
  it('shows when the estimate was last updated, beside the price', async () => {
    // An editorial figure with no date reads as current, which is the one
    // thing it is not. A retailer listing beside it carries a checked-at
    // timestamp; this is the equivalent honesty for a figure that has none.
    await openAt(`/builder?${queryFor(fullTwelve)}`);
    await waitFor(() => expect(recommendations()).toHaveLength(12));

    const price = screen.getByTestId('planned-price-gpu');
    expect(price.textContent).toContain(PRICES_UPDATED);
    expect(price.textContent).toMatch(/estimated/i);
  }, 30000);

  it('carries it on every priced recommendation, not just the first', async () => {
    await openAt(`/builder?${queryFor(fullTwelve)}`);
    await waitFor(() => expect(recommendations()).toHaveLength(12));

    const priced = [...document.querySelectorAll('[data-testid^="planned-price-"]')].filter(
      (node) => /Estimated\s*\$/.test(node.textContent ?? ''),
    );
    expect(priced.length).toBeGreaterThan(1);
    for (const node of priced) {
      expect(node.textContent, node.getAttribute('data-testid') ?? '').toContain(PRICES_UPDATED);
    }
  }, 30000);
});

describe('twelve buttons that look identical', () => {
  it('gives each one an accessible name naming its category', async () => {
    // A shopper on a screen reader moving between them heard "Choose current
    // listing" twelve times with nothing to tell them apart.
    await openAt(`/builder?${queryFor(fullTwelve)}`);
    await waitFor(() => expect(recommendations()).toHaveLength(12));

    const monitor = screen.getAllByTestId('choose-listing-monitor')[0];
    expect(monitor.getAttribute('aria-label')).toBe('Choose listing for Monitor');
    const gpu = screen.getAllByTestId('choose-listing-gpu')[0];
    expect(gpu.getAttribute('aria-label')).toBe('Choose listing for Graphics card');
  }, 30000);

  it('gives no two of them the same accessible name', async () => {
    await openAt(`/builder?${queryFor(fullTwelve)}`);
    await waitFor(() => expect(recommendations()).toHaveLength(12));

    const summary = screen.getAllByTestId('build-summary')[0];
    const names = [...summary.querySelectorAll('[data-testid^="choose-listing-"]')].map((node) =>
      node.getAttribute('aria-label'),
    );
    expect(names).toHaveLength(12);
    expect(names.every((name) => typeof name === 'string' && name.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(12);
  }, 30000);
});
