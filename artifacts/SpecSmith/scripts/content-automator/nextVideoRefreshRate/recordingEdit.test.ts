// The recording cut, on a TEST FIXTURE: a synthetic 2560×1440 "recording"
// (flat grey with a red box where the value sits and a green bar where its
// label sits), never real Windows footage. It proves the mechanics: shots are
// cut from the recording at their crops, the value lands where mapRect says,
// there is no banner, the caption band carries the DEMO label on the demo and
// the one highlight on the kept value, and the renderer refuses a recording
// whose bytes differ from the edit, a stretched or out-of-bounds crop, and an
// unreadably small value.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cutProblems, LAYOUT, mapRect, MIN_VALUE_BOX_PX, renderRecordingEdit, type RecordingEditReport } from "./recordingEdit.ts";
import type { RecordingEdit, Segment } from "./storyboard.ts";

const VALUE = { x: 900, y: 700, w: 300, h: 60 };
const LABEL = { x: 750, y: 300, w: 600, h: 80 };
const CROP = { x: 700, y: 200, w: 692, h: 1000 };
let dir: string, fixture: string, sha: string, report: RecordingEditReport;

const ffmpeg = (args: string[]) => {
  const result = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`ffmpeg could not run: ${result.error.message}. These tests need ffmpeg installed.`);
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout;
};
const pixel = (video: string, second: number, x: number, y: number) => {
  const raw = ffmpeg(["-ss", String(second), "-i", video, "-frames:v", "1", "-vf", `format=rgb24,crop=1:1:${Math.round(x)}:${Math.round(y)}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return [...raw.subarray(0, 3)];
};
const near = (actual: number[], expected: number[], tolerance = 28) => actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);

const shot = (shot: Segment["shot"], start: number, end: number, hz: number, caption: string, extra: Partial<Segment> = {}): Segment => ({
  shot, sourceStart: start, sourceEnd: end, crop: CROP, context: [{ ...LABEL, label: "Choose a refresh rate" }],
  value: { ...VALUE, label: `${hz} Hz`, hz }, caption, ...extra,
});
const edit = (): RecordingEdit => ({
  recording: { path: fixture, sha256: sha, width: 2560, height: 1440, recordedOn: "fixture", windowsVersion: "fixture", monitorModel: "fixture" },
  segments: [
    shot("open-current", 0, 2.5, 240, "Check your monitor's refresh rate"),
    shot("list-open", 2.5, 5, 240, "The list shows what your setup supports"),
    shot("demo-low", 5, 7, 60, "Changing it: a demo"),
    shot("choose-current", 7, 10, 240, "Pick the rate, then Keep changes"),
    shot("kept", 10, 13, 240, "", { highlightFrom: 0.5 }),
  ],
  closingCaption: "What's yours set to?",
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "refresh-rate-edit-"));
  fixture = join(dir, "FIXTURE-not-a-recording.mp4");
  ffmpeg(["-f", "lavfi", "-i", "color=c=0x202020:s=2560x1440:r=30:d=14",
    "-vf", `drawbox=x=${VALUE.x}:y=${VALUE.y}:w=${VALUE.w}:h=${VALUE.h}:color=red:t=fill,drawbox=x=${LABEL.x}:y=${LABEL.y}:w=${LABEL.w}:h=${LABEL.h}:color=0x00C000:t=fill`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", fixture]);
  sha = createHash("sha256").update(readFileSync(fixture)).digest("hex");
  report = await renderRecordingEdit(edit(), { outputDir: join(dir, "out"), label: "TEST FIXTURE: synthetic recording, not Windows footage" });
}, 240_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("cutting the recording", () => {
  it("runs the edit's length, silent, at 1080×1920, labelled as a fixture", () => {
    expect(report.video).toMatchObject({ durationSeconds: 13, width: 1080, height: 1920, audio: "silent" });
    expect(report.label).toMatch(/TEST FIXTURE/);
    expect(report.recording.verifiedSha256).toBe(true);
  });

  it("puts the recording's own pixels where the crop maps them, with no banner on top", () => {
    const value = mapRect(CROP, VALUE), label = mapRect(CROP, LABEL);
    expect(near(pixel(report.video.path, 1, value.x + value.w / 2, value.y + value.h / 2), [255, 0, 0], 60)).toBe(true);
    expect(near(pixel(report.video.path, 1, label.x + label.w / 2, label.y + label.h / 2), [0, 192, 0], 60)).toBe(true);
    // The top of the frame is the recording (grey), not an amber or brand banner.
    expect(near(pixel(report.video.path, 1, 540, 30), [32, 32, 32])).toBe(true);
  });

  it("carries the DEMO label only on the demo, and the one highlight on the kept value", () => {
    const amberPill = (second: number) => near(pixel(report.video.path, second, 540, LAYOUT.captions.y + 30), [255, 179, 0], 50);
    expect(amberPill(6)).toBe(true);
    expect(amberPill(1)).toBe(false);
    expect(report.shots.find((entry) => entry.shot === "demo-low")?.demoLabel).toBe("DEMO · set to 60 Hz for this video");
    const value = mapRect(CROP, VALUE);
    const ring = (second: number) => near(pixel(report.video.path, second, value.x - 14, value.y + value.h / 2), [108, 99, 255], 50);
    expect(ring(12)).toBe(true);
    expect(ring(8)).toBe(false);
  });

  it("refuses a recording whose bytes are not the ones the edit names", async () => {
    await expect(renderRecordingEdit({ ...edit(), recording: { ...edit().recording, sha256: "f".repeat(64) } }, { outputDir: join(dir, "bad") }))
      .rejects.toThrow(/do not match the SHA-256/);
  });
});

describe("crop checks", () => {
  it("passes the fixture's crops", () => expect(cutProblems(edit())).toEqual([]));

  it("refuses a stretched crop, one outside the recording, and an unreadably small value", () => {
    const with1 = (change: Partial<Segment>) => ({ ...edit(), segments: edit().segments.map((s, i) => i === 1 ? { ...s, ...change } : s) });
    expect(cutProblems(with1({ crop: { ...CROP, w: 1000 } })).join()).toMatch(/nothing is stretched/);
    expect(cutProblems(with1({ crop: { x: 2000, y: 600, w: 692, h: 1000 } })).join()).toMatch(/leaves the 2560×1440 recording/);
    expect(cutProblems(with1({ crop: { x: 0, y: 0, w: 1384, h: 2000 } })).join()).toMatch(/leaves the 2560×1440/);
    const wide = { x: 300, y: 0, w: 997, h: 1440 };
    expect(cutProblems(with1({ crop: wide, value: { ...VALUE, h: 40, label: "240 Hz", hz: 240 } })).join()).toMatch(new RegExp(`under ${MIN_VALUE_BOX_PX} px`));
  });
});
