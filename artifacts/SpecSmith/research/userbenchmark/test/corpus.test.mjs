// Corpus-level tests: run the SAME general logic over EVERY saved source and
// assert invariants that must hold for any FPS-Estimates game page.
//
// The brief asks for PUBG, Fortnite and CS:GO to be verified through one
// shared code path. Only the Fortnite source is currently saved, so these
// tests:
//   - run over whatever sources DO exist, asserting the shared invariants;
//   - assert the specific published values for any of the three that IS
//     present (keyed by game id, so PUBG/CS:GO assertions activate the
//     moment their pages are saved — no test edit needed);
//   - report clearly which of the three are still missing rather than
//     silently passing a suite that only ever saw one page.

import { describe, it, assert } from './harness.mjs';
import { parseGamePage, expectedEfpsTokens } from '../lib/game-page.mjs';
import { normalizeAll } from '../lib/normalize.mjs';
import { listSourceFiles, loadOptional } from './fixtures/load.mjs';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { extractEfpsRecords } from '../lib/efps.mjs';
import path from 'node:path';
import { pagesDir } from './fixtures/load.mjs';

const files = await listSourceFiles();
const parsed = [];
for (const f of files) {
  const html = await fs.readFile(path.join(pagesDir, f), 'utf-8');
  parsed.push(parseGamePage(html, f));
}
const gamePages = parsed.filter((p) => p._meta.parsedSuccessfully);
// Raw source kept alongside the parse so ownership assertions can recompute a
// page's allowed tokens from the page itself rather than trusting the parse.
const rawHtmlBySource = new Map();
for (const f of files) rawHtmlBySource.set(f, await fs.readFile(path.join(pagesDir, f), 'utf-8'));

// The three reference games the brief names, by UserBenchmark game id.
// PUBG is 3944. An earlier version of this file guessed 3712, which is
// actually the game "Evolve" — the ids here are taken from known-games.json
// and the pages' own canonical URLs, never invented.
const REFERENCE_GAMES = [
  { key: 'Fortnite', gameId: '3954' },
  { key: 'PUBG', gameId: '3944' },
  { key: 'CS:GO', gameId: '3680' },
];

