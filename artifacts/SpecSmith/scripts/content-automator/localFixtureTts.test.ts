// Regression coverage for a real bug found by direct testing: espeak-ng 1.51
// (as packaged for Ubuntu 24.04/noble — the base image GitHub's ubuntu-latest
// runners use) silently TRUNCATES its `-w` output-path argument once the
// full path passes roughly 194 bytes, still exits 0, and writes a different,
// wrong file next to the one actually requested. This repository's own
// output path (.../render-output/<package>/audio/<package>-<platform>-
// <taskId>.wav) can cross that threshold on a long checkout path (a deep
// worktree, a long CI workspace), which would silently corrupt the render
// pipeline's narration step. localFixtureTts.ts now always hands espeak-ng a
// short scratch path under the OS temp directory and moves the result into
// place — this test simulates the truncating binary and proves the adapter
// still produces the correct file at the correct, long, descriptive path.

import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLocalFixtureTtsAdapter } from "./localFixtureTts.ts";
import type { RenderTaskContext } from "./rendering.ts";

let scratchRoot: string;

beforeEach(async () => {
  scratchRoot = await mkdtemp(join(tmpdir(), "specsmith-local-fixture-tts-test-"));
});

afterEach(async () => {
  await rm(scratchRoot, { recursive: true, force: true });
});

/**
 * A stand-in for espeak-ng that reproduces the exact bug: it truncates
 * whatever path follows `-w` to `truncateAt` bytes before writing, and
 * still exits 0.
 */
async function writeTruncatingFakeEspeak(binPath: string, truncateAt: number): Promise<void> {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const wIndex = args.indexOf("-w");
if (wIndex === -1) { console.error("no -w argument"); process.exit(1); }
const requestedPath = args[wIndex + 1];
const truncatedPath = requestedPath.slice(0, ${truncateAt});
fs.writeFileSync(truncatedPath, Buffer.from("RIFF-fake-wav-bytes"));
process.exit(0);
`;
  await writeFile(binPath, script, "utf8");
  await chmod(binPath, 0o755);
}

function context(outputRoot: string): RenderTaskContext {
  return {
    packageId: "pkg-local-fixture-tts-test",
    campaignId: "campaign-local-fixture-tts-test",
    ideaId: "idea-local-fixture-tts-test",
    platform: "youtube-shorts",
    targetDurationSeconds: 8,
    task: {
      taskId: "voice-with-a-realistically-long-descriptive-task-identifier",
      capability: "text-to-speech",
      sourceBeat: null,
      purpose: "test",
      inputRequirements: ["Some narration text for the test."],
      outputRequirements: [],
    },
    dependencyArtifacts: [],
  };
}

describe("createLocalFixtureTtsAdapter", () => {
  it("still produces the file at the correct, long, descriptive path when espeak-ng truncates a long -w argument", async () => {
    const fakeEspeakPath = join(scratchRoot, "fake-espeak-ng");
    // Deep, descriptive output dir — the shape a real deployment's
    // render-output tree or a CI runner's long checkout path produces —
    // long enough that the OLD code (which passed this exact path to
    // espeak-ng) would have been truncated by the fake binary below.
    const outputDir = join(
      scratchRoot,
      "render-output-in-a-long-checkout-directory",
      "compare-rtx4080s-vs-rtx4080-storyboard-package",
      "audio-narration-track-output",
    );
    await mkdir(outputDir, { recursive: true });

    const longFilenameForTaskId =
      "pkg-local-fixture-tts-test-youtube-shorts-voice-with-a-realistically-long-descriptive-task-identifier.wav";
    const wouldBeOutputPath = join(outputDir, longFilenameForTaskId);
    // Truncate shorter than the real descriptive path, but long enough that
    // this adapter's own short os.tmpdir() scratch path (~40-50 bytes) is
    // never affected — exactly mirroring the real espeak-ng bug's shape.
    const truncateAt = 60;
    expect(wouldBeOutputPath.length).toBeGreaterThan(truncateAt);
    await writeTruncatingFakeEspeak(fakeEspeakPath, truncateAt);

    const adapter = createLocalFixtureTtsAdapter({
      config: { espeakPath: fakeEspeakPath },
      outputDir,
    });

    const artifacts = await adapter.render(context(outputDir));

    expect(artifacts).toHaveLength(1);
    const [artifact] = artifacts;
    expect(fileURLToPath(artifact.uri)).toBe(wouldBeOutputPath);
    const written = await readFile(wouldBeOutputPath, "utf8");
    expect(written).toBe("RIFF-fake-wav-bytes");
    expect(artifact.metadata?.bytes).toBe(Buffer.byteLength("RIFF-fake-wav-bytes"));
  });

  it("throws instead of silently reusing a stray truncated file when the move genuinely fails", async () => {
    // A fake espeak-ng that reports success but writes nothing at all —
    // moveFile must fail loudly (ENOENT), not report the render as done.
    const fakeEspeakPath = join(scratchRoot, "fake-espeak-ng-no-output");
    await writeFile(
      fakeEspeakPath,
      `#!/usr/bin/env node\nprocess.exit(0);\n`,
      "utf8",
    );
    await chmod(fakeEspeakPath, 0o755);

    const outputDir = join(scratchRoot, "audio-out");
    await mkdir(outputDir, { recursive: true });
    const adapter = createLocalFixtureTtsAdapter({
      config: { espeakPath: fakeEspeakPath },
      outputDir,
    });

    await expect(adapter.render(context(outputDir))).rejects.toThrow(/did not produce/);
  });
});
