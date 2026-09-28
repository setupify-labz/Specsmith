// Renders a result-card video to an offline PREVIEW: a silent MP4, frames
// sampled from that MP4, a contact sheet, and a manifest.
//
// A PREVIEW, NOT A PUBLISHABLE MASTER. There is no narration, no QC verdict,
// no receipt and no ledger entry; the manifest says `publishable: false` and
// nothing reads it as a render to publish. It exists for a person to look at.
//
// LAYOUT IS CHECKED, NOT ASSUMED. Before any frame is kept, every scene is
// seeked to the moment it is fully in and the page is measured: each box must
// sit inside SAFE_AREA, no text may overflow its box, the persistent label
// must be fully opaque and clear of every card, and no card may overlap
// another. Any failure stops the render.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Page } from "playwright";

import { launchBrowser } from "../uiRender/capture.ts";
import { resultCardHtml } from "./template.ts";
import { CROSSFADE_SECONDS, RESULT_CARD_FORMAT, SAFE_AREA, durationSeconds, sceneWindows, type ResultCardVideo } from "./spec.ts";

export class ResultCardRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResultCardRenderError";
  }
}

export interface SampleTime {
  /** Seconds into the MP4. */
  second: number;
  scene: number;
  /** "settled": the scene fully in; "crossfade": halfway through its fade in. */
  moment: "settled" | "crossfade";
}

export interface SampledFrame extends SampleTime {
  kind: string;
  file: string;
  sha256: string;
}

export interface ResultCardPreview {
  dir: string;
  mp4: string;
  mp4Sha256: string;
  durationSeconds: number;
  frames: SampledFrame[];
  contactSheet: string;
  manifestPath: string;
}

const sha256 = async (path: string): Promise<string> => createHash("sha256").update(await readFile(path)).digest("hex");

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new ResultCardRenderError(`${command} exited ${code}: ${err.slice(-800)}`))));
  });
}

/**
 * Problems with the picture at the current seek time, measured in the page.
 * Plain JavaScript source, not a TypeScript function: the tsx transform adds
 * helpers to compiled functions that do not exist inside the page.
 */
const MEASURE_LAYOUT = `(safe) => {
  const problems = [];
  const shown = (el) => {
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const describe = (el) => \`\${el.className || el.tagName} "\${(el.textContent ?? "").trim().slice(0, 40)}"\`;
  const boxes = [...document.querySelectorAll("[data-box]")].filter(shown);
  for (const box of boxes) {
    const r = box.getBoundingClientRect();
    if (r.left < safe.left - 0.5 || r.right > safe.right + 0.5 || r.top < safe.top - 0.5 || r.bottom > safe.bottom + 0.5) {
      problems.push(\`\${describe(box)} sits outside the safe area (\${Math.round(r.left)},\${Math.round(r.top)})-(\${Math.round(r.right)},\${Math.round(r.bottom)}).\`);
    }
  }
  for (const text of [...document.querySelectorAll("[data-text]")].filter(shown)) {
    const el = text;
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== "inline") {
      problems.push(\`\${describe(el)} overflows its box.\`);
    }
    const r = el.getBoundingClientRect();
    const parent = el.closest("[data-box]").getBoundingClientRect();
    if (r.right > parent.right + 0.5 || r.left < parent.left - 0.5 || r.bottom > parent.bottom + 0.5 || r.top < parent.top - 0.5) problems.push(\`\${describe(el)} spills out of its card.\`);
  }
  // A last line holding one word reads as a mistake on a phone.
  for (const el of [...document.querySelectorAll("[data-text]")].filter(shown)) {
    const words = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const match of node.textContent.matchAll(/\\S+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0) words.push(rect);
      }
    }
    // Words whose heights overlap share a line, so "20" and a smaller "/20" set side by side are one line.
    const lines = [];
    for (const rect of words) {
      const line = lines.find((other) => rect.top < other.bottom - 2 && other.top < rect.bottom - 2);
      if (line) line.count += 1;
      else lines.push({ top: rect.top, bottom: rect.bottom, count: 1 });
    }
    if (lines.length > 1 && lines[lines.length - 1].count === 1) {
      problems.push(\`\${describe(el)} leaves one word alone on its last line.\`);
    }
  }
  const scenes = [...document.querySelectorAll("[data-scene]")].filter(shown);
  if (scenes.length > 1) problems.push(\`\${scenes.length} scenes share the frame; their text would overlap.\`);
  const label = document.querySelector("[data-label]");
  if (!label || getComputedStyle(label).opacity !== "1" || getComputedStyle(label).visibility !== "visible") {
    problems.push("The persistent label is not fully visible.");
  }
  const all = label ? [label, ...boxes.filter((box) => box !== label)] : boxes;
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const a = all[i].getBoundingClientRect();
      const b = all[j].getBoundingClientRect();
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
        problems.push(\`\${describe(all[i])} overlaps \${describe(all[j])}.\`);
      }
    }
  }
  return problems;
}`;

/** Times worth sampling: each scene settled, plus mid-way through its fade in. */
export function sampleTimes(video: ResultCardVideo): SampleTime[] {
  const times: SampleTime[] = [];
  for (const window of sceneWindows(video)) {
    // Every entrance is done 2.6s in; a shorter scene is sampled just before it ends.
    const settled = Math.min(window.end - 0.2, window.start + 2.6);
    times.push({ second: Number(settled.toFixed(3)), scene: window.index, moment: "settled" });
    if (window.index > 0) {
      times.push({ second: Number((window.start + CROSSFADE_SECONDS * 0.75).toFixed(3)), scene: window.index, moment: "crossfade" });
    }
  }
  return times.sort((a, b) => a.second - b.second);
}

