#!/usr/bin/env tsx
// Three-second visual prototype of the recommended concept's opening.
//
//   pnpm exec tsx scripts/content-automator/nextVideoGpuUpgrade/prototype.ts
//
// Built from the same pieces production uses, in the same banded layout:
//   - the story band: the beat's data motion graphic, rendered by the
//     data-motion-graphic adapter from values the proposal pass computed;
//   - the disclosure band: the production disclosure-overlay adapter, verbatim;
//   - the caption band: the production caption style (captionRender.ts).
// Silent: no voice was generated, paid or otherwise. Nothing is published.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DISCLOSURE_BANDED_LAYOUT as L } from "../bandedLayout.ts";
import { buildAssDocument, parseCaptionRenderState } from "../captionRender.ts";
import { createDisclosureOverlayAdapter } from "../uiRender/disclosureOverlay.ts";
import type { CreativeConcept } from "../v2/creative/concept.ts";
import { renderDataMotionGraphic } from "../v2/creative/dataMotionGraphicRender.ts";
import { runCreativeProposalPass } from "../v2/creative/proposalPass.ts";
import { gpuUpgradeMission, WORKFLOW_DIRECTORY } from "./workflowCli.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
export const PROTOTYPE_DIR = resolve(here, "../../../render-output/next-video-gpu-upgrade-prototype");
const SECONDS = 3;

function run(command: string, args: string[]): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [], err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolvePromise(Buffer.concat(out)) : reject(new Error(`${command} exited ${code}: ${Buffer.concat(err).toString("utf8").slice(-600)}`)));
  });
}

/** Rows of near-white pixels in a horizontal band of one frame: the caption's rendered height. */
async function textRows(video: string, at: number, y: number, height: number): Promise<{ rows: number; first: number; last: number }> {
  const raw = await run("ffmpeg", ["-v", "error", "-ss", at.toFixed(3), "-i", video, "-frames:v", "1", "-vf", `crop=1080:${height}:0:${y},format=gray`, "-f", "rawvideo", "-"]);
  let rows = 0, first = -1, last = -1;
  for (let row = 0; row < height; row += 1) {
    let bright = 0;
    for (let x = 0; x < 1080; x += 1) if (raw[row * 1080 + x] > 200) bright += 1;
    if (bright >= 3) { rows += 1; if (first < 0) first = row; last = row; }
  }
  return { rows, first, last };
}

export async function renderPrototype() {
  const { mission } = gpuUpgradeMission();
  const batches = join(WORKFLOW_DIRECTORY, "batches");
  const latest = (await readdir(batches)).sort().at(-1)!;
  const files = (await readdir(join(batches, latest))).sort();
  const concepts = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(batches, latest, file), "utf8")) as CreativeConcept));
  const { proposals } = runCreativeProposalPass({ ...mission, concepts });
  const proposal = proposals[0];
  if (!proposal.contractEligible) throw new Error(`${proposal.concept.conceptId} is not contract eligible; it cannot be prototyped.`);
  const beat = proposal.concept.beats[0];
  if (beat.startSecond !== 0 || beat.endSecond < SECONDS) throw new Error("The prototype covers the opening beat, which must run the first three seconds.");
  const graphic = proposal.motionGraphics.find((entry) => beat.visualIds.includes(entry.visualId));
  if (!graphic) throw new Error("The opening beat shows no data motion graphic.");
  const disclosures = proposal.storyboard.persistentDisclosures ?? [];

  await rm(PROTOTYPE_DIR, { recursive: true, force: true });
  await mkdir(PROTOTYPE_DIR, { recursive: true });

  const story = await renderDataMotionGraphic({ graphic, durationSeconds: SECONDS, width: L.width, height: L.story.height }, join(PROTOTYPE_DIR, "story.mp4"), PROTOTYPE_DIR);
  const [panel] = await createDisclosureOverlayAdapter({ outputDir: PROTOTYPE_DIR }).render({
    packageId: "prototype", campaignId: "prototype", ideaId: proposal.concept.conceptId, platform: "youtube-shorts", targetDurationSeconds: SECONDS,
    task: { taskId: "disclosure", capability: "disclosure-overlay", sourceBeat: null, purpose: "", inputRequirements: [], outputRequirements: [],
      disclosureOverlayState: { lines: disclosures, width: L.width, height: L.disclosure.height } } as never,
    dependencyArtifacts: [],
  });
  const panelPath = fileURLToPath(panel.uri);
  const captionPath = join(PROTOTYPE_DIR, "captions.ass");
  await writeFile(captionPath, buildAssDocument(parseCaptionRenderState({ durationSeconds: SECONDS, placement: "caption-band",
    cues: [{ startSecond: 0, endSecond: SECONDS, text: beat.onScreenText }] })));

  const video = join(PROTOTYPE_DIR, "gpu-upgrade-opening-prototype.mp4");
  await run("ffmpeg", ["-v", "error", "-y",
    "-f", "lavfi", "-i", `color=c=0x0A0A0F:s=${L.width}x${L.height}:r=30:d=${SECONDS}`,
    "-i", panelPath, "-i", story.path,
    "-filter_complex", `[0:v][1:v]overlay=0:${L.disclosure.y}[a];[a][2:v]overlay=0:${L.story.y}:shortest=1[b];[b]ass='${captionPath.replace(/:/g, "\\:")}'[v]`,
    "-map", "[v]", "-t", String(SECONDS), "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    "-metadata", "title=PROTOTYPE gpu-upgrade opening (3 s)", "-metadata", "comment=Visual prototype. No voice. Figures are SpecSmith model estimates. Not reviewed, not approved, not for publication.",
    video]);

  const frames: string[] = [];
  for (const at of [0, 0.25, 0.6, 1.5, 2.95]) {
    const path = join(PROTOTYPE_DIR, `frame-${at.toFixed(2)}s.png`);
    await run("ffmpeg", ["-v", "error", "-y", "-ss", at.toFixed(3), "-i", video, "-frames:v", "1", path]);
    frames.push(path);
  }
  const sheet = join(PROTOTYPE_DIR, "inspection-sheet.png");
  await run("ffmpeg", ["-v", "error", "-y", ...frames.flatMap((path) => ["-i", path]), "-filter_complex",
    `${frames.map((_, i) => `[${i}:v]scale=432:768[s${i}]`).join(";")};${frames.map((_, i) => `[s${i}]`).join("")}hstack=inputs=${frames.length}`, "-frames:v", "1", sheet]);

  const caption0 = await textRows(video, 0, L.captions.y, L.captions.height);
  const bytes = await readFile(video);
  const report = {
    label: "VISUAL PROTOTYPE, 3 s, silent. Not reviewed, not approved, not for publication.",
    concept: proposal.concept.conceptId,
    beat: { purpose: beat.purpose, caption: beat.onScreenText, narrationScriptOnly: beat.narration },
    graphic,
    disclosures,
    video: { path: video, sha256: createHash("sha256").update(bytes).digest("hex"), seconds: SECONDS },
    story: { sha256: story.sha256, minFontPx: story.minFontPx, valuesSha256: story.valuesSha256 },
    disclosurePanel: panel.metadata,
    captionFrame0: { ...caption0, frameHeight: L.height, percentOfFrame: Number(((caption0.last - caption0.first + 1) / L.height * 100).toFixed(1)) },
    frames, sheet,
  };
  await writeFile(join(PROTOTYPE_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  renderPrototype().then((report) => console.log(JSON.stringify({ ...report, graphic: undefined }, null, 2))).catch((error) => { console.error(error); process.exitCode = 1; });
}
