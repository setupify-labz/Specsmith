// The silent narration track: labelled silent, the planned length, and
// refused when the plan and the video disagree on timing.

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createSilentNarrationAdapter } from "./silentNarration.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const context = (seconds: number) => ({ packageId: "p", campaignId: "c", ideaId: "i", platform: "youtube-shorts" as const, targetDurationSeconds: seconds,
  task: { taskId: "voice", capability: "text-to-speech", sourceBeat: null, purpose: "", inputRequirements: [], outputRequirements: [] } as never, dependencyArtifacts: [] });
const lines = [{ startSecond: 0, endSecond: 1.5, text: "One." }, { startSecond: 1.5, endSecond: 2.5, text: "Two." }];

describe("silent narration", () => {
  it("writes silence of the planned length, labelled silent, with the planned lines beside it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "silent-")); dirs.push(dir);
    const [artifact] = await createSilentNarrationAdapter({ outputDir: dir, plannedLines: lines }).render(context(2.5));
    expect(artifact.metadata).toMatchObject({ renderer: "silent-narration-placeholder", isSilent: true, isPaidProvider: false, beatTiming: "planned" });
    const path = fileURLToPath(artifact.uri);
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { encoding: "utf8" });
    expect(Number(probe.stdout)).toBeCloseTo(2.5, 1);
    const peak = spawnSync("ffmpeg", ["-v", "info", "-i", path, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
    expect(peak.stderr).toMatch(/max_volume: -(9[0-9]|inf)/);
    const planned = JSON.parse(readFileSync(String(artifact.metadata!.plannedTimingPath), "utf8"));
    expect(planned.label).toMatch(/NOT SPOKEN/);
    expect(planned.lines).toEqual(lines);
  });

  it("refuses when the plan and the video disagree on length", async () => {
    const dir = mkdtempSync(join(tmpdir(), "silent-")); dirs.push(dir);
    await expect(createSilentNarrationAdapter({ outputDir: dir, plannedLines: lines }).render(context(4))).rejects.toThrow(/planned/);
  });
});
