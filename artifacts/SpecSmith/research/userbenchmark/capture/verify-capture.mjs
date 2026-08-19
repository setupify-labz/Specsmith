// Verifies a capture batch, then optionally runs the canonical pipeline.
//
//   node research/userbenchmark/capture/verify-capture.mjs           verify only
//   node research/userbenchmark/capture/verify-capture.mjs --ingest  verify, then ingest
//
// RESEARCH-ONLY. Makes no network request. Reads worklist.json and the files
// that are actually sitting in pages/, and reports per game:
//
//   captured         the file exists, is the game we asked for, and is complete
//   missing          no file arrived
//   wrong-game       a file with that name exists but is a DIFFERENT game's page
//   incomplete-save  the right game, but the page's inline scripts were stripped
//   not-a-page       the file exists but isn't an FPS-Estimates game page at all
//   unreadable       the file exists but could not be read
//
// The wrong-game and not-a-page checks matter more than they sound. Saving 50
// pages by hand is exactly the situation where a mis-click saves the wrong
// tab, or a browser writes out an error/interstitial page under the right
// filename. Trusting the filename alone would then feed the wrong game's
// numbers into the dataset under another game's id — a data-integrity failure
// that is very hard to spot later. So identity is confirmed from the page
// itself, never from what the file is called.
//
// Identity is decided by the same canonical core the ingest uses, so this tool
// and the pipeline can never disagree about what a file is. A canonical <link>
// is the preferred evidence; a real minority of saved pages ship without one
// (ADR1FT and AdVenture Capitalist both do), and for those the core establishes
// identity by corroborated self-link dominance and says so. Re-deriving
// identity here from a canonical-only regex would report pages the pipeline
// ingests cleanly as failed captures.
//
// WHY incomplete-save EXISTS
// --------------------------
// The EFPS records and all three chart datasets live inside INLINE <script>
// blocks, not in the rendered DOM. Many "save complete page" tools — browser
// extensions especially — strip or neutralise scripts by default. The result
// is a file that looks entirely healthy: correct canonical URL, correct game
// name, correct average FPS and sample count, all 20 GPU and 20 CPU rows —
// and ZERO EFPS records, down from ~200.
//
// Measured on the real CS:GO page vs. the same page with script bodies
// removed: 200 EFPS → 0, three chart datasets → 0, while every other check
// still passed. Without this status the batch would report "50/50 captured"
// and the ingest would report "0 validation errors" while ~10,000 EFPS
// records were silently lost. Reporting the most reassuring possible output at
// the exact moment the data is gone is the worst failure mode this tool could
// have, so it is checked explicitly.
//
// Detection uses the presence of inline script BODIES, not a count of EFPS
// records. A genuinely sparse game could legitimately publish few or no EFPS
// records, and must not be flagged for that; what it cannot do is arrive with
// its script bodies emptied. Measured separation is categorical, not a
// threshold: real pages carry 17 non-empty inline scripts (72k–102k chars);
// a stripped save carries 0, while keeping the same 26 <script> tags.
//
// This script never edits, renames, moves or repairs anything. It reports.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { detectSourceKind, parseGamePage } from '../lib/game-page.mjs';

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

/** Counts inline <script> blocks that actually carry a body.
 *
 * The tag count alone is useless — a stripped save keeps all 26 <script> tags
 * and simply empties them. What changes is how many have content. */
function inlineScriptStats(html) {
  let tags = 0;
  let withBody = 0;
  let bodyChars = 0;
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    tags++;
    const body = m[1].trim();
    if (body.length > 0) {
      withBody++;
      bodyChars += body.length;
    }
  }
  return { tags, withBody, bodyChars };
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
  return classifyCapture(html, game);
}

/** Decides a capture's status from the page content alone.
 *
 * Split out from verifyOne (which owns the file IO) purely so the
 * classification rules — identity, wrong-game, completeness — are reachable
 * from tests without staging fixture files in pages/. */
