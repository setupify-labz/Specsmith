// Produces cut-out product images and the manifest that describes them.
//
// SERVER-ONLY, and run by hand. It is not part of the catalogue refresh: a
// cut-out is a visual asset that a person should look at before it ships, and
// wiring it into the nightly job would publish unreviewed ones.
//
// WHAT IT WRITES, AND WHERE
// -------------------------
// Processed bytes go to `public/images/products/<sha256-of-original>.png`,
// served from SpecSmith's own origin. A modified retailer image is never
// hotlinked back to the merchant CDN: the merchant serves THEIR picture, and
// once we have altered its alpha channel it is no longer theirs to serve.
//
// The manifest records, per entry: the source URL, the SHA-256 of the exact
// original bytes, the SHA-256 of the output, the outcome, and the measurements
// the decision was made from. A reviewer can re-fetch the source, re-hash it,
// and re-run the remover to reproduce any row.
//
// WHAT IT NEVER TOUCHES
// ---------------------
// `retail-parts.json`. No price, availability, link, mapping or FPS field is
// read for writing or written at all. This tool only ever adds image files and
// its own manifest.

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { removeBackground, type RefusalReason, type RemovalStats } from './backgroundRemoval';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 20_000;

export interface ManifestEntry {
  /** The catalogue part this picture belongs to. */
  partId: string;
  category: string;
  /** The merchant image, unmodified and still served by the merchant. */
  sourceUrl: string;
  /** SHA-256 of the exact bytes fetched, so a reviewer can reproduce the run. */
  sourceSha256: string;
  sourceBytes: number;
  outcome: 'processed' | 'kept-original';
  /** Set only when processed: the local file, served from our own origin. */
  processedPath?: string;
  processedSha256?: string;
  processedBytes?: number;
  stats?: RemovalStats;
  /** Set only when kept: why the original was left alone. */
  reason?: RefusalReason;
  detail?: string;
  observedAt: string;
}

export interface Manifest {
  generatedAt: string;
  /** Where the bytes came from: the live catalogue, or local fixtures. */
  source: 'catalogue' | 'fixtures';
  entries: ManifestEntry[];
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export interface FetchedImage {
  bytes: Buffer;
  url: string;
}

/** Pulls one image. Public URL, plain GET, no credential of ours attached. */
export async function fetchImage(
  url: string,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<FetchedImage | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await doFetch(url, { signal: controller.signal });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.byteLength > MAX_IMAGE_BYTES) return { error: `larger than ${MAX_IMAGE_BYTES} bytes` };
    return { bytes: buf, url };
  } catch (e) {
    return { error: String((e as Error).message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

export interface ProcessInput {
  partId: string;
  category: string;
  sourceUrl: string;
  bytes: Buffer;
}

/**
 * Processes one image into a manifest entry, writing the file only on success.
 *
 * A refusal is a first-class result, not an error: the entry records that the
 * original stands and why, and no file is written for it. The caller keeps
 * pointing at the merchant's own untouched URL in that case.
 */
export function processOne(input: ProcessInput, outDir: string, observedAt: string): ManifestEntry {
  const sourceSha256 = sha256(input.bytes);
  const base: ManifestEntry = {
    partId: input.partId,
    category: input.category,
    sourceUrl: input.sourceUrl,
    sourceSha256,
    sourceBytes: input.bytes.byteLength,
    outcome: 'kept-original',
    observedAt,
  };

  const outcome = removeBackground(input.bytes, input.sourceUrl);
  if (!outcome.ok) return { ...base, reason: outcome.reason, detail: outcome.detail };

  const fileName = `${sourceSha256}.png`;
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, fileName), outcome.png);
  return {
    ...base,
    outcome: 'processed',
    processedPath: `/images/products/${fileName}`,
    processedSha256: sha256(outcome.png),
    processedBytes: outcome.png.byteLength,
    stats: outcome.stats,
  };
}

/** A short human summary of a run, for the reviewer. */
export function summarise(manifest: Manifest): string {
  const processed = manifest.entries.filter((e) => e.outcome === 'processed');
  const kept = manifest.entries.filter((e) => e.outcome === 'kept-original');
  const byReason = new Map<string, number>();
  for (const e of kept) byReason.set(e.reason ?? 'unknown', (byReason.get(e.reason ?? 'unknown') ?? 0) + 1);

  const srcBytes = processed.reduce((n, e) => n + e.sourceBytes, 0);
  const outBytes = processed.reduce((n, e) => n + (e.processedBytes ?? 0), 0);

  const lines = [
    `source: ${manifest.source}`,
    `processed: ${processed.length}   kept original: ${kept.length}`,
    ...[...byReason.entries()].map(([r, n]) => `  kept, ${r}: ${n}`),
  ];
  if (processed.length > 0) {
    lines.push(
      `bytes in: ${srcBytes}  out: ${outBytes}  (${outBytes >= srcBytes ? '+' : ''}${(
        ((outBytes - srcBytes) / srcBytes) *
        100
      ).toFixed(1)}%)`,
    );
  }
  return lines.join('\n');
}
