import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import type { RouteMeta } from './seo';
import { SITE_URL } from './seo';
import { recommendable } from './catalogLifecycle';

interface Gpu { id: string; name: string; brand: string; price_usd: number; vram_gb: number; benchmark_score: number; }
interface Cpu { id: string; name: string; brand: string; price_usd: number; cores: number; threads: number; benchmark_score: number; integrated_graphics: string | null; }

// These are purchase recommendations, so only parts the catalog audit lists
// as eligible enter the pick pools.
const gpus = recommendable(gpuData as Gpu[]);
const cpus = recommendable(cpuData as Cpu[]);

export interface UseCaseTier {
  label: string;
  /** null = no discrete GPU: the build uses the CPU's integrated graphics. */
  maxGpuPrice: number | null;
  maxCpuPrice: number;
}

export interface UseCaseFaq {
  title: string;
  content: string;
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
  // 'budget' picks the cheapest card in budget — for workloads where raw
  // GPU performance doesn't matter, so the budget goes to CPU instead.
  gpuStrategy: 'encode' | 'vram' | 'budget';
  faqs: UseCaseFaq[];
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
    faqs: [
      {
        title: 'Do I need an NVIDIA GPU to stream well?',
        content: 'Not strictly — AMD (AMF) and Intel (QuickSync) both ship their own hardware video encoders too. NVIDIA\'s NVENC is favored because it has the lowest performance overhead and the widest, most mature support in OBS/Streamlabs, which is why these picks default to it when the budget allows.',
      },
      {
        title: 'Why does CPU core count matter more for streaming than for pure gaming?',
        content: 'A streaming PC is running the game and (if you\'re not using NVENC/hardware encoding) potentially software-encoding video at the same time. More cores means more headroom to do both without either the game or the stream stuttering.',
      },
      {
        title: 'What if I already use a capture card or a second streaming PC?',
        content: 'Then the encoding load is off your gaming PC entirely, and you can prioritize a GPU picked purely for game performance instead of NVENC — these tiers assume a single-PC streaming setup.',
      },
    ],
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
    faqs: [
      {
        title: 'Why pick a GPU by VRAM instead of gaming benchmark score?',
        content: 'Editing software loads the full timeline, effects, and cache into video memory — run out of VRAM and the software drops to slower fallback paths or stutters, regardless of how fast the GPU is at rendering games. More VRAM raises the ceiling on resolution and layer count before that happens.',
      },
      {
        title: 'Does CPU still matter for video editing?',
        content: 'Yes — exports, proxy generation, and some effects are CPU-bound (or split between CPU and GPU depending on the codec), so these picks still weight core count heavily, just secondary to the GPU\'s VRAM.',
      },
      {
        title: 'What about storage speed?',
        content: 'A fast NVMe SSD matters a lot for scrubbing high-resolution footage smoothly, but storage isn\'t part of this GPU/CPU pairing — see the Storage buying guide under Parts Guides for picks.',
      },
    ],
  },
  {
    slug: 'ai-local-llm',
    title: 'Best PC Build for Local AI / LLM Inference',
    shortTitle: 'Local AI / LLMs',
    intro: 'Running local language models (through tools like Ollama or LM Studio) is almost entirely a VRAM problem — the model has to fit on the GPU to run at usable speed, so more VRAM directly means larger or less-aggressively-quantized models you can actually run, even ahead of raw gaming benchmark score. System RAM and CPU matter far less here than for gaming, since inference happens on the GPU.',
    criteria: 'GPU picked by highest VRAM in budget (ties broken by benchmark score) — the binding constraint for local inference. CPU picked by highest core count in budget, mainly to keep the rest of the system responsive while a model is loaded.',
    tiers: [
      { label: 'Getting Started', maxGpuPrice: 400, maxCpuPrice: 250 },
      { label: 'Serious Local Inference', maxGpuPrice: 900, maxCpuPrice: 500 },
      { label: 'Maximum VRAM', maxGpuPrice: 2000, maxCpuPrice: 800 },
    ],
    gpuStrategy: 'vram',
    faqs: [
      {
        title: 'Why does VRAM matter more than GPU brand or benchmark score for local AI?',
        content: 'A model has to fit entirely (or almost entirely) in video memory to run at usable speed — if it doesn\'t fit, it either won\'t load or falls back to slow CPU/system-RAM offloading. More VRAM directly raises the size of model you can run, ahead of how that GPU scores in gaming benchmarks.',
      },
      {
        title: 'Do AMD or Intel GPUs work for local AI, or is it NVIDIA-only?',
        content: 'NVIDIA (via CUDA) has the most mature software support across tools like Ollama and LM Studio, but AMD and Intel cards can run inference too through ROCm or Vulkan backends depending on the tool — support varies more than with NVIDIA, so check your specific tool\'s compatibility list before buying.',
      },
      {
        title: 'Does the CPU matter for running local models?',
        content: 'Far less than for gaming — inference runs on the GPU, so the CPU\'s main job is keeping the rest of the system responsive while a model is loaded. These picks still favor higher core counts where the budget allows, but it\'s a secondary factor here.',
      },
      {
        title: 'What does quantization mean for how much VRAM I need?',
        content: 'Quantization shrinks a model\'s memory footprint by storing its weights at lower precision, trading a small amount of output quality for a much smaller VRAM requirement — it\'s how larger models get squeezed onto consumer GPUs, and most local tools let you pick a quantization level per model.',
      },
    ],
  },
  {
    slug: 'home-office',
    title: 'Best PC Build for Home Office / Productivity',
    shortTitle: 'Home Office',
    intro: 'Spreadsheets, video calls, browser tabs, and document editing barely touch the GPU. The graphics built into many modern CPUs handle this work, including more than one monitor, without a separate graphics card. So the two everyday tiers here skip the graphics card and pick a CPU with built-in graphics, putting the budget into CPU cores instead, since core count decides how many apps run smoothly at once. The top tier adds an entry-level graphics card for light creative work.',
    criteria: 'Everyday tiers: no graphics card. The CPU is the one with the most cores in budget that has integrated graphics (ties broken by benchmark score). Top tier: the cheapest eligible graphics card in budget, plus the CPU with the most cores in budget.',
    tiers: [
      // Ordinary office work runs on the CPU's integrated graphics, so these
      // tiers have no discrete GPU (maxGpuPrice: null).
      { label: 'Everyday Office', maxGpuPrice: null, maxCpuPrice: 200 },
      { label: 'Power Multitasker', maxGpuPrice: null, maxCpuPrice: 400 },
      { label: 'Hybrid Work + Light Creative', maxGpuPrice: 350, maxCpuPrice: 600 },
    ],
    gpuStrategy: 'budget',
    faqs: [
      {
        title: 'Why do the everyday tiers have no graphics card?',
        content: 'Office work (browsers, spreadsheets, video calls, documents) asks almost nothing of the GPU. The integrated graphics built into these CPUs handle it, so a separate card would add cost without making the PC feel faster. That money goes to the CPU, RAM and storage instead. Two things to check: the CPU must have integrated graphics (Intel models ending in F and Ryzen 5000/3000 desktop chips do not), and your monitors connect to the motherboard\'s HDMI or DisplayPort outputs, so make sure it has the ports you need.',
      },
      {
        title: 'When should an office PC get a graphics card?',
        content: 'When the work goes beyond office tasks: photo or video editing, GPU-accelerated apps, more monitors than the motherboard has outputs for, or occasional gaming. That is what the top tier is for. It adds the cheapest eligible graphics card in its budget, because raw gaming speed still is not the goal.',
      },
      {
        title: 'Why does CPU core count matter so much for office multitasking?',
        content: 'Every open browser tab, video call, and background app claims its own share of CPU time — more cores means more of them can run smoothly at once without the system bogging down, which is why these picks weight core count heavily even though clock speed and gaming benchmarks matter less here than for a gaming build.',
      },
    ],
  },
];

