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
  if (opts.keyGlow) glow(opts.keyGlow, 30, () => { ctx.fillStyle = opts.keyGlow; ctx.fillRect(kx - kw / 2, top + h * 0.12, kw, h * 0.5); });
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

function chip(cx, cy, size, alpha) {
  faded(alpha, () => {
    rrect(cx - size / 2, cy - size / 2, size, size, size * 0.05); fill('#1C4A2E');
    const pad = size * 0.11;
    const g = ctx.createLinearGradient(cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2);
    g.addColorStop(0, '#E6E8EF'); g.addColorStop(0.5, '#B9BDC9'); g.addColorStop(1, '#D9DCE5');
    rrect(cx - size / 2 + pad, cy - size / 2 + pad, size - 2 * pad, size - 2 * pad, size * 0.06); ctx.fillStyle = g; ctx.fill();
    text(DATA.cpuName, cx, cy, Math.round(size * 0.12), '#15151C');
  });
}

function board(x, y, w, h, gen, opts) {
  opts = opts || {};
  rrect(x, y, w, h, 18); fill(C.board); ctx.strokeStyle = C.boardEdge; ctx.lineWidth = 3; ctx.stroke();
  ctx.strokeStyle = 'rgba(108,99,255,0.10)'; ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(x + 24, y + 60 + i * 26); ctx.lineTo(x + w * 0.22, y + 60 + i * 26); ctx.lineTo(x + w * 0.26, y + 80 + i * 26); ctx.stroke(); }
  const sx = x + w / 2, sy = y + h * 0.25, ss = w * 0.34;
  rrect(sx - ss / 2, sy - ss / 2, ss, ss, 8); fill('#0E0E14'); ctx.strokeStyle = opts.socketColor || '#3A3A4E'; ctx.lineWidth = opts.socketColor ? 5 : 3; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  for (let i = 1; i < 9; i++) for (let j = 1; j < 9; j++) ctx.fillRect(sx - ss / 2 + i * ss / 9 - 1.5, sy - ss / 2 + j * ss / 9 - 1.5, 3, 3);
  const sw = w * 0.74;
  const slots = [y + h * 0.56, y + h * 0.7].map((top, index) => ({ top, ...slot(x + w / 2, top, sw, gen, index === 0 ? (opts.latch ?? 0) : 0, { keyColor: GEN[gen].color, edge: index === 0 ? opts.slotEdge : undefined, edgeWidth: 4 }) }));
  return { socket: { x: sx, y: sy, size: ss }, slotTop: slots[0].top, stickW: sw };
}

// ---------------------------------------------------------------- scenes

