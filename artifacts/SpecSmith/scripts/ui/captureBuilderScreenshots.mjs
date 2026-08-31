// Drives a real browser over the built builder page and records what it looks
// like, plus how many product images actually loaded.
//
// WHY THIS EXISTS AS A COMMITTED SCRIPT RATHER THAN AN AD-HOC COMMAND
// ------------------------------------------------------------------
// The development sandbox cannot reach the Newegg image CDN, so every card
// there renders the placeholder. That is a property of the sandbox, not of the
// page, and a screenshot taken in it cannot tell the two apart. This script is
// run on a GitHub runner, where the CDN resolves, and it reports a number — the
// share of the first PRODUCTS_MEASURED cards in each category whose <img>
// actually decoded — so "the images work" is a measurement rather than an
// impression.
//
// IT TALKS TO NO CREDENTIAL AND NO FEED. It loads a locally served static
// build. The only third-party requests it makes are the image requests the
// page itself makes, exactly as a visitor's browser would.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(process.env.PLAYWRIGHT_REQUIRE_FROM ?? import.meta.url);
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:4319';
const OUT_DIR = process.env.OUT_DIR ?? 'screenshots';
const LABEL = process.env.LABEL ?? 'after';
const MEASURE = process.env.MEASURE === '1';

/** The batch the grid shows before "Load more" — the window the audit covers. */
const PRODUCTS_MEASURED = 24;

/** Widths the header is checked at — not only the three the screenshots use. */
const HEADER_WIDTHS = [768, 834, 900, 960, 1024, 1100, 1279, 1280, 1440];

/** Header widths that also get a screenshot, because they are the ones in review. */
const HEADER_SHOT_WIDTHS = [768, 834, 1024];

/**
 * A rendered product spanning less than this share of its card's image frame
 * looks small beside its neighbours, whatever the <img> element measures.
 */
const SMALL_PRODUCT_SPAN = 0.5;

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
];

const CATEGORIES = [
  'gpu',
  'cpu',
  'motherboard',
  'ram',
  'storage',
  'psu',
  'case',
  'cooler',
  'monitor',
  'keyboard',
  'mouse',
  'headset',
];

fs.mkdirSync(OUT_DIR, { recursive: true });

const shot = (page, name, options = {}) =>
  page.screenshot({ path: path.join(OUT_DIR, `${LABEL}-${name}.png`), ...options });

/** Clears the consent banner, which otherwise sits over the bottom of the grid. */
async function dismissBanner(page) {
  const decline = page.getByRole('button', { name: /decline/i });
  if (await decline.count()) {
    await decline.first().click();
    await page.waitForTimeout(300);
  }
}

async function open(context, viewport) {
  const page = await context.newPage();
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(`${BASE_URL}/builder`, { waitUntil: 'networkidle', timeout: 60_000 });
  await dismissBanner(page);
  await page.waitForTimeout(1500);
  return page;
}

/** True when the redesigned interface is on the page; false for the old accordion. */
const isRetailBuilder = (page) => page.locator('[data-testid="retail-builder"]').count().then((n) => n > 0);

/**
 * Waits until no <img> in the grid is still in flight, so a card counted as
 * failed has genuinely failed rather than merely not arrived yet.
 */
