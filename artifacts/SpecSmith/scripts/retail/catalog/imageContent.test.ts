import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';

import { attachImageContentRatios } from './affiliateCatalog';
import { MAX_IMAGE_BYTES, measureContentRatio, measureImageAtUrl, type ImageMeasurement } from './imageContent';
import type { AffiliatePart } from '../../../src/lib/retail/partCatalog';

/**
 * Builds a raster: a solid background with an opaque block centred in it.
 *
 * `span` is the block's share of the frame, which is exactly what the
 * measurement is supposed to recover.
 */
function framed(options: {
  size?: number;
  span: number;
  background?: [number, number, number, number];
  block?: [number, number, number, number];
  offsetX?: number;
  offsetY?: number;
}) {
  const size = options.size ?? 64;
  const background = options.background ?? [255, 255, 255, 255];
  const block = options.block ?? [10, 20, 30, 255];
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    data[i * 4] = background[0];
    data[i * 4 + 1] = background[1];
    data[i * 4 + 2] = background[2];
    data[i * 4 + 3] = background[3];
  }
  const extent = Math.round(size * options.span);
  const start = Math.round((size - extent) / 2);
  const left = start + Math.round(size * (options.offsetX ?? 0));
  const top = start + Math.round(size * (options.offsetY ?? 0));
  for (let y = top; y < top + extent; y += 1) {
    for (let x = left; x < left + extent; x += 1) {
      const i = (y * size + x) * 4;
      data[i] = block[0];
      data[i + 1] = block[1];
      data[i + 2] = block[2];
      data[i + 3] = block[3];
    }
  }
  return { width: size, height: size, data };
}

function toPngBytes(raster: { width: number; height: number; data: Uint8Array }): Buffer {
  const png = new PNG({ width: raster.width, height: raster.height });
  png.data = Buffer.from(raster.data);
  return PNG.sync.write(png);
}