function background(t) {
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = C.grid; ctx.lineWidth = 2;
  const drift = (t * 18) % 90;
  for (let x = -90 + drift; x < W + 90; x += 90) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = -90 + drift; y < H + 90; y += 90) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  const g = ctx.createRadialGradient(540, 820, 80, 540, 820, 900);
  g.addColorStop(0, 'rgba(108,99,255,0.16)'); g.addColorStop(1, 'rgba(10,10,15,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

const S = DATA.scenes; // { hook, why, twist, payoff, cta } -> { start, end }
const STICK_W = 900, SLOT_TOP = 1130;
const SEATED = SLOT_TOP + 34, BLOCKED = SLOT_TOP - 6;

/** Hook + why share one set: a DDR4 stick against a DDR5 slot, then a push-in on the contacts. */
function slotScene(t) {
  const hit = S.hook.start + 0.62;
  let bottom;
  if (t < hit) bottom = lerp(640, BLOCKED, easeIn(seg(t, 0.12, hit)));
  else bottom = BLOCKED - 26 * Math.exp(-(t - hit) * 7) * Math.abs(Math.sin((t - hit) * 16));
  const shake = t >= hit && t < hit + 0.45 ? Math.sin((t - hit) * 70) * 16 * (1 - seg(t, hit, hit + 0.45)) : 0;
  const tilt = t < hit ? lerp(-0.05, 0, seg(t, 0, hit)) : 0;
  const blocked = t >= hit;

  // Push-in on the contacts during "why".
  const nx = 540 - STICK_W / 2 + STICK_W * GEN.DDR4.ratio, kx = 540 - STICK_W / 2 + STICK_W * GEN.DDR5.ratio, fx = (nx + kx) / 2;
  const z = easeInOut(seg(t, S.why.start + 0.05, S.why.start + 0.85));
  const scale = 2.2, focusY = SLOT_TOP, focusScreenY = 760;
  const toScreen = (x, y) => [540 + (x - fx) * scale, focusScreenY + (y - focusY) * scale];
  const camX = lerp(0, 540 - fx * scale, z), camY = lerp(0, focusScreenY - focusY * scale, z), camS = lerp(1, scale, z);

  // The DDR4 stick lifts out late in "why" and a DDR5 stick drops in and seats.
  const swapOut = seg(t, S.why.start + 2.55, S.why.start + 2.95), swapIn = easeOut(seg(t, S.why.start + 2.95, S.why.start + 3.55));

  if (t < hit) {
    const v = seg(t, 0.12, hit);
    ctx.strokeStyle = `rgba(155,148,255,${0.18 + 0.4 * v})`; ctx.lineCap = 'round';
    for (const [x, len, w] of [[230, 180, 6], [420, 260, 8], [660, 220, 7], [850, 160, 5]]) {
      const top = bottom - STICK_W * 0.27 - 30 - len * (0.6 + v);
      ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom - STICK_W * 0.27 - 30); ctx.stroke();
    }
  }
  ctx.save();
  ctx.translate(shake + camX, camY); ctx.scale(camS, camS);
  const pulse = blocked ? 0.55 + 0.45 * Math.sin((t - hit) * 9) : 0;
  const red = `rgba(255,23,68,${pulse})`;
  slot(540, SLOT_TOP, STICK_W, 'DDR5', 0, { keyGlow: blocked && swapIn < 1 ? red : swapIn >= 1 ? C.green : null, keyColor: C.cyan });
  faded(1 - swapOut, () => stick(540, bottom - swapOut * 420, STICK_W, 'DDR4', { rotate: tilt, notchGlow: blocked ? red : null, outline: blocked ? 'rgba(255,23,68,0.5)' : 'rgba(108,99,255,0.6)' }));
  faded(swapIn, () => stick(540, lerp(SEATED - 380, SEATED, swapIn), STICK_W, 'DDR5', { outline: swapIn >= 1 ? 'rgba(0,230,118,0.7)' : 'rgba(0,212,255,0.6)', notchGlow: swapIn >= 1 ? C.green : null }));
  ctx.restore();

  // Hook overlays (screen space).
  const zoomed = z > 0.02;
  faded(1 - seg(t, S.why.start - 0.05, S.why.start + 0.2), () => {
    text('DDR5 slot', 540, SLOT_TOP + 160, 54, C.cyan);
    const stamp = back(seg(t, hit + 0.18, hit + 0.42));
    if (stamp > 0) {
      ctx.save(); ctx.translate(540, 700); ctx.rotate(-0.07); ctx.scale(stamp, stamp);
      rrect(-330, -78, 660, 156, 20); ctx.fillStyle = 'rgba(255,23,68,0.14)'; ctx.fill(); ctx.strokeStyle = C.red; ctx.lineWidth = 8; ctx.stroke();
      text("WON'T GO IN", 0, 4, 94, C.red);
      ctx.restore();
    }
  });
  // "Why" overlays: guides from the notch and the key, then the DDR5 fix.
  if (zoomed) {
    const [nsx] = toScreen(nx, 0), [ksx] = toScreen(kx, 0);
    const guides = seg(t, S.why.start + 0.9, S.why.start + 1.3) * (1 - swapOut);
    faded(guides * z, () => {
      ctx.setLineDash([18, 14]); ctx.lineWidth = 5;
      ctx.strokeStyle = C.amber; ctx.beginPath(); ctx.moveTo(nsx, 640); ctx.lineTo(nsx, 1030); ctx.stroke();
      ctx.strokeStyle = C.cyan; ctx.beginPath(); ctx.moveTo(ksx, 640); ctx.lineTo(ksx, 1030); ctx.stroke();
      ctx.setLineDash([]);
      text('DDR4 notch', nsx + 18, 1010, 52, C.amber, 'left', 'bold', 8);
      text('DDR5 key', ksx - 18, 1010, 52, C.cyan, 'right', 'bold', 8);
    });
    const gap = seg(t, S.why.start + 1.4, S.why.start + 1.75) * (1 - swapOut);
    faded(gap * z, () => {
      const y = 1090; ctx.strokeStyle = C.red; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(ksx + 8, y); ctx.lineTo(nsx - 8, y); ctx.stroke();
      for (const [x, d] of [[ksx + 8, 1], [nsx - 8, -1]]) { ctx.beginPath(); ctx.moveTo(x + d * 22, y - 18); ctx.lineTo(x, y); ctx.lineTo(x + d * 22, y + 18); ctx.stroke(); }
      text("doesn't line up", 540, 1160, 56, C.red);
    });
    faded(seg(t, S.why.start + 3.5, S.why.start + 3.8) * z, () => {
      text('DDR5 stick: lines up', 540, 1110, 58, C.green);
    });
    faded(seg(t, S.why.start + 0.7, S.why.start + 0.95) * (1 - seg(t, S.why.end - 0.2, S.why.end + 0.1)), () => text('Diagram, not to scale', 540, 1262, 38, C.dim, 'center', 'normal'));
  }
}

