#!/usr/bin/env tsx
// "New PC not working? Check these two spots." A 12.3 s silent Short that
// joins the PSU-switch cut and the monitor-port animation into one story about
// ONE stylized PC. The case is one box with one shape: it turns about its own
// axis (its side shows mid-turn), and one camera moves in and out on it.
//
//   Open: close on the power button, "NO POWER?" from frame one; a press, the
//      button flashes red, nothing starts. A 0.6 s glimpse of the other symptom:
//      the same PC lit beside a monitor whose screen stays dark, "ON, NO
//      PICTURE?" (a dark screen only: no message, no result).
//   1. Back on the dead PC, pull out, turn to the back, close on the PSU
//      switch: O = OFF, the finger pushes I, I = ON; out, turn, press, it lights.
//   2. "ON, NO PICTURE?": turn to the back, close on the ports; the cable comes
//      clearly out of the motherboard port and seats in the graphics card's.
//   Close: both spots numbered 1 and 2 on the whole back.
//
// The art is the existing art, reused: the front after
// nextVideoPowerSwitch/openingTest.ts (widened to the back's size, so a turn
// never changes the case's shape), the back (port panel, fan, slots, graphics
// card, power supply, cable) from nextVideoMonitorPort/illustrativeDraft.ts,
// with the rocker fitted to that power supply. The fans stay still until the
// PC powers on and turn from then on, which carries symptom 1 into symptom 2.
//
// Honest by construction: every frame says "ILLUSTRATION · Stylized example ·
// not a fix for every PC"; no frame shows a monitor result, NO SIGNAL or an
// FPS figure; the copy is checked against the monitor-port Short's forbidden
// claims (comboCopyProblems). Silent: the narration is a proposal only.
//
//   SPECSMITH_RENDER_CHROMIUM=/opt/pw-browsers/chromium \
//   pnpm exec tsx scripts/content-automator/nextVideoTwoChecks/comboDraft.ts

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launchBrowser } from "../uiRender/capture.ts";
import { SPECSMITH_MOTION_COLOURS } from "../v2/creative/dataMotionGraphic.ts";
import { FORBIDDEN_CLAIMS } from "../nextVideoMonitorPort/storyboard.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const OUTPUT_DIR = resolve(here, "../../../render-output/two-checks-draft");
const FONT_DIR = resolve(here, "../nextVideoRefreshRate/fonts");
const FONT_FILES = { 400: "inter-latin-400-normal.woff2", 600: "inter-latin-600-normal.woff2", 700: "inter-latin-700-normal.woff2" } as const;
export const FPS = 30;
export const MIN_FINAL_PX = 42;
export const LAYOUT = Object.freeze({ width: 1080, height: 1920, label: { y: 0, height: 200 }, story: { y: 200, height: 1400 }, captions: { y: 1600, height: 320 } });

type Span = readonly [number, number];
/** Every event of a cut, in seconds. `head2` is when the second symptom's headline comes in (default: just after the light-up). */
export interface ComboTiming {
  readonly durationSeconds: number;
  readonly press1: number; readonly glimpse: Span;
  readonly pullOut: Span; readonly turn1: Span; readonly zoomIn: Span; readonly finger: number; readonly flip: number; readonly zoomOut: Span;
  readonly turn2: Span; readonly press2: number; readonly light: number;
  readonly turn3: Span; readonly zoomPorts: Span; readonly pull: number; readonly travel: number; readonly push: number; readonly seated: number;
  readonly zoomOut2: Span; readonly final: number;
  readonly head2?: number;
}

/** Every event, in seconds. One PC, one camera, three turns, two checks. */
export const TIMING: ComboTiming = Object.freeze<ComboTiming>({
  durationSeconds: 12.3,
  // Open: the dead press (close on the button), then the glimpse of symptom 2.
  press1: 0.12, glimpse: [0.55, 1.15],
  // Check 1: pull back, turn to the back, close on the PSU switch, flip, back out, turn, press, light.
  pullOut: [1.15, 1.5], turn1: [1.5, 2.1], zoomIn: [2.1, 2.6], finger: 2.7, flip: 3.25, zoomOut: [3.85, 4.2],
  turn2: [4.2, 4.8], press2: 4.95, light: 5.05,
  // Check 2: turn to the back, close on the ports, move the cable from the motherboard to the graphics card.
  turn3: [5.65, 6.25], zoomPorts: [6.25, 6.6], pull: 6.95, travel: 7.25, push: 8.45, seated: 8.7,
  // Close: back out to the whole back, both spots numbered.
  zoomOut2: [9.25, 9.65], final: 9.65,
});

