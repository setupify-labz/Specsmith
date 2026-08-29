// Validation gates for a live coverage sweep, asserted against the JSON report.
//
//   npx tsx scripts/retail/coverage/assert-coverage-gates.ts \
//     --report "$RUNNER_TEMP/coverage.json" --sweep-exit 0
//
// WHY A SEPARATE STEP FROM THE SWEEP
// ----------------------------------
// The sweep is the only thing that needs the API token. Splitting the gates
// into their own process means this file — the one that renders a report into
// a CI log and a step summary — never has the credential in its environment at
// all. A leak here is not "unlikely", it is unreachable.
//
// It also means one live sweep produces both the machine assertions and the
// human report. Re-running the CLI to render text would double the API calls
// against a rate-limited account for output we already have.
//
// WHAT IS ASSERTED, AND WHAT IS DELIBERATELY NOT
// ----------------------------------------------
// Asserted: every GPU attempted was measured, no failures of any category, no
// paging refusals, no `empty-shape-not-yet-observed`, internally consistent
// per-GPU counts, and a report that still says availability is unknown.
//
// NOT asserted: how many GPUs have no feed listing, how many offers were
// accepted, or any price. The feed changes between runs. The previous sweep's
// 39 no-listing GPUs are evidence about one moment, not an invariant, and a
// gate that pinned them would fail the day Newegg listed one more card.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGpuCatalog } from '../rakuten';
import { renderCoverageReport, type CoverageReport } from './coverageReport';

export interface GateResult {
  name: string;
  passed: boolean;
  detail: string;
}

/**
 * Phrases a coverage report may never contain.
 *
 * The feed is a catalogue of listings, not an inventory: a part can be on a
 * shelf and absent from it. Every one of these would turn "no matching feed
 * listing" into a stock claim the data cannot support.
 */
const FORBIDDEN_CLAIMS: readonly RegExp[] = [
  /\bin stock\b/i,
  /\bout of stock\b/i,
  /\bunavailable\b/i,
  /\bsold out\b/i,
  /\bno longer available\b/i,
  /\bNewegg has none\b/i,
  /\bstocks nothing\b/i,
  /\bdiscontinued\b/i,
];

/**
 * Patterns that must not appear in anything this job prints.
 *
 * Deliberately does NOT compare against the token's value: this process never
 * receives the secret, and reading it in order to check for it would put it
 * somewhere it currently is not. These are shape checks on the output alone.
 */
const FORBIDDEN_LEAKS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /https?:\/\//i, label: 'a URL' },
  { pattern: /\blinksynergy\b/i, label: 'a tracked-link host' },
  { pattern: /\boffer_?id\b/i, label: 'an offer identifier' },
  { pattern: /\bN82E\d/i, label: 'a Newegg SKU' },
  { pattern: /\bbearer\b/i, label: 'a bearer credential' },
  { pattern: /\bauthorization\b/i, label: 'an authorization header' },
  { pattern: /\btoken\b/i, label: 'a token' },
];

