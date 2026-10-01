// "More wins, lower average": a 17-second vertical proof of concept.
//
//   pnpm content:poc:reversal
//
// A STANDALONE creative experiment. It is not produced by, and says nothing
// about, MASTER #6's generator: that integration is unproven.
//
// The story, all from the shipped model (leadsVsAverage/facts.ts):
//   20 game tokens fall and land with Build A, Build B, or on the tie pedestal.
//   Only then are the counts shown. A balance then weighs the wins: counted
//   one each it tips to A; weighted by each win's FPS margin it tips to B.
//   Only then are the estimated averages shown. The real Compare page
//   appears briefly at the end.
//
// Why a balance: the gap between the two averages is exactly the sum of B's
// margins minus the sum of A's, divided by the number of games. The beam's
// tilt is that sum, not an illustration of speed.
//
// Every frame is a pure function of time. Sound cues are synthesised here;
// the voice is espeak-ng, a labelled PLACEHOLDER. No network, no paid call.

import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildAssDocument, parseCaptionRenderState } from "../captionRender.ts";
import { launchBrowser } from "../uiRender/capture.ts";
import { createDeterministicUiRenderAdapter } from "../uiRender/deterministicUiRenderAdapter.ts";
import { verifyRenderedMedia } from "../v2/mediaVerification.ts";
import { DEMO_PAIRING, leadsVsAverageFacts } from "../leadsVsAverage/facts.ts";
import { shortGameName } from "../leadsVsAverage/storyboard.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const FPS = 30;
const TOTAL = 17;
const RATE = 44100;
const PLACEHOLDER = "PLACEHOLDER VOICE (espeak-ng offline) and synthesised placeholder sound cues. Draft proof of concept; not reviewed, not approved.";

/** When each fact is first allowed on screen. Nothing reveals it earlier. */
export const REVEALS = { counts: 4.0, reversal: 9.1, averages: 10.4, cta: 13.6 } as const;

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [], err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolvePromise(Buffer.concat(out).toString("utf8"))
      : reject(new Error(`${command} exited ${code}: ${Buffer.concat(err).toString("utf8").slice(-600)}`)));
  });
}

const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const say = (n: number) => words[n] ?? String(n);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function reversalScript() {
  const facts = leadsVsAverageFacts(DEMO_PAIRING);
  const { leadsA, leadsB, ties } = facts.tally;
  if (!(leadsA > leadsB && facts.averageB > facts.averageA)) throw new Error("The model no longer gives this reversal; refusing to tell it.");
  const sumA = facts.games.filter((g) => g.outcome === "A").reduce((s, g) => s + g.margin, 0);
  const sumB = facts.games.filter((g) => g.outcome === "B").reduce((s, g) => s - g.margin, 0);
  // At most two names: Build B's largest win and Build A's largest win.
  const spotB = facts.games.filter((g) => g.outcome === "B").sort((a, b) => a.margin - b.margin)[0];
  const spotA = facts.games.filter((g) => g.outcome === "A").sort((a, b) => b.margin - a.margin)[0];
  const voice = [
    { at: 0.2, text: `${cap(say(facts.games.length))} games. Which build comes out ahead?` },
    { at: 4.1, text: `${cap(say(leadsA))} for A. ${cap(say(leadsB))} for B. ${cap(say(ties))} ${ties === 1 ? "tie" : "ties"}.` },
    { at: 7.0, text: "Now weigh each win by how much it won." },
    { at: 10.7, text: "And on average? B comes out ahead." },
    { at: 13.9, text: "Check your games on SpecSmith compare." },
  ];
  const captions = [
    { startSecond: 0, endSecond: REVEALS.counts, text: `${facts.games.length} games. Who's higher?` },
    { startSecond: REVEALS.counts, endSecond: 6.9, text: `A ${leadsA} · B ${leadsB} · ${ties} ${ties === 1 ? "tie" : "ties"}` },
    { startSecond: 6.9, endSecond: REVEALS.averages, text: "Weigh each win by its margin" },
    { startSecond: REVEALS.averages, endSecond: REVEALS.cta, text: `Avg: A ${facts.averageA} · B ${facts.averageB}` },
    { startSecond: REVEALS.cta, endSecond: TOTAL, text: "Your games: /compare" },
  ];
  return { facts, sumA, sumB, spotA, spotB, voice, captions };
}

