import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import gamesData from '../data/games.json';
import { estimateFpsForBuild } from './fps';

export interface UpgradeCpu {
  id: string;
  name: string;
  price_usd: number;
  tier: number;
  cpu_multiplier: number;
  [key: string]: unknown;
}

interface Game {
  id: string;
  name: string;
  gpu_bound?: number;
  base_fps: Record<string, Record<string, number>>;
  [key: string]: unknown;
}

const cpus = cpuData as UpgradeCpu[];
const games = gamesData as Game[];

// Fixed reference GPU, same RTX 4090 the CPU matchup and "best CPU for
// game" pages already use to isolate CPU performance — keeps these numbers
// consistent with everything else on the site that compares CPUs.
const REFERENCE_GPU_ID = 'rtx4090';
const referenceGpu = (gpuData as { id: string; name: string; gpu_multiplier: number; [key: string]: unknown }[])
  .find(g => g.id === REFERENCE_GPU_ID)!;

export function getUpgradeCpus(): UpgradeCpu[] {
  return cpus;
}

export function getUpgradeCpu(id: string): UpgradeCpu | undefined {
  return cpus.find(c => c.id === id);
}

/** Same flat-percentage resale estimate as the GPU calculator — an
 * estimate, not a quote, framed that way everywhere it's shown. */
export function estimateCpuResaleValue(price: number): number {
  return Math.round((price * 0.6) / 5) * 5;
}

export function averageCpuFps(cpu: UpgradeCpu, resolution = '1440p', preset = 'high'): number {
  const total = games.reduce((sum, g) => sum + estimateFpsForBuild(referenceGpu, cpu, g, resolution, preset).estimated, 0);
  return Math.round(total / games.length);
}

/**
 * The CPU whose figures the estimator is conditional on.
 *
 * Exported because it is a LOAD-BEARING ASSUMPTION the pages state, not an
 * implementation detail — and read from here rather than written into prose so
 * the chip named on screen cannot drift from the chip the model used.
 */
export const CPU_UPGRADE_REFERENCE_GPU = referenceGpu as { id: string; name: string; [key: string]: unknown };

/**
 * Every tracked CPU that this one's modelled average does not reach.
 *
 * PRICE TOUCHES NOTHING HERE. `getCpuUpgradeCandidates` below keeps the
 * CHEAPEST chip in each tier before anything else happens, so an editorial
 * price in `cpus.json` silently decides which chips a reader is shown. That is
 * the same defect the GPU template carried, fixed the same way in #119: a page
 * presenting a performance comparison must not have its membership chosen by a
 * price, least of all one that is never checked against the live market.
 *
 * Returns the COMPLETE set — no per-tier filter, no cap — ordered by modelled
 * difference. The page previews the closest few; the full set is what the
 * count and range disclosures are computed from.
 */
export interface CpuUpgradeComparison {
  cpu: UpgradeCpu;
  /** Modelled 20-game average for the chip being compared against. */
  avgFpsCurrent: number;
  /** Modelled 20-game average for this chip. */
  avgFpsNew: number;
  /** Modelled difference, as a percentage of the current chip's average. */
  fpsDiffPct: number;
}

export function getCpuUpgradeComparisons(currentId: string): CpuUpgradeComparison[] {
  const current = getUpgradeCpu(currentId);
  if (!current) return [];
  const avgFpsCurrent = averageCpuFps(current);

  return cpus
    .filter((cpu) => cpu.id !== current.id)
    .map((cpu) => {
      const avgFpsNew = averageCpuFps(cpu);
      return {
        cpu,
        avgFpsCurrent,
        avgFpsNew,
        fpsDiffPct: Math.round(((avgFpsNew - avgFpsCurrent) / avgFpsCurrent) * 100),
      };
    })
    // Tier is a catalogue grouping, not evidence that one chip is faster. The
    // modelled average is what this page compares, so it is what filters.
    .filter((row) => row.avgFpsNew > row.avgFpsCurrent && row.fpsDiffPct > 0)
    .sort((a, b) => b.fpsDiffPct - a.fpsDiffPct || a.cpu.name.localeCompare(b.cpu.name));
}

/**
 * How many rows a guide previews.
 *
 * Same limit and same reasoning as the GPU template: the complete set runs to
 * dozens of rows for a low-end chip, which is hard to scan and would make 51
 * programmatic pages repeat most of the CPU catalogue at each other.
 */
export const CPU_UPGRADE_COMPARISON_PREVIEW_LIMIT = 8;

export function getClosestCpuUpgradeComparisons(
  currentId: string,
  limit = CPU_UPGRADE_COMPARISON_PREVIEW_LIMIT,
): CpuUpgradeComparison[] {
  if (!Number.isInteger(limit) || limit <= 0) return [];

  return getCpuUpgradeComparisons(currentId)
    .slice()
    .sort((a, b) => a.fpsDiffPct - b.fpsDiffPct || a.cpu.name.localeCompare(b.cpu.name))
    .slice(0, limit);
}

export type UpgradeVerdict = 'strong' | 'moderate' | 'marginal';

