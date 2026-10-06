// MASTER #6 — Data-driven motion graphics: one more declared visual kind.
//
// WHY
//
// A Compare mission could only show the Compare page. A story told on one
// static capture fails MASTER #1's shot-variety rules, and the only way to
// pass them was to cut to OTHER settings of the same pair, whose numbers the
// claims do not cover. That traded a readability rule for a factual hazard.
//
// A data motion graphic is a short animated scene drawn from the mission's
// own primary Compare state: readable game labels, the FPS figures Compare
// shows, or a percentage computed from them. The author chooses a TEMPLATE and
// the GAMES; the author never types a number. Every figure is computed here,
// by the same functions Compare uses (leadsVsAverage/facts.ts -> fps.ts), at
// the one state the research established its claims for.
//
// WHAT KEEPS IT HONEST
//
//   - Source: a graphic must name the mission's PRIMARY capture state. A graphic
//     at another setting would put numbers on screen no claim covers.
//   - Binding: every figure a graphic shows must appear in an approved claim
//     the beat binds (see unboundGraphicFigures). A graphic cannot say more
//     than research established.
//   - Labels: the renderer always labels figures "Estimated FPS" / "estimated
//     boost", names the setting, and shows the percentage formula with the
//     values it uses. Disclosure: the estimate disclosure, as for Compare.
//   - Names: full catalog game names, resolved from games.json, never typed.
//   - Identity: each template + game set is its own picture, so variety comes
//     from showing different data, not from changing the resolution.

import games from "../../../../src/data/games.json" with { type: "json" };
import { leadsVsAverageFacts, type ComparePairing } from "../../leadsVsAverage/facts.ts";
import type { CaptureView } from "./captureViews.ts";

export const DATA_MOTION_GRAPHIC_CAPABILITY = "render.data-motion-graphic";

/**
 * The closed set of scenes the renderer draws.
 *   game-labels     the games' full names, animated in; no figures
 *   fps-change      per game: before -> after estimated FPS, counting up
 *   percent-change  per game: the estimated percentage boost, as a growing bar,
 *                   with the formula and the two values it is computed from
 */
export const DATA_MOTION_TEMPLATES = ["game-labels", "fps-change", "percent-change"] as const;
export type DataMotionTemplate = (typeof DATA_MOTION_TEMPLATES)[number];

export interface DataMotionGraphic {
  readonly kind: "data-motion-graphic";
  readonly visualId: string;
  readonly template: DataMotionTemplate;
  /** Must be the mission's primary capture state; the values are computed there. */
  readonly sourceStateIdentifier: string;
  /** Catalog game ids, 1-3, in display order. */
  readonly games: readonly string[];
  /** Which Compare build is "before" for a change: "B" means B -> A. */
  readonly baseline: "A" | "B";
}

export interface ResolvedGameFigures {
  readonly gameId: string;
  /** Full catalog name. */
  readonly name: string;
  /** Compare's displayed estimates (whole FPS), before and after. */
  readonly before: number;
  readonly after: number;
  /** Whole percent, from the two displayed estimates: round((after - before) / before * 100). */
  readonly percent: number;
  readonly formula: string;
}

export interface ResolvedDataMotionGraphic {
  readonly visualId: string;
  readonly template: DataMotionTemplate;
  readonly sourceStateIdentifier: string;
  readonly beforeBuild: string;
  readonly afterBuild: string;
  /** e.g. "1440p High". */
  readonly setting: string;
  readonly games: readonly ResolvedGameFigures[];
}

export class DataMotionGraphicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataMotionGraphicError";
  }
}

interface CatalogGame { readonly id: string; readonly name: string }
const CATALOG = games as readonly CatalogGame[];

/** Percentage change between two displayed estimates, rounded to a whole percent. */
export function percentChange(before: number, after: number): number {
  if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0) throw new DataMotionGraphicError("A percentage needs a positive baseline.");
  return Math.round(((after - before) / before) * 100);
}

/** Problems that need no mission context: template, games, baseline. */
export function dataMotionGraphicDefects(visual: DataMotionGraphic): string[] {
  const defects: string[] = [];
  if (!(DATA_MOTION_TEMPLATES as readonly string[]).includes(visual.template)) {
    defects.push(`Unknown template "${visual.template}". Use one of: ${DATA_MOTION_TEMPLATES.join(", ")}.`);
  }
  if (!Array.isArray(visual.games) || visual.games.length < 1 || visual.games.length > 3) {
    defects.push("A motion graphic shows one to three games.");
  } else {
    if (new Set(visual.games).size !== visual.games.length) defects.push("A game is listed twice.");
    for (const id of visual.games) {
      if (!CATALOG.some((game) => game.id === id)) defects.push(`Unknown game id "${id}"; names come from the catalog, never typed.`);
    }
  }
  if (visual.baseline !== "A" && visual.baseline !== "B") defects.push('baseline must be "A" or "B".');
  if (typeof visual.sourceStateIdentifier !== "string" || !visual.sourceStateIdentifier.trim()) {
    defects.push("A motion graphic must name the Compare state its values come from.");
  }
  return defects;
}