function boardsLayout() {
  return { left: { x: 60, y: 640, w: 450, h: 540 }, right: { x: 570, y: 640, w: 450, h: 540 } };
}

/** Twist + payoff: one CPU, two boards. */
function boardScene(t) {
  const L = boardsLayout();
  const enter = easeOut(seg(t, S.twist.start + 0.45, S.twist.start + 1.1));
  const exit = easeInOut(seg(t, S.cta.start, S.cta.start + 0.3));
  const chipIn = back(seg(t, S.twist.start + 0.15, S.twist.start + 0.55));
  const fly = easeInOut(seg(t, S.twist.start + 1.25, S.twist.start + 1.95));
  const landed = t >= S.twist.start + 1.95;
  const decides = back(seg(t, S.twist.start + 2.6, S.twist.start + 2.95));
  const seatT = S.payoff.start + 0.75, latchT = seatT + 0.12;
  const stickDrop = easeIn(seg(t, S.payoff.start + 0.15, seatT));
  const latch = easeOut(seg(t, latchT, latchT + 0.18));
  const seated = t >= latchT + 0.18;
  const dim = easeOut(seg(t, latchT, latchT + 0.4));

  ctx.save();
  ctx.translate(0, -exit * 260); ctx.globalAlpha *= 1 - exit;
  ctx.save();

  // Boards slide in from either side.
  const lx = lerp(-L.left.w - 40, L.left.x, enter), rx = lerp(W + 40, L.right.x, enter);
  let left, right;
  faded(1, () => { left = board(lx, L.left.y, L.left.w, L.left.h, 'DDR4', { socketColor: landed ? C.green : null, latch, slotEdge: seated ? C.green : null }); });
  faded(1 - dim * 0.6, () => { right = board(rx, L.right.y, L.right.w, L.right.h, 'DDR5', { socketColor: landed ? C.green : null }); });
  faded(enter, () => {
    text('DDR4 board', lx + L.left.w / 2, L.left.y + L.left.h + 58, 54, C.amber);
    const names = 1 - seg(t, S.payoff.start, S.payoff.start + 0.3);
    faded(names, () => text(DATA.ddr4Board, lx + L.left.w / 2, L.left.y + L.left.h + 112, 32, C.dim, 'center', 'normal'));
    faded(1 - dim * 0.6, () => {
      text('DDR5 board', rx + L.right.w / 2, L.right.y + L.right.h + 58, 54, C.cyan);
      faded(names, () => text(DATA.ddr5Board, rx + L.right.w / 2, L.right.y + L.right.h + 112, 32, C.dim, 'center', 'normal'));
    });
  });

  // The CPU, then a copy flying into each socket.
  const from = { x: 540, y: 330, s: 230 };
  if (!landed || fly < 1) {
    chip(from.x, from.y, from.s * chipIn, 1 - fly);
    faded(chipIn * (1 - seg(t, S.twist.start + 1.0, S.twist.start + 1.25)), () => {
      text('works with', 540, 500, 40, C.dim, 'center', 'normal');
      text('DDR4', 400, 556, 56, C.amber); text('+', 540, 556, 56, C.text); text('DDR5', 680, 556, 56, C.cyan);
    });
  }
  if (fly > 0) for (const target of [left.socket, right.socket]) {
    chip(lerp(from.x, target.x, fly), lerp(from.y, target.y, fly), lerp(from.s, target.size * 0.86, fly), target === right.socket ? 1 - dim * 0.6 : 1);
  }
  if (landed) {
    const pop = back(seg(t, S.twist.start + 1.95, S.twist.start + 2.25));
    for (const target of [left.socket, right.socket]) faded(target === right.socket ? 1 - dim * 0.6 : 1, () => {
      ctx.save(); ctx.translate(target.x + target.size * 0.62, target.y - target.size * 0.62); ctx.scale(pop, pop);
      ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); fill(C.green); text('✓', 0, 2, 44, '#062B16');
      ctx.restore();
    });
  }
  // Payoff: the old DDR4 stick seats in the DDR4 board.
  if (t >= S.payoff.start) {
    const target = left.slotTop + 22;
    const bottom = lerp(target - 520, target, stickDrop);
    stick(lx + L.left.w / 2, bottom, left.stickW, 'DDR4', { outline: seated ? 'rgba(0,230,118,0.9)' : 'rgba(255,179,0,0.7)' });
    if (seated) {
      const pop = back(seg(t, latchT + 0.18, latchT + 0.45));
      ctx.save(); ctx.translate(lx + L.left.w - 26, L.left.y + 26); ctx.scale(pop, pop);
      ctx.beginPath(); ctx.arc(0, 0, 54, 0, Math.PI * 2); fill(C.green); text('✓', 0, 3, 66, '#062B16');
      ctx.restore();
      faded(dim, () => {
        ctx.save(); ctx.translate(rx + L.right.w / 2, L.right.y + L.right.h * 0.62);
        ctx.strokeStyle = C.red; ctx.lineWidth = 14; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-70, -70); ctx.lineTo(70, 70); ctx.moveTo(70, -70); ctx.lineTo(-70, 70); ctx.stroke();
        ctx.restore();
      });
    }
  }
  ctx.restore();
  if (decides > 0) {
    ctx.save(); ctx.translate(540, 400); ctx.scale(decides, decides);
    text('THE BOARD', 0, -54, 96, C.text); text('DECIDES', 0, 50, 96, C.accent === '#6C63FF' ? '#9B94FF' : C.accent);
    ctx.restore();
  }

  ctx.restore();
}

