// Publishes the GPU offer snapshot.
//
//   RAKUTEN_API_ACCESS_TOKEN=… npx tsx scripts/retail/snapshot/write-gpu-offer-snapshot.ts
//
//   --out <file>           where to publish; default public/data/gpu-offers.json
//   --requests-per-minute  pacing; default 90, hard ceiling 100
//   --dry-run              sweep and decide, but write nothing
//
// WHAT IT PRINTS
// --------------
// Counts and closed codes. Never the token, never a tracked affiliate URL,
// never a publisher or offer identifier, never a product name or price, and no
// free text from the far end at all — a run's output ends up in a CI log.
// The snapshot FILE carries the links and prices, because that is what it is
// for; the terminal output carries none of it.
//
// IT REFUSES MORE OFTEN THAN IT WRITES
// ------------------------------------
// Every publishing rule lives in buildSnapshot.ts and is decided before this
// command touches the filesystem: any failed GPU, a collapsed store, or a
// result that does not validate all mean the previously published file stays
// exactly as it is. Exit 1 with a code and the counts, and nothing changed.
//
// Nothing here reports stock. The feed is a catalogue of listings, not an
// inventory, so availability is unknown for every offer written.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGpuCatalog, readAccessToken } from '../rakuten';
import { DEFAULT_REQUESTS_PER_MINUTE, RAKUTEN_CALLS_PER_MINUTE } from '../coverage/rateLimiter';
import { buildSnapshot, describeRefusal, snapshotSize } from './buildSnapshot';
import { sweepOffers } from './sweepOffers';
import { describePublishedRead, readPublishedSnapshot, writeSnapshotAtomically } from './writeSnapshot';

const here = path.dirname(fileURLToPath(import.meta.url));
/** artifacts/SpecSmith/scripts/retail/snapshot -> artifacts/SpecSmith */
const appRoot = path.resolve(here, '..', '..', '..');

/**
 * Published under public/data/ so the browser can fetch it by a fixed name.
 *
 * Not src/data/: that would bundle dated prices into content-hashed
 * JavaScript, and would make "no snapshot yet" a build error instead of a
 * state the loader can report.
 */
export const DEFAULT_SNAPSHOT_PATH = path.join(appRoot, 'public', 'data', 'gpu-offers.json');

export interface CliOptions {
  out: string;
  requestsPerMinute: number;
  dryRun: boolean;
}

export function parseArgs(argv: readonly string[], defaultOut: string = DEFAULT_SNAPSHOT_PATH): CliOptions {
  const options: CliOptions = { out: defaultOut, requestsPerMinute: DEFAULT_REQUESTS_PER_MINUTE, dryRun: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${arg} requires a value.`);
      i += 1;
      return v;
    };
    switch (arg) {
      case '--out':
        options.out = next();
        break;
      case '--requests-per-minute': {
        const n = Number(next());
        if (!Number.isInteger(n) || n < 1) throw new Error('--requests-per-minute must be a positive integer.');
        if (n > RAKUTEN_CALLS_PER_MINUTE) {
          throw new Error(`--requests-per-minute ${n} exceeds the documented ${RAKUTEN_CALLS_PER_MINUTE}/minute limit.`);
        }
        options.requestsPerMinute = n;
        break;
      }
      case '--dry-run':
        options.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument ${JSON.stringify(arg)}.`);
    }
  }
  return options;
}

/**
 * Reduces any thrown value to one safe line.
 *
 * The same treatment measure-coverage.ts gives its own diagnostics, and for
 * the same reason: a stack quotes surrounding code and paths, and an unscrubbed
 * message can quote a URL or a response body.
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

async function run(argv: string[]): Promise<number> {
  const options = parseArgs(argv);

  // Fail before the first request rather than after pacing through a sweep of
  // 401s. readAccessToken throws without echoing the value.
  readAccessToken();

  const catalog = loadGpuCatalog();

  // BEFORE the sweep, because the answer decides whether to sweep at all. Only
  // ENOENT is a green light without a baseline: an unreadable or invalid
  // existing file means collapse protection has nothing to compare against,
  // and continuing would let this run replace a file that is already in an
  // unknown state with whatever the feed happens to say today.
  const existing = readPublishedSnapshot(options.out);
  console.error(describePublishedRead(existing));
  if (existing.status !== 'ok' && existing.status !== 'absent') {
    console.error('Refusing to sweep or write. Repair or remove the published snapshot first; nothing has been changed.');
    return 1;
  }

  console.error(`Sweeping ${catalog.length} GPU(s) at ${options.requestsPerMinute} requests/minute…`);
  const sweep = await sweepOffers({
    catalog,
    requestsPerMinute: options.requestsPerMinute,
    onProgress: (done, total, outcome) => {
      const note = outcome.status === 'failed' ? `FAILED [${outcome.failure.category}]` : `${outcome.offers.length} accepted`;
      console.error(`  [${String(done).padStart(2)}/${total}] ${outcome.gpuId.padEnd(12)} ${note}`);
    },
  });

  const built = buildSnapshot({
    // The catalogue as it was READ, not as the sweep reports it. This is the
    // only place that knows what the run set out to cover.
    expectedGpuIds: catalog.map((g) => g.id),
    outcomes: sweep.outcomes,
    generatedAt: sweep.finishedAt,
    previous: existing.status === 'ok' ? existing.snapshot : null,
  });

  if (!built.ok) {
    console.error(describeRefusal(built.refusal));
    console.error('The previously published snapshot is unchanged.');
    return 1;
  }

  const size = snapshotSize(built.snapshot);
  if (options.dryRun) {
    console.error(`Dry run: would publish ${size.gpusWithOffers} GPU(s) with offers and ${size.offers} offer(s). Nothing written.`);
    return 0;
  }

  writeSnapshotAtomically(options.out, built.snapshot);
  console.error(
    `Published ${size.gpusWithOffers} GPU(s) with offers and ${size.offers} offer(s) ` +
      `across ${built.snapshot.gpus.length} catalogue GPU(s). Availability is unknown for all of them.`,
  );
  return 0;
}

/** Single exit point: one line, exit 1, no stack — whatever went wrong. */
export async function main(argv: string[]): Promise<number> {
  try {
    return await run(argv);
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
  process.on('unhandledRejection', (cause) => {
    console.error(oneLineError(cause));
    process.exit(1);
  });
}
