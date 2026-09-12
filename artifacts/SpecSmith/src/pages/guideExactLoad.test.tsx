// @vitest-environment jsdom
//
// PHASE 1 ACCEPTANCE. What a Build Guide hands the Builder.
//
// BEFORE (reproduced on main @ 859aca4, at 375 and 1440 in both themes):
//   counter          "Core build: 8 of 8 parts selected"
//   selected cards   0
//   summary rows     0
//   remove controls  0
//   recommendation cards 8, each with an editorial estimate
//
// The counter claimed a finished build, nothing was actually selected, no
// subtotal came from a retailer, and the shopper had to choose all eight
// listings themselves. These tests hold the replacement to the opposite.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import publishedCatalog from '../../public/data/retail-parts.json';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { parseAffiliatePartCatalog } from '../lib/retail/partCatalog';
import { GUIDE_SLOT_BINDINGS } from '../lib/guides/guideBindings';
import { CATEGORY_LABELS } from '../lib/retail/retailShopping';
import Prebuilts from './Prebuilts';
import PrebuiltDetail from './PrebuiltDetail';
import Builder from './Builder';

const published = publishedCatalog as any;
const parsed = parseAffiliatePartCatalog(publishedCatalog);
if (!parsed.ok) throw new Error('published catalogue invalid');
const byId = new Map(parsed.catalog.parts.map((p) => [p.id, p]));

/** The guide with the most reviewed bindings, so the flow has something to carry. */
const GUIDE = '4k-monster';
const boundHere = GUIDE_SLOT_BINDINGS.filter((b) => b.guideId === GUIDE);

function stubCatalog(body: unknown = published) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).includes('product-images.json')
        ? ({ ok: false, json: async () => ({}) } as unknown as Response)
        : ({ ok: true, json: async () => body } as unknown as Response),
    ) as unknown as typeof fetch,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('scrollTo', vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(t: Element) { this.cb([{ isIntersecting: true, target: t } as IntersectionObserverEntry], this as never); }
    unobserve() {} disconnect() {} takeRecords() { return []; }
  } as unknown as typeof IntersectionObserver);
});
afterEach(() => { vi.unstubAllGlobals(); cleanup(); });

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

const summary = () => screen.getAllByTestId('build-summary')[0];
const counter = () => screen.getByTestId('core-progress').textContent ?? '';

describe('the guide shows exact listings, or says it has none', () => {
  it('shows the bound listing by its real retailer name, not the editorial model', async () => {
    stubCatalog();
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });

    for (const binding of boundHere) {
      const slot = await screen.findByTestId(`guide-slot-${binding.category}`);
      expect(slot.getAttribute('data-slot-status')).toBe('available');
      expect(slot.getAttribute('data-part-id')).toBe(binding.neweggPartId);
      const listing = byId.get(binding.neweggPartId)!;
      expect(within(slot).getByTestId(`guide-name-${binding.category}`).textContent).toBe(listing.name);
    }
  }, 40000);

  it('prices it from the catalogue entry and stamps when that was checked', async () => {
    stubCatalog();
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });

    const binding = boundHere[0];
    const listing = byId.get(binding.neweggPartId)!;
    const shown = screen.getByTestId(`guide-price-${binding.category}`).textContent ?? '';
    const expected = listing.salePrice ?? listing.retailPrice;
    expect(shown).toContain(String(Math.trunc(expected)));
    expect(screen.getByTestId(`guide-checked-${binding.category}`).textContent).toMatch(/checked/i);
  }, 40000);

  it('links directly to that listing, never to a search', async () => {
    stubCatalog();
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });

    const binding = boundHere[0];
    const href = screen.getByTestId(`guide-newegg-${binding.category}`).getAttribute('href') ?? '';
    expect(href).toBe(byId.get(binding.neweggPartId)!.trackedAffiliateUrl);
    expect(href).not.toContain('/p/pl?d=');
    expect(href).not.toContain('/s?k=');
  }, 40000);

  it('says "Current listing unavailable" for an unbound slot and offers the Builder', async () => {
    stubCatalog();
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });

    // The GPU of every guide is unbound: the catalogue carries no 40- or
    // 50-series card these guides were written around.
    const slot = screen.getByTestId('guide-slot-gpu');
    expect(slot.getAttribute('data-slot-status')).not.toBe('available');
    expect(screen.getByTestId('guide-unavailable-gpu').textContent).toMatch(/current listing unavailable/i);
    expect(screen.queryByTestId('guide-price-gpu')).toBeNull();

    const replacement = screen.getByTestId('guide-replacement-gpu');
    expect(replacement.tagName).toBe('A');
    expect(replacement.getAttribute('href')).toMatch(/^\/builder\?/);
    expect(replacement.getAttribute('href')).toContain('open=gpu');
  }, 40000);

  it('shows no Amazon control, no placeholder tag and no retailer search URL', async () => {
    stubCatalog();
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });

    expect(document.body.innerHTML).not.toContain('specsmithpc-20');
    const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.filter((h) => /amazon\./i.test(h))).toHaveLength(0);
    expect(hrefs.filter((h) => h.includes('/s?k=') || h.includes('/p/pl?d='))).toHaveLength(0);
  }, 40000);
});

