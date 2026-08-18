// Research-only tooling: turns the coverage gaps found by build-dataset.mjs
// into a concrete, prioritized list of benchmark *targets* to go find real
// sources for — not real data. Every row here is a (game, gpu, cpu,
// resolution, preset, RT, upscaler, frameGeneration) combination that does
// NOT yet exist in src/data/benchmarkRecords.json; none of them carry an
// averageFps because none of them have been measured yet. This script's
// only job is picking WHAT to go look for next and WHY, using catalog ids
// that are verified (at generation time) to actually exist in gpus.json/
// cpus.json/gameFeatureProfiles.json, and verified to not collide with a
// record that already exists.
//
// Run with: node research/validation-dataset/collection-plan.mjs
//
// This does not fetch, invent, or write any FPS numbers, and does not
// touch src/data/ or any production file. Output: collection-matrix.json
// (machine-readable) and collection-plan.md (the research plan).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const dataDir = path.join(root, 'src', 'data');

async function readJson(name) {
  return JSON.parse(await fs.readFile(path.join(dataDir, name), 'utf-8'));
}

const [records, profiles, gpus, cpus] = await Promise.all([
  readJson('benchmarkRecords.json'),
  readJson('gameFeatureProfiles.json'),
  readJson('gpus.json'),
  readJson('cpus.json'),
]);

const gpuIds = new Set(gpus.map((g) => g.id));
const cpuIds = new Set(cpus.map((c) => c.id));
const gpuById = Object.fromEntries(gpus.map((g) => [g.id, g]));
const cpuById = Object.fromEntries(cpus.map((c) => [c.id, c]));
const verifiedGameIds = new Set(profiles.map((p) => p.gameId));

// Existing (game -> gpu -> baseline settings) for the 10 non-Marvel games,
// read directly from the current records so every target below can say
// exactly which existing record it's meant to pair with.
const baseline = {};
for (const r of records) {
  if (r.gameId === 'marvelrivals') continue;
  baseline[r.gameId] ??= {};
  baseline[r.gameId][r.gpuId] = {
    preset: r.preset,
    presetLabel: r.presetLabel,
    rayTracing: r.rayTracing,
    upscaler: r.upscaler,
    upscalerMode: r.upscalerMode,
    averageFps: r.averageFps,
    recordId: r.id,
  };
}

// New catalog parts this plan intentionally pulls in, chosen for tier +
// vendor spread against what's already covered (rtx3060/rtx4070/rtx4070s,
// all NVIDIA; r5-5600/r7-7800x3d, both AMD).
const NEW_GPUS = {
  budgetNvidia: 'rtx4060',   // tier 5 — nothing at this tier exists yet
  budgetAmd: 'rx7600',       // tier 5, AMD — zero AMD GPUs in any record
  budgetIntel: 'arcb580',    // tier 5, Intel Arc — zero Intel GPUs in any record
  flagshipNvidia: 'rtx4090', // tier 10 — highest NVIDIA tier, untested
  flagshipAmd: 'rx7900xtx',  // tier 9, AMD flagship
};
const NEW_CPUS = {
  budget: 'i5-12400f', // tier 5, Intel — both existing CPUs are AMD tier 6/9
  flagship: 'i9-14900k', // tier 10, Intel flagship
};
for (const id of [...Object.values(NEW_GPUS)]) {
  if (!gpuIds.has(id)) throw new Error(`NEW_GPUS references "${id}" which is not in gpus.json — catalog id changed, fix this script.`);
}
for (const id of [...Object.values(NEW_CPUS)]) {
  if (!cpuIds.has(id)) throw new Error(`NEW_CPUS references "${id}" which is not in cpus.json — catalog id changed, fix this script.`);
}

const targets = [];
function add(t) {
  targets.push(t);
}

