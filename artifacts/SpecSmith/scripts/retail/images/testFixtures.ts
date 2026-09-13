// Synthetic product photographs for exercising the background remover.
//
// THESE ARE TEST FIXTURES AND NOTHING ELSE. They are drawn shapes, not
// hardware, they never enter the catalogue, and no processed fixture is ever
// published as a product image. They exist so the remover's refusals can be
// proven without a network round trip to a merchant CDN.
//
// Each one models a case the brief calls out by name: a white part on a white
// sweep, a glass panel, a thin cable, fan openings, a bright metal rim, a drop
// shadow.
import { Buffer } from 'node:buffer';

import { PNG } from 'pngjs';

export interface FixtureSpec {
  width?: number;
  height?: number;
  /** Backdrop colour. */
  bg?: [number, number, number];
}

type Painter = (x: number, y: number, w: number, h: number) => [number, number, number, number] | null;

/** Paints a fixture; `paint` returns RGBA for a pixel, or null to leave backdrop. */
export function fixture(paint: Painter, spec: FixtureSpec = {}): Buffer {
  const w = spec.width ?? 200;
  const h = spec.height ?? 200;
  const bg = spec.bg ?? [255, 255, 255];
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const p = paint(x, y, w, h) ?? [bg[0], bg[1], bg[2], 255];
      png.data[i] = p[0];
      png.data[i + 1] = p[1];
      png.data[i + 2] = p[2];
      png.data[i + 3] = p[3];
    }
  }
  return PNG.sync.write(png);
}

const inBox = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) =>
  x >= x0 && x < x1 && y >= y0 && y < y1;

/** A dark graphics card on a white sweep: the straightforward case. */
export const darkGpuOnWhite = () =>
  fixture((x, y, w, h) => (inBox(x, y, w * 0.15, h * 0.3, w * 0.85, h * 0.7) ? [34, 36, 42, 255] : null));

/** A WHITE case on a white sweep. The remover must refuse this. */
export const whiteCaseOnWhite = () =>
  fixture((x, y, w, h) => (inBox(x, y, w * 0.25, h * 0.15, w * 0.75, h * 0.9) ? [252, 252, 253, 255] : null));

/** A white case with a visible dark outline: separable, so it must succeed. */
export const whiteCaseWithOutline = () =>
  fixture((x, y, w, h) => {
    const x0 = w * 0.25, y0 = h * 0.15, x1 = w * 0.75, y1 = h * 0.9;
    if (!inBox(x, y, x0, y0, x1, y1)) return null;
    const edge = x < x0 + 3 || x >= x1 - 3 || y < y0 + 3 || y >= y1 - 3;
    return edge ? [70, 70, 78, 255] : [252, 252, 253, 255];
  });

/** A black case: high contrast, trivially separable. */
export const blackCase = () =>
  fixture((x, y, w, h) => (inBox(x, y, w * 0.3, h * 0.1, w * 0.7, h * 0.95) ? [18, 18, 20, 255] : null));

/** A monitor: dark bezel, bright panel, thin stand. */
export const monitor = () =>
  fixture((x, y, w, h) => {
    if (inBox(x, y, w * 0.1, h * 0.15, w * 0.9, h * 0.62)) {
      const inner = inBox(x, y, w * 0.12, h * 0.17, w * 0.88, h * 0.6);
      return inner ? [40, 62, 110, 255] : [26, 26, 30, 255];
    }
    if (inBox(x, y, w * 0.46, h * 0.62, w * 0.54, h * 0.8)) return [60, 60, 66, 255];
    if (inBox(x, y, w * 0.3, h * 0.8, w * 0.7, h * 0.85)) return [60, 60, 66, 255];
    return null;
  });

/** A coiled cable: thin strands, and a genuine hole through the middle. */
export const coiledCable = () =>
  fixture((x, y, w, h) => {
    const cx = w / 2, cy = h / 2;
    const d = Math.hypot(x - cx, y - cy);
    // A ring: backdrop shows through the middle, which is NOT border-reachable.
    if (d > w * 0.22 && d < w * 0.3) return [30, 30, 34, 255];
    // A thin lead running off to the right edge.
    if (inBox(x, y, cx, cy - 2, w, cy + 2)) return [30, 30, 34, 255];
    return null;
  });

/** A cooler: a body with fan openings that show the backdrop through them. */
export const coolerWithFanOpenings = () =>
  fixture((x, y, w, h) => {
    if (!inBox(x, y, w * 0.2, h * 0.2, w * 0.8, h * 0.8)) return null;
    const cx = w / 2, cy = h / 2;
    const d = Math.hypot(x - cx, y - cy);
    // Four openings between blades: backdrop-coloured, interior, unreachable.
    if (d > w * 0.08 && d < w * 0.24) {
      const a = Math.atan2(y - cy, x - cx);
      if (Math.abs(Math.sin(a * 2)) > 0.7) return [255, 255, 255, 255];
    }
    return [55, 57, 64, 255];
  });

/** A brushed metal heatsink with a bright, nearly-white top rim. */
export const brightMetalEdge = () =>
  fixture((x, y, w, h) => {
    if (!inBox(x, y, w * 0.2, h * 0.25, w * 0.8, h * 0.75)) return null;
    const t = (y - h * 0.25) / (h * 0.5);
    const v = Math.round(250 - t * 190); // 250 at the top rim, dark at the base
    return [v, v, v + 2, 255];
  });

/** A product with a soft drop shadow beneath it. */
export const productWithShadow = () =>
  fixture((x, y, w, h) => {
    if (inBox(x, y, w * 0.25, h * 0.2, w * 0.75, h * 0.62)) return [44, 46, 52, 255];
    if (inBox(x, y, w * 0.22, h * 0.62, w * 0.78, h * 0.72)) {
      const t = (y - h * 0.62) / (h * 0.1);
      const v = Math.round(200 + t * 55);
      return [v, v, v, 255];
    }
    return null;
  });

/** A glass-panel case: mostly backdrop showing through, with a visible frame. */
export const glassPanelCase = () =>
  fixture((x, y, w, h) => {
    const x0 = w * 0.28, y0 = h * 0.12, x1 = w * 0.72, y1 = h * 0.9;
    if (!inBox(x, y, x0, y0, x1, y1)) return null;
    const frame = x < x0 + 4 || x >= x1 - 4 || y < y0 + 4 || y >= y1 - 4;
    if (frame) return [40, 40, 46, 255];
    // The pane: backdrop seen through slightly tinted glass.
    return [246, 247, 248, 255];
  });

/** A lifestyle shot: gradient backdrop, no flat border. Must be refused. */
export const gradientBackdrop = () =>
  fixture((x, y, w, h) => {
    const v = Math.round(200 + (x / w) * 55);
    if (inBox(x, y, w * 0.3, h * 0.3, w * 0.7, h * 0.7)) return [30, 30, 34, 255];
    return [v, v, v, 255];
  });

/** A photograph that already carries transparency. Must be returned untouched. */
export const alreadyTransparent = () =>
  fixture((x, y, w, h) =>
    inBox(x, y, w * 0.3, h * 0.3, w * 0.7, h * 0.7) ? [30, 30, 34, 255] : [0, 0, 0, 0],
  );

/** A frame that is entirely product, edge to edge. Nothing to remove. */
export const fullBleedProduct = () => fixture(() => [70, 72, 80, 255]);
