#!/usr/bin/env tsx
// A 7-second silent cut of "PC won't turn on? Check this switch first."
//
// A stylized example, never footage: a flat PC drawn in outlines. Frame one is
// the case power button being pressed with no response; the case turns to show
// the power supply's rear switch at O, the switch flips to I, the case turns
// back, the button is pressed and the PC lights up. Every frame is labelled as
// an illustration, and nothing claims this fixes every PC.
//
// Same approach as the other drafts: each frame is a pure function of time on
// a canvas in the pinned Chromium, encoded with ffmpeg with a silent track;
// type is measured as drawn and refused under 42 px (14 px at 360×640).
//
//   SPECSMITH_RENDER_CHROMIUM=/opt/pw-browsers/chromium \
//   pnpm exec tsx scripts/content-automator/nextVideoPowerSwitch/openingTest.ts

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launchBrowser } from "../uiRender/capture.ts";
import { SPECSMITH_MOTION_COLOURS } from "../v2/creative/dataMotionGraphic.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const OUTPUT_DIR = resolve(here, "../../../render-output/power-switch-opening-test");
const FONT_DIR = resolve(here, "../nextVideoRefreshRate/fonts");
const FONT_FILES = { 400: "inter-latin-400-normal.woff2", 600: "inter-latin-600-normal.woff2", 700: "inter-latin-700-normal.woff2" } as const;
export const DURATION_SECONDS = 7;
export const FPS = 30;
export const MIN_FINAL_PX = 42;
export const LAYOUT = Object.freeze({ width: 1080, height: 1920, label: { y: 0, height: 200 }, story: { y: 200, height: 1400 }, captions: { y: 1600, height: 320 } });
export const COPY = Object.freeze({
  badge: "ILLUSTRATION",
  line: "Stylized example · not a fix for every PC",
  caption: "PC won't turn on?",
  captionThen: "Check this switch first.",
  back: "BACK OF THE PC",
  example: "In this example, it was the switch.",
  noPower: "NOTHING HAPPENS",
  switchLabel: "PSU SWITCH",
  on: "ON",
});
export const KEY_FRAME_SECONDS = [0, 0.5, 1.4, 2.0, 2.6, 3.3, 3.95, 4.9, 5.5, 6.8] as const;