/** The scene, drawn in the page. Pure in `t`. */
function pageScript(data: unknown): string {
  return `
const D = ${JSON.stringify(data)};
const W = 1080, H = 1920, R = D.reveals;
const cv = document.getElementById('c'); const ctx = cv.getContext('2d');
const C = { bg0: '#0a0b14', bg1: '#141832', a: '#a08cff', aDark: '#5b47d6', b: '#2fd8f0', bDark: '#0e8fa8', tie: '#9aa0b4', gold: '#ffcf4a', text: '#ffffff', dim: '#b9bed0' };
const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const easeIO = (x) => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const back = (x) => { x = clamp(x); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const lerp = (a, b, p) => a + (b - a) * p;
function text(s, x, y, size, color, align, weight) { ctx.font = (weight || 'bold') + ' ' + size + 'px "DejaVu Sans"'; ctx.fillStyle = color; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y); }
function faded(a, f) { if (a <= 0) return; ctx.save(); ctx.globalAlpha *= Math.min(1, a); f(); ctx.restore(); }
const cap = new Image(); cap.src = D.captureDataUrl; window.ready = new Promise((r) => { cap.onload = r; });

// ---- token schedule: when each game token lands, and where ----
const tokens = D.games.map((g, i) => ({ ...g, spawn: 0.1 + i * 0.165 }));
const stackIndex = { A: 0, B: 0, tie: 0 };
tokens.forEach((tk) => { tk.k = stackIndex[tk.outcome]++; tk.land = tk.spawn + 0.55; });

// Ground positions (scene 1) and pan positions (scene 2).
const groundA = { x: 290, y: 1330 }, groundB = { x: 790, y: 1330 }, pedestal = { x: 540, y: 1420 };
const PIVOT = { x: 540, y: 820 }, ARM = 330;

function beamAngle(t) {
  // Counted one per win, then weighted by each win's margin. Positive = B side down.
  const count = (D.tally.leadsB - D.tally.leadsA) * 0.03;           // A heavier: tilts left
  const weighted = Math.sign(D.sumB - D.sumA) * 0.2;
  const appear = ease((t - 5.4) / 0.6);
  const toCount = easeIO((t - 6.0) / 0.7);
  const toWeight = easeIO((t - 7.9) / 1.2);
  let a = lerp(0, count, toCount);
  a = lerp(a, weighted, toWeight);
  // A small overshoot as the beam lands, settling by the reversal moment.
  if (t > 9.1) a += Math.sin((t - 9.1) * 18) * 0.03 * Math.exp(-(t - 9.1) * 5);
  return a * appear;
}
function panPos(side, t) {
  const ang = beamAngle(t), dir = side === 'A' ? -1 : 1;
  const ex = PIVOT.x + Math.cos(ang) * ARM * dir, ey = PIVOT.y + Math.sin(ang) * ARM * dir;
  return { x: ex, y: ey + 300 };
}
function homeOf(side, t) {
  // Characters walk from the ground onto the pans between 5.2s and 6.0s.
  const ground = side === 'A' ? groundA : groundB;
  const p = easeIO((t - 5.2) / 0.8);
  const pan = panPos(side, t);
  return { x: lerp(ground.x, pan.x, p), y: lerp(ground.y, pan.y - 10, p) };
}

// Coin size: one size while counted, then area proportional to the win's margin.
function coinRx(tk, t) {
  if (tk.outcome === 'tie') return 44;
  const grow = ease((t - 7.4 - tk.k * 0.12) / 0.7);
  const m = Math.abs(tk.margin);
  return lerp(44, 22 + 22 * Math.sqrt(m), grow);
}

function drawCoin(x, y, rx, color, dark, glow) {
  const ry = rx * 0.28;
  ctx.save();
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(x, y + 10, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(x - rx, y, rx * 2, 10);
  ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, y, rx * 0.72, ry * 0.72, 0, 0, Math.PI * 2); ctx.stroke();
}

// A stylised graphics card with a face. Fans idle at the same speed for both:
// they are character, not a speed claim.
function machine(side, x, y, t, squash) {
  const col = side === 'A' ? C.a : C.b, dark = side === 'A' ? C.aDark : C.bDark;
  ctx.save(); ctx.translate(x, y); ctx.scale(1 + squash * 0.06, 1 - squash * 0.08);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(0, 92, 150, 18, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = dark; ctx.beginPath(); ctx.roundRect(-150, -70, 300, 150, 26); ctx.fill();
  ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(-150, -80, 300, 145, 26); ctx.fill();
  ctx.fillStyle = 'rgba(10,11,20,0.85)'; ctx.beginPath(); ctx.roundRect(-136, -66, 272, 117, 20); ctx.fill();
  [-66, 66].forEach((fx, i) => {
    ctx.save(); ctx.translate(fx, -8); ctx.rotate(t * 5 + i);
    ctx.fillStyle = '#22263d'; ctx.beginPath(); ctx.arc(0, 0, 46, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col; for (let b = 0; b < 5; b++) { ctx.rotate(Math.PI * 2 / 5); ctx.beginPath(); ctx.ellipse(18, 0, 22, 8, 0.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#0a0b14'; ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });
  // Eyes on the shroud: blink every few seconds, glance toward incoming tokens.
  const blink = (Math.sin(t * 1.3 + (side === 'A' ? 0 : 2)) > 0.985) ? 0.15 : 1;
  const look = Math.sin(t * 2) * 4;
  [-24, 24].forEach((ex) => { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(ex + look, -92, 13, 15 * blink, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0a0b14'; ctx.beginPath(); ctx.arc(ex + look + 3, -90, 6 * blink, 0, Math.PI * 2); ctx.fill(); });
  ctx.fillStyle = '#c9a227'; for (let p = -120; p < 120; p += 16) ctx.fillRect(p, 64, 10, 18);
  text('Build ' + side, 0, 120, 30, col);
  ctx.restore();
}

function stackTop(side, t) {
  const home = side === 'tie' ? pedestal : homeOf(side, t);
  return { x: home.x, y: home.y - (side === 'tie' ? 40 : 128) };
}

function drawStacks(t, showLabels) {
  ['A', 'B', 'tie'].forEach((side) => {
    let y = 0;
    const landed = tokens.filter((tk) => tk.outcome === side && t >= tk.land);
    const fadeTie = side === 'tie' ? 1 - ease((t - 5.4) / 0.6) * 0.55 : 1;
    landed.forEach((tk) => {
      const top = stackTop(side, t), rx = coinRx(tk, t), h = Math.max(14, rx * 0.36);
      const bounce = Math.max(0, 1 - (t - tk.land) / 0.25) * 10;
      faded(fadeTie, () => drawCoin(top.x, top.y - y - bounce, rx, side === 'A' ? C.a : side === 'B' ? C.b : C.tie, side === 'A' ? C.aDark : side === 'B' ? C.bDark : '#5a6074', 0));
      if (showLabels && (tk === D.spotA || tk === D.spotB)) tk._labelAt = { x: top.x, y: top.y - y, rx };
      y += h;
    });
  });
}

function scene(t) {
  // ---- world (moved by the camera) ----
  const cam = camera(t);
  ctx.save();
  ctx.translate(540 + cam.sx, 960 + cam.sy); ctx.scale(cam.s, cam.s); ctx.translate(-cam.x, -cam.y);
  // floor glow
  const g = ctx.createRadialGradient(540, 1500, 40, 540, 1500, 700); g.addColorStop(0, 'rgba(90,80,200,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(-400, 800, 1880, 1200);

  // spawner portal: the 20 games arrive from here
  const portalA = 1 - ease((t - 4.2) / 0.5);
  faded(portalA, () => {
    ctx.save(); ctx.translate(540, 330); ctx.rotate(t * 0.8);
    for (let r = 0; r < 3; r++) { ctx.strokeStyle = 'rgba(255,207,74,' + (0.5 - r * 0.15) + ')'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, 70 + r * 22, r, r + 4.2); ctx.stroke(); }
    ctx.restore();
    text('20 games', 540, 460, 34, C.gold);
  });

  // tie pedestal
  faded(1 - ease((t - 5.4) / 0.6) * 0.55, () => { ctx.fillStyle = '#2a2e45'; ctx.beginPath(); ctx.roundRect(470, 1430, 140, 80, 14); ctx.fill(); text('tie', 540, 1475, 26, C.tie); });

  // balance beam (scene 2)
  const beamIn = ease((t - 5.3) / 0.5);
  if (beamIn > 0) faded(beamIn, () => {
    const ang = beamAngle(t);
    ctx.fillStyle = '#3a3f60'; ctx.beginPath(); ctx.moveTo(540, 830); ctx.lineTo(490, 1010); ctx.lineTo(590, 1010); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.translate(PIVOT.x, PIVOT.y); ctx.rotate(ang);
    ctx.fillStyle = '#e6e8f2'; ctx.beginPath(); ctx.roundRect(-ARM - 20, -12, ARM * 2 + 40, 24, 12); ctx.fill();
    ctx.restore();
    ['A', 'B'].forEach((side) => { const p = panPos(side, t), end = { x: p.x, y: p.y - 300 };
      ctx.strokeStyle = '#8a8fa8'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(end.x, end.y); ctx.lineTo(p.x - 150, p.y + 40); ctx.moveTo(end.x, end.y); ctx.lineTo(p.x + 150, p.y + 40); ctx.stroke();
      ctx.fillStyle = '#2a2e45'; ctx.beginPath(); ctx.roundRect(p.x - 175, p.y + 40, 350, 26, 12); ctx.fill(); });
    ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(PIVOT.x, PIVOT.y, 16, 0, Math.PI * 2); ctx.fill();
  });

  // machines, catching tokens (squash on each landing)
  ['A', 'B'].forEach((side) => {
    const recent = tokens.filter((tk) => tk.outcome === side && t >= tk.land && t - tk.land < 0.2).length;
    const h = homeOf(side, t);
    machine(side, h.x, h.y, t, recent ? 1 - (t - tokens.filter((tk) => tk.outcome === side && t >= tk.land).at(-1).land) / 0.2 : 0);
  });

  // stacked tokens
  D.spotA = tokens.find((tk) => tk.game === D.spotAGame); D.spotB = tokens.find((tk) => tk.game === D.spotBGame);
  drawStacks(t, t > 7.6);

  // falling tokens
  tokens.forEach((tk) => {
    if (t < tk.spawn || t >= tk.land) return;
    const u = (t - tk.spawn) / (tk.land - tk.spawn);
    const dest = stackTop(tk.outcome, tk.land);
    const destY = dest.y - tk.k * 16;
    const x = lerp(540, dest.x, easeIO(u)), y = lerp(330, destY, u * u) - Math.sin(u * Math.PI) * 160;
    const resolved = clamp((u - 0.55) / 0.3);
    const color = tk.outcome === 'A' ? C.a : tk.outcome === 'B' ? C.b : C.tie;
    drawCoin(x, y, 40, resolved > 0.5 ? color : C.gold, resolved > 0.5 ? '#3a3f60' : '#9a7a1c', 18);
  });

  // Spotlight: at most two names, shown while the coins grow, where the
  // counts were, each with a pointer to its own coin. They give way to the
  // margin totals once the tip lands.
  const lab = ease((t - 7.7) / 0.3) * (1 - ease((t - (R.reversal + 0.2)) / 0.2));
  if (lab > 0) faded(lab, () => {
    [[D.spotA, C.a, 'A'], [D.spotB, C.b, 'B']].forEach(([tk, col, side]) => {
      if (!tk || !tk._labelAt) return;
      const home = homeOf(side, t), lx = home.x, ly = home.y - 470, p = tk._labelAt;
      ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.moveTo(lx, ly + 52); ctx.lineTo(p.x, p.y - p.rx * 0.28 - 6); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(10,11,20,0.9)'; ctx.beginPath(); ctx.roundRect(lx - 150, ly - 48, 300, 100, 18); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
      text(tk.short, lx, ly - 14, 30, '#ffffff');
      text('won by ' + Math.abs(tk.margin) + ' FPS', lx, ly + 24, 26, col, 'center', 'normal');
    });
  });

  // counts, revealed only once every token has landed
  const cnt = back((t - R.counts) / 0.35) * (1 - ease((t - 7.3) / 0.3));
  if (t >= R.counts && cnt > 0) {
    const a = homeOf('A', t), b = homeOf('B', t);
    faded(clamp(cnt), () => {
      ctx.save(); ctx.translate(a.x, a.y - 470); ctx.scale(cnt, cnt); text(String(D.tally.leadsA), 0, 0, 130, C.a); text('wins', 0, 80, 30, C.dim, 'center', 'normal'); ctx.restore();
      ctx.save(); ctx.translate(b.x, b.y - 470); ctx.scale(cnt, cnt); text(String(D.tally.leadsB), 0, 0, 130, C.b); text('wins', 0, 80, 30, C.dim, 'center', 'normal'); ctx.restore();
      if (t < 5.6) text(D.tally.ties + ' ties', 540, 1560, 34, C.tie);
    });
  }
  // margin totals, after the reversal lands
  const mt = ease((t - (R.reversal + 0.3)) / 0.4) * (1 - ease((t - 10.2) / 0.3));
  if (mt > 0) faded(mt, () => {
    const a = homeOf('A', t), b = homeOf('B', t);
    text('+' + D.sumA, a.x, a.y - 470, 110, C.a); text('FPS of wins', a.x, a.y - 395, 30, C.dim, 'center', 'normal');
    text('+' + D.sumB, b.x, b.y - 470, 110, C.b); text('FPS of wins', b.x, b.y - 395, 30, C.dim, 'center', 'normal');
  });
  ctx.restore();

  // ---- screen space ----
  // averages, revealed after the reversal
  const av = ease((t - R.averages) / 0.5) * (1 - ease((t - R.cta) / 0.3));
  if (t >= R.averages && av > 0) faded(av, () => {
    ctx.fillStyle = 'rgba(10,11,20,0.94)'; ctx.fillRect(0, 540, 1080, 600);
    text('Estimated average FPS', 540, 640, 40, C.dim, 'center', 'normal');
    const pa = back((t - R.averages - 0.15) / 0.4), pb = back((t - R.averages - 0.45) / 0.4);
    ctx.save(); ctx.translate(270, 820); ctx.scale(pa, pa); text(String(D.averageA), 0, 0, 150, C.a); text('Build A', 0, 110, 34, C.a); ctx.restore();
    ctx.save(); ctx.translate(810, 820); ctx.scale(pb, pb); text(String(D.averageB), 0, 0, 150, C.b); text('Build B', 0, 110, 34, C.b); ctx.restore();
    text('vs', 540, 830, 40, C.dim, 'center', 'normal');
    faded(ease((t - R.averages - 1.0) / 0.4), () => text('fewer wins, bigger ones', 540, 1060, 36, '#ffffff'));
  });

  // CTA: the real Compare page, briefly
  const ct = ease((t - R.cta) / 0.4);
  if (ct > 0) faded(ct, () => {
    ctx.fillStyle = C.bg0; ctx.fillRect(0, 0, W, 1600);
    const w = 600, h = Math.min(860, w * cap.height / cap.width), y = lerp(1600, 300, ease((t - R.cta) / 0.6));
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, 1600); ctx.clip();
    ctx.save(); ctx.beginPath(); ctx.roundRect(540 - w / 2, y, w, h, 24); ctx.clip();
    ctx.drawImage(cap, 0, 0, cap.width, cap.width * h / w, 540 - w / 2, y, w, h); ctx.restore();
    ctx.strokeStyle = '#3a3f60'; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(540 - w / 2, y, w, h, 24); ctx.stroke();
    ctx.restore();
    faded(ease((t - R.cta - 0.5) / 0.4), () => { text('Check your own games', 540, 1240, 44, '#ffffff'); text('specsmith  /compare', 540, 1320, 60, C.a); text('the real Compare page, this pairing', 540, 1385, 24, C.dim, 'center', 'normal'); });
  });

  // the estimate label: always on, small, never dominant
  ctx.fillStyle = 'rgba(10,11,20,0.6)'; ctx.fillRect(0, 0, W, 86);
  text('SpecSmith model estimates, not measured benchmarks', 540, 32, 24, 'rgba(255,255,255,0.82)', 'center', 'normal');
  text('A: ' + D.buildA + '   B: ' + D.buildB + ' · ' + D.setting + ' · placeholder voice', 540, 64, 18, 'rgba(255,207,74,0.85)', 'center', 'normal');
}

// Camera: purposeful moves only. Follow the rain, push in on the count,
// rise to the balance, push on the tip with a small jolt, pull back for the result.
function camera(t) {
  const keys = [
    [0.0, 540, 940, 1.00], [3.8, 540, 980, 1.06], [4.6, 540, 1000, 1.10],
    [5.6, 540, 1020, 0.98], [7.6, 540, 1010, 1.00], [9.0, 540, 1050, 1.10],
    [10.2, 540, 1000, 1.02], [17, 540, 1000, 1.02],
  ];
  let i = 0; while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const [t0, x0, y0, s0] = keys[i], [t1, x1, y1, s1] = keys[i + 1];
  const p = easeIO((t - t0) / (t1 - t0));
  const shake = t > R.reversal && t < R.reversal + 0.35 ? Math.sin(t * 90) * 10 * (1 - (t - R.reversal) / 0.35) : 0;
  return { x: lerp(x0, x1, p), y: lerp(y0, y1, p), s: lerp(s0, s1, p), sx: shake, sy: shake * 0.6 };
}

window.renderAt = function (t) {
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, C.bg1); bg.addColorStop(1, C.bg0);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  scene(t);
  return cv.toDataURL('image/jpeg', 0.93);
};`;
}

