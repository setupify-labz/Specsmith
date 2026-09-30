// The banded render path, end to end through the real ffmpeg compositor, and
// the frame check that must refuse a broken overlay or a repeated picture.
// Sources are generated shapes, not SpecSmith captures (those need a browser
// and a served app; renderProposalOffline.ts covers them).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { checkBandedFrames, type BandedFrameExpectation } from "./bandedFrameCheck.ts";
import { DISCLOSURE_BANDED_LAYOUT, parseBandedLayout } from "./bandedLayout.ts";
import { buildAssDocument, parseCaptionRenderState } from "./captionRender.ts";
import { createMotionCompositorAdapter, parseMotionCompositorState } from "./motionCompositor.ts";
import type { RenderArtifact } from "./rendering.ts";

const { width, story, disclosure } = DISCLOSURE_BANDED_LAYOUT;
let dir: string;
const ffmpeg = (...args: string[]) => {
  const result = spawnSync("ffmpeg", ["-v", "error", "-y", ...args]);
  if (result.error) throw new Error(`ffmpeg could not run: ${result.error.message}. These tests need ffmpeg installed.`);
  if (result.status !== 0) throw new Error(result.stderr.toString());
};
const file = (name: string) => join(dir, name);
const artifact = (taskId: string, path: string, kind: RenderArtifact["kind"], mimeType: string): RenderArtifact =>
  ({ artifactId: `${taskId}-a`, taskId, kind, uri: pathToFileURL(path).toString(), mimeType });

const BEATS = [
  { startSecond: 0, endSecond: 1.5 },
  { startSecond: 1.5, endSecond: 3 },
  { startSecond: 3, endSecond: 4.5 },
];
const CUES = [
  { startSecond: 0, endSecond: 1.5, text: "One" },
  { startSecond: 1.5, endSecond: 3, text: "Two" },
  { startSecond: 3, endSecond: 4.5, text: "Three" },
];

async function compose(visuals: string[], layout: unknown = DISCLOSURE_BANDED_LAYOUT, name = "out"): Promise<string> {
  const outputDir = file(name);
  const adapter = createMotionCompositorAdapter({ outputDir, preset: "ultrafast" });
  const artifacts = [
    ...visuals.map((path, index) => artifact(`v${index}`, path, "image", "image/png")),
    artifact("voice", file("voice.wav"), "audio", "audio/wav"),
    artifact("captions", file("captions.ass"), "captions", "text/x-ass"),
    artifact("disclosure", file("panel.png"), "image", "image/png"),
  ];
  const [video] = await adapter.render({
    packageId: "p", campaignId: "c", ideaId: "i", platform: "youtube-shorts", targetDurationSeconds: 4.5,
    task: {
      taskId: "compose", capability: "motion-compositor", sourceBeat: null, purpose: "", inputRequirements: [], outputRequirements: [],
      compositorState: {
        durationSeconds: 4.5, fps: 30, voiceTaskId: "voice", captionTaskId: "captions", disclosureTaskId: "disclosure", layout,
        visualTimeline: BEATS.map((beat, index) => ({ visualTaskId: `v${index}`, ...beat })),
      },
    } as never,
    dependencyArtifacts: artifacts,
  });
  return fileURLToPath(video.uri);
}

