import componentData from '../data/components.json';
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

const motherboards = componentData.motherboards as PageMotherboard[];

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

export interface MotherboardPick {
  emoji: string;
  label: string;
  motherboard: PageMotherboard;
  detail: string;
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

  return picks;
}

export function getSocketPageMeta(page: SocketPage): RouteMeta {
  return {
    path: `/best-motherboard/${page.slug}`,
    title: `Best ${page.label} Motherboards (2026) — Budget to High-End | SpecSmith`,
    description: `Every ${page.label} motherboard we track, compared by price, form factor, and RAM support — with budget, sweet-spot, and high-end picks for your build.`,
  };
}
