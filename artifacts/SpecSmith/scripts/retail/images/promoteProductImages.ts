// Promotes reviewed cut-outs into the files the website actually serves.
//
// The batch writes a run directory: candidate PNGs and an image-manifest.json
// describing them. Nothing there is live. Promotion is the deliberate step that
// takes the subset a person has approved, copies those bytes into
// public/images/products/, and publishes public/data/product-images.json —
// the file the browser reads.
//
// The two are kept apart on purpose. A batch run is cheap, repeatable and
// unreviewed; publishing changes what shoppers see. Collapsing them would mean
// re-running the remover could silently change the site.
//
// WHAT IT REFUSES
// ---------------
// Every entry must survive all of:
//
//   - approved === true, with a non-empty rightsBasis. Approval covers whether
//     the cut-out looks right; rightsBasis covers whether modifying and
//     self-hosting that merchant's photograph is permitted. Neither is
//     inferable from the file.
//   - the file it names must exist in the run directory;
//   - the file's actual SHA-256 must equal the processedSha256 recorded for it,
//     so a manifest cannot be pointed at bytes nobody reviewed;
//   - the recorded path must be exactly the one derived from that hash;
//   - a source hash must be present, since without it the browser cannot tell
//     whether the merchant has since replaced the photograph.
//
// A refusal stops that entry, not the run: the rest still publish, and every
// refusal is printed with its reason. If NOTHING survives, no file is written
// at all rather than publishing an empty manifest over a good one.
//
// ATOMICITY
// ---------
// product-images.json is written to a temporary file in the same directory and
// renamed over the target. A reader therefore sees either the previous
// manifest or the complete new one, never a half-written file — which for this
// particular document would mean cards pointing at images that are not there.

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  expectedProcessedPath,
  PROCESSED_PATH_PREFIX,
  type ProductImageEntry,
} from '../../../src/lib/retail/processedImages';
import type { Manifest, ManifestEntry } from './processProductImages';

export type PromotionRefusal =
  | 'not-processed'
  | 'not-approved'
  | 'no-rights-basis'
  | 'missing-source-hash'
  | 'missing-processed-hash'
  | 'file-missing'
  | 'file-hash-mismatch'
  | 'path-not-derived-from-hash';

export interface PromotionRejection {
  partId: string;
  refusal: PromotionRefusal;
  detail: string;
}

export interface PromotionPlan {
  /** Entries that may be published, in manifest order. */
  publish: Array<{ entry: ProductImageEntry; sourceFile: string; fileName: string }>;
  rejections: PromotionRejection[];
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const isSha256 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

/**
 * Decides what a run directory may publish, without writing anything.
 *
 * Separated from the writing so the decision can be tested exhaustively and so
 * a caller can print the plan before acting on it.
 */
export function planPromotion(manifest: Manifest, runImagesDir: string): PromotionPlan {
  const publish: PromotionPlan['publish'] = [];
  const rejections: PromotionRejection[] = [];
  const refuse = (partId: string, refusal: PromotionRefusal, detail: string) =>
    rejections.push({ partId, refusal, detail });

  for (const entry of manifest.entries as (ManifestEntry & { approved?: boolean; rightsBasis?: string })[]) {
    if (entry.outcome !== 'processed') {
      refuse(entry.partId, 'not-processed', `kept the original (${entry.reason ?? 'no reason recorded'}).`);
      continue;
    }
    if (entry.approved !== true) {
      refuse(entry.partId, 'not-approved', 'no reviewer has approved this cut-out.');
      continue;
    }
    if (typeof entry.rightsBasis !== 'string' || entry.rightsBasis.trim() === '') {
      refuse(entry.partId, 'no-rights-basis', 'no licence basis for modifying and self-hosting is recorded.');
      continue;
    }
    if (!isSha256(entry.sourceSha256)) {
      refuse(entry.partId, 'missing-source-hash', 'no source hash, so the browser could not detect a replaced photograph.');
      continue;
    }
    if (!isSha256(entry.processedSha256)) {
      refuse(entry.partId, 'missing-processed-hash', 'no output hash, so the bytes cannot be identified.');
      continue;
    }

    const fileName = `${entry.processedSha256}.png`;
    const sourceFile = path.join(runImagesDir, fileName);
    if (!fs.existsSync(sourceFile)) {
      refuse(entry.partId, 'file-missing', `${fileName} is not in the run directory.`);
      continue;
    }
    const actual = sha256(fs.readFileSync(sourceFile));
    if (actual !== entry.processedSha256) {
      // The manifest describes bytes other than the ones on disk. Whatever the
      // cause, nobody reviewed what is actually here.
      refuse(entry.partId, 'file-hash-mismatch', `${fileName} hashes to ${actual.slice(0, 12)}…, not its recorded hash.`);
      continue;
    }
    const derived = expectedProcessedPath(entry.processedSha256);
    if (entry.processedPath !== derived) {
      refuse(entry.partId, 'path-not-derived-from-hash', `recorded path is not ${derived}.`);
      continue;
    }

    publish.push({
      entry: {
        partId: entry.partId,
        sourceUrl: entry.sourceUrl,
        sourceSha256: entry.sourceSha256,
        processedSha256: entry.processedSha256,
        outcome: 'processed',
        processedPath: derived,
        approved: true,
        rightsBasis: entry.rightsBasis,
      },
      sourceFile,
      fileName,
    });
  }

  return { publish, rejections };
}

export interface PromotionResult {
  published: number;
  rejections: PromotionRejection[];
  manifestPath: string | null;
}

/** Writes `data` to `target` atomically: same directory, then rename. */
export function writeAtomically(target: string, data: string): void {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, target);
}

/**
 * Copies approved cut-outs into the public tree and publishes the manifest.
 *
 * `appRoot` is the SpecSmith app directory; assets land in
 * `<appRoot>/public/images/products` and the manifest in
 * `<appRoot>/public/data/product-images.json`.
 */
export function promote(manifest: Manifest, runImagesDir: string, appRoot: string): PromotionResult {
  const plan = planPromotion(manifest, runImagesDir);
  if (plan.publish.length === 0) {
    // Publishing an empty manifest over a working one would blank every
    // cut-out on the site. Doing nothing is the safer failure.
    return { published: 0, rejections: plan.rejections, manifestPath: null };
  }

  const publicImages = path.join(appRoot, 'public', PROCESSED_PATH_PREFIX.replace(/^\/|\/$/g, ''));
  fs.mkdirSync(publicImages, { recursive: true });
  for (const item of plan.publish) {
    fs.copyFileSync(item.sourceFile, path.join(publicImages, item.fileName));
  }

  const manifestPath = path.join(appRoot, 'public', 'data', 'product-images.json');
  writeAtomically(
    manifestPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: manifest.source,
        entries: plan.publish.map((item) => item.entry),
      },
      null,
      2,
    )}\n`,
  );

  return { published: plan.publish.length, rejections: plan.rejections, manifestPath };
}
