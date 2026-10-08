// Research for the next SpecSmith Short: "Does a new GPU speed up every game
// the same?" (MASTER #2 research pass, production, not a fixture).
//
// Every value is computed at run time from the shipped model and catalog,
// through the same functions Compare uses (leadsVsAverage/facts.ts calls
// estimateFpsForBuild, getAverageFps and tallyModelledLeads). The snapshots
// name the exact bytes they were computed from by SHA-256, so a change to the
// model or the catalog produces different evidence instead of a stale claim.
//
// What this research can establish is what SpecSmith's MODEL ESTIMATES say.
// Nothing here is measured on hardware, and nothing here is a price, so the
// claims that would need either are recorded as unsafe with what would make
// them usable.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import games from "../../../src/data/games.json" with { type: "json" };
import gpus from "../../../src/data/gpus.json" with { type: "json" };
import cpus from "../../../src/data/cpus.json" with { type: "json" };
import { percentChange } from "../v2/creative/dataMotionGraphic.ts";
import { leadsVsAverageFacts, type ComparePairing, type GameEstimate } from "../leadsVsAverage/facts.ts";
import type { AtomicClaim, ClaimEvidenceLink, Observation, ResearchProvenance, ResearchQuestion, SourceSnapshot } from "../v2/research/model.ts";
import { runResearchPass, type ResearchResult } from "../v2/research/researchPass.ts";
import { ESTIMATED_FPS_INSTRUCTION, ESTIMATED_PERCENTAGE_INSTRUCTION } from "../v2/research/creativeContract.ts";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The one Compare state the claims are established for. Same CPU, two GPUs. */
export const GPU_UPGRADE_PAIRING: ComparePairing = {
  gpuA: "rtx5070", cpuA: "r5-7600",
  gpuB: "rtx4060", cpuB: "r5-7600",
  resolution: "1440p", preset: "high",
};

/** The two games the story contrasts: the model's most and least GPU-weighted titles that a beginner will recognise. */
export const CONTRAST_GAMES = { gpuHeavy: "alanwake2", cpuHeavy: "valorant" } as const;

/** Files the estimates are computed from. Their hashes are the snapshot's content hash. */
const MODEL_FILES = [
  "src/lib/fps.ts",
  "src/lib/compareValue.ts",
  "src/lib/compareTally.ts",
  "src/data/gpus.json",
  "src/data/cpus.json",
  "src/data/games.json",
] as const;

export function modelContentHash(): { readonly combined: string; readonly files: Readonly<Record<string, string>> } {
  const files: Record<string, string> = {};
  for (const file of MODEL_FILES) files[file] = createHash("sha256").update(readFileSync(join(appRoot, file))).digest("hex");
  const combined = createHash("sha256").update(MODEL_FILES.map((file) => `${file}:${files[file]}`).join("\n")).digest("hex");
  return { combined, files };
}

interface GameRecord { readonly id: string; readonly name: string; readonly gpu_bound?: number }

const gameById = (id: string): GameRecord => {
  const found = (games as GameRecord[]).find((game) => game.id === id);
  if (!found) throw new Error(`Unknown game ${id}; refusing to substitute another.`);
  return found;
};

/**
 * One game's estimates and the percentage computed from them.
 *
 * `percent` is computed from the two whole-FPS estimates Compare DISPLAYS
 * (fpsB before, fpsA after), so a viewer can redo it from what is on screen:
 * round((fpsA - fpsB) / fpsB * 100). `unroundedRatio` is the model's own ratio
 * before Compare rounds each estimate; it is recorded so the rounding effect
 * is visible, never shown as the headline.
 */
export type GameFacts = GameEstimate & {
  readonly gameId: string;
  readonly gpuWeight: number;
  readonly percent: number;
  readonly unroundedRatio: number;
};

export interface GpuUpgradeFacts {
  readonly buildA: string;
  readonly buildB: string;
  readonly gpuHeavy: GameFacts;
  readonly cpuHeavy: GameFacts;
  readonly leadsA: number;
  readonly gameCount: number;
  /** Per-game ratio of the two builds' estimates, at each resolution, for the one game. Identical by construction. */
  readonly ratioByResolution: Readonly<Record<string, number>>;
}

