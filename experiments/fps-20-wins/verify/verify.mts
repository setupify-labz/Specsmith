// Recomputes every figure the video shows from SpecSmith's own Compare model
// (src/lib/fps.ts + src/lib/compareValue.ts, the same functions the /compare
// page calls) and writes src/verified.json. Fails if the story no longer holds.
//
// Run from the repo root:
//   pnpm --dir artifacts/SpecSmith exec tsx ../../experiments/fps-20-wins/verify/verify.mts

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import cpus from "../../../artifacts/SpecSmith/src/data/cpus.json" with { type: "json" };
import games from "../../../artifacts/SpecSmith/src/data/games.json" with { type: "json" };
import gpus from "../../../artifacts/SpecSmith/src/data/gpus.json" with { type: "json" };
import { getAverageFps } from "../../../artifacts/SpecSmith/src/lib/compareValue.ts";
import { estimateFpsForBuild } from "../../../artifacts/SpecSmith/src/lib/fps.ts";

type Part = { id: string; name: string };
const INPUTS = { gpuA: "rtx4080s", gpuB: "rtx4080", cpu: "r9-9950x3d", resolution: "1440p", preset: "high" } as const;

const find = <T extends Part>(list: T[], id: string) => {
  const part = list.find((entry) => entry.id === id);
  if (!part) throw new Error(`${id} is not in the catalog.`);
  return part;
};
const gpuA = find(gpus as never as Part[], INPUTS.gpuA);
const gpuB = find(gpus as never as Part[], INPUTS.gpuB);
const cpu = find(cpus as never as Part[], INPUTS.cpu);

const rows = (games as { id: string; name: string }[]).map((game) => {
  const a = estimateFpsForBuild(gpuA as never, cpu as never, game as never, INPUTS.resolution, INPUTS.preset).estimated;
  const b = estimateFpsForBuild(gpuB as never, cpu as never, game as never, INPUTS.resolution, INPUTS.preset).estimated;
  return { id: game.id, name: game.name, a, b, diff: a - b };
});

const leadsA = rows.filter((row) => row.diff > 0).length;
const leadsB = rows.filter((row) => row.diff < 0).length;
const ties = rows.filter((row) => row.diff === 0).length;
const avgA = getAverageFps(rows.map((row) => row.a));
const avgB = getAverageFps(rows.map((row) => row.b));
const unroundedA = rows.reduce((sum, row) => sum + row.a, 0) / rows.length;
const unroundedB = rows.reduce((sum, row) => sum + row.b, 0) / rows.length;

const verified = {
  source: "SpecSmith Compare model (estimateFpsForBuild, getAverageFps) on this commit; mirrors /compare?gpuA=rtx4080s&cpuA=r9-9950x3d&gpuB=rtx4080&cpuB=r9-9950x3d&res=1440p&preset=high",
  inputs: { ...INPUTS, gpuAName: gpuA.name, gpuBName: gpuB.name, cpuName: cpu.name },
  games: rows.length,
  leadsA, leadsB, ties,
  avgA, avgB, avgGapShown: avgA - avgB,
  unroundedAvgA: Math.round(unroundedA * 100) / 100,
  unroundedAvgB: Math.round(unroundedB * 100) / 100,
  perGameLeadRange: [Math.min(...rows.map((row) => row.diff)), Math.max(...rows.map((row) => row.diff))],
  rows,
  spotlights: [] as unknown[],
};

// The video's story, as assertions: if the model changes, this refuses rather than keep the hook.
const story: [boolean, string][] = [
  [verified.games === 20, `expected 20 games, found ${verified.games}`],
  [leadsA === 20 && leadsB === 0 && ties === 0, `expected 20 leads, 0 ties, 0 losses; found ${leadsA}/${ties}/${leadsB}`],
  [avgA === 164 && avgB === 160, `expected averages 164 vs 160; found ${avgA} vs ${avgB}`],
];
// Spotlighted games: full titles, each checked against the catalogue entry and the model's result.
const SPOTLIGHTS = [
  { id: "cyberpunk2077", title: "Cyberpunk 2077" },
  { id: "cs2", title: "Counter-Strike 2" },
  { id: "warzone", title: "Call of Duty: Warzone" },
  { id: "bg3", title: "Baldur's Gate 3" },
];
const spotlights = SPOTLIGHTS.map((spot) => {
  const index = rows.findIndex((row) => row.id === spot.id);
  const row = rows[index];
  story.push([index >= 0 && row.name.includes(spot.title), `spotlight "${spot.title}" (${spot.id}) does not match a catalogue entry`]);
  story.push([!row || row.diff > 0, `spotlight "${spot.title}" is not a Super lead`]);
  return { title: spot.title, catalogueName: row?.name ?? null, rosterPosition: index + 1, a: row?.a ?? null, b: row?.b ?? null };
});
story.push([spotlights.every((spot, i) => i === 0 || spot.rosterPosition > spotlights[i - 1].rosterPosition), "spotlights must follow roster order so the counter stays truthful"]);
const broken = story.filter(([ok]) => !ok).map(([, why]) => why);
if (broken.length) {
  console.error(`The video's figures no longer hold: ${broken.join("; ")}. Do not render it.`);
  process.exit(1);
}

verified.spotlights = spotlights;
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "verified.json");
writeFileSync(out, `${JSON.stringify(verified, null, 2)}\n`);
console.log(`verified: ${leadsA}/${verified.games} leads, ${ties} ties, avg ${avgA} vs ${avgB} (unrounded ${verified.unroundedAvgA} vs ${verified.unroundedAvgB}), per-game lead ${verified.perGameLeadRange.join("-")} FPS -> ${out}`);
