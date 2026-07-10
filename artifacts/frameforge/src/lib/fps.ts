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
 * raw = baseFps × gpuMultiplier × cpuMultiplier
 * Capped [1, 999]. ±8% variance range.
 */
export function estimateFps(
  gpuMultiplier: number,
  cpuMultiplier: number,
  baseFps: number
): FpsResult {
  const estimated = Math.min(999, Math.max(1, Math.round(baseFps * gpuMultiplier * cpuMultiplier)));
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
  base_fps: Record<string, Record<string, number>>;
  [key: string]: unknown;
}

/**
 * Higher-level wrapper — pass full GPU, CPU, and Game objects.
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
  return estimateFps(gpu.gpu_multiplier, cpu.cpu_multiplier, baseFps);
}

export function getFpsColorClass(fps: number): string {
  if (fps >= 144) return 'fps-elite';
  if (fps >= 90)  return 'fps-excellent';
  if (fps < 30)   return 'fps-low';
  if (fps < 60)   return 'fps-medium';
  return 'fps-good';
}

export function getAffiliateUrl(partName: string): string {
  return `https://www.amazon.com/s?k=${encodeURIComponent(partName)}&tag=frameforge-20`;
}

export function getNeweggUrl(partName: string): string {
  return `https://www.newegg.com/p/pl?d=${encodeURIComponent(partName)}`;
}
