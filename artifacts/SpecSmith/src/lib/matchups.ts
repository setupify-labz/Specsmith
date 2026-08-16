import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import type { RouteMeta } from './seo';

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
  // Batch 3 — RDNA 4, Blackwell budget, Battlemage
  { slug: 'rx-9070-xt-vs-rtx-5070-ti',       gpuA: 'rx9070xt',   gpuB: 'rtx5070ti' },
  { slug: 'rx-9070-xt-vs-rx-7900-xtx',       gpuA: 'rx9070xt',   gpuB: 'rx7900xtx' },
  { slug: 'rx-9070-vs-rtx-5070',             gpuA: 'rx9070',     gpuB: 'rtx5070' },
  { slug: 'rx-9070-xt-vs-rx-9070',           gpuA: 'rx9070xt',   gpuB: 'rx9070' },
  { slug: 'rx-9060-xt-vs-rtx-5060-ti',       gpuA: 'rx9060xt16', gpuB: 'rtx5060ti' },
  { slug: 'rtx-5060-vs-rtx-4060',            gpuA: 'rtx5060',    gpuB: 'rtx4060' },
  { slug: 'rtx-5060-vs-rx-9060-xt-8gb',      gpuA: 'rtx5060',    gpuB: 'rx9060xt8' },
  { slug: 'arc-b570-vs-rtx-5050',            gpuA: 'arcb570',    gpuB: 'rtx5050' },
  // Batch 4 — mass expansion
  { slug: 'rtx-3050-vs-arc-a750', gpuA: 'rtx3050', gpuB: 'arca750' },
  { slug: 'rtx-3060-vs-rx-7600', gpuA: 'rtx3060', gpuB: 'rx7600' },
  { slug: 'rtx-3070-ti-vs-rx-6800', gpuA: 'rtx3070ti', gpuB: 'rx6800' },
  { slug: 'rtx-3080-ti-vs-rx-6950-xt', gpuA: 'rtx3080ti', gpuB: 'rx6950xt' },
  { slug: 'rtx-4070-ti-vs-rtx-3090', gpuA: 'rtx4070ti', gpuB: 'rtx3090' },
  { slug: 'rtx-4080-vs-rx-7900-xt', gpuA: 'rtx4080', gpuB: 'rx7900xt' },
  { slug: 'rtx-4080-super-vs-rtx-4070-ti-super', gpuA: 'rtx4080s', gpuB: 'rtx4070tis' },
  { slug: 'rtx-3050-vs-arc-a580', gpuA: 'rtx3050', gpuB: 'arca580' },
  { slug: 'rtx-3060-vs-rx-6700', gpuA: 'rtx3060', gpuB: 'rx6700' },
  { slug: 'rtx-4060-vs-arc-a770-16gb', gpuA: 'rtx4060', gpuB: 'arca770-16' },
  { slug: 'rtx-3080-12gb-vs-rx-9070', gpuA: 'rtx308012', gpuB: 'rx9070' },
  { slug: 'rtx-5070-ti-vs-rtx-3090-ti', gpuA: 'rtx5070ti', gpuB: 'rtx3090ti' },
  { slug: 'rtx-4070-ti-super-vs-rx-7900-gre', gpuA: 'rtx4070tis', gpuB: 'rx7900gre' },
  { slug: 'rtx-4080-super-vs-rx-7900-gre', gpuA: 'rtx4080s', gpuB: 'rx7900gre' },
  { slug: 'arc-a750-vs-arc-a580', gpuA: 'arca750', gpuB: 'arca580' },
  { slug: 'rx-7600-vs-rx-6700', gpuA: 'rx7600', gpuB: 'rx6700' },
  { slug: 'rtx-3070-vs-rx-7700-xt', gpuA: 'rtx3070', gpuB: 'rx7700xt' },
  { slug: 'rtx-5070-vs-rtx-3080-12gb', gpuA: 'rtx5070', gpuB: 'rtx308012' },
  { slug: 'rx-7900-xtx-vs-rx-7900-xt', gpuA: 'rx7900xtx', gpuB: 'rx7900xt' },
  { slug: 'rtx-5080-vs-rtx-4080', gpuA: 'rtx5080', gpuB: 'rtx4080' },
  { slug: 'rx-6600-vs-arc-a580', gpuA: 'rx6600', gpuB: 'arca580' },
  { slug: 'rtx-4050-vs-arc-b570', gpuA: 'rtx4050', gpuB: 'arcb570' },
  { slug: 'rtx-4060-ti-vs-rx-9060-xt', gpuA: 'rtx4060ti', gpuB: 'rx9060xt16' },
  { slug: 'rtx-3080-ti-vs-rx-9070-xt', gpuA: 'rtx3080ti', gpuB: 'rx9070xt' },
  { slug: 'rtx-4070-ti-vs-rtx-3090-ti', gpuA: 'rtx4070ti', gpuB: 'rtx3090ti' },
  { slug: 'rtx-5070-ti-vs-rx-7900-gre', gpuA: 'rtx5070ti', gpuB: 'rx7900gre' },
  { slug: 'rx-6600-xt-vs-arc-a580', gpuA: 'rx6600xt', gpuB: 'arca580' },
  { slug: 'rx-6650-xt-vs-arc-a770-8gb', gpuA: 'rx6650xt', gpuB: 'arca770-8' },
  { slug: 'rx-9060-xt-8gb-vs-rx-7600-xt', gpuA: 'rx9060xt8', gpuB: 'rx7600xt' },
  { slug: 'rx-9070-xt-vs-rx-6950-xt', gpuA: 'rx9070xt', gpuB: 'rx6950xt' },
  { slug: 'rtx-3090-ti-vs-rtx-3090', gpuA: 'rtx3090ti', gpuB: 'rtx3090' },
  { slug: 'rtx-3090-ti-vs-rx-7900-gre', gpuA: 'rtx3090ti', gpuB: 'rx7900gre' },
  { slug: 'rtx-3060-ti-vs-rx-6750-xt', gpuA: 'rtx3060ti', gpuB: 'rx6750xt' },
  { slug: 'rtx-4060-ti-16gb-vs-rtx-4060-ti', gpuA: 'rtx4060ti16', gpuB: 'rtx4060ti' },
  { slug: 'rtx-3080-12gb-vs-rtx-3080', gpuA: 'rtx308012', gpuB: 'rtx3080' },
  { slug: 'rtx-5070-ti-vs-rtx-4070-ti', gpuA: 'rtx5070ti', gpuB: 'rtx4070ti' },
  { slug: 'rtx-5080-vs-rx-7900-xt', gpuA: 'rtx5080', gpuB: 'rx7900xt' },
  { slug: 'rx-6700-vs-arc-b580', gpuA: 'rx6700', gpuB: 'arcb580' },
  { slug: 'rx-9060-xt-vs-rx-7700-xt', gpuA: 'rx9060xt16', gpuB: 'rx7700xt' },
  { slug: 'rtx-3080-vs-rx-9070', gpuA: 'rtx3080', gpuB: 'rx9070' },
  { slug: 'rtx-5070-ti-vs-rtx-3090', gpuA: 'rtx5070ti', gpuB: 'rtx3090' },
  { slug: 'rtx-5080-vs-rx-7900-xtx', gpuA: 'rtx5080', gpuB: 'rx7900xtx' },
  { slug: 'rtx-3060-vs-arc-a770-8gb', gpuA: 'rtx3060', gpuB: 'arca770-8' },
  { slug: 'rtx-3070-vs-rx-6750-xt', gpuA: 'rtx3070', gpuB: 'rx6750xt' },
  { slug: 'rtx-5070-vs-rx-7800-xt', gpuA: 'rtx5070', gpuB: 'rx7800xt' },
  { slug: 'rtx-4070-super-vs-rtx-4070', gpuA: 'rtx4070s', gpuB: 'rtx4070' },
  { slug: 'rtx-5070-ti-vs-rtx-4070-ti-super', gpuA: 'rtx5070ti', gpuB: 'rtx4070tis' },
  { slug: 'rx-7600-vs-arc-a770-8gb', gpuA: 'rx7600', gpuB: 'arca770-8' },
  { slug: 'rtx-4060-ti-16gb-vs-rx-9060-xt', gpuA: 'rtx4060ti16', gpuB: 'rx9060xt16' },
  { slug: 'rtx-3080-ti-vs-rx-6900-xt', gpuA: 'rtx3080ti', gpuB: 'rx6900xt' },
  { slug: 'rtx-4070-ti-vs-rx-9070-xt', gpuA: 'rtx4070ti', gpuB: 'rx9070xt' },
  { slug: 'rtx-4080-super-vs-rtx-4080', gpuA: 'rtx4080s', gpuB: 'rtx4080' },
  { slug: 'rx-6650-xt-vs-rx-6600-xt', gpuA: 'rx6650xt', gpuB: 'rx6600xt' },
  { slug: 'rtx-5060-vs-rx-7600-xt', gpuA: 'rtx5060', gpuB: 'rx7600xt' },
  { slug: 'rx-6950-xt-vs-rx-6900-xt', gpuA: 'rx6950xt', gpuB: 'rx6900xt' },
  { slug: 'rtx-3090-vs-rx-9070-xt', gpuA: 'rtx3090', gpuB: 'rx9070xt' },
  { slug: 'rtx-4070-ti-vs-rx-7900-gre', gpuA: 'rtx4070ti', gpuB: 'rx7900gre' },
  { slug: 'rx-6750-xt-vs-rx-6700-xt', gpuA: 'rx6750xt', gpuB: 'rx6700xt' },
  { slug: 'rtx-3070-vs-rx-9060-xt', gpuA: 'rtx3070', gpuB: 'rx9060xt16' },
  { slug: 'rtx-5060-ti-vs-rtx-4060-ti-16gb', gpuA: 'rtx5060ti', gpuB: 'rtx4060ti16' },
  { slug: 'rtx-4070-ti-vs-rtx-3080-ti', gpuA: 'rtx4070ti', gpuB: 'rtx3080ti' },
  { slug: 'rtx-3090-vs-rx-7900-gre', gpuA: 'rtx3090', gpuB: 'rx7900gre' },
  { slug: 'rtx-5060-vs-arc-b580', gpuA: 'rtx5060', gpuB: 'arcb580' },
  { slug: 'rtx-3070-ti-vs-rx-6800-xt', gpuA: 'rtx3070ti', gpuB: 'rx6800xt' },
  { slug: 'rtx-5070-vs-rtx-3080', gpuA: 'rtx5070', gpuB: 'rtx3080' },
  { slug: 'rtx-3090-vs-rtx-3080-ti', gpuA: 'rtx3090', gpuB: 'rtx3080ti' },
  { slug: 'rtx-4070-ti-super-vs-rtx-3090-ti', gpuA: 'rtx4070tis', gpuB: 'rtx3090ti' },
  { slug: 'rtx-3060-vs-arc-b580', gpuA: 'rtx3060', gpuB: 'arcb580' },
  { slug: 'rx-6800-xt-vs-rx-6800', gpuA: 'rx6800xt', gpuB: 'rx6800' },
  { slug: 'rtx-3080-12gb-vs-rx-6800-xt', gpuA: 'rtx308012', gpuB: 'rx6800xt' },
  { slug: 'rtx-3090-ti-vs-rx-9070-xt', gpuA: 'rtx3090ti', gpuB: 'rx9070xt' },
  { slug: 'rtx-4080-super-vs-rx-7900-xt', gpuA: 'rtx4080s', gpuB: 'rx7900xt' },
  { slug: 'rtx-5050-vs-rtx-4050', gpuA: 'rtx5050', gpuB: 'rtx4050' },
  { slug: 'rx-7700-xt-vs-rx-6750-xt', gpuA: 'rx7700xt', gpuB: 'rx6750xt' },
  { slug: 'rx-9070-vs-rx-7800-xt', gpuA: 'rx9070', gpuB: 'rx7800xt' },
  { slug: 'rtx-5070-ti-vs-rtx-3080-ti', gpuA: 'rtx5070ti', gpuB: 'rtx3080ti' },
  { slug: 'rtx-4070-ti-super-vs-rx-9070-xt', gpuA: 'rtx4070tis', gpuB: 'rx9070xt' },
  { slug: 'rx-6700-vs-arc-a770-8gb', gpuA: 'rx6700', gpuB: 'arca770-8' },
  { slug: 'rx-7600-xt-vs-arc-a770-16gb', gpuA: 'rx7600xt', gpuB: 'arca770-16' },
  { slug: 'rx-9070-vs-rx-6800-xt', gpuA: 'rx9070', gpuB: 'rx6800xt' },
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
  // Zen 5 X3D and Arrow Lake
  { slug: 'ryzen-7-9800x3d-vs-ryzen-7-7800x3d',  cpuA: 'r7-9800x3d', cpuB: 'r7-7800x3d' },
  { slug: 'ryzen-7-9800x3d-vs-ryzen-9-9950x3d',  cpuA: 'r7-9800x3d', cpuB: 'r9-9950x3d' },
  { slug: 'ryzen-7-9800x3d-vs-ryzen-7-9700x',    cpuA: 'r7-9800x3d', cpuB: 'r7-9700x' },
  { slug: 'ryzen-7-9850x3d-vs-ryzen-7-9800x3d',  cpuA: 'r7-9850x3d', cpuB: 'r7-9800x3d' },
  { slug: 'core-ultra-9-285k-vs-i9-14900k',      cpuA: 'cu9-285k',   cpuB: 'i9-14900k' },
  { slug: 'core-ultra-7-265k-vs-i7-14700k',      cpuA: 'cu7-265k',   cpuB: 'i7-14700k' },
  { slug: 'core-ultra-5-245k-vs-i5-14600k',      cpuA: 'cu5-245k',   cpuB: 'i5-14600k' },
  // Batch 2 — mass expansion
  { slug: 'ryzen-5-7600x-vs-ryzen-7-5800x', cpuA: 'r5-7600x', cpuB: 'r7-5800x' },
  { slug: 'i7-14700k-vs-ryzen-7-9700x', cpuA: 'i7-14700k', cpuB: 'r7-9700x' },
  { slug: 'i9-14900k-vs-ryzen-9-7950x', cpuA: 'i9-14900k', cpuB: 'r9-7950x' },
  { slug: 'i9-14900ks-vs-ryzen-9-9900x3d', cpuA: 'i9-14900ks', cpuB: 'r9-9900x3d' },
  { slug: 'ryzen-9-7950x3d-vs-ryzen-9-7900x3d', cpuA: 'r9-7950x3d', cpuB: 'r9-7900x3d' },
  { slug: 'ryzen-7-5700x-vs-ryzen-9-3900x', cpuA: 'r7-5700x', cpuB: 'r9-3900x' },
  { slug: 'i7-13700k-vs-ryzen-7-5800x3d', cpuA: 'i7-13700k', cpuB: 'r7-5800x3d' },
  { slug: 'i9-14900ks-vs-ryzen-9-9950x', cpuA: 'i9-14900ks', cpuB: 'r9-9950x' },
  { slug: 'ryzen-9-9950x3d-vs-ryzen-9-7900x3d', cpuA: 'r9-9950x3d', cpuB: 'r9-7900x3d' },
  { slug: 'i5-14600k-vs-ryzen-5-7600x', cpuA: 'i5-14600k', cpuB: 'r5-7600x' },
  { slug: 'i9-12900k-vs-ryzen-7-7700x', cpuA: 'i9-12900k', cpuB: 'r7-7700x' },
  { slug: 'i5-14600k-vs-ryzen-7-5800x', cpuA: 'i5-14600k', cpuB: 'r7-5800x' },
  { slug: 'core-ultra-7-265k-vs-ryzen-7-7700x', cpuA: 'cu7-265k', cpuB: 'r7-7700x' },
  { slug: 'ryzen-9-9950x3d-vs-ryzen-9-7950x3d', cpuA: 'r9-9950x3d', cpuB: 'r9-7950x3d' },
  { slug: 'i5-14600k-vs-ryzen-7-5700x', cpuA: 'i5-14600k', cpuB: 'r7-5700x' },
  { slug: 'core-ultra-7-265k-vs-i9-12900k', cpuA: 'cu7-265k', cpuB: 'i9-12900k' },
  { slug: 'i9-13900ks-vs-ryzen-9-9900x3d', cpuA: 'i9-13900ks', cpuB: 'r9-9900x3d' },
  { slug: 'i5-14600k-vs-ryzen-9-3900x', cpuA: 'i5-14600k', cpuB: 'r9-3900x' },
  { slug: 'core-ultra-7-265k-vs-ryzen-9-5900x', cpuA: 'cu7-265k', cpuB: 'r9-5900x' },
  { slug: 'i9-14900k-vs-i9-14900kf', cpuA: 'i9-14900k', cpuB: 'i9-14900kf' },
];