export function getUseCase(slug: string): UseCase | undefined {
  return USE_CASES.find(u => u.slug === slug);
}

function pickGpu(strategy: UseCase['gpuStrategy'], maxPrice: number | null): Gpu | null {
  if (maxPrice === null) return null;
  const pool = gpus.filter(g => g.price_usd <= maxPrice);
  if (strategy === 'encode') {
    const nvidia = pool.filter(g => g.brand === 'NVIDIA').sort((a, b) => b.benchmark_score - a.benchmark_score);
    if (nvidia.length > 0) return nvidia[0];
    return [...pool].sort((a, b) => b.benchmark_score - a.benchmark_score)[0];
  }
  if (strategy === 'budget') {
    return [...pool].sort((a, b) => a.price_usd - b.price_usd)[0];
  }
  return [...pool].sort((a, b) => (b.vram_gb - a.vram_gb) || (b.benchmark_score - a.benchmark_score))[0];
}

function pickCpu(maxPrice: number, needsIntegratedGraphics: boolean): Cpu {
  const pool = cpus.filter(c => c.price_usd <= maxPrice && (!needsIntegratedGraphics || c.integrated_graphics !== null));
  return [...pool].sort((a, b) => (b.cores - a.cores) || (b.benchmark_score - a.benchmark_score))[0];
}

export interface TierPick {
  tier: UseCaseTier;
  /** null when the tier uses the CPU's integrated graphics. */
  gpu: Gpu | null;
  cpu: Cpu;
}

