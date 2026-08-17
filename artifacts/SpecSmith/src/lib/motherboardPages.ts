import componentData from '../data/components.json';
import cpuData from '../data/cpus.json';
import type { RouteMeta } from './seo';

export interface PageMotherboard {
  id: string;
  name: string;
  brand: string;
  price_usd: number;
  socket: string;
  supported_ram: string[];
  form_factor: string;
  sponsored?: boolean;
  [key: string]: unknown;
}

interface SocketCpu {
  id: string;
  name: string;
  price_usd: number;
  socket: string;
  [key: string]: unknown;
}

const motherboards = componentData.motherboards as PageMotherboard[];
const cpus = cpuData as SocketCpu[];

export interface SocketPage {
  slug: string;
  socket: string;
  label: string;
  brand: 'AMD' | 'Intel';
  blurb: string;
}

// "Best motherboard for <platform>" pages at /best-motherboard/<slug> — one
// per socket we track. Slugs are indexed URLs, kept stable once published.
export const SOCKET_PAGES: SocketPage[] = [
  { slug: 'am5', socket: 'AM5', label: 'AMD AM5', brand: 'AMD',
    blurb: 'AMD’s current platform — every Ryzen 7000/9000 series CPU, including the 3D V-Cache chips, uses this socket.' },
  { slug: 'am4', socket: 'AM4', label: 'AMD AM4', brand: 'AMD',
    blurb: 'AMD’s previous-generation platform, still widely available and a strong budget pick for Ryzen 3000/5000 series builds.' },
  { slug: 'lga1700', socket: 'LGA1700', label: 'Intel LGA1700', brand: 'Intel',
    blurb: 'Intel’s 12th/13th/14th Gen Core platform — spans budget H610 boards up to enthusiast Z790 boards.' },
  { slug: 'lga1851', socket: 'LGA1851', label: 'Intel LGA1851', brand: 'Intel',
    blurb: 'Intel’s current Core Ultra 200 series platform, DDR5-only.' },
];

export function getSocketPage(slug: string): SocketPage | undefined {
  return SOCKET_PAGES.find(p => p.slug === slug);
}

export function getMotherboardsForSocket(socket: string): PageMotherboard[] {
  return motherboards.filter(m => m.socket === socket).sort((a, b) => a.price_usd - b.price_usd);
}

export function getCpusForSocket(socket: string): SocketCpu[] {
  return cpus.filter(c => c.socket === socket).sort((a, b) => a.price_usd - b.price_usd);
}

export interface CpuPriceBand {
  cheapest: SocketCpu;
  priciest: SocketCpu;
  count: number;
}

/** Splits an already price-sorted list into `parts` contiguous, as-equal-
 * as-possible chunks (standard index-partition: chunk i spans
 * [floor(i*n/parts), floor((i+1)*n/parts))). Exported for direct testing. */
export function chunkEvenly<T>(items: T[], parts: number): T[][] {
  if (parts <= 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < parts; i++) {
    const start = Math.floor((i * items.length) / parts);
    const end = Math.floor(((i + 1) * items.length) / parts);
    chunks.push(items.slice(start, end));
  }
  return chunks;
}

/** Splits a socket's tracked CPUs (cheapest to priciest) into `bandCount`
 * price bands — one per motherboard pick for that socket — so the cheapest
 * pick lines up with the cheapest CPU band and the priciest pick with the
 * priciest. This is a price-tier grouping only, not a compatibility check:
 * empty bands (more picks than tracked CPUs) are dropped. */
export function getCpuPriceBands(socket: string, bandCount: number): CpuPriceBand[] {
  const sockCpus = getCpusForSocket(socket);
  return chunkEvenly(sockCpus, bandCount)
    .filter(chunk => chunk.length > 0)
    .map(chunk => ({ cheapest: chunk[0], priciest: chunk[chunk.length - 1], count: chunk.length }));
}

/** One sentence describing a CPU price band, explicitly framed as a price
 * pairing, not a claim that the motherboard is technically optimal for
 * those CPUs — real compatibility still needs checking in the Builder. */
export function formatCpuPairing(socket: string, band: CpuPriceBand): string {
  const range = band.cheapest.id === band.priciest.id
    ? `around $${band.cheapest.price_usd}`
    : `from $${band.cheapest.price_usd}–$${band.priciest.price_usd}`;
  const examples = band.cheapest.id === band.priciest.id
    ? band.cheapest.name
    : `${band.cheapest.name} up to the ${band.priciest.name}`;
  return `Similarly priced to ${socket} CPUs ${range}, such as the ${examples} — a price-tier pairing, not a technical compatibility recommendation.`;
}

export interface MotherboardPick {
  emoji: string;
  label: string;
  motherboard: PageMotherboard;
  detail: string;
  cpuPairing?: string;
}

/** Picks derived purely from price position within the socket's lineup —
 * motherboards don't carry a performance/tier field like GPUs/CPUs do, so
 * "best value" here means budget / mid-range / high-end by price, same
 * honest framing as everywhere else on the site (no invented scores). */
export function getMotherboardPicks(socket: string): MotherboardPick[] {
  const boards = getMotherboardsForSocket(socket);
  if (boards.length === 0) return [];

  const picks: MotherboardPick[] = [];
  const budget = boards[0];
  picks.push({
    emoji: '💰', label: 'Budget Pick', motherboard: budget,
    detail: `The least expensive ${socket} board we track at $${budget.price_usd}, supporting ${budget.supported_ram.join('/')}.`,
  });

  if (boards.length >= 3) {
    const mid = boards[Math.floor(boards.length / 2)];
    if (mid.id !== budget.id) {
      picks.push({
        emoji: '⚖️', label: 'Sweet Spot', motherboard: mid,
        detail: `Middle of the ${socket} price range at $${mid.price_usd} — a ${mid.form_factor} board with room to grow.`,
      });
    }
  }

  const premium = boards[boards.length - 1];
  if (premium.id !== budget.id) {
    picks.push({
      emoji: '👑', label: 'High-End Pick', motherboard: premium,
      detail: `The top ${socket} board we track at $${premium.price_usd}, for builds that want the most VRM/feature headroom.`,
    });
  }

  const bands = getCpuPriceBands(socket, picks.length);
  return picks.map((p, i) => {
    const band = bands[i];
    return band ? { ...p, cpuPairing: formatCpuPairing(socket, band) } : p;
  });
}

export function getSocketPageMeta(page: SocketPage): RouteMeta {
  return {
    path: `/best-motherboard/${page.slug}`,
    title: `Best ${page.label} Motherboards | SpecSmith`,
    description: `Every ${page.label} motherboard we track, compared by price, form factor, and RAM support — with budget, sweet-spot, and high-end picks for your build.`,
  };
}
