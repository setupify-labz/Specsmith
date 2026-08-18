// Browser-assisted capture PLANNER.
//
//   node research/userbenchmark/capture/plan-capture.mjs [count]   (default 5)
//
// RESEARCH-ONLY. This script makes no network request. It reads
// capture-manifest.json, takes the next N games that have no saved source, and
// emits three things:
//
//   capture/worklist.json    machine-readable batch (used by verify-capture.mjs)
//   capture/worklist.md      a plain checklist you can follow by hand
//   capture/capture-helper.html  a local page you open in YOUR OWN browser
//
// WHAT THIS DELIBERATELY DOES NOT DO
// ----------------------------------
// It does not fetch, crawl, automate, or script anything against
// userbenchmark.com. It cannot: this environment's egress proxy refuses
// CONNECT for that host (verified — HTTP 403, for curl, for WebFetch, and for
// a browser launched here). More importantly, it shouldn't: driving 50
// automated page loads at an aggregator is bulk collection regardless of
// pacing, and is out of scope by the project's rules.
//
// What the helper page does instead is remove the BOOKKEEPING from a manual
// job: it shows one game at a time, gives you a click-to-open link that opens
// in your normal browser (your session, your cookies, your pace), shows the
// exact filename to save as with a copy button, and remembers which ones you
// have finished. Every page load is a human clicking a link, which is just
// browsing. There is no CAPTCHA handling, no rate-limit evasion, no
// access-control circumvention, and nothing that would work if the site did
// not want a person reading it.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const manifestFile = path.join(root, 'capture-manifest.json');

