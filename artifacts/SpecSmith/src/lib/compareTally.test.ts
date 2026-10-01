import { describe, expect, it } from 'vitest';
import { gameOutcome, tallyModelledLeads } from './compareTally';

describe('modelled lead tally', () => {
  it('counts an equal estimate as a tie, never as a lead for Build A', () => {
    expect(gameOutcome(119, 119)).toBe('tie');
    expect(gameOutcome(120, 119)).toBe('A');
    expect(gameOutcome(118, 119)).toBe('B');
    expect(tallyModelledLeads([{ fpsA: 1, fpsB: 1 }, { fpsA: 2, fpsB: 1 }, { fpsA: 1, fpsB: 3 }])).toEqual({ leadsA: 1, leadsB: 1, ties: 1 });
  });

  it('every game is counted exactly once', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ fpsA: i % 3, fpsB: 1 }));
    const tally = tallyModelledLeads(rows);
    expect(tally.leadsA + tally.leadsB + tally.ties).toBe(20);
  });
});
