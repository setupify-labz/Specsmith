// Game-page parser tests, asserting real values from the saved source.

import { describe, it, assert } from './harness.mjs';
import { parseGamePage, detectSourceKind, extractChart, extractSampleSummary } from '../lib/game-page.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pagesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pages');
import { parseFilterSegments } from '../lib/html.mjs';
import { loadFortnite } from './fixtures/load.mjs';

const { file, html } = await loadFortnite();
const p = parseGamePage(html, file);

describe('Game page: identity', () => {
  it('extracts game id, name, slug and canonical URL', () => {
    assert.equal(p.game.gameId, '3954');
    assert.equal(p.game.name, 'Fortnite');
    assert.equal(p.game.slug, 'Fortnite');
    assert.equal(p.game.canonicalUrl, 'https://www.userbenchmark.com/PCGame/FPS-Estimates-Fortnite/3954/0.0.0.0.0');
  });

  it('preserves the raw filter path and its components', () => {
    assert.equal(p.game.filterSegments.raw, '0.0.0.0.0');
    assert.deepEqual(p.game.filterSegments.positions, ['0', '0', '0', '0', '0']);
    assert.equal(p.game.filterSegments.gpuId, null, 'unfiltered canonical URL');
    assert.equal(p.game.filterSegments.cpuId, null);
  });

  it('parses without warnings', () => {
    assert.deepEqual(p._meta.warnings, [], 'a clean parse of the reference page must produce zero warnings');
  });
});

describe('Game page: overall summary', () => {
  it('extracts average FPS and total samples exactly', () => {
    assert.equal(p.sampleSummary.averageFps, 96);
    assert.equal(p.sampleSummary.totalSamples, 87737);
  });
});

describe('Game page: FPS histogram', () => {
  it('extracts aligned label and data arrays', () => {
    assert.equal(p.fpsHistogram.labels.length, 24);
    assert.equal(p.fpsHistogram.data.length, 24);
    assert.equal(p.fpsHistogram.labels.length, p.fpsHistogram.data.length, 'lengths must match');
  });
  it('extracts the exact bucket values', () => {
    assert.equal(p.fpsHistogram.labels[0], 20, 'first bucket');
    assert.equal(p.fpsHistogram.labels[23], 250, 'last bucket');
    assert.equal(p.fpsHistogram.data[0], 356314);
    assert.equal(p.fpsHistogram.data[23], 96);
  });
  it('preserves the raw array text', () => {
    assert.ok(p.fpsHistogram.rawLabels && p.fpsHistogram.rawLabels.includes('20'));
    assert.ok(p.fpsHistogram.rawData && p.fpsHistogram.rawData.includes('356314'));
  });
});

describe('Game page: settings distribution', () => {
  it('uses the source\'s exact labels without renaming them', () => {
    assert.deepEqual(p.settingsDistribution.labels, ['Low', 'Max', 'High', 'Med'], 'labels kept verbatim, including "Med" not "Medium"');
  });
  it('extracts the exact values', () => {
    assert.deepEqual(p.settingsDistribution.data, [35239, 24091, 14531, 13876]);
  });
  it('pairs each label with its own value', () => {
    const m = Object.fromEntries(p.settingsDistribution.labels.map((l, i) => [l, p.settingsDistribution.data[i]]));
    assert.equal(m.Low, 35239);
    assert.equal(m.Max, 24091);
    assert.equal(m.High, 14531);
    assert.equal(m.Med, 13876);
  });
});

describe('Game page: resolution distribution', () => {
  it('uses the source\'s exact labels', () => {
    assert.deepEqual(p.resolutionDistribution.labels, ['1080p', '720p', '1440p', '4K']);
  });
  it('extracts the exact values including the tiny 4K bucket', () => {
    const m = Object.fromEntries(p.resolutionDistribution.labels.map((l, i) => [l, p.resolutionDistribution.data[i]]));
    assert.equal(m['1080p'], 54761);
    assert.equal(m['720p'], 29451);
    assert.equal(m['1440p'], 3447);
    assert.equal(m['4K'], 78);
  });
});

