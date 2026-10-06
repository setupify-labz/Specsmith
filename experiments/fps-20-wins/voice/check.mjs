// The figure gate for the voiced cut. Builds what the video will display from
// verified.json (recomputed from the Compare model by verify/verify.mts) and
// refuses a render if anything shown disagrees with it: the averages, the gap,
// the lead counts, the spotlight titles, or any number in a caption.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SETTING = "1440p High";

export function displayFromVerified(V) {
  return {
    gpuA: V.inputs.gpuAName, gpuB: V.inputs.gpuBName, cpu: V.inputs.cpuName, setting: SETTING,
    games: V.games, leadsA: V.leadsA, ties: V.ties, leadsB: V.leadsB,
    avgA: V.avgA, avgB: V.avgB, gap: V.avgA - V.avgB,
    spotlights: V.spotlights.map((s) => ({ title: s.title, rosterPosition: s.rosterPosition })),
  };
}

/** Returns the list of problems; empty means the display matches the model. */
export function checkDisplay(display, V, captions) {
  const problems = [];
  const want = displayFromVerified(V);
  for (const key of ["gpuA", "gpuB", "cpu", "games", "leadsA", "ties", "leadsB", "avgA", "avgB", "gap"]) {
    if (display[key] !== want[key]) problems.push(`${key} shows ${display[key]}, the model says ${want[key]}`);
  }
  if (display.gap !== display.avgA - display.avgB) problems.push(`the gap ${display.gap} is not ${display.avgA} - ${display.avgB}`);
  if (JSON.stringify(display.spotlights) !== JSON.stringify(want.spotlights)) problems.push("spotlight titles or roster positions differ from the catalogue check");
  if (V.leadsA !== V.games || V.ties !== 0 || V.leadsB !== 0) problems.push(`the model no longer gives ${V.games}/${V.games} leads with no ties`);
  // Any number in any caption must be one the story can show.
  const allowed = new Set([
    ...[V.games, V.avgA, V.avgB, V.avgA - V.avgB].map(String),
    ...`${display.gpuA} ${display.gpuB} ${display.cpu} ${display.setting} ${display.spotlights.map((s) => s.title).join(" ")}`.match(/\d+/g),
  ]);
  for (const cue of captions ?? []) {
    for (const n of cue.show.match(/\d+/g) ?? []) if (!allowed.has(n)) problems.push(`caption "${cue.show}" shows ${n}, which the model does not support`);
  }
  return problems;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const V = JSON.parse(readFileSync(join(root, "src", "verified.json"), "utf8"));
  const plan = JSON.parse(readFileSync(join(root, "src", "voiceplan.json"), "utf8"));
  const display = displayFromVerified(V);
  if (process.argv.includes("--negative-control")) display.avgA = 165;
  const problems = checkDisplay(display, V, plan.captions);
  if (problems.length) {
    console.error(`REJECTED: ${problems.join("; ")}`);
    process.exit(1);
  }
  console.log(`figures ok: ${display.leadsA}/${display.games} leads, ${display.ties} ties, ${display.avgA} vs ${display.avgB} (${display.gap} apart)`);
}