/** The numbers the claims rest on, computed now. */
export function gpuUpgradeFacts(): GpuUpgradeFacts {
  const facts = leadsVsAverageFacts(GPU_UPGRADE_PAIRING);
  const pick = (id: string) => {
    const game = gameById(id);
    const row = facts.games.find((entry) => entry.game === game.name);
    if (!row) throw new Error(`${game.name} is not in the Compare result.`);
    const gpuWeight = game.gpu_bound ?? 0.75;
    const multiplier = (list: unknown, key: string, id: string) => ((list as Record<string, unknown>[]).find((entry) => entry.id === id)![key] as number);
    const cpu = multiplier(cpus, "cpu_multiplier", GPU_UPGRADE_PAIRING.cpuA);
    const weighted = (gpuId: string) => cpu + gpuWeight * (multiplier(gpus, "gpu_multiplier", gpuId) - cpu);
    if (GPU_UPGRADE_PAIRING.cpuA !== GPU_UPGRADE_PAIRING.cpuB) throw new Error("The unrounded ratio below assumes one CPU.");
    return {
      ...row, gameId: id, gpuWeight,
      percent: percentChange(row.fpsB, row.fpsA),
      unroundedRatio: Math.round((weighted(GPU_UPGRADE_PAIRING.gpuA) / weighted(GPU_UPGRADE_PAIRING.gpuB)) * 1000) / 1000,
    };
  };
  const ratioByResolution: Record<string, number> = {};
  for (const resolution of ["1080p", "1440p", "4k"] as const) {
    const row = leadsVsAverageFacts({ ...GPU_UPGRADE_PAIRING, resolution }).games.find((entry) => entry.game === gameById(CONTRAST_GAMES.cpuHeavy).name)!;
    ratioByResolution[resolution] = Math.round((row.fpsA / row.fpsB) * 100) / 100;
  }
  return {
    buildA: facts.buildA, buildB: facts.buildB,
    gpuHeavy: pick(CONTRAST_GAMES.gpuHeavy), cpuHeavy: pick(CONTRAST_GAMES.cpuHeavy),
    leadsA: facts.tally.leadsA, gameCount: facts.games.length, ratioByResolution,
  };
}

/** Angles research refused, kept for the brief so nobody re-proposes them. */
export const REFUSED_ANGLES: readonly { readonly angle: string; readonly why: string }[] = [
  {
    angle: "\"Your CPU matters less at 4K, so a GPU upgrade helps more there.\"",
    why: "False of SpecSmith's model: each game's GPU weight is fixed and does not change with resolution, so the after/before ratio is identical at 1080p, 1440p and 4K (obs-resolution-invariance). True or not on real hardware, the model cannot show it.",
  },
  {
    angle: "\"The RTX 5070 is the upgrade to buy.\" (contract: better-purchase)",
    why: "A recommendation needs live prices and a buyer profile; the model knows neither, and Compare shows no prices.",
  },
  {
    angle: "\"A real RTX 5070 runs Alan Wake 2 at 65 FPS.\" (contract: measured-on-hardware)",
    why: "65 is a model estimate, not a measurement; no measured benchmark of this configuration is in evidence.",
  },
];

export const QUESTION_ID = "gpu-upgrade-gains-by-game-1440p-high";

/**
 * The research contract writes the estimate rule as an instruction
 * ('Label the figure "Estimated FPS" wherever it is visible, not only in
 * narration.'), while the creative evidence gate checks requiredWording as
 * text that must appear verbatim in the beat. Left alone, the only way to pass
 * would be to print the instruction itself. This maps that one instruction to
 * the label it names, which the gate then requires in the beat's text; nothing
 * else in the contract changes. The percentage instruction maps the same way.
 * (The mismatch between the two modules is reported, not fixed here.)
 */
export const ESTIMATE_LABEL_INSTRUCTION = ESTIMATED_FPS_INSTRUCTION;
const VERBATIM_LABELS: Readonly<Record<string, string>> = {
  [ESTIMATED_FPS_INSTRUCTION]: "Estimated FPS",
  [ESTIMATED_PERCENTAGE_INSTRUCTION]: "Estimated percentage boost",
};
export function withVerbatimLabels(contract: ResearchResult["contract"]): ResearchResult["contract"] {
  return {
    ...contract,
    safeClaims: contract.safeClaims.map((claim) => ({
      ...claim,
      requiredWording: claim.requiredWording.map((wording) => VERBATIM_LABELS[wording] ?? wording),
    })),
  };
}

