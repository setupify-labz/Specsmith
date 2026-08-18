// EFPS extractor tests.
//
// These assert ACTUAL KNOWN VALUES from the saved source, not just counts, so
// a regression that keeps the record count stable but corrupts the values
// still fails.

import { describe, it, assert } from './harness.mjs';
import { extractEfpsRecords, parseEfpsUrl, parseEfpsValue, parseEfpsTitle } from '../lib/efps.mjs';
import { loadFortnite } from './fixtures/load.mjs';

const fortnite = await loadFortnite();
const efps = extractEfpsRecords(fortnite.html, { sourceFile: fortnite.file, gameId: '3954', gameName: 'Fortnite' });
const direct = efps.records.filter((r) => r.kind === 'direct');
const comparisons = efps.records.filter((r) => r.kind === 'comparison');

const findDirect = (gpu, cpu) => direct.find((r) => r.config.gpu === gpu && r.config.cpu === cpu);
const findByTitle = (t) => efps.records.find((r) => r.exactTitle === t);

describe('EFPS: URL structure', () => {
  it('parses a direct URL into 3 groups of 4 fields', () => {
    const u = parseEfpsUrl('https://www.userbenchmark.com/EFps/,,,_,,,_Fortnite,2060S,3600,');
    assert.equal(u.base.game, 'Fortnite', 'field 0 = game');
    assert.equal(u.base.gpu, '2060S', 'field 1 = GPU');
    assert.equal(u.base.cpu, '3600', 'field 2 = CPU');
    assert.equal(u.base.field3, null, 'field 3 is unpopulated');
    assert.equal(u.variantA.gpu, null);
    assert.equal(u.variantB.gpu, null);
  });

  it('parses a GPU-comparison URL', () => {
    const u = parseEfpsUrl('https://www.userbenchmark.com/EFps/,1660-Ti,,_,5700-XT,,_Fortnite,,9400F,');
    assert.equal(u.variantA.gpu, '1660-Ti');
    assert.equal(u.variantB.gpu, '5700-XT');
    assert.equal(u.base.game, 'Fortnite');
    assert.equal(u.base.cpu, '9400F', 'shared CPU sits in the base group');
    assert.equal(u.base.gpu, null, 'GPU is the varied dimension so base GPU is empty');
  });

  it('parses a CPU-comparison URL', () => {
    const u = parseEfpsUrl('https://www.userbenchmark.com/EFps/,,3600,_,,9600K,_Fortnite,2060S,,');
    assert.equal(u.variantA.cpu, '3600');
    assert.equal(u.variantB.cpu, '9600K');
    assert.equal(u.base.gpu, '2060S', 'shared GPU sits in the base group');
  });

  it('rejects a malformed payload rather than guessing', () => {
    assert.equal(parseEfpsUrl('https://www.userbenchmark.com/EFps/only,one,group'), null);
    assert.equal(parseEfpsUrl('https://www.userbenchmark.com/EFps/a,b_c,d_e,f'), null, 'wrong field arity');
    assert.equal(parseEfpsUrl('https://example.com/EFps/,,,_,,,_X,Y,Z,'), null, 'wrong host');
  });
});

describe('EFPS: value parsing', () => {
  it('parses a single value', () => {
    const v = parseEfpsValue('131');
    assert.equal(v.kind, 'single');
    assert.deepEqual(v.values, [131]);
  });
  it('parses a comparison value', () => {
    const v = parseEfpsValue('123 vs 117');
    assert.equal(v.kind, 'comparison');
    assert.deepEqual(v.values, [123, 117]);
  });
  it('flags non-numeric as malformed, never coerced', () => {
    assert.equal(parseEfpsValue('n/a').kind, 'malformed');
    assert.equal(parseEfpsValue('').kind, 'malformed');
    assert.equal(parseEfpsValue('12 vs abc').kind, 'malformed');
  });
  it('flags zero and negative FPS as malformed', () => {
    assert.equal(parseEfpsValue('0').kind, 'malformed');
    assert.equal(parseEfpsValue('-5').kind, 'malformed');
    assert.equal(parseEfpsValue('0 vs 60').kind, 'malformed');
  });
  it('flags an unexpected number of sides', () => {
    assert.equal(parseEfpsValue('1 vs 2 vs 3').kind, 'malformed');
  });
});

