// Runs one complete GPU sweep and writes a short-lived, review-only artifact.
//
// The file contains sanitized product titles and closed matcher evidence. It
// contains no price, URL, SKU, UPC, affiliate identifier, raw XML or token.
// Nothing from the file is printed: GitHub logs live much longer than the
// one-day artifact and are the wrong place for merchant-controlled text.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadGpuCatalog, readAccessToken } from '../rakuten';
import { DEFAULT_REQUESTS_PER_MINUTE, RAKUTEN_CALLS_PER_MINUTE } from '../coverage/rateLimiter';
import { buildSnapshot } from '../snapshot/buildSnapshot';
import { sweepOffers } from '../snapshot/sweepOffers';
import { buildAcceptedOfferAudit, describeAudit } from './auditRecord';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..', '..');
const repoRoot = path.resolve(appRoot, '..', '..');

type AuditFailureCode =
  | 'argument-invalid'
  | 'output-inside-repository'
  | 'output-directory-missing'
  | 'sweep-refused'
  | 'record-invalid'
  | 'write-failed';

class AuditFailure extends Error {
  constructor(readonly code: AuditFailureCode) {
    super(code);
  }
}

interface CliOptions {
  out: string;
  requestsPerMinute: number;
}

export function resolveAuditOutputPath(file: string, root: string = repoRoot): string {
  const output = path.resolve(file);
  const relative = path.relative(path.resolve(root), output);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new AuditFailure('output-inside-repository');
  }
  return output;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  let out: string | null = null;
  let requestsPerMinute = DEFAULT_REQUESTS_PER_MINUTE;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new AuditFailure('argument-invalid');
      index += 1;
      return value;
    };
    if (arg === '--out') {
      out = next();
    } else if (arg === '--requests-per-minute') {
      const value = Number(next());
      if (!Number.isInteger(value) || value < 1 || value > RAKUTEN_CALLS_PER_MINUTE) {
        throw new AuditFailure('argument-invalid');
      }
      requestsPerMinute = value;
    } else {
      throw new AuditFailure('argument-invalid');
    }
  }
  if (out === null) throw new AuditFailure('argument-invalid');
  return { out: resolveAuditOutputPath(out), requestsPerMinute };
}

async function run(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv);
  if (!fs.existsSync(path.dirname(options.out))) throw new AuditFailure('output-directory-missing');

  // Fail before pacing through requests. This reads the existing environment
  // through the adapter's one credential boundary and never echoes the value.
  readAccessToken();
  const catalog = loadGpuCatalog();
  const sweep = await sweepOffers({ catalog, requestsPerMinute: options.requestsPerMinute });

  // Reuse the publication gate to prove that the sweep covered every expected
  // GPU exactly once, no request failed, every offer still satisfies the
  // browser schema, and no partial result is being called an audit.
  const built = buildSnapshot({
    expectedGpuIds: catalog.map((gpu) => gpu.id),
    outcomes: sweep.outcomes,
    generatedAt: sweep.finishedAt,
  });
  if (!built.ok) {
    console.error(`Accepted-offer audit refused [${built.refusal.code}]. Nothing was written.`);
    return 1;
  }

  const offers = sweep.outcomes.flatMap((outcome) => (outcome.status === 'ok' ? [...outcome.offers] : []));
  let audit;
  try {
    audit = buildAcceptedOfferAudit(catalog, offers, sweep.finishedAt);
  } catch {
    throw new AuditFailure('record-invalid');
  }

  const serialized = `${JSON.stringify(audit, null, 2)}\n`;
  try {
    fs.writeFileSync(options.out, serialized, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
  } catch {
    throw new AuditFailure('write-failed');
  }
  console.error(describeAudit(audit));
  return 0;
}

export async function main(argv: readonly string[]): Promise<number> {
  try {
    return await run(argv);
  } catch (cause) {
    const code = cause instanceof AuditFailure ? cause.code : 'record-invalid';
    console.error(`Accepted-offer audit failed [${code}]. Nothing was written.`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
