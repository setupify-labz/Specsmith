import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import componentData from '../data/components.json';
import gamesData from '../data/games.json';
import { estimateFpsForBuild, type BuildFpsGpu, type BuildFpsCpu } from './fps';
import { checkCompatibility, type CompatibilityResult } from './compatibility';

interface Part { id: string; name: string; price_usd: number; brand?: string; [key: string]: unknown; }
export interface CrateGpu extends Part, BuildFpsGpu { tier: number; tdp_watts: number; length_mm?: number; }
export interface CrateCpu extends Part, BuildFpsCpu { tier: number; tdp_watts: number; socket: string; supported_ram: string[]; }
export interface CrateMotherboard extends Part { socket: string; supported_ram: string[]; form_factor?: string; }
export interface CrateRam extends Part { type: string; }
export interface CrateStorage extends Part { }
export interface CratePsu extends Part { wattage: number; }
export interface CrateCase extends Part { motherboard_support?: string[]; gpu_clearance_mm?: number; cooler_clearance_mm?: number; }
export interface CrateCooler extends Part { type: string; height_mm?: number; max_tdp_watts?: number; }
interface Game { id: string; name: string; gpu_bound?: number; base_fps: Record<string, Record<string, number>>; [key: string]: unknown; }

const gpus = gpuData as CrateGpu[];
const cpus = cpuData as CrateCpu[];
const motherboards = componentData.motherboards as CrateMotherboard[];
const rams = componentData.ram as CrateRam[];
const storages = componentData.storage as CrateStorage[];
const psus = componentData.psus as CratePsu[];
const cases = componentData.cases as CrateCase[];
const coolers = componentData.coolers as CrateCooler[];
const games = gamesData as Game[];

export const SOCKETS = [...new Set(cpus.map(c => c.socket))];

export type CrateRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

function rarityFromPercentile(p: number): CrateRarity {
  if (p >= 0.9) return 'legendary';
  if (p >= 0.7) return 'epic';
  if (p >= 0.5) return 'rare';
  if (p >= 0.25) return 'uncommon';
  return 'common';
}

/** Weighted pick favoring the cheap/low-tier end of the list, same rarity
 * feel as a loot crate. Also reports where in the pack (by rank percentile)
 * the pulled item landed, so each individual part can carry its own rarity
 * badge — not just the finished build. */
function pickWeighted<T>(items: T[], rankKey: (t: T) => number): { item: T; percentile: number } {
  const sorted = [...items].sort((a, b) => rankKey(a) - rankKey(b));
  const n = sorted.length;
  const weights = sorted.map((_, i) => n - i);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < n; i++) {
    r -= weights[i];
    if (r <= 0) return { item: sorted[i], percentile: n > 1 ? i / (n - 1) : 0 };
  }
  return { item: sorted[n - 1], percentile: 1 };
}

export interface RolledPart<T> {
  part: T;
  rarity: CrateRarity;
}

export const CRATE_CATEGORY_ORDER: { key: 'motherboard' | 'cpu' | 'ram' | 'gpu' | 'storage' | 'case' | 'cooler' | 'psu'; label: string }[] = [
  { key: 'motherboard', label: 'Motherboard' },
  { key: 'cpu', label: 'CPU' },
  { key: 'ram', label: 'RAM' },
  { key: 'gpu', label: 'GPU' },
  { key: 'storage', label: 'Storage' },
  { key: 'case', label: 'Case' },
  { key: 'cooler', label: 'CPU Cooler' },
  { key: 'psu', label: 'PSU' },
];

/** First crate of the run — picks the platform (AM4/AM5/LGA1700/LGA1851)
 * and a motherboard on that socket in one pull, since the motherboard is
 * what tells you which platform you landed on. */
export function rollMotherboard(): RolledPart<CrateMotherboard> & { socket: string } {
  const socket = SOCKETS[Math.floor(Math.random() * SOCKETS.length)];
  const pool = motherboards.filter(m => m.socket === socket);
  const { item, percentile } = pickWeighted(pool, m => m.price_usd);
  return { part: item, rarity: rarityFromPercentile(percentile), socket };
}

export function rollCpu(socket: string): RolledPart<CrateCpu> {
  const pool = cpus.filter(c => c.socket === socket);
  const { item, percentile } = pickWeighted(pool, c => c.tier);
  return { part: item, rarity: rarityFromPercentile(percentile) };
}

