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
// identifier, any image URL. The report type carries no field able to hold
// one (see coverageReport.ts), so this is structural rather than a promise,
// and a test renders a report built from offers with real linksynergy URLs to
// prove none survives.

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

async function main(argv: string[]): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
    return;
  }

  // Fail before the first request if the token is missing, rather than after
  // pacing through a sweep of 401s.
  try {
    readAccessToken();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
    return;
  }

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

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) void main(process.argv.slice(2));
