#!/usr/bin/env tsx
// "Added RAM, now it won't boot?" A 12.4 s Short in the style of the two-checks
// Short: the same stylized PC, palette, label pills, caption band and
// ILLUSTRATION band. Every step is animated rather than described:
//
//   PROBLEM     the PC powers on (fans light) beside a monitor that stays dark.
//   POWER OFF   a second press shuts it down (the fans slow to a stop); at the
//               back, the power cord comes out of the power supply.
//   LOCATION    the glass side panel slides off; straight to the four memory
//               slots beside the cooler; one stick is not fully in.
//   ACTION      a side profile of that slot: the notch lines up with the slot's
//               ridge, the stick goes in, thumbs press it down firmly and evenly,
//               and the clips at the ends of the slot snap shut.
//   PAYOFF      the stick sits level and fully seated.
//   POWER BACK  the panel goes back on and the cord goes back in.
//   TRY AGAIN   the unlit PC, its power button pulsing. No boot and no screen
//               result are shown, and no fix is promised.
//
// THE CLAIMS, and where they come from (Crucial, "How to Install Memory in Your
// Desktop", crucial.com/support/install-memory-desktop):
//   - "Shut down your system. Once your system has been powered off, unplug the
//     power cable."
//   - "Align the notches on the module with the ridges in the memory slot."
//   - "Insert module using firm and even pressure, and push down on the module
//     until the clips on the side of the slot snap into place."
//   - "If you receive an error message or hear a series of beeps, your system
//     may not be recognizing the new memory. Remove and reinstall the modules
//     to ensure they are securely seated in the sockets."
// Not claimed: which slots to use (it depends on the board's labels), that
// reseating fixes a PC, or what the monitor shows afterwards. The slot is drawn
// with a clip at each end, as Crucial describes; some boards latch one end only,
// and every frame says "Stylized example · not a fix for every PC".
//
// Every frame is rendered in order (no frame reuse or caching), so the output
// cannot be assembled out of sequence; the test checks the order.
//
//   SPECSMITH_RENDER_CHROMIUM=/opt/pw-browsers/chromium \
//   pnpm exec tsx scripts/content-automator/nextVideoRamSeat/silentCut.ts

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launchBrowser } from "../uiRender/capture.ts";
import { SPECSMITH_MOTION_COLOURS } from "../v2/creative/dataMotionGraphic.ts";
import { FORBIDDEN_CLAIMS } from "../nextVideoMonitorPort/storyboard.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const OUTPUT_DIR = resolve(here, "../../../render-output/ram-seat-silent");
const FONT_DIR = resolve(here, "../nextVideoRefreshRate/fonts");
const FONT_FILES = { 400: "inter-latin-400-normal.woff2", 600: "inter-latin-600-normal.woff2", 700: "inter-latin-700-normal.woff2" } as const;
export const FPS = 30;
export const MIN_FINAL_PX = 42;
export const LAYOUT = Object.freeze({ width: 1080, height: 1920, label: { y: 0, height: 200 }, story: { y: 200, height: 1400 }, captions: { y: 1600, height: 320 } });

/** Every event, in seconds, in story order: problem, power off, location, action, power back, try again. */
export const TIMING = Object.freeze({
  durationSeconds: 12.4,
  // PROBLEM: powers on, monitor stays dark.
  press: 0.2, light: 0.35,
  // POWER OFF: shut down (fans stop), then the cord comes out of the power supply.
  offPress: [1.45, 1.8] as const, fansOff: [1.75, 2.15] as const, toRear: [2.15, 2.35] as const, unplug: [2.5, 2.85] as const,
  // LOCATION: panel off, straight to the memory slots.
  toSide: [3.2, 3.4] as const, panelOff: [3.4, 3.75] as const, zoomSlots: [3.75, 4.4] as const, flag: 4.2,
  // ACTION (side profile of the slot)
  toProfile: [4.85, 5.05] as const, align: [5.2, 5.8] as const, lower: [5.9, 6.4] as const,
  thumbsIn: [6.5, 6.75] as const, press2: [6.8, 7.25] as const, clips: [7.07, 7.27] as const, thumbsOut: [7.75, 8.0] as const,
  seated: 8.0,
  // POWER BACK: panel on, cord back in; then the unlit PC, its button inviting a try. No boot is shown.
  toBoard: [8.6, 8.8] as const, panelOn: [8.9, 9.25] as const, toRearAgain: [9.35, 9.55] as const, plugIn: [9.7, 10.05] as const,
  toFront: [10.55, 10.75] as const,
});
export const BEATS = Object.freeze([
  { name: "problem", from: 0, to: TIMING.offPress[0] },
  { name: "power-off", from: TIMING.offPress[0], to: TIMING.toSide[0] },
  { name: "location", from: TIMING.toSide[0], to: TIMING.toProfile[0] },
  { name: "action", from: TIMING.toProfile[0], to: TIMING.seated },
  { name: "payoff", from: TIMING.seated, to: TIMING.toBoard[1] },
  { name: "power-back", from: TIMING.toBoard[1], to: TIMING.toFront[0] },
  { name: "try-again", from: TIMING.toFront[0], to: TIMING.durationSeconds },
] as const);

