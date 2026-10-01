// A 5.5-second SILENT hook: are the GPU characters entertaining on their own?
//
//   pnpm content:poc:hook
//
// Standalone test, not part of any pipeline. The coins are the verified
// per-game wins from leadsVsAverage/facts.ts: Build A's ten are small (1-3 FPS
// margins), Build B's seven include four big ones. Coin AREA follows the
// margin, so the balance swings the way the model's numbers say it must. No
// numbers, captions, voice or tally are shown; it ends mid-swing.

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { launchBrowser } from "../uiRender/capture.ts";
import { DEMO_PAIRING, leadsVsAverageFacts } from "../leadsVsAverage/facts.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const FPS = 30;
export const HOOK_SECONDS = 5.5;

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    const err: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolvePromise() : reject(new Error(Buffer.concat(err).toString("utf8").slice(-600))));
  });
}

function pageScript(data: unknown): string {
  return `
const D = ${JSON.stringify(data)};
const W = 1080, H = 1920;
const cv = document.getElementById('c'); const ctx = cv.getContext('2d');
const C = { a: '#a08cff', aDark: '#5b47d6', b: '#2fd8f0', bDark: '#0e8fa8', gold: '#ffcf4a', goldDark: '#a77d12', ink: '#0b0c16', white: '#ffffff' };
const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const easeIn = (x) => Math.pow(clamp(x), 2.4);
const easeIO = (x) => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const lerp = (a, b, p) => a + (b - a) * p;
const hop = (t, start, dur, height) => (t < start || t > start + dur) ? 0 : Math.sin(Math.PI * (t - start) / dur) * height;
// deterministic pseudo-random for confetti
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

const PIVOT = { x: 540, y: 900 }, ARM = 250;

// Beam: starts tipped toward A (more coins), trembles, then B's heavy coins win.
function beamAngle(t) {
  let a = -0.17;
  if (t > 3.15 && t < 3.65) a += Math.sin(t * 70) * 0.012 * (t - 3.15) / 0.5;            // anticipation tremble
  const swing = easeIn((t - 3.65) / 0.75);                                              // heavy start
  a = lerp(a, 0.2, swing);
  if (t > 4.4) a += Math.sin((t - 4.4) * 16) * 0.035 * Math.exp(-(t - 4.4) * 3.5);        // overshoot wobble
  return a;
}
function panAt(side, t) {
  const ang = beamAngle(t), dir = side === 'A' ? -1 : 1;
  return { x: PIVOT.x + Math.cos(ang) * ARM * dir, y: PIVOT.y + Math.sin(ang) * ARM * dir + 300 };
}

function coin(x, y, rx, col, dark, shine) {
  const ry = rx * 0.3, th = Math.max(10, rx * 0.22);
  ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(x, y + th, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(x - rx, y, rx * 2, th);
  ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x, y, rx * 0.68, ry * 0.68, 0, 0, Math.PI * 2); ctx.stroke();
  if (shine > 0) { ctx.save(); ctx.globalAlpha = shine; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(x - rx * 0.35, y - ry * 0.25, rx * 0.18, ry * 0.3, -0.4, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  return th;
}

// A graphics-card character. Everything expressive is a parameter.
function character(o) {
  const col = o.side === 'A' ? C.a : C.b, dark = o.side === 'A' ? C.aDark : C.bDark;
  ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.rot || 0); ctx.scale(o.sx || 1, o.sy || 1);
  // legs
  ctx.strokeStyle = dark; ctx.lineWidth = 16; ctx.lineCap = 'round';
  [[-60, o.legL || 0], [60, o.legR || 0]].forEach(([lx, ang]) => { ctx.beginPath(); ctx.moveTo(lx, 70); ctx.lineTo(lx + Math.sin(ang) * 50, 70 + Math.cos(ang) * 50); ctx.stroke(); });
  // arms
  ctx.lineWidth = 16;
  [[-140, o.armL], [140, o.armR]].forEach(([ax, ang], i) => {
    const dir = i === 0 ? -1 : 1; ctx.beginPath(); ctx.moveTo(ax, 0);
    const ex = ax + dir * Math.cos(ang) * 70, ey = -Math.sin(ang) * 70; ctx.lineTo(ex, ey); ctx.stroke();
    ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(ex, ey, 14, 0, Math.PI * 2); ctx.fill();
  });
  // body
  ctx.fillStyle = dark; ctx.beginPath(); ctx.roundRect(-140, -86, 280, 172, 34); ctx.fill();
  ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(-140, -96, 280, 166, 34); ctx.fill();
  ctx.fillStyle = '#121528'; ctx.beginPath(); ctx.roundRect(-122, -80, 244, 132, 26); ctx.fill();
  // gold connector "feet"
  ctx.fillStyle = '#d6aa2c'; for (let p = -110; p <= 100; p += 18) ctx.fillRect(p, 70, 11, 14);
  // letter badge
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, -96, 30, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.ink; ctx.font = 'bold 40px "DejaVu Sans"'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(o.side, 0, -94);
  // eyes
  const e = o.eyes;
  [-50, 50].forEach((ex, i) => {
    ctx.save(); ctx.translate(ex, -18);
    if (e.happy) { // closed, upturned
      ctx.strokeStyle = C.white; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(0, 12, 22, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    } else {
      const r = 30 * (e.size || 1);
      ctx.fillStyle = C.white; ctx.beginPath(); ctx.ellipse(0, 0, r * 0.85, r * (e.open ?? 1), 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(e.lookX * r * 0.4, e.lookY * r * 0.4 * (e.open ?? 1), r * 0.42 * Math.min(1, (e.open ?? 1) + 0.3), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.white; ctx.beginPath(); ctx.arc(e.lookX * r * 0.4 - 6, e.lookY * r * 0.4 - 6, 5, 0, Math.PI * 2); ctx.fill();
    }
    // brows
    const b = o.brows; const tilt = (i === 0 ? 1 : -1) * b.angle + (i === 1 ? (b.cocked || 0) : 0);
    ctx.strokeStyle = col; ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.save(); ctx.translate(0, -44 - b.raise - (i === 1 ? (b.cockLift || 0) : 0)); ctx.rotate(tilt); ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(22, 0); ctx.stroke(); ctx.restore();
    ctx.restore();
  });
  // mouth
  const m = o.mouth; ctx.strokeStyle = C.white; ctx.fillStyle = C.white; ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.save(); ctx.translate(0, 34);
  if (m === 'grin') { ctx.fillStyle = '#ff6b8a'; ctx.beginPath(); ctx.moveTo(-42, -6); ctx.quadraticCurveTo(0, 46, 42, -6); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  else if (m === 'smile') { ctx.beginPath(); ctx.arc(0, -18, 26, 0.25 * Math.PI, 0.75 * Math.PI); ctx.stroke(); }
  else if (m === 'o') { ctx.fillStyle = '#1b0f1f'; ctx.beginPath(); ctx.ellipse(0, 4, 14, 20, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  else if (m === 'yell') { ctx.fillStyle = '#1b0f1f'; ctx.beginPath(); ctx.ellipse(0, 6, 26, 24, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  else if (m === 'smirk') { ctx.beginPath(); ctx.moveTo(-26, 4); ctx.quadraticCurveTo(10, 14, 34, -10); ctx.stroke(); }
  else if (m === 'wobble') { ctx.beginPath(); for (let k = 0; k <= 6; k++) { const x = -30 + k * 10, y = (k % 2 ? -5 : 5); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
  else { ctx.beginPath(); ctx.moveTo(-24, 4); ctx.lineTo(24, 4); ctx.stroke(); }
  ctx.restore();
  ctx.restore();
}

function scene(t) {
  // ---- camera: follow A's party, push to B's discovery, pull back for the swing ----
  const keys = [[0, 540, 1000, 1.24], [1.2, 540, 990, 1.26], [2.3, 545, 990, 1.26], [3.0, 560, 1000, 1.30], [3.6, 540, 960, 1.22], [5.5, 540, 900, 1.16]];
  let i = 0; while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const [t0, x0, y0, s0] = keys[i], [t1, x1, y1, s1] = keys[i + 1], p = easeIO((t - t0) / (t1 - t0));
  const shake = t > 4.35 && t < 4.75 ? Math.sin(t * 95) * 14 * (1 - (t - 4.35) / 0.4) : 0;
  ctx.save(); ctx.translate(540 + shake, 960 + shake * 0.5); ctx.scale(lerp(s0, s1, p), lerp(s0, s1, p)); ctx.translate(-lerp(x0, x1, p), -lerp(y0, y1, p));

  // floor and pivot
  const g = ctx.createRadialGradient(540, 1550, 50, 540, 1550, 800); g.addColorStop(0, 'rgba(110,90,220,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(-500, 900, 2080, 1300);
  ctx.fillStyle = '#323659'; ctx.beginPath(); ctx.moveTo(540, 910); ctx.lineTo(470, 1480); ctx.lineTo(610, 1480); ctx.closePath(); ctx.fill();
  const ang = beamAngle(t);
  ctx.save(); ctx.translate(PIVOT.x, PIVOT.y); ctx.rotate(ang); ctx.fillStyle = '#e8eaf4'; ctx.beginPath(); ctx.roundRect(-ARM - 30, -16, ARM * 2 + 60, 32, 16); ctx.fill(); ctx.restore();
  ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(PIVOT.x, PIVOT.y, 22, 0, Math.PI * 2); ctx.fill();

  ['A', 'B'].forEach((side) => {
    const pan = panAt(side, t), end = { x: pan.x, y: pan.y - 300 };
    ctx.strokeStyle = '#8e93ad'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(end.x, end.y); ctx.lineTo(pan.x - 170, pan.y + 90); ctx.moveTo(end.x, end.y); ctx.lineTo(pan.x + 170, pan.y + 90); ctx.stroke();
    ctx.fillStyle = '#2b2f4d'; ctx.beginPath(); ctx.roundRect(pan.x - 185, pan.y + 90, 370, 30, 14); ctx.fill();
  });

  const pA = panAt('A', t), pB = panAt('B', t);
  const launch = Math.max(0, hop(t, 4.15, 2.2, 330));                   // A is thrown up as its pan rises

  // ---- Build A: catches coins on its head, celebrates too early, gets launched ----
  // Frame one: a coin is already bonking A's stack and A squashes under it.
  const bonk = (t0) => t >= t0 && t < t0 + 0.22 ? 1 - (t - t0) / 0.22 : 0;
  const catchA = Math.max(bonk(0.2), bonk(0.7));
  const party = hop(t, 1.3, 0.55, 150) + hop(t, 2.0, 0.45, 90);
  const squashA = Math.max(catchA, (t > 1.15 && t < 1.3) ? 1 - Math.abs(t - 1.22) / 0.08 : 0);
  const freeze = t > 3.05;
  const aState = {
    side: 'A', x: pA.x, y: pA.y + 40 - party - launch,
    sx: 1 + squashA * 0.16, sy: 1 - squashA * 0.18 + (party > 40 ? 0.05 : 0),
    rot: freeze ? (launch > 0 ? Math.sin(t * 14) * 0.25 : 0) : Math.sin(t * 9) * 0.07 * (t > 1.3 && t < 3 ? 1 : 0),
    armL: !freeze && t > 1.25 ? 1.3 + Math.sin(t * 18) * 0.25 : (launch > 0 ? 1 + Math.sin(t * 30) * 0.9 : (catchA > 0 ? 1.2 : 0.9)),
    armR: !freeze && t > 1.25 ? 1.3 + Math.cos(t * 18) * 0.25 : (launch > 0 ? 1 + Math.cos(t * 30) * 0.9 : (catchA > 0 ? 1.2 : 0.9)),
    legL: launch > 0 ? Math.sin(t * 28) * 0.7 : 0, legR: launch > 0 ? -Math.sin(t * 28) * 0.7 : 0,
    eyes: !freeze && t > 1.25 ? { happy: true } : freeze ? { lookX: 0.4, lookY: t < 3.7 ? 0.9 : -0.2, open: 1, size: t > 3.25 ? 1.25 : 1 } : { lookX: 0, lookY: -0.95, open: catchA > 0 ? 0.6 : 1 },
    brows: freeze ? { angle: -0.35, raise: 14 } : { angle: 0.15, raise: t > 1.25 ? 8 : 4 },
    mouth: !freeze && t > 1.25 ? 'grin' : freeze ? (launch > 0 ? 'yell' : (t > 3.3 ? 'wobble' : 'o')) : 'smile',
  };

  // ---- Build B: unimpressed, notices its coins are heavy, squashed, smug, lands ----
  const landB = t > 4.35 && t < 4.6 ? 1 - Math.abs(t - 4.45) / 0.15 : 0;
  const weightB = ease((t - 2.55) / 0.5) * (1 - ease((t - 3.2) / 0.4) * 0.6);   // squashed by the swelling gold
  const bMood = t < 2.3 ? 'meh' : t < 2.65 ? 'look' : t < 3.1 ? 'shock' : 'smug';
  const bState = {
    side: 'B', x: pB.x, y: pB.y + 40 + weightB * 18,
    sx: 1 + landB * 0.2 + weightB * 0.12, sy: 1 - landB * 0.22 - weightB * 0.16, rot: 0,
    armL: bMood === 'shock' ? 1.5 : bMood === 'smug' ? 0.3 : (bMood === 'look' ? 1.2 : -0.7),
    armR: bMood === 'shock' ? 1.5 : bMood === 'smug' ? 0.9 + Math.sin(t * 6) * 0.15 : (bMood === 'look' ? 1.2 : -0.7),
    eyes: bMood === 'meh' ? { lookX: -0.9, lookY: -0.3, open: 0.45 } : bMood === 'look' ? { lookX: 0.1, lookY: -0.95, open: 0.8 } :
      bMood === 'shock' ? { lookX: 0, lookY: -0.9, open: 1.25, size: 1.3 } : { lookX: -0.7, lookY: -0.2, open: 0.6 },
    brows: bMood === 'meh' ? { angle: 0, raise: -6 } : bMood === 'shock' ? { angle: 0.1, raise: 22 } : bMood === 'smug' ? { angle: 0.25, raise: 0, cocked: 0.5, cockLift: 14 } : { angle: 0.05, raise: 8 },
    mouth: bMood === 'meh' ? 'flat' : bMood === 'look' ? 'flat' : bMood === 'shock' ? 'o' : 'smirk',
  };

  // ---- coin stacks, balanced on each character's head ----
  // A: ten thin coins; the last two land in the opening second. When A is
  // launched, the stack scatters into the air.
  const headY = (state) => state.y - 128 * state.sy;
  let yA = headY(aState);
  D.coinsA.forEach((m, k) => {
    const last = D.coinsA.length - 1 - k;                 // 0 = top coin
    const arrive = last === 0 ? 0.7 : last === 1 ? 0.2 : -1;
    const rx = 34 + 9 * Math.sqrt(m);
    const th = Math.max(10, rx * 0.22) + 2;
    if (arrive >= 0 && t < arrive - 0.35) { yA -= th; return; }
    const fall = arrive < 0 ? 1 : ease((t - (arrive - 0.35)) / 0.35);
    const wobble = !freeze && t > 1.3 && t < 3 ? Math.sin(t * 9 + k * 0.5) * k * 1.6 : 0;
    const flyU = launch > 0 ? (t - 4.3) : 0;
    const fx = flyU > 0 ? Math.sin(k * 2.3) * 220 * flyU : 0, fy = flyU > 0 ? -(260 + k * 30) * flyU + 700 * flyU * flyU : 0;
    coin(aState.x + wobble + fx, lerp(yA - 600, yA, fall) + (flyU > 0 ? fy + launch : 0), rx, C.a, C.aDark, 0);
    yA -= th;
  });
  // B: seven coins, four of them swelling into dense gold at the discovery.
  let yB = headY(bState);
  [...D.coinsB].reverse().forEach((m, k) => {
    const heavy = m > 6;
    const swell = heavy ? ease((t - 2.55 - k * 0.06) / 0.45) : 0;
    const rx = lerp(34 + 9 * Math.sqrt(Math.min(m, 3)), 34 + 19 * Math.sqrt(m), swell);
    const col = heavy && swell > 0.5 ? C.gold : C.b, dark = heavy && swell > 0.5 ? C.goldDark : C.bDark;
    yB -= coin(bState.x, yB, rx, col, dark, heavy ? swell : 0) + 2;
  });

  character(bState);
  character(aState);

  // confetti: A's premature party, then it rains on a startled A
  for (let k = 0; k < 46; k++) {
    const born = 1.45 + rnd(k) * 0.25; if (t < born) continue;
    const u = t - born, vx = (rnd(k + 9) - 0.5) * 520, vy = -700 - rnd(k + 3) * 520;
    const x = pA.x + vx * u, y = pA.y - 200 + vy * u + 900 * u * u;
    if (y > 1700) continue;
    ctx.save(); ctx.translate(x, y); ctx.rotate(u * 9 + k); ctx.fillStyle = [C.gold, C.a, '#ff6b8a', '#7cf2a5'][k % 4]; ctx.fillRect(-9, -5, 18, 10); ctx.restore();
  }
  // B's discovery spark, and the anticipation "!"
  if (t > 2.65 && t < 3.15) { const s = ease((t - 2.65) / 0.15); ctx.save(); ctx.translate(pB.x + 175, pB.y - 260); ctx.scale(s, s); ctx.fillStyle = C.gold; ctx.font = 'bold 120px "DejaVu Sans"'; ctx.textAlign = 'center'; ctx.fillText('!', 0, 0); ctx.restore(); }
  if (t > 3.2 && t < 3.7) { const s = ease((t - 3.2) / 0.12); ctx.save(); ctx.translate(pA.x + 175, pA.y - 230 - launch); ctx.scale(s, s); ctx.fillStyle = '#ffffff'; ctx.font = 'bold 110px "DejaVu Sans"'; ctx.textAlign = 'center'; ctx.fillText('?!', 0, 0); ctx.restore(); }
  // motion lines as A is thrown
  if (launch > 30) { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 6; for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(pA.x + k * 70, pA.y + 150 - launch); ctx.lineTo(pA.x + k * 70, pA.y + 260 - launch); ctx.stroke(); } }
  ctx.restore();

  // the only words on screen: what kind of numbers these are
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '30px "DejaVu Sans"'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('SpecSmith model estimates', 540, 70);
}

window.renderAt = function (t) {
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#171b3a'); bg.addColorStop(1, '#090a14');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  scene(t);
  return cv.toDataURL('image/jpeg', 0.93);
};`;
}

