/** Turns the /compare page's existing per-game FPS numbers and each build's
 * total parts cost into a value comparison — which build gets you more FPS
 * per dollar, independent of which one wins more individual games. Pure
 * functions so the guard logic (cost/FPS <= 0) and the value-pick logic can
 * be tested without rendering the page. */

export function getAverageFps(fpsValues: number[]): number {
  if (fpsValues.length === 0) return 0;
  return Math.round(fpsValues.reduce((sum, v) => sum + v, 0) / fpsValues.length);
}

/** Dollars per average FPS for a build. Null when cost or average FPS isn't
 * positive — a $/FPS ratio would be undefined or misleading otherwise. */
export function getCostPerFps(cost: number, avgFps: number): number | null {
  return cost > 0 && avgFps > 0 ? Math.round(cost / avgFps) : null;
}

export type BetterValueBuild = 'A' | 'B' | null;

/** Which build is the better value ($/avg FPS), separate from raw game-win
 * count — a build can win more games while still costing more per FPS
 * overall. Null when either side's costPerFps isn't computable, or when
 * they're exactly tied (no meaningful "better" pick). */
export function getBetterValueBuild(costPerFpsA: number | null, costPerFpsB: number | null): BetterValueBuild {
  if (costPerFpsA === null || costPerFpsB === null) return null;
  if (costPerFpsA === costPerFpsB) return null;
  return costPerFpsA < costPerFpsB ? 'A' : 'B';
}
