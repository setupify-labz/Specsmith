import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AVAILABILITY_UNKNOWN, OFFER_SNAPSHOT_SCHEMA_VERSION, parseOfferSnapshot, type GpuOfferSnapshot } from '../../../src/lib/retail/offerSnapshot';
import { RAKUTEN_ADAPTER_VERSION } from '../rakuten/types';
import { SnapshotWriteError, describePublishedRead, readPublishedSnapshot, serializeSnapshot, writeSnapshotAtomically } from './writeSnapshot';

const snapshot = (over: Partial<GpuOfferSnapshot> = {}): GpuOfferSnapshot => ({
  schemaVersion: OFFER_SNAPSHOT_SCHEMA_VERSION,
  adapterVersion: RAKUTEN_ADAPTER_VERSION,
  generatedAt: '2026-08-29T12:00:00.000Z',
  availability: AVAILABILITY_UNKNOWN,
  gpus: [
    {
      gpuId: 'rtx5070',
      result: 'offers',
      offers: [
        {
          sku: 'N82E16814137837',
          upc: null,
          productName: 'ASUS TUF Gaming GeForce RTX 5070 12GB',
          retailPrice: 599.99,
          salePrice: null,
          currency: 'USD',
          imageUrl: 'https://c1.neweggimages.com/productimage/example.jpg',
          trackedAffiliateUrl: 'https://click.linksynergy.com/link?id=EXAMPLE',
          fetchedAt: '2026-08-29T12:00:00.000Z',
          availability: AVAILABILITY_UNKNOWN,
        },
      ],
    },
  ],
  ...over,
});

const withTempDir = (fn: (dir: string) => void) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpu-offers-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe('the write is atomic and validated', () => {
  it('publishes a file the reader accepts', () => {
    withTempDir((dir) => {
      const file = path.join(dir, 'gpu-offers.json');
      writeSnapshotAtomically(file, snapshot());
      const parsed = parseOfferSnapshot(JSON.parse(fs.readFileSync(file, 'utf-8')));
      expect(parsed.ok).toBe(true);
    });
  });

  it('leaves no temporary file behind', () => {
    withTempDir((dir) => {
      writeSnapshotAtomically(path.join(dir, 'gpu-offers.json'), snapshot());
      expect(fs.readdirSync(dir)).toEqual(['gpu-offers.json']);
    });
  });

  it('replaces an existing snapshot in one step rather than truncating it', () => {
    withTempDir((dir) => {
      const file = path.join(dir, 'gpu-offers.json');
      writeSnapshotAtomically(file, snapshot());
      const first = fs.readFileSync(file, 'utf-8');

      writeSnapshotAtomically(file, snapshot({ generatedAt: '2026-08-30T12:00:00.000Z' }));
      const second = fs.readFileSync(file, 'utf-8');

      expect(second).not.toBe(first);
      expect(JSON.parse(second).generatedAt).toBe('2026-08-30T12:00:00.000Z');
      expect(fs.readdirSync(dir)).toEqual(['gpu-offers.json']);
    });
  });

  it('writes through a temporary file in the SAME directory', () => {
    // Rename is only atomic within a filesystem, so a temp under the system
    // temp dir would silently degrade this to a copy.
    withTempDir((dir) => {
      const file = path.join(dir, 'gpu-offers.json');
      const seen: string[] = [];
      const realWrite = fs.writeFileSync;
      const spy = ((target: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
        seen.push(String(target));
        return (realWrite as unknown as (...a: unknown[]) => void)(target, ...rest);
      }) as typeof fs.writeFileSync;
      Object.defineProperty(fs, 'writeFileSync', { value: spy, configurable: true, writable: true });
      try {
        writeSnapshotAtomically(file, snapshot());
      } finally {
        Object.defineProperty(fs, 'writeFileSync', { value: realWrite, configurable: true, writable: true });
      }
      expect(seen).toHaveLength(1);
      expect(path.dirname(seen[0])).toBe(dir);
      expect(seen[0]).not.toBe(file);
    });
  });

  it('refuses a snapshot that would not validate, without touching the existing file', () => {
    withTempDir((dir) => {
      const file = path.join(dir, 'gpu-offers.json');
      writeSnapshotAtomically(file, snapshot());
      const good = fs.readFileSync(file, 'utf-8');

      // A group claiming offers with none: the reader refuses this, so the
      // writer must too, rather than replacing a working file with it.
      const broken = snapshot({ gpus: [{ gpuId: 'rtx5070', result: 'offers', offers: [] }] });
      expect(() => writeSnapshotAtomically(file, broken)).toThrow(SnapshotWriteError);

      expect(fs.readFileSync(file, 'utf-8')).toBe(good);
      expect(fs.readdirSync(dir)).toEqual(['gpu-offers.json']);
    });
  });

  it('refuses when the target directory does not exist rather than creating one', () => {
    withTempDir((dir) => {
      const file = path.join(dir, 'nested', 'gpu-offers.json');
      expect(() => writeSnapshotAtomically(file, snapshot())).toThrow(/directory does not exist/);
      expect(fs.existsSync(path.join(dir, 'nested'))).toBe(false);
    });
  });

  it('ends the file with a newline and stable formatting', () => {
    const text = serializeSnapshot(snapshot());
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toBe(serializeSnapshot(snapshot()));
  });
});

