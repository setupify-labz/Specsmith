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
  // Batch 2 — flagship and same-family upgrade questions
  { slug: 'rtx-4090-vs-rtx-4080-super',      gpuA: 'rtx4090',    gpuB: 'rtx4080s' },
  { slug: 'rtx-4070-ti-super-vs-rtx-4080',   gpuA: 'rtx4070tis', gpuB: 'rtx4080' },
  { slug: 'rtx-4070-super-vs-rtx-4070-ti',   gpuA: 'rtx4070s',   gpuB: 'rtx4070ti' },
  { slug: 'rtx-4070-vs-rtx-4060-ti',         gpuA: 'rtx4070',    gpuB: 'rtx4060ti' },
  { slug: 'rtx-4060-vs-rtx-3060-ti',         gpuA: 'rtx4060',    gpuB: 'rtx3060ti' },
  { slug: 'rtx-4070-vs-rtx-3080',            gpuA: 'rtx4070',    gpuB: 'rtx3080' },
  // Batch 2 — NVIDIA vs AMD rivalries
  { slug: 'rx-7900-xtx-vs-rtx-4090',         gpuA: 'rx7900xtx',  gpuB: 'rtx4090' },
  { slug: 'rtx-4080-vs-rx-7900-xtx',         gpuA: 'rtx4080',    gpuB: 'rx7900xtx' },
  { slug: 'rx-7900-xt-vs-rtx-4070-ti',       gpuA: 'rx7900xt',   gpuB: 'rtx4070ti' },
  { slug: 'rx-7600-xt-vs-rtx-4060',          gpuA: 'rx7600xt',   gpuB: 'rtx4060' },
  { slug: 'rtx-3060-vs-rx-6600-xt',          gpuA: 'rtx3060',    gpuB: 'rx6600xt' },
  { slug: 'rtx-3060-ti-vs-rx-6700-xt',       gpuA: 'rtx3060ti',  gpuB: 'rx6700xt' },
  // Batch 2 — RTX 50 series vs AMD
  { slug: 'rtx-5070-vs-rx-7900-gre',         gpuA: 'rtx5070',    gpuB: 'rx7900gre' },
  { slug: 'rtx-5070-ti-vs-rx-7900-xtx',      gpuA: 'rtx5070ti',  gpuB: 'rx7900xtx' },
  { slug: 'rtx-5060-ti-vs-rx-7700-xt',       gpuA: 'rtx5060ti',  gpuB: 'rx7700xt' },
  // Batch 2 — AMD family and budget picks
  { slug: 'rx-7800-xt-vs-rx-7900-gre',       gpuA: 'rx7800xt',   gpuB: 'rx7900gre' },
  { slug: 'rx-7700-xt-vs-rx-7800-xt',        gpuA: 'rx7700xt',   gpuB: 'rx7800xt' },
  { slug: 'rx-6600-vs-rtx-3050',             gpuA: 'rx6600',     gpuB: 'rtx3050' },
  { slug: 'arc-a750-vs-rx-6600',             gpuA: 'arca750',    gpuB: 'rx6600' },
  { slug: 'arc-b580-vs-rtx-4060-ti',         gpuA: 'arcb580',    gpuB: 'rtx4060ti' },
];

export interface MatchupCpu {
  id: string;
  name: string;
  brand: string;
  cores: number;
  threads: number;
  base_ghz: number;
  boost_ghz: number;
  tdp_watts: number;
  socket: string;
  price_usd: number;
  release_year: number;
  benchmark_score: number;
  cpu_multiplier: number;
  [key: string]: unknown;
}

export interface CpuMatchup {
  slug: string;
  cpuA: string;
  cpuB: string;
}

