#!/usr/bin/env tsx
// The ILLUSTRATIVE silent draft of the monitor-port Short (storyboard.ts).
//
// No footage of the PC exists here, so the ports are a flat diagram: two
// labelled rows of port outlines and one cable. It is deliberately schematic,
// never a realistic rendering of hardware, and every frame says it is
// illustrative in its own band. It exists to judge the story and the edit;
// real footage of the verified PC replaces it.
//
// Each frame is a pure function of time drawn on a canvas in the pinned
// Chromium, then encoded with ffmpeg with a silent track. Type is measured as
// drawn after the zoom; the render refuses anything under MIN_FINAL_PX
// (14 px at 360×640) and refuses to fall back from Inter.
//
//   SPECSMITH_RENDER_CHROMIUM=/opt/pw-browsers/chromium \
//   pnpm exec tsx scripts/content-automator/nextVideoMonitorPort/illustrativeDraft.ts

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launchBrowser } from "../uiRender/capture.ts";
import { SPECSMITH_MOTION_COLOURS } from "../v2/creative/dataMotionGraphic.ts";
import {
  beats, DURATION_SECONDS, FPS, ILLUSTRATIVE_LABEL, LABELS, MonitorPortStoryError, PC_RECORD, proposedNarration, SITE_LINE, SOURCES, storyProblems,
} from "./storyboard.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const DRAFT_DIR = resolve(here, "../../../render-output/monitor-port-illustrative-draft");
/** The same Inter files the refresh-rate Short vendored (OFL 1.1). */
export const FONT_DIR = resolve(here, "../nextVideoRefreshRate/fonts");
const FONT_FILES = { 400: "inter-latin-400-normal.woff2", 600: "inter-latin-600-normal.woff2", 700: "inter-latin-700-normal.woff2" } as const;
export const MIN_FINAL_PX = 42;
export const LAYOUT = Object.freeze({ width: 1080, height: 1920, label: { y: 0, height: 200 }, story: { y: 200, height: 1400 }, captions: { y: 1600, height: 320 } });
export const KEY_FRAME_SECONDS = [0, 1.3, 3.6, 5.6, 6.95, 7.4, 8.2, 9.5, 11.7] as const;

