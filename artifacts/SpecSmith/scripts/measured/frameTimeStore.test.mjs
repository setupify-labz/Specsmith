import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { canonicalFrameTimeBytes as canonicalNode, describeFrameTimes, readFrameTimes, sha256Hex, writeFrameTimes } from './frameTimeStore.mjs';
import { canonicalFrameTimeBytes as canonicalTs } from '../../src/lib/measured/frameTimes';

const withTempRoot = async (fn) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'specsmith-ft-'));
  const prior = process.env.SPECSMITH_FRAMETIME_ROOT;
  process.env.SPECSMITH_FRAMETIME_ROOT = dir;
  try {
    return await fn(dir);
  } finally {
    if (prior === undefined) delete process.env.SPECSMITH_FRAMETIME_ROOT;
    else process.env.SPECSMITH_FRAMETIME_ROOT = prior;
  }
};

describe('frame-time blob store', () => {
  it('round-trips frames through compressed storage', async () => {
    await withTempRoot(async () => {
      const frames = Array.from({ length: 5000 }, (_, i) => 8 + (i % 40) * 0.35);
      const ref = await writeFrameTimes(frames);
      expect(ref.frameCount).toBe(5000);
      expect(ref.compression).toBe('gzip');
      expect(await readFrameTimes(ref)).toEqual(frames);
    });
  });

  it('compresses substantially, which is why the blobs stay out of git', async () => {
    await withTempRoot(async () => {
      const frames = Array.from({ length: 20000 }, () => 8.333);
      const ref = await writeFrameTimes(frames);
      expect(ref.compressedByteLength).toBeLessThan(canonicalNode(frames).length / 10);
    });
  });

  it('is content-addressed, so storing the same run twice is idempotent', async () => {
    await withTempRoot(async () => {
      const frames = [16.7, 8.3, 12.1];
      const a = await writeFrameTimes(frames);
      const b = await writeFrameTimes([...frames]);
      expect(b.storagePath).toBe(a.storagePath);
      expect(b.sha256).toBe(a.sha256);
    });
  });

  // A blob that does not hash to what the record claims is either corrupted or
  // a different run. Neither may be silently used.
  it('refuses to return frames whose hash does not match the record', async () => {
    await withTempRoot(async () => {
      const ref = await writeFrameTimes([16.7, 8.3]);
      await expect(readFrameTimes({ ...ref, sha256: 'not-the-real-hash' })).rejects.toThrow(/hashes to/);
    });
  });

  it('refuses to store an empty run', async () => {
    await withTempRoot(async () => {
      await expect(writeFrameTimes([])).rejects.toThrow();
    });
  });
});

describe('the two canonical serializers must not drift', () => {
  // The hash is computed by the node writer and verified by the browser-safe
  // validator, so the serializations have to stay byte-identical. They live in
  // separate files because src/ is bundled for the browser and cannot import
  // node:crypto — that split is deliberate, and this test is what keeps it safe.
  it('produce identical bytes for the same frames', () => {
    for (const frames of [[16.7, 8.3], [1], [0.5, 123.456, 7], Array.from({ length: 500 }, (_, i) => i + 0.25)]) {
      expect(canonicalNode(frames)).toBe(canonicalTs(frames));
    }
  });

  it('hash the canonical bytes, not the compressed form', () => {
    const frames = [16.7, 8.3];
    expect(sha256Hex(canonicalNode(frames))).toBe(sha256Hex(canonicalTs(frames)));
  });
});

// A dry run and a rejected run both describe their frames without keeping
// them. If describing ever wrote, the collector's "nothing written" would be
// a lie and a rejected run would leave frames on disk to be found later.
describe('describing frames without storing them', () => {
  const frames = Array.from({ length: 4000 }, (_, i) => 8 + (i % 17) * 0.25);

  it('writes nothing to the store', async () => {
    await withTempRoot(async (dir) => {
      await describeFrameTimes(frames);
      expect(await fs.readdir(dir)).toEqual([]);
    });
  });

  it('returns exactly the ref that writing would have returned', async () => {
    await withTempRoot(async () => {
      const { ref: described } = await describeFrameTimes(frames);
      const written = await writeFrameTimes(frames);
      expect(described).toEqual(written);
    });
  });

  it('refuses an empty run just as writing does', async () => {
    await expect(describeFrameTimes([])).rejects.toThrow(/empty frame-time array/);
  });
});
