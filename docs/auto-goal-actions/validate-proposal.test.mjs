import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePatch } from './validate-proposal.mjs';

const patch = (path = 'artifacts/SpecSmith/src/components/PartSelector.tsx', body = '+export const flag = true;') => `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1,2 @@\n old\n${body}\n`;

test('a changed source file gets a stable binding', () => {
  const result = validatePatch(patch());
  assert.deepEqual(result.paths, ['artifacts/SpecSmith/src/components/PartSelector.tsx']);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  assert.notEqual(result.sha256, validatePatch(patch(undefined, '+export const flag = false;')).sha256);
});

test('refuses paths outside narrow source scope and path traversal', () => {
  for (const path of ['package.json', '.github/workflows/ci.yml', 'scripts/build.js', 'artifacts/SpecSmith/src/../.github/workflows/ci.yml', 'artifacts/SpecSmith/src/x.js', 'artifacts/SpecSmith/src//x.ts']) {
    assert.throws(() => validatePatch(patch(path)), /Refused/);
  }
});

test('refuses modes, links, new files, binary patches, and mismatched paths', () => {
  for (const extra of ['new file mode 100644\n', 'new mode 120000\n', 'GIT binary patch\n', 'rename from src/a.ts\n']) {
    assert.throws(() => validatePatch(patch().replace('index ', extra + 'index ')), /refused/i);
  }
  assert.throws(() => validatePatch(patch().replace('+++ b/artifacts/SpecSmith/src/components/PartSelector.tsx', '+++ b/artifacts/SpecSmith/src/components/Other.tsx')), /do not match/);
});

test('requires a regular index and matching paths in each diff section', () => {
  const other = 'artifacts/SpecSmith/src/components/Other.tsx';
  const first = patch();
  const second = patch(other);
  assert.deepEqual(validatePatch(first + second).paths, [other, 'artifacts/SpecSmith/src/components/PartSelector.tsx'].sort());
  const missingIndex = first.replace(/^index [^\n]+\n/m, '');
  const doubledIndex = second.replace(/^index [^\n]+\n/m, 'index 1111111..2222222 100644\nindex 1111111..2222222 100644\n');
  assert.throws(() => validatePatch(missingIndex + doubledIndex), /mode or missing index/);
  assert.throws(() => validatePatch(first + second.replace(`--- a/${other}`, '--- a/artifacts/SpecSmith/src/components/PartSelector.tsx')), /paths do not match/);
});

test('experimental workflow is not installed and every job is gated', () => {
  const workflow = readFileSync(new URL('./auto-goal-actions.yml', import.meta.url), 'utf8');
  for (const name of ['read-dispatch:', 'implement:', 'publish:', 'gate-checks:', 'check:', 'record-check:']) assert.ok(workflow.includes(`  ${name}`));
  assert.equal((workflow.match(/^    if: \$\{\{ false && github.ref == 'refs\/heads\/main' \}\}/gm) ?? []).length, 6);
  assert.match(workflow, /permissions: \{\}/); // Workflow default remains empty.
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /^on:\n  workflow_dispatch:\n/m);
  assert.ok(!workflow.includes('pull_request_target:'));
});