// All GPU matchup FPS tables are computed against one strong gaming CPU so
// the GPU is the only variable being compared.
export const MATCHUP_CPU_ID = 'r7-9800x3d';

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

/** Average FPS per $100 of part price — bigger is better, easy to compare. */
export function fpsPer100(avgFps: number, price: number): number {
  return Math.round((avgFps / price) * 1000) / 10;
}

export interface VerdictInput {
  kind: 'GPU' | 'CPU';
  nameA: string; nameB: string;
  priceA: number; priceB: number;
  winsA: number; winsB: number;
  total: number;
  avgA: number; avgB: number;
  resolution: string;
}

/**
 * Written verdict for a matchup page, generated from the same numbers the
 * verdict cards show so the text can never contradict them. Recomputed when
 * the resolution toggle changes; the prerendered copy uses the default
 * resolution, which is what search engines index.
 */
export function buildVerdictParagraph(v: VerdictInput): string {
  const aWon = v.winsA > v.winsB;
  const tie = v.winsA === v.winsB;
  const [wName, lName] = aWon ? [v.nameA, v.nameB] : [v.nameB, v.nameA];
  const [wPrice, lPrice] = aWon ? [v.priceA, v.priceB] : [v.priceB, v.priceA];
  const [wAvg, lAvg] = aWon ? [v.avgA, v.avgB] : [v.avgB, v.avgA];
  const wins = Math.max(v.winsA, v.winsB);
  const fmt = (n: number) => Math.round(n).toLocaleString();

  const perDollarW = wAvg / wPrice;
  const perDollarL = lAvg / lPrice;
  const winnerIsValue = perDollarW >= perDollarL;
  const valuePct = Math.round((Math.max(perDollarW, perDollarL) / Math.min(perDollarW, perDollarL) - 1) * 100);
  const audience = v.kind === 'CPU' ? 'for gaming' : 'for most gamers';

  if (tie) {
    const samePrice = v.priceA === v.priceB;
    const [cheapName, cheapPrice, richPrice] = v.priceA <= v.priceB
      ? [v.nameA, v.priceA, v.priceB] : [v.nameB, v.priceB, v.priceA];
    const base = `The ${v.nameA} and ${v.nameB} are effectively tied across all ${v.total} compared games at ${v.resolution} High — ${fmt(v.avgA)} vs ${fmt(v.avgB)} average FPS, inside this estimator's margin of error.`;
    if (samePrice) {
      return `${base} They even cost the same at $${fmt(v.priceA)}, so pick whichever fits the platform you're building on or is cheaper the day you buy.`;
    }
    return `${base} That makes price the deciding factor: at $${fmt(cheapPrice)} vs $${fmt(richPrice)}, the ${cheapName} delivers about ${valuePct}% more FPS per dollar and is the smarter buy ${audience}.`;
  }

  const pctFaster = Math.round((wAvg / lAvg - 1) * 100);
  const fasterClause = pctFaster >= 1
    ? `averaging ${pctFaster}% higher FPS (${fmt(wAvg)} vs ${fmt(lAvg)})`
    : `though the average gap is under 1% (${fmt(wAvg)} vs ${fmt(lAvg)} FPS)`;
  const winClause = wins === v.total
    ? `won all ${v.total} compared games`
    : `won ${wins} of ${v.total} compared games (the rest were too close to call)`;

  if (winnerIsValue) {
    return `The ${wName} ${winClause} at ${v.resolution} High, ${fasterClause}. At $${fmt(wPrice)} vs $${fmt(lPrice)} it's also the better value per frame — a clean sweep, making it the clear pick ${audience}.`;
  }
  return `The ${wName} ${winClause} at ${v.resolution} High, ${fasterClause}. But it costs $${fmt(wPrice)} to the ${lName}'s $${fmt(lPrice)}, so the ${lName} delivers about ${valuePct}% more FPS per dollar. Chasing maximum frames? Get the ${wName}. Maximizing a budget? The ${lName} is the smarter pick.`;
}