/** Reads and shallowly validates the report file. Throws with a short message. */
export function readReport(file: string): CoverageReport {
  if (!fs.existsSync(file)) {
    throw new Error(`No coverage report at ${path.basename(file)} — the sweep did not produce one.`);
  }
  const raw = fs.readFileSync(file, 'utf-8').trim();
  if (raw === '') {
    throw new Error(`Coverage report ${path.basename(file)} is empty — the sweep produced no JSON.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The body is not quoted: a malformed report could contain anything, and
    // this message goes into a CI log.
    throw new Error(`Coverage report ${path.basename(file)} is not valid JSON (${raw.length} bytes).`);
  }
  const report = parsed as Partial<CoverageReport>;
  if (typeof report.gpusMeasured !== 'number' || !Array.isArray(report.gpus) || typeof report.totals !== 'object') {
    throw new Error('Coverage report is missing required fields — it is not a coverage report.');
  }
  return parsed as CoverageReport;
}

/**
 * Every gate, evaluated. Pure: takes the report and the catalogue size, returns
 * results, prints nothing — so the whole gate set is testable without a run.
 */
export function evaluateGates(report: CoverageReport, catalogSize: number, sweepExit: number): GateResult[] {
  const t = report.totals;
  const gates: GateResult[] = [];
  const gate = (name: string, passed: boolean, detail: string) => gates.push({ name, passed, detail });

  gate(
    'every catalogue GPU attempted',
    report.gpusMeasured === catalogSize,
    `attempted ${report.gpusMeasured} of ${catalogSize} catalogue GPUs`,
  );
  gate(
    'every attempted GPU measured',
    report.gpusSucceeded === report.gpusMeasured,
    `measured OK ${report.gpusSucceeded} of ${report.gpusMeasured}`,
  );
  gate('no failed GPUs', t.failures === 0, `failed ${t.failures}`);
  gate(
    'no HTTP, auth, transport or rate-limit failures',
    t.httpErrors === 0 && t.transportErrors === 0 && t.rateLimited === 0,
    `http ${t.httpErrors}, transport ${t.transportErrors}, 429 ${t.rateLimited}`,
  );

  const byCategory = report.failuresByCategory ?? {};
  const nonZeroCategories = Object.entries(byCategory).filter(([, n]) => n > 0);
  gate(
    'no failure of any category',
    nonZeroCategories.length === 0,
    nonZeroCategories.length === 0 ? 'all categories zero' : nonZeroCategories.map(([c, n]) => `${c}=${n}`).join(', '),
  );

  const paging = report.pagingFailuresByReason ?? {};
  gate('no paging failures', Object.keys(paging).length === 0, Object.keys(paging).length === 0 ? 'none' : JSON.stringify(paging));
  gate(
    'no empty-shape-not-yet-observed',
    (paging['empty-shape-not-yet-observed'] ?? 0) === 0,
    `count ${paging['empty-shape-not-yet-observed'] ?? 0}`,
  );

  // The correction working: a zero-result body is a successful measurement
  // reported as "no matching feed listing", never a failure.
  const emptyIds = report.emptyResultGpuIds ?? [];
  const zeroIds = new Set(report.zeroOfferGpuIds ?? []);
  const strays = emptyIds.filter((id) => !zeroIds.has(id));
  gate(
    'empty results are successful zeroes',
    strays.length === 0,
    `${emptyIds.length} GPU(s) with no matching feed listing, all counted as measured zeroes`,
  );

  // Result-bearing GPUs still judged normally: every listing seen is either
  // accepted or rejected, never dropped.
  const inconsistent = report.gpus.filter((g) => g.accepted + g.rejected !== g.itemsSeen);
  gate(
    'every listing seen was accepted or rejected',
    inconsistent.length === 0,
    inconsistent.length === 0
      ? `${t.itemsSeen} listing(s) seen, ${t.accepted} accepted, ${t.rejected} rejected`
      : `${inconsistent.length} GPU(s) with unaccounted listings: ${inconsistent.map((g) => g.gpuId).join(', ')}`,
  );

  const rendered = renderCoverageReport(report);
  gate('report states availability is unknown', /Availability is UNKNOWN/i.test(rendered), 'availability disclaimer present');

  const claims = FORBIDDEN_CLAIMS.filter((p) => p.test(rendered));
  gate('no stock claim anywhere in the report', claims.length === 0, claims.length === 0 ? 'none' : claims.map(String).join(', '));

  const leaks = FORBIDDEN_LEAKS.filter(({ pattern }) => pattern.test(rendered));
  gate(
    'report carries no URL, identifier or credential-shaped text',
    leaks.length === 0,
    leaks.length === 0 ? 'clean' : leaks.map((l) => l.label).join(', '),
  );

  gate('coverage CLI exited zero', sweepExit === 0, `exit ${sweepExit}`);

  return gates;
}

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

/** Renders gates as a Markdown block for the GitHub step summary. */
export function renderGateSummary(gates: readonly GateResult[], report: CoverageReport): string {
  const t = report.totals;
  const emptyCount = (report.emptyResultGpuIds ?? []).length;
  const zeroCount = (report.zeroOfferGpuIds ?? []).length;
  const lines: string[] = [];

  lines.push('## Live GPU coverage validation');
  lines.push('');
  lines.push('| Measure | Value |');
  lines.push('| --- | ---: |');
  lines.push(`| GPUs attempted | ${report.gpusMeasured} |`);
  lines.push(`| Measured OK | ${report.gpusSucceeded} |`);
  lines.push(`| Failed | ${t.failures} |`);
  lines.push(`| With accepted offers | ${report.gpusSucceeded - zeroCount} |`);
  lines.push(`| No matching feed listing | ${emptyCount} |`);
  lines.push(`| Listings returned, all rejected | ${zeroCount - emptyCount} |`);
  lines.push(`| Listings seen | ${t.itemsSeen} |`);
  lines.push(`| Accepted | ${t.accepted} |`);
  lines.push(`| Rejected | ${t.rejected} |`);
  lines.push(`| Requests | ${t.requests} |`);
  lines.push(`| 429 responses | ${t.rateLimited} |`);
  lines.push('');
  lines.push('### Gates');
  lines.push('');
  for (const g of gates) lines.push(`- ${g.passed ? '✅' : '❌'} **${g.name}** — ${g.detail}`);
  lines.push('');
  lines.push('> Availability is unknown for every GPU. The Product Search feed is a catalogue of');
  lines.push('> listings, not an inventory: absence from it means no matching feed listing, and says');
  lines.push('> nothing about whether the retailer holds the part.');
  lines.push('');
  lines.push('<details><summary>Full coverage report</summary>');
  lines.push('');
  lines.push('```');
  lines.push(renderCoverageReport(report));
  lines.push('```');
  lines.push('');
  lines.push('</details>');
  return lines.join('\n');
}

/**
 * Refuses to emit anything containing a URL, identifier or credential shape.
 *
 * Runs over the FINAL text, after rendering — so it covers the summary table
 * and the embedded report together, not just the pieces checked individually.
 */
export function assertEmissionSafe(text: string): void {
  for (const { pattern, label } of FORBIDDEN_LEAKS) {
    if (pattern.test(text)) {
      throw new Error(`Refusing to publish the summary: it contains ${label}.`);
    }
  }
}

async function run(argv: string[]): Promise<number> {
  const reportFile = flag(argv, 'report');
  if (!reportFile) throw new Error('Usage: assert-coverage-gates.ts --report <file.json> [--sweep-exit N]');
  const sweepExitRaw = flag(argv, 'sweep-exit') ?? '0';
  if (!/^\d+$/.test(sweepExitRaw)) throw new Error('--sweep-exit must be a non-negative integer.');

  const report = readReport(reportFile);
  const catalogSize = loadGpuCatalog().length;
  const gates = evaluateGates(report, catalogSize, Number(sweepExitRaw));

  const summary = renderGateSummary(gates, report);
  assertEmissionSafe(summary);

  console.log(summary);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) fs.appendFileSync(summaryFile, `${summary}\n`);

  const failed = gates.filter((g) => !g.passed);
  if (failed.length > 0) {
    console.error(`\n${failed.length} gate(s) failed:`);
    for (const g of failed) console.error(`  - ${g.name}: ${g.detail}`);
    return 1;
  }
  console.error(`\nAll ${gates.length} gates passed.`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  try {
    return await run(argv);
  } catch (cause) {
    // One clean line. No stack: it would quote paths and surrounding code.
    console.error(cause instanceof Error ? cause.message : String(cause));
    return 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
