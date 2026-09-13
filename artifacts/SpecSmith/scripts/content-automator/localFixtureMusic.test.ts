import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLocalFixtureMusicAdapter } from "./localFixtureMusic.ts";
import type { RenderTaskContext } from "./rendering.ts";

let scratchRoot: string;

beforeEach(async () => {
  scratchRoot = await mkdtemp(join(tmpdir(), "specsmith-local-fixture-music-test-"));
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
fs.writeFileSync(outputPath, Buffer.from("RIFF-fake-wav-bytes"));
process.exit(0);
`;
  await writeFile(binPath, script, "utf8");
  await chmod(binPath, 0o755);
}

function context(): RenderTaskContext {
  return {
    packageId: "pkg-local-fixture-music-test",
    campaignId: "campaign-local-fixture-music-test",
    ideaId: "idea-local-fixture-music-test",
    platform: "youtube-shorts",
    targetDurationSeconds: 24,
    task: {
      taskId: "youtube-shorts-audio",
      capability: "music-sfx",
      sourceBeat: null,
      purpose: "test",
      inputRequirements: [],
      outputRequirements: [],
    },
    dependencyArtifacts: [],
  };
}

describe("createLocalFixtureMusicAdapter", () => {
  it("produces a labeled, non-paid silent audio artifact from a fake ffmpeg binary", async () => {
    const fakeFfmpegPath = join(scratchRoot, "fake-ffmpeg");
    await writeFakeFfmpeg(fakeFfmpegPath);
    const outputDir = join(scratchRoot, "music-fixture-out");

    const adapter = createLocalFixtureMusicAdapter({
      config: { ffmpegPath: fakeFfmpegPath },
      outputDir,
    });

    const artifacts = await adapter.render(context());
    expect(artifacts).toHaveLength(1);
    const [artifact] = artifacts;
    expect(artifact.taskId).toBe("youtube-shorts-audio");
    expect(artifact.kind).toBe("audio");
    expect(artifact.mimeType).toBe("audio/wav");
    expect(artifact.metadata?.isFixture).toBe(true);
    expect(artifact.metadata?.isPaidProvider).toBe(false);
    expect(artifact.metadata?.isSilence).toBe(true);

    const written = await readFile(fileURLToPath(artifact.uri), "utf8");
    expect(written).toBe("RIFF-fake-wav-bytes");
  });

  it("respects a configured duration", async () => {
    const fakeFfmpegPath = join(scratchRoot, "fake-ffmpeg");
    await writeFakeFfmpeg(fakeFfmpegPath);
    const outputDir = join(scratchRoot, "music-fixture-out-2");

    const adapter = createLocalFixtureMusicAdapter({
      config: { ffmpegPath: fakeFfmpegPath, durationSeconds: 7 },
      outputDir,
    });
    const [artifact] = await adapter.render(context());
    expect(artifact.metadata?.durationSeconds).toBe(7);
  });

  it("creates its output directory if missing", async () => {
    const fakeFfmpegPath = join(scratchRoot, "fake-ffmpeg");
    await writeFakeFfmpeg(fakeFfmpegPath);
    const outputDir = join(scratchRoot, "does", "not", "exist", "yet");
    await mkdir(scratchRoot, { recursive: true });

    const adapter = createLocalFixtureMusicAdapter({
      config: { ffmpegPath: fakeFfmpegPath },
      outputDir,
    });
    const artifacts = await adapter.render(context());
    expect(artifacts).toHaveLength(1);
  });
});
