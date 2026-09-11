// @vitest-environment jsdom
//
// The skeleton's two jobs: hold the retail layout's shape, and claim nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import BuilderSkeleton from './BuilderSkeleton';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string) => fs.readFileSync(path.join(here, file), 'utf-8');
/** Source with comment lines removed: prose must neither satisfy nor fail a check. */
const code = (file: string) =>
  read(file)
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

afterEach(cleanup);

describe('the skeleton holds the same shape the real builder will take', () => {
  // A skeleton whose columns are a different width from the interface that
  // replaces it moves the page under the reader at the exact moment they start
  // reading it — the layout shift the issue asks to avoid. These are the four
  // measurements that decide the builder's footprint, and they are compared
  // against RetailBuilder rather than restated, so the two cannot drift.
  const skeleton = code('BuilderSkeleton.tsx');
  const builder = code('RetailBuilder.tsx');

  it('uses the same rail width and breakpoint', () => {
    for (const cls of ['hidden', 'w-56', 'shrink-0', 'lg:block', '2xl:w-60']) {
      expect(skeleton, cls).toContain(cls);
      expect(builder, cls).toContain(cls);
    }
  });

  it('uses the same summary width and breakpoint', () => {
    for (const cls of ['w-80', 'xl:block', '2xl:w-[360px]']) {
      expect(skeleton, cls).toContain(cls);
      expect(builder, cls).toContain(cls);
    }
  });

  it('uses the same three-column row and the same product grid', () => {
    expect(skeleton).toContain('flex gap-6');
    expect(builder).toContain('flex gap-6');
    expect(skeleton).toContain('grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3');
  });

  it('uses the same image frame, so a photograph lands where the box was', () => {
    // 240px on a phone, 4:3 from md up — the card's own rule.
    expect(skeleton).toContain('h-[240px]');
    expect(skeleton).toContain('md:aspect-[4/3]');
    expect(skeleton).toContain('retail-photo-frame');
    expect(code('RetailProductCard.tsx')).toContain('md:aspect-[4/3]');
  });

  it('hides the rail and the summary on a phone exactly as the builder does', () => {
    render(<BuilderSkeleton />);
    const rail = document.querySelector('.w-56');
    const summary = document.querySelector('.w-80');
    expect(rail?.className).toContain('hidden');
    expect(rail?.className).toContain('lg:block');
    expect(summary?.className).toContain('hidden');
    expect(summary?.className).toContain('xl:block');
  });
});

describe('the skeleton claims nothing', () => {
  it('renders no text at all beyond its own status line', () => {
    render(<BuilderSkeleton />);
    const shapes = screen.getByTestId('builder-skeleton').querySelector('[aria-hidden="true"]');
    // Not "no prices" — no words. There is nothing a shopper could misread as
    // a product, a price, a stock level or a count, because there is nothing.
    expect(shapes!.textContent?.trim()).toBe('');
  });

  it('says it is loading exactly once, politely', () => {
    render(<BuilderSkeleton />);
    const statuses = document.querySelectorAll('[role="status"]');
    expect(statuses).toHaveLength(1);
    expect(statuses[0].getAttribute('aria-live')).toBe('polite');
    // `assertive` would interrupt whatever the reader is saying, on every
    // visit, to announce that a page is doing the ordinary thing pages do.
    expect(statuses[0].getAttribute('aria-live')).not.toBe('assertive');
  });
});

describe('the skeleton respects reduced motion', () => {
  const css = fs.readFileSync(path.join(here, '..', '..', 'index.css'), 'utf-8');

  it('animates the bars only where motion is welcome', () => {
    const rule = css.match(/\.retail-skeleton-bar\s*\{[^}]*\}/g) ?? [];
    expect(rule.length).toBeGreaterThanOrEqual(1);
    expect(rule[0]).toContain('animation');

    // The GLOBAL reduced-motion rule sets animation-duration to 0.01ms, which
    // makes an animation finish instantly rather than not run — a pulse would
    // freeze at whichever keyframe it reached. The skeleton therefore states
    // its own rule, which removes the animation outright.
    //
    // Matched by counting braces rather than by regex. A lazy regex walks
    // straight out of one block and into the next, so it "found" the global
    // reduced-motion block joined to the ordinary .retail-skeleton-bar rule
    // that follows it — a match that proves nothing.
    const blocks: string[] = [];
    const opener = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
    for (let hit = opener.exec(css); hit; hit = opener.exec(css)) {
      let depth = 1;
      let index = hit.index + hit[0].length;
      while (index < css.length && depth > 0) {
        if (css[index] === '{') depth += 1;
        else if (css[index] === '}') depth -= 1;
        index += 1;
      }
      blocks.push(css.slice(hit.index, index));
    }
    const owning = blocks.find((block) => block.includes('.retail-skeleton-bar'));
    expect(owning, 'no reduced-motion rule for the skeleton bar').toBeTruthy();
    expect(owning!).toMatch(/animation:\s*none/);
  });

  it('has a resting colour of its own in both themes', () => {
    // Its own token: borrowing --ff-surface or --ff-card would make the bars
    // invisible against the card they sit on in one theme or the other.
    const dark = css.slice(css.indexOf(':root'), css.indexOf('[data-theme="light"]'));
    const light = css.slice(css.indexOf('[data-theme="light"]'));
    expect(dark).toMatch(/--ff-skeleton:/);
    expect(light).toMatch(/--ff-skeleton:/);
  });
});
