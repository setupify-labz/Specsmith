import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import gamesData from '../data/games.json';
import { estimateFpsForBuild } from './fps';

export interface UpgradeGpu {
  id: string;
  name: string;
  price_usd: number;
  tier: number;
  gpu_multiplier: number;
  [key: string]: unknown;
}

interface Game {
  id: string;
  name: string;
  gpu_bound?: number;
  base_fps: Record<string, Record<string, number>>;
  [key: string]: unknown;
}

const gpus = gpuData as UpgradeGpu[];
const games = gamesData as Game[];

// Fixed reference CPU, same one the /vs GPU matchup pages use, so a GPU's
// FPS numbers here line up with what's shown elsewhere on the site.
const REFERENCE_CPU_ID = 'r7-9800x3d';
const referenceCpu = (cpuData as { id: string; name: string; cpu_multiplier: number; [key: string]: unknown }[])
  .find(c => c.id === REFERENCE_CPU_ID)!;

export function getUpgradeGpus(): UpgradeGpu[] {
  return gpus;
}

export function getUpgradeGpu(id: string): UpgradeGpu | undefined {
  return gpus.find(g => g.id === id);
}

/**
 * The CPU every FPS figure on the upgrade pages is modelled against.
 *
 * Exported because it is a LOAD-BEARING ASSUMPTION, not an implementation
 * detail: the guide pages name it, so a reader knows what the estimate is
 * conditional on. Read from here rather than written into prose, so the chip
 * the page names cannot drift from the chip the estimator used.
 */
export const UPGRADE_REFERENCE_CPU = referenceCpu as { id: string; name: string; cpu_multiplier: number };

export function averageFps(gpu: UpgradeGpu, resolution = '1440p', preset = 'high'): number {
  const total = games.reduce((sum, g) => sum + estimateFpsForBuild(gpu, referenceCpu, g, resolution, preset).estimated, 0);
  return Math.round(total / games.length);
}

/**
 * Every tracked GPU that this one's modelled average does not reach.
 *
 * PRICE TOUCHES NOTHING HERE, and that is the whole point of the function.
 * An earlier buying calculator kept the cheapest card in each tier, so an
 * editorial price silently decided what readers saw. A performance comparison
 * must instead be selected and ordered only by the performance model.
 *
 * So this returns the COMPLETE set — no per-tier filter, no limit — ordered by
 * modelled difference. The list is longer for a low-end card (56 rows from an
 * RX 6400) and shorter for a fast one, which is the honest shape of the
 * question. Nothing is selected on the reader's behalf.
 */
export interface UpgradeComparison {
  gpu: UpgradeGpu;
  /** Modelled 20-game average for the card being compared against. */
  avgFpsCurrent: number;
  /** Modelled 20-game average for this card. */
  avgFpsNew: number;
  /** Modelled difference, as a percentage of the current card's average. */
  fpsDiffPct: number;
}

export function getUpgradeComparisons(currentId: string): UpgradeComparison[] {
  const current = getUpgradeGpu(currentId);
  if (!current) return [];
  const avgFpsCurrent = averageFps(current);

  return gpus
    .filter((gpu) => gpu.id !== current.id)
    .map((gpu) => {
      const avgFpsNew = averageFps(gpu);
      return {
        gpu,
        avgFpsCurrent,
        avgFpsNew,
        fpsDiffPct: Math.round(((avgFpsNew - avgFpsCurrent) / avgFpsCurrent) * 100),
      };
    })
    // Tier is a catalogue grouping, not evidence that one card is faster. The
    // modelled average is what this page compares, so it is what filters.
    .filter((row) => row.avgFpsNew > row.avgFpsCurrent && row.fpsDiffPct > 0)
    .sort((a, b) => b.fpsDiffPct - a.fpsDiffPct || a.gpu.name.localeCompare(b.gpu.name));
}

/**
 * A compact, price-independent preview for the upgrade-guide page.
 *
 * Rendering the complete comparison set produced as many as 56 near-identical
 * rows on each low-end GPU page. That is difficult to scan and makes the
 * programmatic pages repeat almost the entire GPU catalogue. The preview keeps
 * the closest modelled steps above the selected card, ordered from the
 * smallest difference upward. It is a navigation aid, not a recommendation.
 */
export const UPGRADE_COMPARISON_PREVIEW_LIMIT = 8;

export function getClosestUpgradeComparisons(
  currentId: string,
  limit = UPGRADE_COMPARISON_PREVIEW_LIMIT,
): UpgradeComparison[] {
  if (!Number.isInteger(limit) || limit <= 0) return [];

  return getUpgradeComparisons(currentId)
    .slice()
    .sort((a, b) => a.fpsDiffPct - b.fpsDiffPct || a.gpu.name.localeCompare(b.gpu.name))
    .slice(0, limit);
}

export const upgradeCalculatorFaqs = [
  {
    title: 'How are the FPS estimates calculated?',
    content: `SpecSmith models all 20 tracked games at 1440p High with a fixed ${UPGRADE_REFERENCE_CPU.name} reference CPU. These are model estimates, not measured benchmark results for your exact PC.`,
  },
  {
    title: 'Which GPUs does the calculator show?',
    content: `It shows up to ${UPGRADE_COMPARISON_PREVIEW_LIMIT} GPUs with the closest higher modelled averages, ordered from the smallest estimated difference upward. Price does not affect which GPUs appear.`,
  },
  {
    title: 'Does SpecSmith recommend which GPU I should buy?',
    content: 'No. This calculator compares modelled performance only. It does not use live prices, resale values, your exact CPU, power supply, case clearance, games or settings, so check those facts before choosing a card.',
  },
];

export function upgradeCalculatorFaqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: upgradeCalculatorFaqs.map((f) => ({
      '@type': 'Question',
      name: f.title,
      acceptedAnswer: { '@type': 'Answer', text: f.content },
    })),
  };
}