describe('EFPS: title parsing is name-independent', () => {
  it('splits a comparison title without relying on the game name', () => {
    const t = parseEfpsTitle('Fortnite 5700-XT vs 1660-Ti - 9400F');
    assert.ok(t.hasVs);
    assert.equal(t.sideALabel, '5700-XT');
    assert.equal(t.sideBLabel, '1660-Ti');
    assert.equal(t.sharedLabel, '9400F');
  });

  it('handles a game whose display name differs from the EFPS token (PUBG)', () => {
    // The regression this guards: classification must not depend on stripping
    // a `gameName + " "` prefix. "PUBG" here is the EFPS token while the
    // catalog name is "PlayerUnknown's Battlegrounds".
    const t = parseEfpsTitle('PUBG 9400F vs 9100F - 2060S');
    assert.ok(t.hasVs);
    assert.equal(t.sideALabel, '9400F');
    assert.equal(t.sideBLabel, '9100F');
    assert.equal(t.sharedLabel, '2060S');
  });

  it('handles a multi-word game name (CSGO / Counter-Strike)', () => {
    const t = parseEfpsTitle('Counter-Strike Global Offensive 2060S vs 1660-Ti - 9400F');
    assert.ok(t.hasVs);
    assert.equal(t.sideALabel, '2060S', 'only the token adjacent to " vs " is the compared part');
    assert.equal(t.sideBLabel, '1660-Ti');
  });

  it('reports a direct title as having no vs marker', () => {
    const t = parseEfpsTitle('Fortnite 3600 2060S');
    assert.notOk(t.hasVs);
  });
});

describe('EFPS: extraction from the saved Fortnite source', () => {
  it('extracts every embedded record with none rejected', () => {
    assert.equal(efps.stats.total, 200, 'total EFPS objects');
    assert.equal(efps.stats.accepted, 200, 'all accepted');
    assert.equal(efps.stats.rejected, 0, 'none rejected');
  });

  it('classifies direct vs comparison by structure', () => {
    assert.equal(efps.stats.direct, 27);
    assert.equal(efps.stats.comparisons, 173);
    assert.equal(direct.length + comparisons.length, 200);
  });

  // ---- Exact known values. These are the source's own published numbers. ----
  it('Fortnite 3600 + 2060S = 131 FPS exactly', () => {
    const r = findDirect('2060S', '3600');
    assert.ok(r, 'record exists');
    assert.equal(r.fps, 131);
    assert.equal(r.exactValue, '131', 'raw value preserved verbatim');
    assert.equal(r.exactTitle, 'Fortnite 3600 2060S');
  });

  it('Fortnite 9600K + 2060S = 133 FPS exactly', () => {
    const r = findDirect('2060S', '9600K');
    assert.ok(r);
    assert.equal(r.fps, 133);
  });

  it('Fortnite 9400F + 2060S = 130 FPS exactly', () => {
    assert.equal(findDirect('2060S', '9400F').fps, 130);
  });

  it('Fortnite 9400F + 5700-XT = 137, + 1660-Ti = 108, + 1050-Ti = 49', () => {
    assert.equal(findDirect('5700-XT', '9400F').fps, 137);
    assert.equal(findDirect('1660-Ti', '9400F').fps, 108);
    assert.equal(findDirect('1050-Ti', '9400F').fps, 49);
  });

  it('a direct record carries a fully decoded config and no comparison sides', () => {
    const r = findDirect('2060S', '3600');
    assert.deepEqual(r.config, { game: 'Fortnite', gpu: '2060S', cpu: '3600' });
    assert.equal(r.sides, undefined, 'direct records have no sides');
    assert.equal(r.unresolvedFields.length, 0);
  });
});

