// The reusable animation scenes, drawn in the browser canvas by renderCut.ts.
//
// The art is the stylized PC of the recent Shorts (two-checks, RAM seating):
// the same case, fans, power button, monitor, power-supply back, open side
// panel and motherboard, palette and type. Each scene is a function of the
// time t and the shot's params, all times absolute seconds in the cut, so a
// new Short is a timeline of these scenes (see spec.ts), not new drawing code.
//
//   powerButton       the PC beside its monitor; a finger press; optional fans
//                     lit; optional amber "press here" pulse (never the cyan of
//                     a powered PC)
//   psuRear           the back of the power supply: rocker switch I/O, the
//                     power cord out or in
//   caseOpen          the side panel off or on, a camera move over the board,
//                     an outline on one part (CPU power socket, memory stick)
//   connectorCompare  two cable ends face-on, one marked right, one wrong
//   connectorInsert   side view: a plug pressed into its socket, its latch
//                     hooking over the socket's tab
//
// Shared helpers (text with a minimum size, label pills, the ILLUSTRATION band
// and the caption band) come first. Nothing here knows about any one Short.

export const SCENE_NAMES = ["powerButton", "psuRear", "caseOpen", "connectorCompare", "connectorInsert"] as const;
export type SceneName = (typeof SCENE_NAMES)[number];

