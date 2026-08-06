import gpus from '../data/gpus.json';
import cpus from '../data/cpus.json';

export interface GuesserItem {
  id: string;
  name: string;
  category: 'GPU' | 'CPU';
  brand: string;
  price: number;
  stat: string;
}

function gpuStat(g: (typeof gpus)[number]): string {
  return `${g.vram_gb}GB VRAM · ${g.architecture}`;
}

function cpuStat(c: (typeof cpus)[number]): string {
  return `${c.cores} cores · ${c.socket}`;
}

const POOL: GuesserItem[] = [
  ...gpus.map((g) => ({ id: `gpu-${g.id}`, name: g.name, category: 'GPU' as const, brand: g.brand, price: g.price_usd, stat: gpuStat(g) })),
  ...cpus.map((c) => ({ id: `cpu-${c.id}`, name: c.name, category: 'CPU' as const, brand: c.brand, price: c.price_usd, stat: cpuStat(c) })),
];

export function getGuesserPool(): GuesserItem[] {
  return POOL;
}

// Picks a random item whose price differs from every price already in the
// round — a same-price pair would make "higher or lower" unanswerable.
export function pickNextItem(excludePrices: number[], excludeIds: string[]): GuesserItem {
  const candidates = POOL.filter((item) => !excludeIds.includes(item.id) && !excludePrices.includes(item.price));
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function pickStartingPair(): [GuesserItem, GuesserItem] {
  const first = POOL[Math.floor(Math.random() * POOL.length)];
  const second = pickNextItem([first.price], [first.id]);
  return [first, second];
}