async function settleImages(page) {
  await page
    .waitForFunction(
      () => {
        // Cards first: right after a category change the old grid is gone and
        // the new one has not mounted, and "no images in flight" would be
        // trivially true of an empty page.
        const cards = document.querySelectorAll('[data-testid="retail-product-card"]');
        if (cards.length === 0) return false;
        // A card whose image failed swaps the <img> for the placeholder, so an
        // all-failed grid has no images left to wait for. That is a settled
        // state, not a reason to sit here until the timeout.
        const images = [...document.querySelectorAll('[data-testid="product-grid"] img')];
        return images.every((img) => img.complete);
      },
      undefined,
      { timeout: 20_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(500);
}

/**
 * Walks the header across a range of widths and reports anything that does not
 * fit.
 *
 * MEASURING FIT, NOT PRESENCE. The tablet header rendered every one of its
 * controls; two of them were simply unusable, because "Sign In" had wrapped
 * onto two lines and "Start Building" ran off the right edge. Both are
 * invisible to a check that asks whether an element exists, so this asks the
 * two questions that actually distinguish them: is the control's box inside
 * the window, and is it one line tall?
 */
async function measureHeaderFit(page) {
  const results = {};
  for (const width of HEADER_WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    results[width] = await page.evaluate(() => {
      const doc = document.documentElement;
      const nav = document.querySelector('nav');
      const controls = nav ? [...nav.querySelectorAll('a, button')] : [];
      let clipped = 0;
      let wrapped = 0;
      let visible = 0;
      for (const control of controls) {
        const box = control.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        visible += 1;
        if (box.right > window.innerWidth + 0.5 || box.left < -0.5) clipped += 1;
        // One line of a 14px control is about 20px; with padding a single-line
        // button lands near 36-40px. Past 48 it has wrapped.
        if (box.height > 48) wrapped += 1;
      }
      return {
        visibleControls: visible,
        clippedControls: clipped,
        wrappedControls: wrapped,
        horizontalOverflowPx: Math.max(0, doc.scrollWidth - doc.clientWidth),
      };
    });
  }
  return results;
}

/**
 * How large each product is actually drawn, as a share of its card's frame.
 *
 * WHY THE ELEMENT'S OWN DIMENSIONS ARE NOT ENOUGH. Two cards can hold two
 * <img> elements of identical size, both contained, neither stretched, and
 * still show one product at half the size of the other — because one of the
 * photographs is mostly empty margin. Every check on the element passes and
 * the grid still looks wrong. So this reads the PIXELS: it measures how much
 * of each raster the product occupies, then multiplies by how large that
 * raster is drawn, which is the size a person actually sees.
 *
 * The bytes are fetched through Playwright rather than by the page, so no
 * cross-origin canvas restriction applies and no CORS header is needed from
 * the retailer.
 */
async function measureRenderedProductSpans(page, context) {
  const cards = await page.evaluate((limit) => {
    return [...document.querySelectorAll('[data-testid="retail-product-card"]')]
      .slice(0, limit)
      .flatMap((card) => {
        const img = card.querySelector('img');
        if (!img || !img.complete || img.naturalWidth <= 1) return [];
        const frame = img.parentElement.getBoundingClientRect();
        const box = img.getBoundingClientRect();
        if (frame.width === 0 || frame.height === 0) return [];
        return [{ src: img.currentSrc || img.src, drawn: Math.max(box.width / frame.width, box.height / frame.height) }];
      });
  }, PRODUCTS_MEASURED);

  const spans = [];
  for (const card of cards) {
    const ratio = await contentRatioOf(page, context, card.src);
    if (ratio === null) continue;
    spans.push({ contentRatio: ratio, renderedSpan: Math.min(1, ratio * card.drawn) });
  }
  return spans;
}

/** Cache: the same photograph shows up in more than one screenshot pass. */
const contentRatioCache = new Map();

async function contentRatioOf(page, context, url) {
  if (contentRatioCache.has(url)) return contentRatioCache.get(url);
  let ratio = null;
  try {
    const response = await context.request.get(url, { timeout: 20_000 });
    if (response.ok()) {
      const body = await response.body();
      // A real MIME type, taken from the response: `image/*` is a match
      // pattern, not a media type, and a browser is right to refuse it.
      const declared = (response.headers()['content-type'] ?? '').split(';')[0].trim();
      const mime = declared.startsWith('image/') ? declared : 'image/jpeg';
      const dataUrl = `data:${mime};base64,${body.toString('base64')}`;
      ratio = await page.evaluate(async (source) => {
        const image = new Image();
        image.src = source;
        try {
          await image.decode();
        } catch {
          return null;
        }
        const width = Math.min(240, image.naturalWidth);
        const height = Math.min(240, image.naturalHeight);
        if (width < 8 || height < 8) return null;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, width, height);
        const { data } = ctx.getImageData(0, 0, width, height);
        const at = (x, y) => {
          const i = (y * width + x) * 4;
          return [data[i], data[i + 1], data[i + 2], data[i + 3]];
        };
        // Same rule the catalogue build uses: the background is whatever the
        // corners agree on, and anything else is the product.
        const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)].filter((c) => c[3] > 16);
        const bg = corners.length
          ? [0, 1, 2].map((c) => Math.round(corners.reduce((sum, corner) => sum + corner[c], 0) / corners.length))
          : null;
        if (bg && corners.some((c) => [0, 1, 2].some((i) => Math.abs(c[i] - bg[i]) > 18))) return 1;
        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const [r, g, b, a] = at(x, y);
            if (a <= 16) continue;
            if (bg && Math.abs(r - bg[0]) <= 18 && Math.abs(g - bg[1]) <= 18 && Math.abs(b - bg[2]) <= 18) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        if (maxX < minX) return 1;
        return Math.min(1, Math.max((maxX - minX + 1) / width, (maxY - minY + 1) / height));
      }, dataUrl);
    }
  } catch {
    ratio = null;
  }
  contentRatioCache.set(url, ratio);
  return ratio;
}

