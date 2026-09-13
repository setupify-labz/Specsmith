// Runs a review batch of product-image cut-outs.
//
//   pnpm exec tsx scripts/retail/images/run-image-batch.ts --source catalogue --out <dir>
//   pnpm exec tsx scripts/retail/images/run-image-batch.ts --source fixtures  --out <dir>
//
// `catalogue` pulls the real merchant photographs named in retail-parts.json.
// `fixtures` runs the synthetic set instead, so the remover's decisions can be
// reviewed without network access to a merchant CDN. A fixtures run is labelled
// as such in the manifest and its output must never be published as a product
// image.
//
// Nothing here writes to retail-parts.json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchImage, processOne, summarise, type Manifest, type ManifestEntry } from './processProductImages';
import * as fx from './testFixtures';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..', '..');

/** One of each thing the brief asks the review batch to cover. */
const REVIEW_CATEGORIES = ['gpu', 'case', 'monitor', 'cooler', 'cpu', 'keyboard'] as const;

interface Args {
  source: 'catalogue' | 'fixtures';
  out: string;
  limitPerCategory: number;
}

export function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const source = get('--source') ?? 'fixtures';
  if (source !== 'catalogue' && source !== 'fixtures') {
    throw new Error(`--source must be "catalogue" or "fixtures", got ${JSON.stringify(source)}`);
  }
  const out = get('--out');
  if (!out) throw new Error('--out <dir> is required');
  return { source, out: path.resolve(out), limitPerCategory: Number(get('--per-category') ?? 1) };
}

/** The synthetic set, one per hard case the brief names. */
const FIXTURES: Array<[string, string, () => Buffer]> = [
  ['fixture-gpu-dark', 'gpu', fx.darkGpuOnWhite],
  ['fixture-case-white', 'case', fx.whiteCaseOnWhite],
  ['fixture-case-white-outlined', 'case', fx.whiteCaseWithOutline],
  ['fixture-case-black', 'case', fx.blackCase],
  ['fixture-case-glass', 'case', fx.glassPanelCase],
  ['fixture-monitor', 'monitor', fx.monitor],
  ['fixture-cable-coiled', 'cable', fx.coiledCable],
  ['fixture-cooler-fan-openings', 'cooler', fx.coolerWithFanOpenings],
  ['fixture-heatsink-bright-rim', 'cooler', fx.brightMetalEdge],
  ['fixture-product-with-shadow', 'gpu', fx.productWithShadow],
  ['fixture-lifestyle-gradient', 'gpu', fx.gradientBackdrop],
  ['fixture-already-transparent', 'gpu', fx.alreadyTransparent],
];

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const observedAt = new Date().toISOString();
  const imagesDir = path.join(args.out, 'images', 'products');
  const entries: ManifestEntry[] = [];

  if (args.source === 'fixtures') {
    for (const [partId, category, make] of FIXTURES) {
      entries.push(processOne({ partId, category, sourceUrl: `${partId}.png`, bytes: make() }, imagesDir, observedAt));
    }
  } else {
    const raw = JSON.parse(fs.readFileSync(path.join(appRoot, 'public', 'data', 'retail-parts.json'), 'utf8'));
    const parts: any[] = raw.parts ?? raw;
    const picked: any[] = [];
    for (const category of REVIEW_CATEGORIES) {
      picked.push(...parts.filter((p) => p.category === category).slice(0, args.limitPerCategory));
    }
    for (const part of picked) {
      const got = await fetchImage(part.imageUrl);
      if ('error' in got) {
        entries.push({
          partId: part.id,
          category: part.category,
          sourceUrl: part.imageUrl,
          sourceSha256: '',
          sourceBytes: 0,
          outcome: 'kept-original',
          reason: 'undecodable',
          detail: `Could not fetch the merchant image: ${got.error}. The original URL stands.`,
          observedAt,
        });
        continue;
      }
      entries.push(
        processOne(
          { partId: part.id, category: part.category, sourceUrl: part.imageUrl, bytes: got.bytes },
          imagesDir,
          observedAt,
        ),
      );
    }
  }

  const manifest: Manifest = { generatedAt: observedAt, source: args.source, entries };
  fs.mkdirSync(args.out, { recursive: true });
  fs.writeFileSync(path.join(args.out, 'image-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(summarise(manifest));
  console.log(`\nmanifest: ${path.join(args.out, 'image-manifest.json')}`);
  return 0;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(String(err instanceof Error ? err.message : err));
      process.exit(1);
    },
  );
}

export { main };
