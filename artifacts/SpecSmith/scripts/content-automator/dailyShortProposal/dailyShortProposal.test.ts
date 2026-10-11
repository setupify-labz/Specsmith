// The daily Short proposal job: it refuses rather than guesses (missing, stale
// or incomplete snapshot; unavailable renderer; no producible topic), proposes
// only topics it can render, builds the storyboard from the cut's own template,
// records the metrics that moved the pick and what was unknown, runs the
// existing gates, leaves every human gate open, and never reaches a paid
// provider, scheduler or publisher.

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TEMPLATES, verifyRender } from "./animations.ts";
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
  it("is deterministic on the committed snapshot, and picks only a topic it can render", () => {
    expect(selection.topic.id).toBe("ram-not-seated");
    expect(selection.topic.animation).toBe("ram-seat");
    expect(selection.targetSeconds).toBe(TEMPLATES["ram-seat"].durationSeconds);
    expect(selection.dataTargetSeconds).toBe(14);
    for (const id of ["cpu-power-cable", "monitor-input-source", "front-panel-power-pins"]) {
      expect(selection.excluded).toContainEqual({ topicId: id, why: expect.stringContaining("no animation template yet") });
    }
  });
  it("labels the editorial prior and the template length as not data, and keeps cross-platform rows as context only", () => {
    expect(selection.influences.find((i) => i.metric.includes("editorial prior"))?.metric).toContain("NOT data");
    expect(selection.influences.find((i) => i.metric.startsWith("animation template length"))?.usedFor).toContain("recorded only");
    for (const name of ["tiktok", "instagram"]) expect(selection.influences.find((i) => i.metric.startsWith(name))?.usedFor).toContain("not used in the pick");
  });
  it("records small analytics samples and missing metrics as unknown instead of using them", () => {
    expect(selection.unknowns.some((u) => u.includes("analytics sample under 300"))).toBe(true);
    expect(selection.unknowns.some((u) => u.includes("instagram") && u.includes("saves: unknown"))).toBe(true);
    expect(selection.signals.find((s) => s.id === "46uG78uXmHg")?.averageViewPercentage).toBe("unknown");
  });
  it("refuses with no-topic once the only producible topic is covered (no text-card fallback)", () => {
    const doc = raw(); doc.sources.youtube.videos[0].title = "Added RAM, now it won't boot? Reseat the RAM";
    const error = refusal(() => selectTopic(parseSnapshot(doc, NOW), NOW));
    expect(error.code).toBe("no-topic");
    expect(error.message).toContain("ram-not-seated (an existing title matches");
    expect(error.message).toContain("animation template");
  });
});

describe("the storyboard is the cut's own", () => {
  const topic = TOPICS.find((t) => t.id === "ram-not-seated")!;
  const template = TEMPLATES["ram-seat"];
  const storyboard = buildStoryboard(topic, 14);
  it("uses the template's captions and exact timing, not a scaled plan", () => {
    expect(storyboard.targetDurationSeconds).toBe(template.durationSeconds);
    expect(storyboard.beats.map((b) => [b.startSecond, b.endSecond, b.narration])).toEqual(template.beats.map((b) => [b.from, b.to, b.caption]));
    expect(storyboard.beats.at(-1)!.endSecond).toBe(template.durationSeconds);
    expect(storyboard.persistentDisclosures).toEqual(["ILLUSTRATION", "Stylized example · not a fix for every PC"]);
  });
  it("shows power off and unplug before the case opens, and power back before the try-again line", () => {
    const at = (text: string) => template.labels.find((l) => l.text === text)!.from;
    expect(at("SHUT DOWN, THEN UNPLUG")).toBeLessThan(at("RAM SLOTS"));
    expect(at("POWER CORD BACK IN")).toBeLessThan(template.beats.find((b) => b.caption === "Then try booting again.")!.from);
  });
  it("has every claim sourced to the Crucial guide, and a sound cue only for things that are seen", () => {
    for (const claim of topic.claims) expect(claim.basis).toContain("crucial.com/support/install-memory-desktop");
    expect(new Set(template.cues.map((c) => c.kind))).toEqual(new Set(["button", "fan", "plug", "tick", "tap", "snap"]));
    expect(template.clearestCue).toBe("snap");
  });
  it("gives every label at least 1 s per 20 characters of its own on-screen span", () => {
    for (const label of template.labels) expect(label.text.length / (label.to - label.from)).toBeLessThanOrEqual(20);
  });
});

describe("the existing gates run on every topic, and block what they should", () => {
  it("passes every library topic as written", () => {
    for (const topic of TOPICS) expect(runGates(buildStoryboard(topic, 14), topic, NOW).findings).toEqual([]);
  });
  it("blocks a risky claim (strict research gate) and a guaranteed fix (forbidden claims)", () => {
    const topic = TOPICS.find((t) => t.id === "ram-not-seated")!;
    const storyboard = buildStoryboard(topic, 14);
    storyboard.beats[2] = { ...storyboard.beats[2], narration: "A guaranteed cure for boot failures, always." };
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
    const out = join(here, "..", "..", "..", "render-output", "daily-proposal-test");
    const previous = process.env.SPECSMITH_RENDER_CHROMIUM;
    process.env.SPECSMITH_RENDER_CHROMIUM = "/nonexistent/chromium";
    try {
      const result = await runDailyProposal(["--snapshot", SNAPSHOT_PATH, "--out", out], NOW);
      expect(result).toMatchObject({ exitCode: 1, report: { status: "refused", code: "renderer-unavailable" } });
      expect(existsSync(join(out, "proposal.json"))).toBe(false);
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

describe("the render check reads the exported files (committed 2026-10-11 run)", () => {
  const RUN = join(here, "runs", "2026-10-11-animated");
  const files = { silentPath: join(RUN, "ram-seat-silent.mp4"), sfxPath: join(RUN, "ram-seat-sfx.mp4") };
  const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && existsSync(files.sfxPath);
  const scratch = () => mkdtempSync(join(tmpdir(), "daily-verify-"));
  it.skipIf(!hasFfmpeg)("passes on the committed cut", async () => {
    const v = await verifyRender(TEMPLATES["ram-seat"], files, scratch());
    expect(v.checks.filter((c) => !c.passed)).toEqual([]);
    expect(v.cuePeaks.find((c) => c.kind === "fan")!.peakDbfs).toBeLessThan(v.cuePeaks.find((c) => c.kind === "button")!.peakDbfs);
  }, 60_000);
  it.skipIf(!hasFfmpeg)("fails a cue that does not sound, a wrong length, and a swapped clearest cue", async () => {
    const t = TEMPLATES["ram-seat"];
    const broken = { ...t, durationSeconds: 13, cues: [...t.cues, { kind: "tick", at: 11.5, seconds: 0.03, reason: "a cue the mix lacks" }], clearestCue: "plug" };
    const failed = (await verifyRender(broken, files, scratch())).checks.filter((c) => !c.passed).map((c) => c.check);
    expect(failed).toEqual(expect.arrayContaining(["silent MP4 length", "every cue sounds", "\"plug\" is the clearest cue"]));
  }, 60_000);
  it.skipIf(!hasFfmpeg)("fails a sound-effects file standing in for the silent one", async () => {
    const failed = (await verifyRender(TEMPLATES["ram-seat"], { silentPath: files.sfxPath, sfxPath: files.sfxPath }, scratch())).checks.filter((c) => !c.passed).map((c) => c.check);
    expect(failed).toContain("the silent MP4 is silent");
  }, 60_000);
});