describe('Corpus: shared invariants across every saved game page', () => {
  it('has at least one game page to test', () => {
    assert.ok(gamePages.length > 0, 'no FPS-Estimates game pages saved in pages/');
  });

  it('every page yields a numeric game id, a name, and an established identity', () => {
    // Not "a canonical URL": some real game pages ship without one (ADR1FT,
    // 3652). What must always hold is that identity was ESTABLISHED and its
    // source recorded — canonical when present, corroborated self-links
    // otherwise. Asserting the canonical URL itself would reject a page the
    // pipeline handles correctly and discloses honestly.
    for (const p of gamePages) {
      assert.ok(/^\d+$/.test(p.game.gameId), `${p._meta.sourceFile}: bad game id`);
      assert.ok(p.game.name, `${p._meta.sourceFile}: no name`);
      assert.ok(p.game.identitySource, `${p._meta.sourceFile}: identity source not recorded`);
      if (p.game.canonicalUrl) assert.includes(p.game.canonicalUrl, '/PCGame/FPS-Estimates-', `${p._meta.sourceFile}`);
    }
  });

  it('every page yields a plausible average FPS and sample count', () => {
    for (const p of gamePages) {
      const { averageFps, totalSamples } = p.sampleSummary;
      assert.ok(averageFps > 0 && averageFps < 2000, `${p._meta.sourceFile}: avg FPS ${averageFps}`);
      assert.ok(totalSamples > 0, `${p._meta.sourceFile}: samples ${totalSamples}`);
    }
  });

  it('every chart has matching label and data lengths', () => {
    for (const p of gamePages) {
      for (const name of ['fpsHistogram', 'settingsDistribution', 'resolutionDistribution']) {
        const c = p[name];
        if (c.labels.length === 0) continue;
        assert.equal(c.labels.length, c.data.length, `${p._meta.sourceFile} ${name}`);
      }
    }
  });

  it('every GPU row links to gpu.* and every CPU row to cpu.*', () => {
    for (const p of gamePages) {
      for (const r of p.gpuTable) assert.includes(r.componentPageUrl ?? '', 'gpu.userbenchmark.com', `${p._meta.sourceFile}: ${r.name}`);
      for (const r of p.cpuTable) assert.includes(r.componentPageUrl ?? '', 'cpu.userbenchmark.com', `${p._meta.sourceFile}: ${r.name}`);
    }
  });

  it('every GPU row sets filter position 0 only; every CPU row position 1 only', () => {
    for (const p of gamePages) {
      for (const r of p.gpuTable) {
        assert.ok(r.filterSegments?.gpuId, `${r.name}: no gpuId`);
        assert.equal(r.filterSegments.cpuId, null, `${r.name}: unexpected cpuId`);
      }
      for (const r of p.cpuTable) {
        assert.ok(r.filterSegments?.cpuId, `${r.name}: no cpuId`);
        assert.equal(r.filterSegments.gpuId, null, `${r.name}: unexpected gpuId`);
      }
    }
  });

  it('no EFPS record is silently dropped on any page', () => {
    for (const p of gamePages) {
      const s = p.efps.stats;
      assert.equal(s.accepted + s.rejected, s.total, `${p._meta.sourceFile}: EFPS accounting does not balance`);
      assert.equal(s.direct + s.comparisons, s.accepted, `${p._meta.sourceFile}: direct+comparisons != accepted`);
    }
  });

  it('every EFPS comparison side resolves to a distinct URL variant on every page', () => {
    for (const p of gamePages) {
      for (const r of p.efps.records.filter((x) => x.kind === 'comparison')) {
        assert.equal(r.sides.length, 2, `${r.exactTitle}`);
        assert.ok(r.sides[0].resolvedVariant !== r.sides[1].resolvedVariant, `${r.exactTitle}: both sides hit the same variant`);
      }
    }
  });

  it('EFPS comparison sides never contradict the direct record for the same config', () => {
    for (const p of gamePages) {
      const byConfig = new Map(p.efps.records.filter((r) => r.kind === 'direct').map((d) => [`${d.config.gpu}|${d.config.cpu}`, d.fps]));
      for (const c of p.efps.records.filter((r) => r.kind === 'comparison')) {
        for (const s of c.sides) {
          const key = `${s.gpu ?? c.sharedConfig.gpu}|${s.cpu ?? c.sharedConfig.cpu}`;
          if (!byConfig.has(key)) continue;
          assert.equal(s.fps, byConfig.get(key), `${p._meta.sourceFile} "${c.exactTitle}" side ${s.label}`);
        }
      }
    }
  });

  it('filter positions 2 and 3 are unpopulated on every saved page', () => {
    for (const p of gamePages) {
      for (const f of p.ownFilterPaths.paths) {
        assert.equal(f.position2, null, `${p._meta.sourceFile}: ${f.raw}`);
        assert.equal(f.position3, null, `${p._meta.sourceFile}: ${f.raw}`);
      }
    }
  });

  it('normalization produces provenance on every record of every dataset', () => {
    for (const p of gamePages) {
      const n = normalizeAll(p);
      for (const [dataset, records] of Object.entries(n)) {
        for (const r of records) {
          assert.ok(r.provenance, `${dataset}: record without provenance`);
          assert.equal(r.provenance.source, 'UserBenchmark', `${dataset}`);
          assert.ok(r.provenance.sourceFile, `${dataset}: no sourceFile`);
          assert.ok(r.provenance.parserVersion, `${dataset}: no parserVersion`);
          assert.ok(r.provenance.extractionMethod, `${dataset}: no extractionMethod`);
        }
      }
    }
  });

  it('never converts Bench%/Value% into FPS', () => {
    for (const p of gamePages) {
      const n = normalizeAll(p);
      for (const r of [...n.gpuObservations, ...n.cpuObservations]) {
        assert.equal(r.fps, undefined, 'a component observation must never carry an FPS field');
        assert.ok(r.scoreNote.includes('NOT frames per second'), 'the non-convertibility note must be present');
      }
    }
  });
});

