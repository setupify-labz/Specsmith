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

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import GpuUpgradePage from './GpuUpgradePage';
import { UPGRADE_REFERENCE_CPU, getUpgradeCandidates } from '../lib/upgradeCalculator';
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

// Unmount after EVERY test, pass or fail. A cleanup() at the end of a test
// body is skipped when an assertion throws, and the leftover DOM then makes
// the next test's queryByTestId find the previous page's nodes — which is how
// a genuine failure in one test turned into five bogus failures in others.
afterEach(cleanup);

const openGuide = (slug: string) =>
  render(
    <MemoryRouter initialEntries={[`/upgrade/${slug}`]}>
      <Routes>
        <Route path="/upgrade/:slug" element={<GpuUpgradePage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('the RX 6600 reference guide answers the question it is found for', () => {
  it('states the verdict above the shortlist', () => {
    const { container } = openGuide('rx-6600');
    const text = container.textContent ?? '';
    const verdictAt = text.indexOf('but not with the cheapest card one tier up');
    const optionsAt = text.indexOf('Upgrade Options');
    expect(verdictAt).toBeGreaterThan(-1);
    // ORDER IS THE POINT. This answer used to be the fourth FAQ, below six
    // cards ranked by tier — the reader met the worst recommendation first.
    expect(verdictAt).toBeLessThan(optionsAt);
  });

  it('shows the three shortlist positions', () => {
    openGuide('rx-6600');
    for (const band of ['smallest', 'middle', 'largest']) {
      expect(screen.getByTestId(`upgrade-path-${band}`)).toBeTruthy();
    }
  });

  it('every path button loads THE UPGRADE into Builder, not the current card', () => {
    openGuide('rx-6600');
    for (const band of ['smallest', 'middle', 'largest']) {
      const cta = screen.getByTestId(`upgrade-path-cta-${band}`);
      const href = cta.getAttribute('href') ?? '';
      expect(href).toMatch(/^\/builder\?gpu=/);
      // The page's pre-existing button is "Build Around the RX 6600", which
      // loads the card being replaced. A test-the-upgrade action that did the
      // same thing would be decorative.
      expect(href).not.toBe('/builder?gpu=rx6600');
      expect(cta.textContent).toMatch(/test this upgrade in builder/i);
    }
  });

  it('shows no price, resale or cost-per-frame figure anywhere in the new sections', () => {
    // THE BOUNDARY REVIEW DREW. Prices in gpus.json are editorial and resale
    // is a flat 65% of one, so a net cost or cost-per-frame built on them
    // reads as precision the data cannot carry.
    const { container } = openGuide('rx-6600');
    for (const band of ['smallest', 'middle', 'largest']) {
      const card = screen.getByTestId(`upgrade-path-${band}`).textContent ?? '';
      expect(card).not.toMatch(/\$/);
      expect(card.toLowerCase()).not.toMatch(/net cost|resale|per estimated fps|cost\s*\/\s*fps/);
    }
    const note = screen.getByTestId('upgrade-shortlist-note').textContent ?? '';
    expect(note).not.toMatch(/\$/);
    void container;
  });

  it('labels each position with the rule that actually selected it', () => {
    openGuide('rx-6600');
    const largest = screen.getByTestId('upgrade-path-largest').textContent ?? '';
    expect(largest).toMatch(/Largest modelled step/);
    expect(largest.toLowerCase()).not.toContain('whatever it costs');
    expect(largest.toLowerCase()).not.toMatch(/budget|high-end/);
    const smallest = screen.getByTestId('upgrade-path-smallest').textContent ?? '';
    expect(smallest).toMatch(/Smallest qualifying step/);
  });

  it('tells the reader the shortlist is not every faster card', () => {
    openGuide('rx-6600');
    const note = screen.getByTestId('upgrade-shortlist-note').textContent ?? '';
    expect(note).toMatch(/not every card/i);
    expect(note).toMatch(/at most six/i);
  });

  it('names cards below the threshold without claiming what a player would notice', () => {
    openGuide('rx-6600');
    const note = screen.getByTestId('upgrade-below-threshold').textContent ?? '';
    const below = getUpgradeCandidates('rx6600').filter((c) => c.fpsGainPct < MEANINGFUL_GAIN_PCT);
    expect(below.length).toBeGreaterThan(0);
    for (const candidate of below) expect(note).toContain(candidate.gpu.name);
    expect(note).toMatch(/comparison threshold chosen by SpecSmith/i);
    expect(note.toLowerCase()).not.toMatch(/would notice|noticeable|not worth paying|feel faster/);
  });

  it('reports board power without ruling on any power supply', () => {
    openGuide('rx-6600');
    const caveat = screen.getByTestId('upgrade-power-caveat').textContent ?? '';
    expect(caveat).toMatch(/not measurements of any specific card/i);
    expect(caveat).toMatch(/does not assess whether a given power supply is sufficient/i);
    expect(caveat.toLowerCase()).not.toContain('spike');
  });

  it('discloses the estimator assumption without offering a bottleneck finding', () => {
    const { container } = openGuide('rx-6600');
    const note = screen.getByTestId('upgrade-estimator-note').textContent ?? '';
    expect(note).toContain(UPGRADE_REFERENCE_CPU.name);
    expect(note).toMatch(/model output, not benchmark results/i);
    const text = (container.textContent ?? '').toLowerCase();
    for (const forbidden of ['bottleneck', 'hold it back', 'ryzen 5 3600']) {
      expect(text, `page still says "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it('labels the modelled figures where they are shown', () => {
    const { container } = openGuide('rx-6600');
    const text = container.textContent ?? '';
    expect(text).toMatch(/Estimated Average FPS/);
    expect(text).toMatch(/an estimate, not a benchmark/i);
    expect(text).toMatch(/Estimated FPS gain/);
    expect(text).toMatch(/Estimated average/);
    // The one price the page still shows is the pre-existing stat tile, which
    // carries its estimate label and its date at the point of display.
    expect(text).toMatch(/Estimated \$209 new · July 16, 2026/);
  });

  it('does not publish two recommendations that disagree', () => {
    const { container } = openGuide('rx-6600');
    const text = container.textContent ?? '';
    expect(text).not.toContain('What should I upgrade my RX 6600 to?');
    expect(text).not.toContain('Is upgrading worth it right now?');
    expect(text).toContain('Is it worth upgrading from an RX 6600?');
  });

  it('puts nothing in the FAQ schema that is not on the page', () => {
    // Structured data is a claim made to a search engine. Anything in it that
    // a visitor cannot see on the page is a claim made only to the crawler.
    const { container } = openGuide('rx-6600');
    const ld = container.querySelector('script[type="application/ld+json"]');
    const parsed = JSON.parse(ld?.innerHTML ?? '{}');
    const entries: Array<{ name: string; acceptedAnswer: { text: string } }> = parsed.mainEntity;
    expect(entries.length).toBeGreaterThan(3);
    const pageText = (container.textContent ?? '').replace(/\s+/g, ' ');
    for (const entry of entries) {
      expect(pageText, `question not visible: ${entry.name}`).toContain(entry.name);
      expect(pageText, `answer not visible: ${entry.name}`).toContain(entry.acceptedAnswer.text.replace(/\s+/g, ' '));
    }
    const ldText = JSON.stringify(parsed).toLowerCase();
    for (const forbidden of ['bottleneck', 'net cost', 'resale', 'ryzen 5 3600']) {
      expect(ldText, `schema still claims "${forbidden}"`).not.toContain(forbidden);
    }
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
      expect(screen.queryByTestId('upgrade-path-smallest')).toBeNull();
      expect(screen.queryByTestId('upgrade-power-caveat')).toBeNull();
      expect(screen.queryByTestId('upgrade-estimator-note')).toBeNull();
      expect(screen.queryByTestId('upgrade-shortlist-note')).toBeNull();
      expect(text).not.toMatch(/Where the Shortlist Lands/);
      expect(text).not.toMatch(/Test this upgrade in Builder/);
      // ...and keeps the generic FAQs the reference build supersedes.
      expect(text).toContain('Is upgrading worth it right now?');
    },
  );

  it('other guides keep their original stat labels', () => {
    const { container } = openGuide('rtx-4060');
    const text = container.textContent ?? '';
    expect(text).toContain('Across 20 games at 1440p High.');
    expect(text).not.toMatch(/Estimated Average FPS/);
  });
});

describe('an unknown slug still degrades safely', () => {
  it('shows the not-found state rather than crashing', () => {
    const { container } = openGuide('not-a-real-card');
    expect(container.textContent).toContain('GPU not found');
  });
});

describe('the reference page carries no money at all', () => {
  it('shows no dollar figure anywhere in the body', () => {
    // The page still names an editorial list price in its Tier tile, labelled
    // and dated — that is the one figure review left standing. Everything
    // derived FROM a price is gone: resale, net cost, cost-per-FPS, and the
    // "Best value" badge, which is itself the lowest-cost-per-FPS pick.
    const { container } = openGuide('rx-6600');
    const text = container.textContent ?? '';
    const dollars = text.match(/\$[\d,]+/g) ?? [];
    expect(dollars).toEqual(['$209']);
    expect(text).toMatch(/Estimated \$209 new/);
    expect(text).not.toMatch(/Estimated Resale Value/);
    expect(text).not.toMatch(/Net Cost/i);
    expect(text).not.toMatch(/Cost \/ FPS/i);
    expect(text).not.toMatch(/Best value/i);
  });

  it('but every other guide keeps the figures it always had', () => {
    // Not an improvement withheld from the other 56 — the scope of this change
    // is one URL, and silently altering the rest is the failure mode the
    // opt-in design exists to prevent.
    const { container } = openGuide('rtx-4060');
    const text = container.textContent ?? '';
    expect(text).toMatch(/Estimated Resale Value/);
    expect(text).toMatch(/Net Cost/i);
    expect(text).toMatch(/Cost \/ FPS/i);
  });
});
