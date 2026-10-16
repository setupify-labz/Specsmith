import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MATCHUPS, CPU_MATCHUPS } from './matchups';
import { UPGRADE_PAGES } from './upgradePages';
import { catalogLabel } from './catalogLifecycle';
import { getGpuTiers } from './gpuTierList';

// Retired public routes must 301 to a live page rather than 404, so search
// engines and old links land somewhere useful. Reads the same _redirects file
// Cloudflare serves.

const appRoot = path.resolve(import.meta.dirname, '..', '..');
const redirects = fs.readFileSync(path.join(appRoot, 'public', '_redirects'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => line.split(/\s+/));

const entryServer = fs.readFileSync(path.join(appRoot, 'src', 'entry-server.tsx'), 'utf8');
const liveRoutes = new Set([
  ...MATCHUPS.map((m) => `/vs/${m.slug}`),
  ...CPU_MATCHUPS.map((m) => `/vs/${m.slug}`),
  ...UPGRADE_PAGES.map((p) => `/upgrade/${p.slug}`),
]);
const isLive = (route: string) => liveRoutes.has(route) || entryServer.includes(`'${route}',`);

describe('retired routes', () => {
  it('every redirect is a permanent 301 from a retired route to a live route', () => {
    expect(redirects.length).toBeGreaterThan(0);
    for (const [from, to, status] of redirects) {
      expect(status, from).toBe('301');
      expect(isLive(from), `${from} is still a live route`).toBe(false);
      expect(isLive(to), `${to} is not a live route`).toBe(true);
    }
  });

  it('retires every public page built on the invalid desktop RTX 4050', () => {
    const retired = new Set(redirects.map(([from]) => from));
    for (const route of ['/vs/rtx-4050-vs-arc-b570', '/vs/rtx-5050-vs-rtx-4050', '/upgrade/rtx-4050']) {
      expect(retired.has(route), route).toBe(true);
    }
    const invalidGpu = (id: string) => catalogLabel(id) === 'invalid';
    expect(MATCHUPS.filter((m) => invalidGpu(m.gpuA) || invalidGpu(m.gpuB))).toEqual([]);
    expect(UPGRADE_PAGES.filter((p) => invalidGpu(p.gpuId))).toEqual([]);
  });

  it('keeps invalid parts out of the GPU tier list buying guide', () => {
    const listed = getGpuTiers().flatMap((tier) => tier.gpus.map((entry) => entry.gpu.id));
    expect(listed).not.toContain('rtx4050');
    expect(listed).toContain('rtx3060'); // older parts stay
  });
});