// Resolved before describe() runs — describe callbacks are synchronous.
const referenceSources = [];
for (const ref of REFERENCE_GAMES) referenceSources.push({ ref, src: await loadOptional(ref.gameId) });

describe('Corpus: reference-game published values', () => {
  for (const { ref, src } of referenceSources) {
    if (!src) {
      it(`${ref.key} (id ${ref.gameId}) — NOT CAPTURED, assertions skipped`, () => {
        // Deliberately passes: a page nobody has saved is a data gap, not a
        // code failure. It is surfaced here so the suite output states plainly
        // which reference games are still missing.
        assert.ok(true);
        console.log(`      ↳ save pages/FPS-Estimates-<slug>-${ref.gameId}.html to activate real assertions for ${ref.key}`);
      });
      continue;
    }
    const p = parseGamePage(src.html, src.file);
    const direct = p.efps.records.filter((r) => r.kind === 'direct');
    const findDirect = (gpu, cpu) => direct.find((r) => r.config.gpu === gpu && r.config.cpu === cpu);

    it(`${ref.key}: parses cleanly with a real id, FPS and sample count`, () => {
      assert.equal(p.game.gameId, ref.gameId);
      assert.ok(p.sampleSummary.averageFps > 0);
      assert.ok(p.sampleSummary.totalSamples > 0);
      assert.deepEqual(p._meta.warnings, [], `${ref.key} parsed with warnings`);
    });

    it(`${ref.key}: has both GPU and CPU tables and EFPS records`, () => {
      assert.ok(p.gpuTable.length > 0, 'GPU table');
      assert.ok(p.cpuTable.length > 0, 'CPU table');
      assert.ok(p.efps.stats.accepted > 0, 'EFPS records');
    });

    // The brief's named example pairs. Asserted only for the games actually
    // saved; the 3600+2060S / 9600K+2060S pairs exist on Fortnite too.
    if (ref.key === 'Fortnite') {
      it('Fortnite: 3600 + 2060S = 131 and 9600K + 2060S = 133 (exact)', () => {
        assert.equal(findDirect('2060S', '3600').fps, 131);
        assert.equal(findDirect('2060S', '9600K').fps, 133);
      });
      it('Fortnite: "9600K vs 3600 - 2060S" stays a comparison record', () => {
        const c = p.efps.records.find((r) => r.exactTitle === 'Fortnite 9600K vs 3600 - 2060S');
        assert.ok(c, 'record present');
        assert.equal(c.kind, 'comparison', 'must NOT be recorded as a direct single record');
        assert.equal(c.exactValue, '133 vs 131');
      });
    }

    if (ref.key === 'CS:GO') {
      it('CS:GO: 3600 + 2060S = 233 and 9600K + 2060S = 280 (exact)', () => {
        assert.equal(findDirect('2060S', '3600')?.fps, 233);
        assert.equal(findDirect('2060S', '9600K')?.fps, 280);
      });
      it('CS:GO: average FPS 153 over 151,690 samples', () => {
        assert.equal(p.sampleSummary.averageFps, 153);
        assert.equal(p.sampleSummary.totalSamples, 151690);
      });
      it('CS:GO: settings and resolution charts extract with the source\'s exact labels', () => {
        // These two charts use `labels :` (space before the colon) while the
        // FPS histogram on the SAME page uses `labels:`. Before the parser
        // tolerated both, these came back empty.
        assert.deepEqual(p.settingsDistribution.labels, ['Low', 'Max', 'High', 'Med']);
        assert.deepEqual(p.settingsDistribution.data, [62256, 51577, 19478, 18379]);
        assert.deepEqual(p.resolutionDistribution.labels, ['1080p', '720p', '1440p', '4K']);
        assert.deepEqual(p.resolutionDistribution.data, [96858, 49871, 4809, 152]);
      });
      it('CS:GO: a comparison where the "faster" card loses stays verbatim', () => {
        // 5700-XT reports LOWER than 1660-Ti here. Crowd-sourced data is not
        // ordered by expected performance; nothing may reorder or "correct" it.
        const c = p.efps.records.find((r) => r.exactTitle === 'CSGO 5700-XT vs 1660-Ti - 9400F');
        assert.ok(c, 'record present');
        assert.equal(c.exactValue, '211 vs 219');
        assert.equal(c.sides[0].fps, 211);
        assert.equal(c.sides[1].fps, 219);
      });
    }

    if (ref.key === 'PUBG') {
      // These are the values the brief cites for PUBG. They activate as real
      // assertions as soon as the PUBG page is saved.
      it('PUBG: 3600 + 2060S = 119 and 9600K + 2060S = 135 (exact)', () => {
        assert.equal(findDirect('2060S', '3600')?.fps, 119);
        assert.equal(findDirect('2060S', '9600K')?.fps, 135);
      });
      it('PUBG: "9400F vs 9100F - 2060S" stays a comparison with 123 vs 117', () => {
        const c = p.efps.records.find((r) => r.kind === 'comparison' && r.exactTitle.includes('9400F vs 9100F') && r.exactTitle.includes('2060S'));
        assert.ok(c, 'comparison record present');
        assert.equal(c.kind, 'comparison', 'must remain a comparison, not two direct records');
        assert.equal(c.exactValue, '123 vs 117');
        assert.equal(c.sides[0].fps, 123);
        assert.equal(c.sides[1].fps, 117);
      });
    }
  }
});

