// The 8-second GPU race proof of concept, as one timeline.
//
// THE METAPHOR, AND WHY IT IS HONEST. Each GPU travels at its modelled
// average FPS, so at every moment the distances are in the ratio avgA : avgB.
// At 1440p High that is 164 : 160, and the RTX 4080 has covered 97.6% of the
// Super's distance at every frame. A game tile flips when the build that leads
// that game in Compare's per-game table passes it. Nothing is animated that the
// figures do not say.
//
// ONE TIMELINE FOR PICTURE AND SOUND. Every frame's camera, positions and
// tile states, and every sound cue, is computed here. The page only draws
// what it is given and the audio only plays what is listed, so a flip's
// tick lands on its flip.

import type { CompareFigures, CompareGameRow } from "../resultCards/compareFigures.ts";

export const FPS = 30;
export const DURATION_SECONDS = 8;
export const WIDTH = 1080;
export const HEIGHT = 1920;

/** World units from start line to finish line. */
export const TRACK_LENGTH = 3000;
/** Lane centres, left for Build A. */
export const LANE_X = { a: -170, b: 170 } as const;
/** A GPU card, nose at its y, body trailing behind. */
export const GPU_SIZE = { width: 130, length: 240 } as const;

const RACE_START = 0.6;
const RACE_END = 6.2;
const ACCELERATION_SHARE = 0.15;
const PULLBACK_START = 4.95;
const PULLBACK_END = 6.3;
/** Tiles line the first 70% of the track, so every flip lands before the pull-back. */
const TILE_FIRST_Y = 260;
const TILE_LAST_Y = TRACK_LENGTH * 0.7;
const FLIP_SECONDS = 0.28;

const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const easeInOutCubic = (u: number) => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2);
const lerp = (from: number, to: number, u: number) => from + (to - from) * u;

/** Share of the leader's full distance covered at time t: quick launch, then a steady run. */
export function raceProgress(t: number): number {
  const u = clamp((t - RACE_START) / (RACE_END - RACE_START));
  const a = ACCELERATION_SHARE;
  const covered = u < a ? (u * u) / (2 * a) : u - a / 2;
  return covered / (1 - a / 2);
}

export interface RaceTile {
  id: string;
  initials: string;
  y: number;
  /** Who leads this game in the per-game table. Compare counts a tie as Build A's; the tile shows it as a tie. */
  leader: "a" | "b" | "tie";
  /** When the leading build passes the tile. */
  flipAt: number;
}

export interface CameraState {
  scale: number;
  /** World y at the screen anchor. */
  y: number;
  /** Screen-space x offset of the track. */
  offsetX: number;
  /** Degrees. */
  tilt: number;
  shakeX: number;
  shakeY: number;
}

export interface FrameState {
  t: number;
  camera: CameraState;
  yA: number;
  yB: number;
  /** 0..1 fan spin speed, for blur and exhaust. */
  speed: number;
  /** Per tile: 0 = face up, 1 = flipped to the leader's side. */
  flip: number[];
  stamp: number;
  pullback: number;
  reveal: number;
}

export type CueKind = "rev" | "engine-start" | "flip" | "stamp" | "whoosh" | "reveal";

export interface SoundCue {
  kind: CueKind;
  at: number;
  /** For flips: which tile, so pitch can climb. */
  index?: number;
}

export interface RaceTimeline {
  figures: CompareFigures;
  names: { a: string; b: string };
  tiles: RaceTile[];
  frames: FrameState[];
  cues: SoundCue[];
  /** Distance ratio avgB / avgA the picture holds at every frame. */
  distanceRatio: number;
}

/** Up to three initials: "Red Dead Redemption 2" is "RDR", "CS2 (Counter-Strike 2)" is "CS2". */
export function initialsFor(name: string): string {
  const head = name.replace(/\(.*?\)/g, " ").trim();
  const words = head.split(/[\s:]+/).filter(Boolean);
  if (words.length === 1) return words[0].replace(/[^\p{L}\p{N}]/gu, "").slice(0, 3).toUpperCase();
  return words.map((word) => word.replace(/[^\p{L}\p{N}]/gu, "")[0] ?? "").join("").slice(0, 3).toUpperCase();
}

