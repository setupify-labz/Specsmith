import gamesData from '../data/games.json';
import { estimateFpsForBuild } from './fps';
import { getMatchupGpu, getMatchupCpu, fpsPer100, type MatchupGpu } from './matchups';
import type { RouteMeta } from './seo';

export interface PageGame {
  id: string;
  name: string;
  genre: string;
  gpu_bound?: number;
  base_fps: Record<string, Record<string, number>>;
  [key: string]: unknown;
}

export interface GamePage {
  slug: string;
  gameId: string;
}

// "Best GPU for <game>" SEO landing pages at /best-gpu/<slug>.
// Slugs are indexed URLs — keep them stable once published.
export const GAME_PAGES: GamePage[] = [
  { slug: 'fortnite',                    gameId: 'fortnite' },
  { slug: 'valorant',                    gameId: 'valorant' },
  { slug: 'cs2',                         gameId: 'cs2' },
  { slug: 'cyberpunk-2077',              gameId: 'cyberpunk2077' },
  { slug: 'gta-5',                       gameId: 'gtav' },
  { slug: 'minecraft',                   gameId: 'minecraft' },
  { slug: 'warzone',                     gameId: 'warzone' },
  { slug: 'apex-legends',                gameId: 'apex' },
  { slug: 'elden-ring',                  gameId: 'eldenring' },
  { slug: 'baldurs-gate-3',              gameId: 'bg3' },
  { slug: 'starfield',                   gameId: 'starfield' },
  { slug: 'hogwarts-legacy',             gameId: 'hogwarts' },
  { slug: 'alan-wake-2',                 gameId: 'alanwake2' },
  { slug: 'red-dead-redemption-2',       gameId: 'rdr2' },
  { slug: 'the-witcher-3',               gameId: 'witcher3' },
  { slug: 'spider-man-2',                gameId: 'spiderman2' },
  { slug: 'rainbow-six-siege',           gameId: 'r6siege' },
  { slug: 'microsoft-flight-simulator',  gameId: 'msfs2024' },
  { slug: 'dying-light-2',               gameId: 'dyinglight2' },
  { slug: 'assassins-creed-mirage',      gameId: 'acmirage' },
];

// Price ladder shown in every game's FPS table — a representative spread
// of currently-buyable cards from budget to flagship, not the full dataset.
export const GAME_TABLE_GPU_IDS = [
  'rtx5090', 'rtx5080', 'rx7900xtx', 'rtx5070ti', 'rx9070xt', 'rx9070',
  'rtx5070', 'rx7800xt', 'rtx5060ti', 'rx9060xt16', 'rx7700xt', 'rtx5060',
  'arcb580', 'rx7600', 'arcb570',
];

const games = gamesData as PageGame[];

export function getGamePage(slug: string): GamePage | undefined {
  return GAME_PAGES.find(p => p.slug === slug);
}

export function getPageGame(gameId: string): PageGame | undefined {
  return games.find(g => g.id === gameId);
}

export function getGamePageTitle(p: GamePage): string {
  return getPageGame(p.gameId)?.name ?? p.gameId;
}

export interface GameGpuRow {
  gpu: MatchupGpu;
  fps1080: number;
  fps1440: number;
  fps4k: number;
  valuePer100: number; // 1440p FPS per $100
}

function fpsFor(gpu: MatchupGpu, game: PageGame, resolution: string): number {
  return estimateFpsForBuild(gpu, getMatchupCpu(), game, resolution, 'high').estimated;
}

export function getGameGpuRows(game: PageGame): GameGpuRow[] {
  return GAME_TABLE_GPU_IDS
    .map(id => getMatchupGpu(id))
    .filter((g): g is MatchupGpu => Boolean(g))
    .map(gpu => {
      const fps1440 = fpsFor(gpu, game, '1440p');
      return {
        gpu,
        fps1080: fpsFor(gpu, game, '1080p'),
        fps1440,
        fps4k: fpsFor(gpu, game, '4k'),
        valuePer100: fpsPer100(fps1440, gpu.price_usd),
      };
    })
    .sort((a, b) => b.gpu.price_usd - a.gpu.price_usd);
}

export interface GamePick {
  emoji: string;
  label: string;
  gpu: MatchupGpu;
  detail: string;
}

/**
 * Per-game buying picks. GPU ranking is the same in every game (the
 * estimator is monotonic in gpu_multiplier), so the game-specific value
 * comes from thresholds: which card is ENOUGH for 144 FPS at 1080p, or
 * 60 FPS at 4K, varies a lot between Valorant and Alan Wake 2.
 */
