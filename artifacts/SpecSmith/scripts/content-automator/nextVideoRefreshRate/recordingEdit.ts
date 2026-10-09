#!/usr/bin/env tsx
// Cuts the owner's Windows screen recording into the refresh-rate Short.
//
// Every picture of Windows comes from the recording: each shot is a trimmed,
// cropped piece of it, scaled to fill the story band. Nothing is recreated and
// there is no illustrative banner. SpecSmith adds only the caption band
// (captions, the DEMO label on any shot below the real rate, the "isn't game
// FPS" note, the site line) and one highlight around the kept setting.
//
// The edit decision list (edit.json) is written after watching the recording;
// editProblems (storyboard.ts) refuses it before a frame is cut if a crop hides
// the surrounding UI or the value, a demo is unlabelled or never undone, the
// edit does not open on the real rate or end on it kept, or the copy names a
// rate the screenshot does not list. Here the recording's bytes must match the
// SHA-256 the edit names, and every value must be readable on a 360×640 screen.
// The output is SILENT: the narration is written to match this cut, then
// approved, before any take.
//
//   SPECSMITH_RENDER_CHROMIUM=/opt/pw-browsers/chromium \
//   pnpm exec tsx scripts/content-automator/nextVideoRefreshRate/recordingEdit.ts <edit.json>

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launchBrowser } from "../uiRender/capture.ts";
import { SPECSMITH_MOTION_COLOURS } from "../v2/creative/dataMotionGraphic.ts";
import {
  demoLabel, editProblems, FPS, PAYOFF_NOTE, RefreshRateStoryError, SCREENSHOT, SITE_LINE,
  type Rect, type RecordingEdit, type ScreenshotEvidence, type Segment,
} from "./storyboard.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const EDIT_DIR = resolve(here, "../../../render-output/refresh-rate-recording-edit");
export const FONT_DIR = join(here, "fonts");
const FONT_FILES = { 400: "inter-latin-400-normal.woff2", 600: "inter-latin-600-normal.woff2", 700: "inter-latin-700-normal.woff2" } as const;

/** The frame: the recording's story band on top, SpecSmith's caption band below. Nothing drawn over the story but the one highlight. */
export const LAYOUT = Object.freeze({ width: 1080, height: 1920, story: { y: 0, height: 1560 }, captions: { y: 1560, height: 360 } });
/** A crop must match the story band's shape, so the recording is never stretched. */
export const STORY_ASPECT = LAYOUT.width / LAYOUT.story.height;
/** The value's line box, after scaling, in 1080-px frame pixels: 18 px on a 360×640 screen. */
export const MIN_VALUE_BOX_PX = 54;
/** Smallest SpecSmith type drawn in the caption band (14 px at 360×640). */
export const MIN_TEXT_PX = 42;

export const scaleOf = (crop: Rect) => LAYOUT.width / crop.w;
/** A source rectangle's place in the output frame. */
export function mapRect(crop: Rect, rect: Rect): Rect {
  const k = scaleOf(crop);
  return { x: (rect.x - crop.x) * k, y: LAYOUT.story.y + (rect.y - crop.y) * k, w: rect.w * k, h: rect.h * k };
}

/** Problems only the renderer can see: crop shape, inside the recording, value size. */
export function cutProblems(edit: RecordingEdit): string[] {
  const problems: string[] = [];
  const { width, height } = edit.recording;
  for (const [index, segment] of edit.segments.entries()) {
    const where = `Shot ${index + 1} (${segment.shot})`;
    const { crop } = segment;
    if (crop.x < 0 || crop.y < 0 || crop.x + crop.w > width || crop.y + crop.h > height) problems.push(`${where}: the crop leaves the ${width}×${height} recording.`);
    if (Math.abs(crop.w / crop.h - STORY_ASPECT) / STORY_ASPECT > 0.01) problems.push(`${where}: the crop is ${crop.w}×${crop.h}; it must be ${STORY_ASPECT.toFixed(4)} wide per unit high so nothing is stretched.`);
    if (scaleOf(crop) > 4) problems.push(`${where}: the crop is enlarged ${scaleOf(crop).toFixed(1)}×; past 4× the recording's own pixels show.`);
    const valuePx = segment.value.h * scaleOf(crop);
    if (valuePx < MIN_VALUE_BOX_PX) problems.push(`${where}: "${segment.value.label}" is ${valuePx.toFixed(0)} px high in the frame, under ${MIN_VALUE_BOX_PX} px; crop tighter or record at a larger Windows scale.`);
  }
  return problems;
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [], err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolvePromise(Buffer.concat(out).toString("utf8")) : reject(new Error(`${command} exited ${code}: ${Buffer.concat(err).toString("utf8").slice(-600)}`)));
  });
}
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Where each shot lands on the output timeline. */
export function timeline(segments: readonly Segment[]) {
  let at = 0;
  return segments.map((segment) => {
    const start = at;
    at += segment.sourceEnd - segment.sourceStart;
    return { segment, start, end: at };
  });
}