export const PAGE_LIBRARY = String.raw`
const C = S.colours, L = S.layout, W = L.width, STORY = L.story, CAP = L.captions, TOP = L.label;
const canvas = document.getElementById('c'); const ctx = canvas.getContext('2d');
const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const out = (x) => 1 - Math.pow(1 - clamp(x), 3);
const back = (x) => { x = clamp(x); const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const lerp = (a, b, k) => a + (b - a) * k;
const span = (t, sp) => sp ? clamp((t - sp[0]) / (sp[1] - sp[0])) : 0;
const measured = { minFinalPx: Infinity, misfits: [] };
const PURPLE = C.accentText, CYAN = C.cyan, RED = '#FF5A6E', GREEN = C.green, AMBER = C.amber;
const COLOUR = { red: RED, amber: AMBER, purple: PURPLE, cyan: CYAN, green: GREEN };

function text(s, x, y, maxWidth, max, min, colour, align, weight) {
  let size = max;
  for (; size >= min; size -= 1) { ctx.font = weight + ' ' + size + 'px Inter'; if (ctx.measureText(s).width <= maxWidth) break; }
  if (size < min) { size = min; measured.misfits.push(s); }
  ctx.font = weight + ' ' + size + 'px Inter'; ctx.fillStyle = colour; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
  measured.minFinalPx = Math.min(measured.minFinalPx, size);
}
/** Text inside the scene's own coordinates: the size that counts is the size on screen. */
function sceneText(s, x, y, maxWidth, size, colour, align, weight) {
  const k = ctx.getTransform().a;
  ctx.font = weight + ' ' + size + 'px Inter'; ctx.fillStyle = colour; ctx.textAlign = align; ctx.textBaseline = 'middle';
  if (ctx.measureText(s).width > maxWidth) measured.misfits.push(s);
  ctx.fillText(s, x, y);
  measured.minFinalPx = Math.min(measured.minFinalPx, size * k);
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
function tick(x, y, r, colour, a) { if (a <= 0) return; ctx.save(); ctx.globalAlpha *= a; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = colour; ctx.fill();
  ctx.strokeStyle = '#0A0A0F'; ctx.lineWidth = r * 0.22; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(x - r * 0.45, y + r * 0.02); ctx.lineTo(x - r * 0.1, y + r * 0.36); ctx.lineTo(x + r * 0.48, y - r * 0.34); ctx.stroke(); ctx.restore(); }
function cross(x, y, r, colour, a) { if (a <= 0) return; ctx.save(); ctx.globalAlpha *= a; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = colour; ctx.fill();
  ctx.strokeStyle = '#0A0A0F'; ctx.lineWidth = r * 0.22; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x - r * 0.38, y - r * 0.38); ctx.lineTo(x + r * 0.38, y + r * 0.38); ctx.moveTo(x + r * 0.38, y - r * 0.38); ctx.lineTo(x - r * 0.38, y + r * 0.38); ctx.stroke(); ctx.restore(); }

// ---- The stylized PC, as in the two-checks and RAM Shorts. ----
const CASE = { x: 150, y: 30, w: 780, h: 1340 };
const BTN = { x: 540, y: 150, r: 62 };
function front(spin, lit, pressed) {
  rr(CASE.x, CASE.y, CASE.w, CASE.h, 34, '#16161F', lit > 0 ? 'rgba(108,99,255,' + (0.4 + 0.6 * lit) + ')' : '#3A3A4A', 6);
  rr(330, 137, 80, 26, 5, '#0B0B10', '#55556A', 3); rr(670, 137, 80, 26, 5, '#0B0B10', '#55556A', 3);
  rr(200, 280, 680, 1040, 20, '#121219', '#2A2A36', 3);
  for (let i = 0; i < 3; i += 1) {
    const cy = 450 + i * 350, col = i % 2 ? '0,212,255' : '108,99,255';
    ctx.beginPath(); ctx.arc(540, cy, 140, 0, Math.PI * 2);
    ctx.strokeStyle = lit > 0 ? 'rgba(' + col + ',' + lit + ')' : '#2E2E3A'; ctx.lineWidth = lit > 0 ? 14 : 6; ctx.stroke();
    ctx.save(); ctx.translate(540, cy); ctx.rotate(spin * 5 + i);
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
function monitor() {
  const M = { x: 470, y: 820, w: 580, h: 340 };
  rr(M.x + M.w / 2 - 30, M.y + M.h, 60, 110, 6, '#1C1C26', '#55556A', 3);
  rr(M.x + M.w / 2 - 130, M.y + M.h + 100, 260, 36, 12, '#1C1C26', '#55556A', 3);
  rr(M.x, M.y, M.w, M.h, 18, '#1C1C26', '#55556A', 4);
  rr(M.x + 18, M.y + 18, M.w - 36, M.h - 54, 8, '#050508');
}
function finger(pressed, alpha) {
  if (alpha <= 0) return;
  ctx.save(); ctx.globalAlpha *= alpha; const fx = 40 + (BTN.x - CASE.x) * 0.5 + 30 - 10 * pressed, fy = 565 + (BTN.y - CASE.y) * 0.5;
  rr(fx, fy - 20, 260, 40, 20, '#D9D9E6', '#8A8AA0', 3); ctx.restore();
}
/** A press over [a, a + 0.25 s]: 0 → 1 → 0. */
const pressCurve = (t, a) => a !== undefined && t >= a && t < a + 0.25 ? Math.sin(((t - a) / 0.25) * Math.PI) : 0;

// ---- The back of the power supply: rocker switch and power cord. ----
function rearArt(t, p) {
  rr(120, 560, 840, 620, 28, '#15151E', '#3A3A4A', 6);
  rr(170, 640, 740, 470, 16, '#1B1B25', '#44445A', 4);
  for (const r of [70, 120, 165]) { ctx.beginPath(); ctx.arc(390, 875, r, 0, Math.PI * 2); ctx.strokeStyle = '#2E2E3A'; ctx.lineWidth = 5; ctx.stroke(); }
  // Rocker switch below the inlet: I is on, O is off; the pressed side sits low.
  const on = p.switchOff ? 1 - span(t, p.switchOff) : p.switchOn ? span(t, p.switchOn) : (p.startOn === false ? 0 : 1);
  const moving = (p.switchOff && t >= p.switchOff[0] - 0.15 && t < p.switchOff[1] + 0.3) || (p.switchOn && t >= p.switchOn[0] - 0.15 && t < p.switchOn[1] + 0.3);
  rr(640, 930, 140, 150, 14, '#0B0B10', moving ? AMBER : '#6A6A80', moving ? 6 : 4);
  rr(656, 946 + (1 - on) * 0, 108, 59, 8, on > 0.5 ? '#3A3A4C' : '#24242E');
  rr(656, 1005, 108, 59, 8, on > 0.5 ? '#24242E' : '#3A3A4C');
  sceneText('I', 710, 976, 60, 44, on > 0.5 ? '#F0F0FF' : '#6A6A80', 'center', 700);
  ctx.beginPath(); ctx.arc(710, 1035, 16, 0, Math.PI * 2); ctx.strokeStyle = on > 0.5 ? '#6A6A80' : '#F0F0FF'; ctx.lineWidth = 6; ctx.stroke();
  // The inlet: three contacts.
  rr(620, 760, 180, 130, 16, '#0B0B10', '#6A6A80', 4);
  for (const [x, y] of [[660, 800], [760, 800], [710, 850]]) rr(x - 10, y - 14, 20, 28, 4, '#55556A');
  // The plug and its cord.
  const plugOut = p.unplug ? ease(span(t, p.unplug)) : p.plugIn ? 1 - back(span(t, p.plugIn)) : (p.startPlugged === false ? 1 : 0);
  const dx = 280 * plugOut, plugMoving = plugOut > 0.02 && plugOut < 0.98;
  ctx.lineCap = 'round'; ctx.strokeStyle = '#2A2A36'; ctx.lineWidth = 46;
  ctx.beginPath(); ctx.moveTo(800 + dx, 825); ctx.bezierCurveTo(900 + dx, 825, 960 + dx * 0.4, 1000, 1180, 1120); ctx.stroke();
  rr(600 + dx, 745, 220, 160, 22, '#2E2E3C', plugMoving ? AMBER : '#8A8AA0', 5);
  rr(630 + dx, 770, 30, 110, 10, '#3A3A4C');
}

// ---- The board through the open side: cooler, CPU power socket, memory, graphics card. ----
const SLOTS = [668, 708, 748, 788], SLOT_TOP = 160, SLOT_BOTTOM = 580;
const EPS = { x: 300, y: 112, w: 150, h: 54 };   // CPU power socket: an example position, next to the CPU
function epsSocket(filled, glow) {
  rr(EPS.x, EPS.y, EPS.w, EPS.h, 6, '#0B0B10', glow > 0 ? AMBER : '#6A6A80', glow > 0 ? 5 : 3);
  for (let r = 0; r < 2; r += 1) for (let c = 0; c < 4; c += 1) rr(EPS.x + 14 + c * 33, EPS.y + 9 + r * 20, 22, 14, 3, filled ? '#C9A227' : '#2E2E3A');
  if (filled) {
    rr(EPS.x - 4, EPS.y - 30, EPS.w + 8, 38, 8, '#2E2E3C', '#8A8AA0', 3);
    ctx.strokeStyle = '#2A2A36'; ctx.lineWidth = 28; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(EPS.x + EPS.w / 2, EPS.y - 30); ctx.bezierCurveTo(EPS.x + EPS.w / 2, EPS.y - 120, EPS.x - 60, EPS.y - 80, EPS.x - 90, EPS.y - 200); ctx.stroke();
  }
}
function board(t, p) {
  rr(CASE.x, CASE.y, CASE.w, CASE.h, 34, '#15151E', '#3A3A4A', 6);
  rr(220, 100, 640, 960, 14, '#1B1B25', '#3A3A4A', 3);
  rr(232, 190, 60, 290, 8, '#22222E', '#44445A', 3);
  rr(330, 210, 280, 280, 18, '#22222E', '#4A4A5E', 3);
  fan(470, 350, 118, 0.4, false);
  if (p.tagCpuFrom !== undefined && t >= p.tagCpuFrom) { ctx.save(); ctx.globalAlpha *= out((t - p.tagCpuFrom) / 0.2); rr(370, 452, 200, 56, 28, PURPLE); sceneText('CPU', 470, 481, 180, 34, '#0A0A0F', 'center', 700); ctx.restore(); }
  const glow = p.highlight === 'cpuSocket' && t >= p.highlightFrom ? 0.6 + 0.4 * Math.sin(t * 9) : 0;
  epsSocket(t >= (p.socketFilledFrom ?? Infinity), glow);
  for (const x of SLOTS) {
    rr(x - 9, SLOT_TOP, 18, SLOT_BOTTOM - SLOT_TOP, 4, '#0B0B10', '#44445A', 2);
    rr(x - 13, SLOT_TOP - 8, 26, SLOT_BOTTOM - SLOT_TOP + 16, 5, '#2E2E3E', '#6A6A80', 2);
    rr(x - 4, SLOT_TOP + 6, 8, SLOT_BOTTOM - SLOT_TOP - 12, 3, 'rgba(155,148,255,0.55)');
    for (const end of [SLOT_TOP - 26, SLOT_BOTTOM + 6]) rr(x - 11, end, 22, 20, 4, '#55556A');
  }
  rr(240, 650, 600, 140, 10, '#22222E', '#4A4A5E', 3);
  fan(400, 720, 52, 0, false); fan(560, 720, 52, 1, false); fan(720, 720, 52, 2, false);
  rr(190, 1110, 700, 230, 12, '#1B1B25', '#3A3A4A', 3);
  if (glow > 0) { ctx.save(); ctx.globalAlpha *= glow; rr(EPS.x - 16, EPS.y - 16, EPS.w + 32, EPS.h + 32, 12, null, AMBER, 6); ctx.restore(); }
  if (p.highlight === 'cpuSocket' && p.seatedFrom !== undefined && t >= p.seatedFrom) { ctx.save(); ctx.globalAlpha *= out((t - p.seatedFrom) / 0.25); rr(EPS.x - 16, EPS.y - 46, EPS.w + 32, EPS.h + 62, 12, null, GREEN, 6); ctx.restore(); }
}

// ---- Cable ends, face-on: what the pins look like. ----
function connectorFace(cx, cy, kind, ok, reveal) {
  // kind 'cpu' (4+4 pin, square pins) or 'pcie' (6+2 pin, mixed pin shapes): a stylized difference, not a pinout.
  const groups = kind === 'cpu' ? [[2, 2], [2, 2]] : [[2, 3], [2, 1]];
  const cell = 64, gap = 26, total = groups.reduce((s, g) => s + g[1] * cell, 0) + gap;
  let x = cx - total / 2;
  rr(cx - total / 2 - 30, cy - 260, total + 60, 230, 18, '#2E2E3C', '#8A8AA0', 4);
  sceneText(kind === 'cpu' ? 'CPU' : 'PCIe', cx, cy - 145, total + 40, 72, kind === 'cpu' ? '#F0F0FF' : '#B8B8CC', 'center', 700);
  groups.forEach((g) => {
    rr(x - 8, cy - 8, g[1] * cell + 16, g[0] * cell + 16, 10, '#16161F', '#55556A', 3);
    for (let r = 0; r < g[0]; r += 1) for (let c = 0; c < g[1]; c += 1) {
      const px = x + c * cell + 8, py = cy + r * cell + 8, round = kind === 'pcie' && (r + c) % 2 === 1;
      rr(px, py, cell - 16, cell - 16, round ? 22 : 4, '#0B0B10', '#6A6A80', 2);
    }
    x += g[1] * cell + gap;
  });
  ctx.lineWidth = 34; ctx.lineCap = 'round';
  [-90, -30, 30, 90].forEach((dx, i) => { ctx.strokeStyle = i % 2 ? '#2A2A36' : '#C9A227'; ctx.beginPath(); ctx.moveTo(cx + dx, cy - 260); ctx.lineTo(cx + dx * 1.4, cy - 520); ctx.stroke(); });
  const badgeY = cy + 230;
  if (ok === true) tick(cx, badgeY, 70, GREEN, reveal); else if (ok === false) cross(cx, badgeY, 70, RED, reveal);
}

// ---- Side view: plug into socket, latch over the tab. ----
function insertArt(t, p) {
  const boardY = 1250, sock = { x: 330, y: 1110, w: 420, h: 140 };
  rr(80, boardY, 920, 60, 8, '#1B1B25', '#3A3A4A', 3);
  rr(sock.x, sock.y, sock.w, sock.h, 10, '#0B0B10', '#6A6A80', 4);
  for (let c = 0; c < 4; c += 1) rr(sock.x + 30 + c * 96, sock.y + 14, 72, 26, 4, '#16161F');
  rr(sock.x - 46, sock.y + 26, 46, 60, 8, '#55556A', '#9A9AB0', 3); // the tab the latch hooks over
  const lowerK = ease(span(t, p.lower)), pressK = back(span(t, p.press));
  const hover = 830, partial = 1080, home = 1125;
  const bottom = t < p.press[0] ? lerp(hover, partial, lowerK) : lerp(partial, home, pressK);
  const pw = 420, ph = 250, top = bottom - ph, px = sock.x;
  // Wires up out of the frame.
  for (let i = 0; i < 4; i += 1) { ctx.strokeStyle = i % 2 ? '#2A2A36' : '#C9A227'; ctx.lineWidth = 40; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(px + 60 + i * 100, top); ctx.lineTo(px + 60 + i * 100, top - 700); ctx.stroke(); }
  const seated = p.seatedFrom !== undefined && t >= p.seatedFrom ? out((t - p.seatedFrom) / 0.3) : 0;
  rr(px, top, pw, ph, 14, '#2E2E3C', seated > 0 ? 'rgba(0,230,118,' + (0.4 + 0.6 * seated) + ')' : '#8A8AA0', seated > 0 ? 6 : 4);
  sceneText(p.stamp || 'CPU', px + pw / 2, top + ph / 2 - 10, pw - 40, 84, '#F0F0FF', 'center', 700);
  // The latch: a lever on the plug's side, open until pressed home, then it hooks over the tab.
  const latchK = t < p.latch[0] ? 0 : out(span(t, p.latch));
  const latchColour = latchK >= 1 ? '#C5C5D6' : '#8A8AA0';
  ctx.save(); ctx.translate(px - 4, top + 40); ctx.rotate(-0.42 * (1 - latchK));
  rr(-44, 0, 44, ph + 30, 10, latchColour, '#F0F0FF', 3);
  rr(-44, ph + 10, 70, 40, 8, latchColour, '#F0F0FF', 3);   // the hook
  ctx.restore();
  if (t >= p.latch[1] && t < p.latch[1] + 0.6) { const q = (t - p.latch[1]) / 0.6; ring(sock.x - 24, sock.y + 56, 60 + 70 * q, GREEN, 7, 1 - q); }
  if (seated > 0) { ctx.save(); ctx.globalAlpha *= seated; rr(sock.x - 70, top - 30, sock.w + 110, sock.y + sock.h - top + 60, 22, null, GREEN, 6); ctx.restore(); }
  // Press: two thumbs on the plug's top.
  const thumbs = span(t, p.thumbsIn) * (1 - span(t, p.thumbsOut));
  if (thumbs > 0) { ctx.save(); ctx.globalAlpha *= thumbs; for (const x of [px + 110, px + pw - 110]) { const y = top - 200 + 30 * (1 - out(span(t, p.thumbsIn))); rr(x - 55, y, 110, 200, 52, '#D9D9E6', '#8A8AA0', 3); } ctx.restore(); }
}

// ---- The scenes. ----
function camMove(t, z) {
  if (!z) return [540, 700, 0.9];
  const k = ease(span(t, z.during));
  return [lerp(z.from[0], z.to[0], k), lerp(z.from[1], z.to[1], k), z.from[2] * Math.pow(z.to[2] / z.from[2], k)];
}
const SCENES = {
  powerButton(t, p) {
    const lit = p.lit ? (p.fansOff ? 1 - span(t, p.fansOff) : 1) : 0;
    const pressed = pressCurve(t, p.press);
    ctx.save(); ctx.translate(40, 565); ctx.scale(0.5, 0.5); ctx.translate(-CASE.x, -CASE.y); front(lit > 0 ? t : 0, lit, pressed);
    const pulse = p.pulseFrom !== undefined ? out((t - p.pulseFrom) / 0.3) : 0;
    if (pulse > 0) { ring(BTN.x, BTN.y, BTN.r + 34 + 16 * Math.sin(t * 6), AMBER, 18, pulse * (0.6 + 0.4 * Math.sin(t * 6))); ring(BTN.x, BTN.y, BTN.r + 6, AMBER, 10, pulse); }
    ctx.restore();
    monitor();
    if (p.press !== undefined) finger(pressed, t >= p.press - 0.3 && t < p.press + 0.7 ? clamp((t - (p.press - 0.3)) / 0.12) * (1 - clamp((t - (p.press + 0.45)) / 0.2)) : 0);
  },
  psuRear(t, p) {
    ctx.translate(540, 900); ctx.scale(1.2, 1.2); ctx.translate(-560, -870);
    rearArt(t, p);
  },
  caseOpen(t, p) {
    const cam = camMove(t, p.zoom);
    ctx.translate(W / 2, STORY.y + STORY.height / 2); ctx.scale(cam[2], cam[2]); ctx.translate(-cam[0], -cam[1]);
    board(t, p);
    const panel = p.panelOn ? 1 - ease(span(t, p.panelOn)) : p.panelOff ? ease(span(t, p.panelOff)) : 1;
    if (panel < 1) { ctx.save(); ctx.translate(900 * panel, 0); rr(CASE.x + 10, CASE.y + 10, CASE.w - 20, CASE.h - 20, 28, 'rgba(120,130,200,0.22)', 'rgba(180,190,255,0.5)', 4);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 30; ctx.beginPath(); ctx.moveTo(300, 200); ctx.lineTo(700, 1200); ctx.stroke(); ctx.restore(); }
  },
  connectorCompare(t, p) {
    const inL = out(span(t, [p.from, p.from + 0.35])), inR = out(span(t, [p.from + 0.15, p.from + 0.5]));
    ctx.save(); ctx.globalAlpha *= inL; connectorFace(300, 900, p.left, p.leftOk, out(span(t, [p.verdictLeft, p.verdictLeft + 0.2]))); ctx.restore();
    ctx.save(); ctx.globalAlpha *= inR; connectorFace(780, 900, p.right, p.rightOk, out(span(t, [p.verdictRight, p.verdictRight + 0.2]))); ctx.restore();
  },
  connectorInsert(t, p) { insertArt(t, p); },
};

function story(t) {
  ctx.save(); ctx.beginPath(); ctx.rect(0, STORY.y, W, STORY.height); ctx.clip();
  ctx.fillStyle = C.background; ctx.fillRect(0, STORY.y, W, STORY.height);
  for (const shot of S.spec.shots) {
    if (t < shot.from || t >= shot.to) continue;
    const a = (shot.fadeIn ? clamp((t - shot.from) / shot.fadeIn) : 1) * (shot.fadeOut ? clamp((shot.to - t) / shot.fadeOut) : 1);
    if (a <= 0) continue;
    ctx.save(); ctx.globalAlpha = a; SCENES[shot.scene](t, shot.params || {}); ctx.restore();
  }
  ctx.restore();
  const HEAD = STORY.y + 66, FOOT = STORY.y + 1290;
  for (const label of S.spec.labels) {
    if (t < label.from || t >= label.to) continue;
    pill(label.text, W / 2, label.at === 'foot' ? FOOT : HEAD, COLOUR[label.colour], '#0A0A0F', label.size || (label.at === 'foot' ? 60 : 64), out((t - label.from) / 0.15));
  }
}
function labelBand() {
  ctx.fillStyle = C.surface; ctx.fillRect(0, TOP.y, W, TOP.height);
  ctx.font = '700 44px Inter'; const w = ctx.measureText(S.spec.badge).width + 60;
  rr((W - w) / 2, 34, w, 76, 38, AMBER);
  text(S.spec.badge, W / 2, 73, w, 44, 44, '#0A0A0F', 'center', 700);
  text(S.spec.line, W / 2, 152, W - 120, 42, 42, C.text, 'center', 600);
}
function captionBand(t) {
  ctx.fillStyle = C.background; ctx.fillRect(0, CAP.y, W, CAP.height);
  const cap = S.spec.captions.find((c) => t >= c.from && t < c.to) || S.spec.captions.at(-1);
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
