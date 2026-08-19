// Capture-manifest tests. The critical property: an uncaptured page must
// NEVER be reported as collected.

import { describe, it, assert } from './harness.mjs';
import { buildCaptureManifest, expectedFilename, checkCatalogUrl } from '../lib/capture.mjs';
import { classifyCapture, matchFilesToGames, scanPages } from '../capture/verify-capture.mjs';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pagesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pages');

const known = [
  { gameId: '3954', name: 'Fortnite', url: 'https://www.userbenchmark.com/PCGame/FPS-Estimates-Fortnite/3954/0.0.0.0.0' },
  { gameId: '3680', name: 'Counter-Strike: Global Offensive', url: 'https://www.userbenchmark.com/PCGame/FPS-Estimates-Counter-Strike--Global-Offensive/3680/0.0.0.0.0' },
  { gameId: '3664', name: 'Battlefield 1', url: 'https://www.userbenchmark.com/PCGame/FPS-Estimates-Battlefield-1/3664/0.0.0.0.0' },
];

const parsedFortnite = {
  _meta: { sourceFile: 'FPS-Estimates-Fortnite-3954.html', parsedSuccessfully: true, sourceContentSha256: 'a'.repeat(64), warnings: [] },
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
    assert.equal(csgo.sourceContentSha256, null);
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
      _meta: { sourceFile: 'FPS-Estimates-Mystery-9999.html', parsedSuccessfully: true, sourceContentSha256: 'b'.repeat(64), warnings: [] },
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

// --- verifier identity agreement -------------------------------------------
// The verifier once carried its own canonical-only identity regex, separate
// from the one the ingest uses. Real pages exist that ship no canonical <link>
// (ADR1FT 3652, AdVenture Capitalist 3654), and the pipeline ingests both
// cleanly via corroborated self-link inference. The verifier reported those
// same files as "not-a-page" — a false capture failure on data that was fine.
// These tests pin the two tools to one answer.
describe('verify-capture identity agrees with the ingest', () => {
  const noCanonical = path.join(pagesDir, 'FPS-Estimates-AdVenture-Capitalist-3654.html');
  const withCanonical = path.join(pagesDir, 'FPS-Estimates-Alien-Isolation-3656.html');

  it('accepts a page whose identity is inferred, and says so', () => {
    const html = fs.readFileSync(noCanonical, 'utf-8');
    assert.equal(/<link rel="canonical"/.test(html), false, 'fixture must genuinely lack a canonical link');

    const r = classifyCapture(html, { gameId: '3654', name: 'AdVenture Capitalist', expectedFilename: 'x.html' });
    assert.equal(r.status, 'captured');
    assert.equal(r.identitySource, 'inferred-from-self-links');
    assert.ok(/no canonical/i.test(r.detail), 'the weaker evidence must be disclosed in the report, not hidden');
  });

  it('still reports a canonical page as canonical', () => {
    const html = fs.readFileSync(withCanonical, 'utf-8');
    const r = classifyCapture(html, { gameId: '3656', name: 'Alien: Isolation', expectedFilename: 'x.html' });
    assert.equal(r.status, 'captured');
    assert.equal(r.identitySource, 'canonical');
  });

  // The whole point of checking identity is catching a mis-saved tab. Inferred
  // identity must not become a loophole that lets any page pass under any id.
  it('catches a wrong game even when identity had to be inferred', () => {
    const html = fs.readFileSync(noCanonical, 'utf-8');
    const r = classifyCapture(html, { gameId: '9999', name: 'Not This Game', expectedFilename: 'x.html' });
    assert.equal(r.status, 'wrong-game');
    assert.equal(r.actualGameId, '3654');
  });

  it('catches a wrong game on a canonical page', () => {
    const html = fs.readFileSync(withCanonical, 'utf-8');
    const r = classifyCapture(html, { gameId: '9999', name: 'Not This Game', expectedFilename: 'x.html' });
    assert.equal(r.status, 'wrong-game');
    assert.equal(r.actualGameId, '3656');
  });

  // A stripped save must still be caught — the identity change must not have
  // weakened the completeness checks that sit behind it.
  it('still reports a script-stripped save as incomplete', () => {
    const html = fs.readFileSync(withCanonical, 'utf-8').replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, '$1$2');
    const r = classifyCapture(html, { gameId: '3656', name: 'Alien: Isolation', expectedFilename: 'x.html' });
    assert.equal(r.status, 'incomplete-save');
  });

  // Zero accepted EFPS has two very different causes. A page carrying another
  // game's dataset must not be described as a thin low-sample game.
  it('distinguishes a quarantined borrowed dataset from a genuinely empty page', () => {
    const html = fs.readFileSync(withCanonical, 'utf-8');
    const r = classifyCapture(html, { gameId: '3656', name: 'Alien: Isolation', expectedFilename: 'x.html' });
    assert.equal(r.efpsCount, 0);
    assert.equal(r.efpsObjectsOnPage, 200);
    assert.equal(r.efpsQuarantinedAsOtherGame, 200);
    assert.ok(/belong to\s+another game/.test(r.detail), `detail must name the borrowed-dataset cause, got: ${r.detail}`);
    assert.equal(/low-sample game/.test(r.detail), false, 'must not be misdescribed as a low-sample game');
  });
});