// Kept here (not in lib/seo.ts) so pages that don't need GPU/CPU matchup
// data don't pull this module's JSON imports into their shared chunk.
export function getMatchupMeta(matchup: Matchup): RouteMeta {
  const a = getMatchupGpu(matchup.gpuA);
  const b = getMatchupGpu(matchup.gpuB);
  const nameA = a?.name ?? matchup.gpuA;
  const nameB = b?.name ?? matchup.gpuB;
  return {
    path: `/vs/${matchup.slug}`,
    title: `${nameA} vs ${nameB} | SpecSmith`,
    description: `${nameA} vs ${nameB}: estimated FPS in 20 games at 1080p, 1440p & 4K, full specs, and price-per-frame value — see which GPU wins.`,
  };
}

export function getCpuMatchupMeta(matchup: CpuMatchup): RouteMeta {
  const a = getMatchupCpuById(matchup.cpuA);
  const b = getMatchupCpuById(matchup.cpuB);
  const nameA = a?.name ?? matchup.cpuA;
  const nameB = b?.name ?? matchup.cpuB;
  return {
    path: `/vs/${matchup.slug}`,
    title: `${nameA} vs ${nameB} | SpecSmith`,
    description: `${nameA} vs ${nameB} for gaming: estimated FPS in 20 games with an RTX 4090, full specs, and price-per-frame value — see which CPU wins.`,
  };
}
