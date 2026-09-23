// The packet's job is to make an honest inspection possible. These tests are
// mostly about what it must NOT do: claim quality, hide a stand-in, or go
// quiet about something a person has to decide.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { standingBlockers, writeReviewPacket } from "./reviewPacket";
import type { StoryboardRenderResult } from "./storyboardRender";
import { COMPARE_IDEA } from "./compareIdeaFixture";

let workDir = "";
let masterPath = "";

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "specsmith-review-packet-"));
  masterPath = join(workDir, "master.mp4");
  await writeFile(masterPath, Buffer.from("not-a-real-mp4-but-real-bytes"));
});
afterAll(async () => { if (workDir) await rm(workDir, { recursive: true, force: true }); });

const result = (over: Partial<StoryboardRenderResult> = {}): StoryboardRenderResult => ({
  idea: COMPARE_IDEA,
  content: { packageId: "pkg", campaignId: "camp", ideaId: COMPARE_IDEA.id } as never,
  storyboard: {
    scripts: [{
      platform: "youtube-shorts",
      targetDurationSeconds: 24,
      beats: [
        { purpose: "hook", startSecond: 0, endSecond: 2, narration: "Pick the faster card.", onScreenText: "Which one?", visualDirection: "", factDependencies: [] },
        { purpose: "cta", startSecond: 2, endSecond: 24, narration: "Open Compare.", onScreenText: "Compare", visualDirection: "", factDependencies: [] },
      ],
    }],
  } as never,
  production: {} as never,
  plan: { platform: "youtube-shorts", targetDurationSeconds: 24, tasks: [] } as never,
  timing: {
    targetSeconds: 24, narrationSeconds: 32.7, overrunRatio: 1.3625, overruns: true,
    beats: [
      { index: 0, purpose: "hook", windowSeconds: 2, neededSeconds: 3.6 },
      { index: 1, purpose: "cta", windowSeconds: 22, neededSeconds: 29.1 },
    ],
  },
  timingScale: 1.3625,
  render: {} as never,
  master: {
    artifactId: "m", taskId: "compose", kind: "video",
    uri: pathToFileURL(masterPath).toString(), mimeType: "video/mp4",
    metadata: { durationSeconds: 34.233, width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", captionsBurnedIn: true },
  } as never,
  beats: [
    { beatIndex: 0, purpose: "hook", startSecond: 0, endSecond: 2, renderedStartSecond: 0, renderedEndSecond: 2.73, onScreenText: "Which one?", narration: "Pick the faster card.", capability: "video-generation", adapterName: "offline-card-video-fixture", isFixture: true, artifactUri: "file:///hook.mp4" },
    { beatIndex: 1, purpose: "cta", startSecond: 2, endSecond: 24, renderedStartSecond: 2.73, renderedEndSecond: 32.7, onScreenText: "Compare", narration: "Open Compare.", capability: "deterministic-ui-render", adapterName: "specsmith-ui-render", isFixture: false, artifactUri: "file:///cta.png" },
  ],
  outputDir: workDir,
  ...over,
});

describe("the packet never claims quality", () => {
  it("is always awaiting review, never passed", async () => {
    const { packet } = await writeReviewPacket(result(), { outputDir: join(workDir, "a") });
    expect(packet.status).toBe("awaiting-human-review");
    expect(JSON.stringify(packet)).not.toMatch(/"(approved|publishable|passed)"\s*:\s*true/);
  });

  it("binds the master's real sha256, so an inspection can be recorded against it", async () => {
    // The quality gate matches a render's exact bytes to a committed record
    // of a prior inspection. The packet supplies the hash that record needs.
    const { packet } = await writeReviewPacket(result(), { outputDir: join(workDir, "b") });
    expect(packet.master.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(packet.master.bytes).toBe((await readFile(masterPath)).byteLength);
  });
});

describe("the packet never hides a stand-in", () => {
  it("labels each beat as real capture or fixture", async () => {
    const { packet } = await writeReviewPacket(result(), { outputDir: join(workDir, "c") });
    expect(packet.beats.map((beat) => beat.source)).toEqual(["fixture-stand-in", "real-specsmith-capture"]);
    expect(packet.beats[0].adapter).toContain("fixture");
  });

  it("says the narration is not the voice it is a stand-in for", async () => {
    const { packet } = await writeReviewPacket(result(), { outputDir: join(workDir, "d") });
    expect(packet.narration.intendedVoice).toBe("Liam");
    expect(packet.narration.isPaidProvider).toBe(false);
    expect(packet.narration.isFixture).toBe(true);
    expect(packet.narration.actualProvider).toContain("espeak");
  });

  it("reports the rendered window, not the storyboard's original one", async () => {
    // The video is 34s; printing the storyboard's 0-24s clock beside it would
    // send a reviewer looking at the wrong seconds.
    const { packet } = await writeReviewPacket(result(), { outputDir: join(workDir, "e") });
    expect(packet.beats[1].renderedWindow).toBe("2.7-32.7s");
  });
});

describe("the packet never goes quiet about a decision", () => {
  it("leads with the timing overrun when there is one", () => {
    const blockers = standingBlockers(result());
    expect(blockers[0].id).toBe("storyboard-narration-overruns-its-own-clock");
    expect(blockers[0].summary).toContain("1.36x over");
    expect(blockers[0].needsHuman).toContain("Shorten");
  });

  it("drops the timing blocker when the storyboard actually fits", () => {
    const fitting = result({
      timing: { targetSeconds: 24, narrationSeconds: 20, overrunRatio: 0.83, overruns: false, beats: [] },
      timingScale: 1,
    });
    expect(standingBlockers(fitting).map((blocker) => blocker.id))
      .not.toContain("storyboard-narration-overruns-its-own-clock");
  });

  it("names every standing blocker, each with something only a person can do", () => {
    const blockers = standingBlockers(result());
    expect(blockers.map((blocker) => blocker.id)).toEqual([
      "storyboard-narration-overruns-its-own-clock",
      "narration-is-a-stand-in",
      "music-bed-is-silence",
      "hook-beat-is-a-card",
      "no-quality-gate-passed",
    ]);
    for (const blocker of blockers) {
      expect(blocker.needsHuman.length, blocker.id).toBeGreaterThan(20);
    }
  });

  it("asks the reviewer real questions rather than for a rubber stamp", async () => {
    const { packet } = await writeReviewPacket(result(), { outputDir: join(workDir, "f") });
    expect(packet.decisions.length).toBeGreaterThanOrEqual(4);
    for (const decision of packet.decisions) expect(decision.endsWith("?")).toBe(true);
  });
});
