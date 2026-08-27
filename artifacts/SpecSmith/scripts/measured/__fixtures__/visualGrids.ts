// Synthetic screens for the visual-recognition tests. TEST FIXTURES ONLY.
//
// No pixel here came from RDR2. Each fixture is rendered as a real pixel
// canvas at a chosen resolution and then reduced by the SAME box-filter the
// Windows sampler applies, so the tests exercise the actual path: render at
// 1080p or 1440p, crop, greyscale, downsample to the fixed grid, binarise,
// correlate.
//
// That matters for the resolution-tolerance claim. A fixture that produced the
// grid directly would prove nothing about resampling; these produce different
// pixel counts and must still land on the same grid.

import { GRID_WIDTH, GRID_HEIGHT, type NormalizedCrop } from '../rdr2ResultsVisual';

/**
 * A 5x7 block font, enough for the phrases these tests need.
 *
 * Deliberately crude: the point is to produce DIFFERENT, STRUCTURED ink for
 * different words, not to look like RDR2's typeface. Recognising a real title
 * requires calibrating against the real screen, which is exactly why the
 * detector ships without a built-in reference.
 */
const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '11110', '10001', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '11110', '10000', '10000', '10000', '11111'],
  F: ['11111', '10000', '11110', '10000', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01111'],
  H: ['10001', '10001', '11111', '10001', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '11100', '10100', '10010', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '01110', '00001', '00001', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '01010', '00100', '00100', '00100', '01010', '10001'],
  Y: ['10001', '01010', '00100', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

const GLYPH_W = 5;
const GLYPH_H = 7;

export interface Canvas {
  width: number;
  height: number;
  /** Greyscale 0..255, row-major. */
  pixels: Uint8ClampedArray;
}

export function blankCanvas(width: number, height: number, level = 18): Canvas {
  const pixels = new Uint8ClampedArray(width * height);
  pixels.fill(level);
  return { width, height, pixels };
}

/**
 * Draws `text` centred in the canvas, scaled to fill `fillFraction` of its
 * width. Scaling with the canvas is what makes the same phrase land on the
 * same grid whether it was rendered at 1080p or 4K.
 */
export function drawText(canvas: Canvas, text: string, fillFraction = 0.8, inkLevel = 235): Canvas {
  const upper = text.toUpperCase();
  const advance = GLYPH_W + 1;
  const textCells = upper.length * advance - 1;
  const scale = Math.max(1, Math.floor((canvas.width * fillFraction) / textCells));
  const pxW = textCells * scale;
  const pxH = GLYPH_H * scale;
  const originX = Math.floor((canvas.width - pxW) / 2);
  const originY = Math.floor((canvas.height - pxH) / 2);

  upper.split('').forEach((ch, i) => {
    const glyph = FONT[ch] ?? FONT[' '];
    for (let gy = 0; gy < GLYPH_H; gy += 1) {
      for (let gx = 0; gx < GLYPH_W; gx += 1) {
        if (glyph[gy][gx] !== '1') continue;
        const x0 = originX + (i * advance + gx) * scale;
        const y0 = originY + gy * scale;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const x = x0 + dx;
            const y = y0 + dy;
            if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
            canvas.pixels[y * canvas.width + x] = inkLevel;
          }
        }
      }
    }
  });
  return canvas;
}

/** Deterministic value noise, so a "gameplay" fixture is busy without being random per run. */
export function addNoise(canvas: Canvas, amplitude = 60, seed = 1): Canvas {
  let state = seed >>> 0;
  for (let i = 0; i < canvas.pixels.length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const n = ((state >>> 16) & 0xff) / 255;
    canvas.pixels[i] = canvas.pixels[i] + (n - 0.5) * 2 * amplitude;
  }
  return canvas;
}

/**
 * The reduction the Windows sampler performs: crop to the normalized region,
 * then box-filter down to the fixed grid.
 *
 * Kept here rather than imported so the tests exercise a reduction that is
 * written down independently of the detector's own code.
 */
export function reduceToGrid(canvas: Canvas, crop: NormalizedCrop): number[] {
  const cx = Math.floor(crop.x * canvas.width);
  const cy = Math.floor(crop.y * canvas.height);
  const cw = Math.max(1, Math.floor(crop.w * canvas.width));
  const ch = Math.max(1, Math.floor(crop.h * canvas.height));
  const grid: number[] = new Array(GRID_WIDTH * GRID_HEIGHT).fill(0);

  for (let gy = 0; gy < GRID_HEIGHT; gy += 1) {
    // Bounds are computed RELATIVE to the crop and only then offset by its
    // origin. Mixing the two spaces silently makes early cells average a band
    // many times too tall, which is exactly the bug this shape avoids.
    const ry0 = Math.floor((gy * ch) / GRID_HEIGHT);
    const ry1 = Math.max(ry0 + 1, Math.floor(((gy + 1) * ch) / GRID_HEIGHT));
    const y0 = cy + ry0;
    const y1 = cy + ry1;
    for (let gx = 0; gx < GRID_WIDTH; gx += 1) {
      const rx0 = Math.floor((gx * cw) / GRID_WIDTH);
      const rx1 = Math.max(rx0 + 1, Math.floor(((gx + 1) * cw) / GRID_WIDTH));
      const x0 = cx + rx0;
      const x1 = cx + rx1;
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < canvas.height; y += 1) {
        for (let x = x0; x < x1 && x < canvas.width; x += 1) {
          sum += canvas.pixels[y * canvas.width + x];
          n += 1;
        }
      }
      grid[gy * GRID_WIDTH + gx] = n > 0 ? sum / n : 0;
    }
  }
  return grid;
}

/** A full screen showing `text` as its title, at the given resolution. */
export function titleScreen(text: string, width: number, height: number, crop: NormalizedCrop): number[] {
  const canvas = blankCanvas(width, height);
  // The title sits inside the crop band, so draw into a sub-canvas the size of
  // the crop and composite it back — the same geometry the real screen has.
  const cw = Math.max(1, Math.floor(crop.w * width));
  const chh = Math.max(1, Math.floor(crop.h * height));
  const band = drawText(blankCanvas(cw, chh), text);
  const ox = Math.floor(crop.x * width);
  const oy = Math.floor(crop.y * height);
  for (let y = 0; y < chh; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      const dy = oy + y;
      const dx = ox + x;
      if (dx < width && dy < height) canvas.pixels[dy * width + dx] = band.pixels[y * cw + x];
    }
  }
  return reduceToGrid(canvas, crop);
}

/** A busy gameplay-like screen: no title, structured noise. */
export function gameplayScreen(width: number, height: number, crop: NormalizedCrop, seed = 7): number[] {
  return reduceToGrid(addNoise(blankCanvas(width, height, 110), 70, seed), crop);
}

/** A black or blank screen — the invalid-capture case the detector must refuse. */
export function blackScreen(width: number, height: number, crop: NormalizedCrop, level = 0): number[] {
  return reduceToGrid(blankCanvas(width, height, level), crop);
}
