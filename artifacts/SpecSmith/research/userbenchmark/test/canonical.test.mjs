// Structural guards on the reconciled layout.
//
// Two sessions built UserBenchmark ingestion on this branch in parallel and
// left duplicate implementations plus three separate writers of derived
// output. These tests fail if that situation reappears — they check the shape
// of the directory, not its behaviour, so a well-meaning "I'll just add a
// second extractor" is caught in CI rather than in a data discrepancy weeks
// later.
//
// See the reconciliation record in ../README.md.

import { describe, it, assert } from './harness.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

async function listScripts(dir, acc = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    // pages/ holds saved HTML sources; node_modules never exists here but is
    // cheap to exclude.
    if (e.isDirectory()) {
      if (['pages', 'parsed', 'dataset', 'node_modules', 'scripts'].includes(e.name)) continue;
      await listScripts(full, acc);
    } else if (e.name.endsWith('.mjs')) {
      acc.push(full);
    }
  }
  return acc;
}

/** Strips block and line comments.
 *
 * Required, not cosmetic: these guards search for code patterns, and this
 * directory's prose is unusually full of the very strings being searched for —
 * comments quote `from '...'` imports, describe `fetch`, and name the removed
 * files. Without stripping, `lib/html.mjs`'s phrase «"absent" from "genuinely
 * zero"» reads as an import of a package called `genuinely zero`. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}

const scripts = await listScripts(root);
const sources = (
  await Promise.all(
    scripts.map(async (f) => {
      const raw = await fs.readFile(f, 'utf-8');
      return { file: path.relative(root, f), raw, text: stripComments(raw) };
    }),
  )
)
  // The guards themselves necessarily contain every pattern they look for.
  // Scanning the test directory would make them permanently self-failing.
  .filter((s) => !s.file.startsWith('test/'));

describe('Canonical layout: one EFPS implementation', () => {
  it('exactly one module defines the EFPS extractor', () => {
    const definers = sources.filter((s) => /export\s+function\s+extractEfpsRecords/.test(s.text));
    assert.equal(definers.length, 1, `expected 1 definition of extractEfpsRecords, found ${definers.length}: ${definers.map((d) => d.file).join(', ')}`);
    assert.equal(definers[0].file, 'lib/efps.mjs');
  });

  it('no module re-implements EFPS object scanning outside lib/efps.mjs', () => {
    // The tell-tale of a second parser: its own regex over the {id,t,p} shape.
    const offenders = sources.filter((s) => s.file !== 'lib/efps.mjs' && /id\s*:\s*\\?['"]?\s*\(|\{\s*\\s\*id\s*:/.test(s.text) && /t\s*:/.test(s.text) && /p\s*:/.test(s.text));
    assert.equal(offenders.length, 0, `these files appear to parse EFPS objects themselves: ${offenders.map((o) => o.file).join(', ')}`);
  });

  it('the removed duplicate extractor has not come back', async () => {
    for (const gone of ['efps/extract-efps.mjs', 'build-research-dataset.mjs']) {
      let exists = true;
      try {
        await fs.access(path.join(root, gone));
      } catch {
        exists = false;
      }
      assert.notOk(exists, `${gone} was removed during reconciliation and must not return — see README.md`);
    }
  });
});

describe('Canonical layout: one writer per derived directory', () => {
  it('only ingest.mjs writes dataset/', () => {
    const writers = sources.filter((s) => /datasetDir|dataset['"]\s*\)|['"]dataset['"]/.test(s.text) && /writeFile/.test(s.text));
    const names = writers.map((w) => w.file).sort();
    assert.deepEqual(names, ['ingest.mjs'], `dataset/ must have exactly one writer, found: ${names.join(', ') || 'none'}`);
  });

  it('only parse.mjs and ingest.mjs write parsed/, and both use the shared core', () => {
    const writers = sources.filter((s) => /parsedDir|outDir/.test(s.text) && /writeFile/.test(s.text) && !s.file.startsWith('homepage/'));
    const names = writers.map((w) => w.file).sort();
    assert.deepEqual(names, ['ingest.mjs', 'parse.mjs'], `unexpected writers of parsed/: ${names.join(', ')}`);
    for (const w of writers) {
      assert.ok(/from '\.\/lib\/game-page\.mjs'/.test(w.text), `${w.file} must extract via lib/game-page.mjs, not its own parser`);
    }
  });
});

describe('Canonical layout: capture tooling stays human-driven', () => {
  const captureScripts = sources.filter((s) => s.file.startsWith('capture/'));

  it('the capture scripts exist and contain no network code', () => {
    assert.ok(captureScripts.length >= 2, 'expected plan-capture.mjs and verify-capture.mjs');
    const netRe = /\bfetch\s*\(|https?\.(?:get|request)\s*\(|from\s+['"](?:node-fetch|axios|got|playwright|puppeteer)['"]/;
    const bad = captureScripts.filter((s) => netRe.test(s.text));
    assert.equal(bad.length, 0, `capture tooling must never fetch: ${bad.map((b) => b.file).join(', ')}`);
  });

  it('the capture scripts never drive a browser', () => {
    // A capture helper that automates the browser would be a crawler wearing a
    // different hat. Opening a link must stay a human action.
    const driveRe = /playwright|puppeteer|webdriver|selenium|chromium\.launch|\.goto\s*\(/i;
    const bad = captureScripts.filter((s) => driveRe.test(s.text));
    assert.equal(bad.length, 0, `capture tooling must not drive a browser: ${bad.map((b) => b.file).join(', ')}`);
  });

  it('verify-capture decides identity from the canonical URL, not the filename', () => {
    const v = captureScripts.find((s) => s.file.endsWith('verify-capture.mjs'));
    assert.ok(v, 'verify-capture.mjs present');
    assert.ok(/rel="canonical"/.test(v.text), 'must read the page\'s canonical URL');
    assert.ok(/wrong-game/.test(v.text), 'must be able to report a wrong-game mis-save');
  });

  it('verify-capture detects incomplete (script-stripped) saves', () => {
    // The EFPS records and chart data live in inline <script> blocks. A saver
    // that strips scripts produces a file that passes every other check —
    // right canonical URL, right name, right average FPS, all 40 table rows —
    // and yields 0 EFPS instead of ~200. Without this status the batch reports
    // "captured" and the ingest reports "0 errors" at the exact moment the
    // primary dataset is gone.
    const v = captureScripts.find((s) => s.file.endsWith('verify-capture.mjs'));
    assert.ok(/incomplete-save/.test(v.text), 'must be able to report an incomplete save');
    assert.ok(/inlineScriptStats|withBody/.test(v.text), 'must inspect inline script bodies');
    assert.ok(/parseGamePage/.test(v.text), 'must measure completeness through the canonical parser, not a second one');
  });

  it('verify-capture does not flag a sparse game merely for having 0 EFPS', () => {
    // A low-sample game may legitimately publish no EFPS records. The strip
    // signal must be the missing script BODIES, not the record count alone.
    const v = captureScripts.find((s) => s.file.endsWith('verify-capture.mjs'));
    assert.ok(/chartsWithData/.test(v.text), 'must consider chart presence when EFPS count is 0');
    assert.notOk(/efpsCount === 0\s*\)\s*\{\s*return[^}]*incomplete-save/.test(v.text), 'a bare 0-EFPS test must not by itself mark a save incomplete');
  });

  it('verify-capture never renames, moves or deletes a saved page', () => {
    const v = captureScripts.find((s) => s.file.endsWith('verify-capture.mjs'));
    assert.notOk(/fs\.rename|fs\.rm\b|fs\.unlink|fs\.copyFile/.test(v.text), 'verification must report, not repair');
  });
});

describe('Canonical layout: research-only invariants', () => {
  it('no script contains network code', () => {
    const netRe = /\b(?:await\s+)?fetch\s*\(|require\(['"](?:node-fetch|axios|got)['"]\)|from\s+['"](?:node-fetch|axios|got)['"]|https?\.(?:get|request)\s*\(|new\s+XMLHttpRequest/;
    const offenders = sources.filter((s) => netRe.test(s.text));
    assert.equal(offenders.length, 0, `network code found in: ${offenders.map((o) => o.file).join(', ')}`);
  });

  it('every import is a node builtin or a local module — zero dependencies', () => {
    const bad = [];
    for (const s of sources) {
      for (const m of s.text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1];
        if (spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../')) continue;
        bad.push(`${s.file} → ${spec}`);
      }
    }
    assert.equal(bad.length, 0, `non-builtin, non-local imports: ${bad.join(', ')}`);
  });

  it('no script writes outside research/userbenchmark/', () => {
    // A path escaping the research tree would be a production-safety failure.
    const offenders = sources.filter((s) => /writeFile[\s\S]{0,200}?\.\.\/\.\.\/\.\./.test(s.text) || /src\/data\//.test(s.text));
    assert.equal(offenders.length, 0, `these files reference paths outside the research tree: ${offenders.map((o) => o.file).join(', ')}`);
  });
});