describe('the measurement recovers how much of the frame the product spans', () => {
  it('reads a product that fills its frame as filling it', () => {
    // Its corners are the product, so there is no margin to find. That reads
    // as 1.0 — nothing to trim — which is also what a genuinely blank image
    // reads as, and both are left alone for the same reason.
    expect(measureContentRatio(framed({ span: 1 }))).toEqual({ ok: true, contentRatio: 1 });
    expect(measureContentRatio(framed({ span: 0 }))).toEqual({ ok: true, contentRatio: 1 });
  });

  it('reads a product floating in white as spanning much less', () => {
    const result = measureContentRatio(framed({ span: 0.5 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contentRatio).toBeGreaterThan(0.45);
    expect(result.contentRatio).toBeLessThan(0.55);
  });

  it('trims transparency the same way it trims white', () => {
    // Two images of the same product, one on white and one on alpha, must
    // measure the same — otherwise a PNG would be framed differently from
    // the JPEG beside it for no reason a shopper could see.
    const onWhite = measureContentRatio(framed({ span: 0.6 }));
    const onAlpha = measureContentRatio(framed({ span: 0.6, background: [0, 0, 0, 0] }));
    expect(onWhite.ok && onAlpha.ok).toBe(true);
    if (!onWhite.ok || !onAlpha.ok) return;
    expect(onAlpha.contentRatio).toBeCloseTo(onWhite.contentRatio, 5);
  });

  it('takes the background from the corners rather than assuming white', () => {
    // A product shot on a light grey card stock. Assuming white would treat
    // the whole frame as content and measure 1.0 for an image that is mostly
    // margin.
    const result = measureContentRatio(framed({ span: 0.5, background: [238, 238, 238, 255] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contentRatio).toBeLessThan(0.6);
  });

  it('treats an image with no uniform margin as already full-frame', () => {
    // Corners all different: a lifestyle photograph, not a cut-out. There is
    // nothing to trim, and pretending otherwise would enlarge a scene.
    const raster = framed({ span: 0.5 });
    const set = (x: number, y: number, rgb: [number, number, number]) => {
      const i = (y * raster.width + x) * 4;
      raster.data[i] = rgb[0];
      raster.data[i + 1] = rgb[1];
      raster.data[i + 2] = rgb[2];
    };
    set(0, 0, [255, 255, 255]);
    set(raster.width - 1, 0, [12, 200, 40]);
    set(0, raster.height - 1, [220, 15, 90]);
    expect(measureContentRatio(raster)).toEqual({ ok: true, contentRatio: 1 });
  });
});

describe('the measurement refuses the cases where enlarging would go wrong', () => {
  it('refuses a product sitting off to one side', () => {
    // Enlarging grows the element evenly in every direction, so off-centre
    // content would lose its far edge. Better to leave it alone.
    const result = measureContentRatio(framed({ span: 0.5, offsetX: 0.2 }));
    expect(result).toEqual({ ok: false, problem: 'off-centre' });
  });

  it('refuses something too small to measure', () => {
    expect(measureContentRatio({ width: 2, height: 2, data: new Uint8Array(16) })).toEqual({
      ok: false,
      problem: 'degenerate',
    });
  });
});

describe('fetching an image never throws, whatever comes back', () => {
  const respond = (body: BodyInit, status = 200) => async () => new Response(body, { status });

  it('measures a real PNG end to end', async () => {
    const bytes = toPngBytes(framed({ span: 0.5 }));
    const result = await measureImageAtUrl('https://example.test/a.png', respond(bytes) as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contentRatio).toBeLessThan(0.6);
  });

  it('reports a non-2xx, a transport failure and an empty body as unreachable', async () => {
    const notFound = await measureImageAtUrl('https://example.test/a.png', respond('', 404) as unknown as typeof fetch);
    expect(notFound).toEqual({ ok: false, problem: 'unreachable' });

    const thrown = await measureImageAtUrl('https://example.test/a.png', (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch);
    expect(thrown).toEqual({ ok: false, problem: 'unreachable' });

    const empty = await measureImageAtUrl('https://example.test/a.png', respond('') as unknown as typeof fetch);
    expect(empty).toEqual({ ok: false, problem: 'unreachable' });
  });

  it('refuses a body larger than the cap rather than buffering it', async () => {
    const huge = new Uint8Array(MAX_IMAGE_BYTES + 1);
    const result = await measureImageAtUrl('https://example.test/a.png', respond(huge) as unknown as typeof fetch);
    expect(result).toEqual({ ok: false, problem: 'unreachable' });
  });

  it('names a format it has no decoder for, and corruption separately', async () => {
    const webp = Buffer.from('RIFF....WEBPVP8 ', 'ascii');
    expect(await measureImageAtUrl('https://example.test/a.webp', respond(webp) as unknown as typeof fetch)).toEqual({
      ok: false,
      problem: 'unsupported-format',
    });

    // A .png that is not a PNG is corruption, not an unsupported format.
    const claimsPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await measureImageAtUrl('https://example.test/a.png', respond(claimsPng) as unknown as typeof fetch)).toEqual({
      ok: false,
      problem: 'undecodable',
    });
  });
});

describe('attaching ratios to a catalogue cannot break the catalogue', () => {
  const part = (id: string): AffiliatePart => ({
    id: `newegg-gpu-${id}`,
    category: 'gpu',
    merchant: 'Newegg',
    name: `Card ${id}`,
    imageUrl: `https://c1.neweggimages.com/${id}.jpg`,
    trackedAffiliateUrl: `https://click.linksynergy.com/link?id=x&offerid=${id}`,
    fetchedAt: '2026-08-29T23:00:00.000Z',
    availability: 'unknown',
    retailPrice: 100,
    salePrice: null,
    currency: 'USD',
    canonicalPartId: 'rtx5090',
    specsVerified: true,
    imageContentRatio: null,
  });

  it('records what it measured and leaves the rest null', async () => {
    const parts = [part('a'), part('b'), part('c')];
    const measure = async (url: string): Promise<ImageMeasurement> =>
      url.includes('/b.') ? { ok: false, problem: 'unreachable' } : { ok: true, contentRatio: 0.7 };

    const result = await attachImageContentRatios(parts, measure, 2);
    expect(result.parts.map((p) => p.imageContentRatio)).toEqual([0.7, null, 0.7]);
    expect(result.measured).toBe(2);
    expect(result.problems).toEqual({ unreachable: 1 });
  });

  it('changes nothing else about any part', async () => {
    const parts = [part('a')];
    const result = await attachImageContentRatios(parts, async () => ({ ok: true, contentRatio: 0.8 }), 1);
    expect({ ...result.parts[0], imageContentRatio: null }).toEqual(parts[0]);
  });

  it('leaves every ratio null when every measurement fails', async () => {
    // The failure mode that matters: the image host is down during a price
    // refresh. Prices must still publish, framed exactly as they are today.
    const parts = [part('a'), part('b')];
    const result = await attachImageContentRatios(parts, async () => ({ ok: false, problem: 'unreachable' }), 4);
    expect(result.parts.every((p) => p.imageContentRatio === null)).toBe(true);
    expect(result.measured).toBe(0);
  });
});