export function classifyCapture(html, game) {
  const bytes = Buffer.byteLength(html);
  const kind = detectSourceKind(html);
  if (kind.kind !== 'fps-estimates-game-page') {
    return { ...game, status: 'not-a-page', bytes, detail: `detected as "${kind.kind}"${kind.note ? ` — ${kind.note}` : ''}` };
  }

  // --- identity -------------------------------------------------------------
  // Parsed through the canonical core so this reports exactly what the ingest
  // would extract, and decides identity exactly the way the ingest decides it
  // — no second parser, no separate EFPS scanner, no second identity rule.
  const scripts = inlineScriptStats(html);
  const parsed = parseGamePage(html, game.expectedFilename);

  const canon = canonicalGameId(html);
  const identity = canon
    ? { gameId: canon.gameId, slug: canon.slug, source: 'canonical' }
    : parsed.game?.gameId
      ? {
          gameId: String(parsed.game.gameId),
          slug: parsed.game.slug ?? null,
          source: parsed.game.identitySource ?? 'inferred',
          evidence: parsed.game.identityEvidence ?? null,
        }
      : null;

  if (!identity) {
    return {
      ...game,
      status: 'not-a-page',
      bytes,
      detail: 'no canonical FPS-Estimates URL, and no identity could be established from the page itself',
    };
  }
  if (identity.gameId !== game.gameId) {
    return {
      ...game,
      status: 'wrong-game',
      bytes,
      actualGameId: identity.gameId,
      actualSlug: identity.slug,
      identitySource: identity.source,
      detail:
        `file is named for game ${game.gameId} but the page identifies itself as game ` +
        `${identity.gameId} (${identity.slug}) via ${identity.source}`,
    };
  }

  // --- completeness ---------------------------------------------------------
  const efpsCount = parsed.efps?.stats?.accepted ?? 0;
  const chartsWithData = ['fpsHistogram', 'settingsDistribution', 'resolutionDistribution'].filter(
    (k) => (parsed[k]?.labels?.length ?? 0) > 0,
  ).length;
  const detail = {
    bytes,
    inlineScriptsWithBody: scripts.withBody,
    inlineScriptChars: scripts.bodyChars,
    efpsCount,
    efpsObjectsOnPage: parsed.efps?.stats?.total ?? 0,
    efpsQuarantinedAsOtherGame: (parsed.efps?.rejected ?? []).filter((r) => r.reason === 'efps-game-token-mismatch').length,
    chartsWithData,
    identitySource: identity.source,
  };

  if (scripts.withBody === 0) {
    return {
      ...game,
      status: 'incomplete-save',
      ...detail,
      detail:
        `the right game, but all ${scripts.tags} inline <script> blocks are empty — the EFPS records and chart data live in those blocks, ` +
        `so this save yields ${efpsCount} EFPS records instead of ~200. Re-save with "Webpage, HTML Only", or enable script retention in whatever tool produced it.`,
    };
  }

  // Scripts survived but carry neither EFPS records nor any chart data: the
  // data-bearing blocks specifically are gone. A genuinely sparse game would
  // still ship its chart scripts, so this is a partial strip, not a thin game.
  if (efpsCount === 0 && chartsWithData === 0) {
    return {
      ...game,
      status: 'incomplete-save',
      ...detail,
      detail:
        `the right game and ${scripts.withBody} inline script(s) survived, but the page carries no EFPS records AND no chart data — ` +
        'the data-bearing scripts appear to have been removed or rewritten. Re-save with "Webpage, HTML Only".',
    };
  }

  // Zero accepted EFPS is reported, never assumed away — but WHY it is zero
  // matters and the two causes look identical in a bare count. A genuinely
  // low-sample game ships no EFPS objects at all. A low-profile game's page
  // ships ~200 objects belonging to a DIFFERENT game (CSGO's dataset is the
  // usual filler), which the core quarantines by game token. Collapsing both
  // to "plausible for a low-sample game" would hide the borrowed-dataset case
  // entirely, so the quarantine is called out by name and count.
  const efpsSeen = parsed.efps?.stats?.total ?? 0;
  const borrowed = (parsed.efps?.rejected ?? []).filter((r) => r.reason === 'efps-game-token-mismatch');
  const borrowedTokens = [...new Set(borrowed.map((r) => r.efpsGameToken).filter(Boolean))];

  let note;
  if (efpsCount > 0) {
    note = `identity confirmed; ${efpsCount} EFPS records, ${chartsWithData}/3 charts`;
  } else if (borrowed.length > 0) {
    note =
      `complete save, but 0 usable EFPS records: all ${borrowed.length} of the ${efpsSeen} EFPS objects on the page belong to ` +
      `another game (${borrowedTokens.join(', ')}) and were quarantined. This is the page's own content, not a capture fault — ` +
      `re-saving will not change it. ${chartsWithData}/3 charts present.`;
  } else {
    note = `complete save, but 0 EFPS records (${chartsWithData}/3 charts present) — plausible for a low-sample game; verify against the live page if it matters`;
  }

  // An inferred identity is never passed off as a canonical one — a reader of
  // this report must be able to see which pages were matched on weaker evidence.
  const idNote =
    identity.source === 'canonical'
      ? note
      : `${note} — identity established via ${identity.source} (no canonical <link> on this page)`;

  return { ...game, status: 'captured', ...detail, detail: kind.confident ? idNote : `${idNote} — but: ${kind.note}` };
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
    const mark = { captured: '✓', missing: '·', 'wrong-game': '✗', 'incomplete-save': '⚠', 'not-a-page': '✗', unreadable: '✗' }[r.status];
    const size = r.bytes ? ` [${(r.bytes / 1024).toFixed(0)} KB]` : '';
    console.log(`  ${mark} ${r.status.padEnd(11)} ${r.name} (${r.gameId})${size}`);
    if (r.status !== 'captured') console.log(`      ${r.detail}`);
  }
  console.log('='.repeat(72));
  const efpsTotal = captured.reduce((n, r) => n + (r.efpsCount ?? 0), 0);
  console.log(
    `captured ${captured.length}/${results.length} · missing ${by('missing').length} · incomplete ${by('incomplete-save').length} · ` +
      `other problems ${problems.length - by('incomplete-save').length} · ${efpsTotal} EFPS records across captured pages`,
  );

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
          incompleteSave: by('incomplete-save').length,
          notAPage: by('not-a-page').length,
          unreadable: by('unreadable').length,
          totalEfpsRecords: captured.reduce((n, r) => n + (r.efpsCount ?? 0), 0),
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
    if (by('incomplete-save').length > 0) {
      console.log('');
      console.log(`${by('incomplete-save').length} file(s) are the RIGHT game but had their inline scripts stripped.`);
      console.log('Those pages would ingest cleanly and silently contribute 0 EFPS records.');
      console.log('Re-save them with Ctrl+S -> "Webpage, HTML Only" (not "Webpage, Complete"),');
      console.log('or turn off script removal in whichever extension produced them.');
    }
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

// Only run when invoked as a script. classifyCapture is imported by the test
// suite, and an unguarded top-level `await main()` would run a full 50-page
// verification (and possibly an ingest) as a side effect of that import.
const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
