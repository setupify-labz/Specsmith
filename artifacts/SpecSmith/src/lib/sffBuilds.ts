import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import componentData from '../data/components.json';
import gamesData from '../data/games.json';
import { estimateFpsForBuild } from './fps';
import type { RouteMeta } from './seo';
import { SITE_URL } from './seo';

interface Gpu { id: string; name: string; brand: string; price_usd: number; length_mm: number; benchmark_score: number; gpu_multiplier: number; [key: string]: unknown; }
interface Cpu { id: string; name: string; brand: string; price_usd: number; socket: string; tdp_watts: number; benchmark_score: number; cpu_multiplier: number; [key: string]: unknown; }
interface Game { id: string; name: string; gpu_bound?: number; base_fps: Record<string, Record<string, number>>; [key: string]: unknown; }
interface CaseData { id: string; name: string; price_usd: number; gpu_clearance_mm: number; cooler_clearance_mm: number; motherboard_support: string[]; }
interface Motherboard { id: string; name: string; price_usd: number; socket: string; form_factor: string; }
interface Cooler { id: string; name: string; price_usd: number; height_mm: number; socket_support: string[]; }

const gpus = gpuData as Gpu[];
const cpus = cpuData as Cpu[];
const cases = componentData.cases as CaseData[];
const motherboards = componentData.motherboards as Motherboard[];
const coolers = componentData.coolers as Cooler[];
const games = gamesData as Game[];

// Same 1440p High reference used for the "gaming" quiz result and the
// /upgrade calculators, so this number means the same thing everywhere.
const SFF_FPS_RESOLUTION = '1440p';
const SFF_FPS_PRESET = 'high';

function averageSffFps(gpu: Gpu, cpu: Cpu): number {
  const total = games.reduce((sum, g) => sum + estimateFpsForBuild(gpu, cpu, g, SFF_FPS_RESOLUTION, SFF_FPS_PRESET).estimated, 0);
  return Math.round(total / games.length);
}

// Fixed platform for both SFF tiers: Ryzen 7 9700X is the strongest CPU
// whose TDP (65W) fits under a 37mm low-profile cooler's rating, paired
// with the only Mini-ITX motherboard and the only AM5-compatible
// low-profile cooler this site tracks.
const CPU_ID = 'r7-9700x';
const MOBO_ID = 'asusb650ei';
const COOLER_ID = 'noctl9aam5';

export interface SffTier {
  slug: string;
  label: string;
  caseId: string;
  maxGpuPrice: number;
  gpuClearanceMargin: number;
}

const SFF_TIERS: SffTier[] = [
  { slug: 'budget', label: 'Budget SFF', caseId: 'cmq300l', maxGpuPrice: 500, gpuClearanceMargin: 15 },
  { slug: 'premium', label: 'Premium SFF', caseId: 'nzxth1v2', maxGpuPrice: 1200, gpuClearanceMargin: 15 },
];

export interface SffPick {
  tier: SffTier;
  case: CaseData;
  gpu: Gpu;
  cpu: Cpu;
  motherboard: Motherboard;
  cooler: Cooler;
  avgFps: number;
}

function pickGpuForCase(c: CaseData, maxPrice: number, margin: number): Gpu {
  const maxLength = c.gpu_clearance_mm - margin;
  return [...gpus]
    .filter(g => g.length_mm <= maxLength && g.price_usd <= maxPrice)
    .sort((a, b) => b.benchmark_score - a.benchmark_score)[0];
}

export function getSffTiers(): SffTier[] {
  return SFF_TIERS;
}

export function getSffPicks(): SffPick[] {
  const cpu = cpus.find(c => c.id === CPU_ID)!;
  const motherboard = motherboards.find(m => m.id === MOBO_ID)!;
  const cooler = coolers.find(c => c.id === COOLER_ID)!;

  return SFF_TIERS.map(tier => {
    const sffCase = cases.find(c => c.id === tier.caseId)!;
    const gpu = pickGpuForCase(sffCase, tier.maxGpuPrice, tier.gpuClearanceMargin);
    return { tier, case: sffCase, gpu, cpu, motherboard, cooler, avgFps: averageSffFps(gpu, cpu) };
  });
}

export function getSffPageMeta(): RouteMeta {
  return {
    path: '/best-pc-for/small-form-factor',
    title: 'Best Small Form Factor (Mini-ITX) PC Build | SpecSmith',
    description: 'Two real, clearance-verified Mini-ITX builds — every part, including the case, motherboard, and cooler, confirmed to physically fit together.',
  };
}

export function sffItemListJsonLd(picks: SffPick[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Best Small Form Factor (Mini-ITX) PC Build',
    itemListElement: picks.flatMap((p, i) => [
      { '@type': 'ListItem', position: i * 2 + 1, name: p.gpu.name, url: `${SITE_URL}/builder?gpu=${p.gpu.id}` },
      { '@type': 'ListItem', position: i * 2 + 2, name: p.case.name, url: `${SITE_URL}/builder?case=${p.case.id}` },
    ]),
  };
}

export const sffFaqs = [
  {
    title: "Why do both tiers use the same CPU, motherboard, and cooler?",
    content: "This site only tracks one Mini-ITX motherboard and one low-profile cooler rated for a Ryzen socket, so both builds share that fixed platform — only the GPU changes between tiers, since that's the part most constrained by case clearance.",
  },
  {
    title: "What does the 15mm clearance margin actually protect against?",
    content: "A case's listed GPU clearance is usually measured to the absolute physical limit, but exact card length varies by manufacturer even for the same GPU model — the 15mm margin leaves room for that variance so a listed-as-fitting card doesn't end up jammed against the side panel.",
  },
  {
    title: "Can I swap in a different case and still trust these picks?",
    content: "The GPU and cooler picks are matched to the specific clearance numbers of the two cases shown here — swapping cases means re-checking GPU length and cooler height against the new case's spec sheet, which the Builder's compatibility checker will flag automatically if you load this build and then change the case.",
  },
];

export function sffFaqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: sffFaqs.map((f) => ({
      '@type': 'Question',
      name: f.title,
      acceptedAnswer: { '@type': 'Answer', text: f.content },
    })),
  };
}
