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
  MOTION_LABELS,
  MOTION_MIN_LABEL_PX,
  MOTION_MIN_PRIMARY_PX,
  PERCENT_CHANGE_LAYOUT,
  SPECSMITH_MOTION_COLOURS,
  verticalOverflow,
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
const LABELS = ${JSON.stringify(MOTION_LABELS)};
const LAYOUT = ${JSON.stringify(PERCENT_CHANGE_LAYOUT)};
const MIN_PRIMARY = ${MOTION_MIN_PRIMARY_PX}, MIN_LABEL = ${MOTION_MIN_LABEL_PX};
const FONT = ${JSON.stringify(MOTION_FONT)};
const W = S.width, H = S.height, G = S.graphic;
const PALETTE = [C.accent, C.cyan, C.green];
// One colour per game for the whole video (assigned across the concept by the
// proposal pass), whatever order or company a scene shows it in.
const GAME_COLOURS = G.games.map((g, i) => PALETTE[(g.colour ?? i) % PALETTE.length]);
const canvas = document.getElementById('c'); const ctx = canvas.getContext('2d');
const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const measured = { minFontPx: Infinity, misfits: [], overflow: [] };

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
  // Drawn past the band's bottom edge (descenders included) is drawn off screen.
  const descent = ctx.measureText(s).actualBoundingBoxDescent || 0;
  if (y + descent + ctx.getTransform().f > H) measured.overflow.push(s);
  ctx.fillText(s, x, y);
  return size;
}
function rect(x, y, w, h, r, color) {
  if (y + h + ctx.getTransform().f > H) measured.overflow.push('shape at y=' + Math.round(y));
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
  // Full names and what is being compared. No empty tracks, no placeholder
  // figures: those read as data that is missing.
  for (const r of rows()) {
    const dx = card(r, t);
    text(r.game.name, PAD + 56 + dx, r.y + r.h * 0.5, INNER - 112, 112, MIN_PRIMARY, C.text, 'left', 'bold');
    text('estimated % boost · ' + G.setting, PAD + 56 + dx, r.y + r.h * 0.78, INNER - 112, 46, MIN_LABEL, r.colour === C.accent ? C.accentText : r.colour, 'left', 'bold');
  }
}

// Only approved values ever appear: a figure is shown at its final value or
// not at all. No count-ups, which would flash numbers no claim states.
function fpsChange(t) {
  for (const r of rows()) {
    const dx = card(r, t);
    text(r.game.name, PAD + 56 + dx, r.y + r.h * 0.30, INNER - 112, 88, MIN_PRIMARY, r.colour === C.accent ? C.text : C.text, 'left', 'bold');
    const delay = r.i * 0.25;
    const size = fit(r.game.before + '  →  ' + r.game.after, INNER - 112, 120, MIN_PRIMARY, 'bold');
    ctx.font = 'bold ' + size + 'px "' + FONT + '"';
    const beforeW = ctx.measureText(r.game.before + '  ').width, arrowW = ctx.measureText('→  ').width;
    const x0 = PAD + 56 + dx, by = r.y + r.h * 0.66;
    ctx.textAlign = 'left'; ctx.fillStyle = C.textSecondary; ctx.fillText(String(r.game.before), x0, by);
    const arrow = ease((t - 0.3 - delay) / 0.35);
    ctx.save(); ctx.globalAlpha = arrow; ctx.fillStyle = r.colour; ctx.fillText('→', x0 + beforeW, by); ctx.restore();
    const after = ease((t - 0.6 - delay) / 0.35);
    ctx.save(); ctx.globalAlpha = after; ctx.fillStyle = r.colour; ctx.fillText(String(r.game.after), x0 + beforeW + arrowW + 30 * (1 - after), by); ctx.restore();
    measured.minFontPx = Math.min(measured.minFontPx, size);
    text(LABELS.fps, PAD + 56 + dx, r.y + r.h * 0.88, INNER - 112, 40, MIN_LABEL, C.textSecondary, 'left', 'normal');
  }
}

/**
 * The percentage comparison. Each card keeps the game's estimated FPS result
 * beside its percentage, so the viewer sees what the percentage is OF, and
 * the formula from the two displayed (rounded) estimates.
 *   reveal   cards, names and results from frame 0; bars grow, percentages appear
 *   explain  everything settled from frame 0; the fixed explanation fades in
 *   ask      everything settled; the question and the link line fade in
 * The cards sit in the same place in every stage, so the cut between stages
 * changes only the line underneath.
 */