// --- P1: 4K (10) — zero 4K records exist anywhere. Cheapest, cleanest gap
// to close: reuse every T4G game's existing rtx4070s+r7-7800x3d baseline
// exactly as-is, only swapping resolution 1440p -> 4k. Every other
// dimension held constant means any FPS delta measured is attributable to
// resolution alone.
for (const gameId of Object.keys(baseline).sort()) {
  const b = baseline[gameId].rtx4070s;
  add({
    priority: 'P1', gap: '4K',
    gameId, gpuId: 'rtx4070s', cpuId: 'r7-7800x3d', resolution: '4k',
    preset: b.preset, presetLabel: b.presetLabel, rayTracing: b.rayTracing,
    upscaler: b.upscaler, upscalerMode: b.upscalerMode, frameGeneration: false,
    rationale: `Pairs directly with existing 1440p record ${b.recordId} (${b.averageFps} FPS) — only resolution changes, isolating the 1440p->4K scaling factor for this game/GPU/CPU/settings combo.`,
  });
}

// --- P2: non-Marvel 1080p (8) — 1080p only exists for Marvel Rivals today.
// Same logic in reverse: reuse baseline settings on the rtx4070 (the
// lower-tier already-tested GPU, since 1080p is the resolution where a
// non-Super 4070 is most likely to still be comfortably playable) and drop
// resolution to 1080p. 8 of the 10 games, picked alphabetically for a
// non-cherry-picked selection.
const eightyEightyGames = Object.keys(baseline).sort().slice(0, 8);
for (const gameId of eightyEightyGames) {
  const b = baseline[gameId].rtx4070;
  add({
    priority: 'P2', gap: 'non-Marvel 1080p',
    gameId, gpuId: 'rtx4070', cpuId: 'r7-7800x3d', resolution: '1080p',
    preset: b.preset, presetLabel: b.presetLabel, rayTracing: b.rayTracing,
    upscaler: b.upscaler, upscalerMode: b.upscalerMode, frameGeneration: false,
    rationale: `Pairs with existing 1440p record ${b.recordId} (${b.averageFps} FPS) — only resolution changes. First non-Marvel-Rivals 1080p data point for this game.`,
  });
}

// --- P3: additional GPU tiers/vendors (10) — 5 new GPUs x 2 games each,
// all at 1440p (the already-covered resolution) and r7-7800x3d (the
// already-covered CPU), so GPU tier/vendor is the only new variable versus
// the existing dataset. Budget GPUs paired with lighter/RT-off games so the
// result is a meaningful, non-unplayable number; flagship GPUs paired with
// the heaviest RT-on games so they're actually stressed.
const gpuTierPlan = [
  { gpuId: NEW_GPUS.budgetNvidia, tierNote: 'budget NVIDIA (tier 5) — untested tier', games: ['starfield', 'tlou1'] },
  { gpuId: NEW_GPUS.budgetAmd, tierNote: 'budget AMD (tier 5) — zero AMD data of any kind exists yet', games: ['rdr2', 'hogwarts'] },
  { gpuId: NEW_GPUS.budgetIntel, tierNote: 'Intel Arc (tier 5) — zero Intel GPU data of any kind exists yet', games: ['remnant2', 'msfs2020'] },
  { gpuId: NEW_GPUS.flagshipNvidia, tierNote: 'flagship NVIDIA (tier 10) — highest tier untested', games: ['cyberpunk2077', 'alanwake2'] },
  { gpuId: NEW_GPUS.flagshipAmd, tierNote: 'flagship AMD (tier 9)', games: ['forzahorizon5', 'avatarfop'] },
];
for (const { gpuId, tierNote, games } of gpuTierPlan) {
  for (const gameId of games) {
    const b = baseline[gameId].rtx4070s; // use the higher of the two existing GPUs' settings as the reference config
    add({
      priority: 'P3', gap: 'GPU tiers/vendors',
      gameId, gpuId, cpuId: 'r7-7800x3d', resolution: '1440p',
      preset: b.preset, presetLabel: b.presetLabel, rayTracing: b.rayTracing,
      upscaler: b.upscaler, upscalerMode: b.upscalerMode, frameGeneration: false,
      rationale: `${gpuById[gpuId].name} — ${tierNote}. Same settings as existing rtx4070s record ${b.recordId} (${b.averageFps} FPS) so the delta isolates GPU choice.`,
    });
  }
}