describe('the guide subtotal adds up only the listings it really has', () => {
  it('counts the available listings and names what is missing', async () => {
    stubCatalog();
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });

    const expected = boundHere.reduce((sum, b) => {
      const p = byId.get(b.neweggPartId)!;
      return sum + (p.salePrice ?? p.retailPrice);
    }, 0);
    expect(screen.getByTestId('guide-subtotal').textContent).toContain(String(Math.trunc(expected)));
    // Never "Current price subtotal" while a slot has no listing.
    expect(screen.getByTestId('guide-subtotal-label').textContent).toMatch(/known-price/i);
    expect(screen.getByTestId('guide-missing-note').textContent).toMatch(/graphics card/i);
  }, 40000);

  it('never puts an editorial estimate into that figure', async () => {
    stubCatalog();
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });
    // The old page printed "Estimated $X · July 16, 2026" per row.
    expect(document.body.textContent).not.toMatch(/Estimated \$/);
  }, 40000);
});

describe('loading the guide makes an ordinary build, not a plan', () => {
  const openBuilderFromGuide = async () => {
    stubCatalog();
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });
    fireEvent.click(screen.getByTestId('guide-load'));
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });
  };

  it('selects the guide listings as real parts', async () => {
    await openBuilderFromGuide();
    await waitFor(() =>
      expect(summary().querySelectorAll('[data-testid^="summary-item-"]').length).toBe(boundHere.length),
    );
    for (const binding of boundHere) {
      expect(within(summary()).getByTestId(`summary-item-${binding.category}`)).toBeTruthy();
    }
  }, 40000);

  it('creates no recommendation cards at all', async () => {
    // The wall this replaces. Not one row, not a smaller version of it.
    await openBuilderFromGuide();
    await waitFor(() => expect(summary().querySelectorAll('[data-testid^="summary-item-"]').length).toBeGreaterThan(0));

    expect(summary().querySelectorAll('[data-testid^="planned-row-"]')).toHaveLength(0);
    expect(screen.queryByTestId('imported-plan-notice')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Recommended models, not listings/i);
    expect(document.body.textContent).not.toMatch(/Choose listing/i);
  }, 40000);

  it('counts them, and the counter agrees with the summary', async () => {
    await openBuilderFromGuide();
    await waitFor(() => expect(counter()).toContain(`${boundHere.length} of 8`));
    expect(screen.getByTestId('view-build').textContent).toContain(`(${boundHere.length})`);
  }, 40000);

  it('leaves the unavailable categories empty rather than filling them', async () => {
    await openBuilderFromGuide();
    await waitFor(() => expect(counter()).toContain(`${boundHere.length} of 8`));
    // Nothing invented for the GPU: no card selected, no tick.
    expect(screen.getByTestId('category-rail-gpu').querySelector('svg.lucide-check')).toBeNull();
  }, 40000);

  it('gives every loaded part a working remove control', async () => {
    await openBuilderFromGuide();
    await waitFor(() => expect(summary().querySelectorAll('[data-testid^="summary-item-"]').length).toBe(boundHere.length));

    const before = boundHere.length;
    const row = within(summary()).getByTestId(`summary-item-${boundHere[0].category}`);
    const remove = within(row).getByRole('button');
    fireEvent.click(remove);

    await waitFor(() => expect(counter()).toContain(`${before - 1} of 8`));
    expect(summary().querySelectorAll('[data-testid^="summary-item-"]').length).toBe(before - 1);
  }, 40000);

  it('recalculates the subtotal when one is removed', async () => {
    await openBuilderFromGuide();
    await waitFor(() => expect(summary().querySelectorAll('[data-testid^="summary-item-"]').length).toBe(boundHere.length));

    const readSubtotal = () => {
      const el = within(summary()).queryByTestId('summary-subtotal');
      return el?.textContent ?? summary().textContent ?? '';
    };
    const before = readSubtotal();
    const row = within(summary()).getByTestId(`summary-item-${boundHere[0].category}`);
    fireEvent.click(within(row).getByRole('button'));
    await waitFor(() => expect(readSubtotal()).not.toBe(before));
  }, 40000);

  it('shows the same price and timestamp the guide showed', async () => {
    await openBuilderFromGuide();
    await waitFor(() => expect(summary().querySelectorAll('[data-testid^="summary-item-"]').length).toBe(boundHere.length));

    const binding = boundHere[0];
    const listing = byId.get(binding.neweggPartId)!;
    const row = within(summary()).getByTestId(`summary-item-${binding.category}`);
    const expected = listing.salePrice ?? listing.retailPrice;
    expect(row.textContent ?? '').toContain(String(Math.trunc(expected)));
  }, 40000);
});

