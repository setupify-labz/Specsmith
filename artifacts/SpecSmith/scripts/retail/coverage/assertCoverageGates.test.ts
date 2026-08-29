import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadGpuCatalog } from '../rakuten';
import { emptyFailureCounts, emptyRejectionCounts, type CoverageReport, type GpuCoverage } from './coverageReport';
import { assertEmissionSafe, evaluateGates, readReport, renderGateSummary } from './assert-coverage-gates';

const catalogSize = loadGpuCatalog().length;

const gpu = (over: Partial<GpuCoverage> = {}): GpuCoverage => ({
  gpuId: 'rtx4070',
  gpuName: 'RTX 4070',
  status: 'ok',
  accepted: 0,
  rejected: 0,
  itemsSeen: 0,
  pagesRead: 1,
  totalMatches: 0,
  emptyResult: true,
  rejectionsByReason: emptyRejectionCounts(),
  failure: null,
  ...over,
});

/** A report where every gate passes: every GPU measured, nothing failed. */
function passingReport(over: Partial<CoverageReport> = {}): CoverageReport {
  const gpus: GpuCoverage[] = [
    gpu({ gpuId: 'rtx5070', accepted: 4, rejected: 3, itemsSeen: 7, emptyResult: false }),
    ...Array.from({ length: catalogSize - 1 }, (_, i) => gpu({ gpuId: `empty-${i}` })),
  ];
  return {
    startedAt: '2026-08-29T09:00:00.000Z',
    finishedAt: '2026-08-29T09:00:40.000Z',
    durationMs: 40_000,
    requestsPerMinuteLimit: 90,
    gpusMeasured: gpus.length,
    gpusSucceeded: gpus.length,
    gpus,
    totals: {
      accepted: 4,
      rejected: 3,
      itemsSeen: 7,
      pages: catalogSize,
      requests: catalogSize,
      rateLimited: 0,
      httpErrors: 0,
      transportErrors: 0,
      failures: 0,
      waitedMs: 38_000,
    },
    rejectionsByReason: emptyRejectionCounts(),
    zeroOfferGpuIds: gpus.filter((g) => g.accepted === 0).map((g) => g.gpuId),
    failedGpuIds: [],
    failuresByCategory: emptyFailureCounts(),
    pagingFailuresByReason: {},
    emptyResultGpuIds: gpus.filter((g) => g.emptyResult).map((g) => g.gpuId),
    ...over,
  };
}

const namedGate = (report: CoverageReport, name: string, sweepExit = 0) =>
  evaluateGates(report, catalogSize, sweepExit).find((g) => g.name === name)!;

describe('a clean live sweep passes every gate', () => {
  it('passes when all GPUs are measured and nothing failed', () => {
    const gates = evaluateGates(passingReport(), catalogSize, 0);
    expect(gates.filter((g) => !g.passed)).toEqual([]);
    expect(gates.length).toBeGreaterThanOrEqual(11);
  });

  it('does not care how many GPUs have no feed listing', () => {
    // The feed changes between runs. The previous sweep's 39 no-listing GPUs
    // are evidence about one moment, not an invariant — a gate pinning them
    // would fail the day Newegg listed one more card.
    for (const emptyCount of [0, 1, 39, catalogSize - 1]) {
      const gpus = [
        gpu({ gpuId: 'has-offers', accepted: 2, rejected: 1, itemsSeen: 3, emptyResult: false }),
        ...Array.from({ length: emptyCount }, (_, i) => gpu({ gpuId: `e${i}` })),
        ...Array.from({ length: catalogSize - 1 - emptyCount }, (_, i) =>
          gpu({ gpuId: `r${i}`, itemsSeen: 2, rejected: 2, emptyResult: false }),
        ),
      ];
      const report = passingReport({
        gpus,
        gpusMeasured: gpus.length,
        gpusSucceeded: gpus.length,
        zeroOfferGpuIds: gpus.filter((g) => g.accepted === 0).map((g) => g.gpuId),
        emptyResultGpuIds: gpus.filter((g) => g.emptyResult).map((g) => g.gpuId),
        totals: { ...passingReport().totals, accepted: 2, rejected: 1 + (catalogSize - 1 - emptyCount) * 2, itemsSeen: 3 + (catalogSize - 1 - emptyCount) * 2 },
      });
      expect(evaluateGates(report, catalogSize, 0).filter((g) => !g.passed), `empty=${emptyCount}`).toEqual([]);
    }
  });

  it('accepts a GPU whose single listing was rejected — a measured result, not a failure', () => {
    // Arc A750 previously returned one listing that every gate refused.
    const gpus = [
      gpu({ gpuId: 'arca750', itemsSeen: 1, rejected: 1, accepted: 0, emptyResult: false }),
      ...Array.from({ length: catalogSize - 1 }, (_, i) => gpu({ gpuId: `e${i}` })),
    ];
    const report = passingReport({
      gpus,
      zeroOfferGpuIds: gpus.map((g) => g.gpuId),
      emptyResultGpuIds: gpus.filter((g) => g.emptyResult).map((g) => g.gpuId),
      totals: { ...passingReport().totals, accepted: 0, rejected: 1, itemsSeen: 1 },
    });
    expect(evaluateGates(report, catalogSize, 0).filter((g) => !g.passed)).toEqual([]);
  });
});