// --- P4: additional CPU tiers (6) — both new CPUs on the SAME 3 games,
// same GPU (rtx4070s) and resolution, so budget-vs-flagship-vs-existing is
// a clean 3-way comparison per game. Games chosen for CPU-sensitive genres
// (open-world simulation / flight sim) rather than the most GPU-bound RT
// showcases, since that's where a CPU tier gap is most likely to be
// visible at all.
const cpuTierGames = ['msfs2020', 'starfield', 'rdr2'];
for (const cpuKey of ['budget', 'flagship']) {
  const cpuId = NEW_CPUS[cpuKey];
  for (const gameId of cpuTierGames) {
    const b = baseline[gameId].rtx4070s;
    add({
      priority: 'P4', gap: 'CPU tiers',
      gameId, gpuId: 'rtx4070s', cpuId, resolution: '1440p',
      preset: b.preset, presetLabel: b.presetLabel, rayTracing: b.rayTracing,
      upscaler: b.upscaler, upscalerMode: b.upscalerMode, frameGeneration: false,
      rationale: `${cpuById[cpuId].name} (${cpuKey}, ${cpuById[cpuId].brand}) vs. existing r7-7800x3d record ${b.recordId} (${b.averageFps} FPS) — both existing CPUs are AMD tier 6/9, so this also adds the first Intel CPU data.`,
    });
  }
}

// --- P5: FSR / XeSS (8) — zero records of either exist. First priority:
// same-GPU, same-everything-else swaps against the 3 games that already
// have a DLSS baseline (cyberpunk2077, alanwake2, avatarfop), so the
// comparison isolates the upscaler algorithm itself. Second priority: one
// native-vendor spot check each (FSR on AMD, XeSS on Intel Arc).
const dlssGames = ['cyberpunk2077', 'alanwake2', 'avatarfop'];
for (const gameId of dlssGames) {
  const b = baseline[gameId].rtx4070s;
  add({
    priority: 'P5', gap: 'FSR/XeSS',
    gameId, gpuId: 'rtx4070s', cpuId: 'r7-7800x3d', resolution: '1440p',
    preset: b.preset, presetLabel: b.presetLabel, rayTracing: b.rayTracing,
    upscaler: 'fsr', upscalerMode: b.upscalerMode ?? null, frameGeneration: false,
    rationale: `Same settings as existing DLSS record ${b.recordId} (${b.averageFps} FPS) with upscaler swapped to FSR — isolates the upscaler algorithm's own FPS effect.`,
  });
}
for (const gameId of dlssGames) {
  const b = baseline[gameId].rtx4070s;
  add({
    priority: 'P5', gap: 'FSR/XeSS',
    gameId, gpuId: 'rtx4070s', cpuId: 'r7-7800x3d', resolution: '1440p',
    preset: b.preset, presetLabel: b.presetLabel, rayTracing: b.rayTracing,
    upscaler: 'xess', upscalerMode: b.upscalerMode ?? null, frameGeneration: false,
    rationale: `Same settings as existing DLSS record ${b.recordId} (${b.averageFps} FPS) with upscaler swapped to XeSS.`,
  });
}
add({
  priority: 'P5', gap: 'FSR/XeSS',
  gameId: 'forzahorizon5', gpuId: NEW_GPUS.flagshipAmd, cpuId: 'r7-7800x3d', resolution: '1440p',
  preset: baseline.forzahorizon5.rtx4070s.preset, presetLabel: baseline.forzahorizon5.rtx4070s.presetLabel,
  rayTracing: baseline.forzahorizon5.rtx4070s.rayTracing, upscaler: 'fsr', upscalerMode: null, frameGeneration: false,
  rationale: 'FSR on its native AMD vendor GPU (RX 7900 XTX), not just cross-vendor on an NVIDIA card.',
});
add({
  priority: 'P5', gap: 'FSR/XeSS',
  gameId: 'cyberpunk2077', gpuId: NEW_GPUS.budgetIntel, cpuId: 'r7-7800x3d', resolution: '1440p',
  preset: baseline.cyberpunk2077.rtx4070s.preset, presetLabel: baseline.cyberpunk2077.rtx4070s.presetLabel,
  rayTracing: baseline.cyberpunk2077.rtx4070s.rayTracing, upscaler: 'xess', upscalerMode: null, frameGeneration: false,
  rationale: 'XeSS on its native Intel vendor GPU (Arc B580), not just cross-vendor on an NVIDIA card.',
});

