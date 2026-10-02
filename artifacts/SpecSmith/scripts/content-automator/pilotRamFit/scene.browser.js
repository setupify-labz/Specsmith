// Drawing code for the RAM-fit pilot, run inside a browser page by render.ts.
// Pure in `t`: no clocks, no randomness, so the same inputs give the same frames.
// DATA is injected by render.ts before this file.
/* global DATA */
const W = 1080, H = 1920;
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const C = {
  bg: '#0A0A0F', grid: 'rgba(255,255,255,0.035)', accent: '#6C63FF', cyan: '#00D4FF', green: '#00E676',
  red: '#FF1744', amber: '#FFB300', text: '#F0F0FF', dim: '#9A9AB8', pcb: '#1E7A46', pcbEdge: '#11512C',
  chip: '#121218', gold: '#D9AE3A', goldLine: '#9C7A1E', slot: '#1B1B24', slotEdge: '#34344A', groove: '#050507',
  board: '#15151E', boardEdge: '#2E2E40',
};
const FONT = '"DejaVu Sans", sans-serif';
const GEN = { DDR4: { ratio: 0.555, color: C.amber }, DDR5: { ratio: 0.47, color: C.cyan } };

const clamp = (x) => Math.max(0, Math.min(1, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
const easeIn = (x) => Math.pow(clamp(x), 2.2);
const easeInOut = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const back = (x) => { x = clamp(x); const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const lerp = (a, b, p) => a + (b - a) * p;

function font(size, weight) { return `${weight || 'bold'} ${size}px ${FONT}`; }
function text(s, x, y, size, color, align, weight, stroke) {
  ctx.font = font(size, weight); ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
  if (stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = stroke; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(s, x, y); }
  ctx.fillStyle = color; ctx.fillText(s, x, y);
}
function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)); }
function fill(color) { ctx.fillStyle = color; ctx.fill(); }
function faded(alpha, draw) { if (alpha <= 0.001) return; ctx.save(); ctx.globalAlpha *= Math.min(1, alpha); draw(); ctx.restore(); }
function glow(color, blur, draw) { ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = blur; draw(); ctx.restore(); }

const logo = new Image(); logo.src = DATA.logoDataUrl;
const card = new Image(); card.src = DATA.cardDataUrl;
window.assetsReady = Promise.all([logo, card].map((img) => new Promise((r) => { if (img.complete) r(); else img.onload = r; })));

// ---------------------------------------------------------------- parts

/** A RAM stick, bottom edge at `bottom`, centred on cx. `notchGlow` colours the key notch. */
function stick(cx, bottom, w, gen, opts) {
  opts = opts || {};
  const h = w * 0.27, left = cx - w / 2, top = bottom - h;
  const nx = left + w * GEN[gen].ratio, nw = Math.max(5, w * 0.026), nd = h * 0.17;
  ctx.save();
  if (opts.rotate) { ctx.translate(cx, bottom - h / 2); ctx.rotate(opts.rotate); ctx.translate(-cx, -(bottom - h / 2)); }
  if (opts.outline) glow(opts.outline, 40, () => { rrect(left, top, w, h, 10); ctx.strokeStyle = opts.outline; ctx.lineWidth = 4; ctx.stroke(); });
  // PCB with the key notch cut out of the bottom edge.
  ctx.beginPath();
  ctx.moveTo(left + 10, top); ctx.lineTo(left + w - 10, top); ctx.quadraticCurveTo(left + w, top, left + w, top + 10);
  ctx.lineTo(left + w, bottom); ctx.lineTo(nx + nw / 2, bottom); ctx.lineTo(nx + nw / 2, bottom - nd);
  ctx.arc(nx, bottom - nd, nw / 2, 0, Math.PI, true); ctx.lineTo(nx - nw / 2, bottom); ctx.lineTo(left, bottom);
  ctx.lineTo(left, top + 10); ctx.quadraticCurveTo(left, top, left + 10, top); ctx.closePath();
  ctx.fillStyle = C.pcb; ctx.fill(); ctx.lineWidth = Math.max(2, w * 0.004); ctx.strokeStyle = C.pcbEdge; ctx.stroke();
  // Memory chips.
  const chips = 8, gap = w * 0.018, cw = (w * 0.9 - gap * (chips - 1)) / chips;
  for (let i = 0; i < chips; i++) {
    const x = left + w * 0.05 + i * (cw + gap);
    rrect(x, top + h * 0.14, cw, h * 0.46, 4); fill(C.chip);
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x + 4, top + h * 0.16, cw - 8, 3);
  }
  // Label sticker naming the generation.
  rrect(cx - w * 0.17, top + h * 0.2, w * 0.34, h * 0.34, 6); fill('#EEEEF6');
  text(gen, cx, top + h * 0.375, Math.round(h * 0.25), '#111118');
  // Gold contacts, interrupted by the notch.
  const cy = bottom - h * 0.15;
  ctx.fillStyle = C.gold; ctx.fillRect(left + w * 0.02, cy, nx - nw / 2 - (left + w * 0.02), h * 0.13);
  ctx.fillRect(nx + nw / 2, cy, left + w * 0.98 - (nx + nw / 2), h * 0.13);
  ctx.fillStyle = C.goldLine;
  for (let x = left + w * 0.025; x < left + w * 0.975; x += Math.max(4, w * 0.011)) {
    if (Math.abs(x - nx) < nw) continue;
    ctx.fillRect(x, cy + 2, 1.5, h * 0.11);
  }
  if (opts.notchGlow) glow(opts.notchGlow, 30, () => {
    ctx.strokeStyle = opts.notchGlow; ctx.lineWidth = Math.max(3, w * 0.006);
    ctx.beginPath(); ctx.arc(nx, bottom - nd * 0.6, nw * 1.4, 0, Math.PI * 2); ctx.stroke();
  });
  ctx.restore();
}

