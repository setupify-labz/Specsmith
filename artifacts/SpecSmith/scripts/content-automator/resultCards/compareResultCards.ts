// Builds a result-card video from two Compare builds.
//
// Every figure on a card is computed here with the Compare page's own
// functions (compareFigures.ts) and written into the card text by this code.
// No figure is typed in. If the model changes, the cards change with it, and a
// finding the new figures no longer support is refused instead of drawn.
//
// The story it tells: how many modelled game leads Build A has, then how few
// frames that lead is worth at each setting the caller asks about.

import {
  compareFiguresFor,
  loadCompareData,
  partName,
  type CompareBuildPair,
  type CompareData,
  type CompareFigures,
  type CompareSetting,
} from "./compareFigures.ts";
import { readingSeconds, sceneText, type ResultCardScene, type ResultCardVideo, type SceneContent } from "./spec.ts";

export const MODEL_ESTIMATE_LABEL = "Model estimates, not measured results";

export interface CompareResultCardsRequest {
  id: string;
  builds: CompareBuildPair;
  /** The setting whose "Modelled Game Leads" the lead card states. */
  leadsAt: CompareSetting;
  /** Settings whose FPS gap gets a card, in order. */
  gapsAt: CompareSetting[];
}

export interface CompareResultCards {
  video: ResultCardVideo;
  /** The figures behind every number on the cards, per setting. */
  figures: CompareFigures[];
  names: { gpuA: string; gpuB: string; cpuA: string; cpuB: string };
  sources: CompareData["sources"];
}

export class ResultCardCopyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResultCardCopyError";
  }
}

const RESOLUTION_LABEL = { "1080p": "1080p", "1440p": "1440p", "4k": "4K" } as const;
const PRESET_LABEL = { high: "High", ultra: "Ultra" } as const;

export function settingLabel(setting: CompareSetting): string {
  return `${RESOLUTION_LABEL[setting.resolution]} ${PRESET_LABEL[setting.preset]}`;
}

/**
 * Words a card may not use. Compare shows modelled FPS only: no prices, no
 * value judgement, no claim that anything was measured or is "faster".
 */
const UNSUPPORTED_WORDING = /\$|\bprice|\bcost|\bworth|\bvalue\b|\bcheap|\bfaster|\bslower|\bbetter|\bbeats?\b|\bwins?\b|\bmeasured\b|\bbenchmark/i;

export function assertResultCardCopy(video: ResultCardVideo): void {
  if (video.label !== MODEL_ESTIMATE_LABEL) {
    throw new ResultCardCopyError(`A Compare result-card video must carry the label "${MODEL_ESTIMATE_LABEL}".`);
  }
  for (const [index, scene] of video.scenes.entries()) {
    for (const text of sceneText(scene)) {
      const match = UNSUPPORTED_WORDING.exec(text);
      if (match) throw new ResultCardCopyError(`Scene ${index} (${scene.kind}) says "${match[0]}" in "${text}", which Compare does not support.`);
    }
    const needed = readingSeconds(scene);
    if (needed > scene.seconds + 1e-9) {
      throw new ResultCardCopyError(
        `Scene ${index} (${scene.kind}) is on screen ${scene.seconds}s but needs ${needed.toFixed(2)}s to read.`,
      );
    }
  }
}

function sceneSeconds(scene: SceneContent, minimum: number): number {
  // Half-second steps, never shorter than it takes to read.
  const needed = readingSeconds({ ...scene, seconds: 0 } as ResultCardScene);
  return Math.max(minimum, Math.ceil(needed * 2) / 2);
}

