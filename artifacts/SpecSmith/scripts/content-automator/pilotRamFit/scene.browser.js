// Drawing code for the RAM-fit pilot (v3), run inside a browser page by render.ts.
// Pure in `t`: no clocks, no randomness, so the same inputs give the same frames.
// DATA is injected by render.ts before this file.
/* global DATA */
const W = 1080, H = 1920;
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const C = {
  bg: '#08080D', accent: '#6C63FF', accentText: '#9B94FF', cyan: '#00D4FF', green: '#00E676',
  red: '#FF1744', amber: '#FFB300', text: '#F4F4FF', dim: '#9A9AB8',
};
const FONT = DATA.fontFamily;
const GEN = { DDR4: { ratio: 0.555, color: C.amber }, DDR5: { ratio: 0.47, color: C.cyan } };

const clamp = (x) => Math.max(0, Math.min(1, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
const easeIn = (x) => Math.pow(clamp(x), 2.4);
const easeInOut = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const back = (x) => { x = clamp(x); const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const lerp = (a, b, p) => a + (b - a) * p;

function font(size, weight) { return `${weight || 800} ${size}px ${FONT}`; }
function text(s, x, y, size, color, align, weight, stroke) {
  ctx.font = font(size, weight); ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
  if (stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = stroke; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(s, x, y); }
  ctx.fillStyle = color; ctx.fillText(s, x, y);
}
function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)); }
function fill(color) { ctx.fillStyle = color; ctx.fill(); }
function faded(alpha, draw) { if (alpha <= 0.001) return; ctx.save(); ctx.globalAlpha *= Math.min(1, alpha); draw(); ctx.restore(); }
function glow(color, blur, draw) { ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = blur; draw(); ctx.restore(); }
function vgrad(y0, y1, stops) { const g = ctx.createLinearGradient(0, y0, 0, y1); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; }

const logo = new Image(); logo.src = DATA.logoDataUrl;
const card = new Image(); card.src = DATA.cardDataUrl;
window.assetsReady = Promise.all([logo, card].map((img) => new Promise((r) => { if (img.complete) r(); else img.onload = r; })));

// ---------------------------------------------------------------- hardware

