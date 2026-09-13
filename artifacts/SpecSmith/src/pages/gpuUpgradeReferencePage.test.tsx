// @vitest-environment jsdom
//
// What the reference guide actually renders, and what the other 56 still do.
//
// The derivations are unit-tested in src/lib/upgradeGuideDetail.test.ts. These
// tests drive the page, because the questions being answered are questions
// about a page: does the verdict come before the card list, is every estimate
// labelled where it is shown rather than in a footnote, does the button load
// the upgrade instead of the card being replaced, and does the page state one
// recommendation rather than two that disagree.

import { beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import GpuUpgradePage from './GpuUpgradePage';
import { getUpgradeCandidates } from '../lib/upgradeCalculator';
import { MEANINGFUL_GAIN_PCT } from '../lib/upgradeGuideDetail';

// The candidate cards animate in with framer-motion's `whileInView`, which
// needs an IntersectionObserver jsdom does not provide. A stub that reports
// nothing is enough: the elements render regardless, and none of these tests
// is about the animation.
beforeAll(() => {
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

const openGuide = (slug: string) =>
  render(
    <MemoryRouter initialEntries={[`/upgrade/${slug}`]}>
      <Routes>
        <Route path="/upgrade/:slug" element={<GpuUpgradePage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('the RX 6600 reference guide answers the question it is found for', () => {
  it('states the verdict above the card list', () => {
    const { container } = openGuide('rx-6600');
    const text = container.textContent ?? '';
    const verdictAt = text.indexOf('but not with the cheapest card above it');
    const optionsAt = text.indexOf('Upgrade Options');
    expect(verdictAt).toBeGreaterThan(-1);
    // ORDER IS THE POINT. This answer used to be the fourth FAQ, below six
    // cards ranked by tier — the reader met the worst recommendation first.
    expect(verdictAt).toBeLessThan(optionsAt);
    cleanup();
  });

  it('offers a budget, mid-range and high-end path', () => {
    openGuide('rx-6600');
    for (const band of ['budget', 'midrange', 'high-end']) {
      expect(screen.getByTestId(`upgrade-path-${band}`)).toBeTruthy();
    }
    cleanup();
  });

  it('every path button loads THE UPGRADE into Builder, not the current card', () => {
    openGuide('rx-6600');
    for (const band of ['budget', 'midrange', 'high-end']) {
      const cta = screen.getByTestId(`upgrade-path-cta-${band}`);
      const href = cta.getAttribute('href') ?? '';
      expect(href).toMatch(/^\/builder\?gpu=/);
      // The page's pre-existing button is "Build Around the RX 6600", which
      // loads the card being replaced. A test-the-upgrade action that did the
      // same thing would be decorative.
      expect(href).not.toBe('/builder?gpu=rx6600');
      expect(cta.textContent).toMatch(/test this upgrade in builder/i);
    }
    cleanup();
  });

  it('names the marginal card as not worth paying for instead of hiding it', () => {
    openGuide('rx-6600');
    const note = screen.getByTestId('upgrade-not-worth-it');
    const marginal = getUpgradeCandidates('rx6600').filter((c) => c.fpsGainPct < MEANINGFUL_GAIN_PCT);
    expect(marginal.length).toBeGreaterThan(0);
    for (const candidate of marginal) {
      expect(note.textContent).toContain(candidate.gpu.name);
    }
    cleanup();
  });

  it('answers the power question without ruling on it', () => {
    openGuide('rx-6600');
    const caveat = screen.getByTestId('upgrade-power-caveat').textContent ?? '';
    expect(caveat).toMatch(/not measurements of a specific card/i);
    expect(caveat).toMatch(/check the exact model/i);
    cleanup();
  });

  it('states the CPU the estimates assume, and what a slower one costs', () => {
    const { container } = openGuide('rx-6600');
    const text = container.textContent ?? '';
    expect(text).toMatch(/Will your CPU hold it back\?/i);
    expect(text).toMatch(/assumes a Ryzen 7 9800X3D/i);
    expect(screen.getByTestId('upgrade-cpu-caveat').textContent).toMatch(/estimates|not benchmark results/i);
    cleanup();
  });

  it('labels the modelled figures where they are shown', () => {
    const { container } = openGuide('rx-6600');
    const text = container.textContent ?? '';
    expect(text).toMatch(/Estimated Average FPS/);
    expect(text).toMatch(/an estimate, not a benchmark/i);
    expect(text).toMatch(/Estimated FPS gain/);
    expect(text).toMatch(/Net cost \(estimated\)/);
    // Editorial prices carry their date at the point of display.
    expect(text).toMatch(/Estimated \$209 new · July 16, 2026/);
    cleanup();
  });

  it('does not publish two recommendations that disagree', () => {
    const { container } = openGuide('rx-6600');
    const text = container.textContent ?? '';
    // The generic FAQs named the cheapest next-tier card and, separately, the
    // biggest raw gain regardless of cost. Both contradicted the verdict.
    expect(text).not.toContain('What should I upgrade my RX 6600 to?');
    expect(text).not.toContain('Is upgrading worth it right now?');
    expect(text).toContain('Is it worth upgrading from an RX 6600?');
    cleanup();
  });

  it('feeds the FAQ schema the same questions the page shows', () => {
    const { container } = openGuide('rx-6600');
    const ld = container.querySelector('script[type="application/ld+json"]');
    const parsed = JSON.parse(ld?.innerHTML ?? '{}');
    const names: string[] = parsed.mainEntity.map((entry: { name: string }) => entry.name);
    expect(names).toContain('Is it worth upgrading from an RX 6600?');
    expect(names).not.toContain('Is upgrading worth it right now?');
    for (const name of names) expect(container.textContent).toContain(name);
    cleanup();
  });
});

describe('no other upgrade guide is changed', () => {
  // A sample across vendors and tiers. The exhaustive slug check lives in the
  // unit test; this one proves the PAGE renders none of the new furniture.
  it.each(['rx-6600-xt', 'rtx-4060', 'rx-7900-xtx', 'arc-b580', 'rtx-5090'])(
    '/upgrade/%s renders none of the reference sections',
    (slug) => {
      const { container } = openGuide(slug);
      const text = container.textContent ?? '';
      expect(screen.queryByTestId('upgrade-path-budget')).toBeNull();
      expect(screen.queryByTestId('upgrade-power-caveat')).toBeNull();
      expect(screen.queryByTestId('upgrade-cpu-caveat')).toBeNull();
      expect(text).not.toMatch(/Three Upgrade Paths/);
      expect(text).not.toMatch(/Test this upgrade in Builder/);
      // ...and keeps the generic FAQs the reference build supersedes.
      expect(text).toContain('Is upgrading worth it right now?');
      cleanup();
    },
  );

  it('other guides keep their original stat labels', () => {
    const { container } = openGuide('rtx-4060');
    const text = container.textContent ?? '';
    expect(text).toContain('Across 20 games at 1440p High.');
    expect(text).not.toMatch(/Estimated Average FPS/);
    cleanup();
  });
});

describe('an unknown slug still degrades safely', () => {
  it('shows the not-found state rather than crashing', () => {
    const { container } = openGuide('not-a-real-card');
    expect(container.textContent).toContain('GPU not found');
    cleanup();
  });
});