export const COPY = Object.freeze({
  badge: "ILLUSTRATION",
  line: "Stylized example · not a fix for every PC",
  chapters: ["1 · NO POWER?", "2 · ON, NO PICTURE?"],
  captions: [
    { from: 0, to: 1.15, text: "New PC not working?" },
    { from: 1.15, to: 5.35, text: "Check the PSU switch." },
    { from: 5.35, to: 9.65, text: "Check where the monitor cable goes." },
    { from: 9.65, to: 12.3, text: "Check these two spots first." },
  ],
  labels: {
    noPower: "NO POWER?", noPicture: "ON, NO PICTURE?", psu: "PSU SWITCH", off: "O = OFF", on: "I = ON",
    motherboard: "MOTHERBOARD", graphicsCard: "GRAPHICS CARD", cable: "MONITOR CABLE",
  },
  site: "specsmithpc.com",
});

/** The proposed narration, not voiced. At the saved takes' pace (about 13.5 characters a second) it runs about 11 s. */
export const PROPOSED_NARRATION = "New PC not working? Check two spots. The power supply switch on the back: O is off, I is on. On, but no picture? Plug the monitor into the graphics card.";

/** Copy problems against the monitor-port Short's forbidden claims (no universal NO SIGNAL, no FPS, no guaranteed fix…). */
export function comboCopyProblems(texts: readonly string[] = [...COPY.captions.map((c) => c.text), ...COPY.chapters, ...Object.values(COPY.labels), PROPOSED_NARRATION]): string[] {
  const problems: string[] = [];
  for (const text of texts) for (const { pattern, why } of FORBIDDEN_CLAIMS) if (pattern.test(text)) problems.push(`"${text}": ${why}`);
  return problems;
}