/** A DIMM slot whose top edge is at `top`; the key sits where a `gen` stick's notch goes. */
function slot(cx, top, stickW, gen, latch, opts) {
  opts = opts || {};
  const w = stickW + stickW * 0.1, left = cx - w / 2, h = stickW * 0.075 + 14;
  rrect(left, top, w, h, 6); fill(C.slot); ctx.strokeStyle = opts.edge || C.slotEdge; ctx.lineWidth = opts.edgeWidth || 2; ctx.stroke();
  rrect(cx - stickW / 2, top + h * 0.18, stickW, h * 0.42, 3); fill(C.groove);
  const kx = cx - stickW / 2 + stickW * GEN[gen].ratio, kw = Math.max(4, stickW * 0.02);
  ctx.fillStyle = opts.keyColor || '#4A4A5E'; ctx.fillRect(kx - kw / 2, top + h * 0.12, kw, h * 0.5);
  if (opts.keyGlow) glow(opts.keyGlow, 30, () => { ctx.fillStyle = opts.keyColor || '#4A4A5E'; ctx.fillRect(kx - kw / 2, top + h * 0.12, kw, h * 0.5); });
  // Latches: 0 open (tilted outward), 1 closed.
  for (const side of [-1, 1]) {
    ctx.save();
    const px = cx + side * (w / 2 - stickW * 0.02), py = top + h;
    ctx.translate(px, py); ctx.rotate(side * (1 - latch) * 0.55);
    rrect(-stickW * 0.018, -h * 2.1, stickW * 0.036, h * 2.1, 4); fill(latch > 0.99 && opts.latchColor ? opts.latchColor : '#2A2A3A');
    ctx.restore();
  }
  return { keyX: kx, height: h };
}

// ---------------------------------------------------------------- the world
//
// One world, one camera. Board-view coordinates are screen pixels at scale 1;
// the opening shots are the same slot seen close up, so every cut is a camera
// move, never a jump to a different picture.

const S = DATA.scenes; // approach, stop, notch, boards, catch, cta -> { start, end }
const STICK_W = 330;
const BOARDS = {
  DDR4: { x: 60, y: 600, w: 420, h: 420 },
  DDR5: { x: 600, y: 600, w: 420, h: 420 },
};
const slotTop = (gen) => BOARDS[gen].y + 280;
const slotX = (gen) => BOARDS[gen].x + BOARDS[gen].w / 2;
const SEAT = 18, BLOCK = -2; // stick bottom relative to slot top: seated vs jammed on the key

const NOTCH_X = slotX('DDR5') - STICK_W / 2 + STICK_W * GEN.DDR4.ratio;
const KEY_X = slotX('DDR5') - STICK_W / 2 + STICK_W * GEN.DDR5.ratio;

