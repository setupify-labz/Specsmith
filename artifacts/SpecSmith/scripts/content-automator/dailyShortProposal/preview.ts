// The silent preview: a storyboard animatic of the proposal, 1080x1920, one card
// per beat at the beat's own timing. It is a plan to look at, not the Short:
// every frame says "STORYBOARD PREVIEW · NOT FINAL ART" under the illustration
// disclosure, the visual direction is written out rather than drawn, and the
// caption band carries the proposed narration, labelled as not voiced.
//
// Rendered the way the other Shorts are (uiRender/capture.ts launchBrowser into a
// canvas, Inter embedded, ffmpeg to H.264 with a silent track). If Chromium,
// ffmpeg or the fonts are missing it fails with "renderer-unavailable" and says
// which; it never falls back to a different renderer.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launchBrowser } from "../uiRender/capture.ts";
import { SPECSMITH_MOTION_COLOURS } from "../v2/creative/dataMotionGraphic.ts";
import type { PlatformScriptStoryboard } from "../types.ts";
import { DailyProposalError } from "./snapshot.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = resolve(here, "../nextVideoRefreshRate/fonts");
const FONT_FILES = { 400: "inter-latin-400-normal.woff2", 700: "inter-latin-700-normal.woff2" } as const;
export const PREVIEW_FPS = 30;
export const PREVIEW_LABEL = "STORYBOARD PREVIEW · NOT FINAL ART";

function run(command: string, args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    const err: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error) => fail(error));
    child.on("close", (code) => code === 0 ? done() : fail(new Error(`${command} exited ${code}: ${Buffer.concat(err).toString("utf8").slice(-400)}`)));
  });
}

/** Fails clearly if any part of the renderer is missing. */
export async function assertRendererAvailable(): Promise<void> {
  try {
    await run("ffmpeg", ["-version"]);
  } catch (error) {
    throw new DailyProposalError("renderer-unavailable", `ffmpeg is not available (${(error as Error).message}). Install ffmpeg; no other encoder is substituted.`);
  }
  for (const file of Object.values(FONT_FILES)) {
    try { await access(join(FONT_DIR, file)); } catch { throw new DailyProposalError("renderer-unavailable", `The Inter font ${file} is missing from ${FONT_DIR}.`); }
  }
  const executable = process.env.SPECSMITH_RENDER_CHROMIUM;
  if (executable) {
    try { await access(executable); } catch { throw new DailyProposalError("renderer-unavailable", `SPECSMITH_RENDER_CHROMIUM points to ${executable}, which does not exist.`); }
  }
}

function pageScript(state: unknown): string {
  return `
const S = ${JSON.stringify(state)}; const C = S.colours, W = 1080, H = 1920;
const canvas = document.getElementById('c'); const ctx = canvas.getContext('2d');
let minPx = Infinity; const misfits = [];
function fit(s, maxWidth, max, min, weight) { let size = max; for (; size >= min; size -= 1) { ctx.font = weight + ' ' + size + 'px Inter'; if (ctx.measureText(s).width <= maxWidth) break; } if (size < min) { size = min; misfits.push(s); } ctx.font = weight + ' ' + size + 'px Inter'; minPx = Math.min(minPx, size); return size; }
function wrap(s, maxWidth, size, weight) { ctx.font = weight + ' ' + size + 'px Inter'; const words = s.split(' '); const lines = []; let line = ''; for (const w of words) { const next = line ? line + ' ' + w : w; if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = w; } else line = next; } if (line) lines.push(line); minPx = Math.min(minPx, size); return lines; }
function text(s, x, y, colour, align) { ctx.fillStyle = colour; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y); }
function rr(x, y, w, h, r, fill, stroke) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 4; ctx.stroke(); } }
window.renderAt = (t) => {
  const beats = S.storyboard.beats; let i = beats.findIndex((b) => t >= b.startSecond && t < b.endSecond); if (i < 0) i = beats.length - 1;
  const b = beats[i], fade = Math.min(1, (t - b.startSecond) / 0.2);
  ctx.fillStyle = C.background; ctx.fillRect(0, 0, W, H);
  // Disclosure band and preview label, on every frame.
  ctx.fillStyle = C.surface; ctx.fillRect(0, 0, W, 250);
  ctx.font = '700 44px Inter'; const bw = ctx.measureText(S.disclosures[0]).width + 60; rr((W - bw) / 2, 30, bw, 76, 38, C.amber);
  fit(S.disclosures[0], bw, 44, 44, 700); text(S.disclosures[0], W / 2, 69, '#0A0A0F');
  fit(S.disclosures[1], W - 100, 42, 42, 700); text(S.disclosures[1], W / 2, 145, C.text);
  fit(S.label, W - 100, 42, 42, 700); text(S.label, W / 2, 210, C.cyan);
  ctx.save(); ctx.globalAlpha = fade;
  // Beat header.
  fit('BEAT ' + (i + 1) + ' / ' + beats.length + ' · ' + b.startSecond.toFixed(1) + '–' + b.endSecond.toFixed(1) + ' s · ' + b.purpose.toUpperCase(), W - 120, 44, 42, 700);
  text('BEAT ' + (i + 1) + ' / ' + beats.length + ' · ' + b.startSecond.toFixed(1) + '–' + b.endSecond.toFixed(1) + ' s · ' + b.purpose.toUpperCase(), W / 2, 320, C.textSecondary);
  // The on-screen text as it would appear.
  rr(60, 380, W - 120, 330, 28, '#16161F', i === 0 ? C.amber : C.accentText);
  fit(i === 0 ? 'FRAME ONE' : 'ON SCREEN', W - 200, 42, 42, 700); text(i === 0 ? 'FRAME ONE' : 'ON SCREEN', W / 2, 430, i === 0 ? C.amber : C.accentText);
  const size = fit(b.onScreenText, W - 200, 96, 52, 700); text(b.onScreenText, W / 2, 560, C.text);
  // The visual direction, written out.
  rr(60, 760, W - 120, 720, 28, '#121219', '#2E2E3A');
  fit('VISUAL (TO BE ANIMATED)', W - 200, 42, 42, 700); text('VISUAL (TO BE ANIMATED)', W / 2, 810, C.textSecondary);
  wrap(b.visualDirection, W - 220, 50, 400).slice(0, 10).forEach((line, k) => text(line, W / 2, 890 + k * 64, C.text));
  ctx.restore();
  // Caption band: proposed narration.
  ctx.fillStyle = C.surface; ctx.fillRect(0, 1530, W, 390);
  fit('PROPOSED NARRATION · NOT VOICED', W - 120, 42, 42, 700); text('PROPOSED NARRATION · NOT VOICED', W / 2, 1585, C.textSecondary);
  ctx.save(); ctx.globalAlpha = fade; wrap(b.narration, W - 140, 66, 700).slice(0, 3).forEach((line, k) => text(line, W / 2, 1680 + k * 80, C.text)); ctx.restore();
  return canvas.toDataURL('image/png');
};
window.measured = () => ({ minPx, misfits });
`;
}