function pageScript(state: unknown): string {
  return `
const S = ${JSON.stringify(state)};
const C = S.colours, L = S.layout, W = L.width, STORY = L.story, CAP = L.captions, TOP = L.label;
const canvas = document.getElementById('c'); const ctx = canvas.getContext('2d');
const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const out = (x) => 1 - Math.pow(1 - clamp(x), 3);
const lerp = (a, b, k) => a + (b - a) * k;
const measured = { minFinalPx: Infinity, misfits: [] };
const RED = '#FF5A6E', GREEN = C.green;

function text(s, x, y, maxWidth, max, min, colour, weight, scale) {
  let size = max;
  for (; size >= min; size -= 1) { ctx.font = weight + ' ' + size + 'px Inter'; if (ctx.measureText(s).width <= maxWidth) break; }
  if (size < min) { size = min; measured.misfits.push(s); }
  ctx.font = weight + ' ' + size + 'px Inter'; ctx.fillStyle = colour; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
  measured.minFinalPx = Math.min(measured.minFinalPx, size * (scale || 1));
}
function rr(x, y, w, h, r, fill, stroke, lw) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 3; ctx.stroke(); }
}
function pill(s, cx, cy, fill, ink, size, alpha) {
  if (alpha <= 0) return;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.font = '700 ' + size + 'px Inter'; const w = ctx.measureText(s).width + 64;
  rr(cx - w / 2, cy - size * 0.85, w, size * 1.7, size * 0.85, fill);
  text(s, cx, cy + 2, w, size, size, ink, 700);
  ctx.restore();
}
/** A stylized fingertip pointing left, tip at (x, y). */
function finger(x, y, alpha) {
  if (alpha <= 0) return;
  ctx.save(); ctx.globalAlpha = alpha;
  rr(x, y - 34, 420, 68, 34, '#D9D9E6', '#8A8AA0', 3);
  rr(x + 40, y - 30, 3, 60, 1, '#B5B5C6');
  ctx.restore();
}

// ---- The case, front and back, in story coordinates (1080 × 1400). ----
const CASE = { x: 290, y: 140, w: 500, h: 1160 };
const BTN = { x: 540, y: 270, r: 58 };
function front(lit, pressed) {
  rr(CASE.x, CASE.y, CASE.w, CASE.h, 34, '#16161F', lit > 0 ? 'rgba(108,99,255,' + (0.4 + 0.6 * lit) + ')' : '#3A3A4A', 6);
  // Front mesh with three intake fans.
  for (let i = 0; i < 3; i += 1) {
    const cy = 560 + i * 250;
    ctx.beginPath(); ctx.arc(540, cy, 105, 0, Math.PI * 2);
    ctx.strokeStyle = lit > 0 ? (i % 2 ? 'rgba(0,212,255,' + lit + ')' : 'rgba(108,99,255,' + lit + ')') : '#2E2E3A'; ctx.lineWidth = lit > 0 ? 10 : 5; ctx.stroke();
    ctx.beginPath(); ctx.arc(540, cy, 34, 0, Math.PI * 2); ctx.fillStyle = '#2A2A36'; ctx.fill();
  }
  // Power button: ring and the standby symbol.
  const r = BTN.r * (1 - 0.08 * pressed);
  ctx.beginPath(); ctx.arc(BTN.x, BTN.y, r, 0, Math.PI * 2); ctx.fillStyle = '#1F1F2A'; ctx.fill();
  ctx.strokeStyle = lit > 0 ? C.cyan : '#6A6A80'; ctx.lineWidth = 7; ctx.stroke();
  if (lit > 0) { ctx.save(); ctx.globalAlpha = 0.35 * lit; ctx.beginPath(); ctx.arc(BTN.x, BTN.y, r + 26, 0, Math.PI * 2); ctx.strokeStyle = C.cyan; ctx.lineWidth = 16; ctx.stroke(); ctx.restore(); }
  ctx.strokeStyle = lit > 0 ? C.cyan : '#8A8AA0'; ctx.lineWidth = 8; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(BTN.x, BTN.y + 4, 26, -Math.PI / 2 + 0.7, -Math.PI / 2 - 0.7 + Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(BTN.x, BTN.y - 30); ctx.lineTo(BTN.x, BTN.y + 2); ctx.stroke();
}
const SW = { x: 640, y: 1090, w: 90, h: 140 };
function back(on) {
  rr(CASE.x, CASE.y, CASE.w, CASE.h, 34, '#16161F', '#3A3A4A', 6);
  // Port panel, exhaust fan, slot covers: enough to read as the back.
  rr(330, 210, 130, 360, 10, '#1D1D28', '#44445A', 3);
  ctx.beginPath(); ctx.arc(640, 330, 105, 0, Math.PI * 2); ctx.strokeStyle = '#2E2E3A'; ctx.lineWidth = 5; ctx.stroke();
  for (let k = 0; k < 6; k += 1) rr(330, 640 + k * 50, 420, 38, 6, '#1B1B25', '#33333F', 2);
  // Power supply with its fan, socket and rocker switch.
  rr(320, 1000, 440, 270, 14, '#1B1B25', '#4A4A5E', 4);
  for (const rad of [36, 62, 86]) { ctx.beginPath(); ctx.arc(440, 1135, rad, 0, Math.PI * 2); ctx.strokeStyle = '#2E2E3A'; ctx.lineWidth = 4; ctx.stroke(); }
  rr(560, 1095, 60, 80, 8, '#0B0B10', '#55556A', 3);
  rocker(on);
}
/** The rocker: I on top, O at the bottom. The pressed-in half sits lower and darker. */
function rocker(on) {
  const s = SW;
  rr(s.x - 8, s.y - 8, s.w + 16, s.h + 16, 12, '#0B0B10', '#55556A', 3);
  const topIn = on, half = s.h / 2;
  rr(s.x, s.y, s.w, half, 8, topIn ? '#2A2A36' : '#4A4A5E');
  rr(s.x, s.y + half, s.w, half, 8, topIn ? '#4A4A5E' : '#2A2A36');
  ctx.lineCap = 'round'; ctx.lineWidth = 9;
  ctx.strokeStyle = on ? GREEN : '#9A9AB0';
  ctx.beginPath(); ctx.moveTo(s.x + s.w / 2, s.y + 18); ctx.lineTo(s.x + s.w / 2, s.y + half - 18); ctx.stroke();
  ctx.strokeStyle = on ? '#9A9AB0' : RED;
  ctx.beginPath(); ctx.arc(s.x + s.w / 2, s.y + half * 1.5, 18, 0, Math.PI * 2); ctx.stroke();
}

// ---- The edit, by time. ----
// Front: dead press. Turn. HOLD on the whole back with the switch called out,
// so its location registers. Zoom in, flip O to I. Zoom out, turn back, press,
// the PC lights up: this example's result, labelled as such.
const PRESS1 = 0.15, TURN1 = [1.2, 1.6], BACK_HOLD = [1.6, 2.8], ZOOM_IN = [2.8, 3.15], FLIP = 3.8,
  ZOOM_OUT = [4.35, 4.65], TURN2 = [4.65, 5.05], PRESS2 = 5.2, LIGHT = 5.3;
const pressAt = (t, at) => (t >= at && t < at + 0.25 ? Math.sin(((t - at) / 0.25) * Math.PI) : 0);
const span = (t, sp) => clamp((t - sp[0]) / (sp[1] - sp[0]));
const BACK_FRAME = [540, 760, 1.12];
/** Where a story-space y lands on screen in the wide back view. */
const backScreenY = (y) => STORY.y + STORY.height / 2 + (y - BACK_FRAME[1]) * BACK_FRAME[2];

function story(t) {
  ctx.save(); ctx.beginPath(); ctx.rect(0, STORY.y, W, STORY.height); ctx.clip();
  ctx.fillStyle = C.background; ctx.fillRect(0, STORY.y, W, STORY.height);
  // Turning the case: squeeze to the edge, swap faces, open out.
  const k1 = span(t, TURN1), k2 = span(t, TURN2);
  const showBack = (t >= TURN1[0] && k1 >= 0.5 && t < TURN2[0]) || (t >= TURN2[0] && k2 < 0.5);
  const sx = t < TURN1[0] ? 1 : t < TURN2[0] ? Math.abs(Math.cos(k1 * Math.PI)) : Math.abs(Math.cos(k2 * Math.PI));
  // On the back: hold wide, then punch in on the switch so I and O read at phone size.
  const zIn = t < ZOOM_IN[0] ? 0 : t < ZOOM_OUT[0] ? ease(span(t, ZOOM_IN)) : 1 - ease(span(t, ZOOM_OUT));
  // The front is framed tight on the button; the swap happens at zero width, so the change of framing is never seen.
  const base = showBack ? BACK_FRAME : [540, 600, 1.45];
  const z = lerp(base[2], 2.6, zIn), cx = lerp(base[0], SW.x + SW.w / 2, zIn), cy = lerp(base[1], SW.y + SW.h / 2, zIn);
  ctx.translate(W / 2, STORY.y + STORY.height / 2); ctx.scale(z * Math.max(sx, 0.02), z); ctx.translate(-cx, -cy);
  const on = t >= FLIP + 0.08;
  if (showBack) {
    back(on);
    // Establishing beat: the switch's place on the back, pulsing amber.
    const hold = t >= BACK_HOLD[0] && t < ZOOM_IN[1] ? out((t - BACK_HOLD[0]) / 0.25) * (1 - span(t, ZOOM_IN)) : 0;
    if (hold > 0) {
      const pulse = 0.6 + 0.4 * Math.sin((t - BACK_HOLD[0]) * 7);
      ctx.save(); ctx.globalAlpha = hold * pulse; rr(SW.x - 26, SW.y - 26, SW.w + 52, SW.h + 52, 18, null, C.amber, 9); ctx.restore();
      ctx.save(); ctx.globalAlpha = hold; ctx.strokeStyle = C.amber; ctx.lineWidth = 8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(SW.x + SW.w / 2, 930); ctx.lineTo(SW.x + SW.w / 2, SW.y - 34); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(SW.x + SW.w / 2 - 20, SW.y - 56); ctx.lineTo(SW.x + SW.w / 2, SW.y - 34); ctx.lineTo(SW.x + SW.w / 2 + 20, SW.y - 56); ctx.stroke();
      ctx.restore();
    }
  } else front(t >= LIGHT ? out((t - LIGHT) / 0.3) : 0, pressAt(t, PRESS1) + pressAt(t, PRESS2));
  // The fingers: the first press, the flip, the second press.
  const f1 = t < 1.0 ? 1 - clamp((t - 0.8) / 0.2) : 0;
  if (!showBack && f1 > 0) finger(BTN.x + BTN.r - 6 - 18 * pressAt(t, PRESS1) + 90 * (1 - out(t / 0.12)), BTN.y, f1);
  if (showBack && t > 3.3 && t < 4.3) {
    const tip = t < FLIP ? lerp(SW.y + 150, SW.y + 30, ease((t - 3.3) / (FLIP - 3.3))) : SW.y + 30;
    finger(SW.x + SW.w + 4, tip, 1 - clamp((t - 4.1) / 0.15));
  }
  const f3 = t >= TURN2[1] ? clamp((t - TURN2[1]) / 0.06) * (1 - clamp((t - 5.55) / 0.15)) : 0;
  if (!showBack && f3 > 0) finger(BTN.x + BTN.r - 6 - 18 * pressAt(t, PRESS2), BTN.y, f3);
  ctx.restore();

  // Large labels in screen space, so they stay the same size through the zoom.
  pill(S.copy.noPower, W / 2, STORY.y + 440, RED, '#0A0A0F', 64, t >= 0.3 && t < TURN1[0] + 0.05 ? out((t - 0.3) / 0.12) : 0);
  const holdLabels = showBack && t >= BACK_HOLD[0] && t < ZOOM_IN[0] + 0.1 ? out((t - BACK_HOLD[0]) / 0.2) : 0;
  pill(S.copy.back, W / 2, STORY.y + 110, C.text, '#0A0A0F', 56, holdLabels);
  pill(S.copy.switchLabel, W / 2 + 60, backScreenY(880), C.amber, '#0A0A0F', 60, holdLabels);
  if (showBack && zIn > 0.6) {
    pill(S.copy.switchLabel, W / 2, STORY.y + 150, C.amber, '#0A0A0F', 60, 1);
    text(on ? 'I = ON' : 'O = OFF', W / 2, STORY.y + 1290, W - 160, 84, 84, on ? GREEN : RED, 700);
  }
  const lit = t >= LIGHT + 0.1 ? out((t - LIGHT - 0.1) / 0.15) : 0;
  pill(S.copy.on, W / 2, STORY.y + 440, GREEN, '#0A0A0F', 64, lit);
  if (lit > 0) {
    // On a solid plate, never over the lit fans.
    ctx.save(); ctx.globalAlpha = out((t - LIGHT - 0.3) / 0.3);
    rr(70, STORY.y + 1262, W - 140, 104, 24, C.surface, '#33333F', 2);
    text(S.copy.example, W / 2, STORY.y + 1314, W - 200, 46, 42, C.text, 600); ctx.restore();
  }
  ctx.restore();
}

function labelBand() {
  ctx.fillStyle = C.surface; ctx.fillRect(0, TOP.y, W, TOP.height);
  ctx.font = '700 44px Inter'; const w = ctx.measureText(S.copy.badge).width + 60;
  rr((W - w) / 2, 34, w, 76, 38, C.amber);
  text(S.copy.badge, W / 2, 73, w, 44, 44, '#0A0A0F', 700);
  text(S.copy.line, W / 2, 152, W - 120, 42, 42, C.text, 600);
}
function captionBand(t) {
  ctx.fillStyle = C.background; ctx.fillRect(0, CAP.y, W, CAP.height);
  text(t < 2.8 ? S.copy.caption : S.copy.captionThen, W / 2, CAP.y + CAP.height / 2, W - 120, 88, 72, C.text, 700);
}

window.renderAt = (t) => {
  ctx.fillStyle = C.background; ctx.fillRect(0, 0, W, L.height);
  labelBand(); ctx.save(); story(t); captionBand(t);
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

export async function renderOpeningTest(outputDir = OUTPUT_DIR) {
  await mkdir(outputDir, { recursive: true });
  const framesDir = join(outputDir, "work");
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  const faces: string[] = [];
  for (const [weight, file] of Object.entries(FONT_FILES)) {
    faces.push(`@font-face{font-family:Inter;font-weight:${weight};src:url(data:font/woff2;base64,${(await readFile(join(FONT_DIR, file))).toString("base64")}) format('woff2');}`);
  }
  const state = { layout: LAYOUT, colours: SPECSMITH_MOTION_COLOURS, copy: COPY };
  const count = Math.round(DURATION_SECONDS * FPS);
  let minFinalPx = Infinity;
  const session = await launchBrowser({ width: LAYOUT.width, height: LAYOUT.height, deviceScaleFactor: 1 });
  try {
    const page = await session.context.newPage();
    await page.setContent(`<!doctype html><html><head><style>${faces.join("")}</style></head><body style="margin:0;background:#0A0A0F"><canvas id="c" width="${LAYOUT.width}" height="${LAYOUT.height}"></canvas><script>${pageScript(state)}</script></body></html>`);
    await page.evaluate(`Promise.all([400, 600, 700].map((w) => document.fonts.load(w + ' 48px Inter')))`);
    if (!(await page.evaluate(`[400, 600, 700].every((w) => document.fonts.check(w + ' 48px Inter'))`))) throw new Error("Inter did not load; refusing to render in a fallback font.");
    for (let index = 0; index < count; index += 1) {
      const url = await page.evaluate(`window.renderAt(${(index / FPS).toFixed(4)})`) as string;
      await writeFile(join(framesDir, `f-${String(index).padStart(4, "0")}.png`), Buffer.from(url.split(",")[1], "base64"));
    }
    const measured = await page.evaluate("window.measured()") as { minFinalPx: number; misfits: string[] };
    if (measured.misfits.length) throw new Error(`Text does not fit at a readable size: ${[...new Set(measured.misfits)].join(" | ")}`);
    minFinalPx = measured.minFinalPx;
  } finally {
    await session.close();
  }
  if (minFinalPx < MIN_FINAL_PX) throw new Error(`Smallest type is ${minFinalPx}px, under ${MIN_FINAL_PX}px.`);
  const videoPath = join(outputDir, "power-switch-opening-test.mp4");
  await run("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", join(framesDir, "f-%04d.png"),
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "0:v", "-map", "1:a",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
    "-t", DURATION_SECONDS.toFixed(3), "-movflags", "+faststart", videoPath]);
  for (const second of KEY_FRAME_SECONDS) {
    await run("ffmpeg", ["-v", "error", "-y", "-ss", second.toFixed(3), "-i", videoPath, "-frames:v", "1", "-vf", "scale=360:640:flags=lanczos", join(outputDir, `phone-${second.toFixed(2).replace(".", "_")}s.png`)]);
  }
  await run("ffmpeg", ["-v", "error", "-y", "-i", videoPath, "-vf", "fps=5,scale=180:320:flags=lanczos,tile=10x4:padding=4:color=0x2A2A33", "-frames:v", "1", join(outputDir, "phone-every-0.2s.png")]);
  await rm(framesDir, { recursive: true, force: true });
  return { videoPath, sha256: sha256(await readFile(videoPath)), minFinalPx };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  renderOpeningTest().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error); process.exitCode = 1; });
}