/** Camera keyframes: world point -> screen point, at a scale. */
const CAM = {
  slot: { wx: slotX('DDR5'), wy: slotTop('DDR5'), sx: 540, sy: 1060, s: 2.75 },
  notch: { wx: (NOTCH_X + KEY_X) / 2, wy: slotTop('DDR5'), sx: 540, sy: 760, s: 6.2 },
  boards: { wx: 540, wy: 810, sx: 540, sy: 860, s: 1.06 },
};
// Each held shot creeps slowly forward, so nothing sits still.
const creep = (key, factor) => ({ ...CAM[key], s: CAM[key].s * factor });
CAM.slotEnd = creep('slot', 1.14);
CAM.notchEnd = creep('notch', 1.05);
CAM.boardsEnd = creep('boards', 1.06);
function camBetween(a, b, p) {
  const s = Math.exp(lerp(Math.log(a.s), Math.log(b.s), p));
  // Interpolate the world point that sits at the screen centre, so the move reads as one smooth dolly.
  const ca = { x: a.wx + (540 - a.sx) / a.s, y: a.wy + (960 - a.sy) / a.s };
  const cb = { x: b.wx + (540 - b.sx) / b.s, y: b.wy + (960 - b.sy) / b.s };
  return { cx: lerp(ca.x, cb.x, p), cy: lerp(ca.y, cb.y, p), s };
}
/** A camera state expressed as a keyframe (world centre at screen centre). */
const asKey = (cam) => ({ wx: cam.cx, wy: cam.cy, sx: 540, sy: 960, s: cam.s });
function camera(t) {
  const toNotch = easeInOut(seg(t, S.notch.start, S.notch.start + 1.1));
  const toBoards = easeInOut(seg(t, S.boards.start, S.boards.start + 1.1));
  if (toBoards > 0) {
    if (toBoards < 1) return camBetween(CAM.notchEnd, CAM.boards, toBoards);
    return camBetween(CAM.boards, CAM.boardsEnd, seg(t, S.boards.start + 1.1, S.catch.start + 0.6));
  }
  const slotNow = camBetween(CAM.slot, CAM.slotEnd, seg(t, 0, S.notch.start));
  if (toNotch < 1) return camBetween(asKey(slotNow), CAM.notch, toNotch);
  return camBetween(CAM.notch, CAM.notchEnd, seg(t, S.notch.start + 1.1, S.boards.start));
}
const toScreen = (cam, x, y) => [540 + (x - cam.cx) * cam.s, 960 + (y - cam.cy) * cam.s];

function boardShape(gen, alpha, opts, scale) {
  const b = BOARDS[gen];
  // Close up, the board is only a backdrop: its outline and socket fade out.
  const detail = clamp((2.0 - scale) / 0.8);
  faded(alpha, () => {
    rrect(b.x, b.y, b.w, b.h, 16); fill(C.board);
    faded(detail, () => { ctx.strokeStyle = C.boardEdge; ctx.lineWidth = 2.5; ctx.stroke(); });
    const ss = 120;
    faded(detail, () => { rrect(b.x + b.w / 2 - ss / 2, b.y + 60, ss, ss, 8); fill('#0E0E14'); ctx.strokeStyle = '#34344A'; ctx.lineWidth = 2.5; ctx.stroke(); });
    slot(slotX(gen), slotTop(gen), STICK_W, gen, opts.latch || 0, { keyColor: GEN[gen].color, edge: opts.slotEdge, edgeWidth: 3 });
  });
}

// ---------------------------------------------------------------- story

