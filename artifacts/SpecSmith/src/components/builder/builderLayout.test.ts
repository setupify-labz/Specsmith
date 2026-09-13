import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The wide-desktop layout, asserted against the source.
//
// jsdom has no layout engine and applies no media query, so a component test
// cannot tell a three-column grid from a one-column one. What can be pinned
// here is the RULE — the shell's width function, the two side column widths,
// and the breakpoint each column count appears at. The rendered result is
// measured in a real browser by the capture script, which reads the computed
// column count and the page's scroll width at 1280, 1440, 1920 and 2048.

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(here, '..', '..');
const css = fs.readFileSync(path.join(srcRoot, 'index.css'), 'utf-8');
const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), 'utf-8');

/**
 * Source with comment lines removed.
 *
 * RetailCatalog's header explains at length what the old layout did wrong —
 * "a max-h-[400px] overflow-y-auto box inside an accordion" — and prose
 * describing a removed mistake must not fail a check looking for it, any more
 * than it may satisfy one.
 */
const readCode = (relative: string) =>
  read(relative)
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

describe('the builder shell grows with the display', () => {
  it('is a width function, not a fixed cap', () => {
    const rule = /\.ff-builder-shell\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    const body = rule?.[1] ?? '';
    expect(body).toMatch(/max-width:\s*clamp\(/);
    expect(body).toContain('94vw');
    expect(body).toContain('1760px');
  });

  it('never gets narrower than the layout it replaced', () => {
    // clamp's floor is 80rem — exactly max-w-7xl — so 1280px and everything
    // below it renders as before and the tablet and phone layouts cannot move.
    const rule = /\.ff-builder-shell\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('80rem');
  });

  it('is what the builder page actually uses', () => {
    const page = read(path.join('pages', 'Builder.tsx'));
    expect(page).toContain('ff-builder-shell');
    // The fixed cap is gone from the builder's own shell.
    expect(/className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"/.test(page)).toBe(false);
  });
});

describe('the three columns keep the proportions the review set', () => {
  const builder = read(path.join('components', 'builder', 'RetailBuilder.tsx'));

  it('gives the navigation 224px, widening to 240px', () => {
    // w-56 = 224px, 2xl:w-60 = 240px. Both inside the 220-250 band.
    expect(builder).toContain('w-56 shrink-0 lg:block 2xl:w-60');
  });

  it('gives the build summary 320px, widening to 360px', () => {
    // w-80 = 320px. Both inside the 320-380 band.
    expect(builder).toContain('w-80 shrink-0 xl:block 2xl:w-[360px]');
    expect(builder).not.toContain('w-72 shrink-0 xl:block');
  });

  it('lets the catalogue take whatever is left', () => {
    expect(builder).toContain('min-w-0 flex-1');
  });
});

describe('columns are added rather than cards enlarged', () => {
  const catalogue = readCode(path.join('components', 'builder', 'RetailCatalog.tsx'));
  const card = readCode(path.join('components', 'builder', 'RetailProductCard.tsx'));

  it('goes one, two, three across the breakpoints', () => {
    expect(catalogue).toContain('grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3');
  });

  it('stops at three, because a fourth card would be too narrow to read', () => {
    // At the 1760px ceiling the centre column is about 1050px. Three cards are
    // ~340px each; four would be ~250px, under the ~300px floor the review set.
    expect(catalogue).not.toContain('grid-cols-4');
  });

  it('does not scale the card up with the viewport', () => {
    // The card's type and image frame carry no width-dependent size, so the
    // extra room becomes another column instead of a bigger card.
    expect(card).toContain('h-[240px]');
    expect(card).toContain('md:aspect-[4/3]');
    for (const forbidden of ['2xl:text-', 'xl:text-', '2xl:h-[', '2xl:p-']) {
      expect(card.includes(forbidden), forbidden).toBe(false);
    }
  });

  it('adds no scroll container inside the catalogue', () => {
    // The page scrolls; the catalogue does not. A widened shell must not
    // reintroduce the nested scroller the redesign removed.
    for (const forbidden of ['overflow-y-auto', 'overflow-y-scroll', 'max-h-[']) {
      expect(catalogue.includes(forbidden), forbidden).toBe(false);
    }
  });
});
