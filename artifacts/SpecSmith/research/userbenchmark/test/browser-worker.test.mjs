// Tests for the sequential browser capture worker's decision logic.
//
// The parts worth pinning are the ones that decide whether to make a request
// at all, and whether a response counts as an answer or a refusal. Getting
// either wrong is what turns a well-behaved worker into a badly-behaved one.

import { describe, it, assert } from './harness.mjs';
import { parseRobots, robotsAllows, detectBlock, compareCaptures } from '../capture/browser-worker.mjs';
import { parseGamePage } from '../lib/game-page.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pagesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pages');

describe('worker: robots.txt is parsed and obeyed', () => {
  it('reads Disallow, Allow and Crawl-delay from the * group', () => {
    const r = parseRobots('User-agent: *\nDisallow: /Admin\nAllow: /Admin/Public\nCrawl-delay: 3\n');
    assert.deepEqual(r.disallow, ['/Admin']);
    assert.deepEqual(r.allow, ['/Admin/Public']);
    assert.equal(r.crawlDelayMs, 3000);
  });

  // Rules addressed to another crawler are not ours to take advantage of.
  it('ignores groups addressed to a different user-agent', () => {
    const r = parseRobots('User-agent: SomeBot\nDisallow: /\n\nUser-agent: *\nDisallow: /Admin\n');
    assert.deepEqual(r.disallow, ['/Admin']);
  });

  it('blocks a disallowed path and permits others', () => {
    const r = parseRobots('User-agent: *\nDisallow: /PCGame\n');
    assert.equal(robotsAllows(r, '/PCGame/FPS-Estimates-Fortnite/3954/0.0.0.0.0'), false);
    assert.equal(robotsAllows(r, '/Search'), true);
  });

  it('lets a longer Allow override a shorter Disallow', () => {
    const r = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a/b\n');
    assert.equal(robotsAllows(r, '/a/x'), false);
    assert.equal(robotsAllows(r, '/a/b/c'), true);
  });

  it('treats an empty ruleset as unrestricted', () => {
    assert.equal(robotsAllows(parseRobots(''), '/anything'), true);
  });
});

describe('worker: telling a refusal from an answer', () => {
  // The regression that produced this test. Every genuine page carries the FAQ
  // line "Why does UserBenchmark need so many captchas?", so a body-text scan
  // for that word flagged all 19 known-good captures as blocked. Vocabulary
  // occurring in ordinary page copy is not evidence of anything.
  it('never flags a known-good capture as blocked', () => {
    const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith('.html'));
    assert.ok(files.length > 0);
    for (const f of files) {
      const verdict = detectBlock(fs.readFileSync(path.join(pagesDir, f), 'utf-8'));
      assert.equal(verdict, null, `${f} was wrongly classified as blocked: ${verdict}`);
    }
  });

  it('still recognises a real challenge or error page by its title', () => {
    const body = 'x'.repeat(3000);
    for (const title of ['Just a moment...', '403 Forbidden', 'Access Denied', 'Attention Required!', 'Too Many Requests']) {
      const html = `<html><head><title>${title}</title></head><body>${body}</body></html>`;
      assert.ok(detectBlock(html), `"${title}" should be treated as a refusal`);
    }
  });

  it('treats a truncated response as a refusal rather than data', () => {
    assert.ok(detectBlock('<html></html>'));
  });
});

describe('worker: comparison against a known-good capture', () => {
  const load = (f) => parseGamePage(fs.readFileSync(path.join(pagesDir, f), 'utf-8'), f);
  const battlerite = load('FPS-Estimates-Battlerite-3666.html');

  it('reports no differences when the captures agree', () => {
    assert.deepEqual(compareCaptures(battlerite, battlerite), []);
  });

  it('reports a difference in a core field', () => {
    const altered = JSON.parse(JSON.stringify(battlerite));
    altered.sampleSummary.averageFps = 1;
    const diffs = compareCaptures(battlerite, altered);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].field, 'averageFps');
  });

  // A short table is the failure most likely to slip through unnoticed, so the
  // comparison has to catch row-level loss, not just field counts.
  it('reports a difference when a component row goes missing', () => {
    const altered = JSON.parse(JSON.stringify(battlerite));
    altered.gpuTable = altered.gpuTable.slice(0, -1);
    const fields = compareCaptures(battlerite, altered).map((d) => d.field);
    assert.ok(fields.includes('gpuRows'), `expected gpuRows difference, got ${fields.join(', ')}`);
    assert.ok(fields.includes('gpuTable(rows)'), `expected row-signature difference, got ${fields.join(', ')}`);
  });

  it('reports a difference when chart values change', () => {
    const altered = JSON.parse(JSON.stringify(battlerite));
    altered.fpsHistogram.data[0] = altered.fpsHistogram.data[0] + 1;
    const fields = compareCaptures(battlerite, altered).map((d) => d.field);
    assert.ok(fields.includes('charts(values)'), `expected charts(values), got ${fields.join(', ')}`);
  });
});