describe('each gate fails for its own reason', () => {
  it('fails when fewer than the whole catalogue was attempted', () => {
    const short = passingReport({ gpusMeasured: catalogSize - 1 });
    expect(namedGate(short, 'every catalogue GPU attempted').passed).toBe(false);
  });

  it('fails when a GPU was attempted but not measured', () => {
    const report = passingReport({ gpusSucceeded: catalogSize - 1 });
    expect(namedGate(report, 'every attempted GPU measured').passed).toBe(false);
  });

  it('fails on any failed GPU, and never reports it as zero coverage', () => {
    const report = passingReport({
      totals: { ...passingReport().totals, failures: 1 },
      failedGpuIds: ['rtx4090'],
    });
    const gates = evaluateGates(report, catalogSize, 1);
    expect(gates.find((g) => g.name === 'no failed GPUs')!.passed).toBe(false);
    expect(gates.find((g) => g.name === 'coverage CLI exited zero')!.passed).toBe(false);
  });

  it('fails on an auth failure rather than calling it zero coverage', () => {
    // A 401 must be loud. Reporting it as "no offers" is the specific
    // mislabelling this gate exists to prevent.
    const report = passingReport({
      totals: { ...passingReport().totals, failures: catalogSize, httpErrors: catalogSize },
      failuresByCategory: { ...emptyFailureCounts(), auth: catalogSize },
    });
    const gates = evaluateGates(report, catalogSize, 1);
    expect(gates.find((g) => g.name === 'no failure of any category')!.passed).toBe(false);
    expect(gates.find((g) => g.name === 'no failure of any category')!.detail).toContain('auth');
    expect(gates.find((g) => g.name === 'no HTTP, auth, transport or rate-limit failures')!.passed).toBe(false);
  });

  it('fails on 429s', () => {
    const report = passingReport({ totals: { ...passingReport().totals, rateLimited: 3 } });
    expect(namedGate(report, 'no HTTP, auth, transport or rate-limit failures').passed).toBe(false);
  });

  it('fails on any paging failure, and names empty-shape-not-yet-observed separately', () => {
    // The exact symptom of running pre-c378f33 code against the live feed.
    const report = passingReport({
      failuresByCategory: { ...emptyFailureCounts(), paging: 39 },
      pagingFailuresByReason: { 'empty-shape-not-yet-observed': 39 },
      totals: { ...passingReport().totals, failures: 39 },
    });
    const gates = evaluateGates(report, catalogSize, 1);
    expect(gates.find((g) => g.name === 'no paging failures')!.passed).toBe(false);
    expect(gates.find((g) => g.name === 'no empty-shape-not-yet-observed')!.passed).toBe(false);
    expect(gates.find((g) => g.name === 'no empty-shape-not-yet-observed')!.detail).toContain('39');
  });

  it('fails when a listing was seen but neither accepted nor rejected', () => {
    const gpus = [gpu({ gpuId: 'lossy', itemsSeen: 5, accepted: 1, rejected: 1, emptyResult: false })];
    const report = passingReport({ gpus, gpusMeasured: catalogSize, gpusSucceeded: catalogSize });
    expect(namedGate(report, 'every listing seen was accepted or rejected').passed).toBe(false);
  });

  it('fails when the sweep exited nonzero even if every count looks clean', () => {
    expect(namedGate(passingReport(), 'coverage CLI exited zero', 1).passed).toBe(false);
  });
});

