export type Resolution = '1080p' | '1440p' | '4k';
export type Preset = 'low' | 'medium' | 'high' | 'ultra';

export interface FpsResult {
  estimated: number;
  min: number;
  max: number;
  color: string;
  label: string;
}

/**
 * Core FPS formula.
 *
 * Uses a weighted interpolation between CPU and GPU multipliers based on
 * how GPU-bound the game is (gpuBound 0→1).
 *
 *   gpuBound = 1.0 → result purely driven by gpuMultiplier
 *   gpuBound = 0.0 → result purely driven by cpuMultiplier
 *   gpuBound = 0.7 → 70% GPU, 30% CPU influence
 *
 * This produces realistic per-game variance: a stronger GPU wins in
 * GPU-heavy titles (Cyberpunk, Alan Wake 2) while a stronger CPU wins
 * in CPU-heavy titles (Valorant, CS2, Minecraft).
 *
 * Capped [1, 999]. ±8% variance range.
 */
export function estimateFps(
  gpuMultiplier: number,
  cpuMultiplier: number,
  baseFps: number,
  gpuBound = 0.75
): FpsResult {
  const weighted = cpuMultiplier + gpuBound * (gpuMultiplier - cpuMultiplier);
  const estimated = Math.min(999, Math.max(1, Math.round(baseFps * weighted)));
  const min = Math.round(estimated * 0.92);
  const max = Math.round(estimated * 1.08);

  let color: string;
  let label: string;
  if (estimated >= 144)      { color = '#6C63FF'; label = 'Elite'; }
  else if (estimated >= 90)  { color = '#00D4FF'; label = 'Excellent'; }
  else if (estimated >= 60)  { color = '#00E676'; label = 'Smooth'; }
  else if (estimated >= 30)  { color = '#FFB300'; label = 'Playable'; }
  else                       { color = '#FF1744'; label = 'Unplayable'; }

  return { estimated, min, max, color, label };
}

export interface BuildFpsGpu { gpu_multiplier: number; name: string; [key: string]: unknown; }
export interface BuildFpsCpu { cpu_multiplier: number; name: string; [key: string]: unknown; }
export interface BuildFpsGame {
  id: string;
  name: string;
  gpu_bound?: number;
  base_fps: Record<string, Record<string, number>>;
  [key: string]: unknown;
}

/**
 * Higher-level wrapper — pass full GPU, CPU, and Game objects.
 * Automatically reads gpu_bound from the game for per-game variance.
 * Resolution key is normalised to lowercase before lookup.
 */
export function estimateFpsForBuild(
  gpu: BuildFpsGpu,
  cpu: BuildFpsCpu,
  game: BuildFpsGame,
  resolution: string,
  preset: string
): FpsResult {
  const resKey = resolution.toLowerCase() as Resolution;
  const presetKey = preset.toLowerCase() as Preset;
  const baseFps = game.base_fps[resKey]?.[presetKey] ?? 0;
  const gpuBound = game.gpu_bound ?? 0.75;
  return estimateFps(gpu.gpu_multiplier, cpu.cpu_multiplier, baseFps, gpuBound);
}

export function getFpsColorClass(fps: number): string {
  if (fps >= 144) return 'fps-elite';
  if (fps >= 90)  return 'fps-excellent';
  if (fps < 30)   return 'fps-low';
  if (fps < 60)   return 'fps-medium';
  return 'fps-good';
}

const CATEGORY_SEARCH_TERMS: Record<string, string> = {
  gpu: 'graphics card', cpu: 'processor', motherboard: 'motherboard',
  ram: 'desktop memory', storage: '', psu: 'power supply',
  case: 'PC case', cooler: 'CPU cooler', monitor: 'gaming monitor',
  keyboard: '', mouse: '', headset: '',
};

/**
 * Builds a retailer search query precise enough that the exact product is
 * the top result — full brand/product-line prefix plus a category term
 * (e.g. "RTX 4090" → "NVIDIA GeForce RTX 4090 graphics card").
 */
export function buildPartQuery(name: string, brand?: string, category?: string): string {
  let full = name;
  if (brand && !name.toLowerCase().includes(brand.toLowerCase())) {
    if (category === 'gpu') {
      const line = brand === 'NVIDIA' ? 'GeForce' : brand === 'AMD' ? 'Radeon' : '';
      full = [brand, line, name].filter(Boolean).join(' ');
    } else if (category === 'cpu') {
      full = brand === 'Intel' ? `Intel Core ${name}` : `${brand} ${name}`;
    } else {
      full = `${brand} ${name}`;
    }
  }
  const term = category ? CATEGORY_SEARCH_TERMS[category] ?? '' : '';
  return term ? `${full} ${term}` : full;
}

// Placeholder tag until the SpecSmith Amazon Associates account is
// approved — Amazon ignores unrecognized tags, so links keep working.
// Replace with the real tag before monetization goes live.
export const AMAZON_AFFILIATE_TAG = 'specsmithpc-20';

export function getAffiliateUrl(partName: string): string {
  return `https://www.amazon.com/s?k=${encodeURIComponent(partName)}&tag=${AMAZON_AFFILIATE_TAG}`;
}

export function getNeweggUrl(partName: string): string {
  return `https://www.newegg.com/p/pl?d=${encodeURIComponent(partName)}`;
}
