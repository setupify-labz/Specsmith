/**
 * Who has the higher modelled estimate in each game, counting ties as ties.
 *
 * Compare once scored `fpsA >= fpsB` as a lead for Build A, so every equal
 * estimate was reported as a Build A "lead". A tie is not a lead for either
 * build, and an evidence tally that quietly hands them to one side overstates
 * it.
 */
export type GameOutcome = 'A' | 'B' | 'tie';

export function gameOutcome(fpsA: number, fpsB: number): GameOutcome {
  if (fpsA > fpsB) return 'A';
  if (fpsB > fpsA) return 'B';
  return 'tie';
}

export interface ModelledTally {
  leadsA: number;
  leadsB: number;
  ties: number;
}

export function tallyModelledLeads(rows: ReadonlyArray<{ fpsA: number; fpsB: number }>): ModelledTally {
  const tally: ModelledTally = { leadsA: 0, leadsB: 0, ties: 0 };
  for (const row of rows) {
    const outcome = gameOutcome(row.fpsA, row.fpsB);
    if (outcome === 'A') tally.leadsA += 1;
    else if (outcome === 'B') tally.leadsB += 1;
    else tally.ties += 1;
  }
  return tally;
}
