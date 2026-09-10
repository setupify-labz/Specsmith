// Read-only, credential-free retailer-link integrity audit.
//
//   pnpm --filter @workspace/specsmith run audit:retailer-links -- --out /tmp/retailer-link-audit.json
//
// Classifies every Amazon/Newegg purchase link SpecSmith can show — the
// tracked deep links in the published `retail-parts.json` affiliate catalog,
// AND the links the core builder selectors (`Builder.tsx`, `QuizFlow.tsx`,
// the matchup / "best X for game" / prebuilt pages) build on the fly from the
// canonical `src/data/*.json` catalogs — as exact, a generic search fallback,
// missing, malformed, wrong-domain, ambiguous, or unverifiable. See
// `linkIntegrity.ts` for what each of those means and why a link this tool
// cannot place confidently is never counted as exact.
//
// NO NETWORK CALL, NO CREDENTIAL. Every input is a file already in the
// repository or its published output; every classification is a pure
// function of a URL's own shape. This is what "run safely without
// credentials" means for this audit — see issue #85.
//
// The full row-level report — which, for `retail-parts-catalog` rows, repeats
// the merchant's own product titles already committed in `retail-parts.json`
// — is written OUTSIDE the repository, same rule and same reason as
// `audit-accepted-offers.ts`. Only a counts-only summary goes to stdout.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAffiliatePartCatalog } from '../../../src/lib/retail/partCatalog';
import { auditRetailPartsCatalog } from './retailCatalogLinkAudit';
import { auditCoreSelectorCatalog } from './coreSelectorLinkAudit';
import { loadCoreSelectorCatalog } from './coreSelectorCatalog';
import {
  UNTRUSTED_URL_TYPES,
  renderLinkAuditSummary,
  summarizeLinkAudit,
  type LinkAuditReport,
} from './linkAuditReport';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..', '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const retailPartsCatalogPath = path.join(appRoot, 'public', 'data', 'retail-parts.json');

type AuditFailureCode =
  | 'argument-invalid'
  | 'output-inside-repository'
  | 'output-directory-missing'
  | 'retail-parts-catalog-invalid'
  | 'core-selector-catalog-invalid'
  | 'write-failed';

class AuditFailure extends Error {
  constructor(readonly code: AuditFailureCode) {
    super(code);
  }
}

interface CliOptions {
  out: string;
}

/** Same rule as `audit-accepted-offers.ts`: the report may repeat merchant text, so it may not live in the repository. */
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
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') {
      const value = argv[index + 1];
      if (value === undefined) throw new AuditFailure('argument-invalid');
      out = value;
      index += 1;
    } else {
      throw new AuditFailure('argument-invalid');
    }
  }
  if (out === null) throw new AuditFailure('argument-invalid');
  return { out: resolveAuditOutputPath(out) };
}

async function run(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv);
  if (!fs.existsSync(path.dirname(options.out))) throw new AuditFailure('output-directory-missing');

  let retailPartsRows;
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(retailPartsCatalogPath, 'utf-8'));
    const parsed = parseAffiliatePartCatalog(raw);
    if (!parsed.ok) throw new Error(parsed.problem);
    retailPartsRows = auditRetailPartsCatalog(parsed.catalog);
  } catch {
    throw new AuditFailure('retail-parts-catalog-invalid');
  }

  let coreSelectorRows;
  try {
    coreSelectorRows = auditCoreSelectorCatalog(loadCoreSelectorCatalog());
  } catch {
    throw new AuditFailure('core-selector-catalog-invalid');
  }

  const report: LinkAuditReport = {
    generatedAt: new Date().toISOString(),
    rows: [...retailPartsRows, ...coreSelectorRows],
  };
  const summary = summarizeLinkAudit(report);

  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  try {
    fs.writeFileSync(options.out, serialized, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
  } catch {
    throw new AuditFailure('write-failed');
  }

  console.error(renderLinkAuditSummary(summary));

  // Fails closed: a row this tool could not place at all (malformed, wrong
  // domain, ambiguous, unverifiable) is an anomaly worth a nonzero exit even
  // though the run completed and the report was written. A merely
  // non-exact-but-understood link (fallback-search, missing) is the honestly
  // reported status quo, not a tool failure, so it does not fail the command.
  const untrusted = report.rows.filter((row) => UNTRUSTED_URL_TYPES.includes(row.urlType));
  if (untrusted.length > 0) {
    console.error(`\n${untrusted.length} row(s) could not be classified with confidence (malformed / wrong-domain / ambiguous / unverifiable). See the report for detail.`);
    return 1;
  }
  return 0;
}

export async function main(argv: readonly string[]): Promise<number> {
  try {
    return await run(argv);
  } catch (cause) {
    const code = cause instanceof AuditFailure ? cause.code : 'retail-parts-catalog-invalid';
    console.error(`Retailer-link audit failed [${code}]. Nothing was written.`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
