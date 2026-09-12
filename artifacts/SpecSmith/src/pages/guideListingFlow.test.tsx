// @vitest-environment jsdom
//
// THE GUIDE ROWS USED TO LIE ABOUT WHERE THEY WENT.
//
// Every part row on /prebuilts and /prebuilts/:id carried two links, "Amazon"
// and "Newegg", titled "Buy on Amazon" and "Buy on Newegg". Neither went to a
// product: both went to a SEARCH RESULTS PAGE built from a string assembled
// out of the model name, which may return a different model, a used listing,
// an accessory, or nothing. Beside them sat a bare dollar amount from our own
// editorial JSON, which in that company reads as the price you are about to
// pay. The Amazon links carried an Associates tag for an unapproved account.
//
// One action replaces them, and it goes where those facts actually exist.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import publishedCatalog from '../../public/data/retail-parts.json';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { prebuilts, getPartName } from '../lib/prebuilts';
import { CATEGORY_LABELS } from '../lib/retail/retailShopping';
import { PRICES_UPDATED } from '../lib/prices';
import { guidePlanUrl, isShoppableCategory } from '../lib/retail/guidePlanHandoff';
import Prebuilts from './Prebuilts';
import PrebuiltDetail from './PrebuiltDetail';
import Builder from './Builder';

const published = publishedCatalog as any;
const plan = prebuilts[0];
const shoppable = Object.keys(plan.parts).filter(isShoppableCategory);

function stubCatalog() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('product-images.json')) {
        return { ok: false, json: async () => ({}) } as unknown as Response;
      }
      return { ok: true, json: async () => published } as unknown as Response;
    }) as unknown as typeof fetch,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('scrollTo', vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
  // framer-motion's whileInView needs one, and jsdom has none. Reports every
  // element as visible so nothing under test is hidden by the stub itself.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private cb: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], this as never);
      }
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    } as unknown as typeof IntersectionObserver,
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

/**
 * The real app shell for these three routes.
 *
 * Rendered together rather than mocking `navigate`, so a click genuinely
 * travels from the guide to the Builder and the assertions are about the
 * flow rather than about an argument passed to a spy.
 */