/** A RAM stick, bottom edge at `bottom`, centred on cx. */
function stick(cx, bottom, w, gen, opts) {
  opts = opts || {};
  const h = w * 0.27, left = cx - w / 2, top = bottom - h;
  const nx = left + w * GEN[gen].ratio, nw = Math.max(5, w * 0.024), nd = h * 0.16;
  ctx.save();
  // Soft shadow first, so the stick sits in the scene.
  glow('rgba(0,0,0,0.55)', w * 0.06, () => { rrect(left + 4, top + 8, w - 8, h - 8, 8); fill('rgba(0,0,0,0.6)'); });
  if (opts.outline) glow(opts.outline, w * 0.05, () => { rrect(left, top, w, h, 9); ctx.strokeStyle = opts.outline; ctx.lineWidth = w * 0.006; ctx.stroke(); });
  // PCB, with the key notch cut out of the bottom edge.
  ctx.beginPath();
  ctx.moveTo(left + 9, top); ctx.lineTo(left + w - 9, top); ctx.quadraticCurveTo(left + w, top, left + w, top + 9);
  ctx.lineTo(left + w, bottom); ctx.lineTo(nx + nw / 2, bottom); ctx.lineTo(nx + nw / 2, bottom - nd);
  ctx.arc(nx, bottom - nd, nw / 2, 0, Math.PI, true); ctx.lineTo(nx - nw / 2, bottom); ctx.lineTo(left, bottom);
  ctx.lineTo(left, top + 9); ctx.quadraticCurveTo(left, top, left + 9, top); ctx.closePath();
  ctx.fillStyle = vgrad(top, bottom, [[0, '#2A9A5C'], [0.55, '#1C7A46'], [1, '#156038']]); ctx.fill();
  ctx.lineWidth = Math.max(1.5, w * 0.003); ctx.strokeStyle = '#0E4A2A'; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(left + 9, top + 2, w - 18, Math.max(1.5, h * 0.012));
  // Memory chips with a little sheen.
  const chips = 8, gap = w * 0.017, cw = (w * 0.9 - gap * (chips - 1)) / chips;
  for (let i = 0; i < chips; i++) {
    const x = left + w * 0.05 + i * (cw + gap), y = top + h * 0.13, ch = h * 0.47;
    rrect(x, y, cw, ch, w * 0.004); ctx.fillStyle = vgrad(y, y + ch, [[0, '#24242C'], [1, '#0D0D12']]); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(x + cw * 0.08, y + ch * 0.06, cw * 0.84, Math.max(1, ch * 0.03));
  }
  // Small SMD parts along the contact edge.
  ctx.fillStyle = '#C9B48A';
  for (let i = 0; i < 26; i++) { const x = left + w * 0.06 + i * w * 0.034; if (Math.abs(x - nx) > w * 0.03) ctx.fillRect(x, bottom - h * 0.25, w * 0.012, h * 0.04); }
  // Label sticker naming the generation.
  rrect(cx - w * 0.17, top + h * 0.19, w * 0.34, h * 0.35, w * 0.008); fill('#F2F2F8');
  text(gen, cx, top + h * 0.375, Math.round(h * 0.25), '#111118', 'center', 900);
  // Gold contacts as individual pads, interrupted by the notch.
  const cy = bottom - h * 0.15, chh = h * 0.13, pitch = Math.max(3, w * 0.0115);
  ctx.fillStyle = vgrad(cy, cy + chh, [[0, '#F2D27A'], [0.5, '#D3A632'], [1, '#A47A1A']]);
  for (let x = left + w * 0.022; x < left + w * 0.975; x += pitch) {
    if (Math.abs(x + pitch * 0.35 - nx) < nw * 0.9) continue;
    ctx.fillRect(x, cy, pitch * 0.7, chh);
  }
  // Contacts left outside the slot, tinted: the part that should have gone in.
  if (opts.exposed) faded(opts.exposed, () => glow('rgba(255,23,68,0.9)', w * 0.03, () => { ctx.fillStyle = 'rgba(255,23,68,0.55)'; ctx.fillRect(left + w * 0.02, cy - 2, w * 0.955, chh + 4); }));
  if (opts.notchGlow) glow(opts.notchGlow, w * 0.04, () => {
    ctx.strokeStyle = opts.notchGlow; ctx.lineWidth = Math.max(3, w * 0.006);
    ctx.beginPath(); ctx.arc(nx, bottom - nd * 0.6, nw * 1.5, 0, Math.PI * 2); ctx.stroke();
  });
  ctx.restore();
}

/** A DIMM slot whose top edge is at `top`; the key sits where a `gen` stick's notch goes. */
function slot(cx, top, stickW, gen, latch, opts) {
  opts = opts || {};
  const w = stickW * 1.1, left = cx - w / 2, h = stickW * 0.085 + 6;
  glow('rgba(0,0,0,0.6)', stickW * 0.04, () => { rrect(left, top, w, h, stickW * 0.012); fill('#14141B'); });
  rrect(left, top, w, h, stickW * 0.012); ctx.fillStyle = vgrad(top, top + h, [[0, '#2A2A36'], [0.3, '#191920'], [1, '#101016']]); ctx.fill();
  ctx.strokeStyle = opts.edge || '#3A3A4C'; ctx.lineWidth = opts.edge ? stickW * 0.008 : stickW * 0.003; ctx.stroke();
  rrect(cx - stickW / 2, top + h * 0.2, stickW, h * 0.38, 2); fill('#030305');
  const kx = cx - stickW / 2 + stickW * GEN[gen].ratio, kw = Math.max(4, stickW * 0.018);
  const keyColor = GEN[gen].color;
  if (opts.keyGlow) glow(opts.keyGlow, stickW * 0.05, () => { ctx.fillStyle = keyColor; ctx.fillRect(kx - kw / 2, top + h * 0.12, kw, h * 0.5); });
  else { ctx.fillStyle = keyColor; ctx.fillRect(kx - kw / 2, top + h * 0.12, kw, h * 0.5); }
  // Latches: 0 open (tilted outward), 1 closed.
  for (const side of [-1, 1]) {
    ctx.save();
    const px = cx + side * (w / 2 - stickW * 0.02), py = top + h;
    ctx.translate(px, py); ctx.rotate(side * (1 - latch) * 0.5);
    const lw = stickW * 0.036, lh = h * 2.2;
    rrect(-lw / 2, -lh, lw, lh, lw * 0.3); ctx.fillStyle = vgrad(-lh, 0, [[0, latch > 0.99 && opts.latchColor ? opts.latchColor : '#3A3A4C'], [1, '#1C1C26']]); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(-lw * 0.3, -lh * 0.95, lw * 0.6, lh * 0.08);
    ctx.restore();
  }
}

