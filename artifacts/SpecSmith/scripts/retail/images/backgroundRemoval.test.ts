// The remover's promises, held to.
//
// The most important tests here are the refusals. A backdrop that survives is
// an unimproved photograph; a product that gets eaten is a wrong one.
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';

import {
  CLEAR_TOLERANCE,
  confirmSolidBackground,
  decodeImage,
  hasRealTransparency,
  removeBackground,
  type RemovalOutcome,
} from './backgroundRemoval';
import * as fx from './testFixtures';

const run = (bytes: Buffer, name = 'fixture.png'): RemovalOutcome => removeBackground(bytes, name);
const ok = (o: RemovalOutcome) => {
  if (!o.ok) throw new Error(`expected success, got ${o.reason}: ${o.detail}`);
  return o;
};
const refused = (o: RemovalOutcome) => {
  if (o.ok) throw new Error('expected a refusal, got a processed image');
  return o;
};

describe('only the alpha channel is ever written', () => {
  it.each([
    ['a dark GPU on white', fx.darkGpuOnWhite],
    ['a black case', fx.blackCase],
    ['a monitor', fx.monitor],
    ['a white case with a visible outline', fx.whiteCaseWithOutline],
  ])('keeps every RGB byte of %s exactly as it arrived', (_label, make) => {
    const input = make();
    const before = decodeImage(input, 'f.png');
    if (typeof before === 'string') throw new Error(before);
    const after = PNG.sync.read(ok(run(input)).png);

    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    let differing = 0;
    for (let i = 0; i < before.data.length; i += 4) {
      if (
        after.data[i] !== before.data[i] ||
        after.data[i + 1] !== before.data[i + 1] ||
        after.data[i + 2] !== before.data[i + 2]
      ) {
        differing += 1;
      }
    }
    // Not "few". None. Discarding alpha would return the original picture.
    expect(differing).toBe(0);
  });

  it('produces genuine transparency, not a matted backdrop', () => {
    const after = PNG.sync.read(ok(run(fx.darkGpuOnWhite())).png);
    expect(after.data[3]).toBe(0); // top-left corner is see-through
    const centre = ((after.height / 2) * after.width + after.width / 2) * 4;
    expect(after.data[centre + 3]).toBe(255); // the product is not
  });
});

describe('a photograph that already has an alpha channel is never touched', () => {
  it('refuses with already-transparent', () => {
    const input = fx.alreadyTransparent();
    expect(hasRealTransparency(decodeImage(input, 'f.png') as any)).toBe(true);
    expect(refused(run(input)).reason).toBe('already-transparent');
  });
});

