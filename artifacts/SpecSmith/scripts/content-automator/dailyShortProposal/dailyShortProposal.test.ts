// The daily Short proposal job: it refuses rather than guesses (missing, stale
// or incomplete snapshot; unavailable renderer; no producible topic), proposes
// only topics it can render, builds the storyboard from the cut's own template,
// records the metrics that moved the pick and what was unknown, runs the
// existing gates, leaves every human gate open, and never reaches a paid
// provider, scheduler or publisher.

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderAndVerify, TEMPLATES, verifyRender } from "./animations.ts";
import { buildStoryboard, contractFor, humanGatesUnresolved, runGates } from "./proposal.ts";
import { prepareOutDir, runDailyProposal } from "./run.ts";
import { selectTopic } from "./select.ts";
import { DAY_ROW_FIELDS, DailyProposalError, metricProblem, parseSnapshot } from "./snapshot.ts";
import { TOPICS } from "./topics.ts";
import { emptyLedger, loadUsedLedger, markTopicUsed, parseUsedLedger, type UsedEntry } from "./usedTopics.ts";
import { main as markUsedMain } from "./markUsed.ts";
import { specProblems } from "../animationScenes/spec.ts";
import { SCENE_NAMES } from "../animationScenes/library.ts";
import { CPU_POWER_CUT } from "../nextVideoCpuPower/cut.ts";
import { ATX_24PIN_CUT } from "../reviewQueue/atx24Pin.ts";
import { CPU_FAN_HEADER_CUT } from "../reviewQueue/cpuFanHeader.ts";
import { FRONT_PANEL_PINS_CUT } from "../reviewQueue/frontPanelPins.ts";
import { GPU_POWER_CABLE_CUT } from "../reviewQueue/gpuPowerCable.ts";
import { MONITOR_INPUT_SOURCE_CUT } from "../reviewQueue/monitorInputSource.ts";
import { RAM_SLOTS_CUT } from "../reviewQueue/ramSlots.ts";

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
  it("refuses another account's snapshot (Codex P2)", () => {
    const otherBrand = raw(); otherBrand.brand = "someone-else";
    expect(refusal(() => parseSnapshot(otherBrand, NOW))).toMatchObject({ code: "snapshot-invalid", message: expect.stringContaining("brand") });
    const otherChannel = raw(); otherChannel.sources.youtube.channelId = "UCsomeoneElse";
    expect(refusal(() => parseSnapshot(otherChannel, NOW))).toMatchObject({ code: "snapshot-invalid", message: expect.stringContaining("YouTube channel") });
  });
  it("refuses a metric that is neither a number nor \"unknown\" (no silent fill-in)", () => {
    const doc = raw(); doc.sources.youtube.videos[0].analytics.averageViewPercentage = null;
    expect(refusal(() => parseSnapshot(doc, NOW)).code).toBe("snapshot-invalid");
  });
});

