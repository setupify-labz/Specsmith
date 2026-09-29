// The GPU race draft (12-15 s, narrated), as one timeline.
//
// THE METAPHOR, AND WHY IT IS HONEST. Both GPUs share one clock and each
// covers distance at its modelled average FPS, so in every frame the RTX 4080
// has covered exactly avgB/avgA of the Super's distance, even while the clock
// slows for a spotlight. A game tile sits where the build that leads that game
// in Compare's per-game table is when its flip lands, so a tile flips as its
// leader passes it. The counter counts flipped tiles, nothing else.
//
// CUTS FOLLOW THE VOICE. Every beat is placed from the measured length of the
// narration lines: the race starts as the hook line ends, the leads line ends
// as the counter reaches its total, the pull-back starts as that line ends,
// and the reveal lands with the lines that say it. A different voice (the
// intended Liam take) re-times the whole cut from its own measured lines.
//
// ONE TIMELINE FOR PICTURE AND SOUND. Camera, positions, tile states, counter,
// sound cues and line start times are all computed here; the page and the
// mixer only use what they are given.

import type { CompareFigures, CompareGameRow } from "../resultCards/compareFigures.ts";
import { spokenFigure } from "../spokenWords.ts";

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const MIN_DURATION_SECONDS = 12;
export const MAX_DURATION_SECONDS = 15;

/** World units from start line to finish line. */
export const TRACK_LENGTH = 3000;
/** Lane centres, left for Build A. */
export const LANE_X = { a: -170, b: 170 } as const;
/** A GPU card, nose at its y, body trailing behind. */
export const GPU_SIZE = { width: 130, length: 240 } as const;
/** Tile edge in world units: small enough that the closest two never touch. */
export const TILE_SIZE = 58;

/** Games that get a named pause, in flip order. Every one must be a Build A lead. */
export const SPOTLIGHT_GAME_IDS = ["fortnite", "warzone", "bg3"] as const;

/** The first flip lands this early, so the hook is already moving. */
export const FIRST_FLIP_AT = 0.7;

/** The shortest the flip section may be, first flip to last. It stretches to fit the voice. */
const MIN_FLIP_SECTION_SECONDS = 5.2;
/** Seconds each spotlight holds its game's name. */
const SPOTLIGHT_SECONDS = 1.0;
/** Race-clock speed during a spotlight: a slow-motion pass. */
const SPOTLIGHT_SPEED = 0.16;
const FLIP_SECONDS = 0.3;
const PULLBACK_SECONDS = 1.3;
const END_HOLD_SECONDS = 1.0;

const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const easeInOutCubic = (u: number) => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2);
const lerp = (from: number, to: number, u: number) => from + (to - from) * u;
const smooth = (edge0: number, edge1: number, x: number) => {
  const u = clamp((x - edge0) / (edge1 - edge0));
  return u * u * (3 - 2 * u);
};
const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export type LineId = "matchup" | "flips" | "leads" | "average" | "gap";

export interface NarrationLine {
  id: LineId;
  text: string;
}

/**
 * The narration, with every figure written from the figures as it is said.
 * "Forty-eighty" is the part name, not a figure (spokenWords.ts skips it).
 */
export function narrationLines(figures: CompareFigures): NarrationLine[] {
  const outright = figures.leadsA - figures.ties;
  return [
    { id: "matchup", text: "Forty-eighty Super versus forty-eighty." },
    { id: "flips", text: "Game after game, the Super takes the lead." },
    { id: "leads", text: `${capitalise(spokenFigure(outright))} of ${spokenFigure(figures.games)} modelled leads.` },
    { id: "average", text: `Yet on average, ${spokenFigure(figures.avgA)} to ${spokenFigure(figures.avgB)}.` },
    { id: "gap", text: `Just ${spokenFigure(figures.avgA - figures.avgB)} FPS apart.` },
  ];
}

/**
 * What a caption shows for each line: the same words, with figures as digits
 * so they read at a glance. Every figure comes from the figures, as the
 * narration's do. Each comma starts a new caption chunk.
 */
export function captionTexts(figures: CompareFigures, names: { a: string; b: string }): Record<LineId, string> {
  const outright = figures.leadsA - figures.ties;
  return {
    matchup: `${names.a} vs ${names.b}`,
    flips: "Game after game, the Super takes the lead",
    leads: `${outright} of ${figures.games} modelled leads`,
    average: `Yet on average, ${figures.avgA} to ${figures.avgB}`,
    gap: `Just ${figures.avgA - figures.avgB} FPS apart`,
  };
}

