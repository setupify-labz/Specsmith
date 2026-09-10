// @vitest-environment jsdom
//
// Issue #104: the legacy builder must never be what a shopper sees while the
// retailer catalogue is merely loading.
//
// THE DEFECT. `useAffiliatePartCatalog` started at `absent` — the same value a
// confirmed failure resolves to — and the page rendered the canonical fallback
// for every state that was not `ok`. The catalogue is fetched in the browser,
// so an ordinary visit painted the legacy interface first, every time, and
// then replaced the whole region. These tests drive the three states through
// the real page with a fetch whose timing is controlled, because the bug lived
// precisely in the gap between "asked" and "answered".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import publishedCatalog from '../../public/data/retail-parts.json';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import Builder from './Builder';

const published = publishedCatalog as any;
const parts = (published.parts ?? published) as any[];
const gpu = parts.find((p) => p.category === 'gpu')!;

/** A promise whose resolution this test decides — the loading state, held open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type CatalogAnswer = { ok: boolean; body: unknown };

/**
 * Stubs both fetches the page makes, holding the CATALOGUE one open until the
 * test says otherwise. The image manifest answers immediately and empty: it is
 * not what is under test, and leaving it pending would confuse one loading
 * state for another.
 */
function stubCatalogFetch() {
  const gate = deferred<CatalogAnswer>();
  let answers: Array<Promise<CatalogAnswer>> = [gate.promise];
  let call = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('product-images.json')) {
        return { ok: false, json: async () => ({}) } as unknown as Response;
      }
      const answer = await (answers[call] ?? answers[answers.length - 1]);
      call += 1;
      return { ok: answer.ok, json: async () => answer.body } as unknown as Response;
    }) as unknown as typeof fetch,
  );
  return {
    succeed: () => gate.resolve({ ok: true, body: published }),
    fail: () => gate.resolve({ ok: false, body: {} }),
    sendGarbage: () => gate.resolve({ ok: true, body: { parts: 'not an array' } }),
    /** What the NEXT attempt (a retry) will answer. */
    thenAnswer: (answer: CatalogAnswer) => {
      answers = [answers[0], Promise.resolve(answer)];
    },
    /**
     * Holds the NEXT attempt open, and hands back its resolver.
     *
     * Without this a retry resolves within the same tick and the state between
     * "asked again" and "answered again" is never observable — which is the
     * only state the retry test is actually about.
     */
    thenHold: () => {
      const gate2 = deferred<CatalogAnswer>();
      answers = [answers[0], gate2.promise];
      return gate2.resolve;
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('scrollTo', vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const renderBuilder = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>
          <Builder />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );

describe('while the catalogue is loading', () => {
  it('shows the skeleton and NOT the legacy builder', async () => {
    stubCatalogFetch();
    renderBuilder();

    await screen.findByTestId('builder-skeleton');
    // The acceptance criterion, stated exactly: not the fallback, and not a
    // legacy product card either.
    expect(screen.queryByTestId('canonical-fallback')).toBeNull();
    expect(document.querySelector('[data-testid="part-selector"]')).toBeNull();
    expect(screen.queryByTestId('retail-builder')).toBeNull();
    expect(screen.queryByTestId('catalog-failure-notice')).toBeNull();
  });

  it('invents no product, price, availability or retailer link', async () => {
    stubCatalogFetch();
    renderBuilder();
    const skeleton = await screen.findByTestId('builder-skeleton');

    expect(skeleton.textContent).not.toMatch(/\$/);
    expect(skeleton.textContent).not.toMatch(/in stock|out of stock|availability/i);
    expect(skeleton.querySelectorAll('a[href]')).toHaveLength(0);
    expect(skeleton.querySelectorAll('img')).toHaveLength(0);
    expect(skeleton.querySelectorAll('[data-testid="retail-product-card"]')).toHaveLength(0);
    // The one thing it does say, it says about itself.
    expect(screen.getByTestId('builder-loading-status').textContent).toMatch(/loading/i);
  });

  it('cannot be tabbed into, and is hidden from a screen reader', async () => {
    stubCatalogFetch();
    renderBuilder();
    const skeleton = await screen.findByTestId('builder-skeleton');

    const focusable = skeleton.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    expect(focusable).toHaveLength(0);
    // The shapes are hidden; the status message deliberately is not.
    const shapes = skeleton.querySelector('[aria-hidden="true"]');
    expect(shapes).toBeTruthy();
    expect(shapes!.querySelector('[data-testid="builder-skeleton-card"]')).toBeTruthy();
    const status = screen.getByTestId('builder-loading-status');
    expect(status.closest('[aria-hidden="true"]')).toBeNull();
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('keeps the heading and compatibility region, so the page does not jump', async () => {
    stubCatalogFetch();
    renderBuilder();
    await screen.findByTestId('builder-skeleton');

    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(document.body.textContent).toMatch(/compatibility/i);
  });
});

describe('when the catalogue arrives', () => {
  it('replaces the skeleton with the retail builder, and never shows the legacy one', async () => {
    const gate = stubCatalogFetch();
    renderBuilder();
    await screen.findByTestId('builder-skeleton');
    expect(screen.queryByTestId('canonical-fallback')).toBeNull();

    gate.succeed();
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });

    expect(screen.queryByTestId('builder-skeleton')).toBeNull();
    expect(screen.queryByTestId('canonical-fallback')).toBeNull();
    expect(screen.queryByTestId('catalog-failure-notice')).toBeNull();
  }, 30000);

  it('keeps a build that was already chosen', async () => {
    // The selection lives above the catalogue boundary, in localStorage, and a
    // shopper who arrives with a saved build must not lose it to a state
    // transition underneath them.
    window.localStorage.setItem(
      'specsmith-builder-draft',
      JSON.stringify({ gpu: gpu.id }),
    );
    const gate = stubCatalogFetch();
    renderBuilder();
    await screen.findByTestId('builder-skeleton');
    gate.succeed();
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });

    await waitFor(() => {
      expect(screen.getByTestId('view-build').textContent).toContain('View build (1)');
    });
  }, 30000);
});

