// The gpu-upgrade option of the paid voice workflow: the one paid step is
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

describe("the gpu-upgrade option of the paid voice workflow", () => {
  it("is offered only by manual dispatch, behind the typed confirmation", () => {
    expect(code).toMatch(/options:\n\s+- gpu-upgrade\n/);
    expect(code).toContain("inputs.confirm != 'generate'");
    expect(code).not.toMatch(/^\s*(push|pull_request|pull_request_target|schedule|workflow_run):/m);
  });

  it("checks the confirmation and the review PR number before the key is read or any spend", () => {
    const sample = job("sample");
    const confirm = sample.indexOf("Require explicit confirmation");
    const pr = sample.indexOf("Require a review PR number before any spend");
    const paid = sample.indexOf("Generate one Liam take of the GPU-upgrade Short");
    expect(confirm).toBeGreaterThan(0);
    expect(pr).toBeGreaterThan(confirm);
    expect(paid).toBeGreaterThan(pr);
    expect(sample).toMatch(/timeout-minutes:\s*10/);
  });

  it("makes the one paid request with the pinned Liam id, and nothing else in that step", () => {
    const paid = step(job("sample"), "Generate one Liam take of the GPU-upgrade Short");
    expect(paid).toContain("if: inputs.script == 'gpu-upgrade'");
    expect(paid).toContain(`ELEVENLABS_VOICE_ID: ${REVIEWED_LIAM_VOICE.voiceId}`);
    expect(paid).toContain("run: pnpm exec tsx scripts/content-automator/nextVideoGpuUpgrade/liamTake.ts");
    expect(paid).not.toMatch(/metricool|publish|gh api/i);
  });

  it("keeps the checkout in the paid job without a push credential", () => {
    const sample = job("sample");
    const checkout = sample.indexOf("uses: actions/checkout@");
    expect(checkout).toBeGreaterThan(0);
    expect(sample.slice(checkout, checkout + 200)).toContain("persist-credentials: false");
  });

  it("hands the take over from a job with no provider secret, no checkout and only PR-comment rights", () => {
    const share = job("share-gpu-upgrade-take");
    expect(share).toContain("needs: sample");
    expect(share).toContain("inputs.script == 'gpu-upgrade'");
    expect(share).not.toMatch(/secrets\.|ELEVENLABS/);
    expect(share).not.toContain("actions/checkout");
    const permissions = share.match(/permissions:\n((?: {6}[a-z-]+: [a-z]+\n)+)/);
    expect(permissions?.[1].trim().split(/\n\s*/)).toEqual(["contents: read", "pull-requests: write"]);
  });

  it("uses the PR number only after checking it is a number and this branch's PR, and passes inputs through the environment", () => {
    const post = step(job("share-gpu-upgrade-take"), "Post the take to the review PR");
    expect(post).toContain("REVIEW_PR: ${{ inputs.review_pr }}");
    expect(post).toMatch(/case "\$REVIEW_PR" in ''\|\*\[!0-9\]\*\)/);
    expect(post.split("run:")[1]).not.toContain("${{");
    const check = post.indexOf('pulls/${REVIEW_PR}" --jq .head.ref');
    const firstWrite = post.indexOf("issues/${REVIEW_PR}/comments");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(firstWrite);
    expect(post).toContain('[ "$head" = "$GITHUB_REF_NAME" ]');
  });

  it("publishes nothing", () => {
    for (const text of [job("share-gpu-upgrade-take"), job("sample")]) {
      expect(text).not.toMatch(/metricool|youtube|tiktok|instagram|gh release|git push/i);
    }
  });
});