export function getTierPicks(useCase: UseCase): TierPick[] {
  return useCase.tiers.map(tier => ({
    tier,
    gpu: pickGpu(useCase.gpuStrategy, tier.maxGpuPrice),
    cpu: pickCpu(tier.maxCpuPrice, tier.maxGpuPrice === null),
  }));
}

export interface TierStepUp {
  /** How much more this tier's total costs versus the previous tier. */
  costDelta: number;
  /** Plain-language description of what that extra money actually buys — real deltas, not a sales pitch. */
  gpuClause: string;
  cpuClause: string;
}

export interface TierComparison extends TierPick {
  /** GPU + CPU price for this tier — shown as two separate numbers today, never summed. */
  totalCost: number;
  /** Undefined for the first (cheapest) tier, which has nothing to step up from. */
  stepUp?: TierStepUp;
}

function formatGpuStepUp(prevGpu: Gpu | null, gpu: Gpu | null): string {
  if (!prevGpu && !gpu) return 'the same integrated graphics';
  if (!prevGpu && gpu) return `a dedicated ${gpu.name} graphics card`;
  if (prevGpu && !gpu) return 'integrated graphics instead of a graphics card';
  if (!prevGpu || !gpu) return 'a different GPU';
  if (gpu.id === prevGpu.id) return 'the same GPU';
  const vramDelta = gpu.vram_gb - prevGpu.vram_gb;
  if (vramDelta > 0) return `+${vramDelta}GB more VRAM`;
  if (vramDelta < 0) return `${Math.abs(vramDelta)}GB less VRAM`;
  return 'a different GPU with the same VRAM';
}

function formatCpuStepUp(prevCpu: Cpu, cpu: Cpu): string {
  const coreDelta = cpu.cores - prevCpu.cores;
  if (coreDelta > 0) return `+${coreDelta} more CPU cores`;
  if (coreDelta < 0) return `${Math.abs(coreDelta)} fewer CPU cores`;
  return 'the same CPU core count';
}

/**
 * Total cost per tier (a sum the page never currently shows — GPU and CPU
 * price are displayed as two separate numbers) plus what the price jump to
 * each tier actually buys versus the one before it, in real spec terms
 * (VRAM, cores) — not just "more expensive." Answers the real question a
 * three-tier page raises but never answers: is the next tier up worth it?
 * Sometimes the honest answer computed here is "barely" (e.g. the top
 * video-editing tier gains 0GB VRAM and 0 cores over the middle one for a
 * real card) — this reports whatever the real numbers say either way.
 */
export function getTierComparisons(picks: TierPick[]): TierComparison[] {
  return picks.map((p, i) => {
    const totalCost = (p.gpu?.price_usd ?? 0) + p.cpu.price_usd;
    if (i === 0) return { ...p, totalCost };
    const prev = picks[i - 1];
    const prevTotal = (prev.gpu?.price_usd ?? 0) + prev.cpu.price_usd;
    return {
      ...p,
      totalCost,
      stepUp: {
        costDelta: totalCost - prevTotal,
        gpuClause: formatGpuStepUp(prev.gpu, p.gpu),
        cpuClause: formatCpuStepUp(prev.cpu, p.cpu),
      },
    };
  });
}

const GPU_STRATEGY_LABEL: Record<UseCase['gpuStrategy'], string> = {
  encode: 'NVENC encoding support',
  vram: 'VRAM headroom',
  budget: 'lowest cost',
};

export function getUseCasePageMeta(useCase: UseCase): RouteMeta {
  return {
    path: `/best-pc-for/${useCase.slug}`,
    title: `${useCase.title} (2026) | SpecSmith`,
    description: `${useCase.shortTitle}-focused GPU and CPU picks across three budgets, chosen by ${GPU_STRATEGY_LABEL[useCase.gpuStrategy]} and core count — with real prices and buy links.`,
  };
}

export function useCaseItemListJsonLd(useCase: UseCase, picks: TierPick[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: useCase.title,
    itemListElement: picks
      .flatMap((p) => [
        ...(p.gpu ? [{ name: p.gpu.name, url: `${SITE_URL}/builder?gpu=${p.gpu.id}` }] : []),
        { name: p.cpu.name, url: `${SITE_URL}/builder?cpu=${p.cpu.id}` },
      ])
      .map((item, i) => ({ '@type': 'ListItem', position: i + 1, ...item })),
  };
}

export function useCaseFaqJsonLd(useCase: UseCase) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: useCase.faqs.map((f) => ({
      '@type': 'Question',
      name: f.title,
      acceptedAnswer: { '@type': 'Answer', text: f.content },
    })),
  };
}
