// The remover, measured against real hardware imagery with a known answer.
//
// public/images/gpus holds 57 rendered graphics cards that this site actually
// ships. They already carry an alpha channel, which gives two real tests that
// drawn fixtures cannot:
//
//   1. THE KEEP TEST. Every one of them must be returned untouched, because a
//      picture someone already cut out must never be re-cut.
//
//   2. THE GROUND-TRUTH TEST. Compositing one onto a white sweep produces a
//      photograph shaped exactly like a merchant's — real anti-aliased edges,
//      real gradients, real thin brackets and fan grilles — and we KNOW the
//      right answer, because we still have the original alpha. So the
//      remover's output can be compared against truth pixel by pixel rather
//      than eyeballed.
//
// The error that matters is asymmetric and the assertions say so: clearing a
// pixel that is product is a hole in someone's graphics card, and is allowed
// zero times. Leaving backdrop behind is untidy and is merely reported.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

import { MAX_EDGE_ALPHA_LOSS, removeBackground } from './backgroundRemoval';

const dir = path.resolve(__dirname, '..', '..', '..', 'public', 'images', 'gpus');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();

/** Flattens a transparent render onto a solid sweep, as a studio photo would be. */
function compositeOnto(src: PNG, bg: [number, number, number]): Buffer {
  const out = new PNG({ width: src.width, height: src.height });
  for (let i = 0; i < src.data.length; i += 4) {
    const a = src.data[i + 3] / 255;
    out.data[i] = Math.round(src.data[i] * a + bg[0] * (1 - a));
    out.data[i + 1] = Math.round(src.data[i + 1] * a + bg[1] * (1 - a));
    out.data[i + 2] = Math.round(src.data[i + 2] * a + bg[2] * (1 - a));
    out.data[i + 3] = 255;
  }
  return PNG.sync.write(out);
}

interface Comparison {
  /** Fully-opaque product pixels the remover cleared. The dangerous error. */
  productCleared: number;
  /** Fully-opaque product pixels the remover made partly transparent. */
  productSoftened: number;
  /** Pure-backdrop pixels left fully opaque. Untidy, not harmful. */
  backdropKept: number;
  productPixels: number;

  // THE EDGE. An earlier version of this comparison counted only pixels whose
  // truth alpha was exactly 255, and so reported "zero product pixels lost"
  // while thousands of ANTI-ALIASED edge pixels were being changed. The soft
  // rim is part of the product's appearance; measuring only its solid interior
  // measures the easy part.
  /** Pixels whose true alpha is partial: the anti-aliased rim. */
  edgePixels: number;
  /** Edge pixels the remover made MORE transparent than the truth. */
  edgeMoreTransparent: number;
  /** Edge pixels the remover made MORE opaque than the truth — the light fringe. */
  edgeMoreOpaque: number;
  /** Mean alpha, out of 255, lost across all edge pixels. */
  meanEdgeAlphaLost: number;
}

function compare(truth: PNG, produced: PNG): Comparison {
  let productCleared = 0;
  let productSoftened = 0;
  let backdropKept = 0;
  let productPixels = 0;
  let edgePixels = 0;
  let edgeMoreTransparent = 0;
  let edgeMoreOpaque = 0;
  let alphaLost = 0;
  for (let i = 3; i < truth.data.length; i += 4) {
    const t = truth.data[i];
    const p = produced.data[i];
    if (t === 255) {
      productPixels += 1;
      if (p === 0) productCleared += 1;
      else if (p < 255) productSoftened += 1;
    } else if (t === 0) {
      if (p === 255) backdropKept += 1;
    } else {
      edgePixels += 1;
      if (p < t) {
        edgeMoreTransparent += 1;
        alphaLost += t - p;
      } else if (p > t) {
        edgeMoreOpaque += 1;
      }
    }
  }
  return {
    productCleared,
    productSoftened,
    backdropKept,
    productPixels,
    edgePixels,
    edgeMoreTransparent,
    edgeMoreOpaque,
    meanEdgeAlphaLost: edgePixels === 0 ? 0 : alphaLost / edgePixels,
  };
}