/** Builds and runs the research pass. `now` is when it runs; nothing is backdated. */
export function runGpuUpgradeResearch(now: Date): { readonly result: ResearchResult; readonly facts: GpuUpgradeFacts; readonly modelHash: ReturnType<typeof modelContentHash> } {
  const at = now.toISOString();
  const provenance: ResearchProvenance = { synthetic: false, producedBy: "specsmith-runtime", producedAt: at };
  const facts = gpuUpgradeFacts();
  const modelHash = modelContentHash();
  const config = (gameId: string) => ({ cpu: "Ryzen 5 7600", gameId, resolution: "1440p", preset: "high" });
  // Which pairing, and which way round, every value below describes: before is
  // build B (RTX 4060), after is build A (RTX 5070), one CPU. Kept beside the
  // values so a visual can be checked against all of it together.
  const PAIRING_FIELDS = { cpu: GPU_UPGRADE_PAIRING.cpuA, beforeGpu: GPU_UPGRADE_PAIRING.gpuB, afterGpu: GPU_UPGRADE_PAIRING.gpuA } as const;

  const question: ResearchQuestion = {
    questionId: QUESTION_ID,
    question: "With the same CPU, does SpecSmith's model estimate that a GPU upgrade raises every game's FPS by a similar share?",
    purpose: "Answer a beginner's upgrade question with the model's own per-game estimates, not a single average.",
    informsDecision: "Which per-game contrast the next Short may state, and in what words.",
    claimKind: "performance-estimated",
    risk: "medium",
    acceptableUncertainty: "strongly-supported",
    subjectIds: ["rtx5070", "rtx4060", "r5-7600", CONTRAST_GAMES.gpuHeavy, CONTRAST_GAMES.cpuHeavy],
    configuration: { cpu: "Ryzen 5 7600", resolution: "1440p", preset: "high" },
  };

  const snapshot: SourceSnapshot = {
    snapshotId: `specsmith-model-${modelHash.combined.slice(0, 16)}`,
    source: {
      sourceId: "specsmith-fps-model",
      sourceType: "first-party-specsmith",
      publisher: "SpecSmith",
      url: "https://specsmithpc.com/compare",
      title: "SpecSmith FPS model and catalog (src/lib/fps.ts, src/data/*.json)",
    },
    retrievedAt: at,
    retrievalMethod: "specsmith-runtime",
    contentHash: modelHash.combined,
    parserVersion: "leadsVsAverageFacts",
    provenance,
  };

  const estimateObservation = (id: string, row: GpuUpgradeFacts["gpuHeavy"]): Observation => ({
    observationId: id,
    snapshotId: snapshot.snapshotId,
    form: "structured-value",
    content: `${row.game} at 1440p High: ${facts.buildB} estimated ${row.fpsB} FPS; ${facts.buildA} estimated ${row.fpsA} FPS (SpecSmith model estimates).`,
    fields: { ...PAIRING_FIELDS, estimatedFpsBefore: row.fpsB, estimatedFpsAfter: row.fpsA, gpuWeight: row.gpuWeight },
    configuration: config(row.gameId),
    observedAt: at,
    provenance,
  });
  const observations: Observation[] = [
    estimateObservation("obs-gpu-heavy", facts.gpuHeavy),
    estimateObservation("obs-cpu-heavy", facts.cpuHeavy),
    ...[facts.gpuHeavy, facts.cpuHeavy].map((row, index): Observation => ({
      observationId: index === 0 ? "obs-percent-gpu-heavy" : "obs-percent-cpu-heavy",
      snapshotId: snapshot.snapshotId,
      form: "structured-value",
      content: `${row.game} at 1440p High: (${row.fpsA} − ${row.fpsB}) ÷ ${row.fpsB} = ${row.percent}% from Compare's displayed estimates (${facts.buildB} → ${facts.buildA}); the model's unrounded ratio is ${row.unroundedRatio}.`,
      fields: { ...PAIRING_FIELDS, estimatedFpsBefore: row.fpsB, estimatedFpsAfter: row.fpsA, percent: row.percent, unroundedRatio: row.unroundedRatio },
      configuration: config(row.gameId),
      observedAt: at,
      provenance,
    })),
    {
      // One observation for the comparison: two per-game observations would
      // read to the conflict detector as two sources disagreeing about one
      // number, when they describe two different games.
      observationId: "obs-percent-comparison",
      snapshotId: snapshot.snapshotId,
      form: "structured-value",
      content: `Estimated boost at 1440p High, ${facts.buildB} → ${facts.buildA}: ${facts.gpuHeavy.game} ${facts.gpuHeavy.percent}%, ${facts.cpuHeavy.game} ${facts.cpuHeavy.percent}% (each from Compare's displayed estimates).`,
      fields: { gpuHeavyPercent: facts.gpuHeavy.percent, cpuHeavyPercent: facts.cpuHeavy.percent },
      configuration: { cpu: "Ryzen 5 7600", resolution: "1440p", preset: "high" },
      observedAt: at,
      provenance,
    },
    {
      observationId: "obs-weights",
      snapshotId: snapshot.snapshotId,
      form: "structured-value",
      content: `games.json gives ${facts.gpuHeavy.game} a GPU weight of ${facts.gpuHeavy.gpuWeight} and ${facts.cpuHeavy.game} ${facts.cpuHeavy.gpuWeight}; estimateFps blends GPU and CPU strength by that weight.`,
      fields: { gpuHeavyWeight: facts.gpuHeavy.gpuWeight, cpuHeavyWeight: facts.cpuHeavy.gpuWeight },
      configuration: { resolution: "1440p", preset: "high" },
      observedAt: at,
      provenance,
    },
    {
      observationId: "obs-tally",
      snapshotId: snapshot.snapshotId,
      form: "structured-value",
      content: `${facts.buildA} has the higher estimate in ${facts.leadsA} of ${facts.gameCount} games at 1440p High.`,
      fields: { leadsA: facts.leadsA, games: facts.gameCount },
      configuration: { cpu: "Ryzen 5 7600", resolution: "1440p", preset: "high" },
      observedAt: at,
      provenance,
    },
    {
      observationId: "obs-resolution-invariance",
      snapshotId: snapshot.snapshotId,
      form: "structured-value",
      content: `The model's per-game GPU weight does not depend on resolution: ${facts.cpuHeavy.game}'s after/before ratio is ${Object.entries(facts.ratioByResolution).map(([resolution, ratio]) => `${ratio} at ${resolution}`).join(", ")}.`,
      fields: Object.fromEntries(Object.entries(facts.ratioByResolution).map(([resolution, ratio]) => [`ratio_${resolution}`, ratio])),
      configuration: { cpu: "Ryzen 5 7600", gameId: CONTRAST_GAMES.cpuHeavy },
      observedAt: at,
      provenance,
    },
  ];

  const claim = (claimId: string, proposition: string, kind: AtomicClaim["kind"], risk: AtomicClaim["risk"], configuration: AtomicClaim["configuration"], subjectIds: readonly string[]): AtomicClaim =>
    ({ claimId, questionId: QUESTION_ID, proposition, kind, risk, configuration, subjectIds, provenance });
  // The percentage claims state a percentage computed from the estimates, which
  // is labelled "Estimated percentage boost", never "Estimated FPS".
  const percentage = (entry: AtomicClaim): AtomicClaim => ({ ...entry, derivedPercentage: true });
  const claims: AtomicClaim[] = [
    claim("gpu-upgrade-gpu-heavy-game",
      `In SpecSmith's model estimates at 1440p High with the same Ryzen 5 7600, moving from an RTX 4060 to an RTX 5070 takes ${facts.gpuHeavy.game} from ${facts.gpuHeavy.fpsB} to ${facts.gpuHeavy.fpsA} FPS.`,
      "performance-estimated", "medium", config(CONTRAST_GAMES.gpuHeavy), ["rtx5070", "rtx4060", "r5-7600", CONTRAST_GAMES.gpuHeavy]),
    claim("gpu-upgrade-cpu-heavy-game",
      `In SpecSmith's model estimates at 1440p High with the same Ryzen 5 7600, the same upgrade takes ${facts.cpuHeavy.game} from ${facts.cpuHeavy.fpsB} to ${facts.cpuHeavy.fpsA} FPS.`,
      "performance-estimated", "medium", config(CONTRAST_GAMES.cpuHeavy), ["rtx5070", "rtx4060", "r5-7600", CONTRAST_GAMES.cpuHeavy]),
    percentage(claim("gpu-upgrade-percent-gpu-heavy-game",
      `In SpecSmith's model estimates at 1440p High with the same Ryzen 5 7600, the RTX 4060 to RTX 5070 upgrade gives ${facts.gpuHeavy.game} an estimated ${facts.gpuHeavy.percent}% boost: from ${facts.gpuHeavy.fpsB} to ${facts.gpuHeavy.fpsA} FPS, (${facts.gpuHeavy.fpsA} − ${facts.gpuHeavy.fpsB}) ÷ ${facts.gpuHeavy.fpsB}.`,
      "performance-estimated", "medium", config(CONTRAST_GAMES.gpuHeavy), ["rtx5070", "rtx4060", "r5-7600", CONTRAST_GAMES.gpuHeavy])),
    percentage(claim("gpu-upgrade-percent-cpu-heavy-game",
      `In SpecSmith's model estimates at 1440p High with the same Ryzen 5 7600, the same upgrade gives ${facts.cpuHeavy.game} an estimated ${facts.cpuHeavy.percent}% boost: from ${facts.cpuHeavy.fpsB} to ${facts.cpuHeavy.fpsA} FPS, (${facts.cpuHeavy.fpsA} − ${facts.cpuHeavy.fpsB}) ÷ ${facts.cpuHeavy.fpsB}.`,
      "performance-estimated", "medium", config(CONTRAST_GAMES.cpuHeavy), ["rtx5070", "rtx4060", "r5-7600", CONTRAST_GAMES.cpuHeavy])),
    percentage(claim("bigger-percentage-boost",
      `In SpecSmith's model estimates at 1440p High with the same Ryzen 5 7600, ${facts.gpuHeavy.game} gets the bigger percentage boost from the RTX 4060 to RTX 5070 upgrade: ${facts.gpuHeavy.percent}% against ${facts.cpuHeavy.game}'s ${facts.cpuHeavy.percent}%.`,
      "performance-estimated", "medium", { cpu: "Ryzen 5 7600", resolution: "1440p", preset: "high" }, ["rtx5070", "rtx4060", "r5-7600", CONTRAST_GAMES.gpuHeavy, CONTRAST_GAMES.cpuHeavy])),
    claim("model-weights-games",
      `SpecSmith's model weights each game by how much it leans on the GPU; it gives ${facts.gpuHeavy.game} far more GPU weight than ${facts.cpuHeavy.game}.`,
      "specsmith-product", "low", { resolution: "1440p", preset: "high" }, [CONTRAST_GAMES.gpuHeavy, CONTRAST_GAMES.cpuHeavy]),
    claim("rtx5070-higher-in-every-game",
      `In SpecSmith's model estimates at 1440p High with the same Ryzen 5 7600, the RTX 5070 build has the higher estimate in all ${facts.gameCount} games.`,
      "performance-estimated", "medium", { cpu: "Ryzen 5 7600", resolution: "1440p", preset: "high" }, ["rtx5070", "rtx4060", "r5-7600"]),
    // Refused: needs evidence this research does not have.
    // Worded around what makes each unsafe (a purchase verdict; a measurement on
    // hardware), not around the game and card names the safe claims share: the
    // evidence gate blocks any line that repeats an unsafe claim's distinctive
    // words, so "A real RTX 5070 runs Alan Wake 2 at 65 FPS" would also block
    // every honest, labelled mention of Alan Wake 2's estimate.
    claim("better-purchase", "One of these two graphics cards is the better purchase.", "recommendation", "high", undefined, ["rtx5070", "rtx4060"]),
    claim("measured-on-hardware", "SpecSmith measured these frame rates on real hardware.",
      "performance-measured", "high", config(CONTRAST_GAMES.gpuHeavy), ["rtx5070", "rtx4060", "r5-7600"]),
  ];

  const stances: { claimId: string; observationId: string; stance: ClaimEvidenceLink["stance"] }[] = [
    { claimId: "gpu-upgrade-gpu-heavy-game", observationId: "obs-gpu-heavy", stance: "supports" },
    { claimId: "gpu-upgrade-cpu-heavy-game", observationId: "obs-cpu-heavy", stance: "supports" },
    { claimId: "gpu-upgrade-percent-gpu-heavy-game", observationId: "obs-percent-gpu-heavy", stance: "supports" },
    { claimId: "gpu-upgrade-percent-cpu-heavy-game", observationId: "obs-percent-cpu-heavy", stance: "supports" },
    { claimId: "bigger-percentage-boost", observationId: "obs-percent-comparison", stance: "supports" },
    { claimId: "model-weights-games", observationId: "obs-weights", stance: "supports" },
    { claimId: "rtx5070-higher-in-every-game", observationId: "obs-tally", stance: "supports" },
    // An estimate is not a measurement, and the model knows no prices: these
    // observations say nothing for the refused claims.
    { claimId: "measured-on-hardware", observationId: "obs-gpu-heavy", stance: "irrelevant" },
  ];

  // Deliberately NOT a claim here: "a GPU upgrade helps Valorant more at 4K
  // because the CPU matters less there". obs-resolution-invariance shows the
  // model's after/before ratio is the same at every resolution, so the claim is
  // false of the model. It was left out because assessConfidence used to rate
  // a contradicted-only claim as safe (fixed in #175, whose regression test
  // uses this exact case). It stays out so this brief's contract, and the
  // concepts authored against it, are unchanged; see REFUSED_ANGLES.
  const result = runResearchPass({ researchId: `research-${QUESTION_ID}-${at}`, question, claims, snapshots: [snapshot], observations, stances, startedAt: now, now });
  return { result: { ...result, contract: withVerbatimLabels(result.contract) }, facts, modelHash };
}
