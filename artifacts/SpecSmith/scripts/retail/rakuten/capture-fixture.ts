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

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchAllProductSearchPages } from './client';
import { keywordForGpu, loadGpuCatalog } from './index';
import { provenanceComment, redactProductSearchXml } from './redactFixture';
import { PRODUCT_SEARCH_ENDPOINT } from './types';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, '__fixtures__');

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

  const file = path.join(fixturesDir, out);
  fs.writeFileSync(file, `${header}\n${body}\n`);
  console.log(`Wrote ${path.relative(here, file)}: ${totalPages} page(s), TotalMatches ${totalMatches ?? 'unreported'}`);
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) void main(process.argv.slice(2));
