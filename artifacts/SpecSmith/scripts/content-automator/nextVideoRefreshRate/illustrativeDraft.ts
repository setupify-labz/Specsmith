#!/usr/bin/env tsx
// The ILLUSTRATIVE visual draft of the refresh-rate Short (storyboard.ts).
//
// No real recording of a display offering 60 Hz and a higher rate exists here,
// so the Windows settings are recreated by drawing, and every frame says so in
// its own band. It is a draft for judging the story and the edit, never a
// verified recording: when real footage arrives it replaces the story band.
//
// Same approach as the data motion graphics (dataMotionGraphicRender.ts): each
// frame is a pure function of time drawn on a canvas in the pinned Chromium,
// then encoded with ffmpeg. The 9:16 frame keeps the production banded layout
// (bandedLayout.ts): label band, story band, caption band, nothing drawn over
// the story. Type is measured as drawn, after the crop's zoom, and the render
// refuses anything under MIN_FINAL_PX (readable at 360×640). Audio is the
// composed bed (musicBed.ts) alone, quiet; the narration is a proposal and is
// not voiced.
//
//   SPECSMITH_RENDER_CHROMIUM=/opt/pw-browsers/chromium \
//   pnpm exec tsx scripts/content-automator/nextVideoRefreshRate/illustrativeDraft.ts

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DISCLOSURE_BANDED_LAYOUT } from "../bandedLayout.ts";
import { measureLoudness } from "../motionCompositor.ts";
import { composeBed, MUSIC_BED, PROGRESSION, renderBed } from "../musicBed.ts";
import { launchBrowser } from "../uiRender/capture.ts";
import { SPECSMITH_MOTION_COLOURS } from "../v2/creative/dataMotionGraphic.ts";
import {
  captions, DURATION_SECONDS, FOOTAGE, FPS, higherRateLabel, ILLUSTRATIVE_LABEL, MICROSOFT_SOURCE, PAYOFF_NOTE,
  PROPOSED_NARRATION, PROPOSED_NARRATION_TEXT, RefreshRateStoryError, SITE_LINE, storyProblems,
} from "./storyboard.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const DRAFT_DIR = resolve(here, "../../../render-output/refresh-rate-illustrative-draft");
export const FONT_DIR = join(here, "fonts");
/** Smallest type drawn, in 1080-px frame pixels: 14 px on a 360×640 screen. */
export const MIN_FINAL_PX = 42;
/** The bed's integrated loudness in this voiceless draft: quiet, a preview of texture only. */
export const DRAFT_BED_LUFS = -38;
export const KEY_FRAME_SECONDS = [0, 1.5, 2.6, 3.9, 5.3, 6.6, 7.7, 8.6, 9.7, 10.5, 12.5] as const;

const FONT_FILES = { 400: "inter-latin-400-normal.woff2", 600: "inter-latin-600-normal.woff2", 700: "inter-latin-700-normal.woff2" } as const;