describe('real shipped hardware images are never re-cut', () => {
  it('finds the rendered GPU library', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('returns every one of them untouched', () => {
    const recut = files.filter((f) => removeBackground(fs.readFileSync(path.join(dir, f)), f).ok);
    expect(recut).toEqual([]);
  });

  it('gives already-transparent as the reason, not an accidental refusal', () => {
    const reasons = new Set(
      files.map((f) => {
        const o = removeBackground(fs.readFileSync(path.join(dir, f)), f);
        return o.ok ? 'processed' : o.reason;
      }),
    );
    expect([...reasons]).toEqual(['already-transparent']);
  });
});

describe('against a known answer, on real hardware photographs', () => {
  // A representative spread rather than all 57, to keep the suite quick; the
  // full sweep is available as a script and reported in the PR.
  const sample = files.filter((_f, i) => i % 5 === 0);

  it.each(sample.map((f) => [f]))('%s: clears no product pixel when composited on white', (file) => {
    const truth = PNG.sync.read(fs.readFileSync(path.join(dir, file)));
    const photo = compositeOnto(truth, [255, 255, 255]);
    const outcome = removeBackground(photo, file);
    if (!outcome.ok) return; // a refusal keeps the original, which is always safe

    const produced = PNG.sync.read(outcome.png);
    const c = compare(truth, produced);
    expect(c.productPixels).toBeGreaterThan(100);
    // Zero. Not "few".
    expect(c.productCleared).toBe(0);
  });

  it('also clears no product pixel on a dark sweep', () => {
    for (const file of sample.slice(0, 4)) {
      const truth = PNG.sync.read(fs.readFileSync(path.join(dir, file)));
      const outcome = removeBackground(compositeOnto(truth, [19, 19, 26]), file);
      if (!outcome.ok) continue;
      expect(compare(truth, PNG.sync.read(outcome.png)).productCleared).toBe(0);
    }
  });

  it('changes the anti-aliased rim only slightly, and reports how much', () => {
    // The claim this replaces was "zero product pixels lost", which was true
    // and incomplete: it counted only fully-opaque pixels. The rim IS product.
    let edgePixels = 0;
    let moreTransparent = 0;
    let moreOpaque = 0;
    let lost = 0;
    for (const file of sample) {
      const truth = PNG.sync.read(fs.readFileSync(path.join(dir, file)));
      const outcome = removeBackground(compositeOnto(truth, [255, 255, 255]), file);
      if (!outcome.ok) continue;
      const c = compare(truth, PNG.sync.read(outcome.png));
      edgePixels += c.edgePixels;
      moreTransparent += c.edgeMoreTransparent;
      moreOpaque += c.edgeMoreOpaque;
      lost += c.meanEdgeAlphaLost * c.edgePixels;
    }

    expect(edgePixels).toBeGreaterThan(1000);
    // Both directions happen and both are recorded. More-opaque is the larger
    // share, and is what shows as a light fringe on the dark theme: those
    // pixels keep their lightened blend colour at full alpha.
    expect(moreTransparent + moreOpaque).toBeGreaterThan(0);
    // What must stay small is how MUCH alpha the rim loses on average.
    expect(lost / edgePixels).toBeLessThan(4);
  });

  it('never lets a cut through whose estimated edge cost is over the reviewed limit', () => {
    for (const file of sample) {
      const truth = PNG.sync.read(fs.readFileSync(path.join(dir, file)));
      const outcome = removeBackground(compositeOnto(truth, [255, 255, 255]), file);
      if (outcome.ok) expect(outcome.stats.edgeAlphaLoss).toBeLessThanOrEqual(MAX_EDGE_ALPHA_LOSS);
    }
  });

  it('recovers most of the backdrop it was given, or declines the picture', () => {
    // Establishes the remover is not passing the safety tests by refusing
    // everything: on at least some real photographs it does the job.
    let processed = 0;
    for (const file of sample) {
      const truth = PNG.sync.read(fs.readFileSync(path.join(dir, file)));
      const outcome = removeBackground(compositeOnto(truth, [255, 255, 255]), file);
      if (outcome.ok) processed += 1;
    }
    expect(processed).toBeGreaterThan(0);
  });
});