describe('a refreshed catalogue cannot silently change the product', () => {
  it('turns the slot unavailable rather than binding a different SKU', async () => {
    // The exact condition: the bound listing drops out of the refresh.
    const binding = boundHere[0];
    // A REFRESH THE WAY ONE ACTUALLY HAPPENS: the merchant rotates the offer,
    // so the bound id is gone and a different listing stands in its place.
    // Deleting the row outright is not a usable simulation — the catalogue
    // schema fixes the part count, so a 499-part file is rejected wholesale
    // and the page correctly reports "cannot check" rather than "delisted".
    const without = {
      ...published,
      parts: (published.parts as any[]).map((p) =>
        p.id === binding.neweggPartId ? { ...p, id: `${p.id}-rotated` } : p,
      ),
    };
    stubCatalog(without);
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });

    // Wait for the catalogue to ARRIVE before asserting about it: an
    // unchecked slot is the pending state, not the answer under test.
    await waitFor(() =>
      expect(
        screen.getByTestId(`guide-slot-${binding.category}`).getAttribute('data-slot-status'),
      ).toBe('delisted'),
    );
    const slot = screen.getByTestId(`guide-slot-${binding.category}`);
    expect(slot.getAttribute('data-part-id')).toBeNull();
    expect(screen.getByTestId(`guide-unavailable-${binding.category}`)).toBeTruthy();
    // And no other listing of that category took its place.
    expect(screen.queryByTestId(`guide-name-${binding.category}`)).toBeNull();
  }, 40000);
});

describe('loading asks before it overwrites', () => {
  it('asks when a build is already in progress, and cancelling keeps it', async () => {
    const existing = { gpu: 'some-existing-choice' };
    window.localStorage.setItem('specsmith-builder-draft', JSON.stringify(existing));
    stubCatalog();
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });

    fireEvent.click(screen.getByTestId('guide-load'));
    const dialog = await screen.findByTestId('guide-load-confirm');
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    // Still on the guide: nothing navigated, nothing was written.
    expect(screen.queryByTestId('retail-builder')).toBeNull();

    fireEvent.click(screen.getByTestId('guide-load-confirm-no'));
    await waitFor(() => expect(screen.queryByTestId('guide-load-confirm')).toBeNull());
    expect(window.localStorage.getItem('specsmith-builder-draft')).toBe(JSON.stringify(existing));
    expect(screen.queryByTestId('retail-builder')).toBeNull();
  }, 40000);

  it('does not ask when there is nothing to lose', async () => {
    stubCatalog();
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });

    fireEvent.click(screen.getByTestId('guide-load'));
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });
    expect(screen.queryByTestId('guide-load-confirm')).toBeNull();
  }, 40000);
});