export async function renderHook() {
  const facts = leadsVsAverageFacts(DEMO_PAIRING);
  const coinsA = facts.games.filter((g) => g.outcome === "A").map((g) => g.margin).sort((a, b) => b - a);
  const coinsB = facts.games.filter((g) => g.outcome === "B").map((g) => -g.margin).sort((a, b) => b - a);
  const sumA = coinsA.reduce((s, m) => s + m, 0), sumB = coinsB.reduce((s, m) => s + m, 0);
  if (!(coinsA.length > coinsB.length && sumB > sumA)) throw new Error("The model no longer gives this reversal; refusing to animate it.");

  const outputDir = resolve(join(here, "..", "..", "..", "render-output", "reversal-hook"));
  await rm(outputDir, { recursive: true, force: true });
  const framesDir = join(outputDir, "frames");
  await mkdir(framesDir, { recursive: true });
  const session = await launchBrowser({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  try {
    const page = await session.context.newPage();
    await page.setContent(`<!doctype html><html><body style="margin:0"><canvas id="c" width="1080" height="1920"></canvas><script>${pageScript({ coinsA, coinsB })}</script></body></html>`);
    await page.evaluate("document.fonts.ready");
    for (let index = 0; index < Math.round(HOOK_SECONDS * FPS); index += 1) {
      const url = await page.evaluate(`window.renderAt(${(index / FPS).toFixed(4)})`) as string;
      await writeFile(join(framesDir, `f-${String(index).padStart(4, "0")}.jpg`), Buffer.from(url.split(",")[1], "base64"));
    }
  } finally {
    await session.close();
  }
  const videoPath = join(outputDir, "reversal-hook.mp4");
  await run("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", join(framesDir, "f-%04d.jpg"), "-an",
    "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    "-metadata", "comment=DRAFT silent hook test. SpecSmith model estimates; not measured benchmarks.", videoPath]);
  return { videoPath, framesDir, coinsA, coinsB, sumA, sumB };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();
if (isMain) {
  renderHook().then((r) => console.log(JSON.stringify({ video: r.videoPath, coinsA: r.coinsA, coinsB: r.coinsB, sumA: r.sumA, sumB: r.sumB })))
    .catch((error) => { console.error(error); process.exitCode = 1; });
}
