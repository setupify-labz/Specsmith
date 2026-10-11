// The daily Short proposal job: it refuses rather than guesses (missing, stale
// or incomplete snapshot; unavailable renderer), records the metrics that
// moved the pick and what was unknown, runs the existing gates, leaves every
// human gate open, and never reaches a paid provider, scheduler or publisher.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { buildStoryboard, humanGatesUnresolved, runGates } from "./proposal.ts";
import { runDailyProposal } from "./run.ts";
import { selectTopic } from "./select.ts";
import { DailyProposalError, parseSnapshot } from "./snapshot.ts";
import { TOPICS } from "./topics.ts";

const here = import.meta.dirname;
const SNAPSHOT_PATH = join(here, "snapshots", "2026-10-11.json");
const raw = () => JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
const NOW = new Date("2026-10-11T21:00:00Z");

const refusal = (fn: () => unknown) => { try { fn(); } catch (error) { return error as DailyProposalError; } throw new Error("expected a refusal"); };

describe("the snapshot is validated before anything uses it", () => {
  it("accepts the committed 2026-10-11 snapshot", () => {
    expect(parseSnapshot(raw(), NOW).sources.youtube.videos).toHaveLength(4);
  });
  it("refuses a stale snapshot", () => {
    expect(refusal(() => parseSnapshot(raw(), new Date("2026-10-13T12:00:00Z"))).code).toBe("snapshot-stale");
  });
  it("refuses when a needed source is absent or unavailable", () => {
    for (const name of ["youtube", "tiktok", "instagram"]) {
      const doc = raw(); doc.sources[name] = { status: "unavailable", reason: "connector not authorised" };
      const error = refusal(() => parseSnapshot(doc, NOW));
      expect(error.code).toBe("source-unavailable");
      expect(error.message).toContain(name);
    }
  });
  it("refuses a metric that is neither a number nor \"unknown\" (no silent fill-in)", () => {
    const doc = raw(); doc.sources.youtube.videos[0].analytics.averageViewPercentage = null;
    expect(refusal(() => parseSnapshot(doc, NOW)).code).toBe("snapshot-invalid");
  });
});

describe("the pick records what influenced it and what was unknown", () => {
  const selection = selectTopic(parseSnapshot(raw(), NOW), NOW);
  it("is deterministic on the committed snapshot", () => {
    expect(selection.topic.id).toBe("front-panel-power-pins");
    expect(selection.targetSeconds).toBe(14);
  });
  it("labels the editorial prior as not data, and keeps cross-platform rows as context only", () => {
    expect(selection.influences.find((i) => i.metric.includes("editorial prior"))?.metric).toContain("NOT data");
    for (const name of ["tiktok", "instagram"]) expect(selection.influences.find((i) => i.metric.startsWith(name))?.usedFor).toContain("not used in the pick");
  });
  it("records small analytics samples and missing metrics as unknown instead of using them", () => {
    expect(selection.unknowns.some((u) => u.includes("analytics sample under 300"))).toBe(true);
    expect(selection.unknowns.some((u) => u.includes("instagram") && u.includes("saves: unknown"))).toBe(true);
    expect(selection.signals.find((s) => s.id === "46uG78uXmHg")?.averageViewPercentage).toBe("unknown");
  });
  it("drops a topic an existing title already covers", () => {
    const doc = raw(); doc.sources.youtube.videos[0].title = "Power button does nothing? Check the front-panel pins";
    const again = selectTopic(parseSnapshot(doc, NOW), NOW);
    expect(again.topic.id).not.toBe("front-panel-power-pins");
    expect(again.excluded.map((e) => e.topicId)).toContain("front-panel-power-pins");
  });
});

describe("the existing gates run on every topic, and block what they should", () => {
  it("passes every library topic as written", () => {
    for (const topic of TOPICS) expect(runGates(buildStoryboard(topic, 14), topic, NOW).findings).toEqual([]);
  });
  it("blocks a risky claim (strict research gate) and a guaranteed fix (forbidden claims)", () => {
    const topic = TOPICS.find((t) => t.id === "ram-not-seated")!;
    const storyboard = buildStoryboard(topic, 14);
    storyboard.beats[2] = { ...storyboard.beats[2], narration: "A guaranteed cure for blank screens, always." };
    const { passed, findings } = runGates(storyboard, topic, NOW);
    expect(passed).toBe(false);
    expect(findings.some((f) => f.gate.startsWith("strict research evidence"))).toBe(true);
    expect(findings.some((f) => f.gate.startsWith("forbidden claims"))).toBe(true);
  });
  it("leaves every human gate unresolved, with the repository's reason", () => {
    const gates = humanGatesUnresolved();
    expect(gates.mechanism.trustedApprovalAvailable).toBe(false);
    expect(gates.gates.every((g) => g.status === "unresolved")).toBe(true);
    expect(gates.gates.map((g) => g.gate)).toContain("factual-takeaway");
  });
});

describe("the job fails clearly", () => {
  it("refuses without a snapshot", async () => {
    const result = await runDailyProposal([], NOW);
    expect(result).toMatchObject({ exitCode: 1, report: { status: "refused", code: "snapshot-missing" } });
  });
  it("refuses when the renderer is unavailable, before writing a proposal", async () => {
    const previous = process.env.SPECSMITH_RENDER_CHROMIUM;
    process.env.SPECSMITH_RENDER_CHROMIUM = "/nonexistent/chromium";
    try {
      const result = await runDailyProposal(["--snapshot", SNAPSHOT_PATH, "--out", join(here, "..", "..", "..", "render-output", "daily-proposal-test")], NOW);
      expect(result).toMatchObject({ exitCode: 1, report: { status: "refused", code: "renderer-unavailable" } });
    } finally {
      if (previous === undefined) delete process.env.SPECSMITH_RENDER_CHROMIUM; else process.env.SPECSMITH_RENDER_CHROMIUM = previous;
    }
  });
});

describe("it never reaches a paid provider, a scheduler or a publisher", () => {
  it("imports none of those modules", () => {
    for (const file of readdirSync(here).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      const imports = readFileSync(join(here, file), "utf8").match(/from\s+"[^"]+"/g) ?? [];
      for (const line of imports) expect(line).not.toMatch(/elevenLabs|liamTake|voiceSpend|publish|metricoolClient|schedul|readyToPublish|vidiq|metricool/i);
    }
  });
  it("has a manual-dispatch-only workflow with no secrets", () => {
    const workflow = readFileSync(join(here, "..", "..", "..", "..", "..", ".github", "workflows", "daily-short-proposal.yml"), "utf8");
    const code = workflow.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
    expect(code).toContain("workflow_dispatch:");
    expect(code).not.toMatch(/^\s*(schedule|push|pull_request|pull_request_target|workflow_run):/m);
    expect(code).not.toMatch(/secrets\./);
    expect(code).toMatch(/permissions:\n\s+contents: read/);
  });
});