const expectation = (videoPath: string, sources = [file("s0.png"), file("s1.png"), file("s2.png")]): BandedFrameExpectation => ({
  videoPath,
  layout: DISCLOSURE_BANDED_LAYOUT,
  disclosurePanelPath: file("panel.png"),
  beats: BEATS.map((beat, index) => ({ ...beat, sources: [sources[index]] })),
  captionCues: CUES,
  durationSeconds: 4.5,
});

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "banded-render-"));
  // Three distinct story pictures, a disclosure panel with text-like marks, and a voice track.
  const colors = ["0x223355", "0x552233", "0x225533"];
  colors.forEach((color, index) => ffmpeg("-f", "lavfi", "-i", `color=c=${color}:s=${width}x${story.height}`, "-frames:v", "1",
    "-vf", `drawbox=x=${100 + index * 250}:y=${200 + index * 150}:w=300:h=300:color=white:t=fill`, file(`s${index}.png`)));
  ffmpeg("-f", "lavfi", "-i", `color=c=0x0b0c12:s=${width}x${disclosure.height}`, "-frames:v", "1",
    "-vf", "drawbox=x=36:y=50:w=900:h=24:color=white:t=fill,drawbox=x=36:y=110:w=700:h=24:color=white:t=fill,drawbox=x=36:y=170:w=950:h=24:color=white:t=fill", file("panel.png"));
  ffmpeg("-f", "lavfi", "-i", "sine=frequency=220:duration=4.4", file("voice.wav"));
  writeFileSync(file("captions.ass"), buildAssDocument(parseCaptionRenderState({ durationSeconds: 4.5, cues: CUES, placement: "caption-band" })));
}, 60_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the banded compositor", () => {
  it("renders the story in its band, the disclosure unchanged in its own, and passes the frame check", async () => {
    const video = await compose([file("s0.png"), file("s1.png"), file("s2.png")]);
    const report = await checkBandedFrames(expectation(video));
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    // Opening and final frames are both sampled.
    expect(report.samples[0].atSecond).toBe(0);
    expect(report.samples.at(-1)!.atSecond).toBeCloseTo(4.45, 2);
    for (const sample of report.samples) {
      if (sample.captionInk !== null) expect(sample.captionInk).toBeGreaterThan(0);
    }
  }, 120_000);

  it("refuses overlapping bands, and a layout without its disclosure", () => {
    const base = { durationSeconds: 3, voiceTaskId: "voice", visualTimeline: [{ visualTaskId: "v", startSecond: 0, endSecond: 3 }] };
    expect(() => parseMotionCompositorState({ ...base, disclosureTaskId: "d",
      layout: { ...DISCLOSURE_BANDED_LAYOUT, disclosure: { y: 0, height: 400 } } })).toThrow(/overlap/);
    expect(() => parseMotionCompositorState({ ...base, layout: DISCLOSURE_BANDED_LAYOUT })).toThrow(/come together/);
    expect(() => parseBandedLayout({ ...DISCLOSURE_BANDED_LAYOUT, captions: { y: 1800, height: 300 } })).toThrow(/inside/);
  });

  it("refuses a disclosure panel of the wrong size rather than stretching it", async () => {
    ffmpeg("-i", file("panel.png"), "-vf", "scale=1080:200", file("short-panel.png"));
    const adapter = createMotionCompositorAdapter({ outputDir: file("bad-panel"), preset: "ultrafast" });
    await expect(adapter.render({
      packageId: "p", campaignId: "c", ideaId: "i", platform: "youtube-shorts", targetDurationSeconds: 1.5,
      task: { taskId: "compose", capability: "motion-compositor", sourceBeat: null, purpose: "", inputRequirements: [], outputRequirements: [],
        compositorState: { durationSeconds: 1.5, voiceTaskId: "voice", disclosureTaskId: "disclosure", layout: DISCLOSURE_BANDED_LAYOUT,
          visualTimeline: [{ visualTaskId: "v0", startSecond: 0, endSecond: 1.5 }] } } as never,
      dependencyArtifacts: [artifact("v0", file("s0.png"), "image", "image/png"), artifact("voice", file("voice.wav"), "audio", "audio/wav"),
        artifact("disclosure", file("short-panel.png"), "image", "image/png")],
    })).rejects.toThrow(/Disclosure panel is 1080x200/);
  }, 60_000);
});

describe("the frame check refuses broken renders", () => {
  let good: string;
  beforeAll(async () => { good = await compose([file("s0.png"), file("s1.png"), file("s2.png")], DISCLOSURE_BANDED_LAYOUT, "good"); }, 120_000);
  const derive = (name: string, ...args: string[]) => {
    const path = file(`${name}.mp4`);
    ffmpeg("-i", good, ...args, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "copy", path);
    return path;
  };

  it("broken overlay: the disclosure disappears partway through", async () => {
    const report = await checkBandedFrames(expectation(derive("blanked", "-vf",
      `drawbox=x=0:y=0:w=iw:h=${disclosure.height}:color=black:t=fill:enable='gte(t,1)'`)));
    expect(report.ok).toBe(false);
    expect(report.failures.join("\n")).toMatch(/disclosure band does not show the verified disclosure panel/);
    // Its opening frames were fine: the check samples the whole video, not the start.
    expect(report.samples[0].disclosureError).toBeLessThan(6);
  }, 60_000);

  it("broken overlay: the disclosure drawn over the story", async () => {
    const path = file("over-story.mp4");
    ffmpeg("-i", good, "-i", file("panel.png"), "-filter_complex", `[0:v][1:v]overlay=0:${story.y + 600}`,
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "copy", path);
    const report = await checkBandedFrames(expectation(path));
    expect(report.ok).toBe(false);
    expect(report.failures.join("\n")).toMatch(/story band does not match beat 1's capture/);
  }, 60_000);

  it("repeated visual: the same picture on consecutive beats is refused", async () => {
    const repeated = await compose([file("s0.png"), file("s0.png"), file("s2.png")], DISCLOSURE_BANDED_LAYOUT, "repeated");
    // Even when the expectation is told that is what was planned, a repeat across a cut fails.
    const report = await checkBandedFrames(expectation(repeated, [file("s0.png"), file("s0.png"), file("s2.png")]));
    expect(report.ok).toBe(false);
    expect(report.failures).toEqual(["Beats 1 and 2 show the same picture across the cut."]);
  }, 120_000);
});
