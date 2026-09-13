// Publishes the approved subset of a batch run.
//
//   pnpm exec tsx scripts/retail/images/run-promote-images.ts --run <dir>
//
// `--run` is the directory a batch wrote: image-manifest.json plus
// images/products/*.png. Only entries a reviewer marked approved, with a
// recorded licence basis, whose files exist and hash as recorded, are
// published. Everything refused is printed with its reason.
//
// Nothing about the retail catalogue is read or written.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { promote } from './promoteProductImages';
import type { Manifest } from './processProductImages';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..', '..');

export function parseArgs(argv: readonly string[]): { run: string } {
  const i = argv.indexOf('--run');
  const run = i >= 0 ? argv[i + 1] : undefined;
  if (!run) throw new Error('--run <dir> is required: the directory a batch run wrote');
  return { run: path.resolve(run) };
}

function main(argv: readonly string[]): number {
  const { run } = parseArgs(argv);
  const manifestFile = path.join(run, 'image-manifest.json');
  if (!fs.existsSync(manifestFile)) throw new Error(`no image-manifest.json in ${run}`);

  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Manifest;
  const result = promote(manifest, path.join(run, 'images', 'products'), appRoot);

  for (const r of result.rejections) console.log(`  refused ${r.partId}: ${r.refusal} — ${r.detail}`);
  console.log(`\napproved and published: ${result.published}   refused: ${result.rejections.length}`);
  if (result.manifestPath) {
    console.log(`manifest: ${result.manifestPath}`);
  } else {
    console.log('nothing was approved, so no file was written; any existing manifest is untouched.');
  }
  return 0;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  }
}

export { main };