describe('EFPS: comparisons stay comparisons', () => {
  it('a GPU comparison keeps both sides with exact values', () => {
    const r = findByTitle('Fortnite 5700-XT vs 1660-Ti - 9400F');
    assert.ok(r);
    assert.equal(r.kind, 'comparison', 'must NOT be flattened into a direct record');
    assert.equal(r.exactValue, '137 vs 108');
    assert.equal(r.sides.length, 2);
    assert.equal(r.sides[0].label, '5700-XT');
    assert.equal(r.sides[0].fps, 137);
    assert.equal(r.sides[1].label, '1660-Ti');
    assert.equal(r.sides[1].fps, 108);
    assert.equal(r.sharedConfig.cpu, '9400F');
  });

  it('a CPU comparison keeps both sides with exact values', () => {
    const r = findByTitle('Fortnite 9600K vs 3600 - 2060S');
    assert.ok(r);
    assert.equal(r.kind, 'comparison');
    assert.equal(r.exactValue, '133 vs 131');
    assert.equal(r.sides[0].fps, 133);
    assert.equal(r.sides[1].fps, 131);
    assert.equal(r.sharedConfig.gpu, '2060S');
  });

  it('title order is NOT assumed to match URL group order', () => {
    // 'Fortnite 5700-XT vs 1660-Ti - 9400F' has 1660-Ti in URL group 1 and
    // 5700-XT in group 2 — i.e. the title is REVERSED relative to the URL.
    // The extractor must resolve each side by token match, not position.
    const r = findByTitle('Fortnite 5700-XT vs 1660-Ti - 9400F');
    assert.equal(r.variantA.gpu, '1660-Ti', 'URL group 1');
    assert.equal(r.variantB.gpu, '5700-XT', 'URL group 2');
    assert.equal(r.sides[0].resolvedVariant, 'B', 'title side A resolves to URL group B');
    assert.equal(r.sides[1].resolvedVariant, 'A');
    assert.equal(r.sides[0].gpu, '5700-XT', 'side keeps the GPU it actually names');
  });

  it('both orderings occur in the real source, so position would be wrong ~half the time', () => {
    let titleMatchesGroup1 = 0;
    let titleMatchesGroup2 = 0;
    for (const r of comparisons) {
      if (r.sides[0].resolvedVariant === 'A') titleMatchesGroup1++;
      else if (r.sides[0].resolvedVariant === 'B') titleMatchesGroup2++;
    }
    assert.ok(titleMatchesGroup1 > 0, 'some titles follow URL order');
    assert.ok(titleMatchesGroup2 > 0, 'some titles reverse URL order');
    assert.equal(titleMatchesGroup1 + titleMatchesGroup2, comparisons.length, 'every side resolved');
  });

  it('every comparison side resolved to a distinct URL variant', () => {
    assert.equal(efps.stats.unresolvedVariantSides, 0);
    for (const r of comparisons) {
      assert.ok(r.sides[0].resolvedVariant !== r.sides[1].resolvedVariant, `both sides of "${r.exactTitle}" hit the same variant`);
    }
  });
});

describe('EFPS: internal cross-validation', () => {
  it('every comparison side agrees with the standalone direct record for the same config', () => {
    const byConfig = new Map(direct.map((d) => [`${d.config.gpu}|${d.config.cpu}`, d.fps]));
    let checked = 0;
    const mismatches = [];
    for (const c of comparisons) {
      for (const s of c.sides) {
        const key = `${s.gpu ?? c.sharedConfig.gpu}|${s.cpu ?? c.sharedConfig.cpu}`;
        if (!byConfig.has(key)) continue;
        checked++;
        if (byConfig.get(key) !== s.fps) mismatches.push(`${c.exactTitle}: side ${s.label} = ${s.fps}, direct = ${byConfig.get(key)}`);
      }
    }
    assert.ok(checked > 300, `expected a substantial cross-check sample, got ${checked}`);
    assert.equal(mismatches.length, 0, `mismatches: ${mismatches.slice(0, 3).join(' | ')}`);
  });
});

