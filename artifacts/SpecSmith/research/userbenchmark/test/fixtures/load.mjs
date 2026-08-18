// Fixture loading for the test suite. Reads the real saved page sources from
// ../../pages/ so tests assert against genuine markup rather than a
// hand-written approximation of it.
//
// Adding PUBG / CS:GO: save their pages into pages/ using the filename
// convention `FPS-Estimates-<Slug>-<gameId>.html`, then the corpus test
// picks them up automatically and `loadOptional` below finds them by id.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const pagesDir = path.join(here, '..', '..', 'pages');

export async function listSourceFiles() {
  try {
    return (await fs.readdir(pagesDir)).filter((f) => /\.(html?|xhtml|txt)$/i.test(f)).sort();
  } catch {
    return [];
  }
}

/** Matches on the page's CANONICAL URL only.
 *
 * A plain "does this file mention game N" search is wrong: every game page
 * links to a dozen OTHER games in its related-games strip, so the Fortnite
 * source contains `FPS-Estimates-.../3680/` (CS:GO) and would be falsely
 * reported as the CS:GO source. Only the canonical link identifies the page. */
export async function loadByGameId(gameId) {
  const re = new RegExp(`<link rel="canonical" href="[^"]*\\/PCGame\\/FPS-Estimates-[^/"]+\\/${gameId}\\/`);
  for (const f of await listSourceFiles()) {
    const html = await fs.readFile(path.join(pagesDir, f), 'utf-8');
    if (re.test(html)) return { file: f, html };
  }
  return null;
}

export async function loadFortnite() {
  const r = await loadByGameId('3954');
  if (!r) throw new Error('Fortnite source (gameId 3954) not found in pages/ — the test suite requires it.');
  return r;
}

/** Returns null instead of throwing when a source isn't saved yet, so tests
 * can skip rather than fail for a page nobody has captured. */
export async function loadOptional(gameId) {
  return loadByGameId(gameId);
}
