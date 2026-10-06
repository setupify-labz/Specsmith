// Renders a data motion graphic (dataMotionGraphic.ts) to a video clip.
//
// A render adapter like the others: the production plan gives the task a
// `dataMotionGraphicState` (the RESOLVED graphic, its duration and the band
// size); this draws every frame as a pure function of time on a canvas in a
// real browser, then encodes with ffmpeg. Same inputs, same frames.
//
// Readability is measured, not assumed: every string is fitted to its slot at
// a size no smaller than MOTION_MIN_PRIMARY_PX (names, figures) or
// MOTION_MIN_LABEL_PX (labels). A string that does not fit at the minimum
// fails the render rather than shrinking into illegibility or being cut.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { launchBrowser } from "../../uiRender/capture.ts";
import type { RenderAdapter, RenderArtifact, RenderTaskContext } from "../../rendering.ts";
import {
  DataMotionGraphicError,
  MOTION_MIN_LABEL_PX,
  MOTION_MIN_PRIMARY_PX,
  SPECSMITH_MOTION_COLOURS,
  type ResolvedDataMotionGraphic,
} from "./dataMotionGraphic.ts";

export interface DataMotionGraphicState {
  readonly graphic: ResolvedDataMotionGraphic;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
}

export const MOTION_FPS = 30;
export const MOTION_FONT = "DejaVu Sans";

export function parseDataMotionGraphicState(input: unknown): DataMotionGraphicState {
  const raw = input as Partial<DataMotionGraphicState> | null;
  const graphic = raw?.graphic;
  if (!raw || !graphic || !Array.isArray(graphic.games) || graphic.games.length === 0) {
    throw new DataMotionGraphicError("dataMotionGraphicState needs a resolved graphic; values are never guessed.");
  }
  for (const game of graphic.games) {
    if (typeof game.name !== "string" || !game.name || ![game.before, game.after, game.percent].every(Number.isFinite)) {
      throw new DataMotionGraphicError(`Resolved graphic ${graphic.visualId} carries an incomplete game.`);
    }
  }
  const { durationSeconds, width, height } = raw;
  if (!Number.isFinite(durationSeconds) || durationSeconds! <= 0 || !Number.isInteger(width) || !Number.isInteger(height) || width! <= 0 || height! <= 0) {
    throw new DataMotionGraphicError("dataMotionGraphicState needs a positive duration and whole-pixel size.");
  }
  return raw as DataMotionGraphicState;
}

