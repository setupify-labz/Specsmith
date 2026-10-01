// Render the "leads vs average" proof of concept offline.
//
//   pnpm content:poc:leads-vs-average
//
// Every frame is drawn by a pure function of time on a 1080x1920 canvas in a
// real browser, so the same inputs always give the same frames. The narration
// is espeak-ng, a robotic offline PLACEHOLDER (labelled on screen and in the
// file's metadata), placed per scene so speech starts with its scene. The
// closing scene shows a real, freshly verified SpecSmith Compare capture of
// this pairing; nothing else is a screenshot.
//
// Needs Chromium, ffmpeg, ffprobe and espeak-ng, and the built app served at
// SPECSMITH_RENDER_BASE_URL (default http://localhost:5178) for the capture.
// No network beyond localhost, no credential, no paid service, no publishing.

import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildAssDocument, parseCaptionRenderState } from "../captionRender.ts";
import { launchBrowser } from "../uiRender/capture.ts";
import { createDeterministicUiRenderAdapter } from "../uiRender/deterministicUiRenderAdapter.ts";
import { reviewStoryboard } from "../v2/creative/storyboardQualityGate.ts";
import { verifyRenderedMedia } from "../v2/mediaVerification.ts";
import { DEMO_PAIRING, leadsVsAverageFacts, type LeadsVsAverageFacts } from "./facts.ts";
import { decisiveLeadsB, leadsVsAverageScenes, leadsVsAverageStoryboard, shortGameName, type PocScene } from "./storyboard.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const FPS = 30;
const PLACEHOLDER_AUDIO = "PLACEHOLDER VOICE: espeak-ng offline fixture, not a production voice. Draft proof of concept; not reviewed, not approved.";

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [], err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolvePromise(Buffer.concat(out).toString("utf8"))
      : reject(new Error(`${command} exited ${code}: ${Buffer.concat(err).toString("utf8").slice(-800)}`)));
  });
}
const duration = async (path: string) => Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path])).trim());

