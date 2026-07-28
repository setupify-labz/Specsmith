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
  'r9-9950x3d', 'r9-9900x3d', 'cu9-285k', 'r7-9800x3d', 'i9-14900k',
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

/** Game-specific intro — how much the CPU actually matters for this title. */
export function getCpuGameIntro(game: PageGame): string {
  const bound = game.gpu_bound ?? 0.75;
  const gpu = getMatchupFixedGpu();
  const base = `All estimates below assume High settings at native resolution (no DLSS/FSR upscaling) paired with an ${gpu.name} so the CPU is the bottleneck wherever the game allows it.`;
  if (bound >= 0.85) {
    return `${game.name} is heavily GPU-bound — nearly any modern CPU delivers close to the same frame rate here, so don't overspend on the processor for this game specifically; put the budget into the graphics card instead. ${base}`;
  }
  if (bound >= 0.65) {
    return `${game.name} leans on the GPU, but a faster CPU still helps frame pacing and 1% lows, especially at 1080p. ${base}`;
  }
  return `${game.name} is a CPU-heavy esports title — the processor genuinely controls your frame rate ceiling here, so this is exactly the kind of game worth spending on a fast CPU for. ${base}`;
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
    description: `The best processors for ${name} in 2026: estimated FPS for 15 CPUs from budget to flagship, paired with an RTX 4090 to isolate CPU performance — plus best value and budget picks.`,
  };
}