describe("a video cannot be newer than the snapshot", () => {
  it("refuses negative counts and durations instead of ranking on them", () => {
    const edits: ((doc: any) => void)[] = [
      (doc) => { doc.sources.youtube.videos[0].public.views = -1; },
      (doc) => { doc.sources.youtube.videos[0].durationSeconds = -1; },
      (doc) => { doc.sources.youtube.videos[0].analytics.averageViewDurationSeconds = -2; },
      (doc) => { doc.sources.youtube.videos[0].analytics.averageViewPercentage = -5; },
      (doc) => { doc.sources.youtube.videos[0].analytics.subscribersGained = -1; },
      (doc) => { doc.sources.youtube.subscribers = -3; },
      (doc) => { doc.sources.tiktok.followers = -1; },
      (doc) => { doc.sources.instagram.byPublishDay[0].views = -10; },
    ];
    for (const edit of edits) {
      const doc = raw(); edit(doc);
      expect(refusal(() => parseSnapshot(doc, NOW))).toMatchObject({ code: "snapshot-invalid", message: expect.stringContaining("is a count and cannot be negative") });
    }
  });
  it("lets a net change be negative but never a count, and classifies every field the snapshot carries", () => {
    // The kinds themselves: a net change (gained minus lost) may be negative; a count may not; neither may be non-finite.
    expect(metricProblem(-12, "net-change")).toBeNull();
    expect(metricProblem(-12, "count")).toContain("cannot be negative");
    expect(metricProblem(0, "count")).toBeNull();
    expect(metricProblem(107.42, "count")).toBeNull(); // average view percentage above 100 on a looping Short
    for (const kind of ["count", "net-change"] as const) {
      expect(metricProblem("unknown", kind)).toBeNull();
      expect(metricProblem(Number.NaN, kind)).toContain("must be a number");
    }
    // Field by field: every day-row field in the committed snapshot is classified, and today none is a net change.
    const doc = raw();
    for (const name of ["tiktok", "instagram"]) for (const row of doc.sources[name].byPublishDay) {
      for (const key of Object.keys(row).filter((k) => k !== "date")) expect(DAY_ROW_FIELDS[key]).toBe("count");
    }
    // A field nobody has classified is refused rather than assumed to be a count or a net change.
    doc.sources.tiktok.byPublishDay[0].followersDelta = -4;
    expect(refusal(() => parseSnapshot(doc, NOW))).toMatchObject({ code: "snapshot-invalid", message: expect.stringContaining("followersDelta is not a known metric") });
  });
  it("refuses a publishedAt later than collectedAt instead of ranking an impossible video", () => {
    const doc = raw(); doc.sources.youtube.videos[0].publishedAt = "2027-10-01T12:00:00Z";
    expect(refusal(() => parseSnapshot(doc, NOW))).toMatchObject({ code: "snapshot-invalid", message: expect.stringContaining("after the snapshot was collected") });
  });
});

