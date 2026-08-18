// Verifies a capture batch, then optionally runs the canonical pipeline.
//
//   node research/userbenchmark/capture/verify-capture.mjs           verify only
//   node research/userbenchmark/capture/verify-capture.mjs --ingest  verify, then ingest
//
// RESEARCH-ONLY. Makes no network request. Reads worklist.json and the files
// that are actually sitting in pages/, and reports per game:
//
//   captured      the file exists AND its canonical URL is the game we asked for
//   missing       no file arrived
//   wrong-game    a file with that name exists but is a DIFFERENT game's page
//   not-a-page    the file exists but isn't an FPS-Estimates game page at all
//   unreadable    the file exists but could not be read
//
// The wrong-game and not-a-page checks matter more than they sound. Saving 50
// pages by hand is exactly the situation where a mis-click saves the wrong
// tab, or a browser writes out an error/interstitial page under the right
// filename. Trusting the filename alone would then feed the wrong game's
// numbers into the dataset under another game's id — a data-integrity failure
// that is very hard to spot later. So identity is confirmed from the page's
// own canonical URL, never from what the file is called.
//
// This script never edits, renames, moves or repairs anything. It reports.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { detectSourceKind } from '../lib/game-page.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const pagesDir = path.join(root, 'pages');
const worklistFile = path.join(here, 'worklist.json');

/** Reads the page's own canonical URL. This is the identity check — the
 * filename is treated as a hint, never as evidence. */
function canonicalGameId(html) {
  const m = html.match(/<link rel="canonical" href="[^"]*\/PCGame\/FPS-Estimates-([^/"]+)\/(\d+)\//);
  return m ? { slug: m[1], gameId: m[2] } : null;
}

async function verifyOne(game) {
  const file = path.join(pagesDir, game.expectedFilename);
  let html;
  try {
    html = await fs.readFile(file, 'utf-8');
  } catch (e) {
    if (e.code === 'ENOENT') return { ...game, status: 'missing', detail: 'no file at the expected filename' };
    return { ...game, status: 'unreadable', detail: e.message };
  }

  const bytes = Buffer.byteLength(html);
  const kind = detectSourceKind(html);
  if (kind.kind !== 'fps-estimates-game-page') {
    return { ...game, status: 'not-a-page', bytes, detail: `detected as "${kind.kind}"${kind.note ? ` — ${kind.note}` : ''}` };
  }

  const canon = canonicalGameId(html);
  if (!canon) return { ...game, status: 'not-a-page', bytes, detail: 'no canonical FPS-Estimates URL in the file' };
  if (canon.gameId !== game.gameId) {
    return {
      ...game,
      status: 'wrong-game',
      bytes,
      actualGameId: canon.gameId,
      actualSlug: canon.slug,
      detail: `file is named for game ${game.gameId} but its canonical URL says game ${canon.gameId} (${canon.slug})`,
    };
  }

  return { ...game, status: 'captured', bytes, detail: kind.confident ? 'canonical URL matches; page looks complete' : `canonical URL matches, but: ${kind.note}` };
}

function runIngest() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, 'ingest.mjs')], { stdio: 'inherit' });
    child.on('close', (code) => resolve(code));
  });
}

async function main() {
  const doIngest = process.argv.includes('--ingest');

  let worklist;
  try {
    worklist = JSON.parse(await fs.readFile(worklistFile, 'utf-8'));
  } catch {
    console.error('No capture/worklist.json found. Run plan-capture.mjs first.');
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const g of worklist.games) results.push(await verifyOne(g));

  const by = (s) => results.filter((r) => r.status === s);
  const captured = by('captured');
  const problems = results.filter((r) => r.status !== 'captured' && r.status !== 'missing');

  console.log(`Capture batch of ${results.length} (planned ${worklist.generatedAt})`);
  console.log('='.repeat(72));
  for (const r of results) {
    const mark = { captured: '✓', missing: '·', 'wrong-game': '✗', 'not-a-page': '✗', unreadable: '✗' }[r.status];
    const size = r.bytes ? ` [${(r.bytes / 1024).toFixed(0)} KB]` : '';
    console.log(`  ${mark} ${r.status.padEnd(11)} ${r.name} (${r.gameId})${size}`);
    if (r.status !== 'captured') console.log(`      ${r.detail}`);
  }
  console.log('='.repeat(72));
  console.log(`captured ${captured.length}/${results.length} · missing ${by('missing').length} · problems ${problems.length}`);

  await fs.writeFile(
    path.join(here, 'capture-report.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note: 'Capture verification. No network request was made. Status is decided by each file\'s own canonical URL, not by its filename.',
        worklistGeneratedAt: worklist.generatedAt,
        summary: {
          planned: results.length,
          captured: captured.length,
          missing: by('missing').length,
          wrongGame: by('wrong-game').length,
          notAPage: by('not-a-page').length,
          unreadable: by('unreadable').length,
        },
        results,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Wrote capture/capture-report.json');

  if (problems.length > 0) {
    console.log('');
    console.log('Problem files are NOT ingested-around: fix or remove them before trusting the run.');
    console.log('Nothing was renamed or repaired automatically — that is your call.');
  }

  if (!doIngest) {
    console.log('');
    console.log(captured.length > 0 ? 'Re-run with --ingest to feed these into the pipeline.' : 'Nothing captured yet, so there is nothing to ingest.');
    return;
  }

  if (captured.length === 0) {
    console.log('');
    console.log('Skipping ingest: no page in this batch was captured. Refusing to run a');
    console.log('pipeline that would report success over zero new sources.');
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('Running the canonical pipeline (ingest.mjs) …');
  console.log('='.repeat(72));
  const code = await runIngest();
  if (code !== 0) {
    console.error(`\ningest.mjs exited ${code}.`);
    process.exitCode = code;
  }
}

await main();