describe('reading the currently published snapshot', () => {
  it('reports absent ONLY when the file does not exist', () => {
    withTempDir((dir) => {
      expect(readPublishedSnapshot(path.join(dir, 'gpu-offers.json'))).toEqual({ status: 'absent' });
    });
  });

  it('returns a valid published snapshot as the collapse baseline', () => {
    withTempDir((dir) => {
      const file = path.join(dir, 'gpu-offers.json');
      writeSnapshotAtomically(file, snapshot());
      const result = readPublishedSnapshot(file);
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.snapshot.gpus[0].gpuId).toBe('rtx5070');
    });
  });

  it('distinguishes malformed from invalid, and neither is absent', () => {
    // Absent means "first publish, no baseline needed". Anything else means
    // the baseline is in an unknown state, and the two must never collapse
    // into one status — that is what would silently disarm the collapse guard.
    withTempDir((dir) => {
      const file = path.join(dir, 'gpu-offers.json');

      fs.writeFileSync(file, '{ not json');
      expect(readPublishedSnapshot(file)).toEqual({ status: 'malformed' });

      fs.writeFileSync(file, JSON.stringify({ ...snapshot(), availability: 'in-stock' }));
      expect(readPublishedSnapshot(file)).toEqual({ status: 'invalid', problem: 'availability-not-unknown' });
    });
  });

  it('reports a permission error as unreadable, carrying Node\'s errno code and no message', () => {
    withTempDir((dir) => {
      const file = path.join(dir, 'gpu-offers.json');
      writeSnapshotAtomically(file, snapshot());
      fs.chmodSync(file, 0o000);
      try {
        const result = readPublishedSnapshot(file);
        // Running as root defeats a mode-based denial; skip rather than assert
        // something the filesystem did not actually do.
        if (result.status === 'ok') return;
        expect(result.status).toBe('unreadable');
        if (result.status !== 'unreadable') return;
        expect(result.errnoCode).toBe('EACCES');
        // The errno code, never the error's message — which interpolates the path.
        expect(JSON.stringify(result)).not.toContain(dir);
      } finally {
        fs.chmodSync(file, 0o644);
      }
    });
  });

  it('reports a directory in the file\'s place as unreadable, not absent', () => {
    withTempDir((dir) => {
      const asDir = path.join(dir, 'gpu-offers.json');
      fs.mkdirSync(asDir);
      const result = readPublishedSnapshot(asDir);
      expect(result.status).toBe('unreadable');
      if (result.status !== 'unreadable') return;
      expect(result.errnoCode).toBe('EISDIR');
    });
  });

  it('describes every status in one line that quotes no file content', () => {
    const lines = [
      describePublishedRead({ status: 'absent' }),
      describePublishedRead({ status: 'unreadable', errnoCode: 'EACCES' }),
      describePublishedRead({ status: 'malformed' }),
      describePublishedRead({ status: 'invalid', problem: 'offer-invalid' }),
      describePublishedRead({ status: 'ok', snapshot: snapshot() }),
    ];
    for (const line of lines) {
      expect(line.split('\n')).toHaveLength(1);
      expect(line).not.toContain('linksynergy');
      expect(line).not.toContain('599.99');
      expect(line).not.toContain('N82E');
    }
    expect(lines[1]).toContain('EACCES');
    expect(lines[3]).toContain('offer-invalid');
  });
});