/** A recognisable motherboard: socket, VRM heatsinks, PCIe slot, capacitors, one DIMM slot. */
function motherboard(b, gen, opts, detail) {
  glow('rgba(0,0,0,0.6)', 40, () => { rrect(b.x, b.y, b.w, b.h, 18); fill('#101018'); });
  rrect(b.x, b.y, b.w, b.h, 18); ctx.fillStyle = vgrad(b.y, b.y + b.h, [[0, '#191A24'], [1, '#111119']]); ctx.fill();
  faded(detail, () => {
    rrect(b.x, b.y, b.w, b.h, 18); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 2; ctx.stroke();
    // Faint traces.
    ctx.strokeStyle = 'rgba(155,148,255,0.07)'; ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) { const y = b.y + 40 + i * (b.h - 80) / 8; ctx.beginPath(); ctx.moveTo(b.x + b.w * 0.42, y); ctx.lineTo(b.x + b.w * 0.5, y); ctx.lineTo(b.x + b.w * 0.52, y + 12); ctx.stroke(); }
    // CPU socket with retention frame and a pad grid.
    const sx = b.x + b.w * 0.2, sy = b.y + b.h * 0.42, ss = b.h * 0.34;
    rrect(sx - ss * 0.62, sy - ss * 0.62, ss * 1.24, ss * 1.24, 10); fill('#2A2C36');
    rrect(sx - ss / 2, sy - ss / 2, ss, ss, 6); fill('#0C0C12');
    ctx.fillStyle = 'rgba(214,176,90,0.35)';
    for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) ctx.fillRect(sx - ss / 2 + i * ss / 12 - 1.5, sy - ss / 2 + j * ss / 12 - 1.5, 3, 3);
    ctx.fillStyle = '#4A4C58'; ctx.fillRect(sx + ss * 0.66, sy - ss * 0.5, 6, ss);
    // VRM heatsinks with fins, above and left of the socket.
    for (const [x, y, w, h] of [[b.x + 30, b.y + 20, b.w * 0.34, b.h * 0.08], [b.x + 30, b.y + b.h * 0.16, b.w * 0.045, b.h * 0.5]]) {
      rrect(x, y, w, h, 6); ctx.fillStyle = vgrad(y, y + h, [[0, '#6A6E7C'], [1, '#3C3F4A']]); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      if (w > h) for (let fx = x + 10; fx < x + w - 6; fx += 14) ctx.fillRect(fx, y + 4, 4, h - 8);
      else for (let fy = y + 10; fy < y + h - 6; fy += 14) ctx.fillRect(x + 4, fy, w - 8, 4);
    }
    // PCIe x16 slot along the bottom.
    const py = b.y + b.h * 0.84;
    rrect(b.x + b.w * 0.47, py, b.w * 0.48, b.h * 0.055, 4); fill('#1E1E28'); ctx.strokeStyle = '#8A8FA0'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#05050A'; ctx.fillRect(b.x + b.w * 0.48, py + b.h * 0.018, b.w * 0.46, b.h * 0.02);
    // Capacitors.
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(b.x + b.w * 0.42 + i * 28, b.y + b.h * 0.12, 10, 0, Math.PI * 2); fill('#2E3038'); ctx.beginPath(); ctx.arc(b.x + b.w * 0.42 + i * 28, b.y + b.h * 0.12, 4, 0, Math.PI * 2); fill('#4A4D58'); }
  });
  slot(b.slotX, b.slotTop, STICK_W, gen, opts.latch || 0, { edge: opts.slotEdge, keyGlow: opts.keyGlow });
}