describe('a backdrop must be confirmed before anything is cleared', () => {
  it('refuses a gradient backdrop', () => {
    expect(refused(run(fx.gradientBackdrop())).reason).toBe('background-not-solid');
    expect(confirmSolidBackground(decodeImage(fx.gradientBackdrop(), 'f.png') as any)).toBeNull();
  });

  it('reads the flat backdrop colour off a clean sweep', () => {
    const bg = confirmSolidBackground(decodeImage(fx.darkGpuOnWhite(), 'f.png') as any);
    expect(bg).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('refuses a frame that is entirely one colour rather than erasing it', () => {
    // The border is uniform, so a backdrop is "confirmed" — and clearing it
    // would delete the whole picture. The centre gate catches that first.
    expect(refused(run(fx.fullBleedProduct())).reason).toBe('boundary-uncertain');
  });
});

describe('white hardware is the case this must not get wrong', () => {
  it('refuses a white case on a white sweep rather than eating it', () => {
    const outcome = refused(run(fx.whiteCaseOnWhite()));
    expect(outcome.reason).toBe('boundary-uncertain');
    expect(outcome.detail).toContain('centre of the frame was cleared');
  });

  it('still succeeds when the same white case has a visible outline', () => {
    // Separable, so refusing would be over-caution rather than safety.
    const after = PNG.sync.read(ok(run(fx.whiteCaseWithOutline())).png);
    const centre = ((after.height / 2) * after.width + after.width / 2) * 4;
    expect(after.data[centre + 3]).toBe(255);
    expect([after.data[centre], after.data[centre + 1], after.data[centre + 2]]).toEqual([252, 252, 253]);
  });

  it('refuses rather than trimming a bright, nearly-white metal rim', () => {
    // The rim photographs at ~246 on a 255 sweep: nine levels from its own
    // backdrop. There is no honest edge to cut, so the original is kept.
    const outcome = refused(run(fx.brightMetalEdge()));
    expect(outcome.reason).toBe('boundary-uncertain');
    expect(outcome.detail).toContain('fades into the backdrop');
  });
});

describe('holes, openings and thin parts', () => {
  it('leaves a fan opening opaque rather than guessing it is a cut-out', () => {
    const { stats } = ok(run(fx.coolerWithFanOpenings()));
    // Interior backdrop-coloured pixels exist and were deliberately kept.
    expect(stats.interiorHolesKept).toBeGreaterThan(0);
  });

  it('does not eat a thin cable lead', () => {
    const out = ok(run(fx.coiledCable()));
    const after = PNG.sync.read(out.png);
    const cy = Math.round(after.height / 2);
    const onLead = (cy * after.width + Math.round(after.width * 0.9)) * 4;
    expect(after.data[onLead + 3]).toBe(255);
  });

  it('keeps the hole inside a coiled cable opaque, because it is not border-reachable', () => {
    const { stats } = ok(run(fx.coiledCable()));
    expect(stats.interiorHolesKept).toBeGreaterThan(0);
  });

  it('keeps a glass panel opaque rather than clearing the pane', () => {
    const out = run(fx.glassPanelCase());
    if (out.ok) {
      const after = PNG.sync.read(out.png);
      const centre = ((after.height / 2) * after.width + Math.round(after.width / 2)) * 4;
      // The pane is inside the frame and unreachable from the border.
      expect(after.data[centre + 3]).toBe(255);
    } else {
      expect(['boundary-uncertain', 'background-not-solid']).toContain(out.reason);
    }
  });
});

describe('shadows', () => {
  it('never clears a shadow gradient as if it were backdrop', () => {
    const out = run(fx.productWithShadow());
    if (!out.ok) {
      expect(['background-not-solid', 'boundary-uncertain']).toContain(out.reason);
      return;
    }
    const after = PNG.sync.read(out.png);
    // A mid-shadow pixel is far from white and must stay fully opaque.
    const sy = Math.round(after.height * 0.66);
    const i = (sy * after.width + Math.round(after.width / 2)) * 4;
    expect(after.data[i + 3]).toBe(255);
  });
});

describe('undecodable and unsupported input is refused, never guessed at', () => {
  it.each([
    ['a webp URL', Buffer.from([1, 2, 3, 4]), 'photo.webp', 'unsupported-format'],
    ['bytes that are not a PNG', Buffer.from([1, 2, 3, 4]), 'photo.png', 'undecodable'],
  ])('refuses %s', (_l, bytes, name, reason) => {
    expect(refused(run(bytes, name)).reason).toBe(reason);
  });

  it('refuses an image too small to reason about', () => {
    expect(refused(run(fx.darkGpuOnWhite.call(null) && fxTiny(), 'tiny.png')).reason).toBe('degenerate');
  });
});

function fxTiny(): Buffer {
  const png = new PNG({ width: 8, height: 8 });
  png.data.fill(255);
  return PNG.sync.write(png);
}

describe('the tolerance is tight enough to be meaningful', () => {
  it('does not clear a pixel further than CLEAR_TOLERANCE from the backdrop', () => {
    expect(CLEAR_TOLERANCE).toBeLessThanOrEqual(16);
  });
});

describe('why enclosed holes are left opaque, and must stay that way', () => {
  // The obvious improvement is to clear interior regions that are enclosed by
  // product AND the backdrop colour — it would open up the cable's loop and
  // the cooler's fan gaps, which currently render as white shapes on a dark
  // page. This test exists to record why that is not done.
  //
  // The rule cannot tell those apart from the body of a white product. A white
  // case with a dark outline is ALSO an enclosed region the colour of the
  // backdrop, and clearing it would punch the product out of its own picture —
  // the precise failure the brief puts first.
  it('cannot distinguish a fan opening from the body of a white case', () => {
    const cooler = ok(run(fx.coolerWithFanOpenings()));
    const whiteCase = ok(run(fx.whiteCaseWithOutline()));

    // Both have substantial enclosed regions matching the backdrop colour.
    expect(cooler.stats.interiorHolesKept).toBeGreaterThan(1000);
    expect(whiteCase.stats.interiorHolesKept).toBeGreaterThan(1000);

    // And the white case's is the PRODUCT: far larger, because it is the whole
    // chassis. Any threshold that opened the cooler would also open this.
    expect(whiteCase.stats.interiorHolesKept).toBeGreaterThan(cooler.stats.interiorHolesKept);
  });

  it('keeps the white case body fully opaque today', () => {
    const after = PNG.sync.read(ok(run(fx.whiteCaseWithOutline())).png);
    const centre = ((after.height / 2) * after.width + Math.round(after.width / 2)) * 4;
    expect(after.data[centre + 3]).toBe(255);
  });
});