test('template keeps credentials and write scope out of the code-running job', () => {
  const yaml = readFileSync(new URL('./auto-goal-actions.yml', import.meta.url), 'utf8');
  const JOBS = 'read-dispatch|implement|publish|gate-checks|check|record-check';
  const sections = Object.fromEntries([...yaml.matchAll(new RegExp(`^  (${JOBS}):\n([\\s\\S]*?)(?=^  (?:${JOBS}):|$(?![\\s\\S]))`, 'gm'))].map((m) => [m[1], m[2]]));
  assert.deepEqual(Object.keys(sections), ['read-dispatch', 'implement', 'publish', 'gate-checks', 'check', 'record-check']);
  // The record is read in its own job (issues read, plus contents read for the trusted executor checkout); implement gets only the packet.
  const read = sections['read-dispatch'];
  assert.match(read, /permissions:\n      issues: read\n      contents: read\n/);
  assert.match(read, /packet: \$\{\{ steps\.dispatch\.outputs\.packet \}\}/);
  assert.match(read, /dispatch-guard\.mjs read/);
  assert.doesNotMatch(read, /secrets\./);
  assert.match(sections.implement, /permissions:\n      contents: read\n    steps:/);
  assert.match(sections.implement, /secrets\.CLAUDE_CODE_OAUTH_TOKEN/);
  assert.match(sections.implement, /needs\.read-dispatch\.outputs\.packet/);
  assert.doesNotMatch(sections.implement, /issues: read|github\.token|github_token/);
  assert.doesNotMatch(sections.implement, /contents: write|pull-requests: write/);
  assert.match(sections.check, /permissions:\n      contents: read\n    strategy:/);
  assert.match(sections.check, /timeout-minutes: 20/);
  assert.doesNotMatch(sections.check, /secrets\.|contents: write|pull-requests: write|issues: /);
  assert.doesNotMatch(sections.check, /statuses: |github\.token|GH_TOKEN/); // the code-running job cannot record its own result
  assert.doesNotMatch(sections.check, /cache: pnpm|actions\/cache@/);
  // The record re-read before the checks has its own job, so the code-running job gets no issues scope.
  assert.match(sections['gate-checks'], /permissions:\n      issues: read\n      contents: read\n/);
  assert.match(sections['gate-checks'], /dispatch-guard\.mjs pre-check/);
  assert.match(sections.check, /needs: \[read-dispatch, publish, gate-checks\]/);
  assert.match(sections.publish, /needs: \[read-dispatch, implement\]/);
  assert.match(sections.publish, /contents: write/);
  // Trusted code is always the executor commit: every trusted checkout is github.sha.
  assert.equal((yaml.match(/ref: \$\{\{ github.sha \}\}/g) ?? []).length, 5);
  assert.doesNotMatch(yaml, /uses: (?:anthropics\/claude-code-action|actions\/(?:upload|download)-artifact)@v\d/);
  assert.doesNotMatch(sections.publish, /secrets\.CLAUDE|pnpm|npm (?:run|test)|node_modules/);
  assert.match(sections.publish, /git apply --check/);
  assert.match(sections.publish, /git ls-files --stage/);
  assert.match(sections.publish, /test "\$mode" = '100644'/);
  assert.match(sections.publish, /git commit -m/);
  assert.match(sections.publish, /echo "sha=\$\(git rev-parse HEAD\)" >> "\$GITHUB_OUTPUT"/);
  assert.match(sections.check, /ref: \$\{\{ needs\.publish\.outputs\.proposal_sha \}\}/);
  assert.match(sections.check, /test "\$\(git rev-parse HEAD\)" = "\$PROPOSAL_SHA"/);
  for (const section of Object.values(sections)) assert.match(section, /if: \$\{\{ false && github.ref == 'refs\/heads\/main' \}\}/);
});

test('publish: the guard is the step immediately before the push, and the push is a lease from the dispatch base', () => {
  const yaml = readFileSync(new URL('./auto-goal-actions.yml', import.meta.url), 'utf8');
  const step = /      - name: Guard and push \(compare-and-swap from the dispatch base\)\n([\s\S]*?)(?=\n      - name: )/.exec(yaml)?.[1] ?? '';
  const lines = step.slice(step.indexOf('run: |')).split('\n').map((l) => l.trim()).filter((l) => l && l !== 'run: |' && l !== 'set -euo pipefail');
  assert.equal(lines[0], 'node ../trusted/docs/auto-goal-actions/dispatch-guard.mjs pre-push');
  const push = lines.findIndex((l) => l.includes(' push '));
  assert.ok(push > 0 && lines.slice(1, push).every((l) => /^(branch|if |expect)=?/.test(l) || l.startsWith('if [')), 'only variable setup between the guard and the push');
  assert.match(lines[push], /push --force-with-lease="refs\/heads\/\$\{branch\}:\$\{expect\}" origin "\$\{PROPOSAL_SHA\}:refs\/heads\/\$\{branch\}"/);
  assert.equal(push, lines.length - 1, 'the push is the step\'s last command');
  // The commit carries both trailers; the PR step re-reads the record before it opens or confirms a PR.
  assert.match(yaml, /git commit -m "Auto Goal \$\{GOAL\}: .*" -m "Auto-Goal-Dispatch: \$\{NONCE\}" -m "Auto-Goal-Run: \$\{GITHUB_RUN_ID\}"/);
  const pr = /      - name: Re-read the record, then open or confirm the draft PR\n([\s\S]*?)(?=\n\n  )/.exec(yaml)?.[1] ?? '';
  assert.ok(pr.indexOf('dispatch-guard.mjs post-push') > 0 && pr.indexOf('dispatch-guard.mjs post-push') < pr.indexOf('gh pr create'));
  assert.match(pr, /published after the goal stopped; it was not checked and must not be used\./);
});

test('rejects malformed UTF-8 and an existing symlink mode', () => {
  const first = Buffer.from(patch());
  assert.throws(() => validatePatch(Buffer.concat([first, Buffer.from([0xff])])), /UTF-8/);
  assert.throws(() => validatePatch(patch().replace('100644', '120000')), /mode/);
  assert.throws(() => validatePatch(patch().replace('100644', '160000')), /mode/);
});
