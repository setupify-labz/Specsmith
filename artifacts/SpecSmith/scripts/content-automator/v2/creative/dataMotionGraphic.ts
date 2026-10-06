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
//   - Binding: every value a graphic shows must be covered, as one tuple, by
//     the structured evidence of an approved claim the beat binds: the same
//     game, setting, CPU, before and after GPU, and the same values (see
//     unsupportedGraphicValues). Matching digits in a sentence is not enough.
//   - Labels: the renderer always labels figures "Estimated FPS" / "estimated
//     boost", names the setting, and shows the percentage formula with the
//     values it uses. Disclosure: the estimate disclosure, as for Compare.
//   - Names: full catalog game names, resolved from games.json, never typed.
//   - Identity: each template + game set is its own picture, so variety comes
//     from showing different data, not from changing the resolution.

import games from "../../../../src/data/games.json" with { type: "json" };
import gpuCatalog from "../../../../src/data/gpus.json" with { type: "json" };
import cpuCatalog from "../../../../src/data/cpus.json" with { type: "json" };
import type { ClaimEvidenceValues } from "../research/creativeContract.ts";
import { leadsVsAverageFacts, type ComparePairing } from "../../leadsVsAverage/facts.ts";
import type { CaptureView } from "./captureViews.ts";

export const DATA_MOTION_GRAPHIC_CAPABILITY = "render.data-motion-graphic";

/**
 * The closed set of scenes the renderer draws.
 *   upgrade-intro   the mission's question as a headline, the GPU upgrade shown
 *                   once, then the games' full names as large panels; no figures
 *   game-labels     the games' full names, animated in; no figures
 *   fps-change      per game: before -> after estimated FPS, counting up
 *   percent-change  per game: the estimated percentage boost, as a growing bar,
 *                   with the formula and the two values it is computed from
 */
export const DATA_MOTION_TEMPLATES = ["upgrade-intro", "game-labels", "fps-change", "percent-change"] as const;
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

export interface CatalogPart { readonly id: string; readonly name: string }