describe('Game page: GPU table', () => {
  it('extracts every row', () => {
    assert.equal(p.gpuTable.length, 20);
  });
  it('extracts the first row exactly', () => {
    const r = p.gpuTable[0];
    assert.equal(r.name, 'Nvidia GTX 1060-6GB');
    assert.equal(r.samples, 6210);
    assert.equal(r.benchPercent, 24);
    assert.equal(r.valuePercent, 51);
    assert.equal(r.componentPageUrl, 'https://gpu.userbenchmark.com/Nvidia-GTX-1060-6GB/Rating/3639');
    assert.equal(r.componentRatingId, '3639');
  });
  it('extracts price data when present', () => {
    const r = p.gpuTable[0];
    assert.equal(r.priceUsd, 110);
    assert.equal(r.priceStore, 'Ebay');
    assert.includes(r.priceUrl, 'gpu.userbenchmark.com');
  });
  it('extracts the game-specific filter URL with the GPU id in position 0', () => {
    const r = p.gpuTable[0];
    assert.equal(r.gameFilterUrl, 'https://www.userbenchmark.com/PCGame/FPS-Estimates-Fortnite/3954/153864.0.0.0.0');
    assert.equal(r.filterSegments.gpuId, '153864');
    assert.equal(r.filterSegments.cpuId, null, 'a GPU row never populates the CPU position');
  });
  it('every GPU row links to the gpu subdomain', () => {
    for (const r of p.gpuTable) assert.includes(r.componentPageUrl, 'gpu.userbenchmark.com', `row ${r.name}`);
  });
  it('every GPU row sets filter position 0 and only position 0', () => {
    for (const r of p.gpuTable) {
      assert.ok(r.filterSegments.gpuId, `${r.name} has no gpuId`);
      assert.equal(r.filterSegments.cpuId, null, `${r.name} unexpectedly set cpuId`);
      assert.equal(r.filterSegments.position2, null);
      assert.equal(r.filterSegments.position3, null);
    }
  });
});

describe('Game page: CPU table', () => {
  it('extracts every row', () => {
    assert.equal(p.cpuTable.length, 20);
  });
  it('extracts the first row exactly', () => {
    const r = p.cpuTable[0];
    assert.equal(r.name, 'AMD Ryzen 5 2600');
    assert.equal(r.samples, 2579);
    assert.equal(r.benchPercent, 73);
    assert.equal(r.valuePercent, 74);
    assert.equal(r.componentPageUrl, 'https://cpu.userbenchmark.com/AMD-Ryzen-5-2600/Rating/3955');
    assert.equal(r.componentRatingId, '3955');
  });
  it('extracts the game-specific filter URL with the CPU id in position 1', () => {
    const r = p.cpuTable[0];
    assert.equal(r.filterSegments.raw, '0.476362.0.0.0');
    assert.equal(r.filterSegments.cpuId, '476362');
    assert.equal(r.filterSegments.gpuId, null, 'a CPU row never populates the GPU position');
  });
  it('every CPU row links to the cpu subdomain', () => {
    for (const r of p.cpuTable) assert.includes(r.componentPageUrl, 'cpu.userbenchmark.com', `row ${r.name}`);
  });
  it('no row landed in the unclassified bucket', () => {
    assert.equal(p.unclassifiedTableRows.length, 0);
  });
});

describe('Game page: filters and related pages', () => {
  it('extracts the CPU-family quick filters into position 4', () => {
    const families = p.brandFilterUrls.filter((f) => f.filterSegments?.cpuFamilyFilter);
    assert.ok(families.length >= 8, `expected the i3/i5/i7/i9/Ryzen/FX/Athlon/Pentium set, got ${families.length}`);
    const labels = families.map((f) => f.filterSegments.cpuFamilyFilter);
    for (const want of ['i3', 'i5', 'i7', 'i9', 'Ryzen', 'FX', 'Athlon', 'Pentium']) {
      assert.ok(labels.includes(want), `missing CPU family filter "${want}"`);
    }
  });
  it('discovers related game pages without fetching them', () => {
    assert.ok(p.relatedGamePages.games.length > 0);
    for (const g of p.relatedGamePages.games) {
      assert.ok(/^\d+$/.test(g.gameId));
      assert.includes(g.url, '/PCGame/FPS-Estimates-');
      assert.ok(g.gameId !== p.game.gameId, 'the page never lists itself');
    }
  });
  it('collects every distinct filter path for its own game', () => {
    assert.ok(p.ownFilterPaths.paths.length >= 40, `expected many filter paths, got ${p.ownFilterPaths.paths.length}`);
    for (const f of p.ownFilterPaths.paths) assert.equal(f.positions.length, 5, `path ${f.raw} is not 5 positions`);
  });
});