// --- P6: RT on/off pairs (6) — no game currently has both states measured.
// Add the missing state for 3 currently-RT-off games and 3 currently-RT-on
// games, everything else held constant, so RT's isolated FPS cost becomes
// measurable per-game instead of only inferable across different games.
for (const gameId of ['starfield', 'rdr2', 'tlou1']) {
  const b = baseline[gameId].rtx4070s;
  add({
    priority: 'P6', gap: 'RT on/off pairs',
    gameId, gpuId: 'rtx4070s', cpuId: 'r7-7800x3d', resolution: '1440p',
    preset: b.preset, presetLabel: b.presetLabel, rayTracing: true,
    upscaler: b.upscaler, upscalerMode: b.upscalerMode, frameGeneration: false,
    rationale: `RT-on counterpart to existing RT-off record ${b.recordId} (${b.averageFps} FPS) — first isolated RT-cost measurement for this game.`,
  });
}
for (const gameId of ['cyberpunk2077', 'alanwake2', 'forzahorizon5']) {
  const b = baseline[gameId].rtx4070s;
  add({
    priority: 'P6', gap: 'RT on/off pairs',
    gameId, gpuId: 'rtx4070s', cpuId: 'r7-7800x3d', resolution: '1440p',
    preset: b.preset, presetLabel: b.presetLabel, rayTracing: false,
    upscaler: b.upscaler, upscalerMode: b.upscalerMode, frameGeneration: false,
    rationale: `RT-off counterpart to existing RT-on record ${b.recordId} (${b.averageFps} FPS) — first isolated RT-cost measurement for this game.`,
  });
}

// --- P7: Frame Generation (2) — only 1 ambiguous FG record exists at all
// (Marvel Rivals, vendor unclear per its own notes). Add one clearly
// DLSS-3-labeled pair (NVIDIA, RTX 40-series required) and one clearly
// FSR-3-labeled pair (vendor-agnostic, tested on its AMD-native GPU),
// each directly paired against an FG-off baseline already in this plan.
{
  const b = baseline.cyberpunk2077.rtx4070s;
  add({
    priority: 'P7', gap: 'Frame Generation',
    gameId: 'cyberpunk2077', gpuId: 'rtx4070s', cpuId: 'r7-7800x3d', resolution: '1440p',
    preset: b.preset, presetLabel: b.presetLabel, rayTracing: b.rayTracing,
    upscaler: b.upscaler, upscalerMode: b.upscalerMode, frameGeneration: true,
    rationale: `DLSS 3 Frame Generation on, explicitly vendor-labeled (RTX 40-series has the required hardware) — pairs with FG-off baseline ${b.recordId} (${b.averageFps} FPS) for a clean, unambiguous FG cost/benefit measurement (unlike the existing Marvel Rivals FG record, whose vendor is not confirmed).`,
  });
}
{
  add({
    priority: 'P7', gap: 'Frame Generation',
    gameId: 'forzahorizon5', gpuId: NEW_GPUS.flagshipAmd, cpuId: 'r7-7800x3d', resolution: '1440p',
    preset: baseline.forzahorizon5.rtx4070s.preset, presetLabel: baseline.forzahorizon5.rtx4070s.presetLabel,
    rayTracing: baseline.forzahorizon5.rtx4070s.rayTracing, upscaler: 'native', upscalerMode: null, frameGeneration: true,
    rationale: 'FSR 3 Frame Generation on its native AMD GPU (vendor-agnostic tech, but testing on-vendor first) — pairs with the FG-off RX 7900 XTX target already in this plan (P3) for a clean FG comparison.',
  });
}

