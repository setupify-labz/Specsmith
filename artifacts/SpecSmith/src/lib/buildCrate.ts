import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import componentData from '../data/components.json';
import gamesData from '../data/games.json';
import { estimateFpsForBuild, type BuildFpsGpu, type BuildFpsCpu } from './fps';
import { checkCompatibility, type CompatibilityResult } from './compatibility';

interface Part { id: string; name: string; price_usd: number; brand?: string; [key: string]: unknown; }
interface CrateGpu extends Part, BuildFpsGpu { tier: number; tdp_watts: number; length_mm?: number; }
interface CrateCpu extends Part, BuildFpsCpu { tier: number; tdp_watts: number; socket: string; supported_ram: string[]; }
interface CrateMotherboard extends Part { socket: string; supported_ram: string[]; form_factor?: string; }
interface CrateRam extends Part { type: string; }
interface CrateStorage extends Part { }
interface CratePsu extends Part { wattage: number; }
interface CrateCase extends Part { motherboard_support?: string[]; gpu_clearance_mm?: number; cooler_clearance_mm?: number; }
interface CrateCooler extends Part { type: string; height_mm?: number; max_tdp_watts?: number; }
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

const SOCKETS = [...new Set(cpus.map(c => c.socket))];

/** Picks from a list with lower-ranked (cheaper/lower-tier) items weighted
 * more likely — same rarity feel as a loot crate, without hand-tuning odds
 * per category. Rank n-i means the cheapest item is roughly n times more
 * likely to be pulled than the most expensive. */
function weightedPickByRank<T>(items: T[], rankKey: (t: T) => number): T {
  const sorted = [...items].sort((a, b) => rankKey(a) - rankKey(b));
  const n = sorted.length;
  const weights = sorted.map((_, i) => n - i);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < sorted.length; i++) {
    r -= weights[i];
    if (r <= 0) return sorted[i];
  }
  return sorted[sorted.length - 1];
}

function averageFpsForBuild(gpu: CrateGpu, cpu: CrateCpu): number {
  const total = games.reduce((sum, g) => sum + estimateFpsForBuild(gpu, cpu, g, '1440p', 'high').estimated, 0);
  return Math.round(total / games.length);
}

export type CrateRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export function getRarity(gpuTier: number, cpuTier: number): CrateRarity {
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

/** Rolls a random build. The socket is picked first and every socket-bound
 * part (CPU, motherboard, RAM) is drawn from just that socket's compatible
 * pool, so a roll never produces something that physically can't go
 * together — same logic a person would use building by hand, just
 * randomized. GPU, storage, case, cooler, and PSU roll independently, so
 * fit/wattage warnings can still show up — that's part of the fun, not a bug. */
export function rollBuildCrate(): CrateBuild {
  const socket = SOCKETS[Math.floor(Math.random() * SOCKETS.length)];

  const motherboard = weightedPickByRank(motherboards.filter(m => m.socket === socket), m => m.price_usd);
  const cpu = weightedPickByRank(cpus.filter(c => c.socket === socket), c => c.tier);
  const ramType = motherboard.supported_ram[0];
  const ram = weightedPickByRank(rams.filter(r => r.type === ramType), r => r.price_usd);
  const gpu = weightedPickByRank(gpus, g => g.tier);
  const storage = weightedPickByRank(storages, s => s.price_usd);
  const gpuCase = weightedPickByRank(cases, c => c.price_usd);
  const cooler = weightedPickByRank(coolers, c => c.price_usd);
  const psu = weightedPickByRank(psus, p => p.wattage);

  const totalCost = gpu.price_usd + cpu.price_usd + motherboard.price_usd + ram.price_usd
    + storage.price_usd + psu.price_usd + gpuCase.price_usd + cooler.price_usd;
  const avgFps = averageFpsForBuild(gpu, cpu);
  const rarity = getRarity(gpu.tier, cpu.tier);
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