/** The drawing code, run in the page. Pure in `t`: no clocks, no randomness. */
function pageScript(data: unknown): string {
  return `
const DATA = ${JSON.stringify(data)};
const W = 1080, H = 1920;
const canvas = document.getElementById('c'); const ctx = canvas.getContext('2d');
const C = { bg: '#0b0c12', a: '#9b8cff', b: '#22d3ee', tie: '#8a8fa3', text: '#ffffff', dim: '#a3a8b8', amber: '#fbbf24', tile: '#4a5068' };
const clamp = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
const lerp = (a, b, p) => a + (b - a) * p;
function text(s, x, y, size, color, align, weight) {
  ctx.font = (weight || 'bold') + ' ' + size + 'px "DejaVu Sans"'; ctx.fillStyle = color; ctx.textAlign = align || 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText(s, x, y);
}
function rect(x, y, w, h, r, color) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, Math.max(0, w), h, Math.min(r, Math.max(0, w) / 2, h / 2)); ctx.fill();
}
/** Draws with extra transparency, then restores exactly. Never divides alpha back out. */
function faded(alpha, draw) { if (alpha <= 0) return; ctx.save(); ctx.globalAlpha *= alpha; draw(); ctx.restore(); }
const capture = new Image(); capture.src = DATA.captureDataUrl;
window.captureReady = new Promise((r) => { capture.onload = r; });

function header() {
  text('SpecSmith model estimates, not measured benchmarks', 540, 72, 34, C.text);
  text('A: ' + DATA.buildA + '    B: ' + DATA.buildB, 540, 120, 24, C.dim, 'center', 'normal');
  text(DATA.setting + ' · draft · placeholder voice', 540, 162, 24, C.amber, 'center', 'normal');
  ctx.fillStyle = '#23263a'; ctx.fillRect(60, 192, 960, 2);
}

function hook(u) {
  const a = Math.round(ease(u / 1.2) * DATA.tally.leadsA), b = Math.round(ease((u - 0.15) / 1.2) * DATA.tally.leadsB);
  text(String(a), 300, 780, 260, C.a); text(String(b), 780, 780, 260, C.b); text('–', 540, 740, 120, C.dim);
  text('Build A', 300, 880, 44, C.a); text('Build B', 780, 880, 44, C.b);
  text('games ahead', 300, 930, 32, C.dim, 'center', 'normal'); text('games ahead', 780, 930, 32, C.dim, 'center', 'normal');
  const q = ease((u - 1.4) / 0.4);
  faded(q, () => text('Faster?', 540, 1240, 40 + 60 * q, C.amber));
}

function tally(u) {
  const cols = { A: 230, tie: 540, B: 850 }, colors = { A: C.a, tie: C.tie, B: C.b };
  const stackIndex = { A: 0, tie: 0, B: 0 }, landed = { A: 0, tie: 0, B: 0 };
  DATA.games.forEach((g, i) => {
    const k = stackIndex[g.outcome]++;
    const gx = 540 - 425 + (i % 4) * 215, gy = 300 + Math.floor(i / 4) * 66;
    const tx = cols[g.outcome] - 100, ty = 1330 - (k + 1) * 58;
    const p = ease((u - 0.6 - i * 0.12) / 0.6);
    if (p >= 0.98) landed[g.outcome]++;
    const x = lerp(gx, tx, p), y = lerp(gy, ty, p);
    rect(x, y, 200, 48, 10, C.tile);
    faded(p, () => rect(x, y, 200, 48, 10, colors[g.outcome]));
    if (p > 0.5) text(g.outcome === 'tie' ? '=' : '+' + Math.abs(g.margin), x + 100, y + 35, 28, '#0b0c12');
  });
  [['A', 'A higher'], ['tie', DATA.tally.ties === 1 ? 'Tie' : 'Ties'], ['B', 'B higher']].forEach(([key, label]) => {
    text(String(landed[key]), cols[key], 1430, 72, colors[key]);
    text(label, cols[key], 1480, 32, colors[key], 'center', 'normal');
  });
}

function margins(u) {
  text('How far ahead?', 540, 300, 52, C.text);
  const scale = 38, x0 = 140;
  text('Build A ahead in ' + DATA.tally.leadsA + ' games', x0, 390, 34, C.a, 'left');
  DATA.leadsA.forEach((g, k) => {
    const y = 420 + k * 30, w = g.margin * scale * ease((u - 0.3 - k * 0.05) / 0.5);
    rect(x0, y, w, 22, 6, C.a);
    if (w > 0) text('+' + g.margin, x0 + w + 12, y + 20, 22, C.dim, 'left', 'normal');
  });
  text('Build B ahead in ' + DATA.tally.leadsB + ' games', x0, 800, 34, C.b, 'left');
  DATA.leadsB.forEach((g, k) => {
    const y = 830 + k * 64, m = -g.margin, w = m * scale * ease((u - 1.6 - k * 0.12) / 0.6);
    rect(x0, y, w, 50, 10, C.b);
    if (g.decisive && w > 220) text(g.name, x0 + 16, y + 36, 28, '#0b0c12', 'left');
    if (w > 0) text('+' + m, x0 + w + 14, y + 36, 28, C.text, 'left');
  });
  const n = ease((u - 3.4) / 0.4);
  faded(n, () => text(DATA.tally.ties + ' games tied: equal estimates', 540, 1380, 30, C.dim, 'center', 'normal'));
}

function average(u) {
  text('Average across all ' + DATA.games.length + ' games', 540, 320, 48, C.text);
  const x0 = 140, max = 800, scale = max / Math.max(DATA.averageA, DATA.averageB);
  [['A', DATA.averageA, 520, C.a], ['B', DATA.averageB, 720, C.b]].forEach(([key, avg, y, color], i) => {
    const w = avg * scale * ease((u - i * 0.15) / 1.2);
    text('Build ' + key, x0, y - 18, 34, color, 'left');
    rect(x0, y, w, 110, 14, color);
    if (w > 260) text(avg + ' FPS', x0 + w - 24, y + 74, 48, '#0b0c12', 'right');
  });
  const h = ease((u - 1.6) / 0.5);
  faded(h, () => {
    text('B: +' + (DATA.averageB - DATA.averageA) + ' FPS on average', 540, 1060, 64, C.b);
    text('while ahead in fewer games', 540, 1135, 36, C.dim, 'center', 'normal');
  });
  const r = ease((u - 2.4) / 0.5);
  faded(r, () => text(DATA.tally.leadsA + ' ahead · ' + DATA.tally.ties + ' ties · ' + DATA.tally.leadsB + ' ahead', 540, 1260, 34, C.dim, 'center', 'normal'));
}

function cta(u) {
  text('Wins or average?', 540, 300, 60, C.text);
  text('Check the games you play', 540, 370, 40, C.dim, 'center', 'normal');
  const w = 640, h = Math.min(780, w * capture.height / capture.width), y = lerp(1600, 430, ease(u / 0.7));
  // Everything below 1600 is the caption band: the card never slides over a caption.
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, 1600); ctx.clip();
  ctx.beginPath(); ctx.roundRect(540 - w / 2, y, w, h, 22); ctx.clip();
  ctx.drawImage(capture, 0, 0, capture.width, capture.height * (h / (w * capture.height / capture.width)), 540 - w / 2, y, w, h);
  ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, 1600); ctx.clip();
  ctx.strokeStyle = '#3a3f55'; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(540 - w / 2, y, w, h, 22); ctx.stroke();
  ctx.restore();
  const s = ease((u - 0.6) / 0.5);
  faded(s, () => { text('specsmith /compare', 540, 1340, 64, C.a); text('Real SpecSmith Compare, this pairing', 540, 1400, 26, C.dim, 'center', 'normal'); });
}

const DRAW = { hook, tally, margins, average, cta };
const FADE = 0.3;
window.renderAt = function (t) {
  ctx.globalAlpha = 1; ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  DATA.scenes.forEach((scene, i) => {
    const last = i === DATA.scenes.length - 1;
    if (t < scene.startSecond - (i ? FADE : 0) || t >= scene.endSecond + (last ? 1e9 : 0)) return;
    const fadeIn = i === 0 ? 1 : clamp((t - scene.startSecond + FADE) / FADE);
    const fadeOut = last ? 1 : clamp((scene.endSecond - t) / FADE);
    ctx.globalAlpha = Math.min(fadeIn, fadeOut);
    DRAW[scene.id](t - scene.startSecond);
  });
  ctx.globalAlpha = 1; header();
  return canvas.toDataURL('image/jpeg', 0.95);
};`;
}

