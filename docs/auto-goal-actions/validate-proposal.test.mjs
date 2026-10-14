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

test('experimental workflow is not installed and has three gated jobs', () => {
  const workflow = readFileSync(new URL('./auto-goal-actions.yml', import.meta.url), 'utf8');
  for (const name of ['implement:', 'check:', 'publish:']) assert.ok(workflow.includes(`  ${name}`));
  assert.match(workflow, /if: \$\{\{ false && github.ref == 'refs\/heads\/main' \}\}/);
  assert.match(workflow, /permissions: \{\}/); // Workflow default remains empty.
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /needs: publish/);
  assert.ok(!workflow.includes('pull_request_target:'));
});

test('template keeps credentials and write scope out of the code-running job', () => {
  const yaml = readFileSync(new URL('./auto-goal-actions.yml', import.meta.url), 'utf8');
  const sections = Object.fromEntries([...yaml.matchAll(/^  (implement|check|publish):\n([\s\S]*?)(?=^  (?:implement|check|publish):|$(?![\s\S]))/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(Object.keys(sections), ['implement', 'publish', 'check']);
  // The issue is read in its own job with an issues-only token; implement gets only its JSON.
  const readIssue = /^  read-issue:\n([\s\S]*?)(?=^  implement:)/m.exec(yaml)?.[1] ?? '';
  assert.match(readIssue, /permissions:\n      issues: read\n/);
  assert.match(readIssue, /repos\/\$\{GITHUB_REPOSITORY\}\/issues\/\$\{ISSUE\}/);
  assert.match(readIssue, /\.state == "open"/);
  assert.match(readIssue, /index\("auto-goal"\)/);
  assert.match(readIssue, /issue_json: \$\{\{ steps\.issue\.outputs\.issue_json \}\}/);
  assert.doesNotMatch(readIssue, /secrets\./);
  assert.match(sections.implement, /permissions:\n      contents: read\n    steps:/);
  assert.match(sections.implement, /secrets\.CLAUDE_CODE_OAUTH_TOKEN/);
  assert.match(sections.implement, /needs\.read-issue\.outputs\.issue_json/);
  assert.doesNotMatch(sections.implement, /issues: read|github\.token|github_token/);
  assert.doesNotMatch(sections.implement, /contents: write|pull-requests: write/);
  assert.match(sections.check, /permissions:\n      contents: read/);
  assert.match(sections.check, /timeout-minutes: 20/);
  assert.doesNotMatch(sections.check, /secrets\.|contents: write|pull-requests: write/);
  assert.doesNotMatch(sections.check, /cache: pnpm|actions\/cache@/);
  assert.match(sections.publish, /needs: implement/);
  assert.match(sections.publish, /contents: write/);
  assert.equal((yaml.match(/ref: \$\{\{ github.sha \}\}/g) ?? []).length, 2);
  assert.doesNotMatch(yaml, /uses: (?:anthropics\/claude-code-action|actions\/(?:upload|download)-artifact)@v\d/);
  assert.doesNotMatch(sections.publish, /secrets\.CLAUDE|pnpm|npm (?:run|test)|node_modules/);
  assert.match(sections.publish, /git apply --check/);
  assert.match(sections.publish, /git ls-files --stage/);
  assert.match(sections.publish, /test "\$mode" = '100644'/);
  assert.match(sections.publish, /git commit -m/);
  assert.match(sections.publish, /echo "sha=\$sha" >> "\$GITHUB_OUTPUT"/);
  assert.match(sections.check, /needs: publish/);
  assert.match(sections.check, /ref: \$\{\{ needs\.publish\.outputs\.proposal_sha \}\}/);
  assert.match(sections.check, /test "\$\(git rev-parse HEAD\)" = "\$\{\{ needs\.publish\.outputs\.proposal_sha \}\}"/);
  for (const section of Object.values(sections)) assert.match(section, /if: \$\{\{ false && github.ref == 'refs\/heads\/main' \}\}/);
});


test('rejects malformed UTF-8 and an existing symlink mode', () => {
  const first = Buffer.from(patch());
  assert.throws(() => validatePatch(Buffer.concat([first, Buffer.from([0xff])])), /UTF-8/);
  assert.throws(() => validatePatch(patch().replace('100644', '120000')), /mode/);
  assert.throws(() => validatePatch(patch().replace('100644', '160000')), /mode/);
});
