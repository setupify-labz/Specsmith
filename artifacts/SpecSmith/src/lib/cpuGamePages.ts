import { estimateFpsForBuild } from './fps';
import { getMatchupCpuById, getMatchupFixedGpu, fpsPer100, type MatchupCpu } from './matchups';
import { GAME_PAGES, getPageGame, type PageGame, type GamePage } from './gamePages';
import type { RouteMeta } from './seo';

// "Best CPU for <game>" SEO landing pages at /best-cpu/<slug>. Reuses the
// same 20-game list as the GPU game pages so every title has a matching pair.
export const CPU_GAME_PAGES: GamePage[] = GAME_PAGES;

// Price ladder for the CPU FPS table — a representative spread of current
// Intel/AMD chips from budget to flagship, not the full 50-CPU dataset.
export const GAME_TABLE_CPU_IDS = [
  'r7-9850x3d', 'r9-9950x3d', 'r9-9900x3d', 'cu9-285k', 'r7-9800x3d', 'i9-14900k',
  'i7-14700k', 'r7-9700x', 'cu7-265k', 'r7-7800x3d', 'r5-9600x',
  'i5-14600k', 'cu5-245k', 'r5-7600', 'i5-13400f', 'i3-14100f',
];

export function getCpuGamePage(slug: string): GamePage | undefined {
  return CPU_GAME_PAGES.find(p => p.slug === slug);
}

export interface GameCpuRow {
  cpu: MatchupCpu;
  fps1080: number;
  fps1440: number;
  fps4k: number;
  valuePer100: number; // 1080p FPS per $100 — where CPU differences show most
}

function fpsFor(cpu: MatchupCpu, game: PageGame, resolution: string): number {
  return estimateFpsForBuild(getMatchupFixedGpu(), cpu, game, resolution, 'high').estimated;
}

export function getGameCpuRows(game: PageGame): GameCpuRow[] {
  return GAME_TABLE_CPU_IDS
    .map(id => getMatchupCpuById(id))
    .filter((c): c is MatchupCpu => Boolean(c))
    .map(cpu => {
      const fps1080 = fpsFor(cpu, game, '1080p');
      return {
        cpu,
        fps1080,
        fps1440: fpsFor(cpu, game, '1440p'),
        fps4k: fpsFor(cpu, game, '4k'),
        valuePer100: fpsPer100(fps1080, cpu.price_usd),
      };
    })
    .sort((a, b) => b.cpu.price_usd - a.cpu.price_usd);
}

export interface CpuGamePick {
  emoji: string;
  label: string;
  cpu: MatchupCpu;
  detail: string;
}

/**
 * Per-game CPU picks. Paired with a fixed RTX 4090 so the CPU is the
 * bottleneck wherever a game allows it to be. In GPU-bound titles every
 * modern CPU clusters within a few FPS of each other — the honest "Best
 * Value" pick is whichever cheap chip ties the fastest one, not whichever
 * chip is fastest.
 */
export function getCpuGamePicks(game: PageGame): CpuGamePick[] {
  const rows = getGameCpuRows(game);
  const picks: CpuGamePick[] = [];

  const king = rows.reduce((best, r) => (r.fps1080 > best.fps1080 ? r : best), rows[0]);
  picks.push({
    emoji: '🏆', label: 'Best Overall', cpu: king.cpu,
    detail: `The most gaming headroom: ${king.fps1080} FPS at 1080p High, ${king.fps1440} at 1440p.`,
  });

  const tiedWithKing = rows.filter(r => r.fps1080 >= king.fps1080 * 0.97);
  const value = tiedWithKing.reduce((best, r) => (r.cpu.price_usd < best.cpu.price_usd ? r : best), tiedWithKing[0]);
  picks.push({
    emoji: '💰', label: 'Best Value', cpu: value.cpu,
    detail: value.cpu.id === king.cpu.id
      ? `Also the fastest chip — no cheaper CPU matches its FPS in this game.`
      : `Ties the fastest chip's FPS here (${value.fps1080} vs ${king.fps1080}) for $${king.cpu.price_usd - value.cpu.price_usd} less.`,
  });

  const budget = rows.filter(r => r.cpu.price_usd <= 200)
    .reduce<GameCpuRow | null>((best, r) => (!best || r.fps1080 > best.fps1080 ? r : best), null);
  if (budget) {
    picks.push({
      emoji: '💵', label: 'Budget Beast', cpu: budget.cpu,
      detail: `Best under $200: ${budget.fps1080} FPS at 1080p and ${budget.fps1440} at 1440p High.`,
    });
  }

  return picks;
}

