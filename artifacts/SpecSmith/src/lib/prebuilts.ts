import prebuiltsData from '../data/prebuilts.json';
import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import componentData from '../data/components.json';
import peripheralData from '../data/peripherals.json';

export interface Prebuilt {
  id: string;
  name: string;
  tagline: string;
  description: string;
  target_resolution: string;
  badge_color: string;
  fps_resolution: string;
  fps_preset: string;
  fps_preview_games: string[];
  parts: Record<string, string>;
}

export const prebuilts = prebuiltsData as Prebuilt[];

interface PartRecord {
  id: string;
  name: string;
  price_usd: number;
}

const CATEGORY_LISTS: Record<string, PartRecord[]> = {
  gpu: gpuData as PartRecord[],
  cpu: cpuData as PartRecord[],
  motherboard: componentData.motherboards as PartRecord[],
  ram: componentData.ram as PartRecord[],
  storage: componentData.storage as PartRecord[],
  psu: componentData.psus as PartRecord[],
  case: componentData.cases as PartRecord[],
  cooler: componentData.coolers as PartRecord[],
  monitor: peripheralData.monitors as PartRecord[],
  keyboard: peripheralData.keyboards as PartRecord[],
  mouse: peripheralData.mice as PartRecord[],
  headset: peripheralData.headsets as PartRecord[],
};

export const categoryLabels: Record<string, string> = {
  gpu: 'GPU', cpu: 'CPU', motherboard: 'Motherboard', ram: 'RAM',
  storage: 'Storage', psu: 'PSU', case: 'Case', cooler: 'CPU Cooler',
  monitor: 'Monitor', keyboard: 'Keyboard', mouse: 'Mouse', headset: 'Headset',
};

export function getPartPrice(category: string, id: string): number {
  return CATEGORY_LISTS[category]?.find(p => p.id === id)?.price_usd ?? 0;
}

export function getPartName(category: string, id: string): string {
  return CATEGORY_LISTS[category]?.find(p => p.id === id)?.name ?? id;
}

export function getPrebuiltTotal(prebuilt: Prebuilt): number {
  return Object.entries(prebuilt.parts).reduce((sum, [cat, id]) => sum + getPartPrice(cat, id), 0);
}
