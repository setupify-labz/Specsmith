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
export interface CrateCooler extends Part { type: string; height_mm?: number; max_tdp_watts?: number; socket_support?: string[]; }
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

// Colors are theme-aware tokens, not raw hex — these render as text (crate
// reveal labels, "best pull" summary) and the dark-mode hex values ranged
// from ~1.4:1 to ~3.5:1 in light mode, under WCAG AA's 4.5:1 floor (found
// via an axe-core light-theme sweep).
export const RARITY_STYLE: Record<CrateRarity, { label: string; color: string; glow: string }> = {
  common:    { label: 'Common',    color: 'var(--ff-text-2)', glow: 'rgba(156,163,175,0.35)' },
  uncommon:  { label: 'Uncommon',  color: 'var(--ff-green)', glow: 'rgba(0,230,118,0.4)' },
  rare:      { label: 'Rare',      color: 'var(--ff-cyan)', glow: 'rgba(0,212,255,0.4)' },
  epic:      { label: 'Epic',      color: 'var(--ff-epic)', glow: 'rgba(155,107,255,0.45)' },
  legendary: { label: 'Legendary', color: 'var(--ff-gold)', glow: 'rgba(255,215,0,0.5)' },
};

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

// Overall build rarity (see getOverallRarity below) is just the average of
// the GPU and CPU tiers, so pity only needs to touch these two rolls:
// restricting both pools to tier >= PITY_MIN_TIER guarantees an average of
// at least 5 — the "rare" floor — no matter what lands within that range.
const PITY_MIN_TIER = 5;

export function rollCpu(socket: string, pity = false): RolledPart<CrateCpu> {
  let pool = cpus.filter(c => c.socket === socket);
  if (pity) pool = pool.filter(c => c.tier >= PITY_MIN_TIER);
  const { item, percentile } = pickWeighted(pool, c => c.tier);
  return { part: item, rarity: rarityFromPercentile(percentile) };
}

export function rollRam(ramType: string): RolledPart<CrateRam> {
  const pool = rams.filter(r => r.type === ramType);
  const { item, percentile } = pickWeighted(pool, r => r.price_usd);
  return { part: item, rarity: rarityFromPercentile(percentile) };
}

export function rollGpu(pity = false): RolledPart<CrateGpu> {
  const pool = pity ? gpus.filter(g => g.tier >= PITY_MIN_TIER) : gpus;
  const { item, percentile } = pickWeighted(pool, g => g.tier);
  return { part: item, rarity: rarityFromPercentile(percentile) };
}

export function rollStorage(): RolledPart<CrateStorage> {
  const { item, percentile } = pickWeighted(storages, s => s.price_usd);
  return { part: item, rarity: rarityFromPercentile(percentile) };
}

// Case, cooler, and PSU are rolled last precisely so each one can be
// constrained by whatever was already rolled before it — motherboard form
// factor and GPU length are known by the time the case is picked, the
// case's clearance and the CPU's heat are known by the time the cooler is
// picked, and both TDPs are known by the time the PSU is picked. The
// margins mirror checkCompatibility()'s own "tight fit" thresholds, so a
// crate pull can never land on so much as a warning, only a real range of
// how good the parts inside are.
export function rollCase(motherboardFormFactor?: string, gpuLengthMm?: number): RolledPart<CrateCase> {
  let pool = cases;
  if (motherboardFormFactor) {
    pool = pool.filter(c => !c.motherboard_support || c.motherboard_support.includes(motherboardFormFactor));
  }
  if (gpuLengthMm) {
    pool = pool.filter(c => !c.gpu_clearance_mm || c.gpu_clearance_mm >= gpuLengthMm + 15);
  }
  const { item, percentile } = pickWeighted(pool, c => c.price_usd);
  return { part: item, rarity: rarityFromPercentile(percentile) };
}

export function rollCooler(caseClearanceMm?: number, cpuTdpWatts?: number, cpuSocket?: string): RolledPart<CrateCooler> {
  let pool = coolers;
  if (caseClearanceMm) {
    // AIOs have no height_mm (low-profile pump/radiator, not a tower), so
    // they always clear regardless of case clearance — only air coolers
    // are filtered here.
    pool = pool.filter(c => !c.height_mm || c.height_mm <= caseClearanceMm - 5);
  }
  if (cpuTdpWatts) {
    pool = pool.filter(c => !c.max_tdp_watts || c.max_tdp_watts >= cpuTdpWatts);
  }
  if (cpuSocket) {
    // Most coolers have no socket_support (universal mounting brackets);
    // only single-socket compact designs need filtering here.
    pool = pool.filter(c => !c.socket_support || c.socket_support.includes(cpuSocket));
  }
  const { item, percentile } = pickWeighted(pool, c => c.price_usd);
  return { part: item, rarity: rarityFromPercentile(percentile) };
}

export function rollPsu(gpuTdpWatts?: number, cpuTdpWatts?: number): RolledPart<CratePsu> {
  let pool = psus;
  if (gpuTdpWatts !== undefined && cpuTdpWatts !== undefined) {
    const required = (gpuTdpWatts + cpuTdpWatts + 100) * 1.1;
    pool = pool.filter(p => p.wattage >= required);
  }
  const { item, percentile } = pickWeighted(pool, p => p.wattage);
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
