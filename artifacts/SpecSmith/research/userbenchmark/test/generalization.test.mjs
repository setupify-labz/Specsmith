// Parser generalization and silent-failure tests.
//
// WHAT THIS SUITE CAN AND CANNOT ESTABLISH
// ----------------------------------------
// It cannot establish that the parser handles pages we have never seen. The
// corpus is 19 real captures, but measurement shows they are 19 samples of ONE
// template: every page uses double-quoted attributes, identical class names and
// identical tag order. As parser coverage that is close to a single structural
// sample, so a regex resting on incidental formatting can look thoroughly
// exercised. Genuine generalization testing needs pages we do not have and
// cannot legitimately fetch — userbenchmark.com's robots.txt disallows this
// project's tooling from every /PCGame/ path.
//
// What it CAN establish is the property that actually protects the dataset:
//
//     the parser must never silently produce wrong or partial data
//
// Loud failure is recoverable — someone sees it and fixes it. Silent partial
// extraction is not, because nothing downstream can tell 19 rows from 20. Both
// real defects found in this parser so far (a price form parsed as null, a
// component id in an unmatched URL shape) were of exactly that silent kind and
// were found by hand, not by tests. These tests close that gap.
//
// No mutation invents a benchmark value. They rearrange or damage existing
// markup from real captures, and every assertion is about extraction behaviour,
// never about whether a published number is true.

import { describe, it, assert } from './harness.mjs';
import { parseGamePage } from '../lib/game-page.mjs';
import {
  TOLERANCE_MUTATIONS,
  DAMAGE_MUTATIONS,
  DEGRADED_BUT_HANDLED_MUTATIONS,
  skewDistributionValue,
} from './fixtures/mutate.mjs';
import {
  runAllDetectors,
  componentRowsMatchLinkedComponents,
  chartLabelsMatchData,
  distributionSumsMatchTotalSamples,
  noDuplicateComponentNames,
  everyRowHasJoinableFields,
  pricedRowCountMatchesHtml,
} from './fixtures/detectors.mjs';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pagesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pages');
const pageFiles = fsSync.readdirSync(pagesDir).filter((f) => f.endsWith('.html')).sort();
const read = (f) => fsSync.readFileSync(path.join(pagesDir, f), 'utf-8');

// Three pages spanning the corpus's real variation: canonical vs inferred
// identity, decimal vs integer average FPS, 20-row vs 5-row tables.
const SAMPLE_PAGES = [
  'FPS-Estimates-Battlerite-3666.html', // no canonical -> inferred identity
  'FPS-Estimates-Arma-3-3660.html', // canonical, decimal FPS, full tables
  'FPS-Estimates-Axiom-Verge-3662.html', // low-sample: 5 rows, integer FPS
];

/** Everything a downstream consumer would rely on. Two parses agreeing here
 * agree on all extracted data, not merely on record counts. */
function extractionSignature(parsed) {
  if (parsed.sampleSummary === undefined) return 'REJECTED';
  return JSON.stringify({
    gameId: parsed.game?.gameId,
    averageFps: parsed.sampleSummary.averageFps,
    totalSamples: parsed.sampleSummary.totalSamples,
    rows: ['gpuTable', 'cpuTable'].map((t) =>
      parsed[t].map((r) => [r.name, r.samples, r.benchPercent, r.valuePercent, r.priceUsd, r.componentRatingId].join('~')).join('|'),
    ),
    charts: ['fpsHistogram', 'settingsDistribution', 'resolutionDistribution'].map((k) =>
      JSON.stringify([parsed[k]?.labels ?? [], parsed[k]?.data ?? []]),
    ),
  });
}

const isRejected = (parsed) => parsed.sampleSummary === undefined;

// ---------------------------------------------------------------------------