describe('Game page: undocumented filter positions are not given invented meanings', () => {
  it('exposes positions 2 and 3 as raw, unnamed values', () => {
    const seg = parseFilterSegments('1.2.3.4.i7');
    assert.equal(seg.gpuId, '1');
    assert.equal(seg.cpuId, '2');
    assert.equal(seg.position2, '3');
    assert.equal(seg.position3, '4');
    assert.equal(seg.cpuFamilyFilter, 'i7');
    assert.equal(seg.resolutionFilter, undefined, 'must NOT invent a "resolutionFilter" name');
    assert.equal(seg.settingsFilter, undefined, 'must NOT invent a "settingsFilter" name');
  });
  it('flags populated undocumented positions as unresolved', () => {
    const seg = parseFilterSegments('0.0.7.9.0');
    assert.deepEqual(seg.unresolvedPositions, [{ index: 2, value: '7' }, { index: 3, value: '9' }]);
  });
  it('reports no unresolved positions when they are empty', () => {
    assert.deepEqual(parseFilterSegments('153864.0.0.0.0').unresolvedPositions, []);
  });
  it('positions 2 and 3 are never populated anywhere in the real source', () => {
    for (const f of p.ownFilterPaths.paths) {
      assert.equal(f.position2, null, `path ${f.raw} unexpectedly populates position 2`);
      assert.equal(f.position3, null, `path ${f.raw} unexpectedly populates position 3`);
    }
  });
});

describe('Game page: source-kind detection', () => {
  it('recognizes a real FPS-Estimates game page', () => {
    const k = detectSourceKind(html);
    assert.equal(k.kind, 'fps-estimates-game-page');
    assert.ok(k.confident);
  });
  it('recognizes a JSF AJAX partial response', () => {
    assert.equal(detectSourceKind("<?xml version='1.0'?><partial-response id='j_id1'></partial-response>").kind, 'jsf-ajax-partial-response');
  });
  it('recognizes an unrelated file instead of claiming it is a game page', () => {
    assert.equal(detectSourceKind('<html><body>hello</body></html>').kind, 'unknown');
  });
  it('refuses to extract from a non-game page rather than returning hollow nulls', () => {
    const r = parseGamePage('<html><body>nothing here</body></html>', 'junk.html');
    assert.notOk(r._meta.parsedSuccessfully);
    assert.equal(r.game, null);
    assert.ok(r._meta.warnings[0].includes('not an FPS-Estimates game page'));
  });
});

describe('Game page: chart extraction edge cases', () => {
  it('reports a missing chart rather than returning silent empties', () => {
    const r = extractChart('<html></html>', 'nopeChart');
    assert.deepEqual(r.value.labels, []);
    assert.ok(r.warnings.some((w) => w.includes('No Chart.js block')));
  });
  it('warns when labels and data lengths differ', () => {
    const fake = `getElementById("xChart") { labels: [1,2,3], datasets:[{ data: [10,20] }] }`;
    const r = extractChart(fake, 'xChart');
    assert.ok(r.warnings.some((w) => w.includes('lengths differ')), 'a misaligned chart must be flagged');
  });
  it('reads the dataset array, not the outer config object', () => {
    const fake = `getElementById("yChart") , data: { labels: ["a","b"], datasets: [{ data: [5,6] }] }`;
    const r = extractChart(fake, 'yChart');
    assert.deepEqual(r.value.data, [5, 6], 'must pick the array-valued data, not the object-valued one');
  });
});

describe('Game page: EFPS is wired into the page parse', () => {
  it('surfaces EFPS records and stats on the parsed page', () => {
    assert.equal(p.efps.stats.accepted, 200);
    assert.equal(p.efps.stats.direct, 27);
    assert.equal(p.efps.stats.comparisons, 173);
    assert.equal(p.efps.rejected.length, 0);
  });
});