describe('compatibility and FPS stay fail-closed', () => {
  it('does not claim checks passed for unverified listings', async () => {
    stubCatalog();
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });
    fireEvent.click(screen.getByTestId('guide-load'));
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });

    await waitFor(() => expect(counter()).toContain(`${boundHere.length} of 8`));
    // The bound listings publish specsVerified: false, so nothing may be
    // declared compatible and the estimator must stay shut.
    expect(document.body.textContent).toMatch(/not checked|cannot be checked|unsupported|unverified/i);
    const estimate = within(summary()).getByTestId('summary-estimate');
    expect((within(estimate).getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  }, 40000);
});

describe('a guide slug that does not exist', () => {
  it('renders the not-found page instead of crashing', async () => {
    // THE HOOKS BUG, AS A TEST. The slot resolution hooks were added below
    // this page's not-found return, so the component rendered a different
    // number of hooks depending on whether the slug matched. Every real slug
    // matched, so every test passed — and the production build threw React
    // error #300 and painted nothing. Found by loading a guide in a browser.
    stubCatalog();
    renderApp('/prebuilts/no-such-guide');
    expect(await screen.findByText(/not found/i, {}, { timeout: 10000 })).toBeTruthy();
    expect(screen.queryByTestId('guide-components')).toBeNull();
  }, 40000);

  it('still renders a real guide after one that does not exist', async () => {
    // The order that actually breaks a hooks mismatch.
    stubCatalog();
    const view = renderApp('/prebuilts/no-such-guide');
    await screen.findByText(/not found/i, {}, { timeout: 10000 });
    view.unmount();

    renderApp(`/prebuilts/${GUIDE}`);
    expect(await screen.findByTestId('guide-components', {}, { timeout: 10000 })).toBeTruthy();
  }, 40000);
});

describe('a merchant image that will not load', () => {
  it('falls back to a placeholder instead of dumping the alt text', async () => {
    stubCatalog();
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });

    const category = boundHere[0].category;
    const img = screen.getByTestId(`guide-image-${category}`);
    fireEvent.error(img);

    await waitFor(() => expect(screen.getByTestId(`guide-image-fallback-${category}`)).toBeTruthy());
    expect(screen.queryByTestId(`guide-image-${category}`)).toBeNull();
    // The listing is still identified; only the picture is gone.
    expect(screen.getByTestId(`guide-name-${category}`).textContent).toBeTruthy();
  }, 40000);
});

