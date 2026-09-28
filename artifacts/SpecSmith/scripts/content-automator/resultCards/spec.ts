// The result-card motion format: a vertical video built from large result
// cards instead of screenshots of the site.
//
// WHY A FORMAT. The Compare video filmed full Compare pages and laid captions
// over them. On a phone the page's chart rows are too small to read, and the
// captions covered them. A result card states one finding at a size a phone
// can read, and nothing is drawn over it.
//
// WHAT IS FIXED FOR EVERY VIDEO:
// - 1080x1920 at 30 fps, with every card inside SAFE_AREA, clear of the
//   platform buttons and caption bar at the bottom and on the right;
// - a persistent label (`label`) shown in every frame, never animated;
// - only text and shapes: no screenshots, images or captions over a chart.
//
// A builder (compareResultCards.ts) fills the scenes from computed figures;
// template.ts draws them and render.ts records the preview.

export const RESULT_CARD_FORMAT = { width: 1080, height: 1920, fps: 30 } as const;

/**
 * Where content may sit. Below `bottom` Shorts, Reels and TikTok draw the
 * caption, handle and sound bar; the like and share buttons run down the right
 * edge from about y=1000, so nothing below `bottom` is used at all.
 */
export const SAFE_AREA = { left: 72, right: 1008, top: 132, bottom: 1400 } as const;

/** Seconds a scene change takes: the old card fades out over the first half, the new one in over the second. */
export const CROSSFADE_SECONDS = 0.4;

/** Silent reading rate used to size scenes: 240 words a minute, plus a glance to find the card. */
export const READING_WORDS_PER_SECOND = 4;
export const READING_LEAD_IN_SECONDS = 0.75;

export interface Bar {
  name: string;
  value: number;
  leads: boolean;
}

export type ResultCardScene =
  | { kind: "matchup"; seconds: number; a: string; b: string; shared: string }
  | { kind: "stat"; seconds: number; eyebrow: string; value: string; valueSuffix: string; body: string; footnote: string }
  | {
      kind: "gap";
      seconds: number;
      eyebrow: string;
      value: string;
      valueSuffix: string;
      bars: [Bar, Bar];
      footnote: string;
    }
  | { kind: "takeaway"; seconds: number; lines: { text: string; emphasis: boolean }[]; cta: string };

/** A scene before it is given a duration. */
export type SceneContent = ResultCardScene extends infer S ? (S extends ResultCardScene ? Omit<S, "seconds"> : never) : never;

export interface ResultCardVideo {
  id: string;
  /** Shown in every frame. */
  label: string;
  scenes: ResultCardScene[];
}

export interface SceneWindow {
  index: number;
  start: number;
  end: number;
}

export function sceneWindows(video: ResultCardVideo): SceneWindow[] {
  let start = 0;
  return video.scenes.map((scene, index) => {
    const window = { index, start, end: Number((start + scene.seconds).toFixed(3)) };
    start = window.end;
    return window;
  });
}

export function durationSeconds(video: ResultCardVideo): number {
  return sceneWindows(video).at(-1)?.end ?? 0;
}

/** Every string a viewer can read in a scene, in reading order. */
export function sceneText(scene: ResultCardScene): string[] {
  switch (scene.kind) {
    case "matchup":
      return [scene.a, "vs", scene.b, scene.shared];
    case "stat":
      return [scene.eyebrow, `${scene.value}${scene.valueSuffix}`, scene.body, scene.footnote];
    case "gap":
      return [
        scene.eyebrow,
        `${scene.value} ${scene.valueSuffix}`,
        ...scene.bars.flatMap((bar) => [bar.name, String(bar.value)]),
        scene.footnote,
      ];
    case "takeaway":
      return [...scene.lines.map((line) => line.text), scene.cta];
  }
}

export function wordCount(text: string): number {
  return text.split(/[\s/·—]+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** Seconds a viewer needs to read a scene once. The persistent label is read once, not per scene. */
export function readingSeconds(scene: ResultCardScene): number {
  const words = sceneText(scene).reduce((total, text) => total + wordCount(text), 0);
  return READING_LEAD_IN_SECONDS + words / READING_WORDS_PER_SECOND;
}
