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
// HOW FILES ARE MATCHED TO GAMES
// ------------------------------
// Files are found by scanning pages/ and reading each one's identity out of
// the HTML — never by looking for a name. Browsers name a saved page after
// its <title>, so a normal Ctrl+S produces
//
//     "UserBenchmark_ Can I Run ADR1FT.html"
//
// not the manifest's "FPS-Estimates-ADR1FT-3652.html". Requiring the manifest
// name meant a correctly saved page reported as `missing`, and at 50 pages
// that is 50 renames standing between a good capture batch and a green run.
//
// The manifest is still authoritative for WHICH games are wanted and what each
// one's canonical filename is; it just no longer decides what a file contains.
// That is strictly safer than the old behaviour, because the old lookup would
// happily read a file purely because of its name. Now a mis-saved tab counts
// as the game it actually is, and the game it was supposed to be is reported
// as missing with the mix-up spelled out.
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

/** Resolves which game a saved page IS, from the page itself.
 *
 * Same rule the ingest uses, in the same precedence: the canonical <link>
 * when the page has one, otherwise the core's corroborated self-link
 * inference. Returns null for anything that is not an FPS-Estimates game
 * page, which is what keeps an error page or an unrelated save from being
 * matched to a game just because of where it sits. */
export function resolveIdentity(html) {
  if (detectSourceKind(html).kind !== 'fps-estimates-game-page') return null;

  const canon = canonicalGameId(html);
  if (canon) return { gameId: canon.gameId, slug: canon.slug, source: 'canonical' };

  // Only pages without a canonical link pay for this second parse.
  const parsed = parseGamePage(html, 'identity-probe');
  if (!parsed.game?.gameId) return null;
  return {
    gameId: String(parsed.game.gameId),
    slug: parsed.game.slug ?? null,
    source: parsed.game.identitySource ?? 'inferred',
    evidence: parsed.game.identityEvidence ?? null,
  };
}

/** Reads every saved page in a directory once and resolves what each one is.
 *
 * Takes the directory as an argument so tests can point it at a fixture dir
 * holding browser-named files without disturbing the real pages/. */
export async function scanPages(dir) {
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const file of names.filter((n) => /\.html?$/i.test(n)).sort()) {
    let html;
    try {
      html = await fs.readFile(path.join(dir, file), 'utf-8');
    } catch (e) {
      out.push({ file, html: null, identity: null, readError: e.message });
      continue;
    }
    out.push({ file, html, identity: resolveIdentity(html) });
  }
  return out;
}

/** Matches scanned files to the games the manifest asked for.
 *
 * Matching is on resolved identity alone. The manifest supplies each game's
 * expectedFilename, which is reported (and used to break ties when two saves
 * claim the same game) but never used to find a file. */