export async function renderPreview(storyboard: PlatformScriptStoryboard, disclosures: readonly string[], outputDir: string) {
  await assertRendererAvailable();
  const work = join(outputDir, "preview-work");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const faces: string[] = [];
  for (const [weight, file] of Object.entries(FONT_FILES)) faces.push(`@font-face{font-family:Inter;font-weight:${weight};src:url(data:font/woff2;base64,${(await readFile(join(FONT_DIR, file))).toString("base64")}) format('woff2');}`);
  const duration = storyboard.targetDurationSeconds, count = Math.round(duration * PREVIEW_FPS);
  let session;
  try {
    session = await launchBrowser({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  } catch (error) {
    throw new DailyProposalError("renderer-unavailable", `Chromium could not be launched (${(error as Error).message.split("\n")[0]}). Set SPECSMITH_RENDER_CHROMIUM or install Playwright's Chromium; no other renderer is substituted.`);
  }
  let measured: { minPx: number; misfits: string[] };
  try {
    const page = await session.context.newPage();
    await page.setContent(`<!doctype html><html><head><style>${faces.join("")}</style></head><body style="margin:0"><canvas id="c" width="1080" height="1920"></canvas><script>${pageScript({ colours: SPECSMITH_MOTION_COLOURS, storyboard, disclosures, label: PREVIEW_LABEL })}</script></body></html>`);
    await page.evaluate(`Promise.all([400, 700].map((w) => document.fonts.load(w + ' 48px Inter')))`);
    if (!(await page.evaluate(`[400, 700].every((w) => document.fonts.check(w + ' 48px Inter'))`))) throw new DailyProposalError("renderer-unavailable", "Inter did not load; refusing to render in a fallback font.");
    // Every frame rendered fresh, in index order: no cache keyed on strings that could collide.
    for (let index = 0; index < count; index += 1) {
      const url = await page.evaluate(`window.renderAt(${(index / PREVIEW_FPS).toFixed(4)})`) as string;
      await writeFile(join(work, `f-${String(index).padStart(4, "0")}.png`), Buffer.from(url.split(",")[1], "base64"));
    }
    measured = await page.evaluate("window.measured()") as { minPx: number; misfits: string[] };
  } finally {
    await session.close();
  }
  if (measured.misfits.length) throw new Error(`Preview text does not fit: ${[...new Set(measured.misfits)].join(" | ")}`);
  const videoPath = join(outputDir, "preview-silent.mp4");
  await run("ffmpeg", ["-v", "error", "-y", "-framerate", String(PREVIEW_FPS), "-i", join(work, "f-%04d.png"), "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-t", duration.toFixed(3), "-movflags", "+faststart", videoPath]);
  const sheetPath = join(outputDir, "preview-phone-sheet.png");
  await run("ffmpeg", ["-v", "error", "-y", "-i", videoPath, "-vf", `fps=2,scale=180:320:flags=lanczos,tile=${Math.ceil(duration * 2)}x1:padding=4:color=0x2A2A33`, "-frames:v", "1", sheetPath]);
  await rm(work, { recursive: true, force: true });
  return { videoPath, sheetPath, sha256: createHash("sha256").update(await readFile(videoPath)).digest("hex"), minFontPx: measured.minPx, durationSeconds: duration };
}