function story(t) {
  const cam = camera(t);
  const jam = S.stop.start + 0.05;
  // Stick path (world): lowering into the DDR5 slot, jammed, then (boards shot) lifted across and seated in the DDR4 slot.
  const top5 = slotTop('DDR5'), top4 = slotTop('DDR4');
  let sx = slotX('DDR5'), sb;
  if (t < jam) sb = lerp(top5 - 95, top5 + BLOCK, 0.8 * easeOut(seg(t, 0, jam - 0.4)) + 0.2 * easeIn(seg(t, jam - 0.4, jam)));
  else sb = top5 + BLOCK - 3 * Math.exp(-(t - jam) * 10) * Math.abs(Math.sin((t - jam) * 18));
  const lift = easeInOut(seg(t, S.boards.start + 1.2, S.boards.start + 1.6));
  const across = easeInOut(seg(t, S.boards.start + 1.6, S.boards.start + 2.3));
  const seat = easeIn(seg(t, S.boards.start + 2.3, S.boards.start + 2.6));
  const seated = t >= S.boards.start + 2.6;
  const latch = easeOut(seg(t, S.boards.start + 2.6, S.boards.start + 2.75));
  if (lift > 0) {
    sb = lerp(top5 + BLOCK, top5 - 120, lift);
    sx = lerp(slotX('DDR5'), slotX('DDR4'), across);
    if (across >= 1) sb = lerp(top4 - 120, top4 + SEAT, seat);
  }
  const jammed = t >= jam && lift === 0;
  const glowA = jammed ? 0.6 + 0.3 * Math.sin((t - jam) * 5) : 0;
  const red = `rgba(255,23,68,${glowA})`;
  const dim = easeOut(seg(t, S.boards.start + 2.75, S.boards.start + 3.2));
  const shake = t >= jam && t < jam + 0.3 ? Math.sin((t - jam) * 60) * 7 * (1 - seg(t, jam, jam + 0.3)) : 0;
  const leave = easeInOut(seg(t, S.catch.start, S.catch.start + 0.6));

  ctx.save();
  ctx.globalAlpha *= 1 - leave;
  ctx.translate(540 + shake, 960); ctx.scale(cam.s, cam.s); ctx.translate(-cam.cx, -cam.cy);
  boardShape('DDR4', 1, { latch, slotEdge: seated ? C.green : null }, cam.s);
  boardShape('DDR5', 1 - 0.55 * dim, {}, cam.s);
  const keyGlow = t < S.notch.start ? red : `rgba(0,212,255,${0.5 + 0.3 * Math.sin((t - jam) * 5)})`;
  if (jammed) faded(1, () => slot(slotX('DDR5'), top5, STICK_W, 'DDR5', 0, { keyColor: C.cyan, keyGlow, edgeWidth: 3 }));
  stick(sx, sb, STICK_W, 'DDR4', {
    notchGlow: jammed ? red : null,
    outline: seated ? 'rgba(0,230,118,0.85)' : jammed ? 'rgba(255,23,68,0.45)' : 'rgba(155,148,255,0.5)',
  });
  ctx.restore();

  // Screen-space labels, one set per shot.
  const slotShot = 1 - easeInOut(seg(t, S.notch.start, S.notch.start + 0.4));
  faded(slotShot * (1 - leave), () => {
    const [, y] = toScreen(cam, 0, top5);
    text('DDR5 slot', 540, y + 170, 68, C.cyan);
  });
  const notchLabels = seg(t, S.notch.start + 1.2, S.notch.start + 1.6) * (1 - seg(t, S.boards.start, S.boards.start + 0.35));
  faded(notchLabels, () => {
    const [nx] = toScreen(cam, NOTCH_X, 0), [kx, ky] = toScreen(cam, KEY_X, top5);
    ctx.setLineDash([20, 14]); ctx.lineWidth = 6;
    // Guides start at the contact edge, below the sticker, and run down to the labels.
    ctx.strokeStyle = C.amber; ctx.beginPath(); ctx.moveTo(nx, ky - 20); ctx.lineTo(nx, ky + 220); ctx.stroke();
    ctx.strokeStyle = C.cyan; ctx.beginPath(); ctx.moveTo(kx, ky + 60); ctx.lineTo(kx, ky + 220); ctx.stroke();
    ctx.setLineDash([]);
    text('DDR4', nx + 24, ky + 280, 72, C.amber, 'left', 'bold', 10); text('notch', nx + 24, ky + 350, 56, C.amber, 'left', 'bold', 8);
    text('DDR5', kx - 24, ky + 280, 72, C.cyan, 'right', 'bold', 10); text('key', kx - 24, ky + 350, 56, C.cyan, 'right', 'bold', 8);
  });
  faded(notchLabels, () => text('Diagram, not to scale', 540, 1300, 40, C.dim, 'center', 'normal'));

  const boardLabels = seg(t, S.boards.start + 0.8, S.boards.start + 1.2) * (1 - leave);
  faded(boardLabels, () => {
    for (const gen of ['DDR4', 'DDR5']) {
      const b = BOARDS[gen];
      const [x, y] = toScreen(cam, b.x + b.w / 2, b.y + b.h);
      faded(gen === 'DDR5' ? 1 - 0.55 * dim : 1, () => text(`${gen} slots`, x, y + 70, 68, GEN[gen].color));
    }
  });
  if (seated) faded(1 - leave, () => {
    const pop = back(seg(t, S.boards.start + 2.75, S.boards.start + 3.05));
    const b = BOARDS.DDR4;
    const [x, y] = toScreen(cam, b.x + b.w / 2, b.y);
    ctx.save(); ctx.translate(x, y - 80); ctx.scale(pop, pop);
    ctx.beginPath(); ctx.arc(0, 0, 58, 0, Math.PI * 2); fill(C.green); text('✓', 0, 4, 72, '#062B16');
    ctx.restore();
  });
}