function pageScript(state: unknown): string {
  return `
const S = ${JSON.stringify(state)};
const C = S.colours, L = S.layout, W = L.width, H = L.height;
const STORY = L.story, CAP = L.captions, TOP = L.disclosure;
const canvas = document.getElementById('c'); const ctx = canvas.getContext('2d');
const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const lerp = (a, b, k) => a + (b - a) * k;
const measured = { minFinalPx: Infinity, misfits: [] };
let zoom = 1;

// Neutral recreation colours for the settings UI (not Microsoft's palette);
// SpecSmith colours for everything SpecSmith adds: highlight, notes, captions.
const UI = { window: '#1E1E24', card: '#2A2A33', cardHi: '#33333E', text: '#F2F2F5', text2: '#B9B9C6', line: '#3A3A46' };

function font(size, weight) { return weight + ' ' + size + 'px Inter'; }
/** Draws s at the largest size in [min, max] that fits maxWidth; sizes are measured in final frame pixels. */
function text(s, x, y, maxWidth, max, min, colour, align, weight) {
  weight = weight || 700;
  let size = max;
  for (; size >= min; size -= 1) { ctx.font = font(size, weight); if (ctx.measureText(s).width <= maxWidth) break; }
  if (size < min) { size = min; measured.misfits.push(s); }
  ctx.font = font(size, weight); ctx.fillStyle = colour; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
  measured.minFinalPx = Math.min(measured.minFinalPx, size * zoom);
  return ctx.measureText(s).width;
}
function rrect(x, y, w, h, r, fill, stroke, lw) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 3; ctx.stroke(); }
}
function chevronDown(x, y, colour) {
  ctx.strokeStyle = colour; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - 12, y - 6); ctx.lineTo(x, y + 6); ctx.lineTo(x + 12, y - 6); ctx.stroke();
}
function chevronRight(x, y, colour) {
  ctx.strokeStyle = colour; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - 6, y - 12); ctx.lineTo(x + 6, y); ctx.lineTo(x - 6, y + 12); ctx.stroke();
}

// ---- The recreated pages, in story-band coordinates at zoom 1 (1080 × 1300). ----
const WX = 50, WW = 980, CX = 90, CW = 900, ROW = 128;
const PAGES = {
  home: { title: ['Settings'], rows: ['System', 'Bluetooth & devices', 'Network & internet', 'Personalization', 'Apps', 'Accounts'], target: 0, nav: true },
  system: { title: ['System'], rows: ['Display', 'Sound', 'Notifications', 'Power', 'Storage'], target: 0 },
  display: { title: ['System', 'Display'], rows: ['Brightness', 'Scale', 'Display resolution', 'Display orientation', 'Advanced display'], target: 4 },
};
const rowY = (i) => 330 + i * (ROW + 18);

function windowFrame(titleParts) {
  rrect(WX, 60, WW, 1180, 28, UI.window, UI.line, 2);
  // The page title is Windows' own breadcrumb: the path, readable without narration.
  ctx.save();
  let x = CX;
  titleParts.forEach((part, i) => {
    const last = i === titleParts.length - 1;
    const w = text(part, x, 200, CW - (x - CX), 60, 46, last ? UI.text : UI.text2, 'left', 700);
    x += w;
    if (!last) { chevronRight(x + 26, 202, UI.text2); x += 54; }
  });
  ctx.restore();
}
function listPage(p, hover) {
  windowFrame(p.title);
  p.rows.forEach((label, i) => {
    const y = rowY(i);
    rrect(CX, y, CW, ROW, 18, i === hover ? UI.cardHi : UI.card);
    text(label, CX + 44, y + ROW / 2, CW - 140, 48, 44, UI.text, 'left', 600);
    chevronRight(CX + CW - 50, y + ROW / 2, UI.text2);
  });
}

const ADV = { selectY: 330, rateY: 640 };
function advancedPage(st) {
  windowFrame(['Display', 'Advanced display']);
  // Display selector.
  rrect(CX, ADV.selectY, CW, 230, 18, UI.card);
  text('Select a display', CX + 44, ADV.selectY + 62, CW - 88, 46, 44, UI.text, 'left', 600);
  rrect(CX + 44, ADV.selectY + 116, CW - 88, 84, 12, UI.cardHi, st.selectFocus ? C.accentText : UI.line, st.selectFocus ? 4 : 2);
  text(st.display, CX + 72, ADV.selectY + 158, CW - 200, 44, 44, UI.text, 'left', 600);
  chevronDown(CX + CW - 92, ADV.selectY + 156, UI.text2);
  // Refresh rate.
  const y = ADV.rateY;
  rrect(CX, y, CW, 230, 18, UI.card);
  text('Choose a refresh rate', CX + 44, y + 62, CW - 88, 46, 44, UI.text, 'left', 600);
  const box = { x: CX + 44, y: y + 116, w: CW - 88, h: 84 };
  rrect(box.x, box.y, box.w, box.h, 12, UI.cardHi, UI.line, 2);
  text(st.rate, box.x + 28, box.y + 42, box.w - 140, 44, 44, UI.text, 'left', 700);
  chevronDown(box.x + box.w - 48, box.y + 40, UI.text2);
  // The one highlight: when the setting changes.
  if (st.highlight > 0) {
    ctx.save(); ctx.globalAlpha = st.highlight;
    rrect(box.x - 10, box.y - 10, box.w + 20, box.h + 20, 18, null, C.accent, 6);
    ctx.globalAlpha = st.highlight * 0.18; rrect(box.x - 10, box.y - 10, box.w + 20, box.h + 20, 18, C.accent);
    ctx.restore();
  }
  if (st.selectOpen > 0) dropdown(CX + 44, ADV.selectY + 206, CW - 88, S.displays, st.selectHover, st.selectOpen, null);
  if (st.rateOpen > 0) dropdown(box.x, box.y + box.h + 6, box.w, ['60 Hz', S.higher], st.rateHover, st.rateOpen, 0);
  // SpecSmith's note, outside the recreated window's controls: readable during the payoff.
  if (st.note > 0) {
    ctx.save(); ctx.globalAlpha = st.note;
    rrect(CX, 920, CW, 120, 18, C.card, C.amber, 3);
    text(S.note, CX + CW / 2, 980, CW - 80, 54, 46, C.amber, 'center', 700);
    ctx.restore();
  }
  if (st.site > 0) {
    ctx.save(); ctx.globalAlpha = st.site;
    text(S.site, CX + CW / 2, 1150, CW - 80, 44, 42, C.textSecondary, 'center', 600);
    ctx.restore();
  }
}
function dropdown(x, y, w, items, hover, open, current) {
  ctx.save(); ctx.globalAlpha = open;
  const h = items.length * 92 + 16;
  rrect(x, y, w, h, 14, '#3A3A46', '#555565', 2);
  items.forEach((item, i) => {
    const iy = y + 8 + i * 92;
    if (i === hover) rrect(x + 8, iy, w - 16, 92, 10, '#4A4A58');
    if (i === current) rrect(x + 16, iy + 26, 8, 40, 4, UI.text);
    text(item, x + 48, iy + 46, w - 96, 44, 44, UI.text, 'left', i === current ? 700 : 600);
  });
  ctx.restore();
}

function confirmDialog(k, hover) {
  ctx.save(); ctx.globalAlpha = k;
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(WX, 60, WW, 1180);
  const x = 110, y = 420, w = 860, h = 400;
  rrect(x, y, w, h, 22, '#2F2F3A', '#555565', 2);
  text('Keep these display settings?', x + 50, y + 90, w - 100, 50, 44, UI.text, 'left', 700);
  text('If you do nothing, Windows reverts.', x + 50, y + 170, w - 100, 44, 42, UI.text2, 'left', 400);
  rrect(x + 50, y + 260, 360, 96, 14, hover ? '#7A73FF' : C.accentSolid);
  text('Keep changes', x + 230, y + 308, 320, 44, 44, '#FFFFFF', 'center', 700);
  rrect(x + 450, y + 260, 360, 96, 14, '#45455A');
  text('Revert', x + 630, y + 308, 320, 44, 44, UI.text, 'center', 600);
  ctx.restore();
}

function cursor(x, y, press, t) {
  const alpha = 1 - clamp((t - 10.6) / 0.3);
  if (alpha <= 0) return;
  const s = 1.6 * (1 - 0.12 * press) / zoom;
  ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y); ctx.scale(s, s);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 34); ctx.lineTo(9, 26); ctx.lineTo(15, 40); ctx.lineTo(21, 37); ctx.lineTo(15, 24); ctx.lineTo(26, 24); ctx.closePath();
  ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.strokeStyle = '#000000'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.restore();
}

// ---- The edit: pages, crops and cursor as a function of t. ----
// Crops: focus point and zoom in story coordinates. Tight, but always wide
// enough to keep the card's label and the page title's last step in view.
const SHOTS = [
  // Frame 0: tight on the setting itself, label and value large; the chevron may crop.
  { at: 0.0, page: 'adv', cx: 400, cy: 770, z: 1.8 },
  { at: 2.0, page: 'home', cx: 540, cy: 420, z: 1.12 },
  { at: 3.3, page: 'system', cx: 540, cy: 420, z: 1.12 },
  { at: 4.6, page: 'display', cx: 540, cy: 700, z: 1.06 },
  { at: 6.0, page: 'adv', cx: 540, cy: 560, z: 1.06 },
  { at: 7.3, page: 'adv', cx: 540, cy: 820, z: 1.2 },
  { at: 11.0, page: 'adv', cx: 540, cy: 760, z: 1.12 },
];
const CUT = 0.18; // crossfade between pages
const PAN = 0.45; // camera move within a page
// Cursor path: [time, x, y]; clicks at listed times.
const PATH = [
  [0, 760, 870], [2.0, 700, 600], [2.55, 330, 395], [3.3, 330, 395], [3.9, 300, 395], [4.6, 300, 395],
  [5.15, 380, 914], [6.0, 380, 914], [6.25, 700, 488], [6.55, 700, 488], [6.85, 400, 650], [7.3, 400, 650],
  [7.85, 800, 798], [8.15, 800, 798], [8.6, 420, 990], [9.1, 420, 990], [9.6, 340, 728], [10.2, 340, 728], [10.8, 700, 880], [14, 700, 880],
];
const CLICKS = [3.0, 4.3, 5.7, 6.4, 7.0, 8.0, 8.85, 10.0];
function cursorAt(t) {
  for (let i = 1; i < PATH.length; i += 1) {
    if (t <= PATH[i][0]) { const a = PATH[i - 1], b = PATH[i]; const k = ease((t - a[0]) / (b[0] - a[0])); return [lerp(a[1], b[1], k), lerp(a[2], b[2], k)]; }
  }
  return [PATH.at(-1)[1], PATH.at(-1)[2]];
}
const press = (t) => Math.max(0, ...CLICKS.map((c) => 1 - Math.abs(t - c) / 0.1));

function shotAt(t) {
  let i = 0; while (i + 1 < SHOTS.length && t >= SHOTS[i + 1].at) i += 1;
  const s = SHOTS[i], prev = SHOTS[i - 1];
  if (prev && prev.page === s.page) {
    const k = ease((t - s.at) / PAN);
    return { page: s.page, cx: lerp(prev.cx, s.cx, k), cy: lerp(prev.cy, s.cy, k), z: lerp(prev.z, s.z, k), from: null, fade: 1 };
  }
  const fade = prev ? clamp((t - s.at) / CUT) : 1;
  return { page: s.page, cx: s.cx, cy: s.cy, z: s.z, from: prev && fade < 1 ? prev : null, fade };
}

function advState(t) {
  const changed = t >= 8.85;
  return {
    display: t >= 7.0 ? S.displays[0] : S.displays[0],
    selectFocus: t >= 6.3 && t < 7.3,
    selectOpen: t >= 6.4 && t < 7.0 ? clamp((t - 6.4) / 0.12) : 0,
    selectHover: t >= 6.75 ? 0 : -1,
    rate: changed ? S.higher : '60 Hz',
    rateOpen: t >= 8.0 && t < 8.85 ? clamp((t - 8.0) / 0.12) : 0,
    rateHover: t >= 8.5 ? 1 : 0,
    highlight: t < 10.1 ? 0 : t < 10.5 ? ease((t - 10.1) / 0.4) : 1 - 0.35 * ease((t - 10.5) / 0.6),
    // After the list closes, so it never covers an option.
    note: clamp((t - 8.9) / 0.25),
    site: clamp((t - 11.0) / 0.4),
  };
}

function drawPage(name, t) {
  if (name === 'adv') advancedPage(advState(t));
  else listPage(PAGES[name], cursorTargetHover(name, t));
}
function cursorTargetHover(name, t) {
  const p = PAGES[name]; const [x, y] = cursorAt(t);
  for (let i = 0; i < p.rows.length; i += 1) if (x > CX && x < CX + CW && y > rowY(i) && y < rowY(i) + ROW) return i;
  return -1;
}

function story(t) {
  ctx.save();
  ctx.beginPath(); ctx.rect(0, STORY.y, W, STORY.height); ctx.clip();
  ctx.fillStyle = C.background; ctx.fillRect(0, STORY.y, W, STORY.height);
  const shot = shotAt(t);
  const draw = (s, alpha) => {
    ctx.save(); ctx.globalAlpha = alpha;
    ctx.translate(W / 2, STORY.y + STORY.height / 2); ctx.scale(s.z, s.z); ctx.translate(-s.cx, -s.cy);
    zoom = s.z;
    drawPage(s.page, t);
    if (s === shot || alpha === 1) {
      const [x, y] = cursorAt(t);
      cursor(x, y, press(t), t);
    }
    ctx.restore(); zoom = 1;
  };
  if (shot.from) draw(shot.from, 1 - shot.fade);
  draw(shot, shot.fade);
  if (t >= 9.1 && t < 10.15) {
    ctx.save();
    ctx.translate(W / 2, STORY.y + STORY.height / 2); ctx.scale(shot.z, shot.z); ctx.translate(-shot.cx, -shot.cy);
    zoom = shot.z;
    const [x, y] = cursorAt(t);
    confirmDialog(t < 10.0 ? clamp((t - 9.1) / 0.15) : 1 - clamp((t - 10.0) / 0.15), x < 520 && y > 680 && y < 776);
    cursor(x, y, press(t), t);
    ctx.restore(); zoom = 1;
  }
  ctx.restore();
}

function labelBand() {
  ctx.fillStyle = C.surface; ctx.fillRect(0, TOP.y, W, TOP.height);
  ctx.font = font(44, 700);
  const badgeW = ctx.measureText(S.label.badge).width + 64;
  rrect((W - badgeW) / 2, TOP.y + 58, badgeW, 84, 42, C.amber);
  text(S.label.badge, W / 2, TOP.y + 101, badgeW - 40, 44, 44, '#0A0A0F', 'center', 700);
  text(S.label.line, W / 2, TOP.y + 214, W - 120, 44, 42, C.text, 'center', 600);
}

function captionBand(t) {
  ctx.fillStyle = C.background; ctx.fillRect(0, CAP.y, W, CAP.height);
  const cap = S.captions.find((c) => t >= c.startSecond && t < c.endSecond) || S.captions.at(-1);
  // Hook: two large lines, on screen from frame 0 with no fade.
  const size = cap.hook ? 80 : 72;
  const lines = wrap(cap.text, W - 140, size);
  const y0 = CAP.y + CAP.height / 2 - (lines.length - 1) * size * 0.6;
  lines.forEach((line, i) => text(line, W / 2, y0 + i * size * 1.2, W - 140, size, 64, C.text, 'center', 700));
}
function wrap(s, maxWidth, size) {
  ctx.font = font(size, 700);
  if (ctx.measureText(s).width <= maxWidth) return [s];
  // Prefer a sentence break, then the most balanced word break.
  const sentence = s.match(/^(.+?[.?!])\\s+(.+)$/);
  if (sentence && ctx.measureText(sentence[1]).width <= maxWidth && ctx.measureText(sentence[2]).width <= maxWidth) return [sentence[1], sentence[2]];
  const words = s.split(' '); let best = null;
  for (let i = 1; i < words.length; i += 1) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const worst = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
    if (!best || worst < best.worst) best = { lines: [a, b], worst };
  }
  return best.lines;
}

window.renderAt = (t) => {
  ctx.fillStyle = C.background; ctx.fillRect(0, 0, W, H);
  labelBand();
  story(t);
  captionBand(t);
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
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export interface IllustrativeDraftReport {
  readonly label: string;
  readonly video: { readonly path: string; readonly sha256: string; readonly durationSeconds: number; readonly width: number; readonly height: number; readonly fps: number };
  readonly minFinalFontPx: number;
  readonly keyFrames: readonly { readonly second: number; readonly path: string }[];
  readonly contactSheet: string;
  readonly audio: Record<string, unknown>;
  readonly provenance: readonly Record<string, unknown>[];
  readonly source: typeof MICROSOFT_SOURCE;
  readonly footage: null;
  readonly proposedNarration: { readonly text: string; readonly characters: number; readonly lines: typeof PROPOSED_NARRATION; readonly voiced: false };
}

export async function renderIllustrativeDraft(outputDir = DRAFT_DIR): Promise<IllustrativeDraftReport> {
  const problems = storyProblems(FOOTAGE);
  if (problems.length) throw new RefreshRateStoryError(`The story is not renderable:\n- ${problems.join("\n- ")}`);
  if (FOOTAGE) throw new RefreshRateStoryError("Real footage is configured: render it, not the illustrative draft.");
  await mkdir(outputDir, { recursive: true });
  const work = join(outputDir, "work");
  const framesDir = join(work, "frames");
  await rm(work, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });

  const layout = DISCLOSURE_BANDED_LAYOUT;
  const fonts: Record<string, string> = {};
  const fontRecords: Record<string, unknown>[] = [];
  for (const [weight, file] of Object.entries(FONT_FILES)) {
    const bytes = await readFile(join(FONT_DIR, file));
    fonts[weight] = bytes.toString("base64");
    fontRecords.push({ file: `nextVideoRefreshRate/fonts/${file}`, sha256: sha256(bytes) });
  }
  const state = {
    layout,
    colours: { ...SPECSMITH_MOTION_COLOURS, accentSolid: "#6259FF" },
    captions: captions(FOOTAGE),
    label: ILLUSTRATIVE_LABEL,
    note: PAYOFF_NOTE,
    site: SITE_LINE,
    higher: higherRateLabel(FOOTAGE),
    displays: ["Display 1: gaming monitor", "Display 2: second screen"],
  };
  const faces = Object.entries(fonts).map(([weight, b64]) => `@font-face{font-family:Inter;font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format('woff2');}`).join("");

  const count = Math.round(DURATION_SECONDS * FPS);
  let minFinalFontPx = Infinity;
  const session = await launchBrowser({ width: layout.width, height: layout.height, deviceScaleFactor: 1 });
  try {
    const page = await session.context.newPage();
    await page.setContent(`<!doctype html><html><head><style>${faces}</style></head><body style="margin:0;background:#0A0A0F"><canvas id="c" width="${layout.width}" height="${layout.height}"></canvas><script>${pageScript(state)}</script></body></html>`);
    await page.evaluate(`Promise.all([400, 600, 700].map((w) => document.fonts.load(w + ' 48px Inter')))`);
    const loaded = await page.evaluate(`[400, 600, 700].every((w) => document.fonts.check(w + ' 48px Inter'))`);
    if (!loaded) throw new RefreshRateStoryError("Inter did not load; refusing to render in a fallback font.");
    for (let index = 0; index < count; index += 1) {
      const url = await page.evaluate(`window.renderAt(${(index / FPS).toFixed(4)})`) as string;
      await writeFile(join(framesDir, `f-${String(index).padStart(4, "0")}.png`), Buffer.from(url.split(",")[1], "base64"));
    }
    const measured = await page.evaluate("window.measured()") as { minFinalPx: number; misfits: string[] };
    if (measured.misfits.length) throw new RefreshRateStoryError(`Text does not fit at a readable size: ${[...new Set(measured.misfits)].join(" | ")}`);
    minFinalFontPx = measured.minFinalPx;
  } finally {
    await session.close();
  }
  if (minFinalFontPx < MIN_FINAL_PX) throw new RefreshRateStoryError(`Smallest type is ${minFinalFontPx.toFixed(1)}px, under ${MIN_FINAL_PX}px (14 px at 360×640).`);

  // The bed: composed here, set quiet. No voice in this draft.
  const composed = composeBed(DURATION_SECONDS);
  const levelRaw = join(work, "bed-level.f32"), levelWav = join(work, "bed-level.wav");
  await writeFile(levelRaw, Buffer.from(composed.buffer));
  await run("ffmpeg", ["-v", "error", "-y", "-f", "f32le", "-ar", String(MUSIC_BED.sampleRate), "-ac", "1", "-i", levelRaw, "-c:a", "pcm_s24le", levelWav]);
  const composedLufs = (await measureLoudness("ffmpeg", levelWav)).integratedLufs;
  const gainDb = DRAFT_BED_LUFS - composedLufs;
  const bed = renderBed(DURATION_SECONDS, [], 10 ** (gainDb / 20));
  const bedRaw = join(work, "bed.f32"), bedWav = join(outputDir, "bed.wav");
  await writeFile(bedRaw, Buffer.from(bed.buffer));
  await run("ffmpeg", ["-v", "error", "-y", "-f", "f32le", "-ar", String(MUSIC_BED.sampleRate), "-ac", "1", "-i", bedRaw, "-ac", "2", "-c:a", "pcm_s24le", bedWav]);

  const videoPath = join(outputDir, "refresh-rate-illustrative-draft.mp4");
  await run("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", join(framesDir, "f-%04d.png"), "-i", bedWav,
    "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-t", DURATION_SECONDS.toFixed(3), "-movflags", "+faststart", videoPath]);
  const final = await measureLoudness("ffmpeg", videoPath);

  // Phone-size key frames (360×640) from the encoded file, and a contact sheet.
  const keyFrames: { second: number; path: string }[] = [];
  for (const second of KEY_FRAME_SECONDS) {
    const path = join(outputDir, `phone-${second.toFixed(1).replace(".", "_")}s.png`);
    await run("ffmpeg", ["-v", "error", "-y", "-ss", second.toFixed(3), "-i", videoPath, "-frames:v", "1", "-vf", "scale=360:640:flags=lanczos", path]);
    keyFrames.push({ second, path });
  }
  const contactSheet = join(outputDir, "phone-sheet.png");
  await run("ffmpeg", ["-v", "error", "-y", ...keyFrames.flatMap((frame) => ["-i", frame.path]),
    "-filter_complex", `${keyFrames.map((_, i) => `[${i}:v]pad=372:652:6:6:color=0x2A2A33[p${i}]`).join(";")};${keyFrames.map((_, i) => `[p${i}]`).join("")}xstack=inputs=${keyFrames.length}:layout=${keyFrames.map((_, i) => `${(i % 6) * 372}_${Math.floor(i / 6) * 652}`).join("|")}:fill=0x0A0A0F`,
    "-frames:v", "1", contactSheet]);
  await rm(work, { recursive: true, force: true });

  const videoBytes = await readFile(videoPath);
  const report: IllustrativeDraftReport = {
    label: "ILLUSTRATIVE UI DRAFT: recreated Windows settings, not a screen recording. Not for publication.",
    video: { path: videoPath, sha256: sha256(videoBytes), durationSeconds: DURATION_SECONDS, width: layout.width, height: layout.height, fps: FPS },
    minFinalFontPx,
    keyFrames,
    contactSheet,
    audio: {
      contents: "The composed bed only (musicBed.ts). No voice: the narration is a proposal awaiting approval.",
      progression: PROGRESSION.map((chord) => chord.name), bpm: MUSIC_BED.bpm, ducks: [],
      composedLufs, gainDb, targetLufs: DRAFT_BED_LUFS, encodedIntegratedLufs: final.integratedLufs, encodedTruePeakDbtp: final.truePeakDbtp,
      note: "Deliberately quiet: this previews texture, not the final mix. The final mix puts the voice at about -16 LUFS with the bed beneath it.",
    },
    provenance: [
      { asset: "Recreated Windows settings pages, cursor, crops", kind: "illustrative-recreation", madeBy: "nextVideoRefreshRate/illustrativeDraft.ts (canvas drawing, this repo)",
        note: "Drawn from the steps in Microsoft's support article; layout and colours are approximations, not Microsoft's UI. Replace with a real recording." },
      { asset: "Inter typeface", kind: "font", source: "npm @fontsource/inter@5.3.0 (tarball integrity sha512-RofMylZmjlJEfELXeNHFWBRcSs75rGU/6bV2S2jfnvv/3rPXPGe0LgUJTklcHZ9lM4OZmAVFhcJPnACfb91A3g==)",
        licence: "SIL Open Font License 1.1 (nextVideoRefreshRate/fonts/OFL-1.1.txt)", files: fontRecords,
        note: "SpecSmith's CSS names Inter (--app-font-sans) but the site does not ship the files; these are the upstream Inter files." },
      { asset: "Colours", kind: "brand", source: "artifacts/SpecSmith/src/index.css (--ff-*)", note: "Via SPECSMITH_MOTION_COLOURS." },
      { asset: "Background bed", kind: "composed-synthesis", madeBy: "musicBed.ts (sine pad, soft eighth-note pulse, seeded noise; no samples, no melody)",
        licence: "unknown", note: "Made here; that records how it was made, not exclusive ownership or copyright clearance." },
    ],
    source: MICROSOFT_SOURCE,
    footage: null,
    proposedNarration: { text: PROPOSED_NARRATION_TEXT, characters: PROPOSED_NARRATION_TEXT.length, lines: PROPOSED_NARRATION, voiced: false },
  };
  await writeFile(join(outputDir, "draft-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  renderIllustrativeDraft().then((report) => {
    console.log(report.label);
    console.log(`video: ${report.video.path}`);
    console.log(`sha256: ${report.video.sha256}`);
    console.log(`smallest type: ${report.minFinalFontPx.toFixed(1)}px (min ${MIN_FINAL_PX})`);
    console.log(`audio: ${JSON.stringify(report.audio)}`);
    console.log(`narration (${report.proposedNarration.characters} chars): ${report.proposedNarration.text}`);
    console.log(`contact sheet: ${report.contactSheet}`);
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
