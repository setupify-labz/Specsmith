// Structural checks on .github/workflows/verify-pr.yml.
//
// REAL CI FAILURE, verify-pr run 36064271196 (PR #153, head 56c7f68): six
// content-automator tests failed with `spawn ffmpeg ENOENT` because this
// workflow ran the suite without installing ffmpeg or espeak-ng, and the
// build was then skipped. Step ORDER is what matters, so it is asserted.
//
// The full suite is STRICT: one untargeted `vitest run` whose failure fails
// the job in place. An interim revision compared failures against the
// merge-base to tolerate four failures inherited from main; that let a new
// defect inside an already-failing test pass as "inherited", so it was
// removed once #154 repaired those tests on main. These checks keep it out.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const body = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'verify-pr.yml'), 'utf-8');

/** The workflow with every comment line removed: comments are not behaviour. */
const code = body.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
// A comment above a step is split into the PREVIOUS step's text, so steps are
// cut from the comment-free text.
const steps = code.split(/\n(?=\s*- name:)/).filter((step) => /- name:/.test(step));
const names = steps.map((step) => step.match(/- name:\s*(.+)/)![1].trim());
const indexOf = (pattern: RegExp): number => names.findIndex((name) => pattern.test(name));
const stepNamed = (pattern: RegExp): string => {
  const index = indexOf(pattern);
  expect(index, `no step matching ${pattern}`).toBeGreaterThan(-1);
  return steps[index];
};

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
      .filter(({ step }) => /vitest|\bffmpeg\b|\bffprobe\b|\bespeak-ng\b/.test(step));
    expect(consumers.length, 'no step runs the tests').toBeGreaterThan(0);
    for (const { index } of consumers) {
      expect(index, `"${names[index]}" runs before the media tools are installed`).toBeGreaterThan(installIndex);
    }
  });
});

describe('verify-pr runs the complete suite strictly', () => {
  it('runs the whole suite, untargeted, as its own step', () => {
    const full = stepNamed(/^Run full test suite$/);
    expect(full).toMatch(/working-directory: artifacts\/SpecSmith/);
    expect(full).toMatch(/run: pnpm exec vitest run\s*$/m);
  });

  it('lets a failing suite fail the job in place', () => {
    for (const pattern of [/^Run full test suite$/, /content-automator test suite/i]) {
      const step = stepNamed(pattern);
      expect(step, `${pattern} must not mask failure`).not.toMatch(/continue-on-error|\|\|\s*true|set \+e|if:/);
    }
  });

  it('has no exclusion, skip, narrowing or differential allowance anywhere', () => {
    expect(code).not.toMatch(/--exclude|\.skip\b|--testNamePattern|--passWithNoTests|--bail|continue-on-error/);
    expect(code).not.toMatch(/differentialFullSuite|merge-base|--base-dir|worktree add/);
    expect(code).not.toMatch(/\|\|\s*true/);
  });

  it('builds only after the tests, and only when they pass', () => {
    const buildIndex = indexOf(/Build and prerender/i);
    expect(buildIndex).toBeGreaterThan(indexOf(/^Run full test suite$/));
    expect(buildIndex).toBeGreaterThan(indexOf(/content-automator test suite/i));
    expect(steps[buildIndex]).toContain('pnpm run build');
    expect(steps[buildIndex]).not.toMatch(/if:/);
  });
});

describe('verify-pr still proves the exact head and a clean tree', () => {
  it('checks out and proves the exact PR head without persisting credentials', () => {
    const checkout = stepNamed(/Check out the exact selected head/i);
    expect(checkout).toContain('ref: ${{ github.event.pull_request.head.sha || github.sha }}');
    expect(checkout).toContain('persist-credentials: false');
    const proof = stepNamed(/Prove the exact commit under test/i);
    expect(proof).toMatch(/test "\$\{actual\}" = "\$\{EXPECTED_HEAD\}"/);
    expect(indexOf(/Prove the exact commit under test/i)).toBeLessThan(indexOf(/^Run full test suite$/));
  });

  it('confirms the tree is clean even when an earlier step failed', () => {
    const clean = stepNamed(/did not modify the repository/i);
    expect(clean).toMatch(/if:\s*always\(\)/);
    expect(clean).toContain('git status --porcelain');
  });
});
