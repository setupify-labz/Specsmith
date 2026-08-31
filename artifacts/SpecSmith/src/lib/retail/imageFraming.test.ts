import { describe, expect, it } from 'vitest';

import {
  CONTENT_TARGET_SPAN,
  MAX_ZOOM,
  MIN_TRUSTED_RATIO,
  WELL_FRAMED_RATIO,
  imageZoom,
  normalizedSpan,
} from './imageFraming';

describe('a well-framed photograph is left exactly as it is', () => {
  it('does not enlarge an image whose product already fills the frame', () => {
    expect(imageZoom(1)).toBe(1);
    expect(imageZoom(0.99)).toBe(1);
    expect(imageZoom(WELL_FRAMED_RATIO)).toBe(1);
  });

  it('never shrinks anything', () => {
    for (const ratio of [0.5, 0.6, 0.7, 0.8, 0.9, 0.92, 0.95, 1]) {
      expect(imageZoom(ratio), `ratio ${ratio}`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('a sparse photograph is enlarged until its product matches the others', () => {
  it('brings the product up to the target span', () => {
    // Half the frame is product: doubling would fill it exactly, and the
    // target stops just short of that on purpose.
    expect(normalizedSpan(0.6)).toBeCloseTo(CONTENT_TARGET_SPAN, 10);
    expect(normalizedSpan(0.75)).toBeCloseTo(CONTENT_TARGET_SPAN, 10);
    expect(normalizedSpan(0.9)).toBeCloseTo(CONTENT_TARGET_SPAN, 10);
  });

  it('narrows the gap between the two images that prompted this', () => {
    // A card photographed edge to edge beside one floating in white. Before,
    // one product was drawn 0.62 of the frame and the other 0.98 — a 36-point
    // gap. After, both land within a couple of points of each other.
    const before = Math.abs(0.98 - 0.62);
    const after = Math.abs((normalizedSpan(0.98) ?? 0) - (normalizedSpan(0.62) ?? 0));
    expect(before).toBeGreaterThan(0.3);
    expect(after).toBeLessThan(0.07);
  });
});

describe('the enlargement cannot crop the product', () => {
  it('leaves a margin rather than filling the frame edge to edge', () => {
    expect(CONTENT_TARGET_SPAN).toBeLessThan(1);
    for (const ratio of [0.52, 0.6, 0.7, 0.85, 0.91]) {
      const span = normalizedSpan(ratio);
      expect(span, `ratio ${ratio}`).not.toBeNull();
      // The product never reaches the frame's edge, so rounding in layout has
      // room to be wrong without taking a corner off a graphics card.
      expect(span as number, `ratio ${ratio}`).toBeLessThanOrEqual(CONTENT_TARGET_SPAN + 1e-9);
    }
  });

  it('caps how far a single image may be blown up', () => {
    expect(imageZoom(MIN_TRUSTED_RATIO)).toBeLessThanOrEqual(MAX_ZOOM);
    for (const ratio of [0.5, 0.51, 0.55]) {
      expect(imageZoom(ratio), `ratio ${ratio}`).toBeLessThanOrEqual(MAX_ZOOM);
    }
  });

  it('refuses to act on a ratio too small to be believable', () => {
    // A product measured at a tenth of its frame is likelier to be a
    // measurement that found a watermark than a real photograph.
    expect(imageZoom(MIN_TRUSTED_RATIO - 0.01)).toBe(1);
    expect(imageZoom(0.1)).toBe(1);
    expect(imageZoom(0.01)).toBe(1);
  });

  it('still normalizes the low-profile card that prompted this', () => {
    // Measured at 0.47 and previously skipped for sitting a hundredth under
    // the old 0.5 floor — while being drawn at half the size of the card
    // beside it, which is the whole complaint.
    expect(imageZoom(0.47)).toBeGreaterThan(1);
    expect(normalizedSpan(0.47) as number).toBeGreaterThan(0.7);
    // The cap still holds, so it is enlarged a long way short of filling the
    // frame rather than to the target.
    expect(imageZoom(0.47)).toBe(MAX_ZOOM);
    expect(normalizedSpan(0.47) as number).toBeLessThan(1);
  });
});

describe('an unmeasured image is framed exactly as it arrives', () => {
  it('treats null and nonsense as "do nothing"', () => {
    expect(imageZoom(null)).toBe(1);
    expect(imageZoom(0)).toBe(1);
    expect(imageZoom(-1)).toBe(1);
    expect(imageZoom(Number.NaN)).toBe(1);
    expect(imageZoom(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalizedSpan(null)).toBeNull();
    expect(normalizedSpan(0)).toBeNull();
  });
});
