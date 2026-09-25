// Structural checks on the content-automator offline end-to-end pipeline's CI
// evidence workflow, mirroring the role auditRetailerLinksWorkflowSafety.test.ts
// plays for audit-retailer-links.yml — this workflow holds no credential at
// all, so there is no secret boundary to verify: only that it stays that
// way, stays scoped to this one branch (plus a manual rerun trigger), and
// never publishes or commits anything.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..', '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'content-e2e-offline.yml');
const yaml = fs.readFileSync(workflowPath, 'utf-8');
/** Workflow body with comment lines removed, so prose cannot satisfy a check. */
const body = yaml
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

describe('the content-automator offline e2e workflow is manual, credential-free and non-publishing', () => {
  it('exists', () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
  });

  it('triggers on push to the implementation branch only, plus workflow_dispatch for reruns', () => {
    // workflow_dispatch cannot be triggered via the API for a workflow file
    // that only exists on a non-default branch — see this file's own header
    // — so a scoped `push` (the same pattern audit-retailer-links.yml and
    // validate-retail-snapshot.yml already use for the same reason) is what
    // actually produces pre-merge evidence.
    expect(body).toMatch(/on:\s*\n\s*push:/);
    expect(body).toContain('claude/intelligent-bohr-naord4');
    expect(body).toContain('workflow_dispatch:');
  });

  it('has NO pull_request trigger and no schedule', () => {
    expect(body).not.toMatch(/^\s*(pull_request|pull_request_target|schedule):/m);
  });

  it('references no secret anywhere', () => {
    expect(body).not.toContain('secrets.');
  });

  it('has read-only permissions, an exact checkout and no persisted git credential', () => {
    expect(body).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(body).toContain('ref: ${{ github.sha }}');
    expect(body).toContain('persist-credentials: false');
    expect(body).not.toContain('contents: write');
  });

  it('pins every action to a 40-character SHA with a reviewable version comment', () => {
    const uses = [...yaml.matchAll(/^\s*uses:\s*(\S+)(.*)$/gm)];
    expect(uses.length).toBeGreaterThan(0);
    for (const [, ref, comment] of uses) {
      expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      expect(comment.trim()).toMatch(/^#\s*v\d/);
    }
    expect(yaml).not.toMatch(/uses:\s*\S+@(v\d|main|master|latest)\b/);
  });

  it('uses the same audited shared-action pins as the other manual evidence-gate workflow', () => {
    const refsOf = (text: string): Set<string> =>
      new Set([...text.matchAll(/uses:\s*(\S+@[0-9a-f]{40})/g)].map((match) => match[1]));
    // checkout/pnpm/setup-node/upload-artifact all come from the existing
    // accepted-offers audit, the other workflow that installs, tests, builds
    // and uploads a one-day evidence artifact.
    const known = refsOf(fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'audit-accepted-offers.yml'), 'utf-8'));
    const mine = [...refsOf(yaml)];
    expect(mine.length).toBeGreaterThan(0);
    for (const ref of mine) expect(known.has(ref), ref).toBe(true);
  });

  it('runs typecheck, the targeted content-automator tests, the full suite and a production build', () => {
    expect(body).toContain('pnpm typecheck');
    expect(body).toMatch(/vitest run scripts\/content-automator\s*2>&1/);
    expect(body).toMatch(/pnpm exec vitest run 2>&1/); // the untargeted full-suite run
    expect(body).toContain('pnpm run build');
  });

  it('installs Playwright Chromium and the offline TTS/compose system deps, with no paid provider', () => {
    expect(body).toContain('playwright install --with-deps chromium');
    expect(body).toContain('espeak-ng');
    expect(body).toContain('ffmpeg');
    expect(body).not.toMatch(/ELEVENLABS|GEMINI|MESHY|YOUTUBE_DATA_API_KEY|TIKTOK_BUSINESS/);
  });

  it('installs ffmpeg and espeak-ng BEFORE any step that shells out to them', () => {
    // Real CI failure, run 35932312150: the install step sat at position 12,
    // below the test steps at 7 and 8. `offlineBeatFixtures.test.ts` and
    // `renderManifest.test.ts` drive the real offline adapters on purpose —
    // a fixture adapter that only passes against a mock is precisely the
    // defect this subsystem keeps reproducing — so they spawned the binaries
    // directly and died with `spawn ffmpeg ENOENT` / `spawn espeak-ng ENOENT`
    // (9 failed / 372 passed) long before the render step was reached. Step
    // ORDER is load-bearing here, not just step presence, so assert it.
    const names = [...body.matchAll(/^\s*- name:\s*(.+)$/gm)].map((match) => match[1].trim());
    const installIndex = names.findIndex((name) => /ffmpeg and espeak-ng/i.test(name));
    expect(installIndex, 'no ffmpeg/espeak-ng install step').toBeGreaterThan(-1);

    // Every step whose body invokes the binaries, or runs the suites that do.
    const steps = body.split(/\n(?=\s*- name:)/).filter((step) => /- name:/.test(step));
    const consumers = steps
      .map((step, index) => ({ index, step }))
      .filter(({ step }) => /\bffmpeg\b|\bffprobe\b|\bespeak-ng\b|vitest run/.test(step))
      .filter(({ index }) => index !== installIndex);
    expect(consumers.length, 'no step consumes ffmpeg/espeak-ng').toBeGreaterThan(0);
    for (const { index } of consumers) {
      expect(index, `"${names[index]}" runs before the install step`).toBeGreaterThan(installIndex);
    }
  });

  it('greps only for publish-gate refusal codes that publishGate.ts can actually emit', () => {
    // REAL CI FAILURE, run 35933143796. The render step grepped its log for
    // "non-liam-narration" — a code that does not exist. publishGate.ts emits
    // narration-not-elevenlabs and narration-voice-not-liam; the name changed
    // when the gate was rewritten and this string did not follow. The
    // assertion was therefore unsatisfiable: it failed the job while the gate
    // underneath refused correctly, for all 8 expected reasons.
    //
    // It failed CLOSED, which is the safe direction, but an assertion that
    // can never pass is not evidence of anything. The same typo in a
    // `grep -v` or a negated check would have failed OPEN and quietly waved
    // a fixture render through. Pin the strings to the source.
    const gateSource = fs.readFileSync(path.join(here, 'publishGate.ts'), 'utf-8');
    const emitted = new Set([...gateSource.matchAll(/code:\s*"([a-z-]+)"/g)].map((match) => match[1]));
    expect(emitted.size, 'no refusal codes found in publishGate.ts').toBeGreaterThan(5);

    // Only greps aimed at a log file this workflow writes — not the ffmpeg
    // capability probes, which match encoder names, not gate codes.
    const logGreps = [...body.matchAll(/grep -q[E]?\s+"([^"]+)"\s+"\$\{RUNNER_TEMP\}[^"]*"/g)].map((m) => m[1]);
    expect(logGreps.length, 'no log greps found').toBeGreaterThan(0);

    const codeLike = /^[a-z]+(?:-[a-z0-9]+)+$/;
    const checked: string[] = [];
    for (const pattern of logGreps) {
      for (const alternative of pattern.split('|')) {
        const token = alternative.trim();
        if (!codeLike.test(token)) continue; // prose like "Evidence check: NO MATCH"
        checked.push(token);
        expect(emitted.has(token), `the workflow greps for "${token}", which publishGate.ts never emits`).toBe(true);
      }
    }
    expect(checked.length, 'no gate codes were actually checked').toBeGreaterThan(0);
  });

  it('serves the built app locally rather than depending on any external host', () => {
    expect(body).toContain('npx --yes serve dist/public');
    expect(body).toContain('SPECSMITH_RENDER_BASE_URL: http://localhost:5178');
  });

  it('runs the real offline end-to-end pipeline script', () => {
    expect(body).toContain('scripts/content-automator/endToEndOfflinePipeline.ts');
  });

  it('captures the pipeline exit code rather than letting the documented evidence-mismatch stop fail the job', () => {
    // See the workflow's own header for why: the render is not
    // byte-reproducible across machines, so a fresh CI render very likely
    // will not match the one committed, already-inspected evidence file —
    // and that is the fail-closed gate blocker #2 added working correctly,
    // not a bug in this workflow.
    expect(body).toContain('set +e');
    expect(body).toContain('pipeline-exit-code.txt');
    expect(body).toContain('Evidence check: NO MATCH');
    expect(body).toContain('exit "${code}"');
  });

  // STRICT FULL SUITE. An interim revision deferred this step's verdict and
  // judged it against the merge-base, to tolerate four failures inherited
  // from main. A new defect inside an already-failing test kept the same
  // identity and passed as "inherited", so once #154 repaired those tests on
  // main the allowance was removed. These tests keep it removed.
  const codeOnly = body.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  const codeSteps = codeOnly.split(/\n(?=\s*- name:)/).filter((step) => /- name:/.test(step));
  const codeNames = codeSteps.map((step) => step.match(/- name:\s*(.+)/)![1].trim());
  const stepIndex = (pattern: RegExp) => codeNames.findIndex((name) => pattern.test(name));

  it('runs the complete suite strictly, failing the job in place', () => {
    const fullIndex = stepIndex(/^Run the full test suite$/);
    expect(fullIndex, 'no strict full-suite step').toBeGreaterThan(-1);
    const full = codeSteps[fullIndex];
    expect(full).toMatch(/working-directory: artifacts\/SpecSmith/);
    expect(full).toMatch(/set -o pipefail\s*\n\s*pnpm exec vitest run 2>&1 \| tee/);
    expect(full).not.toMatch(/continue-on-error|set \+e|\|\|\s*true|if:|exit-code|code=\$\?/);
    const targeted = codeSteps[stepIndex(/content-automator test suite \(targeted\)/i)];
    expect(targeted).not.toMatch(/continue-on-error|set \+e|\|\|\s*true|if:/);
  });

  it('builds only after the full suite has passed', () => {
    const buildIndex = stepIndex(/Build the production application/i);
    expect(buildIndex).toBeGreaterThan(stepIndex(/^Run the full test suite$/));
    expect(codeSteps[buildIndex]).toContain('pnpm run build');
    expect(codeSteps[buildIndex]).not.toMatch(/if:/);
  });

  it('has no exclusion, narrowing, deferred verdict or differential allowance', () => {
    // Deleting coverage to get a green tick would also hide a genuine
    // regression in the excluded files.
    expect(codeOnly).not.toMatch(/--exclude|\.skip\b|--testNamePattern|--passWithNoTests|--bail|continue-on-error/);
    expect(codeOnly).not.toMatch(/differentialFullSuite|merge-base|--base-dir|worktree add|full-suite-exit-code|Re-raise/);
    expect(fs.existsSync(path.join(here, '..', 'ci', 'differentialFullSuite.mjs'))).toBe(false);
  });

  it('checks out and reports the exact commit under test', () => {
    const checkout = codeSteps[stepIndex(/Check out the exact selected commit/i)];
    expect(checkout).toContain('ref: ${{ github.sha }}');
    expect(checkout).toContain('persist-credentials: false');
    expect(codeSteps[stepIndex(/Report the commit under test/i)]).toContain('Running commit ${GITHUB_SHA}');
  });

  it('uploads exactly the one evidence directory for one day, and does not commit or publish it', () => {
    expect(body).toContain('path: ${{ runner.temp }}/e2e');
    expect(body).toContain('retention-days: 1');
    expect(body).toContain('if-no-files-found: error');
    for (const forbidden of ['git add', 'git commit', 'git push', 'ELEVENLABS_API_KEY']) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  it('every step piping a command through `tee` sets pipefail first, so a real failure cannot report green', () => {
    // Real bug, found by independent review of an actual CI run: `cmd | tee
    // log` reports the STEP's exit code as `tee`'s (always 0), not `cmd`'s,
    // unless pipefail is set — confirmed by direct local reproduction
    // (`false | tee log` exits 0 without it, 1 with it). That let a real
    // vitest failure (1 failed / 1,929 passed, scripts/measured/
    // cancellation.test.ts) show as a green step and a green job. Every step
    // block containing `| tee` must set pipefail before the piped command.
    const steps = body.split(/\n(?=\s*- name:)/);
    const teeSteps = steps.filter((step) => step.includes('| tee'));
    expect(teeSteps.length).toBeGreaterThan(0);
    for (const step of teeSteps) {
      // `echo "literal string" | tee <path>` cannot itself fail — there is no
      // command upstream of the pipe whose exit code pipefail needs to catch
      // — so it is not an instance of the masking bug this test guards
      // against and is exempted rather than forced into an unneeded
      // `set -o pipefail`.
      const teeLines = step.split('\n').filter((line) => line.includes('| tee') && !line.trim().startsWith('echo '));
      if (teeLines.length === 0) continue;
      const teeLine = teeLines[0];
      const pipefailIndex = step.indexOf('set -o pipefail') !== -1 ? step.indexOf('set -o pipefail') : step.indexOf('set -euo pipefail');
      const teeIndex = step.indexOf(teeLine);
      expect(pipefailIndex, `step missing pipefail before: ${teeLine.trim()}`).toBeGreaterThan(-1);
      expect(pipefailIndex, `pipefail must come before the piped command in: ${teeLine.trim()}`).toBeLessThan(teeIndex);
    }
  });

  it('confirms the checkout stayed clean, ignoring only this run\'s own gitignored output', () => {
    expect(body).toContain('git status --porcelain');
    expect(body).toMatch(/- name: Confirm the repository was not modified\s*\n\s*if:\s*always\(\)/);
    // The pipeline's own render/store output is real, gitignored, generated
    // content — asserting the checkout is clean must not choke on it.
    expect(body).toContain("':!artifacts/SpecSmith/render-output'");
    expect(body).toContain("':!artifacts/SpecSmith/content-ideas'");
  });
});
