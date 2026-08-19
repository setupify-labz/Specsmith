// Sequential browser capture worker.
//
//   node research/userbenchmark/capture/browser-worker.mjs --compare 2
//   node research/userbenchmark/capture/browser-worker.mjs --limit 10
//
// WHAT THIS IS
// ------------
// It drives the machine's own Chrome/Chromium with `--headless --dump-dom`,
// one page at a time, and writes the rendered DOM to disk. That is the
// headless equivalent of the manual Ctrl+S captures the corpus is already
// built from: the browser fetches the page normally, runs its JavaScript, and
// the resulting DOM is serialized. Nothing is intercepted or replayed.
//
// It has NO npm dependency. `--dump-dom` is a stock Chrome flag, so the only
// requirement is a Chrome or Chromium install.
//
// WHY THE DOM AND NOT THE RAW RESPONSE
// ------------------------------------
// §5c/§5d of efps/configuration-analysis.md: the FPS-Estimates page fills
// itself in client-side. The raw server response for Battlefield 6 carried no
// canonical URL and no "Average Fps" block at all. Rendering is not a
// convenience here, it is the only state in which the data exists — which is
// why this worker renders rather than fetching HTML directly.
//
// WHAT IT DELIBERATELY DOES NOT DO
// --------------------------------
// No CAPTCHA solving. No anti-bot evasion, stealth patches, or fingerprint
// spoofing. No user-agent forgery — it is Chrome, and it says so. No retries
// against a refusal. No concurrency. No ignoring robots.txt.
//
// robots.txt is fetched once and enforced before any page is touched, and the
// run aborts if the worklist path is disallowed. Crawl-delay is honoured when
// published, and a floor delay applies regardless. If any page comes back
// looking like a block, a challenge, or simply not the page that was asked
// for, the ENTIRE RUN STOPS — it does not skip ahead to the next URL, because
// a site that just declined one request is not inviting fifty more.
//
// This file writes captures. It does not modify the parser, the verifier, the
// ingest pipeline, or any dataset.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { parseGamePage } from '../lib/game-page.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const pagesDir = path.join(root, 'pages');
const manifestFile = path.join(root, 'capture-manifest.json');

// Overridable ONLY so the worker's own loop can be rehearsed end-to-end
// against a local server holding known-good captures, with no request to the
// real site. It is not a way around anything: whatever origin is set still has
// its robots.txt fetched and enforced.
const ORIGIN = process.env.UB_ORIGIN ?? 'https://www.userbenchmark.com';
const MIN_DELAY_MS = 5000; // floor between page loads, regardless of robots.txt
const NAV_TIMEOUT_MS = 60000;

// ---------------------------------------------------------------------------
// Chrome discovery
// ---------------------------------------------------------------------------

const CHROME_CANDIDATES = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ],
};

async function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const c of CHROME_CANDIDATES[process.platform] ?? CHROME_CANDIDATES.linux) {
    try {
      await fs.access(c);
      return c;
    } catch {
      /* keep looking */
    }
  }
  throw new Error(
    'No Chrome/Chromium found. Install Chrome, or set the CHROME environment variable to its full path.',
  );
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

/** Parses the records that apply to us out of robots.txt.
 *
 * Only the `*` group is consulted, because this worker is a general-purpose
 * client and has no business claiming a more permissive named group. */
export function parseRobots(text) {
  const rules = { disallow: [], allow: [], crawlDelayMs: 0 };
  let inStar = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      inStar = value === '*';
      continue;
    }
    if (!inStar) continue;
    if (field === 'disallow' && value) rules.disallow.push(value);
    else if (field === 'allow' && value) rules.allow.push(value);
    else if (field === 'crawl-delay') {
      const s = Number(value);
      if (Number.isFinite(s) && s > 0) rules.crawlDelayMs = s * 1000;
    }
  }
  return rules;
}

/** Longest-match wins, Allow beating Disallow at equal length — the ordinary
 * precedence rule. Returns true only when the path is permitted. */
export function robotsAllows(rules, pathname) {
  const longest = (patterns) =>
    patterns.filter((p) => pathname.startsWith(p)).reduce((best, p) => (p.length > best ? p.length : best), -1);
  const d = longest(rules.disallow);
  const a = longest(rules.allow);
  if (d < 0) return true;
  return a >= d;
}