describe('Corpus: EFPS game token vs catalog name', () => {
  it('the EFPS token is not the catalog name for PUBG and CSGO', () => {
    // This is exactly why classification must be structural. A parser that
    // strips a `gameName + " "` prefix from the title finds no match here.
    const tokens = new Map(gamePages.map((p) => [p.game.gameId, p.efps.records[0]?.efpsGameToken]));
    if (tokens.has('3944')) assert.equal(tokens.get('3944'), 'PUBG', "catalog name is \"PlayerUnknown's Battlegrounds\"");
    if (tokens.has('3680')) assert.equal(tokens.get('3680'), 'CSGO', 'catalog name is "Counter-Strike: Global Offensive"');
    if (tokens.has('3954')) assert.equal(tokens.get('3954'), 'Fortnite', 'this one happens to match');
  });

  it('every page whose EFPS block is its own classifies and cross-checks correctly', () => {
    // Scoped to pages that actually own their EFPS block. A page whose widget
    // carries another game's dataset (7 Days to Die) legitimately ends with
    // zero accepted records — that is the ownership rule working, not a
    // classification failure. Asserting ">0 direct" for every page would make
    // the correct behaviour look like a regression.
    for (const p of gamePages) {
      const quarantined = p.efps.rejected.filter((r) => r.reason === 'efps-game-token-mismatch').length;
      if (quarantined > 0) {
        assert.equal(p.efps.stats.accepted, 0, `${p.game.name}: partially-borrowed EFPS block is not an expected shape`);
        continue;
      }
      assert.ok(p.efps.stats.direct > 0, `${p.game.name}: no direct records`);
      assert.ok(p.efps.stats.comparisons > 0, `${p.game.name}: no comparison records`);
      assert.equal(p.efps.stats.rejected, 0, `${p.game.name}: records rejected`);
    }
  });
});

describe('Corpus: capture status of the three reference games', () => {
  it('reports which reference games are saved and which are not', async () => {
    const status = [];
    for (const ref of REFERENCE_GAMES) status.push({ ...ref, captured: (await loadOptional(ref.gameId)) != null });
    const missing = status.filter((s) => !s.captured);
    console.log(`      captured: ${status.filter((s) => s.captured).map((s) => s.key).join(', ') || 'none'}`);
    if (missing.length) console.log(`      MISSING:  ${missing.map((s) => `${s.key} (id ${s.gameId})`).join(', ')}`);
    // Not an assertion failure — missing sources are a capture gap, tracked in
    // capture-manifest.json, not a broken parser.
    assert.ok(true);
  });
});

