import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLocalFixtureVideoAdapter } from "./localFixtureVideo.ts";
import type { RenderTaskContext } from "./rendering.ts";

let scratchRoot: string;

beforeEach(async () => {
  scratchRoot = await mkdtemp(join(tmpdir(), "specsmith-local-fixture-video-test-"));
});

afterEach(async () => {
  await rm(scratchRoot, { recursive: true, force: true });
});

/**
 * A stand-in for ffmpeg that writes fixed bytes to whatever path it was
 * asked to produce, without needing the real binary on PATH — this test
 * runs in the vitest step CI executes BEFORE ffmpeg is installed
 * (content-e2e-offline.yml installs it only for the later real-pipeline
 * step), the same reason localFixtureTts.test.ts fakes espeak-ng.
 */
async function writeFakeFfmpeg(binPath: string): Promise<void> {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const outputPath = process.argv[process.argv.length - 1];
fs.writeFileSync(outputPath, Buffer.from("fake-png-bytes"));
process.exit(0);
`;
  await writeFile(binPath, script, "utf8");
  await chmod(binPath, 0o755);
}

function context(taskOverrides: Partial<RenderTaskContext["task"]> = {}): RenderTaskContext {
  return {
    packageId: "pkg-local-fixture-video-test",
    campaignId: "campaign-local-fixture-video-test",
    ideaId: "idea-local-fixture-video-test",
    platform: "youtube-shorts",
    targetDurationSeconds: 24,
    task: {
      taskId: "youtube-shorts-beat-1-visual",
      capability: "video-generation",
      sourceBeat: 0,
      purpose: "test",
      inputRequirements: [],
      outputRequirements: [],
      videoGenerationState: {
        prompt: "Create one instantly understandable vertical short-form PC-hardware visual.",
        durationSeconds: 4,
        aspectRatio: "9:16",
        generateAudio: false,
      },
      ...taskOverrides,
    },
    dependencyArtifacts: [],
  };
}

describe("createLocalFixtureVideoAdapter", () => {
  it("refuses to render without a videoGenerationState rather than inventing a prompt", async () => {
    const adapter = createLocalFixtureVideoAdapter({ outputDir: join(scratchRoot, "out") });
    const ctx = context({ videoGenerationState: undefined });
    await expect(adapter.render(ctx)).rejects.toThrow(/no videoGenerationState/);
  });

  it("rejects a malformed videoGenerationState using the same validation the paid providers apply", async () => {
    const adapter = createLocalFixtureVideoAdapter({ outputDir: join(scratchRoot, "out") });
    const ctx = context({ videoGenerationState: { prompt: "", durationSeconds: 4, aspectRatio: "9:16" } });
    await expect(adapter.render(ctx)).rejects.toThrow(/prompt is required/);
  });

  it("produces a labeled, non-real, non-paid image artifact from a fake ffmpeg binary", async () => {
    const fakeFfmpegPath = join(scratchRoot, "fake-ffmpeg");
    await writeFakeFfmpeg(fakeFfmpegPath);
    const outputDir = join(scratchRoot, "video-fixture-out");

    const adapter = createLocalFixtureVideoAdapter({
      config: { ffmpegPath: fakeFfmpegPath },
      outputDir,
    });

    const artifacts = await adapter.render(context());
    expect(artifacts).toHaveLength(1);
    const [artifact] = artifacts;
    expect(artifact.taskId).toBe("youtube-shorts-beat-1-visual");
    expect(artifact.kind).toBe("image");
    expect(artifact.mimeType).toBe("image/png");
    expect(artifact.metadata?.isFixture).toBe(true);
    expect(artifact.metadata?.isPaidProvider).toBe(false);
    expect(artifact.metadata?.generated).toBe(false);
    expect(artifact.metadata?.presentedAsRealSpecSmithUi).toBe(false);

    const written = await readFile(fileURLToPath(artifact.uri), "utf8");
    expect(written).toBe("fake-png-bytes");
  });

  it("creates its output directory if missing", async () => {
    const fakeFfmpegPath = join(scratchRoot, "fake-ffmpeg");
    await writeFakeFfmpeg(fakeFfmpegPath);
    const outputDir = join(scratchRoot, "does", "not", "exist", "yet");
    await mkdir(scratchRoot, { recursive: true });

    const adapter = createLocalFixtureVideoAdapter({
      config: { ffmpegPath: fakeFfmpegPath },
      outputDir,
    });
    const artifacts = await adapter.render(context());
    expect(artifacts).toHaveLength(1);
  });
});