describe('Generalization: cosmetic markup changes never yield silent partial data', () => {
  // The parser turns out to be BRITTLE to cosmetic variation — single-quoted
  // attributes, newlines inside tags and added attributes each take the whole
  // page out. That is a real limitation and is recorded as such in the audit.
  //
  // But brittle-and-loud is the safe failure. The assertion is therefore not
  // "tolerates everything" (it does not) but the property that matters: under
  // cosmetic change the parser either extracts IDENTICALLY or refuses the page
  // outright. It must never land in between, quietly returning some of the data
  // while reporting success.
  for (const [name, mutate] of Object.entries(TOLERANCE_MUTATIONS)) {
    it(`${name}: extracts identically or refuses the page — never partially`, () => {
      for (const file of SAMPLE_PAGES) {
        const original = read(file);
        const baseline = extractionSignature(parseGamePage(original, file));

        let mutated;
        try {
          mutated = parseGamePage(mutate(original), file);
        } catch {
          continue; // throwing is loud; acceptable
        }

        if (isRejected(mutated)) continue; // refused outright; acceptable

        assert.equal(
          extractionSignature(mutated),
          baseline,
          `${file}: ${name} produced a DIFFERENT successful extraction — partial or altered data reported as success`,
        );
      }
    });
  }
});

describe('Generalization: damaged markup is always caught', () => {
  // Every one of these leaves output that looks healthy in isolation. Each must
  // be caught either by the parser refusing the page, or by a detector.
  for (const [name, mutate] of Object.entries(DAMAGE_MUTATIONS)) {
    it(`${name}: caught by the parser or by a detector`, () => {
      for (const file of SAMPLE_PAGES) {
        const html = mutate(read(file));
        const parsed = parseGamePage(html, file);

        if (isRejected(parsed)) continue; // refused outright: caught loudly

        const findings = runAllDetectors(parsed, html);
        assert.ok(
          Object.keys(findings).length > 0,
          `${file}: ${name} passed the parser AND every detector — this is a silent data defect`,
        );
      }
    });
  }

  // The subtlest case: one value altered by one. Structurally flawless output;
  // only the cross-check against the page's own sample total reveals it.
  it('a single-unit skew in a distribution is caught by the sample-total cross-check', () => {
    for (const file of SAMPLE_PAGES) {
      const original = read(file);
      const parsed = parseGamePage(original, file);
      const html = skewDistributionValue(original, parsed.settingsDistribution.data);
      const reparsed = parseGamePage(html, file);

      const findings = distributionSumsMatchTotalSamples(reparsed);
      assert.ok(findings.length > 0, `${file}: a one-unit skew went undetected`);
      assert.ok(/sums to/.test(findings[0]), findings[0]);
    }
  });
});

describe('Generalization: a missing canonical link degrades honestly', () => {
  // Not damage. Four captured pages genuinely lack a canonical link and the
  // pipeline handles them by design. What must hold is that the weaker evidence
  // is DISCLOSED rather than passed off as canonical.
  for (const [name, mutate] of Object.entries(DEGRADED_BUT_HANDLED_MUTATIONS)) {
    it(`${name}: still parses, and records that identity was inferred`, () => {
      const file = 'FPS-Estimates-Arma-3-3660.html'; // has a canonical link to remove
      const parsed = parseGamePage(mutate(read(file)), file);

      assert.ok(!isRejected(parsed), 'page should still parse via identity inference');
      assert.equal(parsed.game.gameId, '3660', 'identity must still resolve to the right game');
      assert.equal(parsed.game.identitySource, 'inferred-from-self-links');
      assert.ok(parsed.game.identityEvidence, 'inferred identity must carry its corroborating evidence');
      assert.ok(
        parsed._meta.warnings.some((w) => /canonical/i.test(w)),
        'the absence of a canonical URL must be surfaced as a warning, not silently absorbed',
      );
    });
  }
});

