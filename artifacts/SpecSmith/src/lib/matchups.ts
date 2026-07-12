import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';

export interface MatchupGpu {
  id: string;
  name: string;
  brand: string;
  series: string;
  price_usd: number;
  vram_gb: number;
  tdp_watts: number;
  architecture: string;
  release_year: number;
  benchmark_score: number;
  gpu_multiplier: number;
  [key: string]: unknown;
}

export interface Matchup {
  slug: string;
  gpuA: string;
  gpuB: string;
}

// Curated head-to-head GPU comparison pages (SEO landing pages at /vs/<slug>).
// To add a new page, add a pair here — routes, prerender, meta, and the
// index page all derive from this list. Keep slugs stable once published:
// they are indexed URLs.
export const MATCHUPS: Matchup[] = [
  // NVIDIA vs AMD same-tier rivalries
  { slug: 'rtx-4070-vs-rx-7800-xt',          gpuA: 'rtx4070',    gpuB: 'rx7800xt' },
  { slug: 'rtx-4070-super-vs-rx-7800-xt',    gpuA: 'rtx4070s',   gpuB: 'rx7800xt' },
  { slug: 'rtx-4060-vs-rx-7600',             gpuA: 'rtx4060',    gpuB: 'rx7600' },
  { slug: 'rtx-4060-ti-vs-rx-7700-xt',       gpuA: 'rtx4060ti',  gpuB: 'rx7700xt' },
  { slug: 'rtx-4080-super-vs-rx-7900-xtx',   gpuA: 'rtx4080s',   gpuB: 'rx7900xtx' },
  { slug: 'rtx-4070-ti-super-vs-rx-7900-xt', gpuA: 'rtx4070tis', gpuB: 'rx7900xt' },
  { slug: 'rtx-3080-vs-rx-6800-xt',          gpuA: 'rtx3080',    gpuB: 'rx6800xt' },
  { slug: 'rtx-3070-vs-rx-6700-xt',          gpuA: 'rtx3070',    gpuB: 'rx6700xt' },
  { slug: 'rtx-4060-vs-arc-b580',            gpuA: 'rtx4060',    gpuB: 'arcb580' },
  { slug: 'rx-7600-vs-arc-b580',             gpuA: 'rx7600',     gpuB: 'arcb580' },
  // New generation vs old generation upgrade questions
  { slug: 'rtx-5090-vs-rtx-4090',            gpuA: 'rtx5090',    gpuB: 'rtx4090' },
  { slug: 'rtx-5080-vs-rtx-4090',            gpuA: 'rtx5080',    gpuB: 'rtx4090' },
  { slug: 'rtx-5080-vs-rtx-4080-super',      gpuA: 'rtx5080',    gpuB: 'rtx4080s' },
  { slug: 'rtx-5070-ti-vs-rtx-4080',         gpuA: 'rtx5070ti',  gpuB: 'rtx4080' },
  { slug: 'rtx-5070-vs-rtx-4070-super',      gpuA: 'rtx5070',    gpuB: 'rtx4070s' },
  { slug: 'rtx-5060-ti-vs-rtx-4060-ti',      gpuA: 'rtx5060ti',  gpuB: 'rtx4060ti' },
  { slug: 'rtx-4060-vs-rtx-3060',            gpuA: 'rtx4060',    gpuB: 'rtx3060' },
  { slug: 'rtx-4060-ti-vs-rtx-3070',         gpuA: 'rtx4060ti',  gpuB: 'rtx3070' },
  // Value picks
  { slug: 'rx-7900-gre-vs-rtx-4070-super',   gpuA: 'rx7900gre',  gpuB: 'rtx4070s' },
  { slug: 'rx-6700-xt-vs-rtx-4060',          gpuA: 'rx6700xt',   gpuB: 'rtx4060' },
];

// All matchup FPS tables are computed against one strong gaming CPU so the
// GPU is the only variable being compared.
export const MATCHUP_CPU_ID = 'r7-7800x3d';

const gpus = gpuData as MatchupGpu[];

export function getMatchup(slug: string): Matchup | undefined {
  return MATCHUPS.find(m => m.slug === slug);
}

export function getMatchupGpu(id: string): MatchupGpu | undefined {
  return gpus.find(g => g.id === id);
}

export function getMatchupCpu() {
  return (cpuData as { id: string; name: string; cpu_multiplier: number; [key: string]: unknown }[])
    .find(c => c.id === MATCHUP_CPU_ID)!;
}

export function getMatchupTitle(m: Matchup): string {
  const a = getMatchupGpu(m.gpuA)?.name ?? m.gpuA;
  const b = getMatchupGpu(m.gpuB)?.name ?? m.gpuB;
  return `${a} vs ${b}`;
}

/** Matchups that share a GPU with the given one (for related-links). */
export function getRelatedMatchups(m: Matchup, limit = 4): Matchup[] {
  return MATCHUPS
    .filter(o => o.slug !== m.slug && (o.gpuA === m.gpuA || o.gpuB === m.gpuA || o.gpuA === m.gpuB || o.gpuB === m.gpuB))
    .slice(0, limit);
}