/**
 * Brings the first `PRODUCTS_MEASURED` cards through the viewport.
 *
 * The cards use `loading="lazy"`, which is right for a shopper and wrong for a
 * census: an image below the fold is never requested, and counting it as
 * "failed" would measure the scroll position rather than the CDN. Walking the
 * page down to the last measured card and back gives every one of them the
 * chance a scrolling visitor would give it.
 */
async function revealCards(page) {
  await page.evaluate(async (limit) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const cards = [...document.querySelectorAll('[data-testid="retail-product-card"]')].slice(0, limit);
    for (const card of cards) {
      card.scrollIntoView({ block: 'center' });
      await sleep(60);
    }
    window.scrollTo(0, 0);
    await sleep(120);
  }, PRODUCTS_MEASURED);
  await settleImages(page);
}

/**
 * For the first `PRODUCTS_MEASURED` cards: did the image decode, and is it
 * laid out inside its box at a sensible size?
 *
 * `naturalWidth > 1` is the decode test — a broken or blocked image reports 0,
 * and a 1x1 tracking pixel is not a product photo either. Containment is read
 * from the rendered geometry rather than from the class list, because a class
 * that is present but overridden still stretches the picture.
 */
async function measureCategory(page) {
  return page.evaluate((limit) => {
    const cards = [...document.querySelectorAll('[data-testid="retail-product-card"]')].slice(0, limit);
    let loaded = 0;
    let placeholders = 0;
    let collapsed = 0;
    let stretched = 0;
    let tiny = 0;
    for (const card of cards) {
      const cardBox = card.getBoundingClientRect();
      if (cardBox.height < 80) collapsed += 1;
      const img = card.querySelector('img');
      const placeholder = card.querySelector('[data-testid="image-placeholder"]');
      if (placeholder) placeholders += 1;
      if (!img) continue;
      if (!img.complete || img.naturalWidth <= 1) continue;
      loaded += 1;
      const box = img.getBoundingClientRect();
      if (box.width < 40 || box.height < 40) tiny += 1;
      // object-fit: contain means the painted aspect ratio must match the
      // source's. Anything else is a stretch.
      const source = img.naturalWidth / img.naturalHeight;
      const painted = box.width / box.height;
      const fit = getComputedStyle(img).objectFit;
      if (fit !== 'contain' && Math.abs(source - painted) / source > 0.02) stretched += 1;
    }
    return { cards: cards.length, loaded, placeholders, collapsed, stretched, tiny };
  }, PRODUCTS_MEASURED);
}

/** The page must not scroll sideways, and the catalogue must not scroll on its own. */
async function measureLayout(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const nested = [...document.querySelectorAll('[data-testid="product-grid"], [data-testid="product-grid"] *')].filter(
      (element) => {
        const overflow = getComputedStyle(element).overflowY;
        return (overflow === 'auto' || overflow === 'scroll') && element.scrollHeight > element.clientHeight + 1;
      },
    ).length;
    return {
      horizontalOverflowPx: Math.max(0, doc.scrollWidth - doc.clientWidth),
      nestedCatalogScrollers: nested,
    };
  });
}