export function matchFilesToGames(files, games) {
  const byGameId = new Map();
  for (const f of files) {
    if (!f.identity) continue;
    const list = byGameId.get(f.identity.gameId) ?? [];
    list.push(f);
    byGameId.set(f.identity.gameId, list);
  }

  const claimed = new Set();
  const results = games.map((game) => {
    const candidates = byGameId.get(game.gameId) ?? [];

    if (candidates.length === 0) {
      // Nothing IS this game. If something is nonetheless sitting under this
      // game's manifest filename, say what it actually turned out to be —
      // that is the mis-saved-tab case, and it is exactly what a bare
      // "missing" would hide.
      const atExpectedName = files.find((f) => f.file === game.expectedFilename);
      let detail = 'no saved page in pages/ resolves to this game';
      if (atExpectedName?.identity) {
        detail +=
          ` — note: "${game.expectedFilename}" exists but is game ${atExpectedName.identity.gameId}` +
          ` (${atExpectedName.identity.slug}), so it was counted as that game instead`;
      } else if (atExpectedName) {
        detail += ` — note: "${game.expectedFilename}" exists but is not an FPS-Estimates game page`;
      }
      return { ...game, status: 'missing', detail };
    }

    // Deterministic pick: the canonically named file wins if one exists, so a
    // rename never changes which save is used; otherwise the first by name.
    const chosen = candidates.find((c) => c.file === game.expectedFilename) ?? candidates[0];
    claimed.add(chosen.file);

    const r = classifyCapture(chosen.html, game);
    r.savedAs = chosen.file;
    r.filenameMatchesExpected = chosen.file === game.expectedFilename;

    const notes = [];
    if (!r.filenameMatchesExpected) {
      notes.push(`matched by page identity, saved as "${chosen.file}" (manifest name: "${game.expectedFilename}")`);
    }
    if (candidates.length > 1) {
      // Never silently pick one. Two saves of the same game may differ, and
      // which one fed the dataset has to be visible.
      r.duplicateSources = candidates.map((c) => c.file);
      notes.push(`${candidates.length} saved files resolve to this game (${candidates.map((c) => `"${c.file}"`).join(', ')}); used "${chosen.file}"`);
    }
    if (notes.length > 0) r.detail = `${r.detail} — ${notes.join('; ')}`;
    return r;
  });

  // Files that resolved to a real game outside this batch, and files that
  // resolved to nothing at all. Neither is a batch failure, but a file sitting
  // in pages/ that nothing accounts for should never be invisible.
  const wantedIds = new Set(games.map((g) => g.gameId));
  const unmatched = files
    .filter((f) => f.identity && !claimed.has(f.file) && !wantedIds.has(f.identity.gameId))
    .map((f) => ({ file: f.file, gameId: f.identity.gameId, slug: f.identity.slug, reason: 'resolves to a game outside this batch' }));
  const unclassified = files
    .filter((f) => !f.identity)
    .map((f) => ({ file: f.file, reason: f.readError ? `unreadable: ${f.readError}` : 'not an FPS-Estimates game page' }));

  return { results, unmatched, unclassified };
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

  const files = await scanPages(pagesDir);
  const { results, unmatched, unclassified } = matchFilesToGames(files, worklist.games);

  const by = (s) => results.filter((r) => r.status === s);
  const captured = by('captured');
  const problems = results.filter((r) => r.status !== 'captured' && r.status !== 'missing');

  console.log(`Capture batch of ${results.length} (planned ${worklist.generatedAt})`);
  console.log('='.repeat(72));
  for (const r of results) {
    const mark = { captured: '✓', missing: '·', 'wrong-game': '✗', 'incomplete-save': '⚠', 'not-a-page': '✗', unreadable: '✗' }[r.status];
    const size = r.bytes ? ` [${(r.bytes / 1024).toFixed(0)} KB]` : '';
    const renamed = r.status === 'captured' && r.filenameMatchesExpected === false ? '  ← browser-named save' : '';
    console.log(`  ${mark} ${r.status.padEnd(11)} ${r.name} (${r.gameId})${size}${renamed}`);
    if (r.status !== 'captured') console.log(`      ${r.detail}`);
  }
  console.log('='.repeat(72));

  if (unmatched.length > 0 || unclassified.length > 0) {
    console.log('Files in pages/ not counted toward this batch:');
    for (const u of unmatched) console.log(`  · ${u.file} → game ${u.gameId} (${u.slug}) — outside this batch`);
    for (const u of unclassified) console.log(`  ✗ ${u.file} — ${u.reason}`);
    console.log('='.repeat(72));
  }
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
        note:
          'Capture verification. No network request was made. Files are matched to games by the identity ' +
          'resolved from each page\'s own HTML, never by filename, so browser-default names such as ' +
          '"UserBenchmark_ Can I Run ADR1FT.html" are accepted. The manifest supplies each game\'s expected ' +
          'filename for reporting only.',
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
          filesScanned: files.length,
          matchedByBrowserName: captured.filter((r) => r.filenameMatchesExpected === false).length,
        },
        results,
        filesOutsideBatch: unmatched,
        filesNotClassified: unclassified,
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