export interface CpuUpgradeCandidate {
  cpu: UpgradeCpu;
  netCost: number;
  avgFpsCurrent: number;
  avgFpsNew: number;
  fpsGainPct: number;
  verdict: UpgradeVerdict;
  /** Dollars spent per average FPS gained (netCost / FPS gained), rounded.
   * Null when netCost is 0; non-upgrades are filtered before candidates are
   * returned, so every returned candidate has a positive modeled FPS gain. */
  costPerFps: number | null;
}

/** CPUs worth considering as an upgrade from the given chip. Same
 * cheapest-per-tier selection as the GPU version — avoids clustering every
 * suggestion right at the next tier boundary.
 *
 * Tier is only a catalog grouping, not proof that one CPU is faster than
 * another in SpecSmith's modeled game set. Candidates therefore have to beat
 * the current CPU on the same 20-game 1440p High reference before they can be
 * called an upgrade. Filtering happens before the result limit so an invalid
 * higher-tier CPU cannot hide a later real upgrade. */
export function getCpuUpgradeCandidates(currentId: string, limit = 6): CpuUpgradeCandidate[] {
  const current = getUpgradeCpu(currentId);
  if (!current) return [];

  const resale = estimateCpuResaleValue(current.price_usd);
  const avgFpsCurrent = averageCpuFps(current);

  const cheapestPerTier = new Map<number, UpgradeCpu>();
  for (const c of cpus) {
    if (c.tier <= current.tier) continue;
    const existing = cheapestPerTier.get(c.tier);
    if (!existing || c.price_usd < existing.price_usd) cheapestPerTier.set(c.tier, c);
  }

  return [...cheapestPerTier.values()]
    .sort((a, b) => a.tier - b.tier)
    .map(cpu => {
      const avgFpsNew = averageCpuFps(cpu);
      const netCost = Math.max(0, cpu.price_usd - resale);
      const fpsGainPct = Math.round(((avgFpsNew - avgFpsCurrent) / avgFpsCurrent) * 100);
      // CPU multipliers only span ~0.87–1.05 across the whole catalog (versus
      // GPUs' much wider range), and most tracked games are GPU-bound even
      // before factoring in the fixed reference GPU here — so a genuine
      // best-case CPU-only FPS gain tops out around 5-6%, not the 20-30%+
      // swings a GPU upgrade can produce. Thresholds are scaled to that real
      // range rather than reusing the GPU calculator's numbers verbatim.
      const verdict: UpgradeVerdict = fpsGainPct >= 4 ? 'strong' : fpsGainPct >= 2 ? 'moderate' : 'marginal';
      const fpsGained = avgFpsNew - avgFpsCurrent;
      const costPerFps = netCost > 0 && fpsGained > 0 ? Math.round(netCost / fpsGained) : null;
      return { cpu, netCost, avgFpsCurrent, avgFpsNew, fpsGainPct, verdict, costPerFps };
    })
    .filter(candidate => candidate.avgFpsNew > candidate.avgFpsCurrent && candidate.fpsGainPct > 0)
    .slice(0, limit);
}

/** The candidate with the lowest $/FPS — the best-value pick, which isn't
 * always the one with the biggest raw FPS gain. Undefined when no
 * candidate has a computable costPerFps (see CpuUpgradeCandidate.costPerFps). */
export function getBestValueCpuCandidate(candidates: CpuUpgradeCandidate[]): CpuUpgradeCandidate | undefined {
  return candidates
    .filter((c): c is CpuUpgradeCandidate & { costPerFps: number } => c.costPerFps !== null)
    .reduce<CpuUpgradeCandidate | undefined>((best, c) => (!best || c.costPerFps! < best.costPerFps!) ? c : best, undefined);
}

export const cpuUpgradeCalculatorFaqs = [
  {
    title: 'How is the resale value calculated?',
    content: 'It\'s a flat 60% of the chip\'s current listed price, rounded to a clean number — a rough estimate to plan around, not a live market quote. Actual used prices vary by condition, region, and demand.',
  },
  {
    title: 'Why are the FPS gains so much smaller here than on the GPU calculator?',
    content: 'Most tracked games are GPU-bound, not CPU-bound, so even a big jump in CPU performance shows up as a small change in average FPS — the CPU\'s effect on gaming performance is real but narrow compared to a GPU upgrade. That\'s also why the "strong upgrade" threshold here is 4%+, not the GPU calculator\'s 30%+.',
  },
  {
    title: 'If the FPS gain is small, is a CPU upgrade ever worth it for gaming?',
    content: 'For pure gaming FPS, usually less than a GPU upgrade — but a stronger CPU still helps with 1% lows, streaming/multitasking while gaming, and CPU-heavy titles this calculator\'s 20-game average can understate. If gaming FPS alone is the goal, check the GPU Trade-Up Calculator first.',
  },
];

export function cpuUpgradeCalculatorFaqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: cpuUpgradeCalculatorFaqs.map((f) => ({
      '@type': 'Question',
      name: f.title,
      acceptedAnswer: { '@type': 'Answer', text: f.content },
    })),
  };
}