/** The drawing code, run in the page. Pure in `t`: no clocks, no randomness. */
function pageScript(state: DataMotionGraphicState): string {
  return `
const S = ${JSON.stringify(state)};
const C = ${JSON.stringify(SPECSMITH_MOTION_COLOURS)};
const GAME_COLOURS = [C.accent, C.cyan, C.green];
const MIN_PRIMARY = ${MOTION_MIN_PRIMARY_PX}, MIN_LABEL = ${MOTION_MIN_LABEL_PX};
const FONT = ${JSON.stringify(MOTION_FONT)};
const W = S.width, H = S.height, G = S.graphic;
const canvas = document.getElementById('c'); const ctx = canvas.getContext('2d');
const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const measured = { minFontPx: Infinity, misfits: [] };

/** Largest size in [min, max] at which s fits maxWidth. Records a misfit if none does. */
function fit(s, maxWidth, max, min, weight) {
  for (let size = max; size >= min; size -= 2) {
    ctx.font = weight + ' ' + size + 'px "' + FONT + '"';
    if (ctx.measureText(s).width <= maxWidth) return size;
  }
  measured.misfits.push(s);
  return min;
}
function text(s, x, y, maxWidth, max, min, color, align, weight) {
  weight = weight || 'bold';
  const size = fit(s, maxWidth, max, min, weight);
  measured.minFontPx = Math.min(measured.minFontPx, size);
  ctx.font = weight + ' ' + size + 'px "' + FONT + '"';
  ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
  return size;
}
function rect(x, y, w, h, r, color) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, Math.max(0, w), h, Math.min(r, Math.max(0, w) / 2, h / 2)); ctx.fill();
}

const PAD = 72, INNER = W - 2 * PAD;
function context() {
  text('SpecSmith model estimates · ' + G.setting, PAD, 96, INNER, 40, MIN_LABEL, C.accentText, 'left', 'bold');
  text(G.beforeBuild + '  →  ' + G.afterBuild.replace(/ \\+ .*/, ''), PAD, 150, INNER, 36, MIN_LABEL, C.textSecondary, 'left', 'normal');
}

/** Row geometry: the games share the band below the context lines. */
function rows() {
  const top = 220, bottom = H - 60, n = G.games.length;
  const h = Math.min(400, (bottom - top - (n - 1) * 40) / n);
  const total = n * h + (n - 1) * 40;
  const y0 = top + (bottom - top - total) / 2;
  return G.games.map((game, i) => ({ game, i, y: y0 + i * (h + 40), h, colour: GAME_COLOURS[i] }));
}

function card(r, t) {
  // Already readable on frame 0: the card starts 48px off its place, fully opaque.
  const p = ease((t - r.i * 0.12) / 0.45);
  const dx = (r.i % 2 === 0 ? -1 : 1) * 48 * (1 - p);
  ctx.save(); ctx.translate(dx, 0);
  rect(PAD, r.y, INNER, r.h, 28, C.card);
  rect(PAD, r.y, 14, r.h, 7, r.colour);
  ctx.restore();
  return dx;
}

function gameLabels(t) {
  for (const r of rows()) {
    const dx = card(r, t);
    text(r.game.name, PAD + 56 + dx, r.y + r.h * 0.42, INNER - 112, 104, MIN_PRIMARY, C.text, 'left', 'bold');
    // An empty track and a question mark: what the video will answer, no figure yet.
    const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 / 1.2));
    rect(PAD + 56 + dx, r.y + r.h * 0.62, INNER - 260, 36, 18, C.surface);
    ctx.save(); ctx.globalAlpha = pulse;
    text('+?%', PAD + INNER - 48 + dx, r.y + r.h * 0.62 + 34, 180, 64, MIN_PRIMARY, r.colour, 'right', 'bold');
    ctx.restore();
    text('estimated boost', PAD + 56 + dx, r.y + r.h * 0.62 + 92, INNER - 112, 36, MIN_LABEL, C.textSecondary, 'left', 'normal');
  }
}

function fpsChange(t) {
  for (const r of rows()) {
    const dx = card(r, t);
    text(r.game.name, PAD + 56 + dx, r.y + r.h * 0.30, INNER - 112, 88, MIN_PRIMARY, C.text, 'left', 'bold');
    const p = ease((t - 0.35 - r.i * 0.2) / 1.0);
    const shown = Math.round(r.game.before + (r.game.after - r.game.before) * p);
    text(r.game.before + '  →  ' + shown, PAD + 56 + dx, r.y + r.h * 0.66, INNER - 112, 120, MIN_PRIMARY, r.colour, 'left', 'bold');
    text('Estimated FPS', PAD + 56 + dx, r.y + r.h * 0.88, INNER - 112, 40, MIN_LABEL, C.textSecondary, 'left', 'normal');
  }
}

function percentChange(t) {
  const maxPercent = Math.max(...G.games.map((g) => g.percent), 1);
  for (const r of rows()) {
    const dx = card(r, t);
    text(r.game.name, PAD + 56 + dx, r.y + r.h * 0.26, INNER - 112, 88, MIN_PRIMARY, C.text, 'left', 'bold');
    const p = ease((t - 0.35 - r.i * 0.25) / 1.1);
    const track = INNER - 112;
    rect(PAD + 56 + dx, r.y + r.h * 0.38, track, 44, 22, C.surface);
    rect(PAD + 56 + dx, r.y + r.h * 0.38, track * 0.72 * (r.game.percent / maxPercent) * p, 44, 22, r.colour);
    text('+' + Math.round(r.game.percent * p) + '%', PAD + 56 + dx, r.y + r.h * 0.77, INNER - 112, 120, MIN_PRIMARY, r.colour, 'left', 'bold');
    text('estimated boost · ' + r.game.formula, PAD + 56 + dx, r.y + r.h * 0.93, INNER - 112, 38, MIN_LABEL, C.textSecondary, 'left', 'normal');
  }
}

window.renderAt = (t) => {
  ctx.fillStyle = C.background; ctx.fillRect(0, 0, W, H);
  context();
  if (G.template === 'game-labels') gameLabels(t);
  else if (G.template === 'fps-change') fpsChange(t);
  else if (G.template === 'percent-change') percentChange(t);
  else throw new Error('Unknown template ' + G.template);
  return canvas.toDataURL('image/png');
};
window.measured = () => measured;
`;
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    const err: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited ${code}: ${Buffer.concat(err).toString("utf8").slice(-600)}`)));
  });
}

export interface DataMotionGraphicRender {
  readonly path: string;
  readonly sha256: string;
  readonly frames: number;
  /** The smallest type actually drawn, in frame pixels. */
  readonly minFontPx: number;
  readonly valuesSha256: string;
}

/** Draws the graphic and encodes it. Refuses if any string misses its readable size. */
export async function renderDataMotionGraphic(input: unknown, outputPath: string, workDir: string): Promise<DataMotionGraphicRender> {
  const state = parseDataMotionGraphicState(input);
  const framesDir = join(workDir, `frames-${state.graphic.visualId}`);
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  const session = await launchBrowser({ width: state.width, height: state.height, deviceScaleFactor: 1 });
  let minFontPx = Infinity;
  const count = Math.round(state.durationSeconds * MOTION_FPS);
  try {
    const page = await session.context.newPage();
    await page.setContent(`<!doctype html><html><body style="margin:0;background:${SPECSMITH_MOTION_COLOURS.background}"><canvas id="c" width="${state.width}" height="${state.height}"></canvas><script>${pageScript(state)}</script></body></html>`);
    await page.evaluate("document.fonts.ready");
    for (let index = 0; index < count; index += 1) {
      const url = await page.evaluate(`window.renderAt(${(index / MOTION_FPS).toFixed(4)})`) as string;
      await writeFile(join(framesDir, `f-${String(index).padStart(4, "0")}.png`), Buffer.from(url.split(",")[1], "base64"));
    }
    const measured = await page.evaluate("window.measured()") as { minFontPx: number; misfits: string[] };
    if (measured.misfits.length) {
      throw new DataMotionGraphicError(`Text does not fit at a readable size: ${[...new Set(measured.misfits)].join(" | ")}. Use fewer games or a shorter template.`);
    }
    minFontPx = measured.minFontPx;
  } finally {
    await session.close();
  }
  if (minFontPx < MOTION_MIN_LABEL_PX) throw new DataMotionGraphicError(`Smallest type ${minFontPx}px is under ${MOTION_MIN_LABEL_PX}px.`);
  await run("ffmpeg", ["-v", "error", "-y", "-framerate", String(MOTION_FPS), "-i", join(framesDir, "f-%04d.png"),
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-t", state.durationSeconds.toFixed(3), outputPath]);
  await rm(framesDir, { recursive: true, force: true });
  const bytes = await readFile(outputPath);
  return {
    path: outputPath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    frames: count,
    minFontPx,
    valuesSha256: createHash("sha256").update(JSON.stringify(state.graphic)).digest("hex"),
  };
}

/** The production render adapter for the "data-motion-graphic" capability. */
export function createDataMotionGraphicAdapter(options: { outputDir: string }): RenderAdapter {
  return {
    name: "specsmith-data-motion-graphic",
    capability: "data-motion-graphic",
    async render(context: RenderTaskContext): Promise<RenderArtifact[]> {
      const raw = (context.task as { dataMotionGraphicState?: unknown }).dataMotionGraphicState;
      if (raw === undefined) throw new DataMotionGraphicError(`Task ${context.task.taskId} has no dataMotionGraphicState; values are never guessed.`);
      await mkdir(options.outputDir, { recursive: true });
      const rendered = await renderDataMotionGraphic(raw, join(options.outputDir, `${context.task.taskId}__motion.mp4`), options.outputDir);
      return [{
        artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-motion`,
        taskId: context.task.taskId,
        kind: "video",
        uri: `file://${rendered.path}`,
        mimeType: "video/mp4",
        metadata: { renderer: "specsmith-data-motion-graphic", sha256: rendered.sha256, frames: rendered.frames, minFontPx: rendered.minFontPx, valuesSha256: rendered.valuesSha256 },
      }];
    },
  };
}