export async function buildCompareResultCards(request: CompareResultCardsRequest): Promise<CompareResultCards> {
  const data = await loadCompareData();
  const { builds } = request;
  const names = {
    gpuA: partName(data, "gpu", builds.a.gpu),
    gpuB: partName(data, "gpu", builds.b.gpu),
    cpuA: partName(data, "cpu", builds.a.cpu),
    cpuB: partName(data, "cpu", builds.b.cpu),
  };
  if (builds.a.cpu !== builds.b.cpu) {
    // Every card attributes the gap to the GPU. With different CPUs it is not the GPU's alone.
    throw new ResultCardCopyError("This format compares GPUs on one CPU; the two builds use different CPUs.");
  }
  if (builds.a.gpu === builds.b.gpu) throw new ResultCardCopyError("The two builds use the same GPU.");
  if (request.gapsAt.length === 0) throw new ResultCardCopyError("A result-card video needs at least one FPS gap card.");

  const leads = compareFiguresFor(data, builds, request.leadsAt);
  const gaps = request.gapsAt.map((setting) => compareFiguresFor(data, builds, setting));
  const outright = leads.leadsA - leads.ties;
  if (outright <= leads.leadsB) {
    throw new ResultCardCopyError(
      `${names.gpuA} does not lead at ${settingLabel(request.leadsAt)} (${outright} leads, ${leads.leadsB} for ${names.gpuB}); this story does not hold.`,
    );
  }
  for (const gap of gaps) {
    if (gap.avgA <= gap.avgB) {
      throw new ResultCardCopyError(
        `At ${settingLabel(gap)} ${names.gpuA} averages ${gap.avgA} and ${names.gpuB} ${gap.avgB}; there is no lead to size.`,
      );
    }
  }

  const tieNote = leads.ties === 1 ? "1 tie" : `${leads.ties} ties`;
  const scenes: SceneContent[] = [
    {
      kind: "matchup",
      a: names.gpuA,
      b: names.gpuB,
      shared: `Both on ${names.cpuA}`,
    },
    {
      kind: "stat",
      eyebrow: `${settingLabel(leads)} · ${leads.games} games`,
      value: String(outright),
      valueSuffix: `/${leads.games}`,
      body: `modelled game leads for ${names.gpuA}`,
      footnote: leads.leadsB === 0 ? tieNote : `${tieNote} · ${leads.leadsB} for ${names.gpuB}`,
    },
    ...gaps.map((gap): SceneContent => ({
      kind: "gap",
      eyebrow: settingLabel(gap),
      value: String(gap.avgA - gap.avgB),
      valueSuffix: "FPS apart",
      bars: [
        { name: names.gpuA, value: gap.avgA, leads: true },
        { name: names.gpuB, value: gap.avgB, leads: false },
      ],
      footnote: `Est. avg FPS, ${gap.games} games`,
    })),
    {
      kind: "takeaway",
      lines: [
        { text: `${outright} of ${leads.games} modelled leads${leads.ties ? `, ${tieNote}` : ""}`, emphasis: true },
        ...gaps.map((gap, index) => ({
          text: index === 0
            ? `but only ${gap.avgA - gap.avgB} FPS apart at ${settingLabel(gap)}`
            : `and ${gap.avgA - gap.avgB} FPS at ${settingLabel(gap)}`,
          emphasis: false,
        })),
      ],
      cta: "Check your games in SpecSmith Compare",
    },
  ];

  const minimum = { matchup: 3, stat: 4, gap: 4.5, takeaway: 5 } as const;
  const video: ResultCardVideo = {
    id: request.id,
    label: MODEL_ESTIMATE_LABEL,
    scenes: scenes.map((scene) => ({ ...scene, seconds: sceneSeconds(scene, minimum[scene.kind]) }) as ResultCardScene),
  };
  assertResultCardCopy(video);
  return { video, figures: [leads, ...gaps], names, sources: data.sources };
}

/** The RTX 4080 Super vs RTX 4080 finding: 20 of 20 modelled leads, a few frames apart. */
export const RTX4080S_VS_RTX4080: CompareResultCardsRequest = {
  id: "compare-rtx4080s-rtx4080-result-cards",
  builds: { a: { gpu: "rtx4080s", cpu: "r9-9950x3d" }, b: { gpu: "rtx4080", cpu: "r9-9950x3d" } },
  leadsAt: { resolution: "1080p", preset: "high" },
  gapsAt: [{ resolution: "1440p", preset: "high" }, { resolution: "4k", preset: "ultra" }],
};