describe('the published summary is safe and honest', () => {
  it('states availability is unknown and makes no stock claim', () => {
    const summary = renderGateSummary(evaluateGates(passingReport(), catalogSize, 0), passingReport());
    expect(summary).toContain('Availability is unknown');
    expect(summary).toContain('No matching feed listing');
    for (const forbidden of [/\bin stock\b/i, /\bout of stock\b/i, /\bunavailable\b/i, /\bsold out\b/i]) {
      expect(summary, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it('reports the totals the task asks for', () => {
    const report = passingReport();
    const summary = renderGateSummary(evaluateGates(report, catalogSize, 0), report);
    for (const label of [
      'GPUs attempted',
      'Measured OK',
      'Failed',
      'With accepted offers',
      'No matching feed listing',
      'Listings returned, all rejected',
      'Listings seen',
      'Accepted',
      'Rejected',
    ]) {
      expect(summary, label).toContain(label);
    }
  });

  it('carries no URL, identifier or credential-shaped text', () => {
    const report = passingReport();
    const summary = renderGateSummary(evaluateGates(report, catalogSize, 0), report);
    expect(() => assertEmissionSafe(summary)).not.toThrow();
    expect(summary).not.toMatch(/https?:\/\//);
  });

  it('refuses to publish a summary that somehow contains one', () => {
    // The emission check runs on the FINAL text, so it covers anything a
    // future edit might add to the table as well as the embedded report.
    for (const bad of [
      'see https://click.linksynergy.com/x',
      'Authorization: Bearer abc',
      'sku N82E16814932663',
      'offerid=99',
    ]) {
      expect(() => assertEmissionSafe(bad), bad).toThrow(/Refusing to publish/);
    }
  });
});

describe('readReport refuses anything that is not a coverage report', () => {
  const withTemp = (contents: string | null, fn: (file: string) => void) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
    const file = path.join(dir, 'coverage.json');
    if (contents !== null) fs.writeFileSync(file, contents);
    try {
      fn(file);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it('reports a missing file', () => {
    withTemp(null, (file) => expect(() => readReport(file)).toThrow(/No coverage report/));
  });

  it('reports an empty file distinctly', () => {
    withTemp('', (file) => expect(() => readReport(file)).toThrow(/is empty/));
  });

  it('blames the sweep, not the report, when the sweep exited nonzero', () => {
    // The first CI run failed this way: a missing credential produced no JSON,
    // and the gate step reported "empty JSON" — pointing at the reporting path
    // when the fault was upstream of it.
    withTemp('', (file) => {
      const message = (() => {
        try {
          readReport(file, 1);
          return '';
        } catch (e) {
          return (e as Error).message;
        }
      })();
      expect(message).toContain('The sweep exited 1');
      expect(message).toContain('credential');
      expect(message).toContain('not a coverage result');
    });
  });

  it('does not quote a malformed body into the error message', () => {
    // A malformed report could contain anything, and this message goes into a
    // CI log — so the message states a length, never the content.
    withTemp('<html>Bearer leaked-value</html>', (file) => {
      expect(() => readReport(file)).toThrow(/not valid JSON \(\d+ bytes\)/);
      try {
        readReport(file);
      } catch (e) {
        expect((e as Error).message).not.toContain('leaked-value');
        expect((e as Error).message).not.toContain('Bearer');
      }
    });
  });

  it('rejects valid JSON that is not a coverage report', () => {
    withTemp('{"ok":true}', (file) => expect(() => readReport(file)).toThrow(/not a coverage report/));
  });

  it('reads a real report back', () => {
    withTemp(JSON.stringify(passingReport()), (file) => {
      expect(readReport(file).gpusMeasured).toBe(catalogSize);
    });
  });
});