// --- Validation: every target must reference real catalog ids, a verified
// game, and must not already exist as a record (same game+gpu+cpu+res+
// preset+rt+upscaler+mode+frameGen key).
const existingKeys = new Set(
  records.map((r) => [r.gameId, r.gpuId, r.cpuId, r.resolution, r.preset, r.rayTracing, r.upscaler, r.upscalerMode ?? null, r.frameGeneration].join('|')),
);
const errors = [];
for (const t of targets) {
  if (!verifiedGameIds.has(t.gameId)) errors.push(`Target references unknown gameId "${t.gameId}"`);
  if (!gpuIds.has(t.gpuId)) errors.push(`Target references unknown gpuId "${t.gpuId}"`);
  if (!cpuIds.has(t.cpuId)) errors.push(`Target references unknown cpuId "${t.cpuId}"`);
  const key = [t.gameId, t.gpuId, t.cpuId, t.resolution, t.preset, t.rayTracing, t.upscaler, t.upscalerMode ?? null, t.frameGeneration].join('|');
  if (existingKeys.has(key)) errors.push(`Target duplicates an EXISTING record: ${key}`);
}
if (errors.length > 0) {
  throw new Error('collection-plan.mjs generated invalid targets:\n' + errors.join('\n'));
}
if (targets.length !== 50) {
  console.warn(`Note: generated ${targets.length} targets, not exactly 50 — category counts changed. Update the report text if you intend this.`);
}

// ---------------------------------------------------------------------------
// Write outputs
// ---------------------------------------------------------------------------
await fs.writeFile(
  path.join(here, 'collection-matrix.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      note: 'RESEARCH TARGETS ONLY — none of these are measured data. No averageFps field exists on any entry because none has been observed. Do not treat any row here as a BenchmarkRecord.',
      totalTargets: targets.length,
      countsByPriority: Object.fromEntries(
        [...new Set(targets.map((t) => t.priority))].sort().map((p) => [p, targets.filter((t) => t.priority === p).length]),
      ),
      targets,
    },
    null,
    2,
  ) + '\n',
);

const gapLabel = {
  P1: '4K',
  P2: 'non-Marvel 1080p',
  P3: 'additional GPU tiers/vendors',
  P4: 'additional CPU tiers',
  P5: 'FSR/XeSS',
  P6: 'RT on/off pairs',
  P7: 'Frame Generation',
};

