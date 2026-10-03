// The ram-fit option of the paid voice workflow: the one paid step is behind
// the typed confirmation and pinned to Liam, the render job holds no secret and
// no push token, and nothing in either publishes.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { REVIEWED_LIAM_VOICE } from "../liamVoice.ts";
import { summaryLines } from "./ciSummary.ts";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const workflow = readFileSync(join(repoRoot, ".github", "workflows", "elevenlabs-voice-sample.yml"), "utf8");
const code = workflow.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");

/** The text of one job, from its key to the next top-level job key. */
function job(name: string): string {
  const start = code.indexOf(`\n  ${name}:\n`);
  if (start < 0) throw new Error(`no job ${name}`);
  const rest = code.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/** The text of one step, by its name. */
function step(jobText: string, name: string): string {
  const start = jobText.indexOf(`- name: ${name}`);
  if (start < 0) throw new Error(`no step ${name}`);
  const rest = jobText.slice(start);
  const next = rest.slice(1).search(/\n {6}- (name|uses):/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

describe("the ram-fit option of the paid voice workflow", () => {
  it("is offered only by manual dispatch, behind the typed confirmation, with read-only permissions", () => {
    expect(code).toMatch(/workflow_dispatch:/);
    expect(code).not.toMatch(/^\s*(push|pull_request|pull_request_target|schedule|workflow_run):/m);
    expect(code).toContain("inputs.confirm != 'generate'");
    expect(code).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(code).toMatch(/options:[\s\S]*- ram-fit/);
  });

  it("makes the one paid request with the pinned Liam id, and nothing else in that step", () => {
    const paid = step(job("sample"), "Generate one Liam take of the RAM-fit pilot");
    expect(paid).toContain("if: inputs.script == 'ram-fit'");
    expect(paid).toContain(`ELEVENLABS_VOICE_ID: ${REVIEWED_LIAM_VOICE.voiceId}`);
    expect(paid).toContain("run: pnpm exec tsx scripts/content-automator/pilotRamFit/liamTake.ts");
    expect(paid).not.toMatch(/render\.ts|metricool|publish/i);
  });

  it("renders in a job that holds no secret, no push token and no write permission", () => {
    const render = job("render-ram-fit");
    expect(render).toContain("needs: sample");
    expect(render).toContain("if: inputs.script == 'ram-fit'");
    expect(render).not.toContain("secrets.");
    expect(render).not.toMatch(/ELEVENLABS_API_KEY/);
    expect(render).not.toMatch(/contents:\s*write|permissions:\s*write-all/);
    expect(render).toContain("persist-credentials: false");
    expect(render).toContain("render.ts --liam-take render-output/ram-fit-liam-take");
    expect(render).toMatch(/timeout-minutes:\s*\d+/);
  });

  it("publishes nothing: no publishing provider, token or upload anywhere in the option", () => {
    for (const text of [job("render-ram-fit"), step(job("sample"), "Generate one Liam take of the RAM-fit pilot")]) {
      expect(text).not.toMatch(/metricool|youtube|tiktok|instagram|gh release|git push/i);
    }
  });
});

describe("the CI summary", () => {
  it("prints one plain line per fact, with no credential and nothing that breaks an annotation", () => {
    const lines = summaryLines({
      label: "FINAL CANDIDATE.",
      video: { sha256: "a".repeat(64), bytes: 10, durationSeconds: 12.2 },
      take: { voiceId: REVIEWED_LIAM_VOICE.voiceId, voiceUsed: "Liam", modelId: "m", audioSha256: "b".repeat(64), providerReportedCharacterCost: 167, lineTimings: [{ id: "fail", start: 0.1, end: 1.9 }] },
      timing: { events: { jam: 0.6 }, adjustments: ["note"] },
      scenes: [{ id: "fail", startSecond: 0, endSecond: 2 }],
      captions: [{ text: "100% sure\nnot", start: 0, end: 1 }],
      builderCard: { route: "/builder", shownText: "RAM won't fit this motherboard" },
      master1StoryboardReview: { recommendedFixes: [] },
      visualHonesty: { findings: [] },
      renderChecks: { decodeErrors: [], black: [], frozen: [], mix: { thudUnderVoiceDb: 6, findings: ["x"] } },
    });
    expect(lines.every((line) => !line.includes("\n"))).toBe(true);
    expect(lines.join(" ")).toContain("100%25 sure");
    expect(lines.join(" ")).toContain("MIX FINDING: x");
    expect(lines.join(" ")).not.toMatch(/xi-api-key|ELEVENLABS_API_KEY/);
  });
});