function pageScript(state: unknown): string {
  return `
const S = ${JSON.stringify(state)};
const C = S.colours, L = S.layout, W = L.width, STORY = L.story, CAP = L.captions, TOP = L.label, T = S.timing;
// When the second symptom's headline comes in: on the voice's line in the voiced cut, just after the light-up in the silent one.
const HEAD2 = T.head2 ?? T.light + 0.25;
const canvas = document.getElementById('c'); const ctx = canvas.getContext('2d');
const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const out = (x) => 1 - Math.pow(1 - clamp(x), 3);
const back = (x) => { x = clamp(x); const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const lerp = (a, b, k) => a + (b - a) * k;
const span = (t, sp) => clamp((t - sp[0]) / (sp[1] - sp[0]));
const measured = { minFinalPx: Infinity, misfits: [] };
let zoom = 1;
const PURPLE = C.accentText, CYAN = C.cyan, RED = '#FF5A6E', GREEN = C.green, AMBER = C.amber;

function text(s, x, y, maxWidth, max, min, colour, align, weight) {
  let size = max;
  for (; size >= min; size -= 1) { ctx.font = weight + ' ' + size + 'px Inter'; if (ctx.measureText(s).width <= maxWidth) break; }
  if (size < min) { size = min; measured.misfits.push(s); }
  ctx.font = weight + ' ' + size + 'px Inter'; ctx.fillStyle = colour; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
  measured.minFinalPx = Math.min(measured.minFinalPx, size * zoom);
}
function rr(x, y, w, h, r, fill, stroke, lw) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 3; ctx.stroke(); }
}
function pill(s, cx, cy, fill, ink, size, alpha) {
  if (alpha <= 0) return;
  ctx.save(); ctx.globalAlpha *= alpha;
  ctx.font = '700 ' + size + 'px Inter'; const w = ctx.measureText(s).width + 60;
  rr(cx - w / 2, cy - size * 0.82, w, size * 1.64, size * 0.82, fill);
  text(s, cx, cy + 2, w, size, size, ink, 'center', 700);
  ctx.restore();
}
function finger(x, y, alpha) {
  if (alpha <= 0) return;
  ctx.save(); ctx.globalAlpha *= alpha;
  rr(x, y - 34, 420, 68, 34, '#D9D9E6', '#8A8AA0', 3); rr(x + 40, y - 30, 3, 60, 1, '#B5B5C6');
  ctx.restore();
}
function ring(x, y, r, colour, lw, a) { if (a <= 0) return; ctx.save(); ctx.globalAlpha *= a; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.strokeStyle = colour; ctx.lineWidth = lw; ctx.stroke(); ctx.restore(); }

// ---- One case, one size: the front and the back share CASE, so a turn never changes its shape. ----
const CASE = { x: 150, y: 30, w: 780, h: 1340 }, DEPTH = 520, MID = CASE.x + CASE.w / 2;
const BTN = { x: 540, y: 150, r: 62 };
// FRONT (after nextVideoPowerSwitch/openingTest.ts): power button on top, three fans behind mesh.
function front(t, lit, pressed, dead) {
  rr(CASE.x, CASE.y, CASE.w, CASE.h, 34, '#16161F', lit > 0 ? 'rgba(108,99,255,' + (0.4 + 0.6 * lit) + ')' : '#3A3A4A', 6);
  rr(330, 137, 80, 26, 5, '#0B0B10', '#55556A', 3); rr(670, 137, 80, 26, 5, '#0B0B10', '#55556A', 3);
  rr(200, 280, 680, 1040, 20, '#121219', '#2A2A36', 3);
  for (let i = 0; i < 3; i += 1) {
    const cy = 450 + i * 350, col = i % 2 ? '0,212,255' : '108,99,255';
    ctx.beginPath(); ctx.arc(540, cy, 140, 0, Math.PI * 2);
    ctx.strokeStyle = lit > 0 ? 'rgba(' + col + ',' + lit + ')' : '#2E2E3A'; ctx.lineWidth = lit > 0 ? 14 : 6; ctx.stroke();
    ctx.save(); ctx.translate(540, cy); ctx.rotate(lit > 0 ? (t - T.light) * 5 + i : i);
    for (let b = 0; b < 5; b += 1) { ctx.rotate((Math.PI * 2) / 5); ctx.beginPath(); ctx.moveTo(48, 0); ctx.quadraticCurveTo(90, 30, 118, 12); ctx.strokeStyle = lit > 0 ? '#3A3A50' : '#24242E'; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.stroke(); }
    ctx.restore();
    ctx.beginPath(); ctx.arc(540, cy, 44, 0, Math.PI * 2); ctx.fillStyle = '#2A2A36'; ctx.fill();
  }
  const r = BTN.r * (1 - 0.1 * pressed);
  ctx.beginPath(); ctx.arc(BTN.x, BTN.y, r, 0, Math.PI * 2); ctx.fillStyle = pressed > 0.2 ? '#14141C' : '#1F1F2A'; ctx.fill();
  const ink = lit > 0 ? CYAN : dead > 0 ? RED : '#8A8AA0';
  ctx.strokeStyle = lit > 0 ? CYAN : dead > 0 ? RED : '#6A6A80'; ctx.lineWidth = 7; ctx.stroke();
  if (lit > 0) ring(BTN.x, BTN.y, r + 26, CYAN, 16, 0.35 * lit);
  if (dead > 0) ring(BTN.x, BTN.y, r + 22, RED, 10, dead);
  ctx.strokeStyle = ink; ctx.lineWidth = 8; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(BTN.x, BTN.y + 4, 26, -Math.PI / 2 + 0.7, -Math.PI / 2 - 0.7 + Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(BTN.x, BTN.y - 30); ctx.lineTo(BTN.x, BTN.y + 2); ctx.stroke();
}

// BACK (from nextVideoMonitorPort/illustrativeDraft.ts), with the rocker on its PSU.
const IO = { x: 200, y: 200, w: 230, h: 470 };
const GPU = { x: 200, y: 740, w: 690, h: 96 };
const MB_PORT = { x: 250, y: 300, w: 130, h: 56 };
const GPU_PORT = { x: 740, y: 760, w: 130, h: 56 };
const SW = { x: 782, y: 1165, w: 64, h: 100 };
const SW_C = [SW.x + SW.w / 2, SW.y + SW.h / 2];
function hdmi(p, colour, lw) {
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.w, p.y); ctx.lineTo(p.x + p.w, p.y + p.h * 0.6);
  ctx.lineTo(p.x + p.w - 14, p.y + p.h); ctx.lineTo(p.x + 14, p.y + p.h); ctx.lineTo(p.x, p.y + p.h * 0.6); ctx.closePath();
  ctx.fillStyle = '#0B0B10'; ctx.fill(); ctx.strokeStyle = colour; ctx.lineWidth = lw; ctx.stroke();
}
function dp(p, colour, lw) {
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.w, p.y); ctx.lineTo(p.x + p.w, p.y + p.h);
  ctx.lineTo(p.x + 18, p.y + p.h); ctx.lineTo(p.x, p.y + p.h - 18); ctx.closePath();
  ctx.fillStyle = '#0B0B10'; ctx.fill(); ctx.strokeStyle = colour; ctx.lineWidth = lw; ctx.stroke();
}
function usb(x, y) { rr(x, y, 80, 30, 4, '#0B0B10', '#55556A', 3); rr(x + 10, y + 8, 60, 8, 2, '#55556A'); }
function glow(r, colour, k, pad) {
  if (k <= 0) return; pad = pad || 12;
  ctx.save(); ctx.globalAlpha = k; rr(r.x - pad, r.y - pad, r.w + 2 * pad, r.h + 2 * pad, 18, null, colour, 8);
  ctx.globalAlpha = 0.12 * k; rr(r.x - pad, r.y - pad, r.w + 2 * pad, r.h + 2 * pad, 18, colour); ctx.restore();
}
/** The rocker, k = 0 (O pressed: off) to 1 (I pressed: on). The pressed half is darker; the active mark is coloured. */
function rocker(k) {
  const s = SW, half = s.h / 2, onNow = k >= 0.5;
  rr(s.x - 7, s.y - 7, s.w + 14, s.h + 14, 10, '#0B0B10', '#55556A', 3);
  const shade = (a) => 'rgb(' + Math.round(lerp(74, 42, a)) + ',' + Math.round(lerp(74, 42, a)) + ',' + Math.round(lerp(94, 54, a)) + ')';
  rr(s.x, s.y, s.w, half, 7, shade(k)); rr(s.x, s.y + half, s.w, half, 7, shade(1 - k));
  ctx.lineCap = 'round'; ctx.lineWidth = 7;
  ctx.strokeStyle = onNow ? GREEN : '#9A9AB0'; ctx.beginPath(); ctx.moveTo(s.x + s.w / 2, s.y + 13); ctx.lineTo(s.x + s.w / 2, s.y + half - 13); ctx.stroke();
  ctx.strokeStyle = onNow ? '#9A9AB0' : RED; ctx.beginPath(); ctx.arc(s.x + s.w / 2, s.y + half * 1.5, 13, 0, Math.PI * 2); ctx.stroke();
}
function pcBack(t, mbLit, gpuLit, k, powered) {
  rr(CASE.x, CASE.y, CASE.w, CASE.h, 34, '#15151E', '#3A3A4A', 6);
  rr(IO.x, IO.y, IO.w, IO.h, 12, '#1D1D28', '#44445A', 3);
  const mbColour = mbLit > 0 ? PURPLE : '#C9C9D6';
  usb(IO.x + 25, IO.y + 30); usb(IO.x + 125, IO.y + 30); usb(IO.x + 25, IO.y + 72); usb(IO.x + 125, IO.y + 72);
  hdmi(MB_PORT, mbColour, 5); dp({ x: 255, y: 380, w: 120, h: 56 }, mbColour, 5);
  rr(IO.x + 80, IO.y + 270, 70, 64, 8, '#0B0B10', '#55556A', 3);
  for (let i = 0; i < 3; i += 1) { ctx.beginPath(); ctx.arc(IO.x + 60 + i * 55, IO.y + 405, 17, 0, Math.PI * 2); ctx.strokeStyle = '#55556A'; ctx.lineWidth = 4; ctx.stroke(); }
  const fx = 690, fy = 390, fr = 175;
  ctx.beginPath(); ctx.arc(fx, fy, fr + 14, 0, Math.PI * 2); ctx.strokeStyle = '#33333F'; ctx.lineWidth = 6; ctx.stroke();
  for (const r of [fr * 0.45, fr * 0.75, fr]) { ctx.beginPath(); ctx.arc(fx, fy, r, 0, Math.PI * 2); ctx.strokeStyle = '#2A2A36'; ctx.lineWidth = 4; ctx.stroke(); }
  ctx.save(); ctx.translate(fx, fy); ctx.rotate(powered ? (t - T.light) * 3.2 : 0);
  for (let b = 0; b < 7; b += 1) { ctx.rotate((Math.PI * 2) / 7); ctx.beginPath(); ctx.moveTo(30, 0); ctx.quadraticCurveTo(110, 40, fr - 12, 10); ctx.quadraticCurveTo(110, -10, 30, 0); ctx.fillStyle = powered ? '#2E2E3E' : '#262632'; ctx.fill(); }
  ctx.restore(); ctx.beginPath(); ctx.arc(fx, fy, 36, 0, Math.PI * 2); ctx.fillStyle = '#2E2E3C'; ctx.fill();
  rr(GPU.x, GPU.y, GPU.w, GPU.h, 8, '#22222E', '#4A4A5E', 3);
  const gpuColour = gpuLit > 0 ? CYAN : '#C9C9D6';
  for (let v = 0; v < 6; v += 1) rr(GPU.x + 18 + v * 14, GPU.y + 16, 7, 64, 3, '#33333F');
  dp({ x: 330, y: 760, w: 120, h: 56 }, gpuColour, 5); dp({ x: 465, y: 760, w: 120, h: 56 }, gpuColour, 5); dp({ x: 600, y: 760, w: 120, h: 56 }, gpuColour, 5);
  hdmi(GPU_PORT, gpuColour, 5);
  for (let q = 0; q < 4; q += 1) { const y = 870 + q * 52; rr(GPU.x, y, GPU.w, 42, 6, '#1B1B25', '#33333F', 2); for (let v = 0; v < 10; v += 1) rr(GPU.x + 120 + v * 46, y + 15, 30, 12, 6, '#2A2A36'); }
  rr(200, 1110, 690, 230, 12, '#1B1B25', '#3A3A4A', 3);
  for (const r of [40, 70, 95]) { ctx.beginPath(); ctx.arc(390, 1225, r, 0, Math.PI * 2); ctx.strokeStyle = '#2E2E3A'; ctx.lineWidth = 4; ctx.stroke(); }
  rr(620, 1175, 120, 90, 10, '#0B0B10', '#55556A', 3);
  rocker(k);
  glow(IO, PURPLE, mbLit); glow(GPU, CYAN, gpuLit);
}

/** The cable's plug: in the motherboard port, pulled clearly out, carried over, seated in the graphics card by T.seated. */
const PULL = 130;
function plugAt(t) {
  const a = { x: MB_PORT.x + MB_PORT.w / 2, y: MB_PORT.y + MB_PORT.h / 2 }, b = { x: GPU_PORT.x + GPU_PORT.w / 2, y: GPU_PORT.y + GPU_PORT.h / 2 };
  if (t < T.pull) return { ...a, out: 0 };
  if (t < T.travel) return { ...a, y: a.y + PULL * out((t - T.pull) / (T.travel - T.pull)), out: 1 };
  if (t < T.push) { const k = ease((t - T.travel) / (T.push - T.travel)); return { x: lerp(a.x, b.x, k), y: lerp(a.y + PULL, b.y + PULL, k) - Math.sin(k * Math.PI) * 90, out: 1 }; }
  return { ...b, y: b.y + PULL * (1 - back((t - T.push) / (T.seated - T.push))), out: t < T.seated ? 1 : 0 };
}
function cable(p) {
  const k = clamp((p.y - 328) / (788 - 328)), drop = lerp(170, 20, k), c1 = lerp(100, 30, k);
  const path = (dx) => { ctx.beginPath(); ctx.moveTo(p.x + dx, p.y + 40); ctx.bezierCurveTo(p.x + 20 + dx, p.y + c1, lerp(p.x, 1180, 0.45), p.y + drop + 60, 1180, p.y + drop + 60); ctx.stroke(); };
  ctx.lineCap = 'round'; ctx.strokeStyle = '#4A4A5C'; ctx.lineWidth = 30; path(0);
  ctx.strokeStyle = '#6A6A80'; ctx.lineWidth = 6; path(-10);
  rr(p.x - 76, p.y - 34, 152, 92, 14, '#3A3A4C', AMBER, 5);
  rr(p.x - 60, p.y - 28 - 26 * p.out, 120, 30, 6, '#B5B5C6');
}

const pressAt = (t, at) => (t >= at && t < at + 0.25 ? Math.sin(((t - at) / 0.25) * Math.PI) : 0);
/** The case's turn, in radians: 0 front, PI back, 2PI front, 3PI back. Always the same direction. */
const angle = (t) => Math.PI * (ease(span(t, T.turn1)) + ease(span(t, T.turn2)) + ease(span(t, T.turn3)));

// Camera frames [centre x, centre y, zoom] in case space; the story centre is (540, STORY.y + 700).
const FRAMES = { button: [540, 300, 1.9], full: [540, 680, 0.9], sw: [SW_C[0] - 30, SW_C[1] - 10, 2.6], ports: [545, 560, 1.5] };
function camera(t) {
  const mix = (a, b, k) => { k = ease(k); return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), a[2] * Math.pow(b[2] / a[2], k)]; };
  const F = FRAMES;
  if (t < T.pullOut[0]) return F.button;
  if (t < T.pullOut[1]) return mix(F.button, F.full, span(t, T.pullOut));
  if (t < T.zoomIn[0]) return F.full;
  if (t < T.zoomIn[1]) return mix(F.full, F.sw, span(t, T.zoomIn));
  if (t < T.zoomOut[0]) return F.sw;
  if (t < T.zoomOut[1]) return mix(F.sw, F.full, span(t, T.zoomOut));
  if (t < T.zoomPorts[0]) return F.full;
  if (t < T.zoomPorts[1]) return mix(F.full, F.ports, span(t, T.zoomPorts));
  if (t < T.zoomOut2[0]) return F.ports;
  if (t < T.zoomOut2[1]) return mix(F.ports, F.full, span(t, T.zoomOut2));
  const k = clamp((t - T.zoomOut2[1]) / (S.duration - T.zoomOut2[1]));
  return [F.full[0], F.full[1] + 40 * k, F.full[2] * (1 + 0.07 * k)];
}
const toScreen = (cam, x, y) => [W / 2 + (x - cam[0]) * cam[2], STORY.y + STORY.height / 2 + (y - cam[1]) * cam[2]];

/** The case as a box turning about its vertical axis: its side shows during a turn, so it keeps its shape and place. */
function pcBox(t, th) {
  const c = Math.cos(th), s = Math.sin(th), hw = CASE.w / 2, hd = DEPTH / 2;
  const xs = [-hw, hw].flatMap((x) => [-hd, hd].map((z) => x * c + z * s));
  const lo = Math.min(...xs), hi = Math.max(...xs);
  if (Math.abs(s) > 0.01) {
    rr(MID + lo, CASE.y, hi - lo, CASE.h, 34, '#101017', '#3A3A4A', 6);
    // Side vents, on the visible side only, so the motion reads as a turn.
    const fc = c > 0 ? hd * s : -hd * s, fLo = fc - hw * Math.abs(c), fHi = fc + hw * Math.abs(c);
    const [sLo, sHi] = fLo - lo > hi - fHi ? [lo, fLo] : [fHi, hi];
    if (sHi - sLo > 24) for (let v = 0; v < 9; v += 1) rr(MID + sLo + 12, CASE.y + 200 + v * 110, sHi - sLo - 24, 18, 9, '#1C1C26');
  }
  const powered = t >= T.light, lit = powered ? out((t - T.light) / 0.3) : 0;
  ctx.save();
  if (c > 0) {
    ctx.translate(MID + hd * s, 0); ctx.scale(c, 1); ctx.translate(-MID, 0);
    // After the press the button flashes red for up to 0.6 s, then stays red until the glimpse.
    const dead = t >= T.press1 + 0.12 && t < T.glimpse[0] ? (t - T.press1 - 0.12 >= 0.6 || Math.sin((t - T.press1 - 0.12) * Math.PI * 2 / 0.2) > -0.3 ? 1 : 0.25) : 0;
    front(t, lit, pressAt(t, T.press1) + pressAt(t, T.press2), dead);
    // The finger: in from the right for each press, gone before the turn.
    const f1 = t < T.glimpse[0] ? out(t / 0.08) : 0;
    if (f1 > 0) finger(BTN.x + BTN.r - 6 - 22 * pressAt(t, T.press1) + 120 * (1 - out(t / 0.1)), BTN.y, f1);
    const f2 = t >= T.turn2[1] && t < T.press2 + 0.45 ? clamp((t - T.turn2[1]) / 0.06) * (1 - clamp((t - (T.press2 + 0.3)) / 0.15)) : 0;
    if (f2 > 0) finger(BTN.x + BTN.r - 6 - 22 * pressAt(t, T.press2) + 120 * (1 - out((t - T.turn2[1]) / 0.1)), BTN.y, f2);
    if (powered && t < T.light + 0.6) ring(BTN.x, BTN.y, BTN.r + 30 + 120 * clamp((t - T.light) / 0.6), CYAN, 8, 1 - clamp((t - T.light) / 0.6));
  } else {
    ctx.translate(MID - hd * s, 0); ctx.scale(-c, 1); ctx.translate(-MID, 0);
    const act2 = t >= T.turn3[0];
    const k = clamp((t - T.flip) / 0.1);
    const mbLit = act2 && t < T.pull ? out(span(t, T.zoomPorts)) : act2 && t < T.travel + 0.3 ? 1 - out((t - T.pull) / 0.4) : 0;
    const target = act2 && t >= T.pull && t < T.push ? 0.55 + 0.45 * Math.sin((t - T.pull) * 9) : 0;
    const gpuLit = act2 && t >= T.push ? out((t - T.push) / 0.25) : target;
    pcBack(t, mbLit, gpuLit, k, powered);
    // Spot 1: the switch, outlined in amber while it is the subject, and again at the close.
    const sw1 = !act2 && t >= T.zoomIn[0] ? out(span(t, T.zoomIn)) * (1 - span(t, T.zoomOut)) : t >= T.final ? out((t - T.final) / 0.3) : 0;
    if (sw1 > 0) { ctx.save(); ctx.globalAlpha = sw1; rr(SW.x - 24, SW.y - 24, SW.w + 48, SW.h + 48, 16, null, AMBER, 8); ctx.restore(); }
    if (!act2 && t >= T.flip && t < T.flip + 0.5) ring(SW_C[0], SW_C[1], 80 + 60 * clamp((t - T.flip) / 0.5), GREEN, 7, 1 - clamp((t - T.flip) / 0.5));
    if (act2 && th > Math.PI * 2.5) cable(plugAt(t));
    if (act2 && t >= T.seated && t < T.seated + 0.6) {
      const p = plugAt(t), q = clamp((t - T.seated) / 0.6);
      ring(p.x, p.y + 6, 90 + 70 * q, CYAN, 8, 1 - q);
    }
    // The flip: the finger rises to the top (I) half and pushes it in.
    if (!act2 && t >= T.finger && t < T.flip + 0.45) {
      const tip = t < T.flip ? lerp(SW.y + 130, SW.y + 24, ease((t - T.finger) / (T.flip - T.finger))) : SW.y + 24;
      finger(SW.x + SW.w + 6 - (t >= T.flip && t < T.flip + 0.1 ? 8 : 0), tip, out((t - T.finger) / 0.1) * (1 - clamp((t - (T.flip + 0.3)) / 0.15)));
    }
  }
  ctx.restore();
}

// The opening's glimpse of symptom 2: the same front, lit, beside a monitor whose screen stays dark.
function glimpse(t) {
  const k = 1.04 - 0.04 * out(span(t, [T.glimpse[0], T.glimpse[0] + 0.12]));
  ctx.save(); ctx.translate(W / 2, STORY.y + 800); ctx.scale(k, k); ctx.translate(-W / 2, -(STORY.y + 800));
  ctx.save(); ctx.translate(40, 565); ctx.scale(0.5, 0.5); ctx.translate(-CASE.x, -CASE.y); front(t + T.light - T.glimpse[0] + 0.3, 1, 0, 0); ctx.restore();
  const M = { x: 470, y: 820, w: 580, h: 340 };
  rr(M.x + M.w / 2 - 30, M.y + M.h, 60, 110, 6, '#1C1C26', '#55556A', 3);
  rr(M.x + M.w / 2 - 130, M.y + M.h + 100, 260, 36, 12, '#1C1C26', '#55556A', 3);
  rr(M.x, M.y, M.w, M.h, 18, '#1C1C26', '#55556A', 4);
  rr(M.x + 18, M.y + 18, M.w - 36, M.h - 54, 8, '#050508');
  ctx.restore();
}

function story(t) {
  ctx.save(); ctx.beginPath(); ctx.rect(0, STORY.y, W, STORY.height); ctx.clip();
  ctx.fillStyle = C.background; ctx.fillRect(0, STORY.y, W, STORY.height);
  const inGlimpse = t >= T.glimpse[0] && t < T.glimpse[1];
  const cam = camera(t);
  if (inGlimpse) glimpse(t);
  else {
    ctx.save(); ctx.translate(W / 2, STORY.y + STORY.height / 2); ctx.scale(cam[2], cam[2]); ctx.translate(-cam[0], -cam[1]); zoom = cam[2];
    pcBox(t, angle(t));
    ctx.restore(); zoom = 1;
  }
  ctx.restore();

  // Screen-space labels, fixed size through the camera moves. One headline at a time at the top.
  const HEAD = STORY.y + 66;
  if (t < T.glimpse[0]) pill(S.copy.labels.noPower, W / 2, HEAD, RED, '#0A0A0F', 76, 1);
  else if (inGlimpse) pill(S.copy.labels.noPicture, W / 2, HEAD, CYAN, '#0A0A0F', 76, 1);
  else if (t < T.light + 0.2) pill(S.copy.chapters[0], W / 2, HEAD, RED, '#0A0A0F', 64, t < T.light ? 1 : 1 - (t - T.light) / 0.2);
  else if (t >= HEAD2 && t < T.zoomPorts[1]) pill(S.copy.chapters[1], W / 2, HEAD, CYAN, '#0A0A0F', 64, out((t - HEAD2) / 0.2) * (1 - span(t, [T.zoomPorts[0] + 0.1, T.zoomPorts[1]])));

  // Check 1 on the switch: its name while the camera closes in, and its state, large.
  if (t >= T.zoomIn[0] && t < T.zoomOut[1]) {
    const a = out((t - T.zoomIn[0] - 0.2) / 0.2) * (1 - span(t, T.zoomOut));
    pill(S.copy.labels.psu, W / 2, STORY.y + 330, AMBER, '#0A0A0F', 60, a);
    const k = clamp((t - T.flip) / 0.1);
    ctx.save(); ctx.globalAlpha = a; text(k >= 0.5 ? S.copy.labels.on : S.copy.labels.off, W / 2, STORY.y + 1270, W - 160, 104, 104, k >= 0.5 ? GREEN : RED, 'center', 700); ctx.restore();
  }
  // Check 2 on the ports: where the cable is, and where it goes.
  if (t >= T.zoomPorts[0] && t < T.zoomOut2[0] + 0.1) {
    const a = out((t - T.zoomPorts[1] + 0.05) / 0.2) * (1 - span(t, [T.zoomOut2[0] - 0.1, T.zoomOut2[0] + 0.1]));
    const [mx, my] = toScreen(FRAMES.ports, IO.x + IO.w / 2, IO.y - 34);
    pill(S.copy.labels.motherboard, mx + 12, my, PURPLE, '#0A0A0F', 46, a * (t < T.travel + 0.3 ? 1 : 1 - clamp((t - T.travel - 0.3) / 0.3) * 0.65));
    const [gx, gy] = toScreen(FRAMES.ports, GPU.x + GPU.w / 2, GPU.y + GPU.h + 50);
    pill(S.copy.labels.graphicsCard, gx, gy, CYAN, '#0A0A0F', 46, a);
  }
  if (t >= T.final) {
    // The close: both spots on one view, numbered as the chapters were.
    const a1 = out((t - T.final) / 0.3), a2 = out((t - T.final - 0.35) / 0.3);
    const cam = camera(t), [sx, sy] = toScreen(cam, SW_C[0], SW_C[1]);
    badge('1', sx - 100, sy, AMBER, a1); pill(S.copy.labels.psu, sx - 330, sy, AMBER, '#0A0A0F', 46, a1);
    const [gx, gy] = toScreen(cam, GPU_PORT.x + GPU_PORT.w / 2, GPU_PORT.y + GPU_PORT.h / 2);
    badge('2', gx - 140, gy - 125, CYAN, a2); pill(S.copy.labels.cable, gx - 140 - 230, gy - 125, CYAN, '#0A0A0F', 46, a2);
    ctx.save(); ctx.globalAlpha = a2 * 0.9; text(S.copy.site, W / 2, STORY.y + 70, 600, 46, 46, C.textSecondary, 'center', 600); ctx.restore();
  }
}
function badge(n, x, y, colour, a) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(x, y, 46, 0, Math.PI * 2); ctx.fillStyle = colour; ctx.fill();
  text(n, x, y + 3, 80, 60, 60, '#0A0A0F', 'center', 700); ctx.restore();
}

function labelBand() {
  ctx.fillStyle = C.surface; ctx.fillRect(0, TOP.y, W, TOP.height);
  ctx.font = '700 44px Inter'; const w = ctx.measureText(S.copy.badge).width + 60;
  rr((W - w) / 2, 34, w, 76, 38, AMBER);
  text(S.copy.badge, W / 2, 73, w, 44, 44, '#0A0A0F', 'center', 700);
  text(S.copy.line, W / 2, 152, W - 120, 42, 42, C.text, 'center', 600);
}
function captionBand(t) {
  ctx.fillStyle = C.background; ctx.fillRect(0, CAP.y, W, CAP.height);
  const cap = S.copy.captions.find((c) => t >= c.from && t < c.to) || S.copy.captions.at(-1);
  if (!cap.text) return;
  ctx.font = '700 76px Inter';
  if (ctx.measureText(cap.text).width <= W - 120) { text(cap.text, W / 2, CAP.y + CAP.height / 2, W - 120, 80, 76, C.text, 'center', 700); return; }
  // Two lines: the most balanced word break.
  const words = cap.text.split(' '); let best = null;
  for (let i = 1; i < words.length; i += 1) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const worst = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
    if (!best || worst < best.worst) best = { lines: [a, b], worst };
  }
  best.lines.forEach((line, i) => text(line, W / 2, CAP.y + CAP.height / 2 + (i - 0.5) * 92, W - 120, 76, 64, C.text, 'center', 700));
}

window.renderAt = (t) => {
  ctx.fillStyle = C.background; ctx.fillRect(0, 0, W, L.height);
  labelBand(); story(t); captionBand(t);
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

export interface ComboCut {
  readonly timing: ComboTiming;
  readonly captions: readonly { readonly from: number; readonly to: number; readonly text: string }[];
  readonly videoName: string;
}
/** The silent draft: its own timing and short captions. */
export const SILENT_CUT: ComboCut = { timing: TIMING, captions: COPY.captions, videoName: "two-checks-silent.mp4" };

export async function renderComboDraft(outputDir = OUTPUT_DIR, cut: ComboCut = SILENT_CUT) {
  const copy = { ...COPY, captions: cut.captions };
  const problems = comboCopyProblems([...copy.captions.map((c) => c.text).filter(Boolean), ...COPY.chapters, ...Object.values(COPY.labels), PROPOSED_NARRATION]);
  if (problems.length) throw new Error(`Copy breaks the rules:\n- ${problems.join("\n- ")}`);
  await mkdir(outputDir, { recursive: true });
  const framesDir = join(outputDir, "work");
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  const faces: string[] = [];
  for (const [weight, file] of Object.entries(FONT_FILES)) {
    faces.push(`@font-face{font-family:Inter;font-weight:${weight};src:url(data:font/woff2;base64,${(await readFile(join(FONT_DIR, file))).toString("base64")}) format('woff2');}`);
  }
  const state = { layout: LAYOUT, colours: SPECSMITH_MOTION_COLOURS, copy, timing: cut.timing, duration: cut.timing.durationSeconds };
  const duration = cut.timing.durationSeconds, count = Math.round(duration * FPS);
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
  const videoPath = join(outputDir, cut.videoName);
  await run("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", join(framesDir, "f-%04d.png"),
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "0:v", "-map", "1:a",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
    "-t", duration.toFixed(3), "-movflags", "+faststart", videoPath]);
  if (cut === SILENT_CUT) await run("ffmpeg", ["-v", "error", "-y", "-i", videoPath, "-vf", "fps=4,scale=180:320:flags=lanczos,tile=13x4:padding=4:color=0x2A2A33", "-frames:v", "1", join(outputDir, "phone-every-0.25s.png")]);
  await rm(framesDir, { recursive: true, force: true });
  return { videoPath, sha256: createHash("sha256").update(await readFile(videoPath)).digest("hex"), minFinalPx, durationSeconds: duration };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  renderComboDraft().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error); process.exitCode = 1; });
}
