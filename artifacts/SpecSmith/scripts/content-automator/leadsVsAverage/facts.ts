// The facts behind the "leads vs average" animation, computed from the shipped
// model at build time. Nothing here is typed in by hand: change the model or
// the catalog and every number in the video changes with it.
//
// The same estimate, tally and averaging functions Compare uses are called
// here, so the video cannot say "10 to 7" while the page says something else
// (compareIntegrity.test.tsx pins the page to the same numbers).

import gpus from "../../../src/data/gpus.json" with { type: "json" };
import cpus from "../../../src/data/cpus.json" with { type: "json" };
import games from "../../../src/data/games.json" with { type: "json" };
import { estimateFpsForBuild, type BuildFpsCpu, type BuildFpsGame, type BuildFpsGpu } from "../../../src/lib/fps.ts";
import { getAverageFps } from "../../../src/lib/compareValue.ts";
import { gameOutcome, tallyModelledLeads, type GameOutcome, type ModelledTally } from "../../../src/lib/compareTally.ts";

export interface ComparePairing {
  readonly gpuA: string;
  readonly cpuA: string;
  readonly gpuB: string;
  readonly cpuB: string;
  readonly resolution: "1080p" | "1440p" | "4k";
  readonly preset: "low" | "medium" | "high" | "ultra";
}

export interface GameEstimate {
  readonly game: string;
  readonly fpsA: number;
  readonly fpsB: number;
  /** fpsA - fpsB. */
  readonly margin: number;
  readonly outcome: GameOutcome;
}

export interface LeadsVsAverageFacts {
  readonly pairing: ComparePairing;
  readonly buildA: string;
  readonly buildB: string;
  readonly games: readonly GameEstimate[];
  readonly tally: ModelledTally;
  /** As Compare displays them: rounded means of the per-game estimates. */
  readonly averageA: number;
  readonly averageB: number;
  /** The smallest and largest margin among each build's own leads, in FPS. */
  readonly leadRangeA: readonly [number, number];
  readonly leadRangeB: readonly [number, number];
}

const byId = <T>(list: unknown, id: string, kind: string): T => {
  const found = (list as Array<T & { id: string }>).find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown ${kind} id ${id}; refusing to substitute another part.`);
  return found;
};

export function leadsVsAverageFacts(pairing: ComparePairing): LeadsVsAverageFacts {
  const gpuA = byId<BuildFpsGpu>(gpus, pairing.gpuA, "GPU"), cpuA = byId<BuildFpsCpu>(cpus, pairing.cpuA, "CPU");
  const gpuB = byId<BuildFpsGpu>(gpus, pairing.gpuB, "GPU"), cpuB = byId<BuildFpsCpu>(cpus, pairing.cpuB, "CPU");
  const rows: GameEstimate[] = (games as BuildFpsGame[]).map((game) => {
    const fpsA = estimateFpsForBuild(gpuA, cpuA, game, pairing.resolution, pairing.preset).estimated;
    const fpsB = estimateFpsForBuild(gpuB, cpuB, game, pairing.resolution, pairing.preset).estimated;
    return { game: game.name, fpsA, fpsB, margin: fpsA - fpsB, outcome: gameOutcome(fpsA, fpsB) };
  });
  const range = (values: number[]): [number, number] => values.length ? [Math.min(...values), Math.max(...values)] : [0, 0];
  return {
    pairing,
    buildA: `${gpuA.name} + ${cpuA.name}`,
    buildB: `${gpuB.name} + ${cpuB.name}`,
    games: rows,
    tally: tallyModelledLeads(rows),
    averageA: getAverageFps(rows.map((row) => row.fpsA)),
    averageB: getAverageFps(rows.map((row) => row.fpsB)),
    leadRangeA: range(rows.filter((row) => row.outcome === "A").map((row) => row.margin)),
    leadRangeB: range(rows.filter((row) => row.outcome === "B").map((row) => -row.margin)),
  };
}

/** The pairing the MASTER #6 demo uses. */
export const DEMO_PAIRING: ComparePairing = {
  gpuA: "rtx5060ti", cpuA: "i3-13100f", gpuB: "rtx4060ti", cpuB: "r5-9600x", resolution: "1440p", preset: "high",
};