const renderApp = (at: string) =>
  render(
    <MemoryRouter initialEntries={[at]}>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/prebuilts" element={<Prebuilts />} />
            <Route path="/prebuilts/:slug" element={<PrebuiltDetail />} />
            <Route path="/builder" element={<Builder />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );

const GUIDE_ROUTES: ReadonlyArray<[string, string]> = [
  ['the guides hub', '/prebuilts'],
  ['a guide page', `/prebuilts/${plan.id}`],
];

/**
 * The part rows of ONE guide plan.
 *
 * The hub lists every guide, so a bare `getAllByTestId('guide-choose-gpu')`
 * finds one per card. Scoping to a single plan is what makes "exactly one
 * action per row" a real assertion rather than a count of the page.
 */
const planRows = (): HTMLElement =>
  (screen.queryByTestId(`guide-parts-${plan.id}`) as HTMLElement | null) ?? document.body;

describe.each(GUIDE_ROUTES)('%s no longer sends anyone to a search page', (_name, route) => {
  it('has no Amazon control at all', () => {
    renderApp(route);
    expect(screen.queryByText(/^Amazon$/)).toBeNull();
    const links = [...document.querySelectorAll('a')];
    expect(links.filter((a) => /amazon\./i.test(a.getAttribute('href') ?? ''))).toHaveLength(0);
  });

  it('never ships the placeholder Associates tag', () => {
    // The account was never approved. It must not reach a shopper's browser.
    renderApp(route);
    expect(document.body.innerHTML).not.toContain('specsmithpc-20');
    expect(document.body.innerHTML).not.toContain('tag=');
  });

  it('has no retailer search link of any kind', () => {
    renderApp(route);
    const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    // Amazon search is `/s?k=`, Newegg's is `/p/pl?d=`.
    expect(hrefs.filter((h) => h.includes('/s?k=') || h.includes('/p/pl?d='))).toHaveLength(0);
    expect(hrefs.filter((h) => /newegg\.com/i.test(h))).toHaveLength(0);
  });
});

describe.each(GUIDE_ROUTES)('%s labels every editorial amount where it is read', (_name, route) => {
  it('marks each part price Estimated, dated', () => {
    renderApp(route);
    for (const category of Object.keys(plan.parts)) {
      const price = within(planRows()).getByTestId(`guide-price-${category}`);
      expect(price.textContent, category).toMatch(/^Estimated \$/);
      expect(price.textContent, category).toContain(PRICES_UPDATED);
    }
  });

  it('dates the total beside the total, not only in a footnote', () => {
    renderApp(route);
    const label = screen.getAllByTestId('guide-total-label')[0];
    expect(label.textContent).toMatch(/Estimated total/i);
    expect(label.textContent).toContain(PRICES_UPDATED);
  });

  it('leaves no bare amount next to a buying action', () => {
    renderApp(route);
    for (const category of shoppable) {
      const row = within(planRows()).getByTestId(`guide-part-${category}`);
      expect(row.textContent, category).toContain('Estimated');
    }
  });
});

describe.each(GUIDE_ROUTES)('%s offers one action per row, named for its row', (_name, route) => {
  it('shows exactly one action per shoppable category', () => {
    renderApp(route);
    for (const category of shoppable) {
      expect(within(planRows()).getAllByTestId(`guide-choose-${category}`), category).toHaveLength(1);
    }
  });

  it('gives every action a distinct accessible name', () => {
    // Eight buttons reading "Choose current listing" are eight identical
    // announcements; the category and model are what tell them apart.
    renderApp(route);
    const names = shoppable.map(
      (category) => within(planRows()).getByTestId(`guide-choose-${category}`).getAttribute('aria-label') ?? '',
    );
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^Choose current listing for /);
  });

  it('is an anchor to the Builder, not a button that navigates', () => {
    // A control that changes the page must be a link. As a <button> calling
    // navigate(), middle-click and ctrl-click do nothing, "copy link address"
    // is absent, the status bar shows no destination, and a screen reader
    // announces a button that mysteriously moves the shopper elsewhere.
    renderApp(route);
    for (const category of shoppable) {
      const action = within(planRows()).getByTestId(`guide-choose-${category}`);
      expect(action.tagName, category).toBe('A');
      expect(action.getAttribute('href'), category).toBeTruthy();
      // Real href, so the browser can offer it as a destination.
      expect(action.getAttribute('href')!, category).toMatch(/^\/builder\?/);
      expect(action.hasAttribute('disabled'), category).toBe(false);
    }
  });

  it('points each anchor at the whole plan and its own category', () => {
    renderApp(route);
    for (const category of shoppable) {
      const href = within(planRows())
        .getByTestId(`guide-choose-${category}`)
        .getAttribute('href')!;
      expect(href, category).toBe(guidePlanUrl(plan.parts, category));

      const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
      expect(params.get('open'), category).toBe(category);
      // Every planned part is in the URL, not only the clicked one.
      for (const [planned, id] of Object.entries(plan.parts)) {
        expect(params.get(planned), `${category} -> ${planned}`).toBe(id);
      }
    }
  });

  it('names the category and the exact model in each one', () => {
    renderApp(route);
    for (const category of shoppable) {
      const label = within(planRows()).getByTestId(`guide-choose-${category}`).getAttribute('aria-label') ?? '';
      expect(label.toLowerCase(), category).toContain(CATEGORY_LABELS[category].toLowerCase());
      expect(label, category).toContain(getPartName(category, plan.parts[category]));
    }
  });
});

describe.each(GUIDE_ROUTES)('%s: the action really reaches the Builder', (_name, route) => {
  it.each(['gpu', 'psu', 'cooler'] as const)('opens the %s category on arrival', async (category) => {
    if (!shoppable.includes(category)) return;
    stubCatalog();
    renderApp(route);

    fireEvent.click(within(planRows()).getByTestId(`guide-choose-${category}`));
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });

    await waitFor(() =>
      expect(screen.getByTestId(`category-rail-${category}`).getAttribute('data-active')).toBe('true'),
    );
    // And the catalogue heading names it, so it is not only an attribute.
    expect(screen.getByTestId('category-rail-gpu')).toBeTruthy();
  }, 40000);

  it('carries the entire plan, not just the clicked part', async () => {
    stubCatalog();
    renderApp(route);

    fireEvent.click(within(planRows()).getByTestId('guide-choose-psu'));
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });

    // Every planned category arrives as a recommendation the shopper still owns.
    await waitFor(() => expect(screen.getByTestId('view-build').textContent).toMatch(/\(\d+\)/));
    const carried = screen.getByTestId('view-build').textContent ?? '';
    const count = Number(carried.match(/\((\d+)\)/)![1]);
    expect(count).toBe(Object.keys(plan.parts).length);
  }, 40000);

  it('selects no retailer listing on the shopper\'s behalf', async () => {
    // A guide recommends a MODEL. A retailer sells dozens of SKUs of that
    // model at different prices from different sellers. Picking one would
    // invent a purchase decision the shopper never made.
    stubCatalog();
    renderApp(route);

    fireEvent.click(within(planRows()).getByTestId('guide-choose-gpu'));
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });
    await waitFor(() => expect(screen.getByTestId('view-build').textContent).toMatch(/\(\d+\)/));

    // The selected state lives on the card itself, so that is what is counted.
    // A positive control first, so this can never pass because the selector
    // matches nothing: cards are on screen, and none of them is selected.
    expect(document.querySelectorAll('[data-part-id]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-part-id][data-selected="true"]')).toHaveLength(0);

    // And clicking one DOES select it — proof the attribute moves, so the
    // zero above is a fact about the arrival rather than about the selector.
    const card = document.querySelector('[data-part-id]') as HTMLElement;
    fireEvent.click(within(card).getByTestId('add-to-build'));
    await waitFor(() =>
      expect(document.querySelectorAll('[data-part-id][data-selected="true"]').length).toBe(1),
    );

    // The build is described as a plan, not as chosen listings.
    expect(document.body.textContent).toMatch(/Recommended models, not listings/i);
  }, 40000);
});