/**
 * Photographs the filled accent controls in both themes, and measures the
 * contrast a person actually gets.
 *
 * WHY MEASURED IN THE BROWSER. The tokens can be checked arithmetically — and
 * are, in accentContrast.test.ts — but that proves a pairing, not a rendering.
 * Here the computed styles are read off the live controls after the cascade
 * has resolved every variable, so a control that inherits some other colour is
 * caught even though the token it names is fine.
 */
async function captureAccentControls(context, report) {
  const results = {};
  for (const theme of ['dark', 'light']) {
    const page = await open(context, { width: 390, height: 844 });
    if (theme === 'light') {
      await page.getByRole('button', { name: /toggle theme/i }).first().click();
      await page.waitForTimeout(600);
    }
    await settleImages(page);

    // Two products chosen, so "View build (2)" and a selected card both exist.
    await page.locator('[data-testid="add-to-build"]:visible').first().click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="category-chip-cpu"]:visible').first().click();
    await page.waitForTimeout(700);
    await settleImages(page);
    await page.locator('[data-testid="add-to-build"]:visible').first().click();
    await page.waitForTimeout(400);

    const shots = [
      ['view-build', '[data-testid="view-build"]'],
      ['in-build', '[data-testid="retail-product-card"][data-selected="true"]'],
      ['active-chip', '[data-testid="category-chip-cpu"]'],
    ];
    for (const [name, selector] of shots) {
      const element = page.locator(selector).first();
      await element.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(200);
      await element.screenshot({ path: path.join(OUT_DIR, `${LABEL}-${theme}-${name}.png`) }).catch(() => {});
    }

    // The whole phone screen with products chosen and the button at rest, so
    // the button's contrast can be judged against what surrounds it.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3));
    await page.waitForTimeout(400);
    await shot(page, `${theme}-mobile-with-selection`);

    results[theme] = await page.evaluate(() => {
      const parse = (value) => {
        const nums = (value.match(/[\d.]+/g) ?? []).map(Number);
        return nums.length >= 3 ? nums.slice(0, 3) : null;
      };
      const luminance = (rgb) => {
        const [r, g, b] = rgb.map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (fg, bg) => {
        const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
        return (hi + 0.05) / (lo + 0.05);
      };
      const measure = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const style = getComputedStyle(element);
        const fg = parse(style.color);
        const bg = parse(style.backgroundColor);
        if (!fg || !bg) return null;
        return { color: style.color, background: style.backgroundColor, contrast: Number(ratio(fg, bg).toFixed(2)) };
      };
      return {
        viewBuild: measure('[data-testid="view-build"]'),
        inBuild: measure('[data-testid="retail-product-card"][data-selected="true"] [data-testid="add-to-build"]'),
        activeChip: measure('[data-testid="category-chip-cpu"]'),
      };
    });

    await page.close();
  }
  report.accentControls = results;
}

const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 2 });
const report = {
  label: LABEL,
  productsMeasured: PRODUCTS_MEASURED,
  categories: {},
  layout: {},
  header: {},
  productSpans: {},
};

