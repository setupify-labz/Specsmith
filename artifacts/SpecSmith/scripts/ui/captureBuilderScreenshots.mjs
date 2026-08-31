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

const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 2 });
const report = { label: LABEL, productsMeasured: PRODUCTS_MEASURED, categories: {}, layout: {} };

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
    }
  }

  await page.close();
}

await context.close();
await browser.close();

if (MEASURE) {
  fs.writeFileSync(path.join(OUT_DIR, 'image-report.json'), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
