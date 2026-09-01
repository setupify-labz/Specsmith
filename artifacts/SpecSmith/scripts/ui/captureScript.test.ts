import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The contract of the screenshot capture script.
//
// WHAT THIS IS NOW. The script was driven by a temporary workflow that built
// the app on a runner — where the retailer's image CDN is reachable, unlike
// the development sandbox — photographed the builder, and published the
// results so a redesign could be reviewed. That workflow has been removed
// along with the write access it needed. The script is kept because it is
// reusable: the next time the builder's appearance is in question it can be
// pointed at any served build with BASE_URL and OUT_DIR.
//
// So this file no longer asserts anything about a workflow. It holds the
// script to the measurement rules that were the point of it — the ones that
// were each learned from a defect that a weaker check had already missed.

const here = path.dirname(fileURLToPath(import.meta.url));
const script = fs.readFileSync(path.join(here, 'captureBuilderScreenshots.mjs'), 'utf-8');

describe('the capture counts a real image, not a present element', () => {
  it('requires the image to have actually decoded', () => {
    // `complete` is true for a failed request too. naturalWidth is the only
    // signal that separates a decoded picture from a broken one, and > 1 also
    // rules out a tracking pixel.
    expect(script).toContain('img.naturalWidth <= 1');
    expect(script).toContain('PRODUCTS_MEASURED = 24');
  });

  it('scrolls the measured cards through the viewport first', () => {
    // The cards load lazily. An image below the fold is never requested, and
    // counting it as failed would measure the scroll position instead of the
    // CDN.
    expect(script).toContain('revealCards');
    expect(script).toContain('scrollIntoView');
  });
});

describe('the capture reads the picture, not just the element', () => {
  it('measures how much of each frame the product actually occupies', () => {
    // Two <img> elements can be identical in size, both contained, neither
    // stretched, and still show one product at half the size of the other,
    // because the emptiness is inside the raster.
    expect(script).toContain('measureRenderedProductSpans');
    expect(script).toContain('getImageData');
    expect(script).toContain('SMALL_PRODUCT_SPAN');
    expect(script).toContain('heavilyPadded');
  });

  it('records the layout faults a screenshot alone would not settle', () => {
    expect(script).toContain('horizontalOverflowPx');
    expect(script).toContain('nestedCatalogScrollers');
    expect(script).toContain('stretched');
    expect(script).toContain('collapsed');
  });
});

describe('the capture checks the header where the screenshots do not look', () => {
  it('walks a range of widths spanning both sides of the breakpoint', () => {
    // The tablet defect — a wrapped "Sign In", a clipped "Start Building" —
    // sat between two screenshot widths. A check that only looks where a
    // screenshot is taken would miss it again.
    const widths = /HEADER_WIDTHS = \[([^\]]+)\]/.exec(script);
    expect(widths).not.toBeNull();
    const values = (widths?.[1] ?? '').split(',').map((value) => Number(value.trim()));
    expect(Math.min(...values)).toBeLessThanOrEqual(768);
    expect(Math.max(...values)).toBeGreaterThanOrEqual(1100);
    expect(values).toContain(1279);
    expect(values).toContain(1280);
  });

  it('asks whether each control fits, not whether it exists', () => {
    expect(script).toContain('clippedControls');
    expect(script).toContain('wrappedControls');
  });
});

describe('the capture measures contrast on the rendered accent controls', () => {
  it('reads computed styles in both themes', () => {
    // The tokens are checked arithmetically in accentContrast.test.ts. This
    // is the other half: a control that inherits some other colour has a fine
    // token and a bad screen.
    expect(script).toContain('captureAccentControls');
    expect(script).toContain("for (const theme of ['dark', 'light'])");
    expect(script).toContain('getComputedStyle');
    for (const control of ['viewBuild', 'inBuild', 'activeChip']) {
      expect(script.includes(control), control).toBe(true);
    }
  });

  it('proves its own setup instead of trusting a click', () => {
    // "Add to build" toggles and the build survives a reload, so a click on
    // an already-chosen card removed it — two clicks, both reporting success,
    // and a "View build (0)" screenshot captioned as a full build.
    expect(script).toContain("data-selected");
    expect(script).toContain('waitForSelector');
  });
});

describe('the capture reaches no credential and no feed', () => {
  it('names none of them', () => {
    for (const forbidden of ['secrets', 'linksynergy', 'rakuten', 'process.env.RAKUTEN']) {
      expect(script.toLowerCase().includes(forbidden.toLowerCase()), forbidden).toBe(false);
    }
  });
});