/** Placeholder sound design: synthesised cues, deterministic. */
function synthCues(script: ReturnType<typeof reversalScript>, landings: { at: number; outcome: string }[]): Float32Array {
  const out = new Float32Array(Math.ceil(TOTAL * RATE));
  let seed = 7; const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
  const tone = (at: number, freq: number, dur: number, gain: number, decay: number, sweepTo?: number) => {
    const start = Math.round(at * RATE), n = Math.round(dur * RATE);
    for (let i = 0; i < n && start + i < out.length; i += 1) {
      const p = i / n, f = sweepTo ? freq + (sweepTo - freq) * p : freq;
      out[start + i] += Math.sin(2 * Math.PI * f * (i / RATE)) * gain * Math.exp(-p * decay) * Math.min(1, i / 60);
    }
  };
  const noise = (at: number, dur: number, gain: number, rise: number) => {
    const start = Math.round(at * RATE), n = Math.round(dur * RATE); let lp = 0;
    for (let i = 0; i < n && start + i < out.length; i += 1) {
      const p = i / n; lp += (rand() - lp) * 0.08;
      out[start + i] += lp * gain * Math.sin(Math.PI * Math.pow(p, rise));
    }
  };
  for (const landing of landings) tone(landing.at, landing.outcome === "A" ? 880 : landing.outcome === "B" ? 660 : 440, 0.09, 0.22, 6);
  [0, 0.08, 0.16].forEach((d, i) => tone(REVEALS.counts + d, 700 + i * 220, 0.14, 0.25, 5));
  noise(5.1, 0.7, 0.5, 0.7);                       // camera rises to the balance
  tone(6.2, 140, 0.45, 0.35, 3, 110);              // beam settles toward A
  for (let i = 0; i < 7; i += 1) tone(7.4 + i * 0.12, 300 + i * 40, 0.12, 0.12, 5); // B's coins grow
  tone(REVEALS.reversal, 55, 0.7, 0.9, 4); noise(REVEALS.reversal, 0.25, 0.6, 0.3); // the tip lands
  [1046, 1318, 1568].forEach((f, i) => tone(REVEALS.averages + 0.15 + i * 0.3, f, 1.2, 0.18, 3)); // averages
  noise(REVEALS.cta, 0.5, 0.4, 0.5);
  void script;
  return out;
}