function pageScript(state: unknown): string {
  return `
const S = ${JSON.stringify(state)};
const C = S.colours, L = S.layout, W = L.width, STORY = L.story, CAP = L.captions, TOP = L.label;
const canvas = document.getElementById('c'); const ctx = canvas.getContext('2d');
const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const out = (x) => 1 - Math.pow(1 - clamp(x), 3);
const back = (x) => { x = clamp(x); const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const lerp = (a, b, k) => a + (b - a) * k;
const measured = { minFinalPx: Infinity, misfits: [] };
let zoom = 1;
const PURPLE = C.accentText, CYAN = C.cyan;

function text(s, x, y, maxWidth, max, min, colour, align, weight) {
  let size = max;
  for (; size >= min; size -= 1) { ctx.font = weight + ' ' + size + 'px Inter'; if (ctx.measureText(s).width <= maxWidth) break; }
  if (size < min) { size = min; measured.misfits.push(s); }
  ctx.font = weight + ' ' + size + 'px Inter'; ctx.fillStyle = colour; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
  measured.minFinalPx = Math.min(measured.minFinalPx, size * zoom);
  return ctx.measureText(s).width;
}
function rr(x, y, w, h, r, fill, stroke, lw) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 3; ctx.stroke(); }
}
function pill(s, cx, cy, colour, size) {
  ctx.font = '700 ' + size + 'px Inter';
  const w = ctx.measureText(s).width + 56;
  rr(cx - w / 2, cy - size * 0.8, w, size * 1.6, size * 0.8, colour);
  text(s, cx, cy + 2, w, size, size, '#0A0A0F', 'center', 700);
}

// ---- The diagram, in story coordinates (1080 × 1400). Schematic outlines only. ----
const MB = { x: 110, y: 250, w: 860, h: 230 };   // motherboard port row
const GPU = { x: 110, y: 800, w: 860, h: 230 };  // graphics card port row
// The video port the cable starts in (motherboard HDMI) and the one it ends in (graphics card HDMI).
const MB_PORT = { x: 470, y: MB.y + 80, w: 130, h: 56 };
const GPU_PORT = { x: 760, y: GPU.y + 80, w: 130, h: 56 };

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
function usb(x, y) { rr(x, y, 76, 30, 4, '#0B0B10', '#55556A', 3); rr(x + 10, y + 8, 56, 8, 2, '#55556A'); }

function row(r, label, colour, lit, kind) {
  rr(r.x, r.y, r.w, r.h, 26, '#1A1A24', lit > 0 ? colour : '#33333F', lit > 0 ? 3 + 4 * lit : 3);
  if (lit > 0) { ctx.save(); ctx.globalAlpha = 0.10 * lit; rr(r.x, r.y, r.w, r.h, 26, colour); ctx.restore(); }
  pill(label, r.x + 40 + labelWidth(label) / 2, r.y - 4, colour, 46);
  const vy = r.y + 80, portColour = lit > 0 ? colour : '#C9C9D6';
  if (kind === 'mb') {
    usb(r.x + 60, vy + 4); usb(r.x + 60, vy + 50); usb(r.x + 160, vy + 4); usb(r.x + 160, vy + 50);
    hdmi(MB_PORT, portColour, 5); dp({ x: 630, y: vy, w: 120, h: 56 }, portColour, 5);
    rr(790, vy - 4, 64, 64, 8, '#0B0B10', '#55556A', 3);
    for (let i = 0; i < 3; i += 1) { ctx.beginPath(); ctx.arc(890 + (i % 2) * 0, vy - 6 + i * 34, 13, 0, Math.PI * 2); ctx.strokeStyle = '#55556A'; ctx.lineWidth = 3; ctx.stroke(); }
  } else {
    // Expansion-slot brackets with vent slots, then the card's display outputs.
    for (let i = 0; i < 9; i += 1) rr(r.x + 50 + i * 22, vy - 10, 10, 90, 5, '#2A2A36');
    dp({ x: 340, y: vy, w: 120, h: 56 }, portColour, 5); dp({ x: 480, y: vy, w: 120, h: 56 }, portColour, 5); dp({ x: 620, y: vy, w: 120, h: 56 }, portColour, 5);
    hdmi(GPU_PORT, portColour, 5);
  }
}
const labelWidth = (s) => { ctx.font = '700 46px Inter'; return ctx.measureText(s).width + 56; };

/** The cable: plug position as a function of time, one decisive move. */
function plugAt(t) {
  const a = { x: MB_PORT.x + MB_PORT.w / 2, y: MB_PORT.y + MB_PORT.h / 2 }, b = { x: GPU_PORT.x + GPU_PORT.w / 2, y: GPU_PORT.y + GPU_PORT.h / 2 };
  const pull = 6.6, travel = 6.82, push = 7.62, done = 7.82;
  if (t < pull) return { ...a, out: 0 };
  if (t < travel) return { ...a, y: a.y + 70 * out((t - pull) / (travel - pull)), out: 1 };
  if (t < push) {
    const k = ease((t - travel) / (push - travel));
    return { x: lerp(a.x, b.x, k), y: lerp(a.y + 70, b.y + 70, k) - Math.sin(k * Math.PI) * 120, out: 1 };
  }
  return { ...b, y: b.y + 70 * (1 - back((t - push) / (done - push))), out: t < done ? 1 : 0 };
}
function cable(t) {
  const p = plugAt(t);
  // From the monitor, below the frame, up to the plug.
  ctx.strokeStyle = '#4A4A5C'; ctx.lineWidth = 30; ctx.lineCap = 'round';
  // It leaves the frame to the right, between the rows, so it never crosses a label.
  ctx.beginPath(); ctx.moveTo(p.x, p.y + 40); ctx.bezierCurveTo(p.x, p.y + 200, 980, p.y + 170, 1180, p.y + 190); ctx.stroke();
  ctx.strokeStyle = '#6A6A80'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(p.x - 10, p.y + 40); ctx.bezierCurveTo(p.x - 10, p.y + 190, 975, p.y + 160, 1180, p.y + 180); ctx.stroke();
  rr(p.x - 76, p.y - 34, 152, 92, 14, '#2E2E3C', '#8A8AA0', 3);
  rr(p.x - 60, p.y - 28 - 26 * p.out, 120, 30, 6, '#9A9AB0');
  return p;
}

function story(t, beat) {
  ctx.save(); ctx.beginPath(); ctx.rect(0, STORY.y, W, STORY.height); ctx.clip();
  ctx.fillStyle = C.background; ctx.fillRect(0, STORY.y, W, STORY.height);
  // Camera: whole diagram, a punch-in on each row, back out for the move.
  const shots = { hook: [540, 600, 1.15], motherboard: [540, 380, 1.18], 'graphics-card': [540, 930, 1.18], move: [540, 700, 1.0], result: [540, 760, 1.0], instruction: [540, 700, 1.05] };
  const order = S.beats.map((b) => b.id), i = order.indexOf(beat.id), prev = shots[order[Math.max(0, i - 1)]], cur = shots[beat.id];
  const k = i === 0 ? 1 : ease((t - beat.startSecond) / 0.35);
  const cx = lerp(prev[0], cur[0], k), cy = lerp(prev[1], cur[1], k), z = lerp(prev[2], cur[2], k);
  ctx.translate(W / 2, STORY.y + STORY.height / 2); ctx.scale(z, z); ctx.translate(-cx, -cy); zoom = z;

  const mbLit = beat.id === 'motherboard' ? out((t - 2.6) / 0.25) : 0;
  const gpuLit = beat.id === 'graphics-card' || beat.id === 'instruction' ? out((t - beat.startSecond) / 0.25) : beat.id === 'move' || beat.id === 'result' ? 0.6 : 0;
  row(MB, S.labels.motherboard, PURPLE, mbLit, 'mb');
  row(GPU, S.labels.graphicsCard, CYAN, gpuLit, 'gpu');
  // Result beat: a monitor whose screen is a labelled placeholder, never a guessed outcome.
  if (beat.id === 'result' || beat.id === 'instruction') {
    const a = beat.id === 'result' ? out((t - 8.6) / 0.3) : 1 - out((t - 10.4) / 0.3);
    if (a > 0) {
      ctx.save(); ctx.globalAlpha = a;
      rr(190, 1130, 700, 300, 22, '#121219', '#55556A', 5);
      ctx.setLineDash([18, 12]); rr(214, 1152, 652, 256, 12, null, C.amber, 4); ctx.setLineDash([]);
      text(S.resultPlaceholder[0], 540, 1245, 600, 48, 42, C.amber, 'center', 700);
      text(S.resultPlaceholder[1], 540, 1318, 600, 44, 42, C.text, 'center', 600);
      ctx.restore();
    }
  }
  const p = cable(t);
  // The one decisive moment: a ring as the plug seats in the graphics card.
  if (t >= 7.82 && t < 8.6) {
    const k2 = clamp((t - 7.82) / 0.6);
    ctx.save(); ctx.globalAlpha = 1 - k2; ctx.strokeStyle = CYAN; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(p.x, p.y + 6, 90 + 70 * k2, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  if (beat.id === 'hook') {
    pill('MONITOR CABLE', 800, 640, C.amber, 42);
    // One pulse on the plugged port, so the eye lands on where the cable is now.
    const k = clamp((t - 0.5) / 0.9);
    if (k > 0 && k < 1) { ctx.save(); ctx.globalAlpha = 1 - k; ctx.strokeStyle = C.amber; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(p.x, p.y + 6, 90 + 60 * k, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
  }
  if (t >= 10.4) { ctx.save(); ctx.globalAlpha = out((t - 10.6) / 0.4) * 0.9; text(S.site, 540, 1300, 600, 42, 42, C.textSecondary, 'center', 600); ctx.restore(); }
  ctx.restore(); zoom = 1;
}

function labelBand() {
  ctx.fillStyle = C.surface; ctx.fillRect(0, TOP.y, W, TOP.height);
  ctx.font = '700 44px Inter'; const w = ctx.measureText(S.label.badge).width + 60;
  rr((W - w) / 2, 34, w, 76, 38, C.amber);
  text(S.label.badge, W / 2, 73, w, 44, 44, '#0A0A0F', 'center', 700);
  text(S.label.line, W / 2, 152, W - 120, 42, 42, C.text, 'center', 600);
}
function wrap(s, maxWidth, size) {
  ctx.font = '700 ' + size + 'px Inter';
  if (ctx.measureText(s).width <= maxWidth) return [s];
  const sentence = s.match(/^(.+?[.?!])\\s+(.+)$/);
  if (sentence && ctx.measureText(sentence[1]).width <= maxWidth && ctx.measureText(sentence[2]).width <= maxWidth) return [sentence[1], sentence[2]];
  const words = s.split(' '); let best = null;
  for (let i = 1; i < words.length; i += 1) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const worst = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
    if (!best || worst < best.worst) best = { lines: [a, b], worst };
  }
  return best.lines;
}
function captionBand(beat) {
  ctx.fillStyle = C.background; ctx.fillRect(0, CAP.y, W, CAP.height);
  // Prefer one sentence per line, at the largest size from 70 down to 60 px that allows it.
  let size = 70, lines = wrap(beat.caption, W - 120, size);
  const sentence = beat.caption.match(/^(.+?[.?!])\\s+(.+)$/);
  if (sentence) {
    let fitted = false;
    for (let s = 70; s >= 60 && !fitted; s -= 2) {
      ctx.font = '700 ' + s + 'px Inter';
      if (ctx.measureText(sentence[1]).width <= W - 120 && ctx.measureText(sentence[2]).width <= W - 120) { size = s; lines = [sentence[1], sentence[2]]; fitted = true; }
    }
    // Otherwise three lines: the first sentence, then the second wrapped, never a break mid-sentence across sentences.
    if (!fitted) { size = 64; lines = [sentence[1], ...wrap(sentence[2], W - 120, size)]; }
  }
  lines.forEach((line, i) => text(line, W / 2, CAP.y + CAP.height / 2 + (i - (lines.length - 1) / 2) * size * 1.2, W - 120, size, 60, C.text, 'center', 700));
}

window.renderAt = (t) => {
  ctx.fillStyle = C.background; ctx.fillRect(0, 0, W, L.height);
  const beat = S.beats.find((b) => t >= b.startSecond && t < b.endSecond) || S.beats.at(-1);
  labelBand(); story(t, beat); captionBand(beat);
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
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export async function renderIllustrativeDraft(outputDir = DRAFT_DIR) {
  const problems = storyProblems(PC_RECORD);
  if (problems.length) throw new MonitorPortStoryError(`The story is not renderable:\n- ${problems.join("\n- ")}`);
  if (PC_RECORD) throw new MonitorPortStoryError("A verified PC record exists: cut the real footage, not the illustrative draft.");
  await mkdir(outputDir, { recursive: true });
  const work = join(outputDir, "work"), framesDir = join(work, "frames");
  await rm(work, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });

  const fontRecords: { file: string; sha256: string }[] = [];
  const faces: string[] = [];
  for (const [weight, file] of Object.entries(FONT_FILES)) {
    const bytes = await readFile(join(FONT_DIR, file));
    fontRecords.push({ file: `nextVideoRefreshRate/fonts/${file}`, sha256: sha256(bytes) });
    faces.push(`@font-face{font-family:Inter;font-weight:${weight};src:url(data:font/woff2;base64,${bytes.toString("base64")}) format('woff2');}`);
  }
  const state = {
    layout: LAYOUT, colours: SPECSMITH_MOTION_COLOURS, labels: LABELS, site: SITE_LINE, label: ILLUSTRATIVE_LABEL,
    beats: beats(PC_RECORD), resultPlaceholder: ["RESULT SHOT", "filmed on the real PC"],
  };
  const count = Math.round(DURATION_SECONDS * FPS);
  let minFinalPx = Infinity;
  const session = await launchBrowser({ width: LAYOUT.width, height: LAYOUT.height, deviceScaleFactor: 1 });
  try {
    const page = await session.context.newPage();
    await page.setContent(`<!doctype html><html><head><style>${faces.join("")}</style></head><body style="margin:0;background:#0A0A0F"><canvas id="c" width="${LAYOUT.width}" height="${LAYOUT.height}"></canvas><script>${pageScript(state)}</script></body></html>`);
    await page.evaluate(`Promise.all([400, 600, 700].map((w) => document.fonts.load(w + ' 48px Inter')))`);
    if (!(await page.evaluate(`[400, 600, 700].every((w) => document.fonts.check(w + ' 48px Inter'))`))) throw new MonitorPortStoryError("Inter did not load; refusing to render in a fallback font.");
    for (let index = 0; index < count; index += 1) {
      const url = await page.evaluate(`window.renderAt(${(index / FPS).toFixed(4)})`) as string;
      await writeFile(join(framesDir, `f-${String(index).padStart(4, "0")}.png`), Buffer.from(url.split(",")[1], "base64"));
    }
    const measured = await page.evaluate("window.measured()") as { minFinalPx: number; misfits: string[] };
    if (measured.misfits.length) throw new MonitorPortStoryError(`Text does not fit at a readable size: ${[...new Set(measured.misfits)].join(" | ")}`);
    minFinalPx = measured.minFinalPx;
  } finally {
    await session.close();
  }
  if (minFinalPx < MIN_FINAL_PX) throw new MonitorPortStoryError(`Smallest type is ${minFinalPx.toFixed(1)}px, under ${MIN_FINAL_PX}px.`);

  const videoPath = join(outputDir, "monitor-port-illustrative-draft.mp4");
  await run("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", join(framesDir, "f-%04d.png"),
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "0:v", "-map", "1:a",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
    "-t", DURATION_SECONDS.toFixed(3), "-movflags", "+faststart", videoPath]);
  const keyFrames: { second: number; path: string }[] = [];
  for (const second of KEY_FRAME_SECONDS) {
    const path = join(outputDir, `phone-${second.toFixed(2).replace(".", "_")}s.png`);
    await run("ffmpeg", ["-v", "error", "-y", "-ss", second.toFixed(3), "-i", videoPath, "-frames:v", "1", "-vf", "scale=360:640:flags=lanczos", path]);
    keyFrames.push({ second, path });
  }
  const contactSheet = join(outputDir, "phone-sheet.png");
  const perRow = 5;
  await run("ffmpeg", ["-v", "error", "-y", ...keyFrames.flatMap((frame) => ["-i", frame.path]),
    "-filter_complex", `${keyFrames.map((_, i) => `[${i}:v]pad=372:652:6:6:color=0x2A2A33[p${i}]`).join(";")};${keyFrames.map((_, i) => `[p${i}]`).join("")}xstack=inputs=${keyFrames.length}:layout=${keyFrames.map((_, i) => `${(i % perRow) * 372}_${Math.floor(i / perRow) * 652}`).join("|")}:fill=0x0A0A0F`,
    "-frames:v", "1", contactSheet]);
  await rm(work, { recursive: true, force: true });

  const report = {
    label: "ILLUSTRATIVE DIAGRAM DRAFT: schematic ports, not real hardware. Silent. Not for publication.",
    video: { path: videoPath, sha256: sha256(await readFile(videoPath)), durationSeconds: DURATION_SECONDS, width: LAYOUT.width, height: LAYOUT.height, fps: FPS, audio: "silent" },
    minFinalPx, keyFrames, contactSheet,
    beats: state.beats,
    proposedNarration: { text: proposedNarration(PC_RECORD), characters: proposedNarration(PC_RECORD).length, voiced: false, final: false },
    pcRecord: null,
    sources: SOURCES,
    provenance: [
      { asset: "Port diagram, cable, monitor outline", kind: "illustrative-diagram", madeBy: "nextVideoMonitorPort/illustrativeDraft.ts (canvas outlines)", note: "Schematic; not a depiction of any real product. Real footage replaces it." },
      { asset: "Inter typeface", kind: "font", source: "npm @fontsource/inter@5.3.0", licence: "SIL OFL 1.1", files: fontRecords },
      { asset: "Colours", kind: "brand", source: "artifacts/SpecSmith/src/index.css (--ff-*)" },
    ],
  };
  await writeFile(join(outputDir, "draft-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  renderIllustrativeDraft().then((report) => {
    console.log(report.label);
    console.log(`video: ${report.video.path}`);
    console.log(`sha256: ${report.video.sha256}`);
    console.log(`smallest type: ${report.minFinalPx.toFixed(1)}px`);
    console.log(`narration (${report.proposedNarration.characters} chars): ${report.proposedNarration.text}`);
    console.log(`contact sheet: ${report.contactSheet}`);
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
