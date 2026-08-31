// Measures how much of a merchant photograph the product actually occupies.
//
// SERVER-ONLY. This decodes image bytes and is run by the catalogue build. It
// is never imported by the browser bundle — see serverOnly.test.ts for the
// boundary that enforces that for this directory.
//
// It reads pixels and nothing else. It sends no credential, no affiliate
// identifier and no header beyond a plain GET, because an image URL is public
// and the measurement needs nothing more than the picture.

import { Buffer } from 'node:buffer';

import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

/** Why an image could not be measured. Closed, so a caller can count each case. */
export type ImageMeasurementProblem =
  /** The fetch failed, timed out, or answered with a non-2xx status. */
  | 'unreachable'
  /** No decoder for this format — the catalogue carries the odd .webp. */
  | 'unsupported-format'
  /** The bytes claimed a supported format and did not decode as one. */
  | 'undecodable'
  /** Decoded, but the image has no dimensions worth measuring. */
  | 'degenerate'
  /**
   * The product is far enough off-centre that enlarging it would push part of
   * it out of the frame. Measured, and deliberately not used.
   */
  | 'off-centre';

export type ImageMeasurement =
  | { ok: true; contentRatio: number }
  | { ok: false; problem: ImageMeasurementProblem };

/** Pixels within this distance of the corner colour count as background. */
const BACKGROUND_TOLERANCE = 18;

/** Alpha at or below this is transparent, whatever the colour channels say. */
const TRANSPARENT_ALPHA = 16;

/**
 * How far the content box's centre may sit from the frame's, as a fraction of
 * the frame, before enlarging it risks clipping the product.
 */
const MAX_CENTRE_OFFSET = 0.08;

/** A cap on how much of an image we will pull, so one huge file cannot stall a build. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const IMAGE_FETCH_TIMEOUT_MS = 15_000;

interface Raster {
  width: number;
  height: number;
  /** RGBA, four bytes per pixel, row-major. */
  data: Uint8Array | Buffer;
}

function decode(bytes: Buffer, url: string): Raster | ImageMeasurementProblem {
  const lower = url.toLowerCase();
  const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50;
  const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!isPng && !isJpeg) {
    // Trust the bytes over the extension: a .jpg that is really a WebP is the
    // feed's business, not a decode failure worth reporting as corruption.
    return lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')
      ? 'undecodable'
      : 'unsupported-format';
  }
  try {
    if (isPng) {
      const png = PNG.sync.read(bytes);
      return { width: png.width, height: png.height, data: png.data };
    }
    const raw = jpeg.decode(bytes, { useTArray: true });
    return { width: raw.width, height: raw.height, data: raw.data };
  } catch {
    return 'undecodable';
  }
}

/**
 * The bounding box of everything that is not the background, as a fraction of
 * the frame.
 *
 * The background is taken from the four corners rather than assumed to be
 * white: retailer photographs come on white, on near-white, and on
 * transparency, and a fixed assumption would measure the wrong thing on two of
 * the three. When the corners disagree the image is treated as having no
 * uniform background, which is exactly the case where nothing needs enlarging.
 */
export function measureContentRatio(raster: Raster): ImageMeasurement {
  const { width, height, data } = raster;
  if (width < 8 || height < 8 || data.length < width * height * 4) return { ok: false, problem: 'degenerate' };

  const at = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
  };

  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
  const opaqueCorners = corners.filter((corner) => corner.a > TRANSPARENT_ALPHA);
  // Every corner transparent: the background is transparency itself.
  const background =
    opaqueCorners.length === 0
      ? null
      : {
          r: Math.round(opaqueCorners.reduce((sum, c) => sum + c.r, 0) / opaqueCorners.length),
          g: Math.round(opaqueCorners.reduce((sum, c) => sum + c.g, 0) / opaqueCorners.length),
          b: Math.round(opaqueCorners.reduce((sum, c) => sum + c.b, 0) / opaqueCorners.length),
        };
  if (
    background !== null &&
    opaqueCorners.some(
      (corner) =>
        Math.abs(corner.r - background.r) > BACKGROUND_TOLERANCE ||
        Math.abs(corner.g - background.g) > BACKGROUND_TOLERANCE ||
        Math.abs(corner.b - background.b) > BACKGROUND_TOLERANCE,
    )
  ) {
    // Corners disagree: no uniform margin to trim, so the frame is the content.
    return { ok: true, contentRatio: 1 };
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const { r, g, b, a } = at(x, y);
      if (a <= TRANSPARENT_ALPHA) continue;
      if (
        background !== null &&
        Math.abs(r - background.r) <= BACKGROUND_TOLERANCE &&
        Math.abs(g - background.g) <= BACKGROUND_TOLERANCE &&
        Math.abs(b - background.b) <= BACKGROUND_TOLERANCE
      ) {
        continue;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  // Nothing differs from the corner colour. Two images look like this: one
  // whose product runs edge to edge (so the corners ARE the product) and one
  // that is genuinely blank. Both mean the same thing here — there is no
  // margin to trim — and 1.0 makes the framing rule leave them alone, which
  // is the right answer for either.
  if (maxX < minX || maxY < minY) return { ok: true, contentRatio: 1 };

  const spanX = (maxX - minX + 1) / width;
  const spanY = (maxY - minY + 1) / height;

  // Enlarging assumes the content is centred, because the image element grows
  // outward evenly. Content sitting to one side would lose its far edge, so it
  // is reported rather than normalized.
  const offsetX = Math.abs((minX + maxX + 1) / 2 - width / 2) / width;
  const offsetY = Math.abs((minY + maxY + 1) / 2 - height / 2) / height;
  if (offsetX > MAX_CENTRE_OFFSET || offsetY > MAX_CENTRE_OFFSET) return { ok: false, problem: 'off-centre' };

  return { ok: true, contentRatio: Math.min(1, Math.max(spanX, spanY)) };
}

/**
 * Fetches an image and measures it.
 *
 * Never throws. Every failure is a named problem, because this runs inside the
 * daily price refresh and a photograph that cannot be measured must not be
 * able to stop prices from being published.
 */
export async function measureImageAtUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<ImageMeasurement> {
  let bytes: Buffer;
  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, problem: 'unreachable' };
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) return { ok: false, problem: 'unreachable' };
    bytes = Buffer.from(buffer);
  } catch {
    return { ok: false, problem: 'unreachable' };
  }
  const decoded = decode(bytes, url);
  if (typeof decoded === 'string') return { ok: false, problem: decoded };
  return measureContentRatio(decoded);
}
