// Turns a merchant photograph's solid studio backdrop into real transparency,
// or refuses and leaves the photograph exactly as it was.
//
// SERVER-ONLY. Decodes image bytes; never imported by the browser bundle.
//
// WHAT THIS IS ALLOWED TO DO
// --------------------------
// It writes the ALPHA channel and nothing else. Every R, G and B byte in the
// output is copied verbatim from the input. Nothing is redrawn, recoloured,
// sharpened, matted or reconstructed, so a processed image cannot show
// hardware the merchant's photograph did not show. If the alpha channel were
// discarded the original picture would be returned bit-for-bit.
//
// WHY IT REFUSES SO OFTEN, ON PURPOSE
// -----------------------------------
// The failure that matters is not "a backdrop survived". It is eating a
// product: a white GPU shroud on a white sweep, the bright rim of a brushed
// heatsink, the glass side panel of a case that is mostly backdrop showing
// through. A hole in a product photograph is worse than an untouched one,
// because the untouched one is merely unimproved while the eaten one is
// wrong, and wrong in a way that looks deliberate.
//
// So every rule below is one-sided. When the evidence for "this pixel is
// backdrop" is anything less than conclusive, the pixel stays opaque, and when
// the picture as a whole is unclear the ORIGINAL BYTES are returned and the
// caller records the reason. There is no confidence score and no best effort.
//
// THE FOUR GATES
// --------------
//   1. Already transparent  -> return unchanged. A photograph that already has
//      an alpha channel has been cut out by someone with the real product in
//      front of them; second-guessing it can only lose information.
//   2. Confirmed solid exterior -> the border ring must be one colour, within
//      a tight tolerance, for nearly all of its length. A gradient sweep, a
//      lifestyle shot or a collage fails here and is left alone.
//   3. Exterior connectivity -> only backdrop-coloured pixels reachable from
//      the border are cleared. An interior region the same colour as the
//      backdrop — the gap between fan blades, the space inside a coiled cable,
//      a white logo on a white shroud — is NOT reachable, so it stays opaque.
//      This deliberately leaves some genuine holes filled: see the note on
//      `interiorHolesKept` below.
//   4. Leak detection -> if the cleared region reaches the middle of the frame,
//      the product did not separate from its backdrop and the whole image is
//      returned untouched. This is what catches white-on-white.

import { Buffer } from 'node:buffer';

import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

/** Why an image was left exactly as it arrived. Closed, so callers can tally each case. */
export type RefusalReason =
  /** Already carries meaningful alpha. Nothing to do, and nothing may be undone. */
  | 'already-transparent'
  /** No decoder for these bytes. */
  | 'unsupported-format'
  /** Claimed a supported format and did not decode as one. */
  | 'undecodable'
  /** Too small to reason about. */
  | 'degenerate'
  /** The border is not one flat colour, so there is no confirmed backdrop. */
  | 'background-not-solid'
  /** Clearing reached the middle of the frame: the product did not separate. */
  | 'boundary-uncertain'
  /** Almost nothing would have been cleared; not worth rewriting the file. */
  | 'nothing-to-remove'
  /** So much was cleared that too little product remains to be plausible. */
  | 'product-too-small';

export interface RemovalStats {
  width: number;
  height: number;
  /** Fraction of the frame turned fully or partly transparent. */
  clearedFraction: number;
  /**
   * Interior regions matching the backdrop colour that were left OPAQUE
   * because they are not reachable from the border.
   *
   * Non-zero is expected and usually correct — a white logo on a white shroud
   * must stay. It is surfaced so a reviewer can spot the case where a genuine
   * cut-out (a fan opening, the loop of a cable) was conservatively filled.
   */
  interiorHolesKept: number;
  /** Pixels given partial alpha, i.e. the soft edge between product and backdrop. */
  softEdgePixels: number;
  /** The backdrop colour that was cleared, for the record. */
  backgroundColor: { r: number; g: number; b: number };
}

export type RemovalOutcome =
  | { ok: true; png: Buffer; stats: RemovalStats }
  | { ok: false; reason: RefusalReason; detail: string };