describe('the catalogue not answering is not a claim about a product', () => {
  // REVIEW BLOCKER. A pending or failed fetch used to collapse into an empty
  // catalogue, so every bound slot resolved as delisted and the guide told the
  // shopper its products were unavailable — inferred from our own network
  // rather than from anything about the products.
  const neverAnswers = () =>
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch);

  const failsWith503 = () =>
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('product-images.json')
        ? ({ ok: false, json: async () => ({}) } as unknown as Response)
        : ({ ok: false, status: 503, json: async () => { throw new Error('no body'); } } as unknown as Response),
    ) as unknown as typeof fetch);

  it.each([['still loading', neverAnswers], ['a failed download', failsWith503]])(
    'never says the listing is gone during %s',
    async (_label, stub) => {
      stub();
      renderApp(`/prebuilts/${GUIDE}`);
      await screen.findByTestId('guide-components', {}, { timeout: 10000 });

      const category = boundHere[0].category;
      await waitFor(() =>
        expect(screen.getByTestId(`guide-slot-${category}`).getAttribute('data-slot-status')).toBe('unchecked'),
      );
      expect(screen.queryByTestId(`guide-unavailable-${category}`)).toBeNull();
    },
    40000,
  );

  it('says it is CHECKING only while an answer is still coming', async () => {
    neverAnswers();
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });

    const category = boundHere[0].category;
    await waitFor(() =>
      expect(screen.getByTestId(`guide-slot-${category}`).getAttribute('data-unchecked-reason')).toBe('loading'),
    );
    expect(screen.getByTestId(`guide-unchecked-${category}`).textContent).toMatch(/checking/i);
    // Nothing has failed, so nothing offers a retry.
    expect(screen.queryByTestId('guide-listings-unavailable')).toBeNull();
  }, 40000);

  it('stops saying "checking" once the request has failed', async () => {
    // REVIEW BLOCKER. A spinner for an answer that is not coming, with no way
    // to ask again, is the worst of both states.
    failsWith503();
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });

    const category = boundHere[0].category;
    await waitFor(() =>
      expect(screen.getByTestId(`guide-slot-${category}`).getAttribute('data-unchecked-reason')).toBe('failed'),
    );
    expect(screen.getByTestId(`guide-unchecked-${category}`).textContent).not.toMatch(/checking/i);
    expect(screen.getByTestId(`guide-unchecked-${category}`).textContent)
      .toMatch(/unable to check current listings/i);
  }, 40000);

  it('offers a real retry that actually re-requests the catalogue', async () => {
    failsWith503();
    renderApp(`/prebuilts/${GUIDE}`);
    const notice = await screen.findByTestId('guide-listings-unavailable', {}, { timeout: 10000 });
    expect(notice.textContent).toMatch(/unable to check current listings/i);

    const before = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter(([url]) => typeof url === 'string' && url.includes('retail-parts.json')).length;

    fireEvent.click(screen.getByTestId('guide-listings-retry'));

    await waitFor(() => {
      const after = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .filter(([url]) => typeof url === 'string' && url.includes('retail-parts.json')).length;
      expect(after).toBeGreaterThan(before);
    });
  }, 40000);

  it('recovers when the retry succeeds', async () => {
    // The retry has to be able to end the failed state, or it is decoration.
    let attempt = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('product-images.json')) {
        return { ok: false, json: async () => ({}) } as unknown as Response;
      }
      attempt += 1;
      if (attempt === 1) {
        return { ok: false, status: 503, json: async () => { throw new Error('no body'); } } as unknown as Response;
      }
      return { ok: true, json: async () => published } as unknown as Response;
    }) as unknown as typeof fetch);

    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-listings-unavailable', {}, { timeout: 10000 });
    fireEvent.click(screen.getByTestId('guide-listings-retry'));

    const category = boundHere[0].category;
    await waitFor(() =>
      expect(screen.getByTestId(`guide-slot-${category}`).getAttribute('data-slot-status')).toBe('available'),
    );
    expect(screen.queryByTestId('guide-listings-unavailable')).toBeNull();
  }, 40000);

  it('does not name an unchecked category as missing in the subtotal note', async () => {
    neverAnswers();
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });

    const note = screen.queryByTestId('guide-missing-note');
    if (note) {
      // Whole labels, not substrings — "cpu" lives inside "cpu cooler", and a
      // substring check would fail on a note that is perfectly correct.
      const listed = (note.textContent ?? '')
        .toLowerCase()
        .replace(/^[^:]*?listing for /, '')
        .split(/,| and /)
        .map((part) => part.replace(/\..*$/, '').trim())
        .filter(Boolean);
      for (const binding of boundHere) {
        const label = CATEGORY_LABELS[binding.category].toLowerCase();
        expect(listed, `${label} is unchecked, not missing`).not.toContain(label);
      }
    }
  }, 40000);

  it('offers nothing to load while it cannot see the catalogue', async () => {
    neverAnswers();
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });
    expect((screen.getByTestId('guide-load') as HTMLButtonElement).disabled).toBe(true);
  }, 40000);
});