export interface ResolvedDataMotionGraphic {
  readonly visualId: string;
  readonly template: DataMotionTemplate;
  readonly sourceStateIdentifier: string;
  readonly beforeBuild: string;
  readonly afterBuild: string;
  /** The parts either side of the change. One CPU when only the GPU changes. */
  readonly beforeGpu: CatalogPart;
  readonly afterGpu: CatalogPart;
  readonly beforeCpu: CatalogPart;
  readonly afterCpu: CatalogPart;
  readonly resolution: string;
  readonly preset: string;
  /** e.g. "1440p High". */
  readonly setting: string;
  /** upgrade-intro only: the mission's own viewer question, never author text. */
  readonly headline: string | null;
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
export function resolveDataMotionGraphic(visual: DataMotionGraphic, views: readonly CaptureView[], context: { readonly viewerQuestion?: string } = {}): ResolvedDataMotionGraphic {
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
  const part = (list: unknown, id: string): CatalogPart => {
    const found = (list as CatalogPart[]).find((entry) => entry.id === id);
    if (!found) throw new DataMotionGraphicError(`${visual.visualId}: ${id} is not in the catalog.`);
    return { id: found.id, name: found.name };
  };
  const [before, after] = visual.baseline === "B" ? ["B", "A"] as const : ["A", "B"] as const;
  const gpuOf = (side: "A" | "B") => part(gpuCatalog, side === "A" ? pairing.gpuA : pairing.gpuB);
  const cpuOf = (side: "A" | "B") => part(cpuCatalog, side === "A" ? pairing.cpuA : pairing.cpuB);
  if (visual.template === "upgrade-intro" && !context.viewerQuestion?.trim()) {
    throw new DataMotionGraphicError(`${visual.visualId}: upgrade-intro shows the mission's question, and none was given.`);
  }
  return {
    visualId: visual.visualId,
    template: visual.template,
    sourceStateIdentifier: visual.sourceStateIdentifier,
    beforeBuild: visual.baseline === "B" ? facts.buildB : facts.buildA,
    afterBuild: visual.baseline === "B" ? facts.buildA : facts.buildB,
    beforeGpu: gpuOf(before), afterGpu: gpuOf(after), beforeCpu: cpuOf(before), afterCpu: cpuOf(after),
    resolution: pairing.resolution, preset: pairing.preset,
    setting: `${pairing.resolution} ${capitalise(pairing.preset)}`,
    headline: visual.template === "upgrade-intro" ? context.viewerQuestion!.trim() : null,
    games: resolved,
  };
}

/**
 * One value tuple the graphic puts on screen: a game's before and after
 * estimates (and percentage, for percent-change), at one setting, for one
 * pairing, one way round. Approval has to cover the whole tuple.
 */
export interface ShownValues {
  readonly gameId: string;
  readonly resolution: string;
  readonly preset: string;
  readonly cpu: string;
  readonly beforeGpu: string;
  readonly afterGpu: string;
  readonly before: number;
  readonly after: number;
  readonly percent: number | null;
}

/** Every value tuple the graphic shows. Label templates show none. */
export function valuesShown(graphic: ResolvedDataMotionGraphic): ShownValues[] {
  if (graphic.template !== "fps-change" && graphic.template !== "percent-change") return [];
  if (graphic.beforeCpu.id !== graphic.afterCpu.id) {
    throw new DataMotionGraphicError(`${graphic.visualId}: the CPU changes too, so the figures are not a GPU upgrade's alone; no claim shape covers that.`);
  }
  return graphic.games.map((game) => ({
    gameId: game.gameId, resolution: graphic.resolution, preset: graphic.preset, cpu: graphic.beforeCpu.id,
    beforeGpu: graphic.beforeGpu.id, afterGpu: graphic.afterGpu.id, before: game.before, after: game.after,
    percent: graphic.template === "percent-change" ? game.percent : null,
  }));
}

const same = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

/** Whether one observation covers the whole tuple: game, setting, pairing, direction and values. */
export function evidenceCovers(evidence: ClaimEvidenceValues, shown: ShownValues): boolean {
  const config = evidence.configuration ?? {};
  const fields = evidence.fields;
  return same(config.gameId, shown.gameId) && same(config.resolution, shown.resolution) && same(config.preset, shown.preset) &&
    same(fields.cpu, shown.cpu) && same(fields.beforeGpu, shown.beforeGpu) && same(fields.afterGpu, shown.afterGpu) &&
    fields.estimatedFpsBefore === shown.before && fields.estimatedFpsAfter === shown.after &&
    (shown.percent === null || fields.percent === shown.percent);
}

/**
 * Value tuples a beat's graphics show that no approved claim bound on that
 * beat covers through its structured evidence. Empty means every value on
 * screen is approved for that game, setting, pairing and direction.
 */
export function unsupportedGraphicValues(input: {
  readonly beats: readonly { readonly visualIds: readonly string[]; readonly factDependencies: readonly string[] }[];
  readonly graphics: readonly ResolvedDataMotionGraphic[];
  readonly approvedClaims: readonly { readonly claimId: string; readonly evidence?: readonly ClaimEvidenceValues[] }[];
}): { readonly beat: number; readonly visualId: string; readonly shown: ShownValues }[] {
  const out: { beat: number; visualId: string; shown: ShownValues }[] = [];
  input.beats.forEach((beat, index) => {
    const evidence = input.approvedClaims.filter((claim) => beat.factDependencies.includes(claim.claimId)).flatMap((claim) => claim.evidence ?? []);
    for (const graphic of input.graphics.filter((entry) => beat.visualIds.includes(entry.visualId))) {
      for (const shown of valuesShown(graphic)) {
        if (!evidence.some((entry) => evidenceCovers(entry, shown))) out.push({ beat: index + 1, visualId: graphic.visualId, shown });
      }
    }
  });
  return out;
}

export const describeShown = (shown: ShownValues) =>
  `${shown.gameId} ${shown.before} → ${shown.after}${shown.percent === null ? "" : ` (${shown.percent}%)`} at ${shown.resolution} ${shown.preset}, ${shown.beforeGpu} → ${shown.afterGpu} with ${shown.cpu}`;

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