function overlayScript(state: unknown): string {
  return `
const S = ${JSON.stringify(state)};
const C = S.colours, L = S.layout, W = L.width, CAP = L.captions;
const canvas = document.getElementById('c'); const ctx = canvas.getContext('2d');
const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const measured = { minPx: Infinity, misfits: [] };
function text(s, x, y, maxWidth, max, min, colour, weight) {
  let size = max;
  for (; size >= min; size -= 1) { ctx.font = weight + ' ' + size + 'px Inter'; if (ctx.measureText(s).width <= maxWidth) break; }
  if (size < min) { size = min; measured.misfits.push(s); }
  ctx.font = weight + ' ' + size + 'px Inter'; ctx.fillStyle = colour; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
  measured.minPx = Math.min(measured.minPx, size);
}
function wrap(s, maxWidth, size) {
  ctx.font = '700 ' + size + 'px Inter';
  if (!s || ctx.measureText(s).width <= maxWidth) return [s];
  const words = s.split(' '); let best = null;
  for (let i = 1; i < words.length; i += 1) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const worst = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
    if (!best || worst < best.worst) best = { lines: [a, b], worst };
  }
  return best.lines;
}
window.renderAt = (t) => {
  ctx.clearRect(0, 0, W, L.height);
  ctx.fillStyle = C.background; ctx.fillRect(0, CAP.y, W, CAP.height);
  const shot = S.shots.find((s) => t >= s.start && t < s.end) || S.shots.at(-1);
  const into = t - shot.start;
  // Top line: the DEMO label on a demo shot; the FPS note from the change onwards.
  if (shot.demo) {
    ctx.font = '700 44px Inter'; const w = ctx.measureText(shot.demo).width + 56;
    ctx.fillStyle = C.amber; ctx.beginPath(); ctx.roundRect((W - w) / 2, CAP.y + 24, w, 72, 36); ctx.fill();
    text(shot.demo, W / 2, CAP.y + 60, W - 120, 44, 42, '#0A0A0F', 700);
  } else if (shot.note) {
    text(S.note, W / 2, CAP.y + 60, W - 120, 52, 44, C.amber, 700);
  }
  // Captions wrap to two balanced lines rather than shrink below 60 px.
  const lines = wrap(shot.caption, W - 120, 68);
  lines.forEach((line, i) => text(line, W / 2, CAP.y + 182 + (i - (lines.length - 1) / 2) * 80, W - 120, 68, 60, C.text, 700));
  if (shot.site) text(S.site, W / 2, CAP.y + 300, W - 120, 42, 42, C.textSecondary, 600);
  // The one highlight, around the kept value, in the recording's own place.
  if (shot.highlight && into >= shot.highlight.from) {
    const k = ease((into - shot.highlight.from) / 0.4), r = shot.highlight.rect, pad = 14;
    ctx.save(); ctx.globalAlpha = k; ctx.strokeStyle = C.accent; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.roundRect(r.x - pad, r.y - pad, r.w + 2 * pad, r.h + 2 * pad, 16); ctx.stroke(); ctx.restore();
  }
  return canvas.toDataURL('image/png');
};
window.measured = () => measured;
`;
}

export interface RecordingEditReport {
  readonly label: string;
  readonly video: { readonly path: string; readonly sha256: string; readonly durationSeconds: number; readonly width: number; readonly height: number; readonly fps: number; readonly audio: "silent" };
  readonly recording: RecordingEdit["recording"] & { readonly verifiedSha256: true };
  readonly evidence: ScreenshotEvidence;
  readonly editSha256: string;
  readonly shots: readonly { readonly shot: string; readonly start: number; readonly end: number; readonly source: string; readonly scale: number; readonly valuePx: number; readonly caption: string; readonly demoLabel: string | null }[];
  readonly minTextPx: number;
  readonly keyFrames: readonly { readonly second: number; readonly path: string }[];
  readonly contactSheet: string;
}