const capitalise = (value: string) => `${value[0].toUpperCase()}${value.slice(1)}`;

/**
 * Computes everything the graphic shows, from the primary view. Refuses a
 * graphic sourced from any other state, or a game Compare does not list.
 */
export function resolveDataMotionGraphic(visual: DataMotionGraphic, views: readonly CaptureView[]): ResolvedDataMotionGraphic {
  const defects = dataMotionGraphicDefects(visual);
  if (defects.length) throw new DataMotionGraphicError(`${visual.visualId}: ${defects.join(" ")}`);
  const view = views.find((entry) => entry.stateIdentifier === visual.sourceStateIdentifier);
  if (!view) throw new DataMotionGraphicError(`${visual.visualId}: ${visual.sourceStateIdentifier} is not a view of this mission.`);
  if (!view.primary) {
    throw new DataMotionGraphicError(`${visual.visualId}: values must come from the primary view, the one the claims were established for; ${visual.sourceStateIdentifier} is not it.`);
  }
  const state = view.request.state;
  if (state.surface !== "compare") throw new DataMotionGraphicError(`${visual.visualId}: motion graphics are computed from a Compare state.`);
  const pairing: ComparePairing = {
    gpuA: state.gpuA, cpuA: state.cpuA, gpuB: state.gpuB, cpuB: state.cpuB,
    resolution: state.resolution ?? "1440p", preset: state.preset ?? "high",
  };
  const facts = leadsVsAverageFacts(pairing);
  const resolved = visual.games.map((id) => {
    const name = CATALOG.find((game) => game.id === id)!.name;
    const row = facts.games.find((entry) => entry.game === name);
    if (!row) throw new DataMotionGraphicError(`${visual.visualId}: Compare shows no estimate for ${name}.`);
    const before = visual.baseline === "B" ? row.fpsB : row.fpsA;
    const after = visual.baseline === "B" ? row.fpsA : row.fpsB;
    return { gameId: id, name, before, after, percent: percentChange(before, after), formula: `(${after} − ${before}) ÷ ${before}` };
  });
  return {
    visualId: visual.visualId,
    template: visual.template,
    sourceStateIdentifier: visual.sourceStateIdentifier,
    beforeBuild: visual.baseline === "B" ? facts.buildB : facts.buildA,
    afterBuild: visual.baseline === "B" ? facts.buildA : facts.buildB,
    setting: `${pairing.resolution} ${capitalise(pairing.preset)}`,
    games: resolved,
  };
}

/** Every figure the graphic puts on screen, as the text a claim must contain. */
export function figuresShown(graphic: ResolvedDataMotionGraphic): string[] {
  if (graphic.template === "game-labels") return [];
  if (graphic.template === "fps-change") return graphic.games.flatMap((game) => [String(game.before), String(game.after)]);
  return graphic.games.flatMap((game) => [String(game.before), String(game.after), `${game.percent}%`]);
}

const containsFigure = (text: string, figure: string) =>
  new RegExp(`(^|[^0-9.])${figure.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![0-9])`).test(text);

/**
 * Figures a beat's graphics show that no approved claim bound on that beat
 * states. Empty means every number on screen is covered by research.
 */
export function unboundGraphicFigures(input: {
  readonly beats: readonly { readonly visualIds: readonly string[]; readonly factDependencies: readonly string[] }[];
  readonly graphics: readonly ResolvedDataMotionGraphic[];
  readonly approvedPropositions: Readonly<Record<string, string>>;
}): { readonly beat: number; readonly visualId: string; readonly figure: string }[] {
  const out: { beat: number; visualId: string; figure: string }[] = [];
  input.beats.forEach((beat, index) => {
    const bound = beat.factDependencies.map((id) => input.approvedPropositions[id]).filter((text): text is string => typeof text === "string");
    for (const graphic of input.graphics.filter((entry) => beat.visualIds.includes(entry.visualId))) {
      for (const figure of figuresShown(graphic)) {
        if (!bound.some((text) => containsFigure(text, figure))) out.push({ beat: index + 1, visualId: graphic.visualId, figure });
      }
    }
  });
  return out;
}

/** The picture a graphic puts on screen, for shot-variety: template, games and state. */
export function dataMotionGraphicIdentity(visual: DataMotionGraphic): string {
  return `data-motion-graphic:${visual.template}:${visual.games.join("+")}:${visual.baseline}:${visual.sourceStateIdentifier}`;
}

/** SpecSmith's own palette (src/index.css, --ff-*). */
export const SPECSMITH_MOTION_COLOURS = {
  background: "#0A0A0F",
  surface: "#13131A",
  card: "#1C1C26",
  text: "#F0F0FF",
  textSecondary: "#8888AA",
  accent: "#6C63FF",
  accentText: "#9B94FF",
  cyan: "#00D4FF",
  green: "#00E676",
  amber: "#FFB300",
} as const;

/** Minimum on-screen type in the 1080px-wide frame: figures and names, and the smallest label. */
export const MOTION_MIN_PRIMARY_PX = 64;
export const MOTION_MIN_LABEL_PX = 34;
