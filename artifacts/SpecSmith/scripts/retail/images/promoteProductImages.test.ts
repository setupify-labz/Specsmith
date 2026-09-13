// Promotion: the step that decides what the website actually serves.
//
// The output is fed back through the RUNTIME parser at the end, because the
// only thing that matters about a published manifest is whether the browser
// accepts it. A promotion that writes a file the parser rejects has published
// nothing while reporting success.
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { indexManifest, expectedProcessedPath } from '../../../src/lib/retail/processedImages';
import { planPromotion, promote, writeAtomically } from './promoteProductImages';
import { processOne, type Manifest } from './processProductImages';
import * as fx from './testFixtures';

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'promote-'));
const dirs: string[] = [];
const scratch = () => {
  const d = tmp();
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A real batch run: a genuine cut-out written by the real processor. */
function runDirectory(over: Record<string, unknown> = {}) {
  const run = scratch();
  const images = path.join(run, 'images', 'products');
  const entry = processOne(
    {
      partId: 'newegg-gpu-a',
      category: 'gpu',
      sourceUrl: 'https://c1.neweggimages.test/a.png',
      bytes: fx.darkGpuOnWhite(),
    },
    images,
    '2026-09-10',
  );
  if (entry.outcome !== 'processed') throw new Error('fixture should have been processed');
  const manifest: Manifest = {
    generatedAt: '2026-09-10',
    source: 'catalogue',
    entries: [{ ...entry, approved: true, rightsBasis: 'reviewed: clause 4.2', ...over } as any],
  };
  return { run, images, manifest, entry };
}

describe('the batch names a cut-out after its own bytes', () => {
  it('uses the OUTPUT hash, so a regenerated cut-out is a new URL', () => {
    const { images, entry } = runDirectory();
    expect(entry.processedSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.processedPath).toBe(expectedProcessedPath(entry.processedSha256!));
    expect(fs.readdirSync(images)).toEqual([`${entry.processedSha256}.png`]);
    // The name is NOT the source hash: that is the whole point.
    expect(entry.processedPath).not.toContain(entry.sourceSha256);
  });
});

describe('promotion publishes only what a person signed off', () => {
  it('copies the file and writes the manifest', () => {
    const { run, images, manifest, entry } = runDirectory();
    const app = scratch();
    const result = promote(manifest, images, app);

    expect(result.published).toBe(1);
    expect(result.rejections).toEqual([]);
    expect(fs.existsSync(path.join(app, 'public', 'images', 'products', `${entry.processedSha256}.png`))).toBe(true);
    expect(fs.existsSync(path.join(app, 'public', 'data', 'product-images.json'))).toBe(true);
    expect(run).toBeTruthy();
  });

  it.each([
    ['it was never approved', { approved: undefined }, 'not-approved'],
    ['approval is false', { approved: false }, 'not-approved'],
    ['no licence basis is recorded', { rightsBasis: undefined }, 'no-rights-basis'],
    ['the licence basis is blank', { rightsBasis: '   ' }, 'no-rights-basis'],
    ['the run kept the original', { outcome: 'kept-original' }, 'not-processed'],
    ['there is no source hash', { sourceSha256: '' }, 'missing-source-hash'],
    ['there is no output hash', { processedSha256: undefined }, 'missing-processed-hash'],
    ['the recorded path is not derived from the hash', { processedPath: '/images/products/other.png' }, 'path-not-derived-from-hash'],
  ])('refuses when %s', (_label, over, refusal) => {
    const { images, manifest } = runDirectory(over);
    const app = scratch();
    const result = promote(manifest, images, app);

    expect(result.published).toBe(0);
    expect(result.rejections[0]?.refusal).toBe(refusal);
    // Nothing was written at all.
    expect(fs.existsSync(path.join(app, 'public', 'data', 'product-images.json'))).toBe(false);
  });

  it('refuses when the file named is not in the run directory', () => {
    const { images, manifest, entry } = runDirectory();
    fs.rmSync(path.join(images, `${entry.processedSha256}.png`));
    const result = promote(manifest, images, scratch());
    expect(result.rejections[0]?.refusal).toBe('file-missing');
  });

  it('refuses when the bytes on disk are not the bytes that were reviewed', () => {
    const { images, manifest, entry } = runDirectory();
    // Someone swapped the file after review. The manifest still describes the
    // old bytes; nobody has looked at these.
    fs.writeFileSync(path.join(images, `${entry.processedSha256}.png`), fx.blackCase());
    const result = promote(manifest, images, scratch());
    expect(result.rejections[0]?.refusal).toBe('file-hash-mismatch');
  });

  it('publishes the good entries in a run that also contains refused ones', () => {
    const { images, manifest, entry } = runDirectory();
    manifest.entries.push({ ...(manifest.entries[0] as any), partId: 'newegg-gpu-b', approved: false });
    const app = scratch();
    const result = promote(manifest, images, app);

    expect(result.published).toBe(1);
    expect(result.rejections.map((r) => r.partId)).toEqual(['newegg-gpu-b']);
    expect(entry.processedSha256).toBeTruthy();
  });
});

describe('a run with nothing approved does not blank the site', () => {
  it('leaves an existing manifest untouched rather than publishing an empty one', () => {
    const { images, manifest } = runDirectory({ approved: false });
    const app = scratch();
    const target = path.join(app, 'public', 'data', 'product-images.json');
    writeAtomically(target, '{"entries":[{"kept":"from before"}]}\n');

    const result = promote(manifest, images, app);

    expect(result.published).toBe(0);
    expect(result.manifestPath).toBeNull();
    expect(fs.readFileSync(target, 'utf8')).toContain('from before');
  });
});

describe('the manifest is replaced atomically', () => {
  it('never leaves a partial file behind', () => {
    const app = scratch();
    const target = path.join(app, 'public', 'data', 'product-images.json');
    writeAtomically(target, '{"a":1}\n');
    writeAtomically(target, '{"b":2}\n');
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ b: 2 });
    // No temporary files survive in the directory.
    expect(fs.readdirSync(path.dirname(target)).filter((f) => f.includes('.tmp'))).toEqual([]);
  });
});

describe('what promotion publishes, the browser accepts', () => {
  it('survives the runtime parser and indexes the part', () => {
    const { images, manifest, entry } = runDirectory();
    const app = scratch();
    promote(manifest, images, app);

    const published = JSON.parse(
      fs.readFileSync(path.join(app, 'public', 'data', 'product-images.json'), 'utf8'),
    );
    const indexed = indexManifest(published);

    expect(indexed.size).toBe(1);
    const got = indexed.get('newegg-gpu-a')!;
    expect(got.processedPath).toBe(expectedProcessedPath(entry.processedSha256!));
    expect(got.approved).toBe(true);
    expect(got.rightsBasis).toBeTruthy();
    expect(got.sourceSha256).toBe(entry.sourceSha256);
  });

  it('publishes a path that points at a file that is really there', () => {
    const { images, manifest } = runDirectory();
    const app = scratch();
    promote(manifest, images, app);
    const published = JSON.parse(
      fs.readFileSync(path.join(app, 'public', 'data', 'product-images.json'), 'utf8'),
    );
    for (const entry of published.entries) {
      const onDisk = path.join(app, 'public', entry.processedPath.replace(/^\//, ''));
      expect(fs.existsSync(onDisk)).toBe(true);
      expect(sha256(fs.readFileSync(onDisk))).toBe(entry.processedSha256);
    }
  });
});
