// Node-side frame-time blob store.
//
// Deliberately NOT under src/. Everything in src/lib/measured is pure and
// browser-safe because it gets bundled into the shipped app; this half touches
// node:fs, node:zlib and node:crypto and must never reach that bundle.
//
// WHY THE FRAMES LIVE OUTSIDE GIT
// -------------------------------
// A 60-second run at 120fps is ~7,200 frame times; a real corpus is millions
// of floats that change wholesale on every capture. Committing them would make
// the repository unusable while adding nothing a reviewer can read.
//
// Keeping only the hash in the record preserves what actually matters: the
// measurement stays auditable. Anyone holding the blob can prove it is the one
// a given observation was computed from, and validation recomputes every
// published figure from it. The hash is over the CANONICAL UNCOMPRESSED bytes,
// so it does not change if the compression ever does.

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/** Must stay identical to canonicalFrameTimeBytes() in src/lib/measured/frameTimes.ts. */
export function canonicalFrameTimeBytes(frameTimesMs) {
  return JSON.stringify(frameTimesMs);
}

export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Where blobs live. Overridable so a measurement workstation can point at
 * external storage; defaults to a gitignored directory inside the project.
 */
export function frameTimeRoot() {
  return process.env.SPECSMITH_FRAMETIME_ROOT ?? path.join(process.cwd(), '.frametimes');
}

/**
 * Computes the FrameTimeRef for a run WITHOUT touching the filesystem.
 *
 * Separate from writeFrameTimes so a caller can describe a run it is not
 * going to keep — a dry run, or a run that is about to fail validation. The
 * returned ref is byte-for-byte the one writeFrameTimes would return, because
 * both derive it from the same canonical bytes, so describing then writing
 * never produces a different answer from writing directly.
 */
export async function describeFrameTimes(frameTimesMs) {
  if (!Array.isArray(frameTimesMs) || frameTimesMs.length === 0) {
    throw new Error('refusing to store an empty frame-time array');
  }
  const canonical = canonicalFrameTimeBytes(frameTimesMs);
  const sha256 = sha256Hex(canonical);
  const compressed = await gzip(Buffer.from(canonical, 'utf-8'));

  return {
    ref: {
      sha256,
      frameCount: frameTimesMs.length,
      encoding: 'json-array-ms',
      compression: 'gzip',
      // Derived from the content hash, so storing the same run twice is
      // idempotent and two different runs can never collide.
      storagePath: path.join(sha256.slice(0, 2), `${sha256}.json.gz`),
      compressedByteLength: compressed.byteLength,
    },
    compressed,
  };
}

/** Writes a run's frames and returns the FrameTimeRef to embed in the record. */
export async function writeFrameTimes(frameTimesMs) {
  const { ref, compressed } = await describeFrameTimes(frameTimesMs);
  const full = path.join(frameTimeRoot(), ref.storagePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, compressed);
  return ref;
}

/**
 * Reads frames back and verifies them against the ref's hash.
 *
 * Throws on mismatch rather than returning suspect data — a blob that does not
 * hash to what the record claims is either corrupted or not the run that
 * record describes, and neither may be silently used.
 */
export async function readFrameTimes(ref) {
  const full = path.join(frameTimeRoot(), ref.storagePath);
  const compressed = await fs.readFile(full);
  const canonical = (await gunzip(compressed)).toString('utf-8');

  const actual = sha256Hex(canonical);
  if (actual !== ref.sha256) {
    throw new Error(`frame-time blob at ${ref.storagePath} hashes to ${actual}, but the observation records ${ref.sha256}`);
  }

  const frameTimesMs = JSON.parse(canonical);
  if (frameTimesMs.length !== ref.frameCount) {
    throw new Error(`frame-time blob holds ${frameTimesMs.length} frames but the observation records ${ref.frameCount}`);
  }
  return frameTimesMs;
}