// ---------------------------------------------------------------- the world
//
// One world, one camera. At scale 1 world units are screen pixels. The opening
// shots are the DDR5 board's slot seen close up, so every change of shot is a
// camera move, never a jump to a different picture.

const S = DATA.scenes; // approach, stop, notch, boards, catch, cta -> { start, end }
const STICK_W = 480;
function boardRect(y) { return { x: 50, y, w: 980, h: 440, slotX: 50 + 980 * 0.69, slotTop: y + 440 * 0.46 }; }
const BOARD = { DDR4: boardRect(200), DDR5: boardRect(760) };
const SEAT = 22, BLOCK = -3; // stick bottom relative to slot top: seated vs jammed on the key
const NOTCH_X = BOARD.DDR5.slotX - STICK_W / 2 + STICK_W * GEN.DDR4.ratio;
const KEY_X = BOARD.DDR5.slotX - STICK_W / 2 + STICK_W * GEN.DDR5.ratio;

const CAM = {
  slot: { wx: BOARD.DDR5.slotX, wy: BOARD.DDR5.slotTop, sx: 540, sy: 1020, s: 1.9 },
  notch: { wx: (NOTCH_X + KEY_X) / 2, wy: BOARD.DDR5.slotTop, sx: 540, sy: 760, s: 4.4 },
  boards: { wx: 540, wy: 700, sx: 540, sy: 860, s: 1 },
};
const creep = (key, factor) => ({ ...CAM[key], s: CAM[key].s * factor });
CAM.slotEnd = creep('slot', 1.12); CAM.notchEnd = creep('notch', 1.05); CAM.boardsEnd = creep('boards', 1.04);
function camBetween(a, b, p) {
  const s = Math.exp(lerp(Math.log(a.s), Math.log(b.s), p));
  const ca = { x: a.wx + (540 - a.sx) / a.s, y: a.wy + (960 - a.sy) / a.s };
  const cb = { x: b.wx + (540 - b.sx) / b.s, y: b.wy + (960 - b.sy) / b.s };
  return { cx: lerp(ca.x, cb.x, p), cy: lerp(ca.y, cb.y, p), s };
}
const asKey = (cam) => ({ wx: cam.cx, wy: cam.cy, sx: 540, sy: 960, s: cam.s });
function camera(t) {
  const toNotch = easeInOut(seg(t, S.notch.start, S.notch.start + 1.0));
  const toBoards = easeInOut(seg(t, S.boards.start, S.boards.start + 1.1));
  if (toBoards > 0) {
    if (toBoards < 1) return camBetween(CAM.notchEnd, CAM.boards, toBoards);
    return camBetween(CAM.boards, CAM.boardsEnd, seg(t, S.boards.start + 1.1, S.catch.start + 0.6));
  }
  const slotNow = camBetween(CAM.slot, CAM.slotEnd, seg(t, 0, S.notch.start));
  if (toNotch < 1) return camBetween(asKey(slotNow), CAM.notch, toNotch);
  return camBetween(CAM.notch, CAM.notchEnd, seg(t, S.notch.start + 1.0, S.boards.start));
}
const toScreen = (cam, x, y) => [540 + (x - cam.cx) * cam.s, 960 + (y - cam.cy) * cam.s];

// ---------------------------------------------------------------- story

