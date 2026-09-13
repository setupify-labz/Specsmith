// The promises this pipeline makes to the catalogue and to the page.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';

import { processOne, summarise, type Manifest } from './processProductImages';
import * as fx from './testFixtures';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'imgbatch-'));
const app = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(app, p), 'utf8');

describe('a refusal writes nothing and keeps the merchant original', () => {
  it.each([
    ['a white case on a white sweep', fx.whiteCaseOnWhite],
    ['a bright metal rim', fx.brightMetalEdge],
    ['a gradient lifestyle backdrop', fx.gradientBackdrop],
    ['an already-transparent photograph', fx.alreadyTransparent],
  ])('writes no file for %s', (_label, make) => {
    const dir = tmp();
    const entry = processOne(
      { partId: 'p', category: 'gpu', sourceUrl: 'https://example.test/p.png', bytes: make() },
      dir,
      '2026-09-09',
    );
    expect(entry.outcome).toBe('kept-original');
    expect(entry.processedPath).toBeUndefined();
    expect(entry.reason).toBeTruthy();
    expect(entry.detail).toBeTruthy();
    // Nothing was written: the card keeps pointing at the merchant's own URL.
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([]);
  });

  it('records the source hash even when it refuses, so the run is reproducible', () => {
    const entry = processOne(
      { partId: 'p', category: 'gpu', sourceUrl: 'https://example.test/p.png', bytes: fx.whiteCaseOnWhite() },
      tmp(),
      '2026-09-09',
    );
    expect(entry.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.sourceBytes).toBeGreaterThan(0);
  });
});

describe('a success is stored on our own origin, never hotlinked back', () => {
  it('writes a local file named by the OUTPUT hash and records both hashes', () => {
    const dir = tmp();
    const entry = processOne(
      { partId: 'p', category: 'gpu', sourceUrl: 'https://c1.neweggimages.test/a.png', bytes: fx.darkGpuOnWhite() },
      dir,
      '2026-09-09',
    );
    expect(entry.outcome).toBe('processed');
    // Named after what the file CONTAINS. A changed algorithm re-cutting the
    // same photograph must produce a new URL, or a CDN holding the old cut-out
    // would keep serving it.
    expect(entry.processedSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.processedPath).toBe(`/images/products/${entry.processedSha256}.png`);
    expect(entry.processedPath).not.toContain(entry.sourceSha256);
    expect(fs.readdirSync(dir)).toEqual([`${entry.processedSha256}.png`]);

    // The stored path is same-origin: no merchant host survives into it.
    expect(entry.processedPath).not.toContain('neweggimages');
    expect(entry.processedPath!.startsWith('/images/')).toBe(true);
  });

  it('stores a file that really carries transparency', () => {
    const dir = tmp();
    const entry = processOne(
      { partId: 'p', category: 'gpu', sourceUrl: 'https://example.test/a.png', bytes: fx.darkGpuOnWhite() },
      dir,
      '2026-09-09',
    );
    const png = PNG.sync.read(fs.readFileSync(path.join(dir, `${entry.processedSha256}.png`)));
    expect(png.data[3]).toBe(0);
  });
});

describe('the pipeline never edits catalogue data', () => {
  it('contains no write to retail-parts.json or to price, availability, link or mapping fields', () => {
    for (const file of ['processProductImages.ts', 'run-image-batch.ts', 'backgroundRemoval.ts']) {
      const src = read(path.join('scripts', 'retail', 'images', file));
      expect(src).not.toMatch(/writeFileSync\([^)]*retail-parts/);
      expect(src).not.toMatch(/\b(retailPrice|salePrice|availability|trackedAffiliateUrl|canonicalPartId|specsVerified)\s*[:=]/);
    }
  });
});

describe('the summary tells a reviewer what actually happened', () => {
  it('counts refusals by reason rather than reporting a bare success rate', () => {
    const manifest: Manifest = {
      generatedAt: '2026-09-09',
      source: 'fixtures',
      entries: [
        { partId: 'a', category: 'gpu', sourceUrl: 'x', sourceSha256: 'h', sourceBytes: 10, outcome: 'processed', processedBytes: 12, observedAt: '2026-09-09' },
        { partId: 'b', category: 'case', sourceUrl: 'x', sourceSha256: 'h', sourceBytes: 10, outcome: 'kept-original', reason: 'boundary-uncertain', observedAt: '2026-09-09' },
      ],
    };
    const text = summarise(manifest);
    expect(text).toContain('processed: 1');
    expect(text).toContain('kept original: 1');
    expect(text).toContain('boundary-uncertain: 1');
  });
});

describe('the colour a cut-out is composited against is pinned', () => {
  it('is its own token, exactly #13131A in dark and #FFFFFF in light', () => {
    const css = read(path.join('src', 'index.css'));
    const dark = css.slice(css.indexOf(':root'), css.indexOf('[data-theme="light"]'));
    const light = css.slice(css.indexOf('[data-theme="light"]'));
    expect(dark).toMatch(/--ff-photo-bg:\s*#13131A/i);
    expect(light).toMatch(/--ff-photo-bg:\s*#FFFFFF/i);
  });

  it('is what every place a product is pictured actually uses', () => {
    // This used to require the inline style `background: 'var(--ff-photo-bg)'`
    // in the card. That style carried a note saying whichever of #107 and #108
    // landed second should move it onto a shared `.retail-photo-frame` class —
    // #108 landed second, and the drawer and the build summary now composite
    // against the same colour, which an inline style cannot express. The rule
    // is unchanged and now covers three files instead of one: the class owns
    // the colour, and no component sets it itself.
    const css = read(path.join('src', 'index.css'));
    const declarations = css.match(/\.retail-photo-frame\s*\{[^}]*\}/g) ?? [];
    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toContain('var(--ff-photo-bg)');

    for (const file of ['RetailProductCard.tsx', 'ProductDetailDrawer.tsx', 'RetailBuildSummary.tsx']) {
      const source = read(path.join('src', 'components', 'builder', file));
      expect(source, file).toContain('retail-photo-frame');
      // Comment lines are stripped before the negative check: a file that
      // EXPLAINS the token in prose must neither satisfy nor fail this.
      const code = source
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');
      expect(code, `${file} sets the photo background inline`).not.toContain('--ff-photo-bg');
    }
  });
});