/** The time the build at `ratio` of the leader's pace reaches world y. */
function timeToReach(y: number, ratio: number): number {
  let low = RACE_START;
  let high = RACE_END;
  for (let step = 0; step < 50; step += 1) {
    const mid = (low + high) / 2;
    if (raceProgress(mid) * TRACK_LENGTH * ratio < y) low = mid;
    else high = mid;
  }
  return high;
}

export function buildRaceTimeline(figures: CompareFigures, rows: CompareGameRow[], names: { a: string; b: string }): RaceTimeline {
  if (figures.avgA <= figures.avgB) throw new Error(`Build A must lead on average to race in lane A (${figures.avgA} vs ${figures.avgB}).`);
  if (rows.length !== figures.games) throw new Error("The per-game rows do not match the figures' game count.");
  const distanceRatio = figures.avgB / figures.avgA;

  const tiles: RaceTile[] = rows.map((row, index) => {
    const y = lerp(TILE_FIRST_Y, TILE_LAST_Y, rows.length === 1 ? 0 : index / (rows.length - 1));
    const leader = row.fpsA > row.fpsB ? "a" : row.fpsA < row.fpsB ? "b" : "tie";
    // The tile flips when the game's leader passes it; a tie flips as both pass.
    const flipAt = timeToReach(y, leader === "a" ? 1 : distanceRatio);
    return { id: row.id, initials: initialsFor(row.name), y, leader, flipAt };
  });

  const frames: FrameState[] = [];
  for (let frame = 0; frame < FPS * DURATION_SECONDS; frame += 1) {
    const t = frame / FPS;
    const progress = raceProgress(t);
    const yA = progress * TRACK_LENGTH;
    const yB = yA * distanceRatio;
    const speed = t < RACE_START ? t / RACE_START * 0.35 : t < RACE_END ? 1 : Math.max(0, 1 - (t - RACE_END) / 0.8);

    // Close on the pair (they sit low in frame, tiles come at them from above),
    // then an exponential pull-back to the whole track.
    const intro = easeInOutCubic(clamp(t / 0.9));
    const raceScale = lerp(2.2, 1.6, intro);
    const followY = (yA + yB) / 2 + 250 / raceScale;
    const pullback = easeInOutCubic(clamp((t - PULLBACK_START) / (PULLBACK_END - PULLBACK_START)));
    const wholeScale = 1080 / (TRACK_LENGTH + 260);
    const settle = clamp((t - PULLBACK_END) / (DURATION_SECONDS - PULLBACK_END));
    const scale = Math.exp(lerp(Math.log(raceScale), Math.log(wholeScale), pullback)) * (1 + 0.035 * settle);
    const wholeY = TRACK_LENGTH / 2 - 60;
    const shake = speed * (1 - pullback) * 6;
    frames.push({
      t,
      camera: {
        scale,
        y: lerp(followY, wholeY, pullback),
        offsetX: lerp(0, 250, pullback),
        tilt: lerp(-4 * intro, 0, pullback),
        shakeX: Math.sin(t * 37.1) * shake,
        shakeY: Math.sin(t * 29.3 + 1.7) * shake,
      },
      yA,
      yB,
      speed,
      flip: tiles.map((tile) => clamp((t - tile.flipAt) / FLIP_SECONDS)),
      stamp: clamp((t - 4.72) / 0.35),
      pullback,
      reveal: clamp((t - PULLBACK_END) / 0.5),
    });
  }

  const cues = ([
    { kind: "rev", at: 0 },
    { kind: "engine-start", at: RACE_START },
    ...tiles.map((tile, index): SoundCue => ({ kind: "flip", at: tile.flipAt, index })),
    { kind: "stamp", at: 4.72 },
    { kind: "whoosh", at: PULLBACK_START },
    { kind: "reveal", at: PULLBACK_END },
  ] satisfies SoundCue[] as SoundCue[]).sort((x, y) => x.at - y.at);

  return { figures, names, tiles, frames, cues, distanceRatio };
}