async function loadRobots() {
  const res = await fetch(`${ORIGIN}/robots.txt`, { redirect: 'follow' });
  if (res.status === 404) return { rules: { disallow: [], allow: [], crawlDelayMs: 0 }, note: 'no robots.txt (404) — treated as unrestricted' };
  if (!res.ok) throw new Error(`robots.txt returned HTTP ${res.status}. Refusing to proceed without knowing the rules.`);
  const text = await res.text();
  return { rules: parseRobots(text), note: `robots.txt fetched (${text.length} bytes)` };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderPage(chrome, url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--virtual-time-budget=20000`,
      '--dump-dom',
      url,
    ];
    if (process.platform === 'linux') args.unshift('--no-sandbox');

    const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`render timed out after ${NAV_TIMEOUT_MS}ms`));
    }, NAV_TIMEOUT_MS);

    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`chrome exited ${code}: ${err.slice(-400)}`));
      else resolve(out);
    });
  });
}

/** Decides whether a response is the site declining rather than answering.
 *
 * This deliberately does NOT scan the body for words like "captcha". Every
 * genuine FPS-Estimates page carries the FAQ line "Why does UserBenchmark need
 * so many captchas?", so a body-text scan flags all 19 known-good captures as
 * blocked — which is how this was caught. Vocabulary that appears in ordinary
 * page copy cannot be evidence of anything.
 *
 * The authoritative signal is structural and lives in the caller: does the
 * response parse as the FPS-Estimates page we asked for? This function only
 * classifies a response that already failed that test, so the operator gets
 * "the site is refusing" rather than "unrecognised page".
 *
 * Challenge markers are matched against the <title> only, which a challenge
 * page controls and a game page never shares.
 */
export function detectBlock(html) {
  if (html.trim().length < 2000) return 'response was suspiciously small — likely an error or challenge page';

  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  const TITLE_MARKERS = [
    /captcha/i,
    /are you (?:a )?human/i,
    /unusual traffic/i,
    /access denied/i,
    /forbidden/i,
    /blocked/i,
    /just a moment/i,
    /attention required/i,
    /too many requests/i,
    /rate limit/i,
    /^\s*\d{3}\s|\b(4\d\d|5\d\d)\b/,
  ];
  for (const re of TITLE_MARKERS) {
    if (re.test(title)) return `page title indicates a block or challenge: "${title.slice(0, 120)}"`;
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Comparison mode
// ---------------------------------------------------------------------------

function coreFields(parsed) {
  return {
    gameId: parsed.game?.gameId ?? null,
    name: parsed.game?.name ?? null,
    averageFps: parsed.sampleSummary.averageFps,
    totalSamples: parsed.sampleSummary.totalSamples,
    lowSampleWarning: parsed.sampleSummary.lowSampleWarning,
    gpuRows: parsed.gpuTable.length,
    cpuRows: parsed.cpuTable.length,
    efpsAccepted: parsed.efps.stats.accepted,
    efpsRejected: parsed.efps.stats.rejected,
    charts: ['fpsHistogram', 'settingsDistribution', 'resolutionDistribution'].map((k) => parsed[k]?.labels?.length ?? 0),
  };
}

const rowSignature = (parsed, table) =>
  parsed[table].map((r) => [r.name, r.samples, r.benchPercent, r.valuePercent, r.priceUsd, r.componentRatingId].join('~')).join('|');

const chartSignature = (parsed) =>
  ['fpsHistogram', 'settingsDistribution', 'resolutionDistribution']
    .map((k) => JSON.stringify([parsed[k]?.labels ?? [], parsed[k]?.data ?? []]))
    .join('|');

export function compareCaptures(manual, worker) {
  const a = coreFields(manual);
  const b = coreFields(worker);
  const diffs = [];
  for (const k of Object.keys(a)) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs.push({ field: k, manual: a[k], worker: b[k] });
  }
  if (rowSignature(manual, 'gpuTable') !== rowSignature(worker, 'gpuTable')) diffs.push({ field: 'gpuTable(rows)', manual: 'see file', worker: 'differs' });
  if (rowSignature(manual, 'cpuTable') !== rowSignature(worker, 'cpuTable')) diffs.push({ field: 'cpuTable(rows)', manual: 'see file', worker: 'differs' });
  if (chartSignature(manual) !== chartSignature(worker)) diffs.push({ field: 'charts(values)', manual: 'see file', worker: 'differs' });
  return diffs;
}

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const get = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
  };
  return {
    compare: argv.includes('--compare') ? Number(get('--compare', 2)) : 0,
    limit: Number(get('--limit', 2)),
    delayMs: Number(get('--delay', MIN_DELAY_MS)),
    saveDir: get('--out', pagesDir),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf-8'));

  const chrome = await findChrome();
  console.log(`Chrome:   ${chrome}`);

  const { rules, note } = await loadRobots();
  console.log(`robots:   ${note}`);
  if (rules.crawlDelayMs) console.log(`          Crawl-delay: ${rules.crawlDelayMs / 1000}s`);

  const targets = args.compare > 0
    ? manifest.rows.filter((r) => r.captured).slice(0, args.compare)
    : manifest.rows.filter((r) => !r.captured).slice(0, args.limit);

  if (targets.length === 0) {
    console.log('Nothing to do: no matching rows in capture-manifest.json.');
    return;
  }

  for (const t of targets) t.url = t.url.replace('https://www.userbenchmark.com', ORIGIN);

  for (const t of targets) {
    const { pathname } = new URL(t.url);
    if (!robotsAllows(rules, pathname)) {
      console.error(`\nABORT: robots.txt disallows ${pathname}. Not fetching anything.`);
      process.exitCode = 1;
      return;
    }
  }

  const delay = Math.max(args.delayMs, rules.crawlDelayMs, MIN_DELAY_MS);
  console.log(`mode:     ${args.compare > 0 ? `COMPARE against ${targets.length} known-good capture(s)` : `capture ${targets.length} new page(s)`}`);
  console.log(`delay:    ${delay / 1000}s between pages (sequential, one at a time)`);
  console.log('='.repeat(72));

  const results = [];
  for (const [i, t] of targets.entries()) {
    if (i > 0) await sleep(delay);
    process.stdout.write(`[${i + 1}/${targets.length}] ${t.name} (${t.gameId}) … `);

    let html;
    try {
      html = await renderPage(chrome, t.url);
    } catch (e) {
      console.log('RENDER FAILED');
      console.error(`\nSTOPPING: ${e.message}`);
      results.push({ ...t, status: 'render-failed', detail: e.message });
      break;
    }

    // Structural gate first: the only thing that counts as success is the page
    // we asked for, parsed by the same core the ingest uses. detectBlock then
    // explains a failure, it does not define one.
    const parsed = parseGamePage(html, t.expectedFilename);
    if (parsed.game?.gameId !== t.gameId) {
      const blocked = detectBlock(html);
      console.log(blocked ? 'BLOCKED' : 'WRONG PAGE');
      if (blocked) {
        console.error(`\nSTOPPING THE ENTIRE RUN: ${blocked}`);
        console.error('The site declined this request. Not retrying and not continuing to the next URL.');
        results.push({ ...t, status: 'blocked', detail: blocked });
      } else {
        console.error(`\nSTOPPING: expected game ${t.gameId}, page identifies as ${parsed.game?.gameId ?? 'nothing'}.`);
        results.push({ ...t, status: 'wrong-page', detail: `got ${parsed.game?.gameId ?? 'none'}` });
      }
      break;
    }

    if (args.compare > 0) {
      const manualHtml = await fs.readFile(path.join(pagesDir, t.sourceFile), 'utf-8');
      const diffs = compareCaptures(parseGamePage(manualHtml, t.sourceFile), parsed);
      const outFile = path.join(os.tmpdir(), `worker-${t.gameId}.html`);
      await fs.writeFile(outFile, html);
      console.log(diffs.length === 0 ? 'MATCHES manual capture' : `${diffs.length} DIFFERENCE(S)`);
      for (const d of diffs) console.log(`      ${d.field}: manual=${JSON.stringify(d.manual)} worker=${JSON.stringify(d.worker)}`);
      console.log(`      worker output kept at ${outFile}`);
      results.push({ ...t, status: diffs.length === 0 ? 'match' : 'differs', diffs });
    } else {
      const outFile = path.join(args.saveDir, t.expectedFilename);
      await fs.writeFile(outFile, html);
      console.log(`saved ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB → ${path.basename(outFile)}`);
      results.push({ ...t, status: 'captured', bytes: Buffer.byteLength(html) });
    }
  }

  console.log('='.repeat(72));
  const by = (s) => results.filter((r) => r.status === s).length;
  if (args.compare > 0) {
    console.log(`compared ${results.length}: ${by('match')} match, ${by('differs')} differ`);
    console.log(
      by('differs') === 0 && by('match') === results.length && results.length > 0
        ? '\nThe worker reproduces the manual captures exactly. Safe to run without --compare.'
        : '\nDo NOT run without --compare until every field matches.',
    );
  } else {
    console.log(`captured ${by('captured')}/${targets.length}`);
    console.log('\nNow run:  node research/userbenchmark/capture/verify-capture.mjs --ingest');
  }
  if (by('blocked') || by('render-failed') || by('wrong-page')) process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
