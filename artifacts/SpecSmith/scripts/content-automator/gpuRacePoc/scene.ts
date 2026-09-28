// Draws the race on a canvas, one precomputed frame at a time:
// `window.__draw(frameIndex)`. No timers, no randomness: each frame is a pure
// function of the timeline, so frame N is the same picture on every run.
//
// Two coordinate spaces. The world (track, tiles, GPUs) is drawn through the
// camera. The label, the setting and the result text are drawn in screen
// space after it, so the camera never moves, shrinks or covers them.

import { GPU_SIZE, HEIGHT, LANE_X, TRACK_LENGTH, WIDTH, type RaceTimeline } from "./timeline.ts";

export const MODEL_ESTIMATE_LABEL = "Model estimates, not measured results";

export interface SceneText {
  label: string;
  setting: string;
  nameA: string;
  nameB: string;
  leadsValue: string;
  leadsCaption: string;
  gapValue: string;
  gapCaption: string;
  avgA: string;
  versus: string;
  avgB: string;
  avgCaption: string;
}

export function sceneHtml(timeline: RaceTimeline, text: SceneText): string {
  const data = {
    W: WIDTH, H: HEIGHT, L: TRACK_LENGTH, LANE: LANE_X, GPU: GPU_SIZE,
    tiles: timeline.tiles, frames: timeline.frames, text,
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
  // Game tiles down the median.
  D.tiles.forEach((tile, k) => {
    const flip = f.flip[k];
    const size = 104, sx = Math.abs(Math.cos(Math.PI * flip)), pop = 1 + 0.22 * Math.sin(Math.PI * flip);
    const back = flip >= 0.5;
    ctx.save(); ctx.translate(0, Y(tile.y)); ctx.scale(Math.max(sx, 0.02) * pop, pop);
    if (back) { ctx.shadowColor = COLOR[tile.leader]; ctx.shadowBlur = 30; }
    ctx.fillStyle = back ? COLOR[tile.leader] : "#1c1c26";
    roundRect(-size / 2, -size / 2, size, size, 20); ctx.fill(); ctx.shadowBlur = 0;
    if (!back) {
      ctx.strokeStyle = "#3a3a4d"; ctx.lineWidth = 4; roundRect(-size / 2, -size / 2, size, size, 20); ctx.stroke();
      ctx.fillStyle = COLOR.text; ctx.font = "800 34px " + FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(tile.initials, 0, 2);
    } else if (tile.leader === "tie") {
      ctx.fillStyle = "#0b0b10"; ctx.fillRect(-26, -6, 52, 12);
    } else {
      // A chevron toward the leader's lane.
      const dir = tile.leader === "a" ? -1 : 1;
      ctx.fillStyle = "#0b0b10"; ctx.beginPath();
      ctx.moveTo(dir * 30, 0); ctx.lineTo(-dir * 12, -30); ctx.lineTo(-dir * 12, 30); ctx.closePath(); ctx.fill();
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

function drawOverlay(f) {
  const cam = f.camera, T = D.text;
  // GPU names ride with the GPUs through the race, then give way to the result.
  const nameAlpha = clamp(1 - f.pullback * 2.5) * clamp(f.t / 0.4);
  if (nameAlpha > 0) {
    for (const lane of ["a", "b"]) {
      const [x, y] = screenPoint(cam, D.LANE[lane], (lane === "a" ? f.yA : f.yB) - D.GPU.length - 50);
      pill(lane === "a" ? T.nameA : T.nameB, clamp(x, 250, D.W - 250), Math.min(y, 1340), "800 40px " + FONT,
        "#0b0b10", COLOR[lane], null, nameAlpha);
    }
  }
  // The leads stamp slams in, then settles into the result block.
  if (f.stamp > 0) {
    const s = easeOutBack(f.stamp), settle = f.pullback;
    const x = 540 + (392 - 540) * settle, y = 820 + (1322 - 820) * settle, scale = (1 + (0.45 - 1) * settle) * s;
    ctx.save(); ctx.translate(x, y); ctx.rotate((1 - s) * -0.25 * (1 - settle)); ctx.scale(scale, scale);
    ctx.globalAlpha = clamp(f.stamp * 3);
    ctx.fillStyle = "rgba(11,11,16,0.86)"; roundRect(-330, -150, 660, 300, 48); ctx.fill();
    ctx.strokeStyle = COLOR.a; ctx.lineWidth = 6; roundRect(-330, -150, 660, 300, 48); ctx.stroke();
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = COLOR.text; ctx.font = "800 170px " + FONT; ctx.fillText(T.leadsValue, 0, 50);
    ctx.fillStyle = COLOR.a; ctx.font = "800 44px " + FONT; ctx.fillText(T.leadsCaption, 0, 118);
    ctx.restore();
  }
  // The reveal: a lens on the finish line, where the gap is big enough to see, and what it is worth.
  if (f.reveal > 0) {
    const r = easeOut(f.reveal);
    const lens = { x: 300, y: 866, radius: 200 * r };
    const [fx, fy] = screenPoint(cam, 0, (f.yA + f.yB) / 2);
    ctx.save(); ctx.globalAlpha = r; ctx.strokeStyle = COLOR.cyan; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(fx, fy, 26, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fx - 26, fy + 8); ctx.lineTo(lens.x + lens.radius * 0.72, lens.y - lens.radius * 0.72); ctx.stroke();
    ctx.restore();
    if (lens.radius > 1) {
      ctx.save(); ctx.beginPath(); ctx.arc(lens.x, lens.y, lens.radius, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = "#0b0b10"; ctx.fillRect(lens.x - lens.radius, lens.y - lens.radius, lens.radius * 2, lens.radius * 2);
      const lensCam = { scale: 0.85, y: (f.yA + f.yB) / 2 - 60, offsetX: lens.x - D.W / 2, anchor: lens.y, tilt: 0, shakeX: 0, shakeY: 0 };
      withCamera(lensCam, (Y) => drawWorld({ ...f, speed: 0, pullback: 1 }, Y, lensCam));
      // The gap itself: a line at each nose, and the span between them.
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
    const x0 = 72, lift = (1 - r) * 40;
    ctx.save(); ctx.globalAlpha = r; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = COLOR.cyan; ctx.font = "800 150px " + FONT; ctx.fillText(T.gapValue, x0, 540 + lift);
    ctx.fillStyle = COLOR.text; ctx.font = "800 54px " + FONT; ctx.fillText(T.gapCaption, x0, 612 + lift);
    ctx.font = "800 64px " + FONT; let x = x0;
    for (const [part, color] of [[T.avgA, COLOR.a], [T.versus, COLOR.muted], [T.avgB, COLOR.b]]) {
      ctx.fillStyle = color; ctx.fillText(part, x, 1148 - lift); x += ctx.measureText(part).width;
    }
    ctx.fillStyle = COLOR.muted; ctx.font = "700 40px " + FONT; ctx.fillText(T.avgCaption, x0, 1198 - lift);
    ctx.restore();
  }
  // Always on top, never moved by the camera, over a scrim so the race never shows through around it.
  const scrim = ctx.createLinearGradient(0, 0, 0, 380);
  scrim.addColorStop(0, "rgba(11,11,16,0.96)"); scrim.addColorStop(0.75, "rgba(11,11,16,0.85)"); scrim.addColorStop(1, "rgba(11,11,16,0)");
  ctx.fillStyle = scrim; ctx.fillRect(0, 0, D.W, 380);
  pill(T.setting, 540, 290, "800 40px " + FONT, COLOR.cyan, "rgba(11,11,16,0.85)", "rgba(0,212,255,0.55)");
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
window.__draw(0);
</script></body></html>
`;
}