export function getGamePicks(game: PageGame): GamePick[] {
  const rows = getGameGpuRows(game);
  const picks: GamePick[] = [];

  const king = rows.reduce((best, r) => (r.fps4k > best.fps4k ? r : best), rows[0]);
  picks.push({
    emoji: '🏆', label: 'FPS King', gpu: king.gpu,
    detail: `The most frames money can buy: ${king.fps4k} FPS at 4K High, ${king.fps1440} at 1440p.`,
  });

  const playable = rows.filter(r => r.fps1440 >= 60);
  const valuePool = playable.length > 0 ? playable : rows;
  const value = valuePool.reduce((best, r) => (r.valuePer100 > best.valuePer100 ? r : best), valuePool[0]);
  picks.push({
    emoji: '💰', label: 'Best Value', gpu: value.gpu,
    detail: `${value.valuePer100} FPS per $100 — ${value.fps1440} FPS at 1440p High for $${value.gpu.price_usd}.`,
  });

  const esports = rows.filter(r => r.fps1080 >= 144)
    .reduce<GameGpuRow | null>((best, r) => (!best || r.gpu.price_usd < best.gpu.price_usd ? r : best), null);
  if (esports) {
    picks.push({
      emoji: '⚡', label: 'Cheapest 144 FPS', gpu: esports.gpu,
      detail: `The least expensive card on our ladder that clears 144 FPS at 1080p High (${esports.fps1080} FPS).`,
    });
  }

  const fourK = rows.filter(r => r.fps4k >= 60)
    .reduce<GameGpuRow | null>((best, r) => (!best || r.gpu.price_usd < best.gpu.price_usd ? r : best), null);
  if (fourK) {
    picks.push({
      emoji: '🎯', label: 'Cheapest 4K 60', gpu: fourK.gpu,
      detail: `The least expensive way to 60+ FPS at 4K High (${fourK.fps4k} FPS for $${fourK.gpu.price_usd}).`,
    });
  }

  const budget = rows.filter(r => r.gpu.price_usd <= 300)
    .reduce<GameGpuRow | null>((best, r) => (!best || r.fps1440 > best.fps1440 ? r : best), null);
  if (budget) {
    picks.push({
      emoji: '💵', label: 'Budget Beast', gpu: budget.gpu,
      detail: `Best under $300: ${budget.fps1080} FPS at 1080p and ${budget.fps1440} at 1440p High.`,
    });
  }

  return picks;
}

/**
 * Average 1080p→4K FPS drop-off for the FPS King GPU, across every tracked
 * game — computed once from the same estimator calls the pages themselves
 * make (no separate data source), so getGameIntro can say whether a given
 * game's resolution scaling is steeper or gentler than typical instead of
 * just restating its gpu_bound bucket.
 */
let cachedAverageResolutionDropPct: number | null = null;
function getAverageResolutionDropPct(): number {
  if (cachedAverageResolutionDropPct !== null) return cachedAverageResolutionDropPct;
  const drops = GAME_PAGES.map((p) => {
    const g = getPageGame(p.gameId);
    if (!g) return null;
    const rows = getGameGpuRows(g);
    const king = rows.reduce((best, r) => (r.fps4k > best.fps4k ? r : best), rows[0]);
    return Math.round(((king.fps1080 - king.fps4k) / king.fps1080) * 100);
  }).filter((d): d is number => d !== null);
  cachedAverageResolutionDropPct = Math.round(drops.reduce((a, b) => a + b, 0) / drops.length);
  return cachedAverageResolutionDropPct;
}

/**
 * Game-specific intro paragraph. Previously bucketed purely by gpu_bound
 * into one of three generic templates (most GPU-heavy games saying nearly
 * identical things about each other). Now computes an actual number from
 * this game's own FPS ladder — how much the FPS King GPU's frame rate
 * drops from 1080p to 4K — and states it relative to the 20-game average,
 * so two games with similar gpu_bound values but different real scaling
 * curves no longer read as the same page with the name swapped.
 */
export function getGameIntro(game: PageGame, rows: GameGpuRow[]): string {
  const cpu = getMatchupCpu();
  const base = `All estimates below assume High settings at native resolution (no DLSS/FSR upscaling) paired with a ${cpu.name}.`;
  const king = rows.reduce((best, r) => (r.fps4k > best.fps4k ? r : best), rows[0]);
  const dropPct = Math.round(((king.fps1080 - king.fps4k) / king.fps1080) * 100);
  const avgDropPct = getAverageResolutionDropPct();
  const diff = dropPct - avgDropPct;
  const comparison =
    Math.abs(diff) <= 3
      ? `about typical for the games we track — the 20-game average is ${avgDropPct}%`
      : diff > 0
      ? `steeper than the 20-game average of ${avgDropPct}% — GPU choice matters more than usual for this one`
      : `gentler than the 20-game average of ${avgDropPct}% — you can get away with less GPU than usual and still hold up at 4K`;
  return `Stepping up from 1080p to 4K, even the ${king.gpu.name} loses about ${dropPct}% of its frame rate in ${game.name} — ${comparison}. ${base}`;
}

/** Other game pages to cross-link (same genre first, then the rest). */
export function getRelatedGamePages(p: GamePage, limit = 4): GamePage[] {
  const genre = getPageGame(p.gameId)?.genre;
  const others = GAME_PAGES.filter(o => o.slug !== p.slug);
  const sameGenre = others.filter(o => getPageGame(o.gameId)?.genre === genre);
  const rest = others.filter(o => getPageGame(o.gameId)?.genre !== genre);
  return [...sameGenre, ...rest].slice(0, limit);
}

// Kept here (not in lib/seo.ts) so pages that don't need game-page data
// don't pull this module's JSON imports into their shared chunk.
export function getGamePageMeta(page: GamePage): RouteMeta {
  const name = getPageGame(page.gameId)?.name ?? page.gameId;
  return {
    path: `/best-gpu/${page.slug}`,
    title: `Best GPU for ${name} | SpecSmith`,
    description: `Best graphics cards for ${name}: FPS for 15 GPUs from budget to flagship at 1080p, 1440p & 4K — plus value and budget picks.`,
  };
}