// --- low-sample average FPS -------------------------------------------------
// UserBenchmark renders the sample count in one of two spans, and which one it
// picks is itself a data-quality signal:
//
//   enough data   Average Fps: 45.9  <span class="mutedtext">4,108 samples</span>
//   too little    Average Fps: 195   <span class="redtext">… only 5 samples</span>
//
// Matching only the neutral form dropped BOTH figures on the warning form —
// Axiom Verge published 195 FPS from 5 samples and parsed as null/null, with
// its 5 GPU and 5 CPU rows left as the only trace that the page had content.
describe('sample summary: both published forms', () => {
  const low = fs.readFileSync(path.join(pagesDir, 'FPS-Estimates-Axiom-Verge-3662.html'), 'utf-8');
  const normal = fs.readFileSync(path.join(pagesDir, 'FPS-Estimates-Arma-3-3660.html'), 'utf-8');

  it('reads the average and count from the low-sample warning form', () => {
    const r = extractSampleSummary(low);
    assert.equal(r.value.averageFps, 195);
    assert.equal(r.value.totalSamples, 5);
  });

  it('still reads the ordinary form, with its thousands separator', () => {
    const r = extractSampleSummary(normal);
    assert.equal(r.value.averageFps, 45.9);
    assert.equal(r.value.totalSamples, 4108);
  });

  // The two forms must stay distinguishable. A 5-sample 195 and a
  // 4,108-sample 45.9 are not the same kind of number, and the flag is the
  // source's own disclaimer, not a threshold invented here.
  it('records the publisher low-sample flag, and only on the flagged page', () => {
    assert.equal(extractSampleSummary(low).value.lowSampleWarning, true);
    assert.equal(extractSampleSummary(normal).value.lowSampleWarning, false);
  });

  it('warns when the source disclaimed the average, and stays quiet otherwise', () => {
    assert.equal(extractSampleSummary(low).warnings.length, 1);
    assert.includes(extractSampleSummary(low).warnings[0], 'only 5 samples');
    assert.equal(extractSampleSummary(normal).warnings.length, 0);
  });

  // Absent must stay distinguishable from present-but-flagged: a page with no
  // block at all reports null, never a fabricated zero.
  it('reports null rather than inventing a figure when no block exists', () => {
    const r = extractSampleSummary('<html><body><h3>no summary here</h3></body></html>');
    assert.equal(r.value.averageFps, null);
    assert.equal(r.value.totalSamples, null);
    assert.equal(r.value.lowSampleWarning, null);
    assert.equal(r.warnings.length, 1);
  });
});

// --- component rows: both published forms of price and component id ---------
// The reliability risk in these tables is not a crash, it is a silent null.
// A row that renders a price the parser does not recognise looks exactly like
// a row with no price, and nothing downstream can tell the two apart.
describe('component rows: price and id in both published forms', () => {
  const sevenDays = fs.readFileSync(path.join(pagesDir, 'FPS-Estimates-7-Days-to-Die-3959.html'), 'utf-8');
  const parsed = parseGamePage(sevenDays, 'FPS-Estimates-7-Days-to-Die-3959.html');
  const gpu = (name) => parsed.gpuTable.find((r) => r.name === name);

  // <td>$120</td> — no retailer link. Previously dropped entirely.
  it('reads a plain-text price', () => {
    const r = gpu('Nvidia GTX 750');
    assert.equal(r.priceUsd, 120);
    assert.equal(r.priceStore, null, 'a plain price has no retailer to attribute it to');
    assert.equal(r.priceUrl, null);
  });

  // <td><a title="Live Amazon price"><span>$198</span></a></td>
  it('reads a linked price together with its retailer', () => {
    const r = gpu('Nvidia GTX 960');
    assert.equal(r.priceUsd, 198);
    assert.equal(r.priceStore, 'Amazon');
    assert.ok(String(r.priceUrl).startsWith('https://'));
  });

  // <td>-</td> — the genuine "no price" case, which must stay distinct from
  // "price present but unparsed". This is the assertion that stops the price
  // fallback from turning into a guess.
  it('leaves a dash as null rather than inventing a figure', () => {
    const r = gpu('Nvidia GeForce GT 730');
    assert.equal(r.priceUsd, null);
    assert.equal(r.valuePercent, null);
  });

  // Two URL shapes carry the id in different positions:
  //   …/Nvidia-GTX-750/Rating/3162   and   …/SpeedTest/12582/NVIDIA-GeForce-GT-730
  it('recovers the component id from both URL shapes', () => {
    assert.equal(gpu('Nvidia GTX 750').componentRatingId, '3162', '/Rating/<id> form');
    assert.equal(gpu('Nvidia GeForce GT 730').componentRatingId, '12582', '/SpeedTest/<id>/ form');
  });

  it('never leaves a component id unread when the row has a bench link', () => {
    for (const r of [...parsed.gpuTable, ...parsed.cpuTable]) {
      if (r.componentPageUrl) {
        assert.ok(r.componentRatingId, `${r.name}: bench link ${r.componentPageUrl} yielded no component id`);
      }
    }
  });

  it('never records a non-positive price', () => {
    for (const r of [...parsed.gpuTable, ...parsed.cpuTable]) {
      if (r.priceUsd != null) assert.ok(r.priceUsd > 0, `${r.name}: price ${r.priceUsd}`);
    }
  });
});