describe('the guide plan keeps its own prices out of the Builder', () => {
  it('does not present a dated editorial estimate as a retailer price', async () => {
    stubCatalog();
    renderApp(`/prebuilts/${plan.id}`);

    fireEvent.click(within(planRows()).getByTestId('guide-choose-gpu'));
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });
    await waitFor(() => expect(screen.getByTestId('view-build').textContent).toMatch(/\(\d+\)/));

    // The imported plan says so in as many words, and every planned amount
    // arrives prefixed rather than bare.
    expect(document.body.textContent).toMatch(/not live retailer prices/i);
  }, 40000);
});

describe('a category the catalogue does not shop', () => {
  it('gets no listing action rather than a broken one', () => {
    // If a guide ever names a category the shopping catalogue has no aisle
    // for, the row must not offer to open one.
    renderApp('/prebuilts');
    const unshoppable = Object.keys(plan.parts).filter((c) => !isShoppableCategory(c));
    for (const category of unshoppable) {
      expect(within(planRows()).queryByTestId(`guide-choose-${category}`), category).toBeNull();
    }
  });
});

describe.each(GUIDE_ROUTES)('%s: the flow works at both layouts', (_name, route) => {
  // The Builder's category navigation is TWO controls: a left rail on
  // desktop and a scrolling chip row on mobile. Both are in the DOM at once
  // and CSS decides which is seen, so both must land on the right category —
  // a handoff that only drove the rail would leave a phone on graphics cards.
  const widths = [
    ['mobile', 375],
    ['desktop', 1440],
  ] as const;

  it.each(widths)('opens the clicked category on %s', async (_label, width) => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
    vi.stubGlobal('matchMedia', ((query: string) => ({
      // Tailwind's lg/xl breakpoints, answered for the width under test.
      matches: /min-width:\s*(\d+)/.test(query)
        ? width >= Number(query.match(/min-width:\s*(\d+)/)![1])
        : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia);

    stubCatalog();
    renderApp(route);
    fireEvent.click(within(planRows()).getByTestId('guide-choose-cooler'));
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });

    // Both navigation surfaces agree on the category, whichever is painted.
    await waitFor(() =>
      expect(screen.getByTestId('category-rail-cooler').getAttribute('data-active')).toBe('true'),
    );
    expect(screen.getByTestId('category-chip-cooler').getAttribute('data-active')).toBe('true');
    // And the whole plan is still there at either width.
    await waitFor(() =>
      expect(screen.getByTestId('view-build').textContent).toContain(`(${Object.keys(plan.parts).length})`),
    );
  }, 40000);
});

describe('the guides hub keeps every action name distinct across all its plans', () => {
  it('names the build too, because two plans often share a part', () => {
    // Measured on the real page before this was added: forty actions, only
    // thirty-seven distinct names, because different budgets recommend the
    // same power supply or case. A screen-reader user tabbing the hub heard
    // the same announcement twice with no way to tell the builds apart.
    renderApp('/prebuilts');
    const actions = [...document.querySelectorAll('[data-testid^="guide-choose-"]')];
    expect(actions.length).toBeGreaterThan(8);

    const names = actions.map((a) => a.getAttribute('aria-label') ?? '');
    expect(new Set(names).size, 'duplicate accessible names across plans').toBe(names.length);
  });

  it('does not bolt a plan name onto a single guide page, which needs none', () => {
    renderApp(`/prebuilts/${plan.id}`);
    const names = shoppable.map(
      (category) => within(planRows()).getByTestId(`guide-choose-${category}`).getAttribute('aria-label') ?? '',
    );
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).not.toContain(' — ');
  });
});