/**
 * How close a pixel must be to the backdrop colour to be cleared outright.
 *
 * Deliberately tight. A wide tolerance is exactly how a white product loses
 * its edge, and the soft-edge ramp below already covers honest anti-aliasing.
 */
export const CLEAR_TOLERANCE = 12;

/** Pixels between CLEAR_TOLERANCE and this get partial alpha rather than none. */
export const SOFT_EDGE_TOLERANCE = 30;

/** Alpha at or below this counts as already-transparent. */
const TRANSPARENT_ALPHA = 250;

/** A backdrop must be this uniform along the border ring to count as confirmed. */
export const BORDER_UNIFORMITY = 0.97;

/** How thick a ring around the edge is inspected. */
const BORDER_RING = 2;

/**
 * The central box that clearing must not reach, as a fraction of each side.
 *
 * A product photograph puts the product in the middle. If backdrop-coloured
 * pixels connect the border to the centre, either the product is not there or
 * it is the same colour as its backdrop; both mean the boundary is not
 * established and the image must be left alone.
 */
export const PROTECTED_CENTRE = 0.25;

/**
 * How much of that central box may be cleared before the cut is distrusted.
 *
 * Not zero. A monitor on a narrow stand, a cooler on a slim mount and an
 * L-shaped bracket all leave genuine backdrop beside them in the middle of the
 * frame, and refusing those would be superstition rather than caution. What
 * this catches is the fill SWALLOWING the centre, which is what happens when a
 * pale product never separated from its pale backdrop.
 */
export const PROTECTED_CENTRE_MAX_CLEARED = 0.5;

/**
 * How much of the cut boundary may be low-contrast before the whole cut is
 * distrusted.
 *
 * This is the gate for bright metal rims, pale plastics and soft shadows. A
 * trustworthy cut has the product ending in a visible step against its
 * backdrop; where the product instead FADES into it, the position of the edge
 * is a matter of opinion and this code does not get one. Raising this trades
 * safety for yield and should be a reviewed decision, not a convenience.
 */
export const MAX_LOW_CONTRAST_BOUNDARY = 0.15;

/** Below this remaining opaque fraction, assume the product was eaten. */
export const MIN_PRODUCT_FRACTION = 0.02;

/** Above nothing-to-remove: fewer cleared pixels than this and we do not rewrite. */
export const MIN_CLEARED_FRACTION = 0.005;

export interface Raster {
  width: number;
  height: number;
  /** RGBA, four bytes per pixel, row-major. */
  data: Uint8Array;
}

export function decodeImage(bytes: Buffer, url: string): Raster | RefusalReason {
  const lower = url.toLowerCase().split('?')[0];
  try {
    if (lower.endsWith('.png')) {
      const png = PNG.sync.read(bytes);
      return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
    }
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      const raw = jpeg.decode(bytes, { useTArray: true });
      return { width: raw.width, height: raw.height, data: new Uint8Array(raw.data) };
    }
    return 'unsupported-format';
  } catch {
    return 'undecodable';
  }
}

const at = (r: Raster, x: number, y: number) => (y * r.width + x) * 4;
const dist = (d: Uint8Array, i: number, bg: { r: number; g: number; b: number }) =>
  Math.max(Math.abs(d[i] - bg.r), Math.abs(d[i + 1] - bg.g), Math.abs(d[i + 2] - bg.b));

/** True when the image already carries meaningful transparency. */
export function hasRealTransparency(r: Raster): boolean {
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i] < TRANSPARENT_ALPHA) return true;
  return false;
}

/**
 * The backdrop colour, if the border ring is one flat colour.
 *
 * The median of the ring is taken as the candidate rather than a single
 * corner, so one stray watermark pixel cannot define the backdrop; then the
 * ring must agree with it almost everywhere.
 */
