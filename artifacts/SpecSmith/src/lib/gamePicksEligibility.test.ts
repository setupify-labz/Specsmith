import { describe, it, expect, vi } from 'vitest';

// Negative control for the per-game buying picks: no GPU or CPU in today's
// game tables is ineligible, so this marks the would-be winners ineligible
// in a mocked ledger and proves the picks route around them while the
// comparison rows keep showing them.
vi.mock('./catalogLifecycle', () => ({
  isRecommendable: (id: string) => id !== 'rtx5090' && id !== 'r7-9850x3d',
}));

const { GAME_PAGES, getGamePicks, getGameGpuRows, getPageGame } = await import('./gamePages');
const { getCpuGamePicks, getGameCpuRows } = await import('./cpuGamePages');

describe('per-game picks follow catalog eligibility', () => {
  const game = getPageGame(GAME_PAGES[0].gameId)!;

  it('never picks an ineligible GPU, but still lists it in the comparison rows', () => {
    expect(getGameGpuRows(game).some((r) => r.gpu.id === 'rtx5090')).toBe(true);
    const picks = getGamePicks(game);
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.map((p) => p.gpu.id)).not.toContain('rtx5090');
  });

  it('never picks an ineligible CPU, but still lists it in the comparison rows', () => {
    expect(getGameCpuRows(game).some((r) => r.cpu.id === 'r7-9850x3d')).toBe(true);
    expect(getCpuGamePicks(game).map((p) => p.cpu.id)).not.toContain('r7-9850x3d');
  });
});
