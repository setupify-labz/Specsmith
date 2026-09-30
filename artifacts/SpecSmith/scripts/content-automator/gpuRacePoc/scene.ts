// Draws the race on a canvas, one precomputed frame at a time:
// `window.__draw(frameIndex)`. No timers, no randomness: each frame is a pure
// function of the timeline, so frame N is the same picture on every run.
//
// Two coordinate spaces. The world (track, tiles, GPUs) is drawn through the
// camera. The label, the setting and the result text are drawn in screen
// space after it, so the camera never moves, shrinks or covers them.

import { GPU_SIZE, HEIGHT, LANE_X, TILE_SIZE, TRACK_LENGTH, WIDTH, type RaceTimeline } from "./timeline.ts";

/**
 * Where narration captions sit: the full-width band under the label. Nothing
 * else is drawn there in any frame (the GPUs, tiles, name cards, counter and
 * reveal all sit below it), and it is well clear of the platform buttons and
 * caption bar at the bottom and right of a vertical video.
 */
export const CAPTION_BAND = { top: 244, bottom: 340, maxWidth: 936 } as const;

/**
 * The call to action during the final hold: the caption band, taller for two
 * lines once the captions are done. It stays under the label and ends above
 * the settled 20/20 counter, whose digits start at about y=414.
 */
export const CTA_BOX = { top: 236, bottom: 398, maxWidth: 936 } as const;

export const MODEL_ESTIMATE_LABEL = "Model estimates, not measured results";

export interface SceneText {
  label: string;
  setting: string;
  nameA: string;
  nameB: string;
  /** "/20": the counter's denominator. */
  countTotal: string;
  countCaption: string;
  /** Under a spotlighted game's name. */
  spotlightCaption: string;
  verdictLead: string;
  gapValue: string;
  verdictTail: string;
  /** Call to action, two lines: the ask, then the site. */
  ctaLead: string;
  ctaSite: string;
  avgA: string;
  versus: string;
  avgB: string;
  avgCaption: string;
}