function story(t) {
  const cam = camera(t);
  const jam = S.stop.start;
  const top5 = BOARD.DDR5.slotTop, top4 = BOARD.DDR4.slotTop, x5 = BOARD.DDR5.slotX;
  // Stick: already lined up over the DDR5 slot, pushed down, jams on the key.
  let sx = x5, sb;
  if (t < jam) sb = lerp(top5 - 120, top5 + BLOCK, easeIn(seg(t, 0, jam)) * 0.7 + easeOut(seg(t, 0, jam)) * 0.3);
  else sb = top5 + BLOCK - 6 * Math.exp(-(t - jam) * 9) * Math.abs(Math.sin((t - jam) * 20));
  // Boards: lift out, rise to the DDR4 board, seat.
  const b0 = S.boards.start;
  const lift = easeInOut(seg(t, b0 + 1.15, b0 + 1.5)), rise = easeInOut(seg(t, b0 + 1.5, b0 + 2.25)), seat = easeIn(seg(t, b0 + 2.25, b0 + 2.55));
  const seated = t >= b0 + 2.55, latch = easeOut(seg(t, b0 + 2.55, b0 + 2.7));
  if (lift > 0) {
    sb = lerp(top5 + BLOCK, top5 - 80, lift);
    if (rise > 0) sb = lerp(top5 - 80, top4 - 80, rise);
    if (rise >= 1) sb = lerp(top4 - 80, top4 + SEAT, seat);
    sx = x5;
  }
  const jammed = t >= jam && lift === 0;
  const pulse = 0.65 + 0.3 * Math.sin((t - jam) * 5);
  const red = `rgba(255,23,68,${pulse})`;
  const keyGlow = !jammed ? null : t < S.notch.start ? red : `rgba(0,212,255,${pulse})`;
  const dim = easeOut(seg(t, b0 + 2.7, b0 + 3.1));
  const shake = t >= jam && t < jam + 0.28 ? Math.sin((t - jam) * 64) * 9 * (1 - seg(t, jam, jam + 0.28)) : 0;
  const leave = easeInOut(seg(t, S.catch.start, S.catch.start + 0.55));
  const detail = clamp((1.5 - cam.s) / 0.4);

  ctx.save();
  ctx.globalAlpha *= 1 - leave;
  ctx.translate(540 + shake, 960 + shake * 0.4); ctx.scale(cam.s, cam.s); ctx.translate(-cam.cx, -cam.cy);
  // The DDR4 board is off-stage until the pull-back reveals it.
  faded(clamp((1.75 - cam.s) / 0.5), () => motherboard(BOARD.DDR4, 'DDR4', { latch, slotEdge: seated ? C.green : null }, detail));
  faded(1 - 0.6 * dim, () => motherboard(BOARD.DDR5, 'DDR5', { keyGlow }, detail));
  const exposed = seg(t, jam + 0.2, jam + 0.5) * (1 - seg(t, S.notch.start, S.notch.start + 0.3)) * (0.75 + 0.25 * Math.sin((t - jam) * 6));
  stick(sx, sb, STICK_W, 'DDR4', {
    exposed,
    notchGlow: jammed ? (t < S.notch.start ? red : 'rgba(255,179,0,0.9)') : null,
    outline: seated ? 'rgba(0,230,118,0.9)' : jammed ? 'rgba(255,23,68,0.45)' : null,
  });
  ctx.restore();

  // ---- screen-space labels, one set per shot
  const [, slotY] = toScreen(cam, 0, top5);
  faded((1 - easeInOut(seg(t, S.notch.start, S.notch.start + 0.35))) * (1 - leave), () => tag('DDR5 slot', 540, slotY + 150, C.cyan));
  // Notch: guides and the two names.
  const notchA = seg(t, S.notch.start + 1.05, S.notch.start + 1.4) * (1 - seg(t, S.boards.start, S.boards.start + 0.35));
  faded(notchA, () => {
    const [nx] = toScreen(cam, NOTCH_X, 0), [kx, ky] = toScreen(cam, KEY_X, top5);
    ctx.setLineDash([22, 14]); ctx.lineWidth = 7; ctx.lineCap = 'butt';
    ctx.strokeStyle = C.amber; ctx.beginPath(); ctx.moveTo(nx, ky - 26); ctx.lineTo(nx, ky + 230); ctx.stroke();
    ctx.strokeStyle = C.cyan; ctx.beginPath(); ctx.moveTo(kx, ky + 70); ctx.lineTo(kx, ky + 230); ctx.stroke();
    ctx.setLineDash([]);
    text('DDR4', nx + 26, ky + 262, 80, C.amber, 'left', 900, 12); text('notch', nx + 26, ky + 340, 60, C.amber, 'left', 800, 10);
    text('DDR5', kx - 26, ky + 262, 80, C.cyan, 'right', 900, 12); text('key', kx - 26, ky + 340, 60, C.cyan, 'right', 800, 10);
    text('Diagram, not to scale', 540, ky + 440, 38, C.dim, 'center', 500);
  });
  // Boards: which board is which.
  const boardA = seg(t, b0 + 0.8, b0 + 1.15) * (1 - leave);
  faded(boardA, () => {
    for (const gen of ['DDR4', 'DDR5']) {
      const b = BOARD[gen];
      const [x, y] = toScreen(cam, b.x + 36, b.y + b.h - 58);
      faded(gen === 'DDR5' ? 1 - 0.5 * dim : 1, () => tag(`${gen} board`, x, y, GEN[gen].color, 'left'));
    }
  });
  if (seated) faded(1 - leave, () => {
    const pop = back(seg(t, b0 + 2.7, b0 + 3.0));
    const [x, y] = toScreen(cam, BOARD.DDR4.x + BOARD.DDR4.w - 70, BOARD.DDR4.y + 70);
    ctx.save(); ctx.translate(x, y); ctx.scale(pop, pop);
    glow('rgba(0,230,118,0.6)', 30, () => { ctx.beginPath(); ctx.arc(0, 0, 60, 0, Math.PI * 2); fill(C.green); });
    text('✓', 0, 4, 76, '#04240F', 'center', 900);
    ctx.restore();
  });
}