describe('when the catalogue genuinely fails', () => {
  it('falls back to the canonical builder and says why, with a way to retry', async () => {
    const gate = stubCatalogFetch();
    renderBuilder();
    await screen.findByTestId('builder-skeleton');

    gate.fail();
    await screen.findByTestId('canonical-fallback', {}, { timeout: 10000 });

    const notice = screen.getByTestId('catalog-failure-notice');
    expect(notice.getAttribute('data-failure')).toBe('absent');
    expect(notice.textContent).toMatch(/estimated/i);
    expect(screen.getByTestId('catalog-retry')).toBeTruthy();
    expect(screen.queryByTestId('builder-skeleton')).toBeNull();
  }, 30000);

  it('treats a malformed catalogue as a failure too, not as an empty one', async () => {
    const gate = stubCatalogFetch();
    renderBuilder();
    await screen.findByTestId('builder-skeleton');

    gate.sendGarbage();
    await screen.findByTestId('canonical-fallback', {}, { timeout: 10000 });
    expect(screen.getByTestId('catalog-failure-notice').getAttribute('data-failure')).toBe('invalid');
  }, 30000);
});

describe('retrying after a failure', () => {
  it('goes back to the skeleton rather than sitting on the fallback', async () => {
    const gate = stubCatalogFetch();
    renderBuilder();
    await screen.findByTestId('builder-skeleton');
    gate.fail();
    await screen.findByTestId('canonical-fallback', {}, { timeout: 10000 });

    // The retry's answer is held open, so the in-between state is observable —
    // which is the state the whole issue is about. A retry that jumped from
    // the old failure straight to the new result would hide a second flash of
    // the legacy builder, exactly the one this issue exists to remove.
    const answerRetry = gate.thenHold();

    fireEvent.click(screen.getByTestId('catalog-retry'));

    await screen.findByTestId('builder-skeleton');
    expect(screen.queryByTestId('canonical-fallback')).toBeNull();
    expect(screen.queryByTestId('catalog-failure-notice')).toBeNull();

    answerRetry({ ok: true, body: published });
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });
    expect(screen.queryByTestId('canonical-fallback')).toBeNull();
    expect(screen.queryByTestId('catalog-failure-notice')).toBeNull();
  }, 30000);

  it('stays on the fallback when the retry fails as well', async () => {
    const gate = stubCatalogFetch();
    renderBuilder();
    await screen.findByTestId('builder-skeleton');
    gate.fail();
    await screen.findByTestId('canonical-fallback', {}, { timeout: 10000 });

    gate.thenAnswer({ ok: false, body: {} });
    fireEvent.click(screen.getByTestId('catalog-retry'));

    await waitFor(() => {
      expect(screen.getByTestId('catalog-failure-notice')).toBeTruthy();
    });
    expect(screen.getByTestId('canonical-fallback')).toBeTruthy();
    expect(screen.queryByTestId('retail-builder')).toBeNull();
  }, 30000);

  it('keeps the chosen build across a failure and a successful retry', async () => {
    window.localStorage.setItem(
      'specsmith-builder-draft',
      JSON.stringify({ gpu: gpu.id }),
    );
    const gate = stubCatalogFetch();
    renderBuilder();
    gate.fail();
    await screen.findByTestId('canonical-fallback', {}, { timeout: 10000 });

    gate.thenAnswer({ ok: true, body: published });
    fireEvent.click(screen.getByTestId('catalog-retry'));
    await screen.findByTestId('retail-builder', {}, { timeout: 10000 });

    await waitFor(() => {
      expect(screen.getByTestId('view-build').textContent).toContain('View build (1)');
    });
  }, 30000);
});