export function confirmSolidBackground(r: Raster): { r: number; g: number; b: number } | null {
  const px: number[][] = [];
  const push = (x: number, y: number) => {
    const i = at(r, x, y);
    px.push([r.data[i], r.data[i + 1], r.data[i + 2]]);
  };
  for (let x = 0; x < r.width; x += 1) {
    for (let k = 0; k < BORDER_RING; k += 1) {
      push(x, k);
      push(x, r.height - 1 - k);
    }
  }
  for (let y = 0; y < r.height; y += 1) {
    for (let k = 0; k < BORDER_RING; k += 1) {
      push(k, y);
      push(r.width - 1 - k, y);
    }
  }
  if (px.length === 0) return null;

  const median = (ch: number) => {
    const v = px.map((p) => p[ch]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  const bg = { r: median(0), g: median(1), b: median(2) };
  const agree = px.filter(
    (p) => Math.max(Math.abs(p[0] - bg.r), Math.abs(p[1] - bg.g), Math.abs(p[2] - bg.b)) <= CLEAR_TOLERANCE,
  ).length;
  return agree / px.length >= BORDER_UNIFORMITY ? bg : null;
}

/**
 * Clears the confirmed exterior backdrop, or explains why it would not.
 *
 * Only the alpha channel is written. RGB is copied verbatim.
 */
export function removeBackground(bytes: Buffer, url: string): RemovalOutcome {
  const decoded = decodeImage(bytes, url);
  if (typeof decoded === 'string') {
    return { ok: false, reason: decoded, detail: `Could not decode ${url} (${decoded}).` };
  }
  const r = decoded;
  if (r.width < 16 || r.height < 16) {
    return { ok: false, reason: 'degenerate', detail: `${r.width}x${r.height} is too small to separate.` };
  }
  if (hasRealTransparency(r)) {
    return {
      ok: false,
      reason: 'already-transparent',
      detail: 'The photograph already carries an alpha channel; it is kept exactly as supplied.',
    };
  }

  const bg = confirmSolidBackground(r);
  if (!bg) {
    return {
      ok: false,
      reason: 'background-not-solid',
      detail:
        `The border ring is not one flat colour to within ${CLEAR_TOLERANCE}/255 for ` +
        `${Math.round(BORDER_UNIFORMITY * 100)}% of its length, so no backdrop is confirmed.`,
    };
  }

  // Flood fill inward from the border. 4-connected, so a diagonal thread of
  // backdrop-coloured pixels cannot squeeze between two touching product parts.
  const total = r.width * r.height;
  const cleared = new Uint8Array(total); // 0 opaque, 1 cleared, 2 soft edge
  const queue: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= r.width || y >= r.height) return;
    const p = y * r.width + x;
    if (cleared[p]) return;
    const d = dist(r.data, p * 4, bg);
    if (d <= CLEAR_TOLERANCE) {
      cleared[p] = 1;
      queue.push(p);
    } else if (d <= SOFT_EDGE_TOLERANCE) {
      // The anti-aliased rim between product and backdrop. Given partial alpha
      // so the cut-out does not show a hard staircase, but NOT used to seed
      // further filling — a soft pixel never carries the fill inward.
      cleared[p] = 2;
    }
  };
  for (let x = 0; x < r.width; x += 1) {
    push(x, 0);
    push(x, r.height - 1);
  }
  for (let y = 0; y < r.height; y += 1) {
    push(0, y);
    push(r.width - 1, y);
  }
  while (queue.length > 0) {
    const p = queue.pop()!;
    const x = p % r.width;
    const y = (p - x) / r.width;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  // GATE 4. Did the fill reach the middle? If so the product never separated.
  const x0 = Math.floor(r.width * (0.5 - PROTECTED_CENTRE / 2));
  const x1 = Math.ceil(r.width * (0.5 + PROTECTED_CENTRE / 2));
  const y0 = Math.floor(r.height * (0.5 - PROTECTED_CENTRE / 2));
  const y1 = Math.ceil(r.height * (0.5 + PROTECTED_CENTRE / 2));
  let centreCells = 0;
  let centreCleared = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      centreCells += 1;
      if (cleared[y * r.width + x] === 1) centreCleared += 1;
    }
  }
  if (centreCells > 0 && centreCleared / centreCells > PROTECTED_CENTRE_MAX_CLEARED) {
    return {
      ok: false,
      reason: 'boundary-uncertain',
      detail:
        `${((centreCleared / centreCells) * 100).toFixed(1)}% of the centre of the frame was cleared, ` +
        'so the product did not separate from its backdrop — the white-on-white case. ' +
        'The original image is kept.',
    };
  }

  // GATE 5. Is the edge we just cut actually visible?
  //
  // Every cleared pixel that touches a kept pixel is a point on the cut. If
  // the kept pixel there is itself close to the backdrop colour, then at that
  // point the product does not visibly end — it fades out, and any boundary
  // drawn through it is invented. A bright heatsink rim photographed at 246 on
  // a 255 sweep is nine levels from its own backdrop; there is no honest way
  // to say where the metal stops.
  let boundary = 0;
  let lowContrast = 0;
  for (let p = 0; p < total; p += 1) {
    if (cleared[p] !== 1) continue;
    const x = p % r.width;
    const y = (p - x) / r.width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= r.width || ny >= r.height) continue;
      const q = ny * r.width + nx;
      if (cleared[q] === 1) continue;
      boundary += 1;
      if (dist(r.data, q * 4, bg) <= SOFT_EDGE_TOLERANCE) lowContrast += 1;
      break;
    }
  }
  if (boundary > 0 && lowContrast / boundary > MAX_LOW_CONTRAST_BOUNDARY) {
    return {
      ok: false,
      reason: 'boundary-uncertain',
      detail:
        `${((lowContrast / boundary) * 100).toFixed(1)}% of the cut boundary fades into the backdrop ` +
        'rather than stepping away from it, so where the product ends is not established. ' +
        'This is the bright-rim and soft-shadow case; the original image is kept.',
    };
  }

  let clearedCount = 0;
  let softCount = 0;
  for (let p = 0; p < total; p += 1) {
    if (cleared[p] === 1) clearedCount += 1;
    else if (cleared[p] === 2) softCount += 1;
  }
  const clearedFraction = clearedCount / total;
  if (clearedFraction < MIN_CLEARED_FRACTION) {
    return {
      ok: false,
      reason: 'nothing-to-remove',
      detail: `Only ${(clearedFraction * 100).toFixed(2)}% of the frame is exterior backdrop.`,
    };
  }
  if (1 - clearedFraction < MIN_PRODUCT_FRACTION) {
    return {
      ok: false,
      reason: 'product-too-small',
      detail: `Only ${((1 - clearedFraction) * 100).toFixed(2)}% would remain opaque.`,
    };
  }

  // Interior regions matching the backdrop that were NOT reachable from the
  // border, and so stay opaque. Counted for the reviewer, never acted on.
  let interiorHolesKept = 0;
  for (let p = 0; p < total; p += 1) {
    if (cleared[p] === 0 && dist(r.data, p * 4, bg) <= CLEAR_TOLERANCE) interiorHolesKept += 1;
  }

  const png = new PNG({ width: r.width, height: r.height });
  for (let p = 0; p < total; p += 1) {
    const i = p * 4;
    // RGB copied verbatim. Only alpha is decided here.
    png.data[i] = r.data[i];
    png.data[i + 1] = r.data[i + 1];
    png.data[i + 2] = r.data[i + 2];
    if (cleared[p] === 1) {
      png.data[i + 3] = 0;
    } else if (cleared[p] === 2) {
      // Linear ramp across the soft band: fully transparent at the backdrop
      // colour, fully opaque by SOFT_EDGE_TOLERANCE. No colour is invented —
      // the pixel keeps the exact RGB the merchant's camera recorded.
      const d = dist(r.data, i, bg);
      const t = (d - CLEAR_TOLERANCE) / (SOFT_EDGE_TOLERANCE - CLEAR_TOLERANCE);
      png.data[i + 3] = Math.round(Math.min(1, Math.max(0, t)) * 255);
    } else {
      png.data[i + 3] = 255;
    }
  }

  return {
    ok: true,
    png: PNG.sync.write(png),
    stats: {
      width: r.width,
      height: r.height,
      clearedFraction,
      interiorHolesKept,
      softEdgePixels: softCount,
      backgroundColor: bg,
    },
  };
}
