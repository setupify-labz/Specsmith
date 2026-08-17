import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import gamesData from '../data/games.json';
import { getUseCase, getTierPicks } from './useCaseBuilds';
import { estimateFpsForBuild } from './fps';
import type { RouteMeta } from './seo';

interface Gpu { id: string; name: string; brand: string; price_usd: number; vram_gb: number; benchmark_score: number; }
interface Cpu { id: string; name: string; brand: string; price_usd: number; cores: number; threads: number; benchmark_score: number; }
// Richer variants for the FPS calculation only — QuizResult.gpu/cpu stay
// typed as the narrower Gpu/Cpu above so both this module's own picks and
// useCaseBuilds.ts's TierPick.gpu/cpu (which don't carry *_multiplier)
// satisfy the same field.
interface FpsGpu extends Gpu { gpu_multiplier: number; [key: string]: unknown; }
interface FpsCpu extends Cpu { cpu_multiplier: number; [key: string]: unknown; }
interface Game { id: string; name: string; gpu_bound?: number; base_fps: Record<string, Record<string, number>>; [key: string]: unknown; }

const gpus = gpuData as FpsGpu[];
const cpus = cpuData as FpsCpu[];
const games = gamesData as Game[];

// Reference settings for the "gaming" quiz result's FPS estimate — same
// 1440p High baseline the /upgrade calculators use elsewhere on the site,
// so this number means the same thing wherever it's shown. Not used for
// the other use cases: their picks are chosen by non-gaming criteria
// (NVENC, core count, VRAM...) the way the /best-pc-for guides already
// are, and those guides don't show a gaming FPS number either.
const GAMING_FPS_RESOLUTION = '1440p';
const GAMING_FPS_PRESET = 'high';

function averageGamingFps(gpu: FpsGpu, cpu: FpsCpu): number {
  const total = games.reduce((sum, g) => sum + estimateFpsForBuild(gpu, cpu, g, GAMING_FPS_RESOLUTION, GAMING_FPS_PRESET).estimated, 0);
  return Math.round(total / games.length);
}

export interface QuizUseCase {
  slug: string;
  label: string;
  description: string;
}

// 'gaming' isn't part of useCaseBuilds.ts's USE_CASES (that module covers
// the non-gaming workloads) — its picks are computed locally below by raw
// benchmark score instead of borrowing another use case's strategy.
export const QUIZ_USE_CASES: QuizUseCase[] = [
  { slug: 'gaming', label: 'Gaming', description: 'Maximize FPS per dollar for the games you actually play.' },
  { slug: 'streaming', label: 'Streaming', description: 'Game and stream at the same time without either one stuttering.' },
  { slug: 'video-editing', label: 'Video Editing', description: 'Smooth timeline scrubbing and fast exports in Premiere/Resolve.' },
  { slug: 'ai-local-llm', label: 'Local AI / LLMs', description: 'Run local language models (Ollama, LM Studio) on your own GPU.' },
  { slug: 'home-office', label: 'Home Office', description: 'Multitasking, video calls, spreadsheets, and everyday work.' },
];

export function getQuizUseCase(slug: string): QuizUseCase | undefined {
  return QUIZ_USE_CASES.find((u) => u.slug === slug);
}

interface GamingTier { label: string; maxGpuPrice: number; maxCpuPrice: number; }

// Same budget breakpoints as the Streaming use case tiers — a sensible,
// already-tuned budget/mid/high split — just picked by raw benchmark score
// instead of NVENC-first/core-count.
const GAMING_TIERS: GamingTier[] = [
  { label: 'Budget Gamer', maxGpuPrice: 350, maxCpuPrice: 250 },
  { label: 'Mid-Range Gamer', maxGpuPrice: 700, maxCpuPrice: 500 },
  { label: 'High-End Gamer', maxGpuPrice: 1500, maxCpuPrice: 900 },
];

function bestByScore<T extends { price_usd: number; benchmark_score: number }>(pool: T[]): T | undefined {
  return [...pool].sort((a, b) => b.benchmark_score - a.benchmark_score || a.price_usd - b.price_usd)[0];
}

export interface QuizTierOption {
  index: number;
  label: string;
}

export function getQuizTiers(useCaseSlug: string): QuizTierOption[] {
  if (useCaseSlug === 'gaming') return GAMING_TIERS.map((t, index) => ({ index, label: t.label }));
  const uc = getUseCase(useCaseSlug);
  if (!uc) return [];
  return uc.tiers.map((t, index) => ({ index, label: t.label }));
}

export interface QuizResult {
  useCase: QuizUseCase;
  tierLabel: string;
  gpu: Gpu;
  cpu: Cpu;
  /** Estimated average FPS across all tracked games at 1440p High — only
   * set for the "gaming" use case, where that's the actual picking
   * criterion. Other use cases pick by non-gaming criteria and don't
   * carry this, same as the /best-pc-for guides they mirror. */
  avgFps?: number;
}

export function getQuizResult(useCaseSlug: string, tierIndex: number): QuizResult | null {
  const useCase = getQuizUseCase(useCaseSlug);
  if (!useCase) return null;

  if (useCaseSlug === 'gaming') {
    const tier = GAMING_TIERS[tierIndex];
    if (!tier) return null;
    const gpu = bestByScore(gpus.filter((g) => g.price_usd <= tier.maxGpuPrice));
    const cpu = bestByScore(cpus.filter((c) => c.price_usd <= tier.maxCpuPrice));
    if (!gpu || !cpu) return null;
    return { useCase, tierLabel: tier.label, gpu, cpu, avgFps: averageGamingFps(gpu, cpu) };
  }

  const uc = getUseCase(useCaseSlug);
  if (!uc) return null;
  const picks = getTierPicks(uc);
  const pick = picks[tierIndex];
  if (!pick) return null;
  return { useCase, tierLabel: pick.tier.label, gpu: pick.gpu, cpu: pick.cpu };
}

export function getQuizPageMeta(useCaseSlug: string): RouteMeta {
  const useCase = getQuizUseCase(useCaseSlug);
  const label = useCase?.label ?? useCaseSlug;
  return {
    path: `/quiz/${useCaseSlug}`,
    title: `PC Build Quiz — Best Build for ${label} (2026) | SpecSmith`,
    description: `Answer one quick question and get a matched GPU + CPU pick for ${label.toLowerCase()}, with real prices and Amazon/Newegg buy links.`,
  };
}

export function quizFaqJsonLd(faqs: { title: string; content: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.title,
      acceptedAnswer: { '@type': 'Answer', text: f.content },
    })),
  };
}
