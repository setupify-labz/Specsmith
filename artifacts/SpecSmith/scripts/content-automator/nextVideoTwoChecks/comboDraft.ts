#!/usr/bin/env tsx
// "New PC not working? Check these two spots." A 12.3 s silent Short that
// joins the PSU-switch cut and the monitor-port animation into one story about
// ONE stylized PC, which the camera turns rather than cutting between clips:
//
//   1. Won't power on: a dead press at the front; turn to the back; the power
//      supply's switch, O to I; turn to the front; press; it lights up.
//   2. On, but no picture: turn to the back again; the monitor cable is in the
//      motherboard's ports; one move to the graphics card's ports.
//   Close: both spots marked 1 and 2 on the same back view.
//
// The art is the existing art, reused: the front of the case and the rocker
// come from nextVideoPowerSwitch/openingTest.ts, the back (port panel, fan,
// slots, graphics card, power supply, cable) from
// nextVideoMonitorPort/illustrativeDraft.ts, with the rocker fitted to that
// power supply so it is the same machine. The fan stays still until the PC
// powers on and turns from then on, which carries symptom 1 into symptom 2.
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

/** Every event, in seconds. One PC, three turns, two checks. */
export const TIMING = Object.freeze({
  durationSeconds: 12.3,
  press1: 0.15, turn1: [1.2, 1.55], hold1: [1.55, 2.5], zoomIn: [2.5, 2.8], flip: 3.4, zoomOut: [3.9, 4.2],
  turn2: [4.2, 4.55], press2: 4.7, light: 4.8,
  turn3: [5.55, 5.9], hold2: [5.9, 6.8], pull: 6.8, travel: 7.0, push: 8.4, seated: 8.6,
  final: 10.0,
});