/** A label on a dark pill, for names that must read at phone size. */
function tag(label, x, y, color, align) {
  ctx.font = font(60, 900);
  const w = ctx.measureText(label).width + 56, h = 92;
  const left = align === 'left' ? x : x - w / 2;
  rrect(left, y - h / 2, w, h, 46); ctx.fillStyle = 'rgba(8,8,13,0.85)'; ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.stroke();
  text(label, left + w / 2, y + 2, 60, color, 'center', 900);
}

// ---------------------------------------------------------------- ending

/** SpecSmith catches the mismatch (a push-in on the real card), then the route. Each once. */
function ending(t) {
  const a = easeOut(seg(t, S.catch.start + 0.3, S.catch.start + 0.9));
  if (a <= 0) return;
  const toCta = easeInOut(seg(t, S.cta.start, S.cta.start + 0.7));
  const push = easeInOut(seg(t, S.catch.start + 0.9, S.cta.start));
  faded(a, () => {
    faded(1 - toCta, () => {
      const size = 96;
      ctx.font = font(64, 800);
      const label = 'SpecSmith Builder', total = size + 22 + ctx.measureText(label).width, x0 = 540 - total / 2;
      ctx.drawImage(logo, x0, 300 - size / 2, size, size);
      text(label, x0 + size + 22, 302, 64, C.text, 'left', 800);
    });
    // The card, pushed in a little; it settles smaller and higher for the CTA.
    const scale = lerp(lerp(1, 1.06, push), 0.86 + 0.03 * seg(t, S.cta.start + 0.7, S.cta.end), toCta);
    const w = 1000 * scale, h = w * card.naturalHeight / card.naturalWidth;
    const x = 540 - w / 2, y = lerp(lerp(470, 430, a), 300, toCta);
    const pulse = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin((t - S.catch.start) * 3));
    glow(`rgba(255,23,68,${pulse})`, 60, () => { rrect(x - 6, y - 6, w + 12, h + 12, 24); fill('#13131A'); });
    ctx.save(); rrect(x, y, w, h, 18); ctx.clip();
    ctx.drawImage(card, x, y, w, h);
    // Highlighter sweeps over the card's own words, in step with the voice.
    for (const mark of DATA.cardMarks) {
      const p = easeInOut(seg(t, S.catch.start + mark.at, S.catch.start + mark.at + 0.45));
      if (p <= 0) continue;
      ctx.globalCompositeOperation = 'screen';
      rrect(x + mark.x * w - 5, y + mark.y * h - 2, (mark.w * w + 10) * p, mark.h * h + 4, 6);
      ctx.fillStyle = mark.color === 'amber' ? 'rgba(255,179,0,0.5)' : 'rgba(0,212,255,0.5)'; ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    // CTA lockup beneath the card.
    faded(toCta, () => {
      const base = y + h + 120 + 20 * (1 - toCta);
      const size = 120;
      ctx.font = font(88, 900);
      const total = size + 24 + ctx.measureText('SpecSmith').width, x0 = 540 - total / 2;
      ctx.drawImage(logo, x0, base, size, size);
      text('SpecSmith', x0 + size + 24, base + size / 2 + 2, 88, C.text, 'left', 900);
      const uy = base + size + 110;
      const breathe = 0.5 + 0.5 * Math.sin((t - S.cta.start) * 3.4);
      glow(`rgba(0,212,255,${0.25 + 0.35 * breathe})`, 40, () => { rrect(100, uy - 64, 880, 128, 64); ctx.fillStyle = 'rgba(0,212,255,0.14)'; ctx.fill(); });
      ctx.strokeStyle = C.cyan; ctx.lineWidth = 5; ctx.stroke();
      text('specsmithpc.com/builder', 540, uy + 2, 58, C.cyan, 'center', 800);
    });
  });
}