export async function renderLeadsVsAverage(outputRoot?: string) {
  const outputDir = resolve(outputRoot ?? join(here, "..", "..", "..", "render-output", "leads-vs-average-poc"));
  await rm(outputDir, { recursive: true, force: true });
  const framesDir = join(outputDir, "frames");
  await mkdir(framesDir, { recursive: true });

  const facts: LeadsVsAverageFacts = leadsVsAverageFacts(DEMO_PAIRING);
  const scenes: PocScene[] = leadsVsAverageScenes(facts);
  const total = scenes.at(-1)!.endSecond;
  const review = reviewStoryboard({ reviewId: "leads-vs-average-poc", storyboard: leadsVsAverageStoryboard(facts), ctaRoute: "/compare" });

  // The one product moment: a fresh, verified capture of this exact pairing.
  // Its expected text includes the model's tie count and averages, so a
  // stale build that scores ties as leads is refused here.
  const [capture] = await createDeterministicUiRenderAdapter({
    baseUrl: process.env.SPECSMITH_RENDER_BASE_URL ?? "http://localhost:5178", outputDir: join(outputDir, "capture"),
  }).render({
    packageId: "leads-vs-average-poc", campaignId: "poc", ideaId: "poc", platform: "youtube-shorts", targetDurationSeconds: total,
    task: { taskId: "cta-capture", capability: "deterministic-ui-render", sourceBeat: 4, purpose: "", inputRequirements: [], outputRequirements: [],
      uiRenderState: { captureType: "static", state: { surface: "compare", ...DEMO_PAIRING } } },
    dependencyArtifacts: [],
  });
  const capturePath = fileURLToPath(capture.uri);

  const decisive = new Set(decisiveLeadsB(facts).map((game) => game.game));
  const data = {
    buildA: facts.buildA, buildB: facts.buildB,
    setting: `${facts.pairing.resolution} ${facts.pairing.preset[0].toUpperCase()}${facts.pairing.preset.slice(1)}`,
    tally: facts.tally, averageA: facts.averageA, averageB: facts.averageB,
    games: facts.games.map((game) => ({ outcome: game.outcome, margin: game.margin })),
    leadsA: facts.games.filter((game) => game.outcome === "A").sort((a, b) => b.margin - a.margin).map((game) => ({ margin: game.margin })),
    leadsB: facts.games.filter((game) => game.outcome === "B").sort((a, b) => a.margin - b.margin)
      .map((game) => ({ margin: game.margin, name: shortGameName(game.game), decisive: decisive.has(game.game) })),
    scenes: scenes.map(({ id, startSecond, endSecond }) => ({ id, startSecond, endSecond })),
    captureDataUrl: `data:image/png;base64,${(await readFile(capturePath)).toString("base64")}`,
  };

  // Frames.
  const session = await launchBrowser({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  try {
    const page = await session.context.newPage();
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#0b0c12"><canvas id="c" width="1080" height="1920"></canvas><script>${pageScript(data)}</script></body></html>`);
    await page.evaluate("window.captureReady");
    await page.evaluate("document.fonts.ready");
    const count = Math.round(total * FPS);
    for (let index = 0; index < count; index += 1) {
      const url = await page.evaluate(`window.renderAt(${(index / FPS).toFixed(4)})`) as string;
      await writeFile(join(framesDir, `frame-${String(index).padStart(4, "0")}.jpg`), Buffer.from(url.split(",")[1], "base64"));
    }
  } finally {
    await session.close();
  }

  // Placeholder narration, one clip per scene, each starting with its scene.
  const audio: { scene: string; startSecond: number; seconds: number; fitsScene: boolean }[] = [];
  const clips: string[] = [];
  for (const scene of scenes) {
    const path = join(outputDir, `voice-${scene.id}.wav`);
    await run("espeak-ng", ["-v", "en-us", "-s", "165", "-w", path, scene.narration]);
    const seconds = await duration(path);
    const startSecond = scene.startSecond + 0.15;
    audio.push({ scene: scene.id, startSecond, seconds: Number(seconds.toFixed(2)), fitsScene: startSecond + seconds <= scene.endSecond + 0.05 });
    clips.push(path);
  }
  if (audio.some((clip) => !clip.fitsScene)) {
    throw new Error(`Narration overruns its scene: ${JSON.stringify(audio.filter((clip) => !clip.fitsScene))}. Shorten the line or lengthen the scene.`);
  }
  const voicePath = join(outputDir, "voice.wav");
  await run("ffmpeg", ["-v", "error", "-y", ...clips.flatMap((clip) => ["-i", clip]), "-filter_complex",
    `${audio.map((clip, index) => `[${index}:a]adelay=${Math.round(clip.startSecond * 1000)}:all=1[a${index}]`).join(";")};` +
    `${audio.map((_, index) => `[a${index}]`).join("")}amix=inputs=${audio.length}:normalize=0,apad=whole_dur=${total}[out]`,
    "-map", "[out]", "-t", String(total), voicePath]);

  // Captions in the bottom band, then the master.
  const captionPath = join(outputDir, "captions.ass");
  await writeFile(captionPath, buildAssDocument(parseCaptionRenderState({ durationSeconds: total, placement: "caption-band",
    cues: scenes.map((scene) => ({ startSecond: scene.startSecond, endSecond: scene.endSecond, text: scene.caption })) })));
  const videoPath = join(outputDir, "leads-vs-average-poc.mp4");
  await run("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", join(framesDir, "frame-%04d.jpg"), "-i", voicePath,
    "-vf", `ass='${captionPath.replace(/:/g, "\\:")}'`, "-t", String(total), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-metadata", `comment=${PLACEHOLDER_AUDIO}`, "-metadata", "title=DRAFT leads vs average POC", videoPath]);
  await rm(framesDir, { recursive: true, force: true });

  // Inspection frames: the opening, both sides of every cut, each scene's middle, the final frame.
  const inspectDir = join(outputDir, "inspection");
  await mkdir(inspectDir, { recursive: true });
  const moments = [{ label: "00-opening", at: 0.1 }];
  scenes.forEach((scene, index) => {
    if (index > 0) moments.push({ label: `${String(index).padStart(2, "0")}-cut-into-${scene.id}`, at: scene.startSecond });
    moments.push({ label: `${String(index).padStart(2, "0")}-${scene.id}-settled`, at: Math.min(scene.endSecond - 0.4, scene.startSecond + 3.6) });
  });
  moments.push({ label: "99-final", at: total - 0.05 });
  const frames: string[] = [];
  for (const moment of moments) {
    const path = join(inspectDir, `${moment.label}.png`);
    await run("ffmpeg", ["-v", "error", "-y", "-ss", moment.at.toFixed(3), "-i", videoPath, "-frames:v", "1", path]);
    frames.push(path);
  }
  const sheetPath = join(outputDir, "inspection-sheet.png");
  await run("ffmpeg", ["-v", "error", "-y", ...frames.flatMap((path) => ["-i", path]), "-filter_complex",
    `${frames.map((_, index) => `[${index}:v]scale=270:480[s${index}]`).join(";")};${frames.map((_, index) => `[s${index}]`).join("")}` +
    `xstack=inputs=${frames.length}:layout=${frames.map((_, index) => `${(index % 6) * 270}_${Math.floor(index / 6) * 480}`).join("|")}:fill=black`,
    "-frames:v", "1", sheetPath]);

  const media = verifyRenderedMedia(videoPath);
  const report = {
    label: "DRAFT PROOF OF CONCEPT. Figures are SpecSmith model estimates computed at render time. Placeholder voice. Not reviewed, not approved, not for publication.",
    video: { path: videoPath, sha256: media.sha256, bytes: media.bytes, durationSeconds: await duration(videoPath) },
    facts: { pairing: facts.pairing, buildA: facts.buildA, buildB: facts.buildB, tally: facts.tally, averageA: facts.averageA, averageB: facts.averageB,
      leadRangeA: facts.leadRangeA, leadRangeB: facts.leadRangeB, decisiveLeadsB: decisiveLeadsB(facts).map((game) => ({ game: game.game, fpsA: game.fpsA, fpsB: game.fpsB })) },
    scenes, audio, placeholderAudio: PLACEHOLDER_AUDIO,
    master1StoryboardReview: { recommendedFixes: review.recommendedFixes, notAssessed: review.overall.filter((score) => score.provenance === "not-assessed").map((score) => score.dimension) },
    ctaCapture: { path: capturePath, metadata: capture.metadata },
    inspectionFrames: frames, inspectionSheet: sheetPath,
  };
  await writeFile(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();
if (isMain) {
  renderLeadsVsAverage().then((report) => {
    console.log(report.label);
    console.log(`video: ${report.video.path} (${report.video.durationSeconds.toFixed(2)}s)`);
    console.log(`sha256: ${report.video.sha256}`);
    console.log(`tally: ${JSON.stringify(report.facts.tally)} averages ${report.facts.averageA} vs ${report.facts.averageB}`);
    for (const clip of report.audio) console.log(`  voice ${clip.scene}: ${clip.startSecond}s + ${clip.seconds}s`);
    console.log(`#1 storyboard review fixes: ${report.master1StoryboardReview.recommendedFixes.length}`);
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