const lines = [];
const push = (s = '') => lines.push(s);
push('# Benchmark Collection Plan — Next 50 Target Observations');
push();
push(`Generated ${new Date().toISOString().slice(0, 10)} by \`research/validation-dataset/collection-plan.mjs\`. Research-only. **Every row below is a target to go find a real, cited source for — not measured data.** No FPS numbers are given because none have been observed; nothing here has been or should be added to \`benchmarkRecords.json\` until a real source is found and verified, following the same strict anti-fabrication rules used for every prior research batch this project has done (direct-fetch preferred, reject on any contradiction, disclose every unconfirmed field via \`confirmedFields\`).`);
push();
push('## Why these 50, in this order');
push();
push('Priority order follows the gap list as given, weighted toward the categories with literally zero existing coverage (4K, FSR, XeSS, GPU vendors besides NVIDIA, CPU vendors besides AMD) over categories that are merely thin (RT pairing, Frame Generation). Within each category, new targets are built by taking an **existing, already-verified record** and changing exactly one dimension — resolution, GPU, CPU, upscaler, or RT — so that whichever number comes back has a direct, apples-to-apples comparison already sitting in the dataset. This is deliberate: a same-settings-except-one-variable pair is far more useful for future estimator validation than an isolated new data point with nothing to compare it against.');
push();
push(`| Priority | Gap | Count |`);
push(`|---|---|---|`);
for (const p of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']) {
  push(`| ${p} | ${gapLabel[p]} | ${targets.filter((t) => t.priority === p).length} |`);
}
push(`| **Total** | | **${targets.length}** |`);
push();
push('New catalog parts this plan pulls in (all real, verified against `gpus.json`/`cpus.json` at generation time):');
push();
push(`- GPUs: ${Object.entries(NEW_GPUS).map(([k, id]) => `**${gpuById[id].name}** (${k}, ${gpuById[id].brand}, tier ${gpuById[id].tier})`).join(', ')}`);
push(`- CPUs: ${Object.entries(NEW_CPUS).map(([k, id]) => `**${cpuById[id].name}** (${k}, ${cpuById[id].brand}, tier ${cpuById[id].tier})`).join(', ')}`);
push();
push('## The 50 targets');
push();
for (const p of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']) {
  const group = targets.filter((t) => t.priority === p);
  push(`### ${p} — ${gapLabel[p]} (${group.length})`);
  push();
  push('| Game | GPU | CPU | Res | Preset | RT | Upscaler | FG | Why |');
  push('|---|---|---|---|---|---|---|---|---|');
  for (const t of group) {
    const presetCell = t.presetLabel ? `${t.preset} ("${t.presetLabel}")` : t.preset;
    const upCell = t.upscalerMode ? `${t.upscaler} (${t.upscalerMode})` : t.upscaler;
    push(`| ${t.gameId} | ${gpuById[t.gpuId].name} | ${cpuById[t.cpuId].name} | ${t.resolution} | ${presetCell} | ${t.rayTracing ? 'on' : 'off'} | ${upCell} | ${t.frameGeneration ? 'on' : 'off'} | ${t.rationale} |`);
  }
  push();
}
push('## Collection rules (unchanged from every prior batch this project has run)');
push();
push('- Direct-fetch a real, citable article/video and read it yourself; if a domain is unreachable, say so honestly rather than substituting a search-summary silently.');
push('- Never derive `onePercentLow`/`zeroPointOnePercentLow` from a generic "minimum" or "low" figure the source doesn\'t explicitly label as a percentile metric — record the raw figure in `notes` only, same as the existing Alan Wake 2 / RDR2 / Hogwarts / MSFS2020 / Avatar records already do.');
push('- Never infer `upscalerMode`, `rayTracingState`, or `frameGenerationState` confidence from general engine knowledge — only from what the source explicitly states, and reflect any gap honestly in `confirmedFields`.');
push('- Reject a candidate outright on any cross-source contradiction rather than averaging or guessing — this has already happened twice this project (Tom\'s Hardware RTX 4070 Ti Super, and a second Tech4Gamers RX 7600/RTX 4060 batch), both correctly yielding 0 accepted candidates.');
push('- Do not add a record just to fill a matrix cell — if a real source can\'t be found and verified for a specific target row, leave that gap open rather than lowering the bar.');
push();
push('---');
push();
push('_Files: `collection-plan.mjs` (generator, read-only against `src/data/`), `collection-matrix.json` (machine-readable targets), `collection-plan.md` (this file). Regenerate with `node research/validation-dataset/collection-plan.mjs`. Nothing here modifies `benchmarkRecords.json` or any production file._');

await fs.writeFile(path.join(here, 'collection-plan.md'), lines.join('\n') + '\n');

console.log(`Wrote collection-matrix.json and collection-plan.md — ${targets.length} targets across ${new Set(targets.map((t) => t.priority)).size} priority tiers.`);
