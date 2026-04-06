export type Resolution = '1080p' | '1440p' | '4k';
export type Preset = 'low' | 'medium' | 'high' | 'ultra';

export interface FpsResult {
  estimated: number;
  min: number;
  max: number;
  color: string;
  label: string;
}

export function estimateFps(
  gpuTier: number,
  cpuTier: number,
  baseFps: number
): FpsResult {
  const gpuModifier = gpuTier / 10;
  const cpuModifier = 0.85 + (cpuTier / 10) * 0.30;
  const estimated = Math.min(999, Math.max(1, Math.round(baseFps * gpuModifier * cpuModifier)));
  const min = Math.round(estimated * 0.88);
  const max = Math.round(estimated * 1.12);

  let color: string;
  let label: string;
  if (estimated < 30) { color = '#FF1744'; label = 'Unplayable'; }
  else if (estimated < 60) { color = '#FFB300'; label = 'Playable'; }
  else if (estimated < 90) { color = '#00E676'; label = 'Smooth'; }
  else { color = '#00D4FF'; label = 'Excellent'; }

  return { estimated, min, max, color, label };
}

export function getFpsColorClass(fps: number): string {
  if (fps < 30) return 'fps-low';
  if (fps < 60) return 'fps-medium';
  if (fps < 90) return 'fps-good';
  return 'fps-excellent';
}

export function getAffiliateUrl(partName: string): string {
  return `https://www.amazon.com/s?k=${encodeURIComponent(partName)}&tag=frameforge-20`;
}