export const COPY = Object.freeze({
  badge: "ILLUSTRATION",
  line: "Stylized example · not a fix for every PC",
  chapters: ["1 · WON'T POWER ON", "2 · ON, BUT NO PICTURE"],
  captions: [
    { from: 0, to: 2.4, text: "New PC not working? Check these two spots." },
    { from: 2.4, to: 5.55, text: "1. Power supply switch: O is off, I is on." },
    { from: 5.55, to: 7.0, text: "2. PC on, but no picture?" },
    { from: 7.0, to: 10.0, text: "Is your monitor plugged into the graphics card?" },
    { from: 10.0, to: 12.3, text: "Check these two spots first." },
  ],
  labels: { psu: "PSU SWITCH", motherboard: "MOTHERBOARD PORTS", graphicsCard: "GRAPHICS CARD PORTS", cable: "MONITOR CABLE", noPower: "NOTHING HAPPENS", on: "ON" },
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
const canvas = document.getElementById('c'); const ctx = canvas.getContext('2d');
const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const out = (x) => 1 - Math.pow(1 - clamp(x), 3);
const back = (x) => { x = clamp(x); const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const lerp = (a, b, k) => a + (b - a) * k;
const span = (t, sp) => clamp((t - sp[0]) / (sp[1] - sp[0]));
const measured = { minFinalPx: Infinity, misfits: [] };
let zoom = 1;
const PURPLE = C.accentText, CYAN = C.cyan, RED = '#FF5A6E', GREEN = C.green;

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

// ---- FRONT of the case (from nextVideoPowerSwitch/openingTest.ts). ----
const CASE_F = { x: 290, y: 140, w: 500, h: 1160 }, BTN = { x: 540, y: 270, r: 58 };
function front(lit, pressed) {
  rr(CASE_F.x, CASE_F.y, CASE_F.w, CASE_F.h, 34, '#16161F', lit > 0 ? 'rgba(108,99,255,' + (0.4 + 0.6 * lit) + ')' : '#3A3A4A', 6);
  for (let i = 0; i < 3; i += 1) {
    const cy = 560 + i * 250;
    ctx.beginPath(); ctx.arc(540, cy, 105, 0, Math.PI * 2);
    ctx.strokeStyle = lit > 0 ? (i % 2 ? 'rgba(0,212,255,' + lit + ')' : 'rgba(108,99,255,' + lit + ')') : '#2E2E3A'; ctx.lineWidth = lit > 0 ? 10 : 5; ctx.stroke();
    ctx.beginPath(); ctx.arc(540, cy, 34, 0, Math.PI * 2); ctx.fillStyle = '#2A2A36'; ctx.fill();
  }
  const r = BTN.r * (1 - 0.08 * pressed);
  ctx.beginPath(); ctx.arc(BTN.x, BTN.y, r, 0, Math.PI * 2); ctx.fillStyle = '#1F1F2A'; ctx.fill();
  ctx.strokeStyle = lit > 0 ? CYAN : '#6A6A80'; ctx.lineWidth = 7; ctx.stroke();
  if (lit > 0) { ctx.save(); ctx.globalAlpha = 0.35 * lit; ctx.beginPath(); ctx.arc(BTN.x, BTN.y, r + 26, 0, Math.PI * 2); ctx.strokeStyle = CYAN; ctx.lineWidth = 16; ctx.stroke(); ctx.restore(); }
  ctx.strokeStyle = lit > 0 ? CYAN : '#8A8AA0'; ctx.lineWidth = 8; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(BTN.x, BTN.y + 4, 26, -Math.PI / 2 + 0.7, -Math.PI / 2 - 0.7 + Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(BTN.x, BTN.y - 30); ctx.lineTo(BTN.x, BTN.y + 2); ctx.stroke();
}

// ---- BACK of the same case (from nextVideoMonitorPort/illustrativeDraft.ts), with the rocker on its PSU. ----
const CASE = { x: 150, y: 30, w: 780, h: 1340 };
const IO = { x: 200, y: 200, w: 230, h: 470 };
const GPU = { x: 200, y: 740, w: 690, h: 96 };
const MB_PORT = { x: 250, y: 300, w: 130, h: 56 };
const GPU_PORT = { x: 740, y: 760, w: 130, h: 56 };
const SW = { x: 782, y: 1165, w: 64, h: 100 };
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
function rocker(on) {
  const s = SW, half = s.h / 2;
  rr(s.x - 7, s.y - 7, s.w + 14, s.h + 14, 10, '#0B0B10', '#55556A', 3);
  rr(s.x, s.y, s.w, half, 7, on ? '#2A2A36' : '#4A4A5E');
  rr(s.x, s.y + half, s.w, half, 7, on ? '#4A4A5E' : '#2A2A36');
  ctx.lineCap = 'round'; ctx.lineWidth = 7;
  ctx.strokeStyle = on ? GREEN : '#9A9AB0'; ctx.beginPath(); ctx.moveTo(s.x + s.w / 2, s.y + 13); ctx.lineTo(s.x + s.w / 2, s.y + half - 13); ctx.stroke();
  ctx.strokeStyle = on ? '#9A9AB0' : RED; ctx.beginPath(); ctx.arc(s.x + s.w / 2, s.y + half * 1.5, 13, 0, Math.PI * 2); ctx.stroke();
}
function pcBack(t, mbLit, gpuLit, on, powered) {
  rr(CASE.x, CASE.y, CASE.w, CASE.h, 34, '#15151E', '#3A3A4A', 6);
  rr(IO.x, IO.y, IO.w, IO.h, 12, '#1D1D28', '#44445A', 3);
  const mbColour = mbLit > 0 ? PURPLE : '#C9C9D6';
  usb(IO.x + 25, IO.y + 30); usb(IO.x + 125, IO.y + 30); usb(IO.x + 25, IO.y + 72); usb(IO.x + 125, IO.y + 72);
  hdmi(MB_PORT, mbColour, 5); dp({ x: 255, y: 380, w: 120, h: 56 }, mbColour, 5);
  rr(IO.x + 80, IO.y + 270, 70, 64, 8, '#0B0B10', '#55556A', 3);
  for (let i = 0; i < 3; i += 1) { ctx.beginPath(); ctx.arc(IO.x + 60 + i * 55, IO.y + 405, 17, 0, Math.PI * 2); ctx.strokeStyle = '#55556A'; ctx.lineWidth = 4; ctx.stroke(); }
  // The exhaust fan: still while the PC has no power, turning once it is on.
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
  for (let k = 0; k < 4; k += 1) { const y = 870 + k * 52; rr(GPU.x, y, GPU.w, 42, 6, '#1B1B25', '#33333F', 2); for (let v = 0; v < 10; v += 1) rr(GPU.x + 120 + v * 46, y + 15, 30, 12, 6, '#2A2A36'); }
  rr(200, 1110, 690, 230, 12, '#1B1B25', '#3A3A4A', 3);
  for (const r of [40, 70, 95]) { ctx.beginPath(); ctx.arc(390, 1225, r, 0, Math.PI * 2); ctx.strokeStyle = '#2E2E3A'; ctx.lineWidth = 4; ctx.stroke(); }
  rr(620, 1175, 120, 90, 10, '#0B0B10', '#55556A', 3);
  rocker(on);
  glow(IO, PURPLE, mbLit); glow(GPU, CYAN, gpuLit);
}

/** The cable (monitor-port timing re-based on T), seated in the graphics card by T.seated. */
function plugAt(t) {
  const a = { x: MB_PORT.x + MB_PORT.w / 2, y: MB_PORT.y + MB_PORT.h / 2 }, b = { x: GPU_PORT.x + GPU_PORT.w / 2, y: GPU_PORT.y + GPU_PORT.h / 2 };
  if (t < T.pull) return { ...a, out: 0 };
  if (t < T.travel) return { ...a, y: a.y + 70 * out((t - T.pull) / (T.travel - T.pull)), out: 1 };
  if (t < T.push) { const k = ease((t - T.travel) / (T.push - T.travel)); return { x: lerp(a.x, b.x, k), y: lerp(a.y + 70, b.y + 70, k) - Math.sin(k * Math.PI) * 90, out: 1 }; }
  return { ...b, y: b.y + 70 * (1 - back((t - T.push) / (T.seated - T.push))), out: t < T.seated ? 1 : 0 };
}
function cable(p) {
  const k = clamp((p.y - 328) / (788 - 328)), drop = lerp(170, 20, k), c1 = lerp(100, 30, k);
  const path = (dx) => { ctx.beginPath(); ctx.moveTo(p.x + dx, p.y + 40); ctx.bezierCurveTo(p.x + 20 + dx, p.y + c1, lerp(p.x, 1180, 0.45), p.y + drop, 1180, p.y + drop); ctx.stroke(); };
  ctx.lineCap = 'round'; ctx.strokeStyle = '#4A4A5C'; ctx.lineWidth = 30; path(0);
  ctx.strokeStyle = '#6A6A80'; ctx.lineWidth = 6; path(-10);
  rr(p.x - 76, p.y - 34, 152, 92, 14, '#2E2E3C', '#8A8AA0', 3);
  rr(p.x - 60, p.y - 28 - 26 * p.out, 120, 30, 6, '#9A9AB0');
}

const pressAt = (t, at) => (t >= at && t < at + 0.25 ? Math.sin(((t - at) / 0.25) * Math.PI) : 0);
/** Which face shows, and how wide (the turn squeezes to the edge and opens out). */
function face(t) {
  const turns = [T.turn1, T.turn2, T.turn3];
  let backSide = false, sx = 1;
  for (const tr of turns) {
    if (t >= tr[1]) { backSide = !backSide; continue; }
    if (t >= tr[0]) { const k = span(t, tr); if (k >= 0.5) backSide = !backSide; sx = Math.abs(Math.cos(k * Math.PI)); }
    break;
  }
  return { backSide, sx: Math.max(sx, 0.02) };
}
const SW_C = [SW.x + SW.w / 2, SW.y + SW.h / 2];
// The whole back of the case in frame, power supply included, so both spots are always visible.
const BACK_FRAME = [540, 700, 1.0];

function story(t) {
  ctx.save(); ctx.beginPath(); ctx.rect(0, STORY.y, W, STORY.height); ctx.clip();
  ctx.fillStyle = C.background; ctx.fillRect(0, STORY.y, W, STORY.height);
  const f = face(t);
  const on = t >= T.flip, powered = t >= T.light;
  const zIn = t < T.zoomIn[0] || t >= T.turn2[0] ? 0 : t < T.zoomOut[0] ? ease(span(t, T.zoomIn)) : 1 - ease(span(t, T.zoomOut));
  const base = f.backSide ? BACK_FRAME : [540, 600, 1.45];
  const z = lerp(base[2], 2.9, zIn), cx = lerp(base[0], SW_C[0], zIn), cy = lerp(base[1], SW_C[1], zIn);
  ctx.translate(W / 2, STORY.y + STORY.height / 2); ctx.scale(z * f.sx, z); ctx.translate(-cx, -cy); zoom = z;

  const final = t >= T.final;
  if (f.backSide) {
    const act2 = t >= T.turn3[0];
    const mbLit = act2 && t < T.pull ? 1 : act2 && t < T.travel + 0.3 ? 1 - out((t - T.pull) / 0.4) : 0;
    const gpuLit = final ? out((t - T.final) / 0.3) : act2 && t >= T.push ? out((t - T.push) / 0.25) : 0;
    pcBack(t, mbLit, gpuLit, on, powered);
    // Spot 1 on the back: the switch, outlined in amber while it is the subject, and again at the close.
    const sw1 = !act2 && t >= T.hold1[0] ? 1 - span(t, T.zoomIn) : final ? out((t - T.final) / 0.3) : 0;
    if (sw1 > 0) {
      const pulse = final ? 1 : 0.6 + 0.4 * Math.sin((t - T.hold1[0]) * 7);
      ctx.save(); ctx.globalAlpha = sw1 * pulse; rr(SW.x - 24, SW.y - 24, SW.w + 48, SW.h + 48, 16, null, C.amber, 8); ctx.restore();
    }
    if (act2) { cable(plugAt(t)); }
    if (act2 && t >= T.seated && t < T.seated + 0.6) {
      const p = plugAt(t), k2 = clamp((t - T.seated) / 0.6);
      ctx.save(); ctx.globalAlpha = 1 - k2; ctx.strokeStyle = CYAN; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(p.x, p.y + 6, 90 + 70 * k2, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    // The switch flip.
    if (t > T.flip - 0.6 && t < T.flip + 0.4) {
      const tip = t < T.flip ? lerp(SW.y + 110, SW.y + 22, ease((t - (T.flip - 0.6)) / 0.6)) : SW.y + 22;
      finger(SW.x + SW.w + 4, tip, 1 - clamp((t - (T.flip + 0.25)) / 0.15));
    }
  } else {
    front(powered ? out((t - T.light) / 0.3) : 0, pressAt(t, T.press1) + pressAt(t, T.press2));
    const f1 = t < 1.0 ? 1 - clamp((t - 0.8) / 0.2) : 0;
    if (f1 > 0) finger(BTN.x + BTN.r - 6 - 18 * pressAt(t, T.press1) + 90 * (1 - out(t / 0.12)), BTN.y, f1);
    const f2 = t >= T.turn2[1] ? clamp((t - T.turn2[1]) / 0.06) * (1 - clamp((t - (T.press2 + 0.35)) / 0.15)) : 0;
    if (f2 > 0) finger(BTN.x + BTN.r - 6 - 18 * pressAt(t, T.press2), BTN.y, f2);
  }
  ctx.restore(); zoom = 1;

  // Screen-space labels: large, fixed size through the zoom.
  const backY = (y) => STORY.y + STORY.height / 2 + (y - BACK_FRAME[1]) * BACK_FRAME[2], backX = (x) => W / 2 + (x - BACK_FRAME[0]) * BACK_FRAME[2];
  pill(S.copy.labels.noPower, W / 2, STORY.y + 440, RED, '#0A0A0F', 64, t >= 0.3 && t < T.turn1[0] + 0.05 ? out((t - 0.3) / 0.12) : 0);
  if (f.backSide && t < T.turn2[0]) {
    const a = t >= T.hold1[0] && t < T.zoomIn[0] + 0.1 ? out((t - T.hold1[0]) / 0.2) : 0;
    if (a > 0) {
      ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = C.amber; ctx.lineWidth = 8; ctx.lineCap = 'round';
      const ax = backX(SW_C[0]), ay0 = backY(1000), ay1 = backY(SW.y - 30);
      ctx.beginPath(); ctx.moveTo(ax, ay0); ctx.lineTo(ax, ay1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ax - 20, ay1 - 22); ctx.lineTo(ax, ay1); ctx.lineTo(ax + 20, ay1 - 22); ctx.stroke(); ctx.restore();
      pill(S.copy.labels.psu, ax - 120, ay0 - 40, C.amber, '#0A0A0F', 60, a);
    }
    if (zIn > 0.6) {
      pill(S.copy.labels.psu, W / 2, STORY.y + 210, C.amber, '#0A0A0F', 60, 1);
      text(on ? 'I = ON' : 'O = OFF', W / 2, STORY.y + 1290, W - 160, 84, 84, on ? GREEN : RED, 'center', 700);
    }
  }
  pill(S.copy.labels.on, W / 2, STORY.y + 440, GREEN, '#0A0A0F', 64, !f.backSide && t >= T.light + 0.1 && t < T.turn3[0] + 0.1 ? out((t - T.light - 0.1) / 0.15) : 0);
  if (f.backSide && t >= T.turn3[1] && t < T.final) {
    const a = out((t - T.turn3[1]) / 0.25);
    pill(S.copy.labels.motherboard, backX(470), backY(140), PURPLE, '#0A0A0F', 48, a);
    pill(S.copy.labels.graphicsCard, backX(540), backY(880), CYAN, '#0A0A0F', 48, a);
    pill(S.copy.labels.cable, backX(760), backY(640), C.amber, '#0A0A0F', 44, t < T.pull + 0.2 ? a * (1 - clamp((t - T.pull) / 0.2)) : 0);
  }
  if (final) {
    // The close: both spots on one view, numbered as the chapters were.
    const a = out((t - T.final) / 0.3);
    badge('1', backX(SW.x - 70), backY(SW_C[1]), C.amber, a);
    badge('2', backX(GPU.x - 10), backY(GPU.y - 60), CYAN, a);
    ctx.save(); ctx.globalAlpha = a * 0.9; text(S.copy.site, W / 2, backY(1060), 600, 42, 42, C.textSecondary, 'center', 600); ctx.restore();
  }
  // Chapter tag: which symptom this is.
  const chapter = t < T.turn3[0] - 0.1 ? 0 : t < T.final ? 1 : -1;
  if (chapter >= 0 && t >= 0) {
    const a = chapter === 0 ? 1 : out((t - (T.turn3[0] - 0.1)) / 0.25);
    ctx.save(); ctx.globalAlpha = a;
    ctx.font = '700 42px Inter'; const w = ctx.measureText(S.copy.chapters[chapter]).width + 44;
    rr(34, STORY.y + 30, w, 64, 32, 'rgba(10,10,15,0.82)', chapter === 0 ? C.amber : CYAN, 3);
    text(S.copy.chapters[chapter], 34 + w / 2, STORY.y + 63, w, 42, 42, chapter === 0 ? C.amber : CYAN, 'center', 700);
    ctx.restore();
  }
  ctx.restore();
}
function badge(n, x, y, colour, a) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(x, y, 46, 0, Math.PI * 2); ctx.fillStyle = colour; ctx.fill();
  text(n, x, y + 3, 80, 60, 60, '#0A0A0F', 'center', 700); ctx.restore();
}

function labelBand() {
  ctx.fillStyle = C.surface; ctx.fillRect(0, TOP.y, W, TOP.height);
  ctx.font = '700 44px Inter'; const w = ctx.measureText(S.copy.badge).width + 60;
  rr((W - w) / 2, 34, w, 76, 38, C.amber);
  text(S.copy.badge, W / 2, 73, w, 44, 44, '#0A0A0F', 'center', 700);
  text(S.copy.line, W / 2, 152, W - 120, 42, 42, C.text, 'center', 600);
}
function captionBand(t) {
  ctx.fillStyle = C.background; ctx.fillRect(0, CAP.y, W, CAP.height);
  const cap = S.copy.captions.find((c) => t >= c.from && t < c.to) || S.copy.captions.at(-1);
  ctx.font = '700 72px Inter';
  if (ctx.measureText(cap.text).width <= W - 120) { text(cap.text, W / 2, CAP.y + CAP.height / 2, W - 120, 80, 72, C.text, 'center', 700); return; }
  // Two lines: a sentence break if one fits, else the most balanced word break.
  // Break after ":", "?" or "!" or a sentence's ".", never after a leading "1." or "2.".
  let lines = null;
  for (let i = 3; i < cap.text.length - 1 && !lines; i += 1) {
    if (!/[.?!:]/.test(cap.text[i]) || cap.text[i + 1] !== ' ') continue;
    const a = cap.text.slice(0, i + 1), b = cap.text.slice(i + 2);
    if (ctx.measureText(a).width <= W - 120 && ctx.measureText(b).width <= W - 120) lines = [a, b];
  }
  if (!lines) {
    const words = cap.text.split(' '); let best = null;
    for (let i = 1; i < words.length; i += 1) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      const worst = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
      if (!best || worst < best.worst) best = { lines: [a, b], worst };
    }
    lines = best.lines;
  }
  lines.forEach((line, i) => text(line, W / 2, CAP.y + CAP.height / 2 + (i - 0.5) * 90, W - 120, 72, 64, C.text, 'center', 700));
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

export async function renderComboDraft(outputDir = OUTPUT_DIR) {
  const problems = comboCopyProblems();
  if (problems.length) throw new Error(`Copy breaks the rules:\n- ${problems.join("\n- ")}`);
  await mkdir(outputDir, { recursive: true });
  const framesDir = join(outputDir, "work");
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  const faces: string[] = [];
  for (const [weight, file] of Object.entries(FONT_FILES)) {
    faces.push(`@font-face{font-family:Inter;font-weight:${weight};src:url(data:font/woff2;base64,${(await readFile(join(FONT_DIR, file))).toString("base64")}) format('woff2');}`);
  }
  const state = { layout: LAYOUT, colours: SPECSMITH_MOTION_COLOURS, copy: COPY, timing: TIMING };
  const duration = TIMING.durationSeconds, count = Math.round(duration * FPS);
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
  const videoPath = join(outputDir, "two-checks-silent.mp4");
  await run("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", join(framesDir, "f-%04d.png"),
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "0:v", "-map", "1:a",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
    "-t", duration.toFixed(3), "-movflags", "+faststart", videoPath]);
  await run("ffmpeg", ["-v", "error", "-y", "-i", videoPath, "-vf", "fps=4,scale=180:320:flags=lanczos,tile=13x4:padding=4:color=0x2A2A33", "-frames:v", "1", join(outputDir, "phone-every-0.25s.png")]);
  await rm(framesDir, { recursive: true, force: true });
  return { videoPath, sha256: createHash("sha256").update(await readFile(videoPath)).digest("hex"), minFinalPx, durationSeconds: duration };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  renderComboDraft().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error); process.exitCode = 1; });
}
