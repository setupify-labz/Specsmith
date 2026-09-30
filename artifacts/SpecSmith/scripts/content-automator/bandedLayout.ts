// A 9:16 frame split into three bands, so that nothing is drawn over the story.
//
//   0    ┌──────────────┐
//        │ disclosure   │  persistent, verbatim, readable for the whole video
//   300  ├──────────────┤
//        │ story        │  the validated product capture, untouched
//   1600 ├──────────────┤
//        │ captions     │  the author's timed captions
//   1920 └──────────────┘
//
// Burned over a full-frame capture, a disclosure or a caption hides part of
// the product it is about. Here each has its own band: the capture is rendered
// at the story band's exact size, and the verifier (bandedFrameCheck.ts)
// confirms in sampled frames that the story band holds the capture's own
// pixels and the disclosure band holds the disclosure's.

import type { UiViewport } from "./uiRender/uiRenderState.ts";

export interface Band {
  readonly y: number;
  readonly height: number;
}

export interface BandedLayout {
  readonly width: number;
  readonly height: number;
  readonly disclosure: Band;
  readonly story: Band;
  readonly captions: Band;
}

export const DISCLOSURE_BANDED_LAYOUT: BandedLayout = {
  width: 1080,
  height: 1920,
  disclosure: { y: 0, height: 300 },
  story: { y: 300, height: 1300 },
  captions: { y: 1600, height: 320 },
};

/**
 * The capture viewport that fills the story band exactly: the same 540 CSS
 * pixel width (so Compare lays out as on a phone), shorter, at 2x.
 */
export function storyViewport(layout: BandedLayout = DISCLOSURE_BANDED_LAYOUT): UiViewport {
  return { width: layout.width / 2, height: layout.story.height / 2, deviceScaleFactor: 2 };
}

export class BandedLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BandedLayoutError";
  }
}

function band(value: unknown, name: string, height: number): Band {
  const raw = value as Record<string, unknown> | null;
  const y = raw?.y, h = raw?.height;
  if (typeof y !== "number" || typeof h !== "number" || !Number.isInteger(y) || !Number.isInteger(h) || y < 0 || h <= 0 || y + h > height) {
    throw new BandedLayoutError(`${name} band must be whole pixels inside the ${height}px frame.`);
  }
  return { y, height: h };
}

/** Validates an untrusted layout. Overlapping bands are refused: overlap is exactly "drawn over the story". */
export function parseBandedLayout(input: unknown): BandedLayout {
  const raw = input as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") throw new BandedLayoutError("layout must be an object.");
  const width = raw.width, height = raw.height;
  if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= width) {
    throw new BandedLayoutError("layout must be a portrait frame.");
  }
  const layout = {
    width,
    height,
    disclosure: band(raw.disclosure, "disclosure", height),
    story: band(raw.story, "story", height),
    captions: band(raw.captions, "captions", height),
  };
  const ordered = [layout.disclosure, layout.story, layout.captions].sort((a, b) => a.y - b.y);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].y < ordered[index - 1].y + ordered[index - 1].height) {
      throw new BandedLayoutError("layout bands overlap; an overlay would be drawn over the story.");
    }
  }
  return layout;
}
