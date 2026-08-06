import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import type { RouteMeta } from './seo';
import { SITE_URL } from './seo';

interface Gpu { id: string; name: string; brand: string; price_usd: number; vram_gb: number; benchmark_score: number; }
interface Cpu { id: string; name: string; brand: string; price_usd: number; cores: number; threads: number; benchmark_score: number; }

const gpus = gpuData as Gpu[];
const cpus = cpuData as Cpu[];

export interface UseCaseTier {
  label: string;
  maxGpuPrice: number;
  maxCpuPrice: number;
}

export interface UseCase {
  slug: string;
  title: string;
  shortTitle: string;
  intro: string;
  criteria: string;
  tiers: UseCaseTier[];
  // 'encode' prefers NVIDIA (NVENC hardware encoder) at equal budget — a
  // real, well-documented hardware fact, not an invented benchmark.
  // 'vram' prefers the highest-VRAM card in budget, ties broken by score.
  gpuStrategy: 'encode' | 'vram';
}

export const USE_CASES: UseCase[] = [
  {
    slug: 'streaming',
    title: 'Best PC Build for Streaming (Twitch/YouTube)',
    shortTitle: 'Streaming',
    intro: 'Streaming while gaming means your CPU is doing double duty — running the game and encoding video at the same time — so core count matters more here than in a pure gaming build. NVIDIA GPUs also include a dedicated NVENC hardware encoder, which offloads video encoding from the CPU almost entirely and is the standard pick for OBS/Streamlabs setups.',
    criteria: 'CPU picked by highest core count in budget (ties broken by benchmark score). GPU picked by NVIDIA-first (for NVENC), then benchmark score.',
    tiers: [
      { label: 'Starter Streamer', maxGpuPrice: 350, maxCpuPrice: 250 },
      { label: 'Full-Time Streamer', maxGpuPrice: 700, maxCpuPrice: 500 },
      { label: 'High-End Streamer', maxGpuPrice: 1500, maxCpuPrice: 900 },
    ],
    gpuStrategy: 'encode',
  },
  {
    slug: 'video-editing',
    title: 'Best PC Build for Video Editing',
    shortTitle: 'Video Editing',
    intro: 'Video editing software leans hard on GPU VRAM for scrubbing, effects, and export acceleration (Premiere Pro, DaVinci Resolve) — a card with more VRAM will handle higher-resolution timelines and more layers before it starts choking, even if its raw gaming benchmark score is lower than a VRAM-starved competitor. CPU core count still matters for encoding exports and background renders.',
    criteria: 'GPU picked by highest VRAM in budget (ties broken by benchmark score). CPU picked by highest core count in budget (ties broken by benchmark score).',
    tiers: [
      { label: 'Hobbyist Editor', maxGpuPrice: 450, maxCpuPrice: 300 },
      { label: 'Serious Editor', maxGpuPrice: 900, maxCpuPrice: 600 },
      { label: 'Professional Editor', maxGpuPrice: 1800, maxCpuPrice: 1000 },
    ],
    gpuStrategy: 'vram',
  },
];

export function getUseCase(slug: string): UseCase | undefined {
  return USE_CASES.find(u => u.slug === slug);
}

function pickGpu(strategy: UseCase['gpuStrategy'], maxPrice: number): Gpu {
  const pool = gpus.filter(g => g.price_usd <= maxPrice);
  if (strategy === 'encode') {
    const nvidia = pool.filter(g => g.brand === 'NVIDIA').sort((a, b) => b.benchmark_score - a.benchmark_score);
    if (nvidia.length > 0) return nvidia[0];
    return [...pool].sort((a, b) => b.benchmark_score - a.benchmark_score)[0];
  }
  return [...pool].sort((a, b) => (b.vram_gb - a.vram_gb) || (b.benchmark_score - a.benchmark_score))[0];
}

function pickCpu(maxPrice: number): Cpu {
  const pool = cpus.filter(c => c.price_usd <= maxPrice);
  return [...pool].sort((a, b) => (b.cores - a.cores) || (b.benchmark_score - a.benchmark_score))[0];
}

export interface TierPick {
  tier: UseCaseTier;
  gpu: Gpu;
  cpu: Cpu;
}

export function getTierPicks(useCase: UseCase): TierPick[] {
  return useCase.tiers.map(tier => ({
    tier,
    gpu: pickGpu(useCase.gpuStrategy, tier.maxGpuPrice),
    cpu: pickCpu(tier.maxCpuPrice),
  }));
}

export function getUseCasePageMeta(useCase: UseCase): RouteMeta {
  return {
    path: `/best-pc-for/${useCase.slug}`,
    title: `${useCase.title} (2026) | SpecSmith`,
    description: `${useCase.shortTitle}-focused GPU and CPU picks across three budgets, chosen by ${useCase.gpuStrategy === 'encode' ? 'NVENC encoding support' : 'VRAM headroom'} and core count — with real prices and buy links.`,
  };
}

export function useCaseItemListJsonLd(useCase: UseCase, picks: TierPick[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: useCase.title,
    itemListElement: picks.flatMap((p, i) => [
      { '@type': 'ListItem', position: i * 2 + 1, name: p.gpu.name, url: `${SITE_URL}/builder?gpu=${p.gpu.id}` },
      { '@type': 'ListItem', position: i * 2 + 2, name: p.cpu.name, url: `${SITE_URL}/builder?cpu=${p.cpu.id}` },
    ]),
  };
}