const CARD_H = LAYOUT.cardHeight, CARD_GAP = LAYOUT.cardGap, CARD_TOP = LAYOUT.cardTop;
function percentChange(t) {
  const maxPercent = Math.max(...G.games.map((g) => g.percent), 1);
  const settled = G.stage && G.stage !== 'reveal';
  const tt = settled ? 99 : t;
  const x0 = PAD + 48, x1 = PAD + INNER - 48, inner = x1 - x0;
  G.games.forEach((game, i) => {
    const y = CARD_TOP + i * (CARD_H + CARD_GAP), h = CARD_H, colour = GAME_COLOURS[i];
    const ink = colour === C.accent ? C.accentText : colour;
    rect(PAD, y, INNER, h, 28, C.card);
    rect(PAD, y, 14, h, 7, colour);
    text(game.name, x0, y + 78, inner, 80, MIN_PRIMARY, C.text, 'left', 'bold');
    // The estimated result, top right: what the percentage is a boost of.
    const result = game.before + ' → ' + game.after;
    text(result, x1, y + 180, inner * 0.5, 64, MIN_PRIMARY, C.text, 'right', 'bold');
    text(LABELS.fps, x1, y + 222, inner * 0.5, 36, MIN_LABEL, C.textSecondary, 'right', 'normal');
    // The bar grows (a length, not a stated figure); the percentage appears only at its value.
    const delay = i * 0.25;
    const grow = ease((tt - 0.2 - delay) / 0.7);
    rect(x0, y + 104, inner, 20, 10, C.surface);
    rect(x0, y + 104, inner * (game.percent / maxPercent) * grow, 20, 10, colour);
    const shown = ease((tt - 0.8 - delay) / 0.3);
    ctx.save(); ctx.globalAlpha = shown;
    text('+' + game.percent + '%', x0 + 24 * (1 - shown), y + 214, inner * 0.45, 104, MIN_PRIMARY, ink, 'left', 'bold');
    ctx.restore();
    text(LABELS.percent, x0, y + 266, inner, 36, MIN_LABEL, ink, 'left', 'bold');
    text(game.formula + ' · rounded estimates', x0, y + 310, inner, 34, MIN_LABEL, C.textSecondary, 'left', 'normal');
  });
  if (!G.note) return;
  // The stage's one line, under the cards. It is the only thing that moves.
  const top = CARD_TOP + G.games.length * (CARD_H + CARD_GAP) + LAYOUT.noteGap;
  const p = ease(t / 0.4);
  ctx.save(); ctx.globalAlpha = p; ctx.translate(0, LAYOUT.noteRise * (1 - p));
  // Two sentences read as two statements, one per line; a single sentence wraps.
  let rowsOut, size;
  if (G.note.lines.length > 1) {
    size = Math.min(...G.note.lines.map((line) => fit(line, INNER, LAYOUT.noteMaxPx, MIN_PRIMARY, 'bold')));
    rowsOut = G.note.lines;
  } else {
    const head = layoutHeadline(G.note.lines[0], INNER, 2, LAYOUT.noteMaxPx, MIN_PRIMARY);
    size = head ? head.size : MIN_PRIMARY;
    rowsOut = head ? head.lines.map((line) => line.map((w) => w.word).join(' ')) : G.note.lines;
  }
  const lineH = Math.round(size * LAYOUT.noteLineFactor);
  let y = top;
  rowsOut.forEach((line, i) => {
    y = top + size + i * lineH;
    text(line, PAD, y, INNER, size, MIN_PRIMARY, C.text, 'left', 'bold');
  });
  if (G.note.link) text(G.note.link, PAD, y + LAYOUT.linkOffset, INNER, LAYOUT.linkMaxPx, MIN_LABEL, C.accentText, 'left', 'bold');
  ctx.restore();
}

/** Word-wrapped headline at the largest size that fits in maxLines; returns laid-out words. */
function layoutHeadline(s, maxWidth, maxLines, max, min) {
  const words = s.split(' ');
  for (let size = max; size >= min; size -= 2) {
    ctx.font = 'bold ' + size + 'px "' + FONT + '"';
    const space = ctx.measureText(' ').width;
    const lines = [[]]; let width = 0, ok = true;
    for (const word of words) {
      const w = ctx.measureText(word).width;
      if (w > maxWidth) { ok = false; break; }
      if (width > 0 && width + space + w > maxWidth) { lines.push([]); width = 0; }
      lines[lines.length - 1].push({ word, w });
      width += (width > 0 ? space : 0) + w;
    }
    if (ok && lines.length <= maxLines) return { size, space, lines };
  }
  measured.misfits.push(s);
  return null;
}
const mix = (a, b, p) => {
  const h = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const x = h(a), y = h(b);
  return 'rgb(' + x.map((v, i) => Math.round(v + (y[i] - v) * clamp(p))).join(',') + ')';
};
/**
 * The opening. From frame 0: the question, and both games as large panels.
 * Between them, the upgrade plays once as a compact row and is finished by
 * 0.8 s. Every movement is part of the question arriving.
 *   0.00-0.80  RTX 4060 dims, the arrow draws, RTX 5070 slides in and lands
 *   0.90-1.50  each panel gains its label, in turn
 *   1.50-1.90  the question's key words take the accent
 */
