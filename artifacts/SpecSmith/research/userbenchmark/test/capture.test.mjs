// Capture-manifest tests. The critical property: an uncaptured page must
// NEVER be reported as collected.

import { describe, it, assert } from './harness.mjs';
import { buildCaptureManifest, expectedFilename, checkCatalogUrl } from '../lib/capture.mjs';

const known = [
  { gameId: '3954', name: 'Fortnite', url: 'https://www.userbenchmark.com/PCGame/FPS-Estimates-Fortnite/3954/0.0.0.0.0' },
  { gameId: '3680', name: 'Counter-Strike: Global Offensive', url: 'https://www.userbenchmark.com/PCGame/FPS-Estimates-Counter-Strike--Global-Offensive/3680/0.0.0.0.0' },
  { gameId: '3664', name: 'Battlefield 1', url: 'https://www.userbenchmark.com/PCGame/FPS-Estimates-Battlefield-1/3664/0.0.0.0.0' },
];

const parsedFortnite = {
  _meta: { sourceFile: 'FPS-Estimates-Fortnite-3954.html', parsedSuccessfully: true, parsedAt: '2026-01-01T00:00:00.000Z', warnings: [] },
  game: { gameId: '3954', name: 'Fortnite' },
  sampleSummary: { averageFps: 96, totalSamples: 87737 },
  gpuTable: new Array(20).fill({}),
  cpuTable: new Array(20).fill({}),
  efps: { stats: { accepted: 200, direct: 27, comparisons: 173 } },
};

describe('Capture: manifest honesty', () => {
  const m = buildCaptureManifest(known, [parsedFortnite], ['FPS-Estimates-Fortnite-3954.html']);

  it('covers every known game', () => {
    assert.equal(m.rows.length, 3);
    assert.equal(m.summary.totalKnownGames, 3);
  });

  it('marks only the genuinely saved game as captured', () => {
    assert.equal(m.summary.captured, 1);
    assert.equal(m.summary.notCaptured, 2);
    const fn = m.rows.find((r) => r.gameId === '3954');
    const csgo = m.rows.find((r) => r.gameId === '3680');
    assert.ok(fn.captured, 'Fortnite has a saved source');
    assert.notOk(csgo.captured, 'CS:GO must NOT be reported as captured');
  });

  it('never reports data for an uncaptured game', () => {
    const csgo = m.rows.find((r) => r.gameId === '3680');
    assert.equal(csgo.sourceFile, null);
    assert.equal(csgo.averageFps, null);
    assert.equal(csgo.efpsCount, 0);
    assert.equal(csgo.lastProcessedAt, null);
    assert.notOk(csgo.parsed);
  });

  it('carries real extracted counts for the captured game', () => {
    const fn = m.rows.find((r) => r.gameId === '3954');
    assert.equal(fn.efpsCount, 200);
    assert.equal(fn.efpsDirectCount, 27);
    assert.equal(fn.efpsComparisonCount, 173);
    assert.equal(fn.gpuRowCount, 20);
    assert.equal(fn.averageFps, 96);
    assert.ok(fn.parsed);
  });

  it('computes capture percentage from real captures only', () => {
    assert.equal(m.summary.capturePercent, 33.33);
  });

  it('tells the user exactly what filename to save each missing page as', () => {
    for (const r of m.rows.filter((x) => !x.captured)) {
      assert.ok(r.expectedFilename.endsWith(`-${r.gameId}.html`), `${r.name}: filename must encode the game id`);
      assert.ok(r.url.includes(r.gameId), 'the exact URL to visit is present');
    }
  });
});

describe('Capture: captured vs parsed are tracked separately', () => {
  it('counts a saved-but-unparseable file as captured, not parsed', () => {
    const brokenParse = { _meta: { sourceFile: 'FPS-Estimates-Battlefield-1-3664.html', parsedSuccessfully: false, sourceKind: { kind: 'unknown' } }, game: null };
    const m = buildCaptureManifest(known, [parsedFortnite, brokenParse], ['FPS-Estimates-Fortnite-3954.html', 'FPS-Estimates-Battlefield-1-3664.html']);
    const bf = m.rows.find((r) => r.gameId === '3664');
    assert.ok(bf.captured, 'the file exists on disk');
    assert.notOk(bf.parsed, 'but it did not parse');
    assert.equal(m.summary.capturedButNotParsed, 1, 'this gap must be visible, not hidden');
  });
});

describe('Capture: unlisted games', () => {
  it('flags a saved game that is not in the known catalog', () => {
    const stranger = {
      _meta: { sourceFile: 'FPS-Estimates-Mystery-9999.html', parsedSuccessfully: true, parsedAt: 'x', warnings: [] },
      game: { gameId: '9999', name: 'Mystery' },
      sampleSummary: {},
      gpuTable: [],
      cpuTable: [],
      efps: { stats: { accepted: 0, direct: 0, comparisons: 0 } },
    };
    const m = buildCaptureManifest(known, [stranger], ['FPS-Estimates-Mystery-9999.html']);
    assert.equal(m.unlisted.length, 1);
    assert.equal(m.unlisted[0].gameId, '9999');
  });
});

describe('Capture: filename convention', () => {
  it('builds a deterministic filename from slug and id', () => {
    assert.equal(expectedFilename({ gameId: '3954', slug: 'Fortnite', name: 'Fortnite' }), 'FPS-Estimates-Fortnite-3954.html');
  });
  it('sanitizes punctuation in the game name', () => {
    const f = expectedFilename({ gameId: '3680', slug: null, name: 'Counter-Strike: Global Offensive' });
    assert.equal(f, 'FPS-Estimates-Counter-Strike-Global-Offensive-3680.html');
    assert.notOk(/[^A-Za-z0-9.\-]/.test(f), 'no characters that are awkward in a filename');
  });
  it('is stable across repeated calls', () => {
    const g = { gameId: '1', slug: 'X', name: 'X' };
    assert.equal(expectedFilename(g), expectedFilename(g));
  });
});

describe('Capture: catalog URL checking', () => {
  it('accepts a canonical unfiltered game URL', () => {
    const r = checkCatalogUrl('https://www.userbenchmark.com/PCGame/FPS-Estimates-Fortnite/3954/0.0.0.0.0');
    assert.ok(r.ok);
    assert.equal(r.gameId, '3954');
  });
  it('rejects a URL that carries an active filter', () => {
    const r = checkCatalogUrl('https://www.userbenchmark.com/PCGame/FPS-Estimates-Fortnite/3954/153864.0.0.0.0');
    assert.notOk(r.ok, 'a filtered URL is not the page to capture');
    assert.includes(r.reason, 'filter');
  });
  it('rejects a non-game URL', () => {
    assert.notOk(checkCatalogUrl('https://www.userbenchmark.com/Search?searchTerm=FPS').ok);
    assert.notOk(checkCatalogUrl(null).ok);
  });
});