function readWavMono(buffer: Buffer): { rate: number; samples: Float32Array } {
  let offset = 12, rate = 22050, data: Buffer | null = null, bits = 16;
  while (offset < buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4), size = buffer.readUInt32LE(offset + 4);
    if (id === "fmt ") { rate = buffer.readUInt32LE(offset + 12); bits = buffer.readUInt16LE(offset + 22); }
    if (id === "data") data = buffer.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  if (!data || bits !== 16) throw new Error("Unsupported WAV from espeak-ng.");
  const samples = new Float32Array(data.length / 2);
  for (let i = 0; i < samples.length; i += 1) samples[i] = data.readInt16LE(i * 2) / 32768;
  return { rate, samples };
}

function wav(samples: Float32Array): Buffer {
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write("RIFF", 0); out.writeUInt32LE(36 + samples.length * 2, 4); out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i += 1) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return out;
}

export async function renderReversalShort() {
  const outputDir = resolve(join(here, "..", "..", "..", "render-output", "reversal-short-poc"));
  await rm(outputDir, { recursive: true, force: true });
  const framesDir = join(outputDir, "frames");
  await mkdir(framesDir, { recursive: true });
  const script = reversalScript();
  const { facts } = script;

  const [capture] = await createDeterministicUiRenderAdapter({
    baseUrl: process.env.SPECSMITH_RENDER_BASE_URL ?? "http://localhost:5178", outputDir: join(outputDir, "capture"),
  }).render({
    packageId: "reversal-short-poc", campaignId: "poc", ideaId: "poc", platform: "youtube-shorts", targetDurationSeconds: TOTAL,
    task: { taskId: "cta-capture", capability: "deterministic-ui-render", sourceBeat: null, purpose: "", inputRequirements: [], outputRequirements: [],
      uiRenderState: { captureType: "static", state: { surface: "compare", ...DEMO_PAIRING } } },
    dependencyArtifacts: [],
  });

  const data = {
    reveals: REVEALS,
    buildA: facts.buildA, buildB: facts.buildB, setting: "1440p High",
    tally: facts.tally, averageA: facts.averageA, averageB: facts.averageB, sumA: script.sumA, sumB: script.sumB,
    games: facts.games.map((game) => ({ game: game.game, short: shortGameName(game.game), outcome: game.outcome, margin: game.margin })),
    spotAGame: script.spotA.game, spotBGame: script.spotB.game,
    captureDataUrl: `data:image/png;base64,${(await readFile(fileURLToPath(capture.uri))).toString("base64")}`,
  };

  const session = await launchBrowser({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  try {
    const page = await session.context.newPage();
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#0a0b14"><canvas id="c" width="1080" height="1920"></canvas><script>${pageScript(data)}</script></body></html>`);
    await page.evaluate("window.ready");
    await page.evaluate("document.fonts.ready");
    for (let index = 0; index < TOTAL * FPS; index += 1) {
      const url = await page.evaluate(`window.renderAt(${(index / FPS).toFixed(4)})`) as string;
      await writeFile(join(framesDir, `frame-${String(index).padStart(4, "0")}.jpg`), Buffer.from(url.split(",")[1], "base64"));
    }
  } finally {
    await session.close();
  }

  // Sound: synthesised cues plus placeholder voice, each line inside its slot.
  const landings = facts.games.map((game, index) => ({ at: 0.1 + index * 0.165 + 0.55, outcome: game.outcome }));
  const mix = synthCues(script, landings);
  const voiceTimes: { at: number; seconds: number; text: string }[] = [];
  for (const [index, line] of script.voice.entries()) {
    const path = join(outputDir, `voice-${index}.wav`);
    await run("espeak-ng", ["-v", "en-us", "-s", "170", "-w", path, line.text]);
    const { rate, samples } = readWavMono(await readFile(path));
    const seconds = samples.length / rate;
    const next = script.voice[index + 1]?.at ?? TOTAL;
    if (line.at + seconds > next - 0.05) throw new Error(`Voice line ${index} ("${line.text}") runs ${seconds.toFixed(2)}s and overruns the next at ${next}s.`);
    voiceTimes.push({ at: line.at, seconds: Number(seconds.toFixed(2)), text: line.text });
    const start = Math.round(line.at * RATE);
    for (let i = 0; start + i < mix.length; i += 1) {
      const src = i * rate / RATE, j = Math.floor(src);
      if (j + 1 >= samples.length) break;
      mix[start + i] += (samples[j] + (samples[j + 1] - samples[j]) * (src - j)) * 0.9;
    }
  }
  const audioPath = join(outputDir, "mix.wav");
  await writeFile(audioPath, wav(mix));

  const captionPath = join(outputDir, "captions.ass");
  await writeFile(captionPath, buildAssDocument(parseCaptionRenderState({ durationSeconds: TOTAL, placement: "caption-band", cues: script.captions })));
  const videoPath = join(outputDir, "reversal-short-poc.mp4");
  await run("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", join(framesDir, "frame-%04d.jpg"), "-i", audioPath,
    "-vf", `ass='${captionPath.replace(/:/g, "\\:")}'`, "-t", String(TOTAL), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-metadata", `comment=${PLACEHOLDER}`, "-metadata", "title=DRAFT reversal short POC", videoPath]);
  await rm(framesDir, { recursive: true, force: true });

  // Inspection: every second, plus both sides of each reveal.
  const inspectDir = join(outputDir, "inspection");
  await mkdir(inspectDir, { recursive: true });
  const moments: { label: string; at: number }[] = [];
  for (let s = 0; s < TOTAL; s += 1) moments.push({ label: `t${String(s).padStart(2, "0")}.0`, at: s === 0 ? 0.05 : s });
  for (const [name, at] of Object.entries(REVEALS)) {
    moments.push({ label: `${name}-before`, at: at - 0.1 }, { label: `${name}-after`, at: at + 0.6 });
  }
  moments.push({ label: "final", at: TOTAL - 0.05 });
  const frames: string[] = [];
  for (const moment of moments) {
    const path = join(inspectDir, `${moment.label}.png`);
    await run("ffmpeg", ["-v", "error", "-y", "-ss", moment.at.toFixed(3), "-i", videoPath, "-frames:v", "1", path]);
    frames.push(path);
  }
  const sheet = join(outputDir, "sheet-every-second.png");
  const firstSeventeen = frames.slice(0, TOTAL).concat(frames.at(-1)!);
  await run("ffmpeg", ["-v", "error", "-y", ...firstSeventeen.flatMap((path) => ["-i", path]), "-filter_complex",
    `${firstSeventeen.map((_, i) => `[${i}:v]scale=270:480[s${i}]`).join(";")};${firstSeventeen.map((_, i) => `[s${i}]`).join("")}` +
    `xstack=inputs=${firstSeventeen.length}:layout=${firstSeventeen.map((_, i) => `${(i % 6) * 270}_${Math.floor(i / 6) * 480}`).join("|")}:fill=black`, "-frames:v", "1", sheet]);

  const media = verifyRenderedMedia(videoPath);
  const report = {
    label: "DRAFT standalone POC. Not generated by MASTER #6. SpecSmith model estimates. Placeholder voice and sound.",
    video: { path: videoPath, sha256: media.sha256, bytes: media.bytes },
    facts: { tally: facts.tally, averageA: facts.averageA, averageB: facts.averageB, sumA: script.sumA, sumB: script.sumB,
      spotlight: [script.spotB.game, script.spotA.game] },
    reveals: REVEALS, captions: script.captions, voice: voiceTimes, frames, sheet,
  };
  await writeFile(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();
if (isMain) {
  renderReversalShort().then((report) => {
    console.log(report.label);
    console.log(`video: ${report.video.path}\nsha256: ${report.video.sha256}`);
    console.log(JSON.stringify(report.facts));
    for (const line of report.voice) console.log(`  voice ${line.at}s +${line.seconds}s: ${line.text}`);
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