function upgradeIntro(t) {
  const head = layoutHeadline(G.headline, INNER, 3, 84, MIN_PRIMARY);
  let y = 0;
  if (head) {
    const lineH = Math.round(head.size * 1.16);
    const key = new Set(['bigger', 'percentage', 'boost?', 'boost']);
    const p = ease((t - 1.5) / 0.4);
    head.lines.forEach((line, i) => {
      let x = PAD; y = 40 + head.size + i * lineH;
      for (const { word, w } of line) {
        ctx.font = 'bold ' + head.size + 'px "' + FONT + '"';
        ctx.fillStyle = key.has(word.toLowerCase()) ? mix(C.text, C.accentText, p) : C.text;
        ctx.textAlign = 'left'; ctx.fillText(word, x, y);
        x += w + head.space;
      }
    });
    measured.minFontPx = Math.min(measured.minFontPx, head.size);
  }

  // The upgrade, as one compact row.
  const rowY = y + 100, oldName = G.beforeGpu.name, newName = G.afterGpu.name;
  const size = fit(oldName + '  →  ' + newName, INNER, 60, MIN_LABEL, 'bold');
  ctx.font = 'bold ' + size + 'px "' + FONT + '"';
  const oldW = ctx.measureText(oldName).width, gap = size * 0.5, arrowW = size * 1.6;
  measured.minFontPx = Math.min(measured.minFontPx, size);
  const dim = ease((t - 0.25) / 0.45);
  ctx.fillStyle = mix(C.text, C.textSecondary, dim); ctx.textAlign = 'left'; ctx.fillText(oldName, PAD, rowY);
  const draw = ease((t - 0.05) / 0.4);
  const ax0 = PAD + oldW + gap, ax1 = ax0 + arrowW, ay = rowY - size * 0.34;
  ctx.strokeStyle = C.accent; ctx.lineWidth = Math.max(6, size / 9); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(ax0, ay); ctx.lineTo(ax0 + arrowW * draw, ay); ctx.stroke();
  if (draw > 0.8) { ctx.beginPath(); ctx.moveTo(ax1, ay); ctx.lineTo(ax1 - size * 0.32, ay - size * 0.3); ctx.moveTo(ax1, ay); ctx.lineTo(ax1 - size * 0.32, ay + size * 0.3); ctx.stroke(); }
  const land = ease((t - 0.2) / 0.6);
  ctx.save(); ctx.globalAlpha = 0.35 + 0.65 * land;
  ctx.fillStyle = mix(C.textSecondary, C.accentText, land);
  ctx.fillText(newName, ax1 + gap + 40 * (1 - land), rowY);
  ctx.restore();
  text('Same ' + G.beforeCpu.name + ' · ' + G.setting, PAD, rowY + 58, INNER, 42, MIN_LABEL, C.textSecondary, 'left', 'normal');

  // Both games, large, from frame 0.
  const top = rowY + 110, gapY = 40, n = G.games.length;
  const h = Math.min(400, (H - 50 - top - (n - 1) * gapY) / n);
  G.games.forEach((game, i) => {
    const py = top + i * (h + gapY);
    rect(PAD, py, INNER, h, 30, C.card);
    rect(PAD, py, 18, h, 9, GAME_COLOURS[i]);
    text(game.name, PAD + 64, py + h * 0.5, INNER - 128, 124, MIN_PRIMARY, C.text, 'left', 'bold');
    const label = ease((t - 0.9 - i * 0.25) / 0.35);
    if (label > 0) {
      ctx.save(); ctx.globalAlpha = label;
      text('estimated % boost · ' + G.setting, PAD + 64 + 30 * (1 - label), py + h * 0.8, INNER - 128, 46, MIN_LABEL, GAME_COLOURS[i] === C.accent ? C.accentText : GAME_COLOURS[i], 'left', 'bold');
      ctx.restore();
    }
  });
}

window.renderAt = (t) => {
  ctx.fillStyle = C.background; ctx.fillRect(0, 0, W, H);
  if (G.template === 'upgrade-intro') { upgradeIntro(t); return canvas.toDataURL('image/png'); }
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
  // Refused before a frame is drawn: the layout is known from the values alone.
  const overflow = verticalOverflow(state.graphic, state.height);
  if (overflow) throw new DataMotionGraphicError(overflow);
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
    const measured = await page.evaluate("window.measured()") as { minFontPx: number; misfits: string[]; overflow: string[] };
    if (measured.overflow.length) {
      throw new DataMotionGraphicError(`Drawn past the bottom of the ${state.height}px band: ${[...new Set(measured.overflow)].join(" | ")}. Show fewer games.`);
    }
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
        // A scene that animates in must never restart if its beat is held longer.
        metadata: { renderer: "specsmith-data-motion-graphic", holdLastFrame: true, sha256: rendered.sha256, frames: rendered.frames, minFontPx: rendered.minFontPx, valuesSha256: rendered.valuesSha256 },
      }];
    },
  };
}