// --- browser-default filenames ---------------------------------------------
// A browser names a saved page after its <title>, so an ordinary Ctrl+S on a
// UserBenchmark FPS-Estimates page writes
//
//     "UserBenchmark_ Can I Run ADR1FT.html"
//
// not the manifest's "FPS-Estimates-ADR1FT-3652.html". The verifier used to
// look files up BY the manifest name, so a perfectly good save reported as
// `missing` — and at 50 pages that put 50 manual renames between a correct
// capture batch and a green run. Files are now found by the identity resolved
// from the page's own HTML; the manifest still says which games are wanted and
// what each one's canonical name is.
describe('verify-capture accepts browser-default filenames', () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ub-capture-'));
  const adr1ft = fs.readFileSync(path.join(pagesDir, 'FPS-Estimates-ADR1FT-3652.html'), 'utf-8');
  const alien = fs.readFileSync(path.join(pagesDir, 'FPS-Estimates-Alien-Isolation-3656.html'), 'utf-8');

  // Exactly what Chrome/Opera write: title-derived, ':' replaced by '_',
  // spaces kept. Written literally so a regression cannot pass by matching
  // some normalised form of the name instead of ignoring the name.
  fs.writeFileSync(path.join(fixtureDir, 'UserBenchmark_ Can I Run ADR1FT.html'), adr1ft);
  fs.writeFileSync(path.join(fixtureDir, 'UserBenchmark_ Can I Run Alien_ Isolation.html'), alien);

  const games = [
    { gameId: '3652', name: 'ADR1FT', expectedFilename: 'FPS-Estimates-ADR1FT-3652.html' },
    { gameId: '3656', name: 'Alien: Isolation', expectedFilename: 'FPS-Estimates-Alien-Isolation-3656.html' },
    { gameId: '3651', name: 'ABZU', expectedFilename: 'FPS-Estimates-ABZU-3651.html' },
  ];

  it('captures a page saved under the browser default name', async () => {
    const { results } = matchFilesToGames(await scanPages(fixtureDir), games);
    const r = results.find((x) => x.gameId === '3652');
    assert.equal(r.status, 'captured');
    assert.equal(r.savedAs, 'UserBenchmark_ Can I Run ADR1FT.html');
  });

  // ADR1FT has no canonical <link>, Alien: Isolation does. Both must resolve
  // from content, or the fix only works for the easy half of the corpus.
  it('works whether identity came from a canonical link or from inference', async () => {
    const { results } = matchFilesToGames(await scanPages(fixtureDir), games);
    const adr = results.find((x) => x.gameId === '3652');
    const ali = results.find((x) => x.gameId === '3656');
    assert.equal(adr.status, 'captured');
    assert.equal(adr.identitySource, 'inferred-from-self-links');
    assert.equal(ali.status, 'captured');
    assert.equal(ali.identitySource, 'canonical');
  });

  it('reports that the name differs from the manifest name, without failing it', async () => {
    const { results } = matchFilesToGames(await scanPages(fixtureDir), games);
    const r = results.find((x) => x.gameId === '3656');
    assert.equal(r.filenameMatchesExpected, false);
    assert.includes(r.detail, 'FPS-Estimates-Alien-Isolation-3656.html');
    assert.includes(r.detail, 'matched by page identity');
  });

  it('still reports a game with no saved page as missing', async () => {
    const { results } = matchFilesToGames(await scanPages(fixtureDir), games);
    assert.equal(results.find((x) => x.gameId === '3651').status, 'missing');
  });

  // Accepting any filename must not become "accept anything". A file is still
  // only ever counted as the game it actually contains.
  it('counts a mis-saved tab as the game it really is, and says so', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ub-capture-'));
    fs.writeFileSync(path.join(dir, 'FPS-Estimates-ABZU-3651.html'), adr1ft);

    const { results } = matchFilesToGames(await scanPages(dir), games);
    assert.equal(results.find((x) => x.gameId === '3652').status, 'captured', 'the file is ADR1FT and must count as ADR1FT');

    const abzu = results.find((x) => x.gameId === '3651');
    assert.equal(abzu.status, 'missing');
    assert.includes(abzu.detail, '3652');
  });

  it('never counts a non-game file as a capture', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ub-capture-'));
    fs.writeFileSync(path.join(dir, 'FPS-Estimates-ADR1FT-3652.html'), '<html><body>Access denied</body></html>');

    const { results, unclassified } = matchFilesToGames(await scanPages(dir), games);
    assert.equal(results.find((x) => x.gameId === '3652').status, 'missing');
    assert.equal(unclassified.length, 1);
  });

  // Two saves of one game can differ. Which one fed the dataset must be stated,
  // and must not depend on directory listing order.
  it('reports duplicate saves of one game and prefers the manifest name', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ub-capture-'));
    fs.writeFileSync(path.join(dir, 'UserBenchmark_ Can I Run ADR1FT.html'), adr1ft);
    fs.writeFileSync(path.join(dir, 'FPS-Estimates-ADR1FT-3652.html'), adr1ft);

    const { results } = matchFilesToGames(await scanPages(dir), games);
    const r = results.find((x) => x.gameId === '3652');
    assert.equal(r.status, 'captured');
    assert.equal(r.savedAs, 'FPS-Estimates-ADR1FT-3652.html');
    assert.equal(r.duplicateSources.length, 2);
    assert.includes(r.detail, '2 saved files resolve to this game');
  });

  it('lists a saved page belonging to a game outside the batch', async () => {
    const { unmatched } = matchFilesToGames(await scanPages(fixtureDir), [games[0]]);
    assert.equal(unmatched.length, 1);
    assert.equal(unmatched[0].gameId, '3656');
  });
});