// CPU head-to-head pages, same /vs/<slug> URL space as GPU matchups.
// Only pairs where "they're effectively tied for gaming — buy the cheaper
// one" or a small edge is the genuinely correct real-world answer; the
// estimator compresses CPU deltas, so pairs with large real-world gaps
// (e.g. 5800X3D vs 7800X3D) don't belong here until the model captures them.
export const CPU_MATCHUPS: CpuMatchup[] = [
  // The questions everyone asks before buying
  { slug: 'ryzen-7-7800x3d-vs-i7-14700k',        cpuA: 'r7-7800x3d', cpuB: 'i7-14700k' },
  { slug: 'ryzen-7-7800x3d-vs-i9-14900k',        cpuA: 'r7-7800x3d', cpuB: 'i9-14900k' },
  { slug: 'ryzen-7-7800x3d-vs-ryzen-9-7950x3d',  cpuA: 'r7-7800x3d', cpuB: 'r9-7950x3d' },
  { slug: 'i7-14700k-vs-i9-14900k',              cpuA: 'i7-14700k',  cpuB: 'i9-14900k' },
  // Mid-range battles
  { slug: 'i5-13600k-vs-ryzen-5-7600x',          cpuA: 'i5-13600k',  cpuB: 'r5-7600x' },
  { slug: 'i5-14600k-vs-i5-13600k',              cpuA: 'i5-14600k',  cpuB: 'i5-13600k' },
  { slug: 'ryzen-7-9700x-vs-ryzen-7-7700x',      cpuA: 'r7-9700x',   cpuB: 'r7-7700x' },
  { slug: 'ryzen-5-9600x-vs-ryzen-5-7600x',      cpuA: 'r5-9600x',   cpuB: 'r5-7600x' },
  // Budget classics
  { slug: 'i5-12400f-vs-ryzen-5-5600',           cpuA: 'i5-12400f',  cpuB: 'r5-5600' },
  { slug: 'ryzen-5-7600-vs-i5-13400f',           cpuA: 'r5-7600',    cpuB: 'i5-13400f' },
];

// All GPU matchup FPS tables are computed against one strong gaming CPU so
// the GPU is the only variable being compared.
export const MATCHUP_CPU_ID = 'r7-7800x3d';

// CPU matchup tables are computed against the fastest GPU in the dataset so
// the CPU is the bottleneck wherever a game allows it to be.
export const MATCHUP_GPU_ID = 'rtx4090';

const gpus = gpuData as MatchupGpu[];
const cpus = cpuData as MatchupCpu[];

export function getMatchup(slug: string): Matchup | undefined {
  return MATCHUPS.find(m => m.slug === slug);
}

export function getCpuMatchup(slug: string): CpuMatchup | undefined {
  return CPU_MATCHUPS.find(m => m.slug === slug);
}

export function getMatchupGpu(id: string): MatchupGpu | undefined {
  return gpus.find(g => g.id === id);
}

export function getMatchupCpuById(id: string): MatchupCpu | undefined {
  return cpus.find(c => c.id === id);
}

export function getMatchupCpu() {
  return cpus.find(c => c.id === MATCHUP_CPU_ID)!;
}

export function getMatchupFixedGpu() {
  return gpus.find(g => g.id === MATCHUP_GPU_ID)!;
}

export function getMatchupTitle(m: Matchup): string {
  const a = getMatchupGpu(m.gpuA)?.name ?? m.gpuA;
  const b = getMatchupGpu(m.gpuB)?.name ?? m.gpuB;
  return `${a} vs ${b}`;
}

export function getCpuMatchupTitle(m: CpuMatchup): string {
  const a = getMatchupCpuById(m.cpuA)?.name ?? m.cpuA;
  const b = getMatchupCpuById(m.cpuB)?.name ?? m.cpuB;
  return `${a} vs ${b}`;
}

/** Matchups that share a GPU with the given one (for related-links). */
export function getRelatedMatchups(m: Matchup, limit = 4): Matchup[] {
  return MATCHUPS
    .filter(o => o.slug !== m.slug && (o.gpuA === m.gpuA || o.gpuB === m.gpuA || o.gpuA === m.gpuB || o.gpuB === m.gpuB))
    .slice(0, limit);
}

/** CPU matchups that share a CPU with the given one (for related-links). */
export function getRelatedCpuMatchups(m: CpuMatchup, limit = 4): CpuMatchup[] {
  return CPU_MATCHUPS
    .filter(o => o.slug !== m.slug && (o.cpuA === m.cpuA || o.cpuB === m.cpuA || o.cpuA === m.cpuB || o.cpuB === m.cpuB))
    .slice(0, limit);
}