export async function renderRecordingEdit(edit: RecordingEdit, options: { outputDir?: string; evidence?: ScreenshotEvidence; label?: string } = {}): Promise<RecordingEditReport> {
  const outputDir = options.outputDir ?? EDIT_DIR;
  const evidence = options.evidence ?? SCREENSHOT;
  const problems = [...editProblems(edit, evidence), ...cutProblems(edit)];
  if (problems.length) throw new RefreshRateStoryError(`The edit is not cuttable:\n- ${problems.join("\n- ")}`);
  const recordingBytes = await readFile(edit.recording.path);
  if (sha256(recordingBytes) !== edit.recording.sha256) throw new RefreshRateStoryError("The recording's bytes do not match the SHA-256 the edit names.");
  const probe = (await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", edit.recording.path])).trim();
  if (probe !== `${edit.recording.width},${edit.recording.height}`) throw new RefreshRateStoryError(`The recording is ${probe}, not the ${edit.recording.width}×${edit.recording.height} the edit was written for.`);

  await mkdir(outputDir, { recursive: true });
  const work = join(outputDir, "work"), framesDir = join(work, "overlay");
  await rm(work, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  const placed = timeline(edit.segments);
  const duration = placed.at(-1)!.end;
  const count = Math.round(duration * FPS);

  // 1. The story: each shot trimmed and cropped from the recording, cut end to end.
  const storyPath = join(work, "story.mp4");
  const parts = placed.map(({ segment }, i) =>
    `[0:v]trim=start=${segment.sourceStart}:end=${segment.sourceEnd},setpts=PTS-STARTPTS,crop=${segment.crop.w}:${segment.crop.h}:${segment.crop.x}:${segment.crop.y},` +
    `scale=${LAYOUT.width}:${LAYOUT.story.height}:flags=lanczos,fps=${FPS},setsar=1[s${i}]`);
  await run("ffmpeg", ["-v", "error", "-y", "-i", edit.recording.path, "-filter_complex",
    `${parts.join(";")};${placed.map((_, i) => `[s${i}]`).join("")}concat=n=${placed.length}:v=1:a=0,pad=${LAYOUT.width}:${LAYOUT.height}:0:${LAYOUT.story.y}:color=0x0A0A0F[v]`,
    "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", storyPath]);

  // 2. SpecSmith's band and the highlight, drawn per frame with transparency.
  const fonts = await Promise.all(Object.entries(FONT_FILES).map(async ([weight, file]) =>
    `@font-face{font-family:Inter;font-weight:${weight};src:url(data:font/woff2;base64,${(await readFile(join(FONT_DIR, file))).toString("base64")}) format('woff2');}`));
  const state = {
    layout: LAYOUT, colours: SPECSMITH_MOTION_COLOURS, note: PAYOFF_NOTE, site: SITE_LINE,
    shots: placed.map(({ segment, start, end }) => ({
      start, end,
      caption: segment === edit.segments.at(-1) ? edit.closingCaption : segment.caption,
      demo: segment.shot === "demo-low" ? demoLabel(segment.value.hz) : null,
      note: segment.shot === "choose-current" || segment.shot === "kept",
      site: segment.shot === "kept",
      highlight: segment.highlightFrom === undefined ? null : { from: segment.highlightFrom, rect: mapRect(segment.crop, segment.value) },
    })),
  };
  let minTextPx = Infinity;
  const session = await launchBrowser({ width: LAYOUT.width, height: LAYOUT.height, deviceScaleFactor: 1 });
  try {
    const page = await session.context.newPage();
    await page.setContent(`<!doctype html><html><head><style>${fonts.join("")}</style></head><body style="margin:0;background:transparent"><canvas id="c" width="${LAYOUT.width}" height="${LAYOUT.height}"></canvas><script>${overlayScript(state)}</script></body></html>`);
    await page.evaluate(`Promise.all([400, 600, 700].map((w) => document.fonts.load(w + ' 48px Inter')))`);
    if (!(await page.evaluate(`[400, 600, 700].every((w) => document.fonts.check(w + ' 48px Inter'))`))) throw new RefreshRateStoryError("Inter did not load; refusing to render in a fallback font.");
    for (let index = 0; index < count; index += 1) {
      const url = await page.evaluate(`window.renderAt(${(index / FPS).toFixed(4)})`) as string;
      await writeFile(join(framesDir, `o-${String(index).padStart(4, "0")}.png`), Buffer.from(url.split(",")[1], "base64"));
    }
    const measured = await page.evaluate("window.measured()") as { minPx: number; misfits: string[] };
    if (measured.misfits.length) throw new RefreshRateStoryError(`Text does not fit at a readable size: ${[...new Set(measured.misfits)].join(" | ")}`);
    minTextPx = measured.minPx;
  } finally {
    await session.close();
  }
  if (minTextPx < MIN_TEXT_PX) throw new RefreshRateStoryError(`Smallest type is ${minTextPx}px, under ${MIN_TEXT_PX}px.`);

  // 3. Composite, with a silent stereo track so every platform accepts the file.
  const videoPath = join(outputDir, "refresh-rate-silent-edit.mp4");
  await run("ffmpeg", ["-v", "error", "-y", "-i", storyPath, "-framerate", String(FPS), "-i", join(framesDir, "o-%04d.png"),
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]", "-map", "[v]", "-map", "2:a",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-c:a", "aac", "-b:a", "128k", "-t", duration.toFixed(3), "-movflags", "+faststart", videoPath]);

  // 4. Phone-size frames: the middle of every shot, plus frame one and the last second.
  const seconds = [0, ...placed.map(({ start, end }) => (start + end) / 2), duration - 0.5];
  const keyFrames: { second: number; path: string }[] = [];
  for (const second of seconds) {
    const path = join(outputDir, `phone-${second.toFixed(2).replace(".", "_")}s.png`);
    await run("ffmpeg", ["-v", "error", "-y", "-ss", second.toFixed(3), "-i", videoPath, "-frames:v", "1", "-vf", "scale=360:640:flags=lanczos", path]);
    keyFrames.push({ second, path });
  }
  const contactSheet = join(outputDir, "phone-sheet.png");
  const perRow = Math.min(keyFrames.length, 6);
  await run("ffmpeg", ["-v", "error", "-y", ...keyFrames.flatMap((frame) => ["-i", frame.path]),
    "-filter_complex", `${keyFrames.map((_, i) => `[${i}:v]pad=372:652:6:6:color=0x2A2A33[p${i}]`).join(";")};${keyFrames.map((_, i) => `[p${i}]`).join("")}xstack=inputs=${keyFrames.length}:layout=${keyFrames.map((_, i) => `${(i % perRow) * 372}_${Math.floor(i / perRow) * 652}`).join("|")}:fill=0x0A0A0F`,
    "-frames:v", "1", contactSheet]);
  await rm(work, { recursive: true, force: true });

  const report: RecordingEditReport = {
    label: options.label ?? "SILENT EDIT from the owner's screen recording. Not voiced, not approved, not for publication.",
    video: { path: videoPath, sha256: sha256(await readFile(videoPath)), durationSeconds: duration, width: LAYOUT.width, height: LAYOUT.height, fps: FPS, audio: "silent" },
    recording: { ...edit.recording, verifiedSha256: true },
    evidence,
    editSha256: sha256(Buffer.from(JSON.stringify(edit))),
    shots: placed.map(({ segment, start, end }) => ({
      shot: segment.shot, start, end, source: `${segment.sourceStart.toFixed(2)}–${segment.sourceEnd.toFixed(2)} s`,
      scale: Number(scaleOf(segment.crop).toFixed(3)), valuePx: Math.round(segment.value.h * scaleOf(segment.crop)),
      caption: segment === edit.segments.at(-1) ? edit.closingCaption : segment.caption,
      demoLabel: segment.shot === "demo-low" ? demoLabel(segment.value.hz) : null,
    })),
    minTextPx,
    keyFrames,
    contactSheet,
  };
  await writeFile(join(outputDir, "edit-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const editPath = process.argv[2];
  if (!editPath) {
    console.error("Usage: recordingEdit.ts <edit.json>. Write edit.json after watching the recording; see RECORDING_CHECKLIST.md.");
    process.exitCode = 1;
  } else {
    readFile(editPath, "utf8").then((text) => renderRecordingEdit(JSON.parse(text) as RecordingEdit)).then((report) => {
      console.log(report.label);
      console.log(`video: ${report.video.path} (${report.video.durationSeconds.toFixed(2)} s, silent)`);
      console.log(`sha256: ${report.video.sha256}`);
      for (const shot of report.shots) console.log(`  ${shot.start.toFixed(2)}–${shot.end.toFixed(2)} ${shot.shot}: ${shot.caption}${shot.demoLabel ? ` [${shot.demoLabel}]` : ""} (value ${shot.valuePx}px)`);
      console.log(`contact sheet: ${report.contactSheet}`);
    }).catch((error) => { console.error(error); process.exitCode = 1; });
  }
}