/** When each label is on screen (mirrors the drawing code below), for the reading-speed check. */
export const LABEL_WINDOWS = Object.freeze([
  { key: "problem", from: 0, to: TIMING.offPress[0] },
  { key: "unplug", from: TIMING.offPress[0], to: TIMING.toSide[0] },
  { key: "slots", from: TIMING.zoomSlots[1] - 0.2, to: TIMING.toProfile[0] },
  { key: "notSeated", from: TIMING.flag, to: TIMING.toProfile[0] },
  { key: "view", from: TIMING.toProfile[0], to: TIMING.clips[0] },
  { key: "notch", from: TIMING.toProfile[0], to: TIMING.thumbsIn[0] },
  { key: "pressure", from: TIMING.thumbsIn[0], to: TIMING.seated },
  { key: "clips", from: TIMING.clips[0], to: TIMING.seated },
  { key: "seated", from: TIMING.seated, to: TIMING.toRearAgain[0] },
  { key: "plugIn", from: TIMING.toRearAgain[0], to: TIMING.toFront[0] },
] as const);

export const COPY = Object.freeze({
  badge: "ILLUSTRATION",
  line: "Stylized example · not a fix for every PC",
  captions: [
    { from: 0, to: 1.45, text: "Added RAM, now it won't boot?" },
    { from: 1.45, to: 3.2, text: "Shut it down and unplug it first." },
    { from: 3.2, to: 4.85, text: "Check that each stick is fully seated." },
    { from: 4.85, to: 6.5, text: "Line up the notch with the slot." },
    { from: 6.5, to: 8.6, text: "Press firmly until the clips snap shut." },
    { from: 8.6, to: 10.55, text: "Plug it back in." },
    { from: 10.55, to: 12.4, text: "Then try booting again." },
  ],
  labels: { problem: "WON'T BOOT?", unplug: "SHUT DOWN, THEN UNPLUG", slots: "RAM SLOTS", notSeated: "NOT FULLY IN", notch: "LINE UP THE NOTCH", pressure: "FIRM, EVEN PRESSURE", clips: "CLIPS SNAP SHUT", seated: "FULLY SEATED", plugIn: "POWER CORD BACK IN", view: "SIDE VIEW OF THE SLOT" },
  sources: ["Crucial, How to Install Memory in Your Desktop: crucial.com/support/install-memory-desktop"],
});