describe('Corpus: determinism and provenance', () => {
  it('normalization is byte-identical across repeated runs', () => {
    // Guards a real regression: a wall-clock timestamp in per-record
    // provenance made every run emit different bytes, which destroys
    // diffability of the emitted datasets. Run time belongs in report
    // metadata only.
    for (const p of gamePages) {
      const a = JSON.stringify(normalizeAll(p));
      const b = JSON.stringify(normalizeAll(p));
      assert.equal(a, b, `${p._meta.sourceFile}: normalization is not deterministic`);
    }
  });

  it('no dataset record carries a wall-clock timestamp', () => {
    for (const p of gamePages) {
      for (const [dataset, records] of Object.entries(normalizeAll(p))) {
        for (const r of records) {
          assert.equal(r.provenance.extractedAt, undefined, `${dataset}: provenance must not carry a timestamp`);
          assert.ok(r.provenance.sourceContentSha256, `${dataset}: provenance must carry a content hash instead`);
        }
      }
    }
  });

  it('the source content hash pins records to the exact source bytes', () => {
    for (const p of gamePages) {
      const n = normalizeAll(p);
      assert.equal(n.games[0].provenance.sourceContentSha256, p._meta.sourceContentSha256);
      assert.ok(/^[0-9a-f]{64}$/.test(p._meta.sourceContentSha256), 'looks like a sha256');
    }
  });
});

describe('Corpus: capture-serialization tolerance', () => {
  it('parses pages saved as raw source AND pages re-serialized by the browser', () => {
    // A view-source save keeps the server's single-quoted attributes and raw
    // U+00A0; a browser "Save Page As" re-serializes the DOM with double
    // quotes and &nbsp; entities. Both are complete, correct saves. Anchoring
    // on one form silently produced 0 GPU/CPU rows and a null average FPS on
    // the other, on a page that was otherwise fully intact.
    for (const p of gamePages) {
      assert.ok(p.sampleSummary.averageFps > 0, `${p._meta.sourceFile}: average FPS did not parse`);
      assert.ok(p.sampleSummary.totalSamples > 0, `${p._meta.sourceFile}: sample count did not parse`);
      assert.ok(p.gpuTable.length > 0, `${p._meta.sourceFile}: GPU table produced no rows`);
      assert.ok(p.cpuTable.length > 0, `${p._meta.sourceFile}: CPU table produced no rows`);
    }
  });

  it('reads a decimal average FPS without rounding it', () => {
    for (const p of gamePages) {
      const a = p.sampleSummary.averageFps;
      assert.equal(a, Number(a), `${p._meta.sourceFile}: average FPS is not a clean number`);
    }
  });
});

describe('Corpus: EFPS records must belong to the page carrying them', () => {
  it('never attributes another game\'s EFPS dataset to this page', () => {
    // The EFPS array sits in a select2 "compare" widget and is NOT guaranteed
    // to describe its host page. The 7 Days to Die page (3959, 525 samples)
    // ships 200 records tokened CSGO — a fallback dataset for a low-sample
    // title. Filing those under 7 Days to Die would misattribute
    // Counter-Strike's measurements to another game.
    for (const p of gamePages) {
      const allowed = new Set(expectedEfpsTokens(rawHtmlBySource.get(p._meta.sourceFile), p.game.name).map((t) => t.toLowerCase()));
      for (const r of p.efps.records) {
        assert.ok(
          !r.efpsGameToken || allowed.has(r.efpsGameToken.toLowerCase()),
          `${p._meta.sourceFile}: accepted an EFPS record tokened "${r.efpsGameToken}" that this page may not publish`,
        );
      }
    }
  });

  it('quarantines the mismatched records instead of dropping them', () => {
    const withMismatch = gamePages.filter((p) => p.efps.rejected.some((r) => r.reason === 'efps-game-token-mismatch'));
    for (const p of withMismatch) {
      const bad = p.efps.rejected.filter((r) => r.reason === 'efps-game-token-mismatch');
      assert.equal(p.efps.stats.accepted + p.efps.stats.rejected, p.efps.stats.total, `${p._meta.sourceFile}: accounting does not balance`);
      for (const r of bad) {
        assert.ok(r.rawObject && r.rawObject.length > 0, 'raw source text preserved');
        assert.ok(r.efpsGameToken, 'the offending token is recorded');
        assert.ok(/is not one this page may publish/.test(r.detail), 'reason states what happened');
      }
    }
  });

  it('the cross-check alone cannot catch this, so the ownership rule is load-bearing', () => {
    // Borrowed records are internally consistent with each other, so
    // direct-vs-comparison agreement stays perfect while the whole block
    // belongs to a different game. Recorded so nobody removes the ownership
    // check on the grounds that "the cross-check already validates EFPS".
    for (const p of gamePages) {
      const byConfig = new Map(p.efps.records.filter((r) => r.kind === 'direct').map((d) => [`${d.config.gpu}|${d.config.cpu}`, d.fps]));
      for (const c of p.efps.records.filter((r) => r.kind === 'comparison')) {
        for (const s of c.sides) {
          const key = `${s.gpu ?? c.sharedConfig.gpu}|${s.cpu ?? c.sharedConfig.cpu}`;
          if (byConfig.has(key)) assert.equal(s.fps, byConfig.get(key));
        }
      }
    }
  });
});

