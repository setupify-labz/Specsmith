// Captures a live Product Search response and writes it, redacted, as a fixture.
//
//   RAKUTEN_API_ACCESS_TOKEN=… npx tsx scripts/retail/rakuten/capture-fixture.ts \
//     --gpu rtx4070 --out newegg-rtx4070-live.xml
//
// WHY THIS SCRIPT EXISTS
// ----------------------
// A fixture that claims to be a capture must actually be one. Redacting by
// hand makes that claim unverifiable — nobody can tell afterwards whether a
// file was captured and cleaned or simply written to look like one. So capture
// and redaction are one command, the redaction is the same function
// serverOnly.test.ts checks against, and the provenance line the script writes
// records the date and endpoint rather than being typed in by whoever ran it.
//
// It walks every page Rakuten reports, so the captured fixture exercises the
// paging path rather than only page one.
//
// The destination is confined by `resolveFixturePath` below — a real function
// with real tests, not a convention.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchAllProductSearchPages } from './client';
import { keywordForGpu, loadGpuCatalog } from './index';
import { provenanceComment, redactProductSearchXml } from './redactFixture';
import { PRODUCT_SEARCH_ENDPOINT } from './types';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.join(here, '__fixtures__');

/** Thrown when `--out` names anywhere other than a plain file in __fixtures__. */
export class FixturePathError extends Error {}

/**
 * Resolves `--out` to a path inside the fixtures directory, or throws.
 *
 * WHY THIS IS A FUNCTION AND NOT A COMMENT
 * ----------------------------------------
 * `path.join(fixturesDir, out)` confines nothing: join happily normalizes
 * "../../../src/overwrite.ts" straight out of the directory, and the earlier
 * version of this file "proved" confinement by asserting that the source
 * contained that call — a test of the spelling of the code, not of what it
 * does. This is the behaviour instead, and it is tested by running it.
 *
 * Two independent checks, because either alone can be argued around:
 *
 *   1. The name must be a plain filename — no separator of either kind, not
 *      "." or "..", not absolute, not starting with a dot, ending in ".xml".
 *   2. The RESOLVED path's parent must be exactly the fixtures directory.
 *
 * The second is what actually holds if the first is ever loosened, and it
 * compares resolved paths rather than string prefixes, so neither "..", a
 * symlinked-looking name, nor a sibling directory whose name merely starts
 * with "__fixtures__" can satisfy it.
 */
export function resolveFixturePath(out: string, fixturesDir: string = FIXTURES_DIR): string {
  if (typeof out !== 'string' || out.trim() === '') {
    throw new FixturePathError('--out is required and must not be blank.');
  }
  if (/[/\\]/.test(out)) {
    throw new FixturePathError(`--out ${JSON.stringify(out)} contains a path separator. It must be a plain filename inside __fixtures__, not a path.`);
  }
  if (out === '.' || out === '..') {
    throw new FixturePathError(`--out ${JSON.stringify(out)} names a directory, not a fixture file.`);
  }
  if (out.startsWith('.')) {
    throw new FixturePathError(`--out ${JSON.stringify(out)} starts with a dot; fixtures are ordinary visible files.`);
  }
  if (path.isAbsolute(out)) {
    throw new FixturePathError(`--out ${JSON.stringify(out)} is an absolute path.`);
  }
  if (!out.endsWith('.xml')) {
    throw new FixturePathError(`--out ${JSON.stringify(out)} must end in .xml — this command writes captured XML responses and nothing else.`);
  }

  const dir = path.resolve(fixturesDir);
  const resolved = path.resolve(dir, out);
  if (path.dirname(resolved) !== dir) {
    throw new FixturePathError(`--out ${JSON.stringify(out)} resolves to ${resolved}, which is not directly inside ${dir}.`);
  }
  return resolved;
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

async function main(argv: string[]): Promise<void> {
  const gpuId = flag(argv, 'gpu');
  const out = flag(argv, 'out');
  if (!gpuId || !out) {
    console.error('Usage: capture-fixture.ts --gpu <catalogId> --out <filename.xml>');
    process.exitCode = 1;
    return;
  }

  let file: string;
  try {
    file = resolveFixturePath(out);
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    process.exitCode = 1;
    return;
  }

  const catalog = loadGpuCatalog();
  const gpu = catalog.find((g) => g.id === gpuId);
  if (!gpu) {
    console.error(`No catalog GPU with id "${gpuId}".`);
    process.exitCode = 1;
    return;
  }

  const keyword = keywordForGpu(gpu);
  const { pages, fetchedAt, totalMatches, totalPages } = await fetchAllProductSearchPages({ keyword, max: 100 });

  const header = provenanceComment(
    `captured ${fetchedAt.slice(0, 10)} from ${PRODUCT_SEARCH_ENDPOINT} for keyword "${keyword}" ` +
      `(${totalPages} page(s), TotalMatches ${totalMatches ?? 'unreported'}); ` +
      'publisher/offer/link identifiers redacted by capture-fixture.ts.',
  );

  // Pages are concatenated with their own provenance line so a multi-page
  // capture stays one reviewable file. Each page is still a complete document
  // and is parsed separately by the tests.
  const body = pages
    .map((xml, i) => `${provenanceComment(`page ${i + 1} of ${totalPages}`)}\n${redactProductSearchXml(xml).trim()}`)
    .join('\n');

  fs.writeFileSync(file, `${header}\n${body}\n`);
  console.log(`Wrote ${path.relative(here, file)}: ${totalPages} page(s), TotalMatches ${totalMatches ?? 'unreported'}`);
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) void main(process.argv.slice(2));