export function sceneHtml(timeline: RaceTimeline, text: SceneText): string {
  const data = {
    W: WIDTH, H: HEIGHT, L: TRACK_LENGTH, LANE: LANE_X, GPU: GPU_SIZE, TILE: TILE_SIZE,
    tiles: timeline.tiles, frames: timeline.frames, captions: timeline.captions, text, CAPTION_BAND, CTA_BOX, cta: timeline.cta,
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>gpu-race-poc</title>
<style>html,body{margin:0;background:#0b0b10;overflow:hidden}canvas{display:block}</style></head>
<body><canvas id="c" width="${WIDTH}" height="${HEIGHT}"></canvas>
<script>
const D = ${JSON.stringify(data)};
const ctx = document.getElementById("c").getContext("2d");
const ANCHOR = 1000;
const FONT = '"Liberation Sans", "DejaVu Sans", Arial, sans-serif';
const COLOR = { a: "#8b7cf6", b: "#b9b9cf", tie: "#6b6b80", cyan: "#00d4ff", amber: "#ffb300", text: "#eeeef8", muted: "#a3a3bd" };
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const easeOutBack = (u) => { const c = 1.9; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };
const easeOut = (u) => 1 - Math.pow(1 - clamp(u), 3);
// Deterministic scatter for the ground specks.
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function withCamera(cam, draw) {
  ctx.save();
  ctx.translate(D.W / 2 + cam.offsetX + cam.shakeX, (cam.anchor ?? ANCHOR) + cam.shakeY);
  ctx.rotate(cam.tilt * Math.PI / 180);
  ctx.scale(cam.scale, cam.scale);
  // World y runs up the screen; the camera's y sits at the anchor.
  draw((y) => -(y - cam.y));
  ctx.restore();
}

function screenPoint(cam, x, y) {
  const dx = x * cam.scale, dy = -(y - cam.y) * cam.scale, r = cam.tilt * Math.PI / 180;
  return [D.W / 2 + cam.offsetX + cam.shakeX + dx * Math.cos(r) - dy * Math.sin(r), (cam.anchor ?? ANCHOR) + cam.shakeY + dx * Math.sin(r) + dy * Math.cos(r)];
}

function drawWorld(f, Y, cam = f.camera) {
  // Ground specks: fixed in the world, so they stream past as the camera runs.
  const top = cam.y + (D.H + 200) / cam.scale, bottom = cam.y - (D.H + 200) / cam.scale;
  ctx.fillStyle = "rgba(139,124,246,0.20)";
  for (let i = 0; i < 900; i += 1) {
    const y = hash(i) * (D.L + 1600) - 800, x = (hash(i + 5000) - 0.5) * 1700;
    if (y > top || y < bottom || Math.abs(x) < 290) continue;
    const len = 6 + f.speed * (1 - f.pullback) * 70;
    ctx.fillRect(x, Y(y), 3, len);
  }
  // Track and lanes.
  ctx.fillStyle = "#13131b"; roundRect(-290, Y(D.L + 140), 580, D.L + 280, 40); ctx.fill();
  for (const lane of ["a", "b"]) {
    const x = D.LANE[lane];
    ctx.fillStyle = "#181823"; ctx.fillRect(x - 95, Y(D.L + 120), 190, D.L + 240);
    ctx.fillStyle = lane === "a" ? "rgba(139,124,246,0.55)" : "rgba(185,185,207,0.45)";
    ctx.fillRect(x - 97, Y(D.L + 120), 4, D.L + 240); ctx.fillRect(x + 93, Y(D.L + 120), 4, D.L + 240);
  }
  ctx.fillStyle = "rgba(238,238,248,0.8)"; ctx.fillRect(-270, Y(0), 540, 6);
  // Finish line: a checker band just past it, so a nose at the line touches its edge.
  for (let i = 0; i < 27; i += 1) for (let j = 0; j < 2; j += 1) {
    ctx.fillStyle = (i + j) % 2 ? "#eeeef8" : "#0b0b10"; ctx.fillRect(-270 + i * 20, Y(D.L) - (j + 1) * 20, 20, 20);
  }
  // Game tiles down the median: face down until their leader passes.
  D.tiles.forEach((tile, k) => {
    const flip = f.flip[k];
    const size = D.TILE, sx = Math.abs(Math.cos(Math.PI * flip)), pop = 1 + 0.35 * Math.sin(Math.PI * flip);
    const back = flip >= 0.5;
    ctx.save(); ctx.translate(0, Y(tile.y)); ctx.scale(Math.max(sx, 0.02) * pop, pop);
    if (back) { ctx.shadowColor = COLOR[tile.leader]; ctx.shadowBlur = 24; }
    ctx.fillStyle = back ? COLOR[tile.leader] : "#1c1c26";
    roundRect(-size / 2, -size / 2, size, size, 12); ctx.fill(); ctx.shadowBlur = 0;
    if (!back) {
      // A small controller mark: this is a game, not yet decided.
      ctx.strokeStyle = "#3a3a4d"; ctx.lineWidth = 3; roundRect(-size / 2, -size / 2, size, size, 12); ctx.stroke();
      ctx.fillStyle = "#4a4a60"; roundRect(-17, -8, 34, 16, 8); ctx.fill();
    } else if (tile.leader === "tie") {
      ctx.fillStyle = "#0b0b10"; ctx.fillRect(-14, -3, 28, 6);
    } else {
      const dir = tile.leader === "a" ? -1 : 1;
      ctx.fillStyle = "#0b0b10"; ctx.beginPath();
      ctx.moveTo(dir * 16, 0); ctx.lineTo(-dir * 7, -16); ctx.lineTo(-dir * 7, 16); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  });
  // GPUs, nose at y, body behind.
  for (const lane of ["a", "b"]) {
    const x = D.LANE[lane], nose = lane === "a" ? f.yA : f.yB, w = D.GPU.width, len = D.GPU.length;
    const trail = f.speed * 520;
    if (trail > 1) {
      const g = ctx.createLinearGradient(0, Y(nose - len), 0, Y(nose - len - trail));
      g.addColorStop(0, lane === "a" ? "rgba(139,124,246,0.55)" : "rgba(185,185,207,0.40)"); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.fillRect(x - w / 2 + 10, Y(nose - len), w - 20, trail);
    }
    ctx.save(); ctx.shadowColor = COLOR[lane]; ctx.shadowBlur = 40 * (0.4 + f.speed * 0.6);
    const body = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    body.addColorStop(0, "#2d2d3b"); body.addColorStop(0.5, "#3a3a4c"); body.addColorStop(1, "#24242f");
    ctx.fillStyle = body; roundRect(x - w / 2, Y(nose), w, len, 18); ctx.fill(); ctx.restore();
    ctx.fillStyle = COLOR[lane]; ctx.fillRect(x - w / 2, Y(nose) + 14, 8, len - 28); ctx.fillRect(x + w / 2 - 8, Y(nose) + 14, 8, len - 28);
    ctx.fillRect(x - w / 2 + 20, Y(nose) + 4, w - 40, 8);
    for (const at of [72, 168]) {
      const cx = x, cy = Y(nose) + at;
      ctx.fillStyle = "#0e0e14"; ctx.beginPath(); ctx.arc(cx, cy, 44, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#4a4a60"; ctx.lineWidth = 4; ctx.stroke();
      const spin = nose / 9 + (lane === "a" ? 0.4 : 0);
      ctx.fillStyle = "rgba(200,200,220," + (0.75 - 0.4 * f.speed) + ")";
      for (let b = 0; b < 7; b += 1) {
        const a0 = spin + b * (Math.PI * 2 / 7);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, 38, a0, a0 + 0.55); ctx.closePath(); ctx.fill();
      }
      if (f.speed > 0.3) { ctx.fillStyle = "rgba(160,160,190," + (0.25 * f.speed) + ")"; ctx.beginPath(); ctx.arc(cx, cy, 38, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = COLOR[lane]; ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function pill(text, x, y, font, fg, bg, border, alpha = 1) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.font = font; ctx.textBaseline = "middle"; ctx.textAlign = "center";
  const w = ctx.measureText(text).width + 64, h = 76;
  ctx.fillStyle = bg; roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 3; roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.stroke(); }
  ctx.fillStyle = fg; ctx.fillText(text, x, y + 2); ctx.restore();
}

function text(str, x, y, font, color, align = "left", alpha = 1) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "alphabetic";
  ctx.fillText(str, x, y); ctx.restore();
}

/** The call-to-action card's width: its wider line, padded. */
function ctaWidth() {
  ctx.save(); ctx.font = "800 44px " + FONT; const lead = ctx.measureText(D.text.ctaLead).width;
  ctx.font = "800 64px " + FONT; const site = ctx.measureText(D.text.ctaSite).width; ctx.restore();
  return Math.max(lead, site) + 96;
}

function drawOverlay(f) {
  const cam = f.camera, T = D.text;
  // Scrim under the top band, so the race never shows through the label, setting or counter.
  // It shrinks as the camera pulls back, so the finish line is never dimmed.
  const scrimH = 640 - 300 * f.pullback;
  const scrim = ctx.createLinearGradient(0, 0, 0, scrimH);
  scrim.addColorStop(0, "rgba(11,11,16,0.97)"); scrim.addColorStop(0.72, "rgba(11,11,16,0.88)"); scrim.addColorStop(1, "rgba(11,11,16,0)");
  ctx.fillStyle = scrim; ctx.fillRect(0, 0, D.W, scrimH);

  // GPU names ride just ahead of each GPU through the race, then give way to the result.
  const nameAlpha = clamp(1 - f.pullback * 2.5) * clamp(f.t / 0.4) * (1 - (f.spotlight ? easeOut(f.spotlight.amount) : 0));
  if (nameAlpha > 0) {
    for (const lane of ["a", "b"]) {
      const [x, y] = screenPoint(cam, D.LANE[lane], lane === "a" ? f.yA : f.yB);
      pill(lane === "a" ? T.nameA : T.nameB, clamp(x, 240, D.W - 240), clamp(y - 70, 680, 1330), "800 40px " + FONT,
        "#0b0b10", COLOR[lane], null, nameAlpha);
    }
  }

  // A spotlighted game: its full name, above the tile that just flipped.
  if (f.spotlight) {
    const tile = D.tiles[f.spotlight.tile], u = easeOut(f.spotlight.amount), k = 0.85 + 0.15 * u;
    ctx.save(); ctx.globalAlpha = u; ctx.translate(540, 760); ctx.scale(k, k);
    ctx.font = "800 42px " + FONT; const captionW = ctx.measureText(T.spotlightCaption).width;
    ctx.font = "800 72px " + FONT; const w = Math.max(ctx.measureText(tile.name).width, captionW) + 96;
    ctx.fillStyle = "rgba(20,19,32,0.95)"; roundRect(-w / 2, -100, w, 190, 36); ctx.fill();
    ctx.strokeStyle = COLOR[tile.leader]; ctx.lineWidth = 5; roundRect(-w / 2, -100, w, 190, 36); ctx.stroke();
    ctx.textAlign = "center"; ctx.fillStyle = COLOR.text; ctx.fillText(tile.name, 0, -8);
    ctx.font = "800 42px " + FONT; ctx.fillStyle = COLOR[tile.leader]; ctx.fillText(T.spotlightCaption, 0, 56);
    ctx.restore();
  }

  // The counter: large while it climbs, then it settles into the result column.
  {
    // Clears the track's path before the track arrives.
    const settle = easeOut(clamp(f.pullback * 1.8)), pop = 1 + 0.12 * f.countPop + 0.1 * Math.sin(Math.PI * clamp(f.complete));
    const x = 540 + (72 - 540) * settle, y = 520 + (500 - 520) * settle, size = 190 - 70 * settle;
    const align = settle > 0.5 ? "left" : "center";
    ctx.save(); ctx.translate(x, y); ctx.scale(pop, pop);
    ctx.textBaseline = "alphabetic"; ctx.textAlign = align;
    ctx.font = "800 " + size + "px " + FONT;
    const countText = String(f.count), totalText = T.countTotal;
    const countW = ctx.measureText(countText).width;
    ctx.font = "800 " + Math.round(size * 0.55) + "px " + FONT; const totalW = ctx.measureText(totalText).width;
    const start = align === "center" ? -(countW + totalW) / 2 : 0;
    ctx.textAlign = "left";
    if (f.complete > 0) { ctx.shadowColor = COLOR.a; ctx.shadowBlur = 40 * clamp(f.complete); }
    ctx.font = "800 " + size + "px " + FONT; ctx.fillStyle = f.count ? COLOR.text : COLOR.muted; ctx.fillText(countText, start, 0);
    ctx.shadowBlur = 0;
    ctx.font = "800 " + Math.round(size * 0.55) + "px " + FONT; ctx.fillStyle = COLOR.muted; ctx.fillText(totalText, start + countW + 8, 0);
    ctx.font = "800 " + Math.round(40 - 6 * settle) + "px " + FONT; ctx.fillStyle = COLOR.a;
    ctx.textAlign = align; ctx.fillText(T.countCaption, 0, Math.round(58 - 14 * settle));
    // The setting the counter counts at.
    ctx.font = "700 " + Math.round(34 - 6 * settle) + "px " + FONT; ctx.fillStyle = COLOR.cyan;
    ctx.fillText(T.setting, 0, Math.round(104 - 26 * settle));
    ctx.restore();
  }

  // The reveal: a lens on the finish line, where the gap is big enough to see, and the averages.
  if (f.reveal > 0) {
    const r = easeOut(f.reveal);
    const lens = { x: 300, y: 1050, radius: 175 * r };
    const [fx, fy] = screenPoint(cam, 0, (f.yA + f.yB) / 2);
    ctx.save(); ctx.globalAlpha = r; ctx.strokeStyle = COLOR.cyan; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(fx, fy, 26, 0, Math.PI * 2); ctx.stroke();
    // An elbow down the channel between the text column and the track, so it crosses no words.
    const channel = 610;
    ctx.beginPath(); ctx.moveTo(fx - 26, fy); ctx.lineTo(channel, fy); ctx.lineTo(channel, lens.y); ctx.lineTo(lens.x + lens.radius, lens.y); ctx.stroke();
    ctx.restore();
    if (lens.radius > 1) {
      ctx.save(); ctx.beginPath(); ctx.arc(lens.x, lens.y, lens.radius, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = "#0b0b10"; ctx.fillRect(lens.x - lens.radius, lens.y - lens.radius, lens.radius * 2, lens.radius * 2);
      const lensCam = { scale: 0.8, y: (f.yA + f.yB) / 2 - 60, offsetX: lens.x - D.W / 2, anchor: lens.y, tilt: 0, shakeX: 0, shakeY: 0 };
      withCamera(lensCam, (Y) => drawWorld({ ...f, speed: 0, pullback: 1 }, Y, lensCam));
      const [, yA] = screenPoint(lensCam, 0, f.yA), [, yB] = screenPoint(lensCam, 0, f.yB);
      ctx.strokeStyle = COLOR.cyan; ctx.lineWidth = 4; ctx.setLineDash([12, 10]);
      for (const y of [yA, yB]) { ctx.beginPath(); ctx.moveTo(lens.x - lens.radius, y); ctx.lineTo(lens.x + lens.radius, y); ctx.stroke(); }
      ctx.setLineDash([]); ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(lens.x, yA + 4); ctx.lineTo(lens.x, yB - 4); ctx.stroke();
      for (const [y, dir] of [[yA, 1], [yB, -1]]) {
        ctx.beginPath(); ctx.moveTo(lens.x - 12, y + dir * 14); ctx.lineTo(lens.x, y + dir * 2); ctx.lineTo(lens.x + 12, y + dir * 14); ctx.stroke();
      }
      ctx.restore();
      ctx.save(); ctx.globalAlpha = r; ctx.strokeStyle = COLOR.cyan; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(lens.x, lens.y, lens.radius, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    const lift = (1 - r) * 30;
    ctx.save(); ctx.globalAlpha = r; ctx.font = "800 64px " + FONT; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    let x = 72;
    for (const [part, color] of [[T.avgA, COLOR.a], [T.versus, COLOR.muted], [T.avgB, COLOR.b]]) {
      ctx.fillStyle = color; ctx.fillText(part, x, 1300 - lift); x += ctx.measureText(part).width;
    }
    ctx.restore();
    text(T.avgCaption, 72, 1350 - lift, "700 40px " + FONT, COLOR.muted, "left", r);
  }

  // The verdict lands last, with the line that says it, and holds.
  if (f.verdict > 0) {
    const v = easeOutBack(clamp(f.verdict)), a = clamp(f.verdict * 2);
    text(T.verdictLead, 72, 640, "800 52px " + FONT, COLOR.text, "left", a);
    ctx.save(); ctx.globalAlpha = a; ctx.translate(72, 770); ctx.scale(v, v);
    text(T.gapValue, 0, 0, "800 132px " + FONT, COLOR.cyan); ctx.restore();
    text(T.verdictTail, 72, 830, "800 52px " + FONT, COLOR.text, "left", a);
  }

  // Always on top, never moved by the camera.
  // The call to action, in the final hold only.
  if (f.t >= D.cta.start) {
    const u = easeOut((f.t - D.cta.start) / 0.2), mid = (D.CTA_BOX.top + D.CTA_BOX.bottom) / 2, h = D.CTA_BOX.bottom - D.CTA_BOX.top;
    ctx.save(); ctx.globalAlpha = clamp((f.t - D.cta.start) / 0.12); ctx.translate(540, mid); ctx.scale(0.94 + 0.06 * u, 0.94 + 0.06 * u);
    const w = ctaWidth();
    ctx.fillStyle = "rgba(11,11,16,0.96)"; roundRect(-w / 2, -h / 2, w, h, 30); ctx.fill();
    ctx.strokeStyle = COLOR.cyan; ctx.lineWidth = 5; roundRect(-w / 2, -h / 2, w, h, 30); ctx.stroke();
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.font = "800 44px " + FONT; ctx.fillStyle = COLOR.text; ctx.fillText(T.ctaLead, 0, -14);
    ctx.font = "800 64px " + FONT; ctx.fillStyle = COLOR.cyan; ctx.fillText(T.ctaSite, 0, 56);
    ctx.restore();
  }
  // The caption for whatever is being said, in its band.
  const caption = D.captions.find((entry) => f.t >= entry.start && f.t < entry.end);
  if (caption) {
    const fade = clamp(Math.min((f.t - caption.start) / 0.1, (caption.end - f.t) / 0.1));
    const mid = (D.CAPTION_BAND.top + D.CAPTION_BAND.bottom) / 2;
    ctx.save(); ctx.globalAlpha = fade; ctx.font = "800 50px " + FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const w = ctx.measureText(caption.text).width + 64, h = D.CAPTION_BAND.bottom - D.CAPTION_BAND.top - 12;
    ctx.fillStyle = "rgba(0,0,0,0.78)"; roundRect(540 - w / 2, mid - h / 2, w, h, 22); ctx.fill();
    ctx.fillStyle = "#ffffff"; ctx.fillText(caption.text, 540, mid + 2);
    ctx.restore();
  }
  ctx.save(); ctx.font = "700 38px " + FONT;
  const w = ctx.measureText(T.label).width + 110;
  ctx.fillStyle = "rgba(24,18,4,0.94)"; roundRect(540 - w / 2, 132, w, 90, 45); ctx.fill();
  ctx.strokeStyle = COLOR.amber; ctx.lineWidth = 3; roundRect(540 - w / 2, 132, w, 90, 45); ctx.stroke();
  ctx.fillStyle = COLOR.amber; ctx.beginPath(); ctx.arc(540 - w / 2 + 44, 177, 9, 0, Math.PI * 2); ctx.fill();
  ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillText(T.label, 540 - w / 2 + 70, 179);
  ctx.restore();
}

window.__draw = (index) => {
  const f = D.frames[index];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const bg = ctx.createRadialGradient(540, 900, 100, 540, 900, 1300);
  bg.addColorStop(0, "#17162a"); bg.addColorStop(1, "#0b0b10");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, D.W, D.H);
  withCamera(f.camera, (Y) => drawWorld(f, Y));
  drawOverlay(f);
};
window.__frames = D.frames.length;
// The widest caption as drawn, so the render can refuse one that would not fit its band.
window.__ctaWidth = () => ctaWidth();
window.__captionWidths = () => { ctx.save(); ctx.font = "800 50px " + FONT;
  const widths = D.captions.map((entry) => ctx.measureText(entry.text).width + 64); ctx.restore(); return widths; };
window.__draw(0);
</script></body></html>
`;
}