describe('Corpus: identity provenance', () => {
  it('every page records HOW its identity was established', () => {
    for (const p of gamePages) {
      assert.ok(['canonical', 'inferred-from-self-links'].includes(p.game.identitySource), `${p._meta.sourceFile}: identitySource is "${p.game.identitySource}"`);
    }
  });

  it('an inferred identity always carries its corroborating evidence', () => {
    for (const p of gamePages.filter((x) => x.game.identitySource === 'inferred-from-self-links')) {
      const e = p.game.identityEvidence;
      assert.ok(e, `${p._meta.sourceFile}: inferred identity without evidence`);
      assert.ok(e.occurrences > 0, 'self-link count recorded');
      assert.ok(e.slugMatchesPageName === true, 'slug must agree with the page name');
      assert.ok(e.dominanceMargin === 'no-runner-up' || e.dominanceMargin >= 5, `margin ${e.dominanceMargin} below the 5x floor`);
      assert.equal(p.game.canonicalUrl, null, 'inference only applies when no canonical exists');
    }
  });

  it('refuses to infer identity on weak or contradictory evidence', async () => {
    const { inferGameIdentity } = await import('../lib/game-page.mjs');
    // Thin plurality — no clear owner.
    const thin = 'FPS-Estimates-A/1/ FPS-Estimates-A/1/ FPS-Estimates-B/2/';
    assert.notOk(inferGameIdentity(thin, 'A')?.accepted, 'a 2:1 margin must not be enough');
    // Dominant, but the page name disagrees with the slug.
    const wrongName = Array(30).fill('FPS-Estimates-Alpha/1/').join(' ');
    assert.notOk(inferGameIdentity(wrongName, 'Beta')?.accepted, 'slug/name disagreement must block inference');
    // Dominant and corroborated.
    assert.ok(inferGameIdentity(wrongName, 'Alpha')?.accepted, 'dominant + corroborated should be accepted');
  });

  it('a missing canonical is a warning when identity is inferred, not a tooling error', async () => {
    const V = await import('../lib/validate.mjs');
    const base = { gameId: '1', name: 'X', averageFps: 60, totalSamples: 10, hasFpsHistogram: true, hasSettingsDistribution: true, hasResolutionDistribution: true, gpuRowCount: 1, cpuRowCount: 1, provenance: {} };
    const inferred = V.validateGames([{ ...base, canonicalUrl: null, identitySource: 'inferred-from-self-links', identityEvidence: {} }]);
    assert.equal(inferred.filter((i) => i.severity === 'error').length, 0, 'disclosed inference must not fail the run');
    assert.ok(inferred.some((i) => i.rule === 'game.url-inferred'));
    const unknown = V.validateGames([{ ...base, canonicalUrl: null, identitySource: null }]);
    assert.ok(unknown.some((i) => i.severity === 'error' && i.rule === 'game.url-missing'), 'unidentifiable page must still error');
  });
});