/** SpecSmith catches the mismatch, then the route. Shown once, at the end. */
function ending(t) {
  const a = easeOut(seg(t, S.catch.start + 0.35, S.catch.start + 0.95));
  if (a <= 0) return;
  faded(a, () => {
    const size = 104;
    ctx.font = font(70);
    const label = 'SpecSmith Builder', total = size + 24 + ctx.measureText(label).width, x0 = 540 - total / 2;
    ctx.drawImage(logo, x0, 400 - size / 2, size, size);
    text(label, x0 + size + 24, 402, 70, C.text, 'left');
    // The card breathes a little: a slow scale and a red glow that pulses gently.
    const grow = 1 + 0.025 * seg(t, S.catch.start, S.cta.end);
    const w = 980 * grow, h = w * card.naturalHeight / card.naturalWidth, x = 540 - w / 2, y = lerp(560, 520, a);
    const pulse = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin((t - S.catch.start) * 3.2));
    glow(`rgba(255,23,68,${pulse})`, 56, () => { rrect(x - 6, y - 6, w + 12, h + 12, 22); fill('#13131A'); });
    ctx.drawImage(card, x, y, w, h);
    const url = easeOut(seg(t, S.cta.start + 0.1, S.cta.start + 0.6));
    faded(url, () => {
      const uy = y + h + 140 - 20 * (1 - url);
      rrect(90, uy - 62, 900, 124, 62); ctx.fillStyle = 'rgba(0,212,255,0.12)'; ctx.fill(); ctx.strokeStyle = C.cyan; ctx.lineWidth = 4; ctx.stroke();
      text('specsmithpc.com/builder', 540, uy + 2, 56, C.cyan);
    });
  });
}

// ---------------------------------------------------------------- captions

function captionWord(word) { return /DDR4/.test(word) ? C.amber : /DDR5/.test(word) ? C.cyan : C.text; }
function captions(t) {
  const cue = DATA.captions.find((c) => t >= c.start && t < c.end);
  if (!cue) return;
  const p = cue.start <= 0 ? 1 : easeOut(seg(t, cue.start, cue.start + 0.12));
  const lines = cue.lines, cy = 1500;
  let size = 70;
  ctx.font = font(size);
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  if (widest > 920) size = Math.floor(70 * 920 / widest);
  const lh = Math.round(size * 1.26);
  ctx.save(); ctx.globalAlpha *= p; ctx.translate(540, cy);
  ctx.font = font(size);
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width));
  rrect(-width / 2 - 34, -(lines.length * lh) / 2 - 22, width + 68, lines.length * lh + 44, 26); ctx.fillStyle = 'rgba(8,8,12,0.8)'; ctx.fill();
  lines.forEach((line, i) => {
    const y = -((lines.length - 1) * lh) / 2 + i * lh;
    const words = line.split(' '), space = ctx.measureText(' ').width;
    let x = -ctx.measureText(line).width / 2;
    for (const word of words) { const ww = ctx.measureText(word).width; text(word, x + ww / 2, y, size, captionWord(word), 'center', 'bold', 10); x += ww + space; }
  });
  ctx.restore();
}

function background() {
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(540, 860, 60, 540, 860, 1000);
  g.addColorStop(0, 'rgba(108,99,255,0.14)'); g.addColorStop(1, 'rgba(10,10,15,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

window.renderAt = function renderAt(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  background();
  story(t);
  ending(t);
  captions(t);
  faded(0.7, () => text('DRAFT · temp voice', 40, 70, 28, C.dim, 'left', 'normal'));
  return canvas.toDataURL('image/jpeg', 0.93);
};
