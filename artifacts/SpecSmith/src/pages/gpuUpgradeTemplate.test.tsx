// @vitest-environment jsdom
//
// The GPU upgrade template, rendered — all 57 pages share it, so these tests
// run representative low-, mid- and high-end cards plus the top of the stack.
//
// The page's job changed: it compares and does not conclude. What that has to
// mean on screen is that no sentence recommends a purchase, no figure appears
// without being labelled an estimate, no money appears at all, and every
// Builder link opens the card being COMPARED rather than the card being
// replaced — which was the original defect and is easy to reintroduce, because
// "build around your current GPU" is a plausible-sounding link to add back.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import GpuUpgradePage from './GpuUpgradePage';
import {
  getClosestUpgradeComparisons,
  getUpgradeComparisons,
  UPGRADE_COMPARISON_PREVIEW_LIMIT,
} from '../lib/upgradeCalculator';

/** slug → gpu id, spanning the range of the catalogue. */
const PAGES: ReadonlyArray<readonly [string, string, string]> = [
  ['rx-6400', 'rx6400', 'low-end'],
  ['rx-6600', 'rx6600', 'low-end'],
  ['rtx-4070', 'rtx4070', 'mid-range'],
  ['rtx-5080', 'rtx5080', 'high-end'],
  ['rtx-5090', 'rtx5090', 'top of the stack'],
];

beforeAll(() => {
  // framer-motion's whileInView needs an observer jsdom does not provide. The
  // rows render regardless; none of these tests is about the animation.
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
    root = null;
    rootMargin = '';
    thresholds = [];
  }
  globalThis.IntersectionObserver = NoopObserver as unknown as typeof IntersectionObserver;
});

// After EVERY test, pass or fail. A cleanup() at the end of a test body is
// skipped when an assertion throws, and the leftover DOM then makes the next
// test's queries find the previous page's nodes.
afterEach(cleanup);

/** The rendered page's own root, kept so queries do not reach into <head>. */
let container: HTMLElement;

const open = (slug: string) => {
  ({ container } = render(
    <MemoryRouter initialEntries={[`/upgrade/${slug}`]}>
      <Routes>
        <Route path="/upgrade/:slug" element={<GpuUpgradePage />} />
      </Routes>
    </MemoryRouter>,
  ));
  return container.textContent ?? '';
};

