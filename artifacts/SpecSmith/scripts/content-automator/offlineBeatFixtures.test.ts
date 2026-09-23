// These adapters exist to make a real render possible without a paid
// provider, so the tests run them for real: actual ffmpeg, actual files,
// actual probed streams. A fixture adapter that only passes against a mock is
// the thing this whole subsystem keeps getting wrong.

import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createOfflineCardVideoAdapter,
  createOfflineSilentBedAdapter,
  escapeDrawText,
  wrapForCard,
  FIXTURE_HEIGHT,
  FIXTURE_WIDTH,
} from "./offlineBeatFixtures";
import type { ProductionTask, VideoPlatform } from "./types";
import type { RenderTaskContext } from "./rendering";

const run = promisify(execFile);
const ffprobe = process.env.SPECSMITH_FFPROBE_PATH?.trim() || "ffprobe";

let workDir = "";
beforeAll(async () => { workDir = await mkdtemp(join(tmpdir(), "specsmith-beat-fixtures-")); });
afterAll(async () => { if (workDir) await rm(workDir, { recursive: true, force: true }); });

const task = (over: Partial<ProductionTask> = {}): ProductionTask => ({
  taskId: "youtube-shorts-beat-1-visual",
  capability: "video-generation",
  sourceBeat: 0,
  purpose: "Create the hook visual for 0-4s.",
  inputRequirements: [],
  outputRequirements: [],
  ...over,
});

const context = (over: Partial<RenderTaskContext> = {}): RenderTaskContext => ({
  packageId: "pkg-test",
  campaignId: "camp-test",
  ideaId: "compare-rtx4080s-rtx4080",
  platform: "youtube-shorts" as VideoPlatform,
  targetDurationSeconds: 24,
  task: task(),
  dependencyArtifacts: [],
  ...over,
});

async function probe(uri: string): Promise<Record<string, string>> {
  const path = fileURLToPath(uri);
  const { stdout } = await run(ffprobe, [
    "-v", "error", "-show_entries", "stream=codec_name,width,height:format=duration",
    "-of", "default=noprint_wrappers=1", path,
  ]);
  return Object.fromEntries(
    stdout.trim().split("\n").map((line) => line.split("=") as [string, string]),
  );
}

describe("drawtext escaping and wrapping", () => {
  it("neutralises the characters that silently truncate a drawtext filter", () => {
    // A colon ends drawtext's option; an apostrophe ends its quoted string.
    // Storyboard hooks are written by a copywriter, not escaped by one.
    expect(escapeDrawText("Same CPU: same settings")).toBe("Same CPU\\: same settings");
    expect(escapeDrawText("SpecSmith's pick")).toBe("SpecSmith’s pick");
    expect(escapeDrawText("100% faster")).toBe("100\\% faster");
    expect(escapeDrawText("a\\b")).toBe("a\\\\b");
  });

  it("wraps a hook into readable lines and never runs away", () => {
    expect(wrapForCard("Can you pick the faster card before the names show?", 22))
      .toEqual(["Can you pick the", "faster card before the", "names show?"]);
    expect(wrapForCard("")).toEqual([]);
    // A pathological single word is kept rather than split mid-word.
    expect(wrapForCard("supercalifragilistic", 5)).toEqual(["supercalifragilistic"]);
    // Bounded, so a runaway storyboard cannot produce a hundred draw calls.
    expect(wrapForCard(Array.from({ length: 200 }, () => "word").join(" "), 10).length).toBeLessThanOrEqual(6);
  });
});

