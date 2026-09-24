// Structural checks on .github/workflows/verify-pr.yml.
//
// REAL CI FAILURE, verify-pr run 36064271196 (PR #153, head 56c7f68): six
// content-automator tests failed with `spawn ffmpeg ENOENT` because this
// workflow ran the suite without installing ffmpeg or espeak-ng, and the
// build was then skipped. content-e2e-offline.yml passed on the same head
// because it provisions them first. Step ORDER is what matters, so it is
// asserted, together with the capability checks and the differential
// full-suite verdict that must still fail on every new head failure.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const body = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'verify-pr.yml'), 'utf-8');

// Comment lines are dropped: a comment above a step is split into the
// PREVIOUS step's text, and one that merely mentions ffmpeg is not a consumer.
const steps = body
  .split(/\n(?=\s*- name:)/)
  .filter((step) => /- name:/.test(step))
  .map((step) => step.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n'));
const names = steps.map((step) => step.match(/- name:\s*(.+)/)![1].trim());
const indexOf = (pattern: RegExp): number => names.findIndex((name) => pattern.test(name));

describe('verify-pr provisions the media tools before any test runs', () => {
  const installIndex = indexOf(/ffmpeg and espeak-ng/i);

  it('has an install step for ffmpeg and espeak-ng', () => {
    expect(installIndex, 'no ffmpeg/espeak-ng install step').toBeGreaterThan(-1);
    expect(steps[installIndex]).toMatch(/apt-get install -y --no-install-recommends ffmpeg espeak-ng/);
  });

  it('checks capabilities, not just presence', () => {
    const install = steps[installIndex];
    // The check COMMANDS, not just words: an error message that still says
    // "aac" after its grep is deleted must not satisfy this.
    const checks: RegExp[] = [
      /ffmpeg -hide_banner -encoders \| grep -q ' libx264 '/,
      /ffmpeg -hide_banner -encoders \| grep -qE '\^ A\.\.\.\.D aac '/,
      /ffmpeg -hide_banner -muxers \| grep -qE ' mp4 '/,
      /ffmpeg -hide_banner -filters \| grep -qE ' \(ass\|subtitles\) '/,
      /espeak-ng -q --stdout "capability check" > \/dev\/null/,
    ];
    for (const check of checks) {
      expect(install, `missing capability check: ${check}`).toMatch(check);
    }
    expect(install).toMatch(/set -euo pipefail/);
  });

  it('runs every step that executes tests, or the media tools, after the install', () => {
    const consumers = steps
      .map((step, index) => ({ index, step }))
      .filter(({ index }) => index !== installIndex)
      .filter(({ step }) => /vitest|differentialFullSuite|\bffmpeg\b|\bffprobe\b|\bespeak-ng\b/.test(step));
    expect(consumers.length, 'no step runs the tests').toBeGreaterThan(1);
    for (const { index } of consumers) {
      expect(index, `"${names[index]}" runs before the media tools are installed`).toBeGreaterThan(installIndex);
    }
  });
});

describe('verify-pr keeps full coverage and a binding verdict', () => {
  it('runs the content-automator suite as a hard, non-differential step', () => {
    const targeted = steps[indexOf(/content-automator test suite/i)];
    expect(targeted).toMatch(/vitest run scripts\/content-automator\s*$/m);
    expect(targeted).not.toMatch(/continue-on-error|\|\|\s*true|set \+e/);
  });

  it('judges the whole suite with the base-versus-head differential runner, and lets it fail the job', () => {
    const differential = steps[indexOf(/full test suite at head and base/i)];
    expect(differential).toContain('node scripts/ci/differentialFullSuite.mjs --base-dir');
    expect(differential).not.toMatch(/continue-on-error|\|\|\s*true|set \+e/);
    expect(body).toMatch(/git merge-base HEAD/);
    expect(body).toMatch(/fetch-depth: 0/);
  });

  it('never narrows the run to get a green tick', () => {
    expect(body).not.toMatch(/--exclude|\.skip\b|--testNamePattern|continue-on-error|--passWithNoTests/);
  });

  it('builds after the tests, and only when they pass', () => {
    const buildIndex = indexOf(/Build and prerender/i);
    expect(buildIndex).toBeGreaterThan(indexOf(/full test suite at head and base/i));
    expect(steps[buildIndex]).toContain('pnpm run build');
    expect(steps[buildIndex]).not.toMatch(/if:\s*always\(\)/);
  });

  it('still proves the exact head and a clean tree', () => {
    expect(indexOf(/Prove the exact commit under test/i)).toBeGreaterThan(-1);
    expect(steps[indexOf(/did not modify the repository/i)]).toMatch(/if:\s*always\(\)/);
  });
});