describe.each(PAGES)('/upgrade/%s (%s)', (slug, gpuId, _band) => {
  it('recommends nothing', () => {
    const text = open(slug).toLowerCase();
    for (const banned of [
      'best upgrade', 'worth it', 'we recommend', 'you should upgrade', 'top pick',
      'best value', 'strong upgrade', 'moderate upgrade', 'marginal gain',
    ]) {
      expect(text, `page still says "${banned}"`).not.toContain(banned);
    }
  });

  it('shows no money of any kind', () => {
    const text = open(slug);
    expect(text.match(/\$[\d,]+/g) ?? []).toEqual([]);
    for (const banned of [/net cost/i, /resale/i, /cost\s*\/\s*fps/i, /per estimated fps/i, /price/i]) {
      // "price" is allowed only inside the note explaining why there are none.
      const hits = text.match(new RegExp(banned.source, 'gi')) ?? [];
      const note = screen.getByTestId('no-prices-note').textContent ?? '';
      const outsideNote = hits.filter((h) => !note.includes(h));
      expect(outsideNote, `"${banned.source}" appears outside the no-prices note`).toEqual([]);
    }
  });

  it('labels every FPS figure and percentage as modelled', () => {
    open(slug);
    expect(screen.getByText(/Estimated Average FPS/)).toBeTruthy();
    expect(screen.getByText(/an estimate, not a benchmark/i)).toBeTruthy();
    const basis = screen.getByTestId('estimate-basis').textContent ?? '';
    expect(basis).toMatch(/estimates, not benchmark results/i);
    expect(basis).toMatch(/fixed reference CPU/i);

    const rows = screen.queryAllByTestId('comparison-row');
    for (const row of rows) {
      expect(within(row).getByText(/Estimated difference/i)).toBeTruthy();
      expect(within(row).getByText(/Estimated average/i)).toBeTruthy();
    }
  });

  it('states exactly how the compact preview was built', () => {
    open(slug);
    const basis = screen.getByTestId('selection-basis').textContent ?? '';
    expect(basis).toMatch(new RegExp(`up to ${UPGRADE_COMPARISON_PREVIEW_LIMIT}`));
    expect(basis).toMatch(/closest GPUs/i);
    expect(basis).toMatch(/smallest modelled difference upward/i);
    expect(basis).toMatch(/price does not affect/i);
    expect(basis).toMatch(/not a recommendation/i);
  });

  it('keeps a self-referential canonical and its own URL', () => {
    open(slug);
    const canonical = document.head.querySelector('link[rel="canonical"]');
    expect(canonical?.getAttribute('href')).toBe(`https://specsmithpc.com/upgrade/${slug}`);
  });

  it('opens the COMPARED card in Builder, never the card being replaced', () => {
    open(slug);
    const links = Array.from(container.querySelectorAll('a[href^="/builder"]'));
    const comparisons = getClosestUpgradeComparisons(gpuId);
    expect(links).toHaveLength(comparisons.length);
    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      expect(href).not.toBe(`/builder?gpu=${gpuId}`);
      const target = href.replace('/builder?gpu=', '');
      expect(comparisons.some((c) => c.gpu.id === target), `${href} is not a compared card`).toBe(true);
      const compared = comparisons.find((c) => c.gpu.id === target)!;
      expect(link.getAttribute('aria-label')).toBe(`Open ${compared.gpu.name} in Builder`);
    }
  });

  it('renders only the compact preview, in closest-first order', () => {
    open(slug);
    const rendered = screen.queryAllByTestId('comparison-row').map((row) => row.getAttribute('data-gpu-id'));
    expect(rendered).toEqual(getClosestUpgradeComparisons(gpuId).map((c) => c.gpu.id));
    expect(rendered.length).toBeLessThanOrEqual(UPGRADE_COMPARISON_PREVIEW_LIMIT);
  });

  it('puts nothing in the FAQ schema that is not visible on the page', () => {
    open(slug);
    // Scoped to the page's own root. `useSeo` injects a site-wide JSON-LD
    // block into <head>, and a document-wide query finds that one first.
    const ld = container.querySelector('script[type="application/ld+json"]');
    const parsed = JSON.parse(ld?.innerHTML ?? '{}');
    expect(Array.isArray(parsed.mainEntity), 'no FAQ schema on the page').toBe(true);
    const pageText = (container.textContent ?? '').replace(/\s+/g, ' ');
    for (const entry of parsed.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>) {
      expect(pageText, `question not visible: ${entry.name}`).toContain(entry.name);
      expect(pageText, `answer not visible: ${entry.name}`).toContain(entry.acceptedAnswer.text.replace(/\s+/g, ' '));
    }
    // Recommendation language is banned outright.
    const ldText = JSON.stringify(parsed).toLowerCase();
    for (const banned of ['best upgrade', 'best value', 'worth it', 'we recommend']) {
      expect(ldText, `schema still claims "${banned}"`).not.toContain(banned);
    }
    // Money words are banned only where they would be a CLAIM. The FAQ that
    // explains why the page carries no prices has to name them to say so, and
    // a flat substring ban would fail on the very sentence that does the work.
    const claims = (parsed.mainEntity as Array<{ acceptedAnswer: { text: string } }>)
      .map((entry) => entry.acceptedAnswer.text.toLowerCase())
      .filter((text) => !text.includes('does not show prices'));
    for (const answer of claims) {
      for (const banned of ['net cost', 'resale', 'cost per frame', 'cost-per-frame']) {
        expect(answer, `an answer still claims "${banned}"`).not.toContain(banned);
      }
      expect(answer).not.toMatch(/\$\s?\d/);
    }
  });
});

describe('copy follows the dataset and the estimator implementation', () => {
  it('does not freeze the total dataset size into reader-facing copy', () => {
    const text = open('rx-6600');
    expect(text).not.toMatch(/of the \d+ GPUs SpecSmith tracks/i);
  });

  it('does not claim the estimator uses the catalogue tier', () => {
    open('rx-6600');
    const basis = screen.getByTestId('estimate-basis').textContent ?? '';
    expect(basis).toMatch(/internal GPU performance factor/i);
    expect(basis).not.toMatch(/performance tier/i);
  });
});

describe('the top of the stack degrades without a recommendation', () => {
  it('says nothing is faster rather than inventing a next step', () => {
    const text = open('rtx-5090');
    expect(getUpgradeComparisons('rtx5090')).toEqual([]);
    expect(text).toMatch(/No GPU SpecSmith tracks produces a higher modelled average/i);
    expect(screen.getByTestId('comparison-count').textContent).toBe('0');
    expect(screen.queryAllByTestId('comparison-row')).toHaveLength(0);
  });
});

describe('an unknown slug still degrades safely', () => {
  it('shows the not-found state rather than crashing', () => {
    expect(open('not-a-real-card')).toContain('GPU not found');
  });
});