const DEFAULT_COUNT = 5;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderHelper(batch, generatedAt) {
  const rows = batch
    .map(
      (g, i) => `
      <li class="row" data-id="${esc(g.gameId)}">
        <div class="n">${i + 1}</div>
        <div class="main">
          <div class="name">${esc(g.name)}</div>
          <div class="meta">game id ${esc(g.gameId)}</div>
          <div class="fname"><code id="fn-${esc(g.gameId)}">${esc(g.expectedFilename)}</code>
            <button class="copy" data-fn="${esc(g.expectedFilename)}">copy filename</button>
          </div>
        </div>
        <div class="actions">
          <a class="open" href="${esc(g.url)}" target="_blank" rel="noopener noreferrer">Open page ↗</a>
          <label class="done"><input type="checkbox" class="chk"> saved</label>
        </div>
      </li>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>UserBenchmark capture helper — ${batch.length} pages</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#111; --mut:#666; --line:#e3e3e3; --acc:#0b5cd5; --ok:#0a7a3d; --card:#fafafa; }
  @media (prefers-color-scheme: dark) { :root { --bg:#14161a; --fg:#e9e9ea; --mut:#9aa0a6; --line:#2a2e35; --acc:#7aa9ff; --ok:#57d98a; --card:#1b1e24; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:2rem 1rem 4rem; background:var(--bg); color:var(--fg);
         font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width: 860px; margin: 0 auto; }
  h1 { font-size:1.35rem; margin:0 0 .35rem; }
  .sub { color:var(--mut); margin:0 0 1.25rem; }
  .note { background:var(--card); border:1px solid var(--line); border-left:3px solid var(--acc);
          border-radius:6px; padding:.85rem 1rem; margin:0 0 1.5rem; font-size:.92rem; }
  .note b { font-weight:650; }
  .note ol { margin:.5rem 0 0; padding-left:1.2rem; }
  .note li { margin:.25rem 0; }
  .bar { position:sticky; top:0; background:var(--bg); border-bottom:1px solid var(--line);
         padding:.6rem 0 .7rem; margin-bottom:.5rem; display:flex; gap:.75rem; align-items:center; }
  .bar progress { flex:1; height:9px; }
  .count { font-variant-numeric:tabular-nums; color:var(--mut); font-size:.9rem; white-space:nowrap; }
  ol.list { list-style:none; margin:0; padding:0; }
  .row { display:flex; gap:.9rem; align-items:flex-start; padding:.85rem .9rem; border:1px solid var(--line);
         border-radius:8px; margin-bottom:.55rem; background:var(--card); }
  .row.is-done { opacity:.5; }
  .n { color:var(--mut); font-variant-numeric:tabular-nums; min-width:1.6rem; }
  .main { flex:1; min-width:0; }
  .name { font-weight:600; }
  .meta { color:var(--mut); font-size:.85rem; }
  .fname { margin-top:.4rem; display:flex; gap:.5rem; align-items:center; flex-wrap:wrap; }
  code { background:rgba(127,127,127,.14); padding:.16rem .4rem; border-radius:4px;
         font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace; word-break:break-all; }
  .actions { display:flex; flex-direction:column; gap:.45rem; align-items:flex-end; }
  a.open { color:var(--acc); text-decoration:none; font-weight:600; white-space:nowrap; }
  a.open:hover { text-decoration:underline; }
  button.copy { font:inherit; font-size:.8rem; padding:.2rem .5rem; cursor:pointer;
                background:transparent; color:var(--mut); border:1px solid var(--line); border-radius:4px; }
  button.copy:hover { color:var(--fg); }
  .done { font-size:.85rem; color:var(--mut); white-space:nowrap; cursor:pointer; }
  footer { margin-top:2rem; padding-top:1rem; border-top:1px solid var(--line); color:var(--mut); font-size:.87rem; }
  .reset { font:inherit; font-size:.85rem; background:none; border:none; color:var(--acc); cursor:pointer; padding:0; }
</style>
</head>
<body>
<div class="wrap">
  <h1>UserBenchmark capture helper</h1>
  <p class="sub">${batch.length} page${batch.length === 1 ? '' : 's'} in this batch · generated ${esc(generatedAt)}</p>

  <div class="note">
    <b>How to use this.</b> This page does not download anything. It opens links in your
    normal browser so you can save each page yourself, and keeps track of where you are.
    <ol>
      <li>Click <b>Open page</b>. It opens in a new tab in your usual session.</li>
      <li>Save the complete page: <code>Ctrl</code>/<code>Cmd</code>+<code>S</code> → <b>“Webpage, HTML Only”</b>.
          (<code>Ctrl</code>+<code>U</code> then save also works.)</li>
      <li>Name it <b>exactly</b> the filename shown, and put it in
          <code>research/userbenchmark/pages/</code>.</li>
      <li>Tick <b>saved</b> and move to the next one. Your progress is remembered in this browser.</li>
    </ol>
    Go at a normal reading pace — one page at a time. Nothing here bypasses CAPTCHAs,
    rate limits, or any site protection; if a page asks you to verify you are human,
    just do it as you normally would.
  </div>

  <div class="bar">
    <progress id="prog" max="${batch.length}" value="0"></progress>
    <span class="count"><span id="doneN">0</span> / ${batch.length} saved</span>
  </div>

  <ol class="list">${rows}
  </ol>

  <footer>
    When you have saved what you want, run:<br>
    <code>node research/userbenchmark/capture/verify-capture.mjs</code><br>
    It reports exactly which files arrived, which are missing, and whether each one is
    the game it claims to be — then you can run the ingest.
    <p><button class="reset" id="reset">clear saved progress for this batch</button></p>
  </footer>
</div>
<script>
  var KEY = 'ub-capture-' + ${JSON.stringify(batch.map((g) => g.gameId).join(','))}.length + '-${esc(batch.map((g) => g.gameId).join('-')).slice(0, 40)}';
  var done = {};
  try { done = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { done = {}; }

  function save() { try { localStorage.setItem(KEY, JSON.stringify(done)); } catch (e) {} }
  function refresh() {
    var n = 0;
    document.querySelectorAll('.row').forEach(function (row) {
      var id = row.getAttribute('data-id');
      var on = !!done[id];
      row.classList.toggle('is-done', on);
      row.querySelector('.chk').checked = on;
      if (on) n++;
    });
    document.getElementById('doneN').textContent = n;
    document.getElementById('prog').value = n;
  }

  document.querySelectorAll('.row').forEach(function (row) {
    var id = row.getAttribute('data-id');
    row.querySelector('.chk').addEventListener('change', function (e) {
      if (e.target.checked) done[id] = true; else delete done[id];
      save(); refresh();
    });
  });

  document.querySelectorAll('button.copy').forEach(function (b) {
    b.addEventListener('click', function () {
      var fn = b.getAttribute('data-fn');
      navigator.clipboard.writeText(fn).then(function () {
        var old = b.textContent; b.textContent = 'copied ✓';
        setTimeout(function () { b.textContent = old; }, 1200);
      }, function () {});
    });
  });

  document.getElementById('reset').addEventListener('click', function () {
    done = {}; save(); refresh();
  });

  refresh();
</script>
</body>
</html>
`;
}

function renderChecklist(batch, generatedAt) {
  const L = [];
  L.push('# Capture worklist');
  L.push('');
  L.push(`${batch.length} uncaptured game(s) · generated ${generatedAt}`);
  L.push('');
  L.push('Open `capture/capture-helper.html` in your browser for the click-through version.');
  L.push('This file is the same list in plain text.');
  L.push('');
  L.push('For each row: open the URL, save the complete page as **Webpage, HTML Only**,');
  L.push('name it exactly as shown, and put it in `research/userbenchmark/pages/`.');
  L.push('');
  L.push('| # | Game | Save as | URL |');
  L.push('|---:|---|---|---|');
  batch.forEach((g, i) => {
    L.push(`| ${i + 1} | ${g.name} | \`${g.expectedFilename}\` | ${g.url} |`);
  });
  L.push('');
  L.push('Then run:');
  L.push('');
  L.push('```');
  L.push('node research/userbenchmark/capture/verify-capture.mjs');
  L.push('```');
  L.push('');
  return L.join('\n');
}

async function main() {
  const count = Number(process.argv[2] ?? DEFAULT_COUNT);
  if (!Number.isInteger(count) || count < 1) {
    console.error(`Batch size must be a positive integer; got "${process.argv[2]}".`);
    process.exitCode = 1;
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestFile, 'utf-8'));
  } catch (e) {
    console.error(`Could not read capture-manifest.json (${e.message}). Run ingest.mjs first.`);
    process.exitCode = 1;
    return;
  }

  const uncaptured = manifest.rows.filter((r) => !r.captured);
  if (uncaptured.length === 0) {
    console.log('Every known game already has a saved source. Nothing to plan.');
    return;
  }

  // Manifest order is stable (catalog order), so repeated runs with the same
  // corpus produce the same batch — no shuffling, no surprises.
  const batch = uncaptured.slice(0, count).map((r) => ({
    gameId: r.gameId,
    name: r.name,
    url: r.url,
    expectedFilename: r.expectedFilename,
  }));

  const generatedAt = new Date().toISOString();
  await fs.mkdir(here, { recursive: true });

  await fs.writeFile(
    path.join(here, 'worklist.json'),
    JSON.stringify(
      {
        generatedAt,
        note: 'Capture batch. No network request was made to produce this. Each entry must be saved by a human from their own browser.',
        requested: count,
        batchSize: batch.length,
        totalUncaptured: uncaptured.length,
        games: batch,
      },
      null,
      2,
    ) + '\n',
  );
  await fs.writeFile(path.join(here, 'worklist.md'), renderChecklist(batch, generatedAt));
  await fs.writeFile(path.join(here, 'capture-helper.html'), renderHelper(batch, generatedAt));

  console.log(`Planned ${batch.length} of ${uncaptured.length} uncaptured game(s).`);
  console.log('');
  batch.forEach((g, i) => console.log(`  ${String(i + 1).padStart(2)}. ${g.name} (${g.gameId})  →  ${g.expectedFilename}`));
  console.log('');
  console.log('Wrote:');
  console.log('  capture/worklist.json');
  console.log('  capture/worklist.md');
  console.log('  capture/capture-helper.html   ← open this in your browser');
  console.log('');
  console.log('This tool made no network request. Saving each page is a manual step you');
  console.log('perform in your own browser; then run capture/verify-capture.mjs.');
}

await main();