export function rollRam(ramType: string): RolledPart<CrateRam> {
  const pool = rams.filter(r => r.type === ramType);
  const { item, percentile } = pickWeighted(pool, r => r.price_usd);
  return { part: item, rarity: rarityFromPercentile(percentile) };
}

export function rollGpu(): RolledPart<CrateGpu> {
  const { item, percentile } = pickWeighted(gpus, g => g.tier);
  return { part: item, rarity: rarityFromPercentile(percentile) };
}

export function rollStorage(): RolledPart<CrateStorage> {
  const { item, percentile } = pickWeighted(storages, s => s.price_usd);
  return { part: item, rarity: rarityFromPercentile(percentile) };
}

export function rollCase(): RolledPart<CrateCase> {
  const { item, percentile } = pickWeighted(cases, c => c.price_usd);
  return { part: item, rarity: rarityFromPercentile(percentile) };
}

export function rollCooler(): RolledPart<CrateCooler> {
  const { item, percentile } = pickWeighted(coolers, c => c.price_usd);
  return { part: item, rarity: rarityFromPercentile(percentile) };
}

export function rollPsu(): RolledPart<CratePsu> {
  const { item, percentile } = pickWeighted(psus, p => p.wattage);
  return { part: item, rarity: rarityFromPercentile(percentile) };
}

// Pools exposed so the UI can build a spinning reel of "candidates" for the
// crate currently being opened — filler flavor for the animation, not used
// for the actual roll (that already happened by the time the reel spins).
export function getMotherboardPool(): CrateMotherboard[] { return motherboards; }
export function getCpuPool(socket: string): CrateCpu[] { return cpus.filter(c => c.socket === socket); }
export function getRamPool(type: string): CrateRam[] { return rams.filter(r => r.type === type); }
export function getGpuPool(): CrateGpu[] { return gpus; }
export function getStoragePool(): CrateStorage[] { return storages; }
export function getCasePool(): CrateCase[] { return cases; }
export function getCoolerPool(): CrateCooler[] { return coolers; }
export function getPsuPool(): CratePsu[] { return psus; }

function averageFpsForBuild(gpu: CrateGpu, cpu: CrateCpu): number {
  const total = games.reduce((sum, g) => sum + estimateFpsForBuild(gpu, cpu, g, '1440p', 'high').estimated, 0);
  return Math.round(total / games.length);
}

export function getOverallRarity(gpuTier: number, cpuTier: number): CrateRarity {
  const avg = (gpuTier + cpuTier) / 2;
  if (avg >= 9) return 'legendary';
  if (avg >= 7) return 'epic';
  if (avg >= 5) return 'rare';
  if (avg >= 3) return 'uncommon';
  return 'common';
}

export interface CrateBuild {
  gpu: CrateGpu;
  cpu: CrateCpu;
  motherboard: CrateMotherboard;
  ram: CrateRam;
  storage: CrateStorage;
  psu: CratePsu;
  case: CrateCase;
  cooler: CrateCooler;
  totalCost: number;
  avgFps: number;
  rarity: CrateRarity;
  compat: CompatibilityResult;
  buildState: Record<string, string | null>;
}

/** Once every crate in the run has been opened, this rolls up the final
 * build summary — total cost, average FPS, overall rarity, and a real
 * compatibility check across everything that was pulled. */
export function finalizeCrateBuild(parts: {
  gpu: CrateGpu; cpu: CrateCpu; motherboard: CrateMotherboard; ram: CrateRam;
  storage: CrateStorage; case: CrateCase; cooler: CrateCooler; psu: CratePsu;
}): CrateBuild {
  const { gpu, cpu, motherboard, ram, storage, case: gpuCase, cooler, psu } = parts;
  const totalCost = gpu.price_usd + cpu.price_usd + motherboard.price_usd + ram.price_usd
    + storage.price_usd + psu.price_usd + gpuCase.price_usd + cooler.price_usd;
  const avgFps = averageFpsForBuild(gpu, cpu);
  const rarity = getOverallRarity(gpu.tier, cpu.tier);
  const compat = checkCompatibility({ gpu, cpu, motherboard, ram, psu, case: gpuCase, cooler });

  return {
    gpu, cpu, motherboard, ram, storage, psu, case: gpuCase, cooler,
    totalCost, avgFps, rarity, compat,
    buildState: {
      gpu: gpu.id, cpu: cpu.id, motherboard: motherboard.id, ram: ram.id,
      storage: storage.id, psu: psu.id, case: gpuCase.id, cooler: cooler.id,
    },
  };
}