// ---------------------------------------------------------------- captions

function captionWord(word) { return /DDR4/.test(word) ? C.amber : /DDR5/.test(word) ? C.cyan : C.text; }
function captions(t) {
  const cue = DATA.captions.find((c) => t >= c.start && t < c.end);
  if (!cue) return;
  const p = cue.start <= 0 ? 1 : easeOut(seg(t, cue.start, cue.start + 0.12));
  const lines = cue.lines, cy = 1530;
  let size = 76;
  ctx.font = font(size, 800);
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  if (widest > 920) size = Math.floor(size * 920 / widest);
  const lh = Math.round(size * 1.22);
  ctx.save(); ctx.globalAlpha *= p; ctx.translate(540, cy + (1 - p) * 10);
  ctx.font = font(size, 800);
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width));
  rrect(-width / 2 - 36, -(lines.length * lh) / 2 - 22, width + 72, lines.length * lh + 44, 28); ctx.fillStyle = 'rgba(6,6,10,0.84)'; ctx.fill();
  lines.forEach((line, i) => {
    const y = -((lines.length - 1) * lh) / 2 + i * lh;
    const words = line.split(' '), space = ctx.measureText(' ').width;
    let x = -ctx.measureText(line).width / 2;
    for (const word of words) { const ww = ctx.measureText(word).width; text(word, x + ww / 2, y, size, captionWord(word), 'center', 800, 10); x += ww + space; }
  });
  ctx.restore();
}

function background(t) {
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(540, 820 + 30 * Math.sin(t * 0.4), 40, 540, 860, 1100);
  g.addColorStop(0, 'rgba(108,99,255,0.20)'); g.addColorStop(0.5, 'rgba(40,36,90,0.08)'); g.addColorStop(1, 'rgba(8,8,13,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const v = ctx.createRadialGradient(540, 960, 600, 540, 960, 1250);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}

window.renderAt = function renderAt(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  background(t);
  story(t);
  ending(t);
  captions(t);
  faded(0.6, () => text('DRAFT · temp voice', 40, 70, 26, C.dim, 'left', 500));
  return canvas.toDataURL('image/jpeg', 0.94);
};
