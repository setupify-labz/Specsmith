// Recovering the original source from a browser's rendered "view-source" save.
//
// Ctrl+U then Ctrl+S does not save a page's source — it saves the browser's
// RENDERING of that source: a line-numbered table of HTML-escaped markup
// wrapped in syntax-highlighting spans. The original bytes are all present,
// just escaped, so they are recovered rather than discarded.

import { describe, it, assert } from './harness.mjs';
import { isViewSourceWrapper, unwrapViewSource, unwrapIfViewSource } from '../lib/view-source.mjs';
import { detectSourceKind, extractSampleSummary } from '../lib/game-page.mjs';
import { extractEfpsRecords } from '../lib/efps.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const wrapped = fs.readFileSync(path.join(here, 'fixtures', 'view-source-save-Battlefield-6-4186.html'), 'utf-8');
const realPage = fs.readFileSync(path.join(here, '..', 'pages', 'FPS-Estimates-Battlerite-3666.html'), 'utf-8');

describe('view-source unwrapping', () => {
  it('recognises a view-source save and leaves ordinary saves alone', () => {
    assert.equal(isViewSourceWrapper(wrapped), true);
    assert.equal(isViewSourceWrapper(realPage), false);
  });

  it('passes an ordinary page through byte-for-byte', () => {
    assert.equal(unwrapIfViewSource(realPage), realPage);
  });

  it('recovers real markup, not escaped text', () => {
    const { html } = unwrapViewSource(wrapped);
    assert.includes(html, '<!DOCTYPE html>');
    assert.includes(html, '<title>UserBenchmark: Can I Run Battlefield 6 (BF6)</title>');
    assert.equal(/&lt;|&gt;/.test(html.slice(0, 4000)), false, 'escaped angle brackets must be gone');
  });

  // Decoding must happen exactly once. The page's own entities arrive
  // double-escaped (`&nbsp;` appears as `&amp;nbsp;`), so a second pass would
  // turn them into live characters and silently change the recovered bytes.
  it('decodes exactly one level of escaping', () => {
    const src = '<td class="line-content">&lt;p&gt;a &amp;amp; b &amp;nbsp; c&lt;/p&gt;</td>';
    assert.equal(unwrapViewSource(src).html, '<p>a &amp; b &nbsp; c</p>');
  });

  it('strips the highlight spans without eating the source they wrap', () => {
    const src =
      '<td class="line-content"><span class="html-tag">&lt;link ' +
      '<span class="html-attribute-name">rel</span>="<span class="html-attribute-value">canonical</span>"&gt;</span></td>';
    assert.equal(unwrapViewSource(src).html, '<link rel="canonical">');
  });

  it('preserves line structure', () => {
    const src = '<td class="line-content">one</td><td class="line-content">two</td>';
    const { html, lines } = unwrapViewSource(src);
    assert.equal(lines, 2);
    assert.equal(html, 'one\ntwo');
  });

  it('throws rather than returning an empty document', () => {
    let threw = false;
    try {
      unwrapViewSource('<html><body>no line cells</body></html>');
    } catch {
      threw = true;
    }
    assert.ok(threw, 'an unwrappable input must fail loudly, not parse as an empty page');
  });
});

// The finding this fixture exists to pin down. Recorded as a test so a future
// change to the capture advice has to confront the actual evidence.
describe('what a view-source capture actually contains', () => {
  const { html } = unwrapViewSource(wrapped);

  it('is the server response before JavaScript fills the page in', () => {
    assert.equal(detectSourceKind(html).kind !== 'fps-estimates-game-page', true);
    assert.equal(/<link rel="canonical"/.test(html), false, 'no canonical URL is served');
    assert.equal(extractSampleSummary(html).value.averageFps, null, 'no average FPS is served');
  });

  // The reason raw source is not a workaround for the borrowed-EFPS problem:
  // CSGO is what the SERVER sends, so no capture route can turn this into the
  // page's own EFPS data.
  it('already carries CSGO as the server-side EFPS default', () => {
    const tokens = new Set(extractEfpsRecords(html, {}).records.map((r) => r.efpsGameToken));
    assert.deepEqual([...tokens], ['CSGO']);
  });
});
