// What SpecSmith Compare shows for two builds at one setting, computed with
// the page's own functions and data files.
//
// A result card may state only these figures. They are model estimates: the
// same estimateFpsForBuild the Compare page calls, averaged with the page's
// getAverageFps, over the page's games list. Nothing here is a measurement.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { estimateFpsForBuild } from "../../../src/lib/fps.ts";
import { getAverageFps } from "../../../src/lib/compareValue.ts";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..", "..", "..");
const DATA_FILES = {
  gpus: join(appRoot, "src", "data", "gpus.json"),
  cpus: join(appRoot, "src", "data", "cpus.json"),
  games: join(appRoot, "src", "data", "games.json"),
} as const;

export type CompareResolution = "1080p" | "1440p" | "4k";
export type ComparePreset = "high" | "ultra";

export interface CompareSetting {
  resolution: CompareResolution;
  preset: ComparePreset;
}

export interface CompareBuild {
  gpu: string;
  cpu: string;
}

export interface CompareBuildPair {
  a: CompareBuild;
  b: CompareBuild;
}

/** One setting's figures, as the Compare page renders them. */
export interface CompareFigures extends CompareSetting {
  /** "Est. Avg FPS" per build. */
  avgA: number;
  avgB: number;
  /** "Modelled Game Leads". The page counts a tie as Build A's lead, so ties are also kept apart. */
  leadsA: number;
  leadsB: number;
  ties: number;
  games: number;
}

type Row = Record<string, unknown> & { id: string; name?: string };

export interface CompareData {
  gpus: Row[];
  cpus: Row[];
  games: Row[];
  /** Repository path and SHA-256 of each data file the figures were computed from. */
  sources: { path: string; sha256: string }[];
}

export class CompareFiguresError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompareFiguresError";
  }
}

export async function loadCompareData(): Promise<CompareData> {
  const entries = await Promise.all(
    Object.entries(DATA_FILES).map(async ([key, path]) => {
      const bytes = await readFile(path);
      return {
        key,
        rows: JSON.parse(bytes.toString("utf8")) as Row[],
        source: { path: relative(join(appRoot, "..", ".."), path), sha256: createHash("sha256").update(bytes).digest("hex") },
      };
    }),
  );
  const rows = (key: string) => entries.find((entry) => entry.key === key)!.rows;
  return { gpus: rows("gpus"), cpus: rows("cpus"), games: rows("games"), sources: entries.map((entry) => entry.source) };
}

function part(rows: Row[], id: string, kind: string): Row {
  const row = rows.find((candidate) => candidate.id === id);
  // No near-match: an unknown id is refused, never guessed.
  if (!row) throw new CompareFiguresError(`Unknown ${kind} "${id}". Refusing to state figures for it.`);
  return row;
}

/** The display name the Compare page shows for a part. */
export function partName(data: CompareData, kind: "gpu" | "cpu", id: string): string {
  const row = part(kind === "gpu" ? data.gpus : data.cpus, id, kind.toUpperCase());
  if (typeof row.name !== "string" || !row.name.trim()) throw new CompareFiguresError(`${kind} "${id}" has no name.`);
  return row.name;
}

/** One row of the page's per-game table: each build's estimated FPS in one game. */
export interface CompareGameRow {
  id: string;
  name: string;
  fpsA: number;
  fpsB: number;
}

export function compareGamesFor(data: CompareData, builds: CompareBuildPair, setting: CompareSetting): CompareGameRow[] {
  if (data.games.length === 0) throw new CompareFiguresError("Compare has no games to model.");
  const gpuA = part(data.gpus, builds.a.gpu, "GPU");
  const cpuA = part(data.cpus, builds.a.cpu, "CPU");
  const gpuB = part(data.gpus, builds.b.gpu, "GPU");
  const cpuB = part(data.cpus, builds.b.cpu, "CPU");
  const { resolution, preset } = setting;
  return data.games.map((game) => ({
    id: game.id,
    name: String(game.name ?? game.id),
    fpsA: estimateFpsForBuild(gpuA as never, cpuA as never, game as never, resolution as never, preset as never).estimated,
    fpsB: estimateFpsForBuild(gpuB as never, cpuB as never, game as never, resolution as never, preset as never).estimated,
  }));
}

export function compareFiguresFor(data: CompareData, builds: CompareBuildPair, setting: CompareSetting): CompareFigures {
  const { resolution, preset } = setting;
  const pairs = compareGamesFor(data, builds, setting).map((row) => [row.fpsA, row.fpsB]);
  return {
    resolution,
    preset,
    avgA: getAverageFps(pairs.map(([fpsA]) => fpsA)),
    avgB: getAverageFps(pairs.map(([, fpsB]) => fpsB)),
    leadsA: pairs.filter(([fpsA, fpsB]) => fpsA >= fpsB).length,
    leadsB: pairs.filter(([fpsA, fpsB]) => fpsA < fpsB).length,
    ties: pairs.filter(([fpsA, fpsB]) => fpsA === fpsB).length,
    games: pairs.length,
  };
}
