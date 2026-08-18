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
import { parseGamePage } from '../lib/game-page.mjs';
import { normalizeAll } from '../lib/normalize.mjs';
import { listSourceFiles, loadOptional } from './fixtures/load.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pagesDir } from './fixtures/load.mjs';

const files = await listSourceFiles();
const parsed = [];
for (const f of files) {
  const html = await fs.readFile(path.join(pagesDir, f), 'utf-8');
  parsed.push(parseGamePage(html, f));
}
const gamePages = parsed.filter((p) => p._meta.parsedSuccessfully);

// The three reference games the brief names, by UserBenchmark game id.
const REFERENCE_GAMES = [
  { key: 'Fortnite', gameId: '3954' },
  { key: 'PUBG', gameId: '3712' },
  { key: 'CS:GO', gameId: '3680' },
];

describe('Corpus: shared invariants across every saved game page', () => {
  it('has at least one game page to test', () => {
    assert.ok(gamePages.length > 0, 'no FPS-Estimates game pages saved in pages/');
  });

  it('every page yields a numeric game id, a name and a canonical URL', () => {
    for (const p of gamePages) {
      assert.ok(/^\d+$/.test(p.game.gameId), `${p._meta.sourceFile}: bad game id`);
      assert.ok(p.game.name, `${p._meta.sourceFile}: no name`);
      assert.includes(p.game.canonicalUrl, '/PCGame/FPS-Estimates-', `${p._meta.sourceFile}`);
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