async function layoutProblems(page: Page, video: ResultCardVideo): Promise<string[]> {
  const problems: string[] = [];
  for (const { second, scene } of sampleTimes(video)) {
    await page.evaluate((t) => (window as unknown as { __seek(t: number): void }).__seek(t), second);
    const found = (await page.evaluate(`(${MEASURE_LAYOUT})(${JSON.stringify(SAFE_AREA)})`)) as string[];
    problems.push(...found.map((problem) => `t=${second}s scene ${scene}: ${problem}`));
  }
  return problems;
}

/** The layout gate on its own, at every sampled moment: what render would refuse, without rendering. */
export async function checkResultCardLayout(video: ResultCardVideo, html = resultCardHtml(video)): Promise<string[]> {
  const { width, height } = RESULT_CARD_FORMAT;
  const session = await launchBrowser({ width, height, deviceScaleFactor: 1 });
  try {
    const page = await session.context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    return await layoutProblems(page, video);
  } finally {
    await session.close();
  }
}

export async function renderResultCardPreview(
  video: ResultCardVideo,
  outDir: string,
  extraManifest: Record<string, unknown> = {},
): Promise<ResultCardPreview> {
  const { width, height, fps } = RESULT_CARD_FORMAT;
  const duration = durationSeconds(video);
  const frameCount = Math.round(duration * fps);
  const html = resultCardHtml(video);
  if (/<img|<iframe|<video|url\(|https?:/i.test(html)) {
    throw new ResultCardRenderError("A result card draws text and shapes only; the page references an image or URL.");
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, "frames"), { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "result-cards-"));
  const session = await launchBrowser({ width, height, deviceScaleFactor: 1 });
  try {
    const page = await session.context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);

    const problems = await layoutProblems(page, video);
    if (problems.length > 0) throw new ResultCardRenderError(`Layout check failed:\n  ${problems.join("\n  ")}`);

    for (let frame = 0; frame < frameCount; frame += 1) {
      const shownScenes = (await page.evaluate(`(() => { window.__seek(${frame / fps}); return [...document.querySelectorAll("[data-scene]")]
        .filter((el) => el.style.visibility !== "hidden" && Number(el.style.opacity) > 0).length; })()`)) as number;
      // Checked on every frame, not only the sampled ones.
      if (shownScenes > 1) throw new ResultCardRenderError(`Frame ${frame} shows ${shownScenes} scenes at once; their text would overlap.`);
      await page.screenshot({ path: join(work, `${String(frame).padStart(5, "0")}.png`), type: "png" });
    }
  } finally {
    await session.close();
  }

  const mp4 = join(outDir, `${video.id}.preview.mp4`);
  await run("ffmpeg", [
    "-y", "-loglevel", "error", "-framerate", String(fps), "-i", join(work, "%05d.png"),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4,
  ]);
  await rm(work, { recursive: true, force: true });
  const probed = Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4])).trim());

  // Sample from the encoded MP4, so the frames show what the video shows.
  const frames: SampledFrame[] = [];
  for (const time of sampleTimes(video)) {
    const { second, scene } = time;
    const file = join(outDir, "frames", `t${second.toFixed(2).padStart(5, "0")}s-scene${scene}-${video.scenes[scene].kind}-${time.moment}.png`);
    await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", second.toFixed(3), "-i", mp4, "-frames:v", "1", file]);
    frames.push({ ...time, kind: video.scenes[scene].kind, file, sha256: await sha256(file) });
  }
  const contactSheet = join(outDir, `${video.id}.contact-sheet.png`);
  // One settled frame per scene, side by side.
  const settled = frames.filter((frame) => frame.moment === "settled");
  const layout = settled.map((_, index) => `${index * 540}_0`).join("|");
  const scaled = settled.map((_, index) => `[${index}:v]scale=540:960[s${index}]`).join(";");
  await run("ffmpeg", [
    "-y", "-loglevel", "error", ...settled.flatMap((frame) => ["-i", frame.file]), "-filter_complex",
    `${scaled};${settled.map((_, index) => `[s${index}]`).join("")}xstack=inputs=${settled.length}:layout=${layout}[out]`,
    "-map", "[out]", "-frames:v", "1", contactSheet,
  ]);

  const mp4Sha256 = await sha256(mp4);
  const manifestPath = join(outDir, `${video.id}.preview.json`);
  await writeFile(manifestPath, `${JSON.stringify({
    kind: "result-card-offline-preview",
    publishable: false,
    note: "Offline preview for human review. Silent: no narration was generated. Not a publish candidate; no QC, rights or listening review applies to it.",
    video,
    format: RESULT_CARD_FORMAT,
    safeArea: SAFE_AREA,
    windows: sceneWindows(video),
    mp4: { file: mp4, sha256: mp4Sha256, durationSeconds: probed, frames: frameCount, audio: "none" },
    sampledFrames: frames.map((frame) => ({ ...frame, file: frame.file.slice(outDir.length + 1) })),
    ...extraManifest,
  }, null, 2)}\n`);

  return { dir: outDir, mp4, mp4Sha256, durationSeconds: probed, frames, contactSheet, manifestPath };
}