describe("the pick records what influenced it and what was unknown", () => {
  const selection = selectTopic(parseSnapshot(raw(), NOW));
  it("is deterministic on the committed snapshot, and picks only a topic it can render", () => {
    // The fastest troubleshooting Short is "PC Won't Turn On? ..." (family wont-turn-on); the CPU-power topic is
    // filed as wont-turn-on (owner's decision, 2026-10-12), so the family match picks it over the RAM topic.
    expect(selection.topic.id).toBe("cpu-power-cable");
    expect(selection.chosenBy).toBe("data");
    expect(selection.targetSeconds).toBe(TEMPLATES["cpu-power"].durationSeconds);
    expect(selection.dataTargetSeconds).toBe(14);
    // The won't-turn-on family first (the channel's fastest troubleshooting Short), then by editorial prior.
    expect(selection.ranking).toEqual([
      { topicId: "cpu-power-cable", familyMatch: true, editorialPrior: 0.8 },
      { topicId: "front-panel-power-pins", familyMatch: true, editorialPrior: 0.7 },
      { topicId: "atx-24pin-cable", familyMatch: true, editorialPrior: 0.65 },
      { topicId: "gpu-power-cable", familyMatch: false, editorialPrior: 0.75 },
      { topicId: "monitor-input-source", familyMatch: false, editorialPrior: 0.6 },
      { topicId: "cpu-fan-header", familyMatch: false, editorialPrior: 0.55 },
      { topicId: "ram-two-stick-slots", familyMatch: false, editorialPrior: 0.5 },
    ]);
    // The hand-built RAM cut is not in the automatic queue; an operator can still choose it.
    expect(selection.excluded).toContainEqual({ topicId: "ram-not-seated", why: expect.stringContaining("not in the automatic queue") });
  });
  it("measures each video's age to the snapshot's collection time, so a later run of the same snapshot ranks the same", () => {
    // parseSnapshot accepts a snapshot up to its max age; selection must not depend on when within that window it runs.
    const later = selectTopic(parseSnapshot(raw(), new Date(NOW.getTime() + 30 * 3_600_000)));
    expect(later.signals).toEqual(selection.signals);
    expect(later.ranking).toEqual(selection.ranking);
    const collected = Date.parse(raw().collectedAt);
    for (const [i, v] of raw().sources.youtube.videos.entries()) {
      const days = Math.max(1, (collected - Date.parse(v.publishedAt)) / 86_400_000);
      expect(selection.signals[i].ageDays).toBeCloseTo(days, 2);
    }
  });
  it("takes an operator's topic choice, records it as not data, and still refuses one it cannot render", () => {
    const forced = selectTopic(parseSnapshot(raw(), NOW), { topicId: "ram-not-seated" });
    expect(forced).toMatchObject({ chosenBy: "operator", dataPick: "cpu-power-cable", targetSeconds: TEMPLATES["ram-seat"].durationSeconds });
    expect(forced.topic.id).toBe("ram-not-seated");
    expect(forced.influences.find((i) => i.metric.startsWith("operator's topic choice"))?.metric).toContain("NOT data");
    const unknown = refusal(() => selectTopic(parseSnapshot(raw(), NOW), { topicId: "no-such-topic" }));
    expect(unknown).toMatchObject({ code: "no-topic", message: expect.stringContaining("not in the topic library") });
    // A topic already taken for review is refused even when an operator names it.
    const used = refusal(() => selectTopic(parseSnapshot(raw(), NOW), { topicId: "cpu-power-cable", used: [{ topicId: "cpu-power-cable", markedAt: NOW.toISOString(), by: "test", note: "" }] }));
    expect(used).toMatchObject({ code: "no-topic", message: expect.stringContaining("already taken for review") });
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
  it("reads typographic apostrophes as plain ones, so a curly “Won’t Start” title keeps its family", () => {
    const doc = raw();
    const lead = doc.sources.youtube.videos.find((v: { title: string }) => /won't turn on/i.test(v.title));
    lead.title = "PC Won\u2019t Start? Check These 2 Spots First";
    const selection = selectTopic(parseSnapshot(doc, NOW));
    expect(selection.signals.find((s) => s.id === lead.id)?.families).toEqual(["wont-turn-on"]);
    expect(selection.topic.id).toBe("cpu-power-cable");
  });
  it("counts an 8-pin title as CPU coverage only with CPU/EPS context, not a GPU/PCIe one", () => {
    const covers = (title: string) => {
      const doc = raw(); doc.sources.youtube.videos[0].title = title;
      return selectTopic(parseSnapshot(doc, NOW)).excluded.some((e) => e.topicId === "cpu-power-cable");
    };
    for (const title of ["Your GPU's 8-pin PCIe cable, explained", "RTX 5070: 8-pin or 12V-2x6?", "6+2 vs 8-pin PCIe power"]) expect(covers(title)).toBe(false);
    for (const title of ["CPU 8-pin cable: is yours plugged in?", "8-pin CPU power: one or two?", "EPS12V vs PCIe cables", "4+4 pin CPU connector", "No CPU power? Check this"]) expect(covers(title)).toBe(true);
  });
  it("moves to the next eligible topic once one is covered by a published title", () => {
    const doc = raw(); doc.sources.youtube.videos[1].title = "New build won't boot? Check the CPU power cable";
    const next = selectTopic(parseSnapshot(doc, NOW));
    expect(next.topic.id).toBe("front-panel-power-pins");
    expect(next.excluded).toContainEqual({ topicId: "cpu-power-cable", why: expect.stringContaining("an existing title matches") });
  });
  it("walks the whole queue as topics are marked used, without --topic, and then refuses (no text-card fallback)", () => {
    const snapshot = parseSnapshot(raw(), NOW);
    const used: UsedEntry[] = [];
    const picks: string[] = [];
    for (let day = 0; day < 7; day += 1) {
      const pick = selectTopic(snapshot, { used });
      expect(pick.chosenBy).toBe("data");
      picks.push(pick.topic.id);
      used.push({ topicId: pick.topic.id, markedAt: new Date(NOW.getTime() + day * 60_000).toISOString(), by: "test", note: "" });
    }
    expect(picks).toEqual(["cpu-power-cable", "front-panel-power-pins", "atx-24pin-cable", "gpu-power-cable", "monitor-input-source", "cpu-fan-header", "ram-two-stick-slots"]);
    const error = refusal(() => selectTopic(snapshot, { used }));
    expect(error.code).toBe("no-topic");
    expect(error.message).toContain("already taken for review");
    expect(error.message).toContain("ram-not-seated (not in the automatic queue");
  });
});

describe.each(TOPICS.filter((t) => t.animation).map((t) => [t.id, t.animation!]))("the storyboard of %s is the cut's own", (topicId, templateId) => {
  const topic = TOPICS.find((t) => t.id === topicId)!;
  const template = TEMPLATES[templateId];
  const storyboard = buildStoryboard(topic, 14);
  it("is the topic's registered template", () => expect(topic.animation).toBe(templateId));
  it("uses the template's captions and exact timing, not a scaled plan", () => {
    expect(storyboard.targetDurationSeconds).toBe(template.durationSeconds);
    expect(storyboard.beats.map((b) => [b.startSecond, b.endSecond, b.narration])).toEqual(template.beats.map((b) => [b.from, b.to, b.caption]));
    expect(storyboard.beats.at(-1)!.endSecond).toBe(template.durationSeconds);
    expect(storyboard.persistentDisclosures).toEqual(["ILLUSTRATION", "Stylized example · not a fix for every PC"]);
  });
  it("unplugs before any work inside the case, plugs back in before the last line, and ends on an instruction", () => {
    const inside = template.beats.find((b) => b.storyBeat === "location");   // every cut that works inside the case has a "location" beat
    const unplug = template.beats.find((b) => /unplug/i.test(b.caption));
    if (inside) { expect(unplug, "a cut that works inside the case unplugs first").toBeDefined(); expect(unplug!.to).toBeLessThanOrEqual(inside.from); }
    const back = template.labels.find((l) => l.text === "POWER CORD BACK IN");
    if (unplug) expect(back!.from).toBeLessThan(template.beats.at(-1)!.from);
    // The last line asks the viewer to try again; it never claims a result.
    expect(storyboard.beats.at(-1)!.narration).toMatch(/^Then (try|start|check)\b/);
    expect(storyboard.beats.at(-1)!.narration).toBe(topic.finalCta);
  });
  it("has every claim sourced to a named page, and its clearest cue actually sounds", () => {
    for (const claim of topic.claims) expect(claim.basis).toMatch(/https?:\/\/|crucial\.com\/support/);
    expect(template.cues.some((c) => c.kind === template.clearestCue)).toBe(true);
  });
  it("gives every label at least 1 s per 20 characters of its own on-screen span", () => {
    for (const label of template.labels) expect(label.text.length / (label.to - label.from)).toBeLessThanOrEqual(20);
  });
});

describe("the existing gates run on every topic, and block what they should", () => {
  it("passes every library topic as written (no blocking finding)", () => {
    for (const topic of TOPICS) expect(runGates(buildStoryboard(topic, 14), topic, NOW).findings).toEqual([]);
  });
  it("never files a topic claim as safe, and lists the lines that rest on unverified claims", () => {
    for (const topic of TOPICS) {
      expect(contractFor(topic, NOW, "blocking").safeClaims).toEqual([]);
      expect(contractFor(topic, NOW, "fact-check").safeClaims).toEqual([]);
      expect(contractFor(topic, NOW, "fact-check").unsafeClaims.map((c) => c.state)).toEqual(topic.claims.map(() => "requires-human-judgment"));
    }
    const cpu = TOPICS.find((t) => t.id === "cpu-power-cable")!;
    const { factCheck } = runGates(buildStoryboard(cpu, 14), cpu, NOW);
    expect(factCheck.length).toBeGreaterThan(0);
    expect(factCheck.flatMap((f) => f.claimIds)).toEqual(expect.arrayContaining(["cpu-not-pcie"]));
  });
  it("flags an unsupported claim added to a topic (Codex P1)", () => {
    const ram = TOPICS.find((t) => t.id === "ram-not-seated")!;
    const topic = { ...ram, claims: [...ram.claims, { id: "made-up", proposition: "reseating memory doubles gaming frame rates", basis: "none" }] };
    const storyboard = buildStoryboard(topic, 14);
    storyboard.beats[4] = { ...storyboard.beats[4], narration: "Reseating memory doubles gaming frame rates." };
    expect(runGates(storyboard, topic, NOW).factCheck.some((f) => f.claimIds.includes("made-up"))).toBe(true);
  });
  it("blocks an outcome promise whatever its wording, and leaves instructions and symptoms alone (Codex P2)", () => {
    const ram = TOPICS.find((t) => t.id === "ram-not-seated")!;
    for (const line of ["It loads Windows after that.", "Your PC will boot now.", "Problem solved.", "That should work.", "The PC is working now.", "It is booting again.", "It's working.", "Everything works.", "PC boots now.", "My PC works now.", "Boots fine after that.", "My PC turns on again.", "PC powers on now."]) {
      const storyboard = buildStoryboard(ram, 14);
      storyboard.beats[6] = { ...storyboard.beats[6], narration: line };
      expect(runGates(storyboard, ram, NOW).findings.some((f) => f.gate.startsWith("outcome promise"))).toBe(true);
    }
    for (const topic of TOPICS) expect(runGates(buildStoryboard(topic, 14), topic, NOW).findings.filter((f) => f.gate.startsWith("outcome promise"))).toEqual([]);
  });
  it("blocks a forbidden claim in the persistent disclosure band (Codex P1)", () => {
    const ram = TOPICS.find((t) => t.id === "ram-not-seated")!;
    const storyboard = { ...buildStoryboard(ram, 14), persistentDisclosures: ["ILLUSTRATION", "Guaranteed to fix it"] };
    expect(runGates(storyboard, ram, NOW).findings.some((f) => f.location === "disclosure-2")).toBe(true);
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
  it("refuses a max-age that would switch off the stale check (Codex P2)", async () => {
    for (const bad of ["nope", "Infinity", "-1"]) {
      const result = await runDailyProposal(["--snapshot", SNAPSHOT_PATH, "--max-age-hours", bad], NOW);
      expect(result).toMatchObject({ exitCode: 1, report: { status: "refused", code: "bad-argument" } });
    }
  });
  it("lets only one run claim a folder (Codex P2: two runs racing for the same --out)", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "daily-race-")), "out");
    const results = await Promise.allSettled([prepareOutDir(dir), prepareOutDir(dir)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "output-not-empty" } });
  });
  it("refuses a reused run folder and deletes nothing, whatever the files are named (Codex P1/P2)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "daily-out-"));
    rmSync(await prepareOutDir(dir));   // empty: claimed, then released as a finished run would
    for (const name of ["proposal.json", "work", "demo-silent.mp4"]) writeFileSync(join(dir, name), "someone else's");
    await expect(prepareOutDir(dir)).rejects.toMatchObject({ code: "output-not-empty" });
    expect(readdirSync(dir).sort()).toEqual(["demo-silent.mp4", "proposal.json", "work"]);
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
  const RUN = join(here, "runs", "2026-10-11-ram-seat");
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
  it.skipIf(!hasFfmpeg)("fails a cue that only catches the previous click's tail (Codex P2: two snaps 35 ms apart)", async () => {
    const t = TEMPLATES["ram-seat"];
    const lastSnap = t.cues.filter((c) => c.kind === "snap").at(-1)!;
    const ghost = { ...t, cues: [...t.cues, { ...lastSnap, at: lastSnap.at + 0.035, reason: "a third clip the mix lacks" }] };
    const failed = (await verifyRender(ghost, files, scratch())).checks.filter((c) => !c.passed).map((c) => c.check);
    expect(failed).toContain("every short cue has its own onset");
  }, 60_000);
  it.skipIf(!hasFfmpeg)("fails a cut whose artwork is missing even though captions still change (Codex P1)", async () => {
    const dir = scratch(), blank = join(dir, "blank.mp4");
    // Black out the art region, keeping the band and captions, as if story() stopped drawing.
    spawnSync("ffmpeg", ["-v", "error", "-y", "-i", files.silentPath, "-vf", "drawbox=x=0:y=330:w=1080:h=1110:color=0x0A0A0F:t=fill", "-c:a", "copy", blank]);
    const failed = (await verifyRender(TEMPLATES["ram-seat"], { silentPath: blank, sfxPath: files.sfxPath }, dir)).checks.filter((c) => !c.passed).map((c) => c.check);
    expect(failed).toEqual(expect.arrayContaining(["every beat's artwork is drawn", "every beat's artwork differs from every other beat's"]));
  }, 60_000);
  it.skipIf(!hasFfmpeg)("turns a render or verifier crash into a failed check, never a crash of the run (Codex P2)", async () => {
    const t = TEMPLATES["ram-seat"];
    const dir = scratch();
    const garbage = { ...t, render: async (out: string) => { const a = join(out, "x-silent.mp4"), b = join(out, "x-sfx.mp4"); writeFileSync(a, "not a video"); writeFileSync(b, "not a video"); return { silentPath: a, sfxPath: b }; } };
    const unreadable = await renderAndVerify(garbage, dir);
    expect(unreadable.verification.passed).toBe(false);
    expect(unreadable.verification.checks.map((c) => c.check)).toContain("the cut could be verified");
    const broken = await renderAndVerify({ ...t, render: async () => { throw new Error("Text does not fit at a readable size"); } }, dir);
    expect(broken.files).toBeUndefined();
    expect(broken.verification).toMatchObject({ passed: false, checks: [{ check: "the cut rendered" }] });
    await expect(renderAndVerify({ ...t, render: async () => { throw new DailyProposalError("renderer-unavailable", "no chromium"); } }, dir)).rejects.toMatchObject({ code: "renderer-unavailable" });
  }, 60_000);
  it.skipIf(!hasFfmpeg)("a run whose render cannot be verified is blocked, presents no cut, and lists only files that exist (Codex P2)", async () => {
    const templates = TEMPLATES as Record<string, (typeof TEMPLATES)[string]>;
    const original = templates["cpu-power"];   // the data's pick on the committed snapshot
    templates["cpu-power"] = { ...original, render: async (out: string) => { const a = join(out, "x-silent.mp4"), b = join(out, "x-sfx.mp4"); writeFileSync(a, "not a video"); writeFileSync(b, "not a video"); return { silentPath: a, sfxPath: b }; } };
    try {
      const out = join(mkdtempSync(join(tmpdir(), "daily-blocked-")), "run");
      const result = await runDailyProposal(["--snapshot", SNAPSHOT_PATH, "--out", out], NOW);
      expect(result).toMatchObject({ exitCode: 2, report: { status: "blocked-by-render-check" } });
      const proposal = JSON.parse(readFileSync(join(out, "proposal.json"), "utf8"));
      expect(proposal.animatedCut.notRendered).toContain("unverified");
      const listed = (result.report as { files: string[] }).files;
      expect(listed).not.toContain("beats-phone.png");
      for (const name of listed) expect(existsSync(join(out, name))).toBe(true);
      expect(existsSync(join(out, ".daily-proposal.lock"))).toBe(false);
    } finally {
      templates["cpu-power"] = original;
    }
  }, 60_000);
  it.skipIf(!hasFfmpeg)("measures a short cue at 0 s without a negative pre-roll (Codex P2)", async () => {
    const t = TEMPLATES["ram-seat"];
    const atZero = { ...t, cues: [{ kind: "button", at: 0, seconds: 0.05, reason: "a cue at the very start (none in this mix)" }, ...t.cues] };
    const v = await verifyRender(atZero, files, scratch());
    const onset = v.checks.find((c) => c.check === "every short cue has its own onset")!;
    expect(onset.detail).toContain("0.000s button");
    expect(v.checks.some((c) => c.check === "every sampled frame decodes")).toBe(false);
  }, 60_000);
  it.skipIf(!hasFfmpeg)("fails a cut whose disclosure line is missing even though the badge is there (Codex P2)", async () => {
    const dir = scratch(), noLine = join(dir, "no-line.mp4");
    spawnSync("ffmpeg", ["-v", "error", "-y", "-i", files.silentPath, "-vf", "drawbox=x=0:y=120:w=1080:h=70:color=0x13131A:t=fill", "-c:a", "copy", noLine]);
    const v = await verifyRender(TEMPLATES["ram-seat"], { silentPath: noLine, sfxPath: files.sfxPath }, dir);
    const failed = v.checks.filter((c) => !c.passed).map((c) => c.check);
    expect(failed).toContain("the disclosure line is on every sampled frame");
    expect(failed).not.toContain("the ILLUSTRATION band is on every sampled frame");   // the badge alone still reads as present
  }, 60_000);
  it.skipIf(!hasFfmpeg)("fails a sound-effects file standing in for the silent one", async () => {
    const failed = (await verifyRender(TEMPLATES["ram-seat"], { silentPath: files.sfxPath, sfxPath: files.sfxPath }, scratch())).checks.filter((c) => !c.passed).map((c) => c.check);
    expect(failed).toContain("the silent MP4 is silent");
  }, 60_000);
});

describe("the review queue: seven distinct topics, each a data-only cut on the shared scenes", () => {
  const SPECS = [CPU_POWER_CUT, FRONT_PANEL_PINS_CUT, ATX_24PIN_CUT, GPU_POWER_CABLE_CUT, MONITOR_INPUT_SOURCE_CUT, CPU_FAN_HEADER_CUT, RAM_SLOTS_CUT];
  const queue = TOPICS.filter((t) => t.automatic !== false && t.animation);
  it("holds exactly seven automatic topics, each rendered from its own spec", () => {
    expect(queue).toHaveLength(7);
    for (const topic of queue) {
      const spec = SPECS.find((s) => s.id === topic.animation);
      expect(spec, topic.id).toBeDefined();
      expect(specProblems(spec!), topic.id).toEqual([]);
      for (const shot of spec!.shots) expect(SCENE_NAMES).toContain(shot.scene);
    }
  });
  it("covers distinct problems: unique ids, titles and cuts (two may share a symptom: one symptom, two different checks)", () => {
    for (const key of ["id", "title", "animation"] as const) expect(new Set(queue.map((t) => t[key])).size).toBe(queue.length);
  });
  it("rests every claim on a cited source, never on unsourced editorial knowledge", () => {
    for (const topic of queue) {
      expect(topic.claims.length, topic.id).toBeGreaterThanOrEqual(2);
      for (const claim of topic.claims) expect(claim.basis, `${topic.id} ${claim.id}`).toMatch(/https:\/\/\S+/);
      const spec = SPECS.find((s) => s.id === topic.animation)!;
      for (const src of spec.sources) { expect(src.url).toMatch(/^https:\/\//); expect(src.quote.length).toBeGreaterThan(20); }
      expect(spec.sourcesChecked.method).toContain("search excerpts");
    }
  });
  it("leaves out the two checks the published two-spots Short already covers (PSU switch, motherboard video port)", () => {
    for (const topic of TOPICS) expect(topic.title.toLowerCase()).not.toMatch(/power supply switch|psu switch|motherboard (video )?port/);
  });
});

describe("the used-topic ledger", () => {
  const ids = TOPICS.map((t) => t.id);
  it("is committed empty: nothing has been taken for review yet", async () => {
    const { ledger } = await loadUsedLedger(join(here, "used-topics.json"), ids, NOW);
    expect(ledger.entries).toEqual([]);
  });
  it("refuses duplicates, unknown topics, a missing person and dates in the future", () => {
    const entry = { topicId: "cpu-power-cable", markedAt: NOW.toISOString(), by: "a", note: "" };
    const bad = (entries: unknown[]) => refusal(() => parseUsedLedger({ ...emptyLedger(), entries }, ids, NOW));
    expect(bad([entry, entry]).message).toContain("marked used twice");
    expect(bad([{ ...entry, topicId: "nope" }]).message).toContain("not in the topic library");
    expect(bad([{ ...entry, by: " " }]).message).toContain("does not say who");
    expect(bad([{ ...entry, markedAt: "2099-01-01T00:00:00Z" }]).message).toContain("in the future");
    expect(refusal(() => parseUsedLedger({ kind: "something-else", version: 1, entries: [] }, ids, NOW)).code).toBe("ledger-invalid");
  });
  it("marks a topic in the ledger it is given (a temporary copy here), and the next pick moves on", async () => {
    const dir = mkdtempSync(join(tmpdir(), "used-ledger-"));
    try {
      const path = join(dir, "used.json");
      writeFileSync(path, `${JSON.stringify(emptyLedger())}\n`);
      expect(await markUsedMain(["--ledger", path, "--topic", "cpu-power-cable", "--by", "tester"], NOW)).toBe(0);
      expect(await markUsedMain(["--ledger", path, "--topic", "cpu-power-cable", "--by", "tester"], NOW)).toBe(1);
      const { ledger } = await loadUsedLedger(path, ids, NOW);
      expect(ledger.entries.map((e) => [e.topicId, e.by])).toEqual([["cpu-power-cable", "tester"]]);
      expect(selectTopic(parseSnapshot(raw(), NOW), { used: ledger.entries }).topic.id).toBe("front-panel-power-pins");
      expect(readdirSync(dir)).toEqual(["used.json"]);   // the atomic write leaves no temporary file behind
      await expect(markTopicUsed(path, { topicId: "nope", by: "x" }, ids, NOW)).rejects.toMatchObject({ code: "ledger-invalid" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