/** One on-screen caption chunk and when it shows. */
export interface Caption {
  line: LineId;
  text: string;
  start: number;
  end: number;
}

/** Longest caption chunk, in characters: one line at caption size on a 1080-wide frame. */
export const MAX_CAPTION_CHARACTERS = 30;

export interface RaceTile {
  id: string;
  name: string;
  y: number;
  /** Who leads this game in the per-game table. Compare counts a tie as Build A's; the tile shows it as a tie. */
  leader: "a" | "b" | "tie";
  flipAt: number;
  spotlight: boolean;
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
  /** 0..1 how fast the race clock runs, for blur, trails and fans. */
  speed: number;
  /** Per tile: 0 = face down, 1 = flipped to the leader's side. */
  flip: number[];
  /** Leads shown on the counter: tiles past half-flip whose leader is Build A. */
  count: number;
  /** 0..1 pop after the counter last changed. */
  countPop: number;
  /** Index of the tile whose name is on screen, and 0..1 how far in. */
  spotlight: { tile: number; amount: number } | null;
  /** 0..1 counter reaching its total and settling into the result. */
  complete: number;
  pullback: number;
  /** 0..1 the lens and the averages. */
  reveal: number;
  /** 0..1 the "yet only N FPS apart" line. */
  verdict: number;
}

export type CueKind = "engine-start" | "flip" | "spotlight" | "complete" | "whoosh" | "reveal" | "verdict";

export interface SoundCue {
  kind: CueKind;
  at: number;
  /** For flips: which tile, so the pitch can climb. */
  index?: number;
}

export interface PlacedLine extends NarrationLine {
  start: number;
  seconds: number;
}

export interface RaceTimeline {
  figures: CompareFigures;
  names: { a: string; b: string };
  tiles: RaceTile[];
  frames: FrameState[];
  cues: SoundCue[];
  lines: PlacedLine[];
  captions: Caption[];
  durationSeconds: number;
  /** Distance ratio avgB / avgA the picture holds at every frame. */
  distanceRatio: number;
}

export class RaceTimelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RaceTimelineError";
  }
}

/** Flip times: evenly spaced, except that a spotlighted flip holds for SPOTLIGHT_SECONDS. */
function flipSchedule(count: number, spotlit: Set<number>, start: number, sectionSeconds: number): number[] {
  const normalGaps = count - 1 - [...spotlit].filter((index) => index < count - 1).length;
  const holds = [...spotlit].filter((index) => index < count - 1).length * SPOTLIGHT_SECONDS;
  const gap = (sectionSeconds - holds) / Math.max(1, normalGaps);
  if (gap < 0.12) throw new RaceTimelineError("The flip section is too short for its spotlights.");
  const times = [start];
  for (let index = 1; index < count; index += 1) times.push(times[index - 1] + (spotlit.has(index - 1) ? SPOTLIGHT_SECONDS : gap));
  return times;
}

