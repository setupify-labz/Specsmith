// Coverage measurement CLI — how many catalog GPUs does the merged Rakuten
// adapter actually find Newegg offers for, and what is it refusing?
//
//   RAKUTEN_API_ACCESS_TOKEN=… npx tsx scripts/retail/coverage/measure-coverage.ts
//
//   --limit N              measure only the first N catalog GPUs (smoke run)
//   --gpu <id>             measure one catalog GPU by id (repeatable)
//   --requests-per-minute  pacing; default 90, hard ceiling 100
//   --json                 emit the report as JSON instead of text
//
// MEASUREMENT ONLY. This command writes nothing: no store, no fixture, no
// production data. It reads src/data/gpus.json, calls the API, and prints
// counts. That is the whole point of running it before anything is built —
// the answer it produces decides whether a storage layer is worth having, and
// a measurement tool that also wrote one would have prejudged that.
//
// WHAT IT WILL NOT PRINT
// ----------------------
// The access token, any tracked affiliate URL, any publisher or offer
// identifier, any image URL, and no free text from the far end at all. The
// report type carries no field able to hold one (see coverageReport.ts), so
// this is structural rather than a promise, and a test renders a report built
// from offers with real linksynergy URLs to prove none survives.
//
// COVERAGE PERCENTAGES EXCLUDE FAILURES
// -------------------------------------
// A GPU whose request failed is reported on its own line, never as a GPU with
// no offers. The two answer different questions — "Newegg stocks none" is
// about the catalogue, "we could not ask" is about the network — and merging
// them would let a bad API minute read as poor coverage.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGpuCatalog, readAccessToken } from '../rakuten';
import type { CatalogGpu } from '../rakuten/types';
import { renderCoverageReport } from './coverageReport';
import { measureCoverage } from './measureCoverage';
import { DEFAULT_REQUESTS_PER_MINUTE, RAKUTEN_CALLS_PER_MINUTE } from './rateLimiter';

export interface CliOptions {
  limit: number | null;
  gpuIds: string[];
  requestsPerMinute: number;
  json: boolean;
}

/** Parses argv. Exported so the argument rules are testable without a process. */
export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { limit: null, gpuIds: [], requestsPerMinute: DEFAULT_REQUESTS_PER_MINUTE, json: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${arg} requires a value.`);
      i += 1;
      return v;
    };
    switch (arg) {
      case '--limit': {
        const n = Number(next());
        if (!Number.isInteger(n) || n < 1) throw new Error('--limit must be a positive integer.');
        options.limit = n;
        break;
      }
      case '--gpu':
        options.gpuIds.push(next());
        break;
      case '--requests-per-minute': {
        const n = Number(next());
        if (!Number.isInteger(n) || n < 1) throw new Error('--requests-per-minute must be a positive integer.');
        if (n > RAKUTEN_CALLS_PER_MINUTE) {
          throw new Error(`--requests-per-minute ${n} exceeds Rakuten's documented ${RAKUTEN_CALLS_PER_MINUTE}/minute limit.`);
        }
        options.requestsPerMinute = n;
        break;
      }
      case '--json':
        options.json = true;
        break;
      default:
        throw new Error(`Unknown argument ${JSON.stringify(arg)}.`);
    }
  }
  return options;
}

/** Applies --gpu / --limit to the catalog. Throws on an id the catalog does not have. */
export function selectGpus(catalog: readonly CatalogGpu[], options: CliOptions): CatalogGpu[] {
  if (options.gpuIds.length > 0) {
    return options.gpuIds.map((id) => {
      const gpu = catalog.find((g) => g.id === id);
      if (!gpu) throw new Error(`No catalog GPU with id ${JSON.stringify(id)}.`);
      return gpu;
    });
  }
  return options.limit === null ? [...catalog] : catalog.slice(0, options.limit);
}

/**
 * Reduces any thrown value to one safe line for the terminal.
 *
 * A stack trace is noise for an operator and, worse, quotes surrounding code
 * and paths; an unscrubbed message can quote a URL or a response body. So the
 * message is flattened to a single line, stripped of anything URL- or
 * parameter-shaped, and capped.
 *
 * This is the CLI's own diagnostics, deliberately separate from the report:
 * the REPORT carries no free text at all (see coverageReport.ts), because it
 * is a document that gets pasted elsewhere. This line is for the person
 * watching the run.
 */
export function oneLineError(cause: unknown, maxLength = 300): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  const line = raw
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b(?:id|offerid|linkid|token|key|secret)=\S*/gi, '[redacted-param]')
    .replace(/\s+/g, ' ')
    .trim();
  const label = cause instanceof Error && cause.name !== 'Error' ? `${cause.name}: ` : '';
  const text = `${label}${line || 'unknown error'}`;
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

async function run(argv: string[]): Promise<void> {
  const options = parseArgs(argv);

  // Fail before the first request if the token is missing, rather than after
  // pacing through a sweep of 401s.
  readAccessToken();

  const selected = selectGpus(loadGpuCatalog(), options);
  if (!options.json) {
    console.error(`Measuring ${selected.length} GPU(s) at ${options.requestsPerMinute} requests/minute…`);
  }

  const report = await measureCoverage({
    catalog: selected,
    requestsPerMinute: options.requestsPerMinute,
    onProgress: options.json
      ? undefined
      : // Progress goes to stderr so `> coverage.txt` captures only the report.
        (done, total, gpu) => {
          const note = gpu.status === 'failed' ? 'FAILED' : `${gpu.accepted} accepted / ${gpu.itemsSeen} seen`;
          console.error(`  [${String(done).padStart(2)}/${total}] ${gpu.gpuId.padEnd(12)} ${note}`);
        },
  });

  console.log(options.json ? JSON.stringify(report, null, 2) : renderCoverageReport(report));

  // Non-zero when any GPU failed outright, so a scripted run notices. Zero
  // accepted offers is NOT an error — it is a finding, and the finding this
  // command exists to produce.
  if (report.totals.failures > 0) process.exitCode = 1;
}

/**
 * Single exit point for every failure mode.
 *
 * One catch around everything, rather than a try/catch per step: a bad flag, a
 * missing token, an unreadable catalog and an unexpected defect all reach the
 * operator the same way — one line, exit 1, no stack. A stack trace here would
 * be the tool reporting its own internals to someone who asked about Newegg
 * offers.
 */
export async function main(argv: string[]): Promise<number> {
  try {
    await run(argv);
    return process.exitCode === undefined ? 0 : Number(process.exitCode);
  } catch (cause) {
    console.error(oneLineError(cause));
    return 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
  // Nothing below this point may throw into the void: an unhandled rejection
  // or a stray synchronous throw would print a stack trace and bypass the
  // single-line contract above.
  process.on('unhandledRejection', (cause) => {
    console.error(oneLineError(cause));
    process.exit(1);
  });
  process.on('uncaughtException', (cause) => {
    console.error(oneLineError(cause));
    process.exit(1);
  });
}