/**
 * Average FPS spread between the fastest and cheapest tracked CPU (same
 * fixed-GPU methodology as the page tables) across every tracked game —
 * computed once, so getCpuGameIntro can say whether a given game's CPU
 * sensitivity is wider or narrower than typical instead of just restating
 * its gpu_bound bucket.
 */
let cachedAverageCpuSpreadPct: number | null = null;
function getAverageCpuSpreadPct(): number {
  if (cachedAverageCpuSpreadPct !== null) return cachedAverageCpuSpreadPct;
  const spreads = CPU_GAME_PAGES.map((p) => {
    const g = getPageGame(p.gameId);
    if (!g) return null;
    const rows = getGameCpuRows(g);
    const fastest = rows.reduce((best, r) => (r.fps1080 > best.fps1080 ? r : best), rows[0]);
    const cheapest = rows.reduce((best, r) => (r.cpu.price_usd < best.cpu.price_usd ? r : best), rows[0]);
    return Math.round(((fastest.fps1080 - cheapest.fps1080) / fastest.fps1080) * 100);
  }).filter((d): d is number => d !== null);
  cachedAverageCpuSpreadPct = Math.round(spreads.reduce((a, b) => a + b, 0) / spreads.length);
  return cachedAverageCpuSpreadPct;
}

/**
 * Game-specific intro. Previously bucketed purely by gpu_bound into one of
 * three generic templates. Now computes the actual FPS gap between the
 * fastest and cheapest CPU on this page's own ladder — a real buying
 * question ("what do I give up by not buying the top chip?") — and states
 * it relative to the 20-game average, so games no longer read as
 * interchangeable copies of each other with the name swapped.
 */
export function getCpuGameIntro(game: PageGame, rows: GameCpuRow[]): string {
  const gpu = getMatchupFixedGpu();
  const base = `All estimates below assume High settings at native resolution (no DLSS/FSR upscaling) paired with an ${gpu.name} so the CPU is the bottleneck wherever the game allows it.`;
  const fastest = rows.reduce((best, r) => (r.fps1080 > best.fps1080 ? r : best), rows[0]);
  const cheapest = rows.reduce((best, r) => (r.cpu.price_usd < best.cpu.price_usd ? r : best), rows[0]);
  const spreadPct = Math.round(((fastest.fps1080 - cheapest.fps1080) / fastest.fps1080) * 100);
  const avgSpreadPct = getAverageCpuSpreadPct();
  const diff = spreadPct - avgSpreadPct;
  const comparison =
    Math.abs(diff) <= 1
      ? `about typical for the games we track — the 20-game average is ${avgSpreadPct}%`
      : diff > 0
      ? `wider than the 20-game average of ${avgSpreadPct}% — this is exactly the kind of title worth spending on a faster CPU for`
      : `narrower than the 20-game average of ${avgSpreadPct}% — almost any CPU on our list keeps up here, so don't overspend on the processor for this game specifically`;
  return `At 1080p, the ${cheapest.cpu.name} trails the ${fastest.cpu.name} by about ${spreadPct}% FPS in ${game.name} — ${comparison}. ${base}`;
}

/** Other CPU-game pages to cross-link (same genre first, then the rest). */
export function getRelatedCpuGamePages(p: GamePage, limit = 4): GamePage[] {
  const genre = getPageGame(p.gameId)?.genre;
  const others = CPU_GAME_PAGES.filter(o => o.slug !== p.slug);
  const sameGenre = others.filter(o => getPageGame(o.gameId)?.genre === genre);
  const rest = others.filter(o => getPageGame(o.gameId)?.genre !== genre);
  return [...sameGenre, ...rest].slice(0, limit);
}

// Kept here (not in lib/seo.ts) so pages that don't need CPU-game data
// don't pull this module's JSON imports into their shared chunk.
export function getCpuGamePageMeta(page: GamePage): RouteMeta {
  const name = getPageGame(page.gameId)?.name ?? page.gameId;
  return {
    path: `/best-cpu/${page.slug}`,
    title: `Best CPU for ${name} | SpecSmith`,
    description: `The best processors for ${name}: estimated FPS for 15 CPUs from budget to flagship, paired with an RTX 4090 to isolate CPU performance.`,
  };
}