export function buildRaceTimeline(
  figures: CompareFigures,
  rows: CompareGameRow[],
  names: { a: string; b: string },
  lineSeconds: Record<LineId, number>,
): RaceTimeline {
  if (figures.avgA <= figures.avgB) throw new RaceTimelineError(`Build A must lead on average to race in lane A (${figures.avgA} vs ${figures.avgB}).`);
  if (rows.length !== figures.games) throw new RaceTimelineError("The per-game rows do not match the figures' game count.");
  const distanceRatio = figures.avgB / figures.avgA;
  const leaderOf = (row: CompareGameRow) => (row.fpsA > row.fpsB ? "a" : row.fpsA < row.fpsB ? "b" : "tie") as RaceTile["leader"];

  const spotlit = new Set<number>();
  for (const id of SPOTLIGHT_GAME_IDS) {
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) throw new RaceTimelineError(`Spotlight game "${id}" is not in Compare's games.`);
    if (leaderOf(rows[index]) !== "a") throw new RaceTimelineError(`Spotlight game "${id}" is not a ${names.a} lead; its card would say otherwise.`);
    spotlit.add(index);
  }

  // Beats placed from the voice.
  const lines = narrationLines(figures);
  const seconds = (id: LineId) => {
    const value = lineSeconds[id];
    if (!(value > 0)) throw new RaceTimelineError(`No measured length for the "${id}" line.`);
    return value;
  };
  const place: PlacedLine[] = [];
  const matchupStart = 0.25;
  // The race is under way from the first frame and the first flip lands inside a
  // second; the hook line plays over it.
  const raceStart = 0.1;
  const firstFlip = FIRST_FLIP_AT;
  const flipsStart = matchupStart + seconds("matchup") + 0.15;
  // The flips keep coming until the flips line has been said; the leads line
  // starts as the counter reaches its total, so nothing says 20 before the counter does.
  const sectionSeconds = Math.max(MIN_FLIP_SECTION_SECONDS, flipsStart + seconds("flips") + 0.1 - FLIP_SECONDS / 2 - firstFlip);
  const flipAt = flipSchedule(rows.length, spotlit, firstFlip, sectionSeconds);
  const lastFlip = flipAt.at(-1)!;
  const countComplete = lastFlip + FLIP_SECONDS / 2;
  const leadsStart = countComplete + 0.05;
  const leadsEnd = leadsStart + seconds("leads");
  // The pull-back begins as the leads line finishes; the next line waits for both.
  const pullStart = Math.max(countComplete + 0.35, leadsEnd - 0.3);
  const pullEnd = pullStart + PULLBACK_SECONDS;
  const averageStart = Math.max(pullStart + 0.25, leadsEnd + 0.15);
  const gapStart = Math.max(averageStart + seconds("average") + 0.15, pullEnd + 0.4);
  const durationSeconds = Number((gapStart + seconds("gap") + END_HOLD_SECONDS).toFixed(3));
  place.push(
    { ...lines[0], start: matchupStart, seconds: seconds("matchup") },
    { ...lines[1], start: flipsStart, seconds: seconds("flips") },
    { ...lines[2], start: leadsStart, seconds: seconds("leads") },
    { ...lines[3], start: averageStart, seconds: seconds("average") },
    { ...lines[4], start: gapStart, seconds: seconds("gap") },
  );
  if (durationSeconds < MIN_DURATION_SECONDS || durationSeconds > MAX_DURATION_SECONDS) {
    throw new RaceTimelineError(`This voice makes a ${durationSeconds.toFixed(2)}s cut; the draft must run ${MIN_DURATION_SECONDS}-${MAX_DURATION_SECONDS}s.`);
  }
  // The averages appear as they are said: after "Yet on average," (three of the line's words).
  const averagesShown = averageStart + seconds("average") * (3 / lines[3].text.split(/\s+/).length);
  const raceEnd = pullEnd - 0.1;

  // The race clock: full speed, slowed through each spotlight. Both GPUs run on it.
  const speedAt = (t: number) => {
    if (t < raceStart) return 0;
    let speed = smooth(raceStart, raceStart + 0.6, t);
    for (const index of spotlit) {
      const at = flipAt[index];
      // Slows from the flip itself, so the tile before it keeps its full spacing.
      const into = smooth(at - 0.02, at + 0.2, t) * (1 - smooth(at + SPOTLIGHT_SECONDS - 0.25, at + SPOTLIGHT_SECONDS - 0.05, t));
      speed *= 1 - (1 - SPOTLIGHT_SPEED) * into;
    }
    return t > raceEnd ? 0 : speed;
  };
  const step = 1 / 1200;
  const clock: number[] = [0];
  for (let i = 1; i * step <= durationSeconds + step; i += 1) clock.push(clock[i - 1] + speedAt((i - 0.5) * step) * step);
  const clockAt = (t: number) => {
    const exact = clamp(t, 0, durationSeconds) / step;
    const low = Math.floor(exact);
    return lerp(clock[low], clock[Math.min(low + 1, clock.length - 1)], exact - low);
  };
  const total = clockAt(raceEnd);
  const leaderY = (t: number) => (clockAt(t) / total) * TRACK_LENGTH;

  const tiles: RaceTile[] = rows.map((row, index) => {
    const leader = leaderOf(row);
    // The tile sits where its leader is when it flips; a tie sits at Build B, which is level at that moment only in the tile's sense.
    const y = leaderY(flipAt[index]) * (leader === "a" ? 1 : distanceRatio);
    return { id: row.id, name: row.name, y, leader, flipAt: flipAt[index], spotlight: spotlit.has(index) };
  });
  for (let index = 1; index < tiles.length; index += 1) {
    if (Math.abs(tiles[index].y - tiles[index - 1].y) < TILE_SIZE * 1.05) {
      throw new RaceTimelineError(`Tiles ${index - 1} and ${index} would overlap on the track.`);
    }
  }

  const frameCount = Math.round(durationSeconds * FPS);
  const frames: FrameState[] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const t = frame / FPS;
    const yA = leaderY(t);
    const yB = yA * distanceRatio;
    const speed = speedAt(t);
    const flip = tiles.map((tile) => clamp((t - tile.flipAt) / FLIP_SECONDS));
    const flipped = tiles.filter((tile, index) => flip[index] >= 0.5);
    const count = flipped.filter((tile) => tile.leader === "a").length;
    const lastChange = flipped.length ? Math.max(...flipped.map((tile) => tile.flipAt + FLIP_SECONDS / 2)) : -1;
    const lit = tiles.findIndex((tile) => tile.spotlight && t >= tile.flipAt - 0.1 && t < tile.flipAt + SPOTLIGHT_SECONDS - 0.05);
    const spotAmount = lit < 0 ? 0 : Math.min(smooth(tiles[lit].flipAt - 0.1, tiles[lit].flipAt + 0.15, t),
      1 - smooth(tiles[lit].flipAt + SPOTLIGHT_SECONDS - 0.3, tiles[lit].flipAt + SPOTLIGHT_SECONDS - 0.05, t));

    // Close on the pair, noses at the anchor, tiles coming at them from above;
    // a push-in through each spotlight; then an exponential pull-back.
    const intro = easeInOutCubic(clamp(t / 1.2));
    const raceScale = lerp(2.2, 1.6, intro) * (1 + 0.18 * spotAmount);
    const followY = (yA + yB) / 2 - 40 / raceScale;
    const pullback = easeInOutCubic(clamp((t - pullStart) / PULLBACK_SECONDS));
    const wholeScale = 1080 / (TRACK_LENGTH + 260);
    const settle = clamp((t - pullEnd) / (durationSeconds - pullEnd));
    const scale = Math.exp(lerp(Math.log(raceScale), Math.log(wholeScale), pullback)) * (1 + 0.03 * settle);
    const shake = speed * (1 - pullback) * 5;
    frames.push({
      t,
      camera: {
        scale,
        y: lerp(followY, TRACK_LENGTH / 2 - 60, pullback),
        offsetX: lerp(0, 250, pullback),
        tilt: lerp(-4 * intro * (1 - spotAmount), 0, pullback),
        shakeX: Math.sin(t * 37.1) * shake,
        shakeY: Math.sin(t * 29.3 + 1.7) * shake,
      },
      yA,
      yB,
      speed,
      flip,
      count,
      countPop: lastChange < 0 ? 0 : 1 - clamp((t - lastChange) / 0.25),
      spotlight: lit < 0 || spotAmount <= 0 ? null : { tile: lit, amount: spotAmount },
      complete: clamp((t - countComplete) / 0.4),
      pullback,
      reveal: clamp((t - averagesShown) / 0.45),
      verdict: clamp((t - gapStart) / 0.45),
    });
  }

  const cues = ([
    { kind: "engine-start", at: raceStart },
    ...tiles.map((tile, index): SoundCue => ({ kind: "flip", at: tile.flipAt, index })),
    ...tiles.filter((tile) => tile.spotlight).map((tile): SoundCue => ({ kind: "spotlight", at: tile.flipAt - 0.1 })),
    { kind: "complete", at: countComplete },
    { kind: "whoosh", at: pullStart },
    { kind: "reveal", at: averagesShown },
    { kind: "verdict", at: gapStart },
  ] satisfies SoundCue[] as SoundCue[]).sort((x, y) => x.at - y.at);

  // Captions: each line split at its commas, each chunk shown from where its
  // words start in the line (by share of words) until the next chunk, or a
  // beat after the line ends.
  const texts = captionTexts(figures, names);
  const captions: Caption[] = [];
  place.forEach((entry, index) => {
    const chunks = texts[entry.id].split(/,\s*/).map((chunk, at, all) => (at < all.length - 1 ? `${chunk},` : chunk));
    const words = chunks.map((chunk) => chunk.split(/\s+/).length);
    const total = words.reduce((sum, count) => sum + count, 0);
    const nextLine = place[index + 1]?.start ?? durationSeconds;
    let before = 0;
    chunks.forEach((chunk, at) => {
      if (chunk.length > MAX_CAPTION_CHARACTERS) throw new RaceTimelineError(`Caption "${chunk}" is longer than one line.`);
      const start = entry.start + entry.seconds * (before / total);
      before += words[at];
      const end = at < chunks.length - 1 ? entry.start + entry.seconds * (before / total) : Math.min(entry.start + entry.seconds + 0.35, nextLine - 0.05);
      captions.push({ line: entry.id, text: chunk, start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) });
    });
  });

  return { figures, names, tiles, frames, cues, lines: place, captions, durationSeconds, distanceRatio };
}