describe('EFPS: malformed and duplicate handling', () => {
  const synthetic = `
    results: [{
      id: 'https://www.userbenchmark.com/EFps/,,,_,,,_TestGame,2060S,3600,',
      t: 'TestGame 3600 2060S',
      p: '100'
    }, {
      id: 'https://www.userbenchmark.com/EFps/,,,_,,,_TestGame,2060S,3600,',
      t: 'TestGame 3600 2060S',
      p: '100'
    }, {
      id: 'https://www.userbenchmark.com/EFps/,,,_,,,_TestGame,1660,9400F,',
      t: 'TestGame 9400F 1660',
      p: 'n/a'
    }, {
      id: 'https://www.userbenchmark.com/EFps/,,,_,,,_TestGame,570,2600,',
      t: 'TestGame 2600 570',
      p: '0'
    }, {
      id: 'https://www.userbenchmark.com/EFps/broken-payload',
      t: 'TestGame broken',
      p: '55'
    }, {
      id: 'https://www.userbenchmark.com/NotEFps/x',
      t: 'Not an EFPS record',
      p: '60'
    }]`;
  const r = extractEfpsRecords(synthetic, { sourceFile: 'synthetic', gameId: '999', gameName: 'TestGame' });

  it('never silently discards a malformed record', () => {
    assert.equal(r.stats.total, 6, 'every {id,t,p} object is accounted for');
    assert.equal(r.stats.accepted, 2);
    assert.equal(r.stats.rejected, 4);
  });

  it('records a specific reason for each rejection', () => {
    const reasons = r.rejected.map((x) => x.reason).sort();
    assert.deepEqual(reasons, ['malformed-fps-value', 'malformed-fps-value', 'not-an-efps-url', 'unparseable-efps-url']);
  });

  it('preserves the raw source text of every rejected record', () => {
    for (const x of r.rejected) {
      assert.ok(x.rawObject && x.rawObject.length > 0, 'rawObject preserved');
      assert.ok(x.rawValue !== undefined, 'rawValue preserved');
    }
  });

  it('distinguishes not-a-number from non-positive', () => {
    const nan = r.rejected.find((x) => x.rawValue === 'n/a');
    const zero = r.rejected.find((x) => x.rawValue === '0');
    assert.equal(nan.detail, 'not-a-number');
    assert.equal(zero.detail, 'non-positive');
  });

  it('flags an exact duplicate rather than dropping it', () => {
    assert.equal(r.stats.exactDuplicates, 1, 'second identical object flagged');
    const dup = r.records.find((x) => x.isExactDuplicateOfIndex != null);
    assert.equal(dup.isExactDuplicateOfIndex, 0, 'points at the first occurrence');
    assert.equal(r.records.length, 2, 'both copies kept for the dedupe stage to decide on');
  });
});

describe('EFPS: unexpected titles', () => {
  it('accepts a record whose title has no recognizable game prefix', () => {
    const src = `[{ id: 'https://www.userbenchmark.com/EFps/,,,_,,,_X,2060S,3600,', t: '', p: '77' }]`;
    const r = extractEfpsRecords(src, { gameId: '1', gameName: 'X' });
    assert.equal(r.stats.accepted, 1, 'an empty title does not block extraction');
    assert.equal(r.records[0].fps, 77);
    assert.equal(r.records[0].kind, 'direct', 'structure, not title, decides the kind');
  });

  it('warns when the title vs-marker disagrees with URL structure', () => {
    const src = `[{ id: 'https://www.userbenchmark.com/EFps/,,,_,,,_X,2060S,3600,', t: 'X A vs B - C', p: '77' }]`;
    const r = extractEfpsRecords(src, { gameId: '1', gameName: 'X' });
    assert.equal(r.records[0].kind, 'direct', 'URL structure wins');
    assert.ok(r.records[0].warnings.some((w) => w.includes('disagrees')), 'disagreement is surfaced, not hidden');
  });
});

describe('EFPS: regression — comparison records must survive numeric coercion', () => {
  it('does not drop a record whose value is "N vs M"', () => {
    // The exact defect in the removed efps/extract-efps.mjs core (see the
    // reconciliation record in ../README.md): it did
    //   const fps = Number(p); if (!Number.isFinite(fps)) continue;
    // Number('137 vs 108') is NaN, so every comparison was silently skipped.
    // On the real Fortnite page that discarded 173 of 200 records (86.5%)
    // while reporting zero warnings.
    const src = `[{ id: 'https://www.userbenchmark.com/EFps/,1660-Ti,,_,5700-XT,,_G,,9400F,', t: 'G 5700-XT vs 1660-Ti - 9400F', p: '137 vs 108' }]`;
    const r = extractEfpsRecords(src, { gameId: '1', gameName: 'G' });
    assert.equal(r.stats.accepted, 1, 'the comparison must be kept');
    assert.equal(r.stats.comparisons, 1);
    assert.equal(r.stats.rejected, 0);
    assert.equal(r.records[0].sides[0].fps, 137);
    assert.equal(r.records[0].sides[1].fps, 108);
  });

  it('keeps the full 173 comparisons from the real source, not just the 27 direct', () => {
    assert.equal(efps.stats.comparisons, 173, 'regression: comparisons were being dropped');
    assert.equal(efps.stats.accepted, 200, 'all 200 records, not 27');
  });
});