for (const viewport of VIEWPORTS) {
  const page = await open(context, viewport);
  const redesigned = await isRetailBuilder(page);

  if (!redesigned) {
    // The old accordion. There is no rail, no grid and no summary panel to
    // frame, so the honest "before" is the page as it stood.
    await shot(page, `${viewport.name}-grid`, { fullPage: false });
    await shot(page, `${viewport.name}-page`, { fullPage: true });
    await page.close();
    continue;
  }

  await settleImages(page);
  report.layout[viewport.name] = await measureLayout(page);

  await shot(page, `${viewport.name}-grid`);

  if (viewport.name === 'desktop') {
    await page.locator('[data-testid="category-rail"]').screenshot({
      path: path.join(OUT_DIR, `${LABEL}-desktop-category-nav.png`),
    });
    await page.locator('[data-testid="retail-product-card"]').first().screenshot({
      path: path.join(OUT_DIR, `${LABEL}-desktop-card-closeup.png`),
    });
  }

  if (viewport.name === 'mobile') {
    await page.locator('[data-testid="category-chips"]').screenshot({
      path: path.join(OUT_DIR, `${LABEL}-mobile-category-controls.png`),
    });
    // One whole card: image, title, price and BOTH actions in a single frame,
    // which is the thing the taller image frame used to make impossible.
    await page.locator('[data-testid="retail-product-card"]').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="retail-product-card"]').first().screenshot({
      path: path.join(OUT_DIR, `${LABEL}-mobile-card-complete.png`),
    });
    report.mobileCard = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="retail-product-card"]');
      const frame = card.querySelector('img')?.parentElement ?? card.querySelector('[data-testid="image-placeholder"]')?.parentElement;
      return {
        cardHeightPx: Math.round(card.getBoundingClientRect().height),
        imageFrameHeightPx: frame ? Math.round(frame.getBoundingClientRect().height) : null,
        fitsInViewport: card.getBoundingClientRect().height <= window.innerHeight,
      };
    });
  }

  // Build something, so "selected exact SKU" and the summary have content.
  await page.locator('[data-testid="add-to-build"]:visible').first().click();
  await page.waitForTimeout(400);
  // The rail and the chip row are both in the DOM at every width; only one is
  // displayed. Filtering to the visible one keeps this working at all three.
  const cpu = page
    .locator('[data-testid="category-rail-cpu"]:visible, [data-testid="category-chip-cpu"]:visible')
    .first();
  if (await cpu.count()) {
    await cpu.click();
    await page.waitForTimeout(800);
    await settleImages(page);
    await page.locator('[data-testid="add-to-build"]:visible').first().click();
    await page.waitForTimeout(400);
  }
  await shot(page, `${viewport.name}-selected`);

  if (viewport.name === 'desktop') {
    await page.locator('[data-testid="build-summary"]').first().screenshot({
      path: path.join(OUT_DIR, `${LABEL}-desktop-summary-closeup.png`),
    });
  }

  if (viewport.name === 'mobile') {
    // The sticky button in its resting, closed state with products chosen —
    // the view in which its contrast is judged.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3));
    await page.waitForTimeout(400);
    await shot(page, 'mobile-view-build-closed');
    await page.locator('[data-testid="view-build"]').screenshot({
      path: path.join(OUT_DIR, `${LABEL}-mobile-view-build-button.png`),
    });

    await page.locator('[data-testid="view-build"]').click();
    await page.waitForTimeout(600);
    await shot(page, 'mobile-build-summary');
  }

  if (MEASURE && viewport.name === 'desktop') {
    for (const category of CATEGORIES) {
      const rail = page.locator(`[data-testid="category-rail-${category}"]`);
      if ((await rail.count()) === 0) continue;
      await rail.click();
      await page.waitForTimeout(700);
      await settleImages(page);
      await revealCards(page);
      report.categories[category] = await measureCategory(page);
      const spans = await measureRenderedProductSpans(page, context);
      const sorted = spans.map((entry) => entry.renderedSpan).sort((a, b) => a - b);
      report.productSpans[category] = {
        measured: sorted.length,
        // How small the smallest products are drawn, and how far apart the
        // smallest and largest end up: the two numbers that describe "one of
        // these looks half the size of the other".
        min: sorted[0] ?? null,
        median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
        max: sorted[sorted.length - 1] ?? null,
        spread: sorted.length ? sorted[sorted.length - 1] - sorted[0] : null,
        smallProducts: sorted.filter((span) => span < SMALL_PRODUCT_SPAN).length,
        heavilyPadded: spans.filter((entry) => entry.contentRatio < 0.7).length,
      };
    }
  }

  await page.close();
}

// The filled accent controls, in both themes.
if (LABEL === 'after') await captureAccentControls(context, report);

// The header, across a range of widths rather than the three the screenshots
// happen to use — the tablet defect lived between two of them.
{
  const page = await open(context, { width: 1440, height: 900 });
  report.header = await measureHeaderFit(page);
  for (const width of HEADER_SHOT_WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('nav').first().screenshot({ path: path.join(OUT_DIR, `${LABEL}-header-${width}.png`) });
  }
  await page.close();
}

await context.close();
await browser.close();

if (MEASURE) {
  fs.writeFileSync(path.join(OUT_DIR, 'image-report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