/** SpecSmith: the Builder's real warning for this build. */
function ctaScene(t) {
  const a = easeOut(seg(t, S.cta.start + 0.3, S.cta.start + 0.7));
  const slide = easeOut(seg(t, S.cta.start + 0.45, S.cta.start + 1.05));
  faded(a, () => {
    const size = 120, total = size + 24 + 420;
    const x0 = 540 - total / 2;
    ctx.drawImage(logo, x0, 250, size, size);
    text('SpecSmith', x0 + size + 24, 312, 86, C.text, 'left');
  });
  faded(slide, () => {
    const w = 1000, h = w * card.naturalHeight / card.naturalWidth, x = 40, y = lerp(760, 470, slide);
    const pulse = t > S.cta.start + 1.05 ? 0.5 + 0.5 * Math.sin((t - S.cta.start) * 6) : 0;
    glow(`rgba(255,23,68,${0.35 + 0.4 * pulse})`, 60, () => { rrect(x - 6, y - 6, w + 12, h + 12, 22); fill('#13131A'); });
    ctx.drawImage(card, x, y, w, h);
    text('Real Builder warning for this exact build', 540, y + h + 50, 34, C.dim, 'center', 'normal');
    const url = seg(t, S.cta.start + 1.3, S.cta.start + 1.7);
    faded(url, () => {
      const uy = y + h + 150;
      rrect(130, uy - 54, 820, 108, 54); ctx.fillStyle = 'rgba(0,212,255,0.12)'; ctx.fill(); ctx.strokeStyle = C.cyan; ctx.lineWidth = 4; ctx.stroke();
      text('specsmithpc.com/builder', 540, uy + 2, 54, C.cyan);
      text('Free · no account needed', 540, uy + 100, 40, C.dim, 'center', 'normal');
    });
  });
}

// ---------------------------------------------------------------- captions

function captionWord(word) { return /DDR4/.test(word) ? C.amber : /DDR5/.test(word) ? C.cyan : C.text; }
function captions(t) {
  const cue = DATA.captions.find((c) => t >= c.start && t < c.end);
  if (!cue) return;
  const p = cue.start <= 0 ? 1 : easeOut(seg(t, cue.start, cue.start + 0.14));
  const lines = cue.lines, cy = 1440;
  // Largest size up to 68px at which every line fits 920px.
  let size = 68;
  ctx.font = font(size);
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  if (widest > 920) size = Math.floor(68 * 920 / widest);
  const lh = Math.round(size * 1.26);
  ctx.save(); ctx.globalAlpha *= p; ctx.translate(540, cy); ctx.scale(0.94 + 0.06 * p, 0.94 + 0.06 * p);
  ctx.font = font(size);
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width));
  rrect(-width / 2 - 34, -(lines.length * lh) / 2 - 22, width + 68, lines.length * lh + 44, 26); ctx.fillStyle = 'rgba(8,8,12,0.78)'; ctx.fill();
  lines.forEach((line, i) => {
    const y = -((lines.length - 1) * lh) / 2 + i * lh;
    // Per-word colour: DDR4 amber, DDR5 cyan.
    const words = line.split(' '); const space = ctx.measureText(' ').width;
    let x = -ctx.measureText(line).width / 2;
    for (const word of words) { const ww = ctx.measureText(word).width; text(word, x + ww / 2, y, size, captionWord(word), 'center', 'bold', 10); x += ww + space; }
  });
  ctx.restore();
}

window.renderAt = function renderAt(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  background(t);
  if (t < S.twist.start + 0.1) faded(1 - seg(t, S.twist.start - 0.2, S.twist.start + 0.05), () => slotScene(t));
  if (t >= S.twist.start && t < S.cta.start + 0.4) faded(seg(t, S.twist.start, S.twist.start + 0.25), () => boardScene(t));
  if (t >= S.cta.start) ctaScene(t);
  captions(t);
  faded(0.75, () => text('DRAFT · temp voice', 40, 70, 28, C.dim, 'left', 'normal'));
  return canvas.toDataURL('image/jpeg', 0.93);
};