describe('Suspicion detectors: clean on every real capture', () => {
  // A detector that fires on good data is worse than none — it trains everyone
  // to ignore it. All five must be silent across the entire real corpus.
  it('no detector fires on any of the captured pages', () => {
    const noisy = [];
    for (const file of pageFiles) {
      const html = read(file);
      const findings = runAllDetectors(parseGamePage(html, file), html);
      if (Object.keys(findings).length > 0) noisy.push(`${file}: ${JSON.stringify(findings)}`);
    }
    assert.deepEqual(noisy, [], `detectors must be silent on real captures:\n${noisy.join('\n')}`);
  });
});

describe('Suspicion detectors: each one demonstrably fires', () => {
  // A detector never proven to fail is not evidence of anything. Each is shown
  // to catch the specific defect it exists for, using a hand-built parsed
  // object so the defect is exact and isolated.
  const base = () => parseGamePage(read('FPS-Estimates-Arma-3-3660.html'), 'a.html');

  it('componentRowsMatchLinkedComponents fires when a row is missing', () => {
    const html = read('FPS-Estimates-Arma-3-3660.html');
    const parsed = base();
    parsed.gpuTable = parsed.gpuTable.slice(0, -1);
    const findings = componentRowsMatchLinkedComponents(parsed, html);
    assert.ok(findings.length > 0 && /GPU table parsed 19/.test(findings[0]), JSON.stringify(findings));
  });

  it('chartLabelsMatchData fires on a labels/data length mismatch', () => {
    const parsed = base();
    parsed.fpsHistogram.data = parsed.fpsHistogram.data.slice(0, -1);
    assert.ok(chartLabelsMatchData(parsed).some((f) => /label/.test(f)));
  });

  it('distributionSumsMatchTotalSamples fires on a one-unit drift', () => {
    const parsed = base();
    parsed.settingsDistribution.data = [...parsed.settingsDistribution.data];
    parsed.settingsDistribution.data[0] += 1;
    assert.ok(distributionSumsMatchTotalSamples(parsed).some((f) => /sums to/.test(f)));
  });

  it('noDuplicateComponentNames fires on a repeated row', () => {
    const parsed = base();
    parsed.gpuTable = [...parsed.gpuTable, parsed.gpuTable[0]];
    assert.ok(noDuplicateComponentNames(parsed).length > 0);
  });

  it('everyRowHasJoinableFields fires when a component id is lost', () => {
    const parsed = base();
    parsed.gpuTable = parsed.gpuTable.map((r, i) => (i === 0 ? { ...r, componentRatingId: null } : r));
    assert.ok(everyRowHasJoinableFields(parsed).some((f) => /no component id/.test(f)));
  });

  // The detector that exists specifically because the others cannot do this.
  // Re-introducing the real historical price bug — reading only the linked
  // retailer form and dropping the plain <td>$120</td> form — was caught by ONE
  // hand-written fixture and by no structural detector at all. Simulated here
  // by discarding exactly the prices that arrive without a retailer link.
  it('pricedRowCountMatchesHtml fires when plain-text prices are dropped', () => {
    const file = 'FPS-Estimates-7-Days-to-Die-3959.html';
    const html = read(file);
    const parsed = parseGamePage(html, file);

    const dropUnlinked = (r) => (r.priceUsd != null && r.priceStore == null ? { ...r, priceUsd: null } : r);
    parsed.gpuTable = parsed.gpuTable.map(dropUnlinked);
    parsed.cpuTable = parsed.cpuTable.map(dropUnlinked);

    const findings = pricedRowCountMatchesHtml(parsed, html);
    assert.ok(findings.length > 0, 'dropping plain-text prices must be detected');
    assert.ok(/but the parser read/.test(findings[0]), findings[0]);
  });

  // Guards the detector that would otherwise be easiest to weaken into
  // uselessness: absent price and value% are legitimate ("-" on the page) and
  // must never be reported as defects.
  it('everyRowHasJoinableFields does NOT fire on legitimately absent price or value', () => {
    const parsed = base();
    parsed.gpuTable = parsed.gpuTable.map((r) => ({ ...r, priceUsd: null, valuePercent: null }));
    assert.deepEqual(everyRowHasJoinableFields(parsed), []);
  });
});
