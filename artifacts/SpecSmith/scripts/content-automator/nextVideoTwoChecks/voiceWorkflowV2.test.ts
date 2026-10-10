// The two-checks-v2 option of the paid voice workflow: the one paid step is
// behind the typed confirmation and pinned to Liam; the job that hands the take
// over holds no provider secret, checks nothing out, can only comment on PRs,
// and validates the PR number before using it. Nothing publishes.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REVIEWED_LIAM_VOICE } from "../liamVoice.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..", "..", "..");
const workflow = readFileSync(join(repoRoot, ".github", "workflows", "elevenlabs-voice-sample.yml"), "utf8");
const code = workflow.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");

function job(name: string): string {
  const start = code.indexOf(`\n  ${name}:\n`);
  if (start < 0) throw new Error(`no job ${name}`);
  const rest = code.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
function step(jobText: string, name: string): string {
  const start = jobText.indexOf(`- name: ${name}`);
  if (start < 0) throw new Error(`no step ${name}`);
  const rest = jobText.slice(start);
  const next = rest.slice(1).search(/\n {6}- (name|uses):/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

describe("the two-checks option of the paid voice workflow", () => {
  it("is offered only by manual dispatch, behind the typed confirmation", () => {
    expect(code).toMatch(/options:\n(\s+- [a-z-]+\n)*\s+- two-checks-v2\n/);
    expect(code).toContain("inputs.confirm != 'generate'");
    expect(code).not.toMatch(/^\s*(push|pull_request|pull_request_target|schedule|workflow_run):/m);
  });

  it("checks the confirmation and the review PR number before the paid step", () => {
    const sample = job("sample");
    const confirm = sample.indexOf("Require explicit confirmation");
    const pr = sample.indexOf("Require a review PR number before any spend");
    const paid = sample.indexOf("Generate one Liam take of the two-checks Short (second narration)");
    expect(confirm).toBeGreaterThan(0);
    expect(pr).toBeGreaterThan(confirm);
    expect(paid).toBeGreaterThan(pr);
  });

  it("makes the one paid request with the pinned Liam id, and nothing else in that step", () => {
    const paid = step(job("sample"), "Generate one Liam take of the two-checks Short (second narration)");
    expect(paid).toContain("if: inputs.script == 'two-checks-v2'");
    expect(paid).toContain(`ELEVENLABS_VOICE_ID: ${REVIEWED_LIAM_VOICE.voiceId}`);
    expect(paid).toContain("run: pnpm exec tsx scripts/content-automator/nextVideoTwoChecks/liamTakeV2.ts");
    expect(paid).not.toMatch(/metricool|publish|gh api/i);
  });

  it("hands the take over from a job with no provider secret, no checkout and only PR-comment rights", () => {
    const share = job("share-two-checks-v2-take");
    expect(share).toContain("needs: sample");
    expect(share).toContain("inputs.script == 'two-checks-v2'");
    expect(share).not.toMatch(/secrets\.|ELEVENLABS/);
    expect(share).not.toContain("actions/checkout");
    const permissions = share.match(/permissions:\n((?: {6}[a-z-]+: [a-z]+\n)+)/);
    expect(permissions?.[1].trim().split(/\n\s*/)).toEqual(["contents: read", "pull-requests: write"]);
  });

  it("uses the PR number only after checking it is a number and this branch's PR", () => {
    const post = step(job("share-two-checks-v2-take"), "Post the take to the review PR");
    expect(post).toMatch(/case "\$REVIEW_PR" in ''\|\*\[!0-9\]\*\)/);
    expect(post.split("run:")[1]).not.toContain("${{");
    const check = post.indexOf('pulls/${REVIEW_PR}" --jq \'"\\(.head.repo.full_name)');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(post.indexOf("issues/${REVIEW_PR}/comments"));
    // Repository and branch together: a fork's PR from a same-named branch is refused.
    expect(post).toContain("--jq '\"\\(.head.repo.full_name) \\(.head.ref)\"'");
    expect(post).toContain('[ "$head" = "${GITHUB_REPOSITORY} ${GITHUB_REF_NAME}" ]');
  });

  it("publishes nothing", () => {
    for (const text of [job("share-two-checks-v2-take"), job("sample")]) {
      expect(text).not.toMatch(/metricool|youtube|tiktok|instagram|gh release|git push/i);
    }
  });
});