/** Copy that breaks the forbidden-claims rules (no guaranteed fix, no "every", no FPS…). */
export function copyProblems(): string[] {
  const texts = [...COPY.captions.map((c) => c.text), ...Object.values(COPY.labels)];
  return texts.flatMap((text) => FORBIDDEN_CLAIMS.filter(({ pattern }) => pattern.test(text)).map(({ why }) => `"${text}": ${why}`));
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
const PURPLE = C.accentText, CYAN = C.cyan, RED = '#FF5A6E', GREEN = C.green, AMBER = C.amber;

function text(s, x, y, maxWidth, max, min, colour, align, weight) {
  let size = max;
  for (; size >= min; size -= 1) { ctx.font = weight + ' ' + size + 'px Inter'; if (ctx.measureText(s).width <= maxWidth) break; }
  if (size < min) { size = min; measured.misfits.push(s); }
  ctx.font = weight + ' ' + size + 'px Inter'; ctx.fillStyle = colour; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
  measured.minFinalPx = Math.min(measured.minFinalPx, size);
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
function ring(x, y, r, colour, lw, a) { if (a <= 0) return; ctx.save(); ctx.globalAlpha *= a; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.strokeStyle = colour; ctx.lineWidth = lw; ctx.stroke(); ctx.restore(); }
function fan(cx, cy, r, spin, lit) {
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.strokeStyle = lit ? 'rgba(108,99,255,0.9)' : '#33333F'; ctx.lineWidth = lit ? 8 : 5; ctx.stroke();
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(spin);
  for (let b = 0; b < 5; b += 1) { ctx.rotate((Math.PI * 2) / 5); ctx.beginPath(); ctx.moveTo(r * 0.3, 0); ctx.quadraticCurveTo(r * 0.65, r * 0.22, r * 0.86, r * 0.08); ctx.strokeStyle = '#3A3A50'; ctx.lineWidth = Math.max(4, r * 0.07); ctx.lineCap = 'round'; ctx.stroke(); }
  ctx.restore(); ctx.beginPath(); ctx.arc(cx, cy, r * 0.28, 0, Math.PI * 2); ctx.fillStyle = '#2A2A36'; ctx.fill();
}

// ---- The same stylized PC as the two-checks Short. ----
const CASE = { x: 150, y: 30, w: 780, h: 1340 };
const BTN = { x: 540, y: 150, r: 62 };
function front(spinT, lit, pressed) {
  rr(CASE.x, CASE.y, CASE.w, CASE.h, 34, '#16161F', lit > 0 ? 'rgba(108,99,255,' + (0.4 + 0.6 * lit) + ')' : '#3A3A4A', 6);
  rr(330, 137, 80, 26, 5, '#0B0B10', '#55556A', 3); rr(670, 137, 80, 26, 5, '#0B0B10', '#55556A', 3);
  rr(200, 280, 680, 1040, 20, '#121219', '#2A2A36', 3);
  for (let i = 0; i < 3; i += 1) {
    const cy = 450 + i * 350, col = i % 2 ? '0,212,255' : '108,99,255';
    ctx.beginPath(); ctx.arc(540, cy, 140, 0, Math.PI * 2);
    ctx.strokeStyle = lit > 0 ? 'rgba(' + col + ',' + lit + ')' : '#2E2E3A'; ctx.lineWidth = lit > 0 ? 14 : 6; ctx.stroke();
    ctx.save(); ctx.translate(540, cy); ctx.rotate(Math.max(0, spinT - T.light) * 5 + i);
    for (let b = 0; b < 5; b += 1) { ctx.rotate((Math.PI * 2) / 5); ctx.beginPath(); ctx.moveTo(48, 0); ctx.quadraticCurveTo(90, 30, 118, 12); ctx.strokeStyle = lit > 0 ? '#3A3A50' : '#24242E'; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.stroke(); }
    ctx.restore();
    ctx.beginPath(); ctx.arc(540, cy, 44, 0, Math.PI * 2); ctx.fillStyle = '#2A2A36'; ctx.fill();
  }
  const r = BTN.r * (1 - 0.1 * pressed);
  ctx.beginPath(); ctx.arc(BTN.x, BTN.y, r, 0, Math.PI * 2); ctx.fillStyle = '#1F1F2A'; ctx.fill();
  ctx.strokeStyle = lit > 0 ? CYAN : '#6A6A80'; ctx.lineWidth = 7; ctx.stroke();
  if (lit > 0) ring(BTN.x, BTN.y, r + 26, CYAN, 16, 0.35 * lit);
  ctx.strokeStyle = lit > 0 ? CYAN : '#8A8AA0'; ctx.lineWidth = 8; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(BTN.x, BTN.y + 4, 26, -Math.PI / 2 + 0.7, -Math.PI / 2 - 0.7 + Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(BTN.x, BTN.y - 30); ctx.lineTo(BTN.x, BTN.y + 2); ctx.stroke();
}
/** The fans' spin clock: running while powered, slowing to a stop as the PC shuts down. */
function spinClock(t) {
  if (t < T.fansOff[0]) return t;
  const d = T.fansOff[1] - T.fansOff[0], k = span(t, T.fansOff);
  return T.fansOff[0] + d * (k - 0.5 * k * k);
}
function pcAndMonitor(t, lit, pressed, buttonPulse) {
  ctx.save(); ctx.translate(40, 565); ctx.scale(0.5, 0.5); ctx.translate(-CASE.x, -CASE.y); front(spinClock(t), lit, pressed);
  if (buttonPulse > 0) { ring(BTN.x, BTN.y, BTN.r + 34 + 16 * Math.sin(t * 6), AMBER, 18, buttonPulse * (0.6 + 0.4 * Math.sin(t * 6))); ring(BTN.x, BTN.y, BTN.r + 6, AMBER, 10, buttonPulse); }  // amber: "press here", never the cyan of a powered PC
  ctx.restore();
  const M = { x: 470, y: 820, w: 580, h: 340 };
  rr(M.x + M.w / 2 - 30, M.y + M.h, 60, 110, 6, '#1C1C26', '#55556A', 3);
  rr(M.x + M.w / 2 - 130, M.y + M.h + 100, 260, 36, 12, '#1C1C26', '#55556A', 3);
  rr(M.x, M.y, M.w, M.h, 18, '#1C1C26', '#55556A', 4);
  rr(M.x + 18, M.y + 18, M.w - 36, M.h - 54, 8, '#050508');
}
function finger(pressed, alpha) {
  if (alpha <= 0) return;
  ctx.save(); ctx.globalAlpha = alpha; const fx = 40 + (BTN.x - CASE.x) * 0.5 + 30 - 10 * pressed, fy = 565 + (BTN.y - CASE.y) * 0.5;
  rr(fx, fy - 20, 260, 40, 20, '#D9D9E6', '#8A8AA0', 3); ctx.restore();
}
function problem(t) {
  const on = t >= T.light ? (t < T.fansOff[0] ? out((t - T.light) / 0.3) : 1 - span(t, T.fansOff)) : 0;
  const tap = t >= T.press && t < T.press + 0.25 ? Math.sin(((t - T.press) / 0.25) * Math.PI) : 0;
  const hold = t >= T.offPress[0] && t < T.offPress[1] ? Math.min(1, Math.sin(span(t, T.offPress) * Math.PI) * 2) : 0;
  pcAndMonitor(t, on, tap + hold, 0);
  // A finger presses to turn it on, then presses again to shut it down.
  finger(tap, t < 0.9 ? out(t / 0.12) * (1 - clamp((t - 0.7) / 0.2)) : 0);
  finger(hold, t >= T.offPress[0] - 0.2 && t < T.offPress[1] + 0.25 ? clamp((t - (T.offPress[0] - 0.2)) / 0.15) * (1 - clamp((t - T.offPress[1]) / 0.25)) : 0);
}
function tryAgain(t) {
  pcAndMonitor(t, 0, 0, out((t - T.toFront[1]) / 0.3));
}

// ---- The back of the power supply: where the cord comes out, and goes back in. ----
function rear(t, plugOut) {
  // Enlarged and centred so the plug reads at phone size.
  ctx.save(); ctx.translate(540, 900); ctx.scale(1.2, 1.2); ctx.translate(-560, -870);
  rearArt(plugOut);
  ctx.restore();
}
function rearArt(plugOut) {
  rr(120, 560, 840, 620, 28, '#15151E', '#3A3A4A', 6);        // the back of the case, low
  rr(170, 640, 740, 470, 16, '#1B1B25', '#44445A', 4);        // power supply
  for (const r of [70, 120, 165]) { ctx.beginPath(); ctx.arc(390, 875, r, 0, Math.PI * 2); ctx.strokeStyle = '#2E2E3A'; ctx.lineWidth = 5; ctx.stroke(); }
  // The inlet: three contacts.
  rr(620, 760, 180, 130, 16, '#0B0B10', '#6A6A80', 4);
  for (const [x, y] of [[660, 800], [760, 800], [710, 850]]) rr(x - 10, y - 14, 20, 28, 4, '#55556A');
  // The plug and its cord.
  const dx = 280 * plugOut, moving = plugOut > 0.02 && plugOut < 0.98;
  ctx.lineCap = 'round'; ctx.strokeStyle = '#2A2A36'; ctx.lineWidth = 46;
  ctx.beginPath(); ctx.moveTo(800 + dx, 825); ctx.bezierCurveTo(900 + dx, 825, 960 + dx * 0.4, 1000, 1180, 1120); ctx.stroke();
  rr(600 + dx, 745, 220, 160, 22, '#2E2E3C', moving ? AMBER : '#8A8AA0', 5);
  rr(630 + dx, 770, 30, 110, 10, '#3A3A4C');
}

// ---- The board, seen through the open side: cooler, four memory slots, graphics card. ----
const SLOTS = [668, 708, 748, 788], SLOT_TOP = 160, SLOT_BOTTOM = 580, FAULTY = 2;
function board(t, raised, seatedGlow, flag) {
  rr(CASE.x, CASE.y, CASE.w, CASE.h, 34, '#15151E', '#3A3A4A', 6);
  rr(220, 100, 640, 960, 14, '#1B1B25', '#3A3A4A', 3);           // motherboard
  rr(232, 150, 70, 330, 8, '#22222E', '#44445A', 3);             // I/O shroud
  rr(330, 210, 280, 280, 18, '#22222E', '#4A4A5E', 3);           // CPU cooler
  fan(470, 350, 118, 0.4, false);   // powered off: nothing turns
  for (let i = 0; i < 4; i += 1) {
    const x = SLOTS[i];
    rr(x - 9, SLOT_TOP, 18, SLOT_BOTTOM - SLOT_TOP, 4, '#0B0B10', '#44445A', 2);
    const off = i === FAULTY ? raised : 0;
    // The stick, seen from above: its top edge. A stick not fully in sits proud, its clips open.
    rr(x - 13 + off * 6, SLOT_TOP - 8, 26, SLOT_BOTTOM - SLOT_TOP + 16, 5, '#2E2E3E', i === FAULTY && off > 0 ? AMBER : '#6A6A80', i === FAULTY && off > 0 ? 4 : 2);
    rr(x - 4 + off * 6, SLOT_TOP + 6, 8, SLOT_BOTTOM - SLOT_TOP - 12, 3, 'rgba(155,148,255,0.55)');
    // The clips at each end: pushed outward while the stick is not fully in.
    for (const end of [SLOT_TOP - 26, SLOT_BOTTOM + 6]) rr(x - 11, end + (i === FAULTY ? off * (end < 300 ? -12 : 12) : 0), 22, 20, 4, i === FAULTY && off > 0 ? AMBER : '#55556A');
  }
  if (seatedGlow > 0) { ctx.save(); ctx.globalAlpha = seatedGlow; rr(SLOTS[FAULTY] - 22, SLOT_TOP - 40, 44, SLOT_BOTTOM - SLOT_TOP + 80, 12, null, GREEN, 6); ctx.restore(); }
  if (flag > 0) { ctx.save(); ctx.globalAlpha = flag * (0.6 + 0.4 * Math.sin(t * 9)); rr(SLOTS[FAULTY] - 24, SLOT_TOP - 44, 48, SLOT_BOTTOM - SLOT_TOP + 88, 12, null, AMBER, 6); ctx.restore(); }
  rr(240, 650, 600, 140, 10, '#22222E', '#4A4A5E', 3);           // graphics card
  fan(400, 720, 52, 0, false); fan(560, 720, 52, 1, false); fan(720, 720, 52, 2, false);
  rr(190, 1110, 700, 230, 12, '#1B1B25', '#3A3A4A', 3);          // PSU shroud
}
const CAM = { full: [540, 700, 0.9], slots: [728, 370, 2.4] };
function camAt(t) {
  const k = ease(span(t, T.zoomSlots)), a = CAM.full, b = CAM.slots;
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), a[2] * Math.pow(b[2] / a[2], k)];
}
const toScreen = (cam, x, y) => [W / 2 + (x - cam[0]) * cam[2], STORY.y + STORY.height / 2 + (y - cam[1]) * cam[2]];

// ---- The side profile of the slot: where the action happens. ----
const SLOT = { x: 140, y: 1090, w: 800, h: 70 }, KEY = 600;
function clip(px, py, open, side, colour) {
  ctx.save(); ctx.translate(px, py); ctx.rotate(side * open * 0.6);
  rr(-22, -160, 44, 160, 10, colour, '#9A9AB0', 4);
  rr(side < 0 ? 14 : -46, -160, 32, 30, 8, colour, '#9A9AB0', 3); // the lip that hooks over the stick's end
  ctx.restore();
}
function profile(t) {
  // Scaled up and centred in the story band, so the action reads at phone size.
  ctx.save(); ctx.translate(540, 980); ctx.scale(1.12, 1.12); ctx.translate(-540, -930);
  profileArt(t);
  ctx.restore();
}
function profileArt(t) {
  // The stick: hovering misaligned, then aligned, then in, then pressed home.
  const alignK = ease(span(t, T.align)), lowerK = ease(span(t, T.lower)), pressK = back(span(t, T.press2));
  const xOff = lerp(-70, 0, alignK);
  const hover = 960, partial = 1060, home = 1130;
  const bottom = t < T.press2[0] ? lerp(hover, partial, lowerK) : lerp(partial, home, pressK);
  const tilt = t < T.press2[0] ? 0.035 * lowerK : 0.035 * (1 - clamp(span(t, T.press2) * 1.3));
  const clipK = t < T.clips[0] ? 1 : 1 - out(span(t, T.clips));
  const seated = t >= T.seated ? out((t - T.seated) / 0.3) : 0;
  // Slot body with its key ridge.
  rr(SLOT.x, SLOT.y, SLOT.w, SLOT.h, 10, '#0B0B10', '#55556A', 4);
  rr(SLOT.x + 20, SLOT.y + 14, SLOT.w - 40, 18, 6, '#16161F');
  const keyGlow = t >= T.align[0] - 0.15 && t < T.lower[1] ? 0.6 + 0.4 * Math.sin(t * 10) : 0;
  rr(KEY - 12, SLOT.y + 4, 24, 34, 4, keyGlow > 0 ? AMBER : '#55556A');
  // The stick.
  const sx = 170 + xOff, sw = 740, sh = 330, top = bottom - sh;
  ctx.save(); ctx.translate(sx + sw / 2, bottom); ctx.rotate(-tilt); ctx.translate(-(sx + sw / 2), -bottom);
  rr(sx, top, sw, sh - 40, 14, '#2E2E3E', seated > 0 ? 'rgba(0,230,118,' + (0.4 + 0.6 * seated) + ')' : '#8A8AA0', seated > 0 ? 6 : 3);
  rr(sx + 30, top + 26, sw - 60, 18, 9, 'rgba(155,148,255,0.75)');
  text('DDR', sx + 90, top + 140, 300, 64, 64, '#55556A', 'left', 700);
  // Gold contacts with the notch cut out, the notch lined up over the key when aligned.
  const notch = KEY - 170; // notch position along the stick
  ctx.fillStyle = '#C9A227'; ctx.fillRect(sx + 20, bottom - 40, notch - 32, 40); ctx.fillRect(sx + notch + 12, bottom - 40, sw - notch - 32, 40);
  ctx.strokeStyle = '#8A6E12'; ctx.lineWidth = 2; for (let x = sx + 30; x < sx + sw - 30; x += 18) { if (Math.abs(x - (sx + notch)) < 18) continue; ctx.beginPath(); ctx.moveTo(x, bottom - 36); ctx.lineTo(x, bottom - 4); ctx.stroke(); }
  if (keyGlow > 0) { ctx.save(); ctx.globalAlpha = keyGlow; rr(sx + notch - 16, bottom - 46, 32, 46, 6, null, AMBER, 5); ctx.restore(); }
  ctx.restore();
  // Alignment guides: one line through the notch, one through the slot's ridge; green once they meet.
  const guide = t >= T.align[0] - 0.15 && t < T.lower[1] + 0.2 ? clamp((t - (T.align[0] - 0.15)) / 0.15) * (1 - clamp((t - T.lower[1]) / 0.2)) : 0;
  if (guide > 0) {
    const met = alignK > 0.98, colour = met ? GREEN : AMBER;
    ctx.save(); ctx.globalAlpha = guide; ctx.setLineDash([18, 14]); ctx.lineWidth = 6; ctx.strokeStyle = colour;
    ctx.beginPath(); ctx.moveTo(sx + notch, bottom - 60); ctx.lineTo(sx + notch, bottom + 10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(KEY, SLOT.y - 10); ctx.lineTo(KEY, SLOT.y + SLOT.h + 70); ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
    if (met) ring(KEY, SLOT.y + SLOT.h + 70, 22, GREEN, 6, guide);
  }
  // The clips at the ends of the slot: open until the stick is pressed home, then they snap shut.
  const clipColour = t >= T.clips[1] ? '#3A3A4C' : '#2E2E3C';
  clip(SLOT.x + 8, SLOT.y + 10, clipK, -1, clipColour); clip(SLOT.x + SLOT.w - 8, SLOT.y + 10, clipK, 1, clipColour);
  if (t >= T.clips[1] && t < T.clips[1] + 0.6) { const q = (t - T.clips[1]) / 0.6; ring(SLOT.x + 8, SLOT.y - 60, 60 + 60 * q, GREEN, 6, 1 - q); ring(SLOT.x + SLOT.w - 8, SLOT.y - 60, 60 + 60 * q, GREEN, 6, 1 - q); }
  // Thumbs: firm, even pressure at both ends.
  const thumbs = span(t, T.thumbsIn) * (1 - span(t, T.thumbsOut));
  if (thumbs > 0) { ctx.save(); ctx.globalAlpha = thumbs; for (const x of [sx + 140, sx + sw - 140]) { const y = top - 210 + 30 * (1 - out(span(t, T.thumbsIn))); rr(x - 60, y, 120, 210, 56, '#D9D9E6', '#8A8AA0', 3); rr(x - 34, y + 150, 68, 46, 18, '#C5C5D6'); } ctx.restore(); }
  if (seated > 0) { ctx.save(); ctx.globalAlpha = seated; rr(SLOT.x - 40, top - 30, SLOT.w + 80, SLOT.y + SLOT.h - top + 60, 22, null, GREEN, 6); ctx.restore(); }
}

function story(t) {
  ctx.save(); ctx.beginPath(); ctx.rect(0, STORY.y, W, STORY.height); ctx.clip();
  ctx.fillStyle = C.background; ctx.fillRect(0, STORY.y, W, STORY.height);
  // Which scene, with short cross-fades between them.
  const scenes = [
    { from: 0, to: T.toRear[1], draw: problem, fadeOut: T.toRear },
    { from: T.toRear[0], to: T.toSide[1], draw: (t) => rear(t, ease(span(t, T.unplug))), fadeIn: T.toRear, fadeOut: T.toSide },
    { from: T.toSide[0], to: T.toProfile[1], draw: (t) => boardView(t), fadeIn: T.toSide, fadeOut: T.toProfile },
    { from: T.toProfile[0], to: T.toBoard[1], draw: profile, fadeIn: T.toProfile, fadeOut: T.toBoard },
    { from: T.toBoard[0], to: T.toRearAgain[1], draw: (t) => boardView(t), fadeIn: T.toBoard, fadeOut: T.toRearAgain },
    { from: T.toRearAgain[0], to: T.toFront[1], draw: (t) => rear(t, 1 - back(span(t, T.plugIn))), fadeIn: T.toRearAgain, fadeOut: T.toFront },
    { from: T.toFront[0], to: T.durationSeconds + 1, draw: tryAgain, fadeIn: T.toFront },
  ];
  for (const scene of scenes) {
    if (t < scene.from || t >= scene.to) continue;
    const a = (scene.fadeIn ? span(t, scene.fadeIn) : 1) * (scene.fadeOut ? 1 - span(t, scene.fadeOut) : 1);
    if (a <= 0) continue;
    ctx.save(); ctx.globalAlpha = a; scene.draw(t); ctx.restore();
  }
  ctx.restore();

  // Screen-space labels, one idea at a time.
  const HEAD = STORY.y + 66;
  if (t < T.offPress[0]) pill(S.copy.labels.problem, W / 2, HEAD, RED, '#0A0A0F', 76, t < 0.15 ? out(t / 0.15) : 1);
  else if (t < T.toSide[0]) pill(S.copy.labels.unplug, W / 2, HEAD, AMBER, '#0A0A0F', 64, out((t - T.offPress[0]) / 0.15));
  else if (t >= T.zoomSlots[1] - 0.2 && t < T.toProfile[0]) {
    pill(S.copy.labels.slots, W / 2, HEAD, PURPLE, '#0A0A0F', 64, out((t - (T.zoomSlots[1] - 0.2)) / 0.2));
    if (t >= T.flag) pill(S.copy.labels.notSeated, W / 2, STORY.y + 1290, AMBER, '#0A0A0F', 60, out((t - T.flag) / 0.2));
  } else if (t >= T.toProfile[0] && t < T.toBoard[0]) {
    const a = span(t, T.toProfile);
    // The pressure label stays up through the snap (long enough to read); the clips label joins it at the
    // bottom, in place of the view caption, while the clips close.
    if (t < T.clips[0]) { ctx.save(); ctx.globalAlpha = a; text(S.copy.labels.view, W / 2, STORY.y + 1340, W - 160, 42, 42, C.textSecondary, 'center', 600); ctx.restore(); }
    if (t < T.thumbsIn[0]) pill(S.copy.labels.notch, W / 2, HEAD, AMBER, '#0A0A0F', 64, a);
    else if (t < T.seated) pill(S.copy.labels.pressure, W / 2, HEAD, CYAN, '#0A0A0F', 64, out((t - T.thumbsIn[0]) / 0.15));
    else pill(S.copy.labels.seated, W / 2, HEAD, GREEN, '#0A0A0F', 72, out((t - T.seated) / 0.25));
    if (t >= T.clips[0] && t < T.seated) pill(S.copy.labels.clips, W / 2, STORY.y + 1290, GREEN, '#0A0A0F', 60, out((t - T.clips[0]) / 0.15));
  } else if (t >= T.toBoard[0] && t < T.toRearAgain[0]) pill(S.copy.labels.seated, W / 2, HEAD, GREEN, '#0A0A0F', 64, 1);
  else if (t >= T.toRearAgain[0] && t < T.toFront[0]) pill(S.copy.labels.plugIn, W / 2, HEAD, CYAN, '#0A0A0F', 64, out((t - T.toRearAgain[0]) / 0.15));
}
/** The board through the open side: on the way in (panel off, zoom), and on the way out (seated, panel back on). */
function boardView(t) {
  const leaving = t >= T.toBoard[0];
  const cam = leaving ? CAM.slots : camAt(t);
  const raised = leaving ? 0 : 1, glow = leaving ? out((t - T.toBoard[1]) / 0.2) : 0, flag = !leaving && t >= T.flag ? out((t - T.flag) / 0.2) : 0;
  ctx.translate(W / 2, STORY.y + STORY.height / 2); ctx.scale(cam[2], cam[2]); ctx.translate(-cam[0], -cam[1]);
  board(t, raised, glow, flag);
  // The tinted glass side panel: slides off on the way in, back on on the way out.
  const panel = leaving ? 1 - ease(span(t, T.panelOn)) : ease(span(t, T.panelOff));
  if (panel < 1) { ctx.save(); ctx.translate(900 * panel, 0); rr(CASE.x + 10, CASE.y + 10, CASE.w - 20, CASE.h - 20, 28, 'rgba(120,130,200,0.22)', 'rgba(180,190,255,0.5)', 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 30; ctx.beginPath(); ctx.moveTo(300, 200); ctx.lineTo(700, 1200); ctx.stroke(); ctx.restore(); }
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
  ctx.font = '700 76px Inter';
  if (ctx.measureText(cap.text).width <= W - 120) { text(cap.text, W / 2, CAP.y + CAP.height / 2, W - 120, 80, 76, C.text, 'center', 700); return; }
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

/** The frame files in render order: f-0000 … f-NNNN, contiguous, one per frame. */
export function frameNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `f-${String(index).padStart(4, "0")}.png`);
}

export async function renderSilentCut(outputDir = OUTPUT_DIR) {
  const problems = copyProblems();
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
  const duration = TIMING.durationSeconds, count = Math.round(duration * FPS), names = frameNames(count);
  const session = await launchBrowser({ width: LAYOUT.width, height: LAYOUT.height, deviceScaleFactor: 1 });
  let measured: { minFinalPx: number; misfits: string[] };
  try {
    const page = await session.context.newPage();
    await page.setContent(`<!doctype html><html><head><style>${faces.join("")}</style></head><body style="margin:0;background:#0A0A0F"><canvas id="c" width="${LAYOUT.width}" height="${LAYOUT.height}"></canvas><script>${pageScript(state)}</script></body></html>`);
    await page.evaluate(`Promise.all([400, 600, 700].map((w) => document.fonts.load(w + ' 48px Inter')))`);
    if (!(await page.evaluate(`[400, 600, 700].every((w) => document.fonts.check(w + ' 48px Inter'))`))) throw new Error("Inter did not load; refusing to render in a fallback font.");
    // Every frame rendered fresh, in index order.
    for (let index = 0; index < count; index += 1) {
      const url = await page.evaluate(`window.renderAt(${(index / FPS).toFixed(4)})`) as string;
      await writeFile(join(framesDir, names[index]), Buffer.from(url.split(",")[1], "base64"));
    }
    measured = await page.evaluate("window.measured()") as { minFinalPx: number; misfits: string[] };
  } finally {
    await session.close();
  }
  if (measured.misfits.length) throw new Error(`Text does not fit at a readable size: ${[...new Set(measured.misfits)].join(" | ")}`);
  if (measured.minFinalPx < MIN_FINAL_PX) throw new Error(`Smallest type is ${measured.minFinalPx}px, under ${MIN_FINAL_PX}px.`);
  // The encoder reads exactly these files in this order; refuse a gap or a stray file.
  const onDisk = (await readdir(framesDir)).filter((f) => f.endsWith(".png")).sort();
  if (onDisk.length !== count || onDisk.some((name, i) => name !== names[i])) throw new Error("The frame files are not one contiguous, ordered sequence.");
  const videoPath = join(outputDir, "ram-seat-silent.mp4");
  await run("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-start_number", "0", "-i", join(framesDir, "f-%04d.png"),
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "0:v", "-map", "1:a",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
    "-t", duration.toFixed(3), "-movflags", "+faststart", videoPath]);
  await run("ffmpeg", ["-v", "error", "-y", "-i", videoPath, "-vf", "fps=4,scale=180:320:flags=lanczos,tile=13x4:padding=4:color=0x2A2A33", "-frames:v", "1", join(outputDir, "phone-every-0.25s.png")]);
  await rm(framesDir, { recursive: true, force: true });
  return { videoPath, sha256: createHash("sha256").update(await readFile(videoPath)).digest("hex"), minFinalPx: measured.minFinalPx, durationSeconds: duration, frames: count };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  renderSilentCut().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error); process.exitCode = 1; });
}
