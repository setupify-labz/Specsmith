import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePatch } from './validate-proposal.mjs';

const patch = (path = 'src/components/PartSelector.tsx', body = '+export const flag = true;') => `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1,2 @@\n old\n${body}\n`;

test('a changed source file gets a stable binding', () => {
  const result = validatePatch(patch());
  assert.deepEqual(result.paths, ['src/components/PartSelector.tsx']);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  assert.notEqual(result.sha256, validatePatch(patch(undefined, '+export const flag = false;')).sha256);
});

test('refuses paths outside narrow source scope and path traversal', () => {
  for (const path of ['package.json', '.github/workflows/ci.yml', 'scripts/build.js', 'src/../.github/workflows/ci.yml', 'src/x.js', 'src//x.ts']) {
    assert.throws(() => validatePatch(patch(path)), /Refused/);
  }
});

test('refuses modes, links, new files, binary patches, and mismatched paths', () => {
  for (const extra of ['new file mode 100644\n', 'new mode 120000\n', 'GIT binary patch\n', 'rename from src/a.ts\n']) {
    assert.throws(() => validatePatch(patch().replace('index ', extra + 'index ')), /refused/i);
  }
  assert.throws(() => validatePatch(patch().replace('+++ b/src/components/PartSelector.tsx', '+++ b/src/components/Other.tsx')), /do not match/);
});

test('experimental workflow is not installed and has three gated jobs', () => {
  const workflow = readFileSync(new URL('./auto-goal-actions.yml', import.meta.url), 'utf8');
  for (const name of ['implement:', 'check:', 'publish:']) assert.ok(workflow.includes(`  ${name}`));
  assert.match(workflow, /if: \$\{\{ false \}\}/);
  assert.match(workflow, /permissions: \{\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /needs: check/);
  assert.ok(!workflow.includes('pull_request_target:'));
});

test('publisher refuses any different bytes or report paths', async () => {
  const { verifyChecked } = await import('./verify-checked.mjs');
  const original = patch();
  const report = validatePatch(original);
  assert.deepEqual(verifyChecked(original, report), report);
  assert.throws(() => verifyChecked(patch(undefined, '+export const flag = false;'), report), /not the diff/);
  assert.throws(() => verifyChecked(original, { ...report, paths: [] }), /not the diff/);
});

test('template keeps credentials and write scope out of the code-running job', () => {
  const yaml = readFileSync(new URL('./auto-goal-actions.yml', import.meta.url), 'utf8');
  const sections = Object.fromEntries([...yaml.matchAll(/^  (implement|check|publish):\n([\s\S]*?)(?=^  (?:implement|check|publish):|$(?![\s\S]))/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(Object.keys(sections), ['implement', 'check', 'publish']);
  assert.match(sections.implement, /permissions:\n      contents: read\n      issues: read/);
  assert.match(sections.implement, /secrets\.CLAUDE_CODE_OAUTH_TOKEN/);
  assert.doesNotMatch(sections.implement, /contents: write|pull-requests: write/);
  assert.match(sections.check, /permissions: \{\}/);
  assert.doesNotMatch(sections.check, /secrets\.|contents: write|pull-requests: write/);
  assert.match(sections.publish, /needs: check/);
  assert.match(sections.publish, /contents: write/);
  assert.doesNotMatch(sections.publish, /secrets\.CLAUDE|pnpm|npm (?:run|test)|node_modules/);
  for (const section of Object.values(sections)) assert.match(section, /if: \$\{\{ false \}\}/);
});