describe('a slot whose replacement would overwrite a build', () => {
  // REVIEW BLOCKER. "Choose replacement in Builder" loads this guide, which
  // replaces whatever the shopper already has. It navigated straight there.
  it('asks first, and cancelling keeps the existing build', async () => {
    const existing = { gpu: 'a-build-the-shopper-made' };
    window.localStorage.setItem('specsmith-builder-draft', JSON.stringify(existing));
    stubCatalog();
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });

    fireEvent.click(screen.getByTestId('guide-replacement-gpu'));

    const dialog = await screen.findByTestId('guide-load-confirm');
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(screen.queryByTestId('retail-builder')).toBeNull();

    fireEvent.click(screen.getByTestId('guide-load-confirm-no'));
    await waitFor(() => expect(screen.queryByTestId('guide-load-confirm')).toBeNull());
    expect(window.localStorage.getItem('specsmith-builder-draft')).toBe(JSON.stringify(existing));
    expect(screen.queryByTestId('retail-builder')).toBeNull();
  }, 40000);

  it('goes to that category once confirmed', async () => {
    window.localStorage.setItem('specsmith-builder-draft', JSON.stringify({ gpu: 'anything' }));
    stubCatalog();
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });

    fireEvent.click(screen.getByTestId('guide-replacement-gpu'));
    await screen.findByTestId('guide-load-confirm');
    fireEvent.click(screen.getByTestId('guide-load-confirm-yes'));

    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });
    await waitFor(() =>
      expect(screen.getByTestId('category-rail-gpu').getAttribute('data-active')).toBe('true'),
    );
  }, 40000);

  it('navigates directly when there is no build to lose', async () => {
    stubCatalog();
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });

    fireEvent.click(screen.getByTestId('guide-replacement-gpu'));
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });
    expect(screen.queryByTestId('guide-load-confirm')).toBeNull();
  }, 40000);

  it('is still a real link, so it can be opened in a tab', async () => {
    stubCatalog();
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });

    const link = screen.getByTestId('guide-replacement-gpu');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toContain('open=gpu');
  }, 40000);
});

describe('the guides hub fetches the catalogue once', () => {
  // REVIEW BLOCKER. Each card called the catalogue hook itself, so a hub
  // listing five guides started five identical downloads of the same
  // 500-part file and kept five copies of it in memory.
  it('does not download it once per guide card', async () => {
    stubCatalog();
    renderApp('/prebuilts');
    await screen.findAllByTestId(/^guide-parts-/, {}, { timeout: 10000 });
    await waitFor(() =>
      expect(document.querySelectorAll('[data-slot-status="available"]').length).toBeGreaterThan(0),
    );

    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const catalogueCalls = calls.filter(
      ([url]) => typeof url === 'string' && url.includes('retail-parts.json'),
    );
    const cards = document.querySelectorAll('[data-testid^="guide-parts-"]').length;
    expect(cards).toBeGreaterThan(1);
    expect(catalogueCalls.length).toBe(1);
  }, 40000);
});

describe('a catalogue the loader rejects', () => {
  it('reports that it could not check, not that the product is gone', async () => {
    // The schema fixes the part count, so a short file is invalid in full.
    // That is a fact about our download, not about any product.
    const short = { ...published, parts: (published.parts as any[]).slice(0, 10) };
    stubCatalog(short);
    renderApp(`/prebuilts/${GUIDE}`);
    await screen.findByTestId('guide-components', {}, { timeout: 10000 });

    const category = boundHere[0].category;
    await waitFor(() =>
      expect(screen.getByTestId(`guide-slot-${category}`).getAttribute('data-slot-status')).toBe('unchecked'),
    );
    expect(screen.queryByTestId(`guide-unavailable-${category}`)).toBeNull();
  }, 40000);
});

describe('the hub no longer carries an editorial price disclaimer', () => {
  it('does not warn about estimated prices it no longer shows', async () => {
    stubCatalog();
    renderApp('/prebuilts');
    await screen.findAllByTestId(/^guide-parts-/, {}, { timeout: 10000 });

    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/prices are estimates/i);
    expect(text).not.toMatch(/typical US street pricing/i);
    expect(text).not.toMatch(/Estimated \$/);
  }, 40000);

  it('describes where its prices actually come from', async () => {
    stubCatalog();
    renderApp('/prebuilts');
    await screen.findAllByTestId(/^guide-parts-/, {}, { timeout: 10000 });
    expect(document.body.textContent).toMatch(/current Newegg listing/i);
  }, 40000);

  it('offers the same retry on the hub when the catalogue fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('product-images.json')
        ? ({ ok: false, json: async () => ({}) } as unknown as Response)
        : ({ ok: false, status: 503, json: async () => { throw new Error('no body'); } } as unknown as Response),
    ) as unknown as typeof fetch);

    renderApp('/prebuilts');
    const notice = await screen.findByTestId('guide-listings-unavailable', {}, { timeout: 10000 });
    expect(notice.textContent).toMatch(/unable to check current listings/i);
    expect(screen.getByTestId('guide-listings-retry')).toBeTruthy();
  }, 40000);
});