describe("the hook beat's offline video fixture", () => {
  it("renders a real H.264 clip at the vertical short-form size", async () => {
    const adapter = createOfflineCardVideoAdapter({ outputDir: join(workDir, "video") });
    const [artifact] = await adapter.render(context({
      task: task({ videoGenerationState: { onScreenText: "Can you pick the faster card?", durationSeconds: 3 } }),
    }));

    expect(artifact.kind).toBe("video");
    expect(artifact.mimeType).toBe("video/mp4");
    expect(artifact.uri.startsWith("file://")).toBe(true);
    // Not a dry-run placeholder. Real bytes, real stream.
    const probed = await probe(artifact.uri);
    expect(probed.codec_name).toBe("h264");
    expect(Number(probed.width)).toBe(FIXTURE_WIDTH);
    expect(Number(probed.height)).toBe(FIXTURE_HEIGHT);
    expect(Number(probed.duration)).toBeGreaterThan(2.5);
    expect(Number(probed.duration)).toBeLessThan(3.6);
    expect((await stat(fileURLToPath(artifact.uri))).size).toBeGreaterThan(0);
  }, 60_000);

  it("labels itself so nothing downstream mistakes it for production media", async () => {
    const adapter = createOfflineCardVideoAdapter({ outputDir: join(workDir, "video-labels") });
    const [artifact] = await adapter.render(context());
    expect(artifact.metadata).toMatchObject({
      isFixture: true,
      isPaidProvider: false,
      containsProductImagery: false,
      containsThirdPartyMarks: false,
    });
  }, 60_000);

  it("NEVER draws the generation prompt, however tempting a fallback it is", async () => {
    // A VISUAL INSPECTION CAUGHT THIS. deriveVideoGenerationState carries a
    // prompt and no on-screen text, and an earlier draft fell back to it — so
    // the hook rendered with "Create one instantly understandable vertical
    // short-form PC-hardware visual for this story: ..." across the frame.
    // An internal instruction to a provider, shown to the viewer. It compiled,
    // it rendered, and every test passed.
    const adapter = createOfflineCardVideoAdapter({ outputDir: join(workDir, "video-prompt") });
    const [artifact] = await adapter.render(context({
      task: task({
        videoGenerationState: {
          prompt: "Create one instantly understandable vertical short-form PC-hardware visual for this story",
          durationSeconds: 2,
        },
      }),
    }));
    expect(artifact.metadata.textLines).toBe(0);
  }, 60_000);

  it("renders a plain card rather than failing when the beat has no text", async () => {
    // A storyboard beat can legitimately carry no on-screen text. That is a
    // design choice, not a render error.
    const adapter = createOfflineCardVideoAdapter({ outputDir: join(workDir, "video-empty") });
    const [artifact] = await adapter.render(context());
    expect(artifact.metadata.textLines).toBe(0);
    expect((await probe(artifact.uri)).codec_name).toBe("h264");
  }, 60_000);

  it("survives a hook containing the characters that break drawtext", async () => {
    const adapter = createOfflineCardVideoAdapter({ outputDir: join(workDir, "video-punct") });
    const [artifact] = await adapter.render(context({
      task: task({ videoGenerationState: { onScreenText: "Same CPU: SpecSmith's 100% test", durationSeconds: 2 } }),
    }));
    expect((await probe(artifact.uri)).codec_name).toBe("h264");
  }, 60_000);
});

describe("the music bed's offline fixture", () => {
  it("renders real silent audio and says that it is silent", async () => {
    const adapter = createOfflineSilentBedAdapter({ outputDir: join(workDir, "music") });
    const [artifact] = await adapter.render(context({ targetDurationSeconds: 5 }));

    expect(artifact.kind).toBe("audio");
    const probed = await probe(artifact.uri);
    expect(probed.codec_name).toBe("pcm_s16le");
    expect(Number(probed.duration)).toBeGreaterThan(4.5);
    expect(artifact.metadata).toMatchObject({
      isSilent: true,
      requiresLicensedReplacement: true,
      isFixture: true,
      isPaidProvider: false,
    });
  }, 60_000);

  it("declares the rights decision it is deferring, not hiding it", () => {
    // A bed has to be licensed, attributed and cleared before it can ship.
    // The flag is how the review packet knows to say so.
    const adapter = createOfflineSilentBedAdapter({ outputDir: join(workDir, "music-2") });
    expect(adapter.capability).toBe("music-sfx");
    expect(adapter.name).toContain("fixture");
  });
});