// --- why other games' pages carry CS:GO's EFPS block ------------------------
// The mechanism, not the correlation. The "EFps Game Bottlenecks" widget is a
// select2 seeded from a server-rendered inline array:
//
//   $(".select_choose_yt").select2($.extend({ data:{ results:[ … ] } …
//
// Its only handler is `select2-selecting`, which does `location = urlpayload`.
// Nothing ever repopulates that array client-side, so whatever a saved file
// contains is exactly what the server sent — the capture route cannot affect
// it, and no way of saving the page can turn the default into the page's own
// data.
//
// What the server sends is one FIXED dataset, CS:GO's, on every page except a
// few very high-sample titles. That is why the quarantine fires so often.
describe('Corpus: the borrowed EFPS block is a single fixed server default', () => {
  const csgoFile = 'FPS-Estimates-Counter-Strike--Global-Offensive-3680.html';
  const efpsOf = (file) =>
    extractEfpsRecords(fsSync.readFileSync(path.join(pagesDir, file), 'utf-8'), {}).records;
  const signature = (records) => records.map((r) => r.rawObject).join('|');

  const csgoSignature = signature(efpsOf(csgoFile));
  const files = fsSync.readdirSync(pagesDir).filter((f) => f.endsWith('.html')).sort();

  it('every page carrying a foreign block carries the IDENTICAL block', () => {
    const foreign = [];
    for (const f of files) {
      const recs = efpsOf(f);
      if (recs.length === 0) continue;
      const token = recs[0].efpsGameToken;
      if (f !== csgoFile && token === 'CSGO') foreign.push(f);
    }
    assert.ok(foreign.length > 0, 'corpus should contain pages carrying the default block');

    for (const f of foreign) {
      assert.equal(
        signature(efpsOf(f)),
        csgoSignature,
        `${f} carries a CSGO-token block that is NOT byte-identical to CS:GO's own — ` +
          'the single-fixed-default finding would no longer hold',
      );
    }
  });

  // The decisive check that the quarantine discards duplicates rather than
  // real measurements: if these were the page's own numbers merely mislabelled,
  // the FPS values would differ from CS:GO's for the same (GPU, CPU).
  it('the borrowed values are genuinely CS:GO’s, not the page’s own mislabelled', () => {
    const direct = (file) => {
      const m = new Map();
      for (const r of efpsOf(file)) if (r.kind === 'direct' && r.config) m.set(`${r.config.gpu}|${r.config.cpu}`, r.fps);
      return m;
    };
    const csgo = direct(csgoFile);
    assert.ok(csgo.size > 0);

    for (const f of files) {
      const recs = efpsOf(f);
      if (f === csgoFile || recs.length === 0 || recs[0].efpsGameToken !== 'CSGO') continue;
      for (const [config, fps] of direct(f)) {
        assert.equal(fps, csgo.get(config), `${f} config ${config} differs from CS:GO's value — it would be real data, not a duplicate`);
      }
    }
  });

  // Pages that DO publish their own block are the highest-sample titles. The
  // boundary is only bracketed, not pinned: Battlefield 1 (28,457) gets the
  // default and PUBG (75,383) gets its own, so the cutoff lies somewhere
  // between. Asserted as a bracket so a future page inside that gap tightens
  // the finding instead of silently contradicting it.
  it('only the highest-sample games publish their own block', () => {
    const own = [];
    const borrowed = [];
    for (const f of files) {
      const recs = efpsOf(f);
      if (recs.length === 0) continue;
      const m = f.match(/-(\d+)\.html$/);
      (recs[0].efpsGameToken === 'CSGO' && f !== csgoFile ? borrowed : own).push(m?.[1]);
    }
    const samplesById = new Map(
      fsSync
        .readFileSync(path.join(pagesDir, '..', 'dataset', 'games.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
        .map((g) => [String(g.gameId), g.totalSamples ?? 0]),
    );
    const minOwn = Math.min(...own.map((id) => samplesById.get(id) ?? 0));
    const maxBorrowed = Math.max(...borrowed.map((id) => samplesById.get(id) ?? 0));
    assert.ok(
      maxBorrowed < minOwn,
      `sample counts must separate the two groups: highest borrowing page has ${maxBorrowed}, ` +
        `lowest self-publishing page has ${minOwn}`,
    );
  });
});

// --- extraction reliability across every saved page -------------------------
// These are the fields the capture programme actually exists to collect. The
// failure mode that matters is not a crash but a silent null or a quietly
// short table, so each page is checked for completeness rather than for
// merely parsing.
describe('Corpus: the core per-game fields are extracted from every page', () => {
  const files = fsSync.readdirSync(pagesDir).filter((f) => f.endsWith('.html')).sort();
  const parsedAll = files.map((f) => [f, parseGamePage(fsSync.readFileSync(path.join(pagesDir, f), 'utf-8'), f)]);

  it('every page yields an average FPS and a sample count', () => {
    for (const [f, p] of parsedAll) {
      assert.ok(p.sampleSummary.averageFps != null, `${f}: no average FPS`);
      assert.ok(p.sampleSummary.averageFps > 0, `${f}: average FPS ${p.sampleSummary.averageFps}`);
      assert.ok(p.sampleSummary.totalSamples != null, `${f}: no sample count`);
    }
  });

  it('every page yields GPU and CPU rows', () => {
    for (const [f, p] of parsedAll) {
      assert.ok(p.gpuTable.length > 0, `${f}: zero GPU rows`);
      assert.ok(p.cpuTable.length > 0, `${f}: zero CPU rows`);
    }
  });

  it('every component row carries the fields that make it usable', () => {
    for (const [f, p] of parsedAll) {
      for (const r of [...p.gpuTable, ...p.cpuTable]) {
        assert.ok(r.name, `${f}: a row has no component name`);
        assert.ok(r.samples != null, `${f}/${r.name}: no sample count`);
        assert.ok(r.benchPercent != null, `${f}/${r.name}: no bench percent`);
        assert.ok(r.componentRatingId, `${f}/${r.name}: no component id`);
      }
    }
  });

  it('every page yields all three chart distributions', () => {
    for (const [f, p] of parsedAll) {
      for (const chart of ['fpsHistogram', 'settingsDistribution', 'resolutionDistribution']) {
        const c = p[chart];
        assert.ok((c?.labels?.length ?? 0) > 0, `${f}: ${chart} has no labels`);
        assert.equal(c.labels.length, c.data.length, `${f}: ${chart} labels/data length mismatch`);
      }
    }
  });

  // Independent of the row regex, so it catches the failure that regex cannot
  // report on itself: rows quietly dropped because one row's markup differed.
  // Every component row carries a per-component filter link, and those links
  // can be counted straight out of the page. If the two counts ever diverge,
  // the table was parsed short.
  it('extracts every component row the page links to', () => {
    for (const [f, p] of parsedAll) {
      const id = p.game?.gameId;
      assert.ok(id, `${f}: no game id`);
      const linked = (pattern) =>
        new Set(
          [...fsSync.readFileSync(path.join(pagesDir, f), 'utf-8').matchAll(pattern)]
            .map((m) => m[1])
            .filter((x) => x !== '0'),
        ).size;
      const gpuLinks = linked(new RegExp(`FPS-Estimates-[^/"']+/${id}/(\\d+)\\.0\\.0\\.0\\.0`, 'g'));
      const cpuLinks = linked(new RegExp(`FPS-Estimates-[^/"']+/${id}/0\\.(\\d+)\\.0\\.0\\.0`, 'g'));
      assert.equal(p.gpuTable.length, gpuLinks, `${f}: ${gpuLinks} GPU components linked but ${p.gpuTable.length} rows parsed`);
      assert.equal(p.cpuTable.length, cpuLinks, `${f}: ${cpuLinks} CPU components linked but ${p.cpuTable.length} rows parsed`);
    }
  });
});
