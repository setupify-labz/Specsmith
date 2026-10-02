// Render the RAM-fit pilot Short (draft) offline.
//
//   SPECSMITH_RENDER_BASE_URL=http://localhost:5178 pnpm exec tsx scripts/content-automator/pilotRamFit/render.ts
//
// One standalone video, not a pipeline. The frames are drawn by
// scene.browser.js on a 1080x1920 canvas in Chromium, deterministic in time.
// The only screenshot is the Builder's own warning card, cropped to that card,
// captured from the built app at the exact parts the video names; its text is
// read back and must equal checkCompatibility()'s verdict or the render stops.
//
// The voice is espeak-ng, a robotic TEMPORARY placeholder (respelled so it
// says "DDR" as a word, and lightly EQ'd and compressed), and the effects and
// the ducked beat bed are synthesised by ffmpeg. Type is Inter (SIL Open Font
// License, SpecSmith's own UI font), fetched once from Google Fonts and pinned
// by SHA-256; without it the render falls back to DejaVu Sans and says so.
// No paid service, no credential, no publishing.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { launchBrowser } from "../uiRender/capture.ts";
import { CAPTION_LINE_MAX_CHARS, wrapCaptionForRender } from "../captionRender.ts";
import { reviewCreativeQuality } from "../v2/creativeQualityReview.ts";
import { verifyRenderedMedia } from "../v2/mediaVerification.ts";
import { audioLevels, blackIntervals, decodeErrors, freezeIntervals, probe, type MediaTools } from "../v2/review/mediaInspection.ts";
import { builderRoute, ramFitFacts, type RamFitFacts } from "./facts.ts";
import { reviewVisualHonesty } from "../v2/creative/visualHonesty.ts";
import { captionTimings, DECLARED_VISUALS, pilotScenes, pilotStoryboard, type PilotScene } from "./storyboard.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const appRoot = resolve(here, "../../..");
const FPS = 30;
const TEMP_AUDIO = "TEMPORARY SOUND: espeak-ng placeholder voice plus ffmpeg-synthesised effects and bed. Draft for internal review; not approved, not for publication.";
const TOOLS: MediaTools = { ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" };

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
const squash = (value: string) => value.replace(/\s+/g, " ").trim();

/** Inter, the SpecSmith UI font (SIL OFL 1.1), from Google Fonts' latin subset; cached and hashed. */
const INTER_URL = "https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2";
async function loadInter(): Promise<{ family: string; dataUrl: string | null; sha256: string | null; source: string }> {
  const cache = resolve(appRoot, "render-output/.font-cache/inter-latin-v20.woff2");
  let bytes: Buffer | null = null;
  try { bytes = await readFile(cache); } catch { /* not cached yet */ }
  if (!bytes) {
    try {
      const response = await fetch(INTER_URL);
      if (response.ok) {
        bytes = Buffer.from(await response.arrayBuffer());
        await mkdir(resolve(cache, ".."), { recursive: true });
        await writeFile(cache, bytes);
      }
    } catch { /* offline: fall back below */ }
  }
  if (!bytes) return { family: '"DejaVu Sans", sans-serif', dataUrl: null, sha256: null, source: "DejaVu Sans fallback (Inter unavailable)" };
  return { family: '"Inter", "DejaVu Sans", sans-serif', dataUrl: `data:font/woff2;base64,${bytes.toString("base64")}`, sha256: createHash("sha256").update(bytes).digest("hex"), source: INTER_URL };
}

/** The temporary voice says "DDR" as letters with long gaps; respell it so the pacing is closer to a person's. */
const forTempVoice = (line: string) => line.replace(/DDR(\d)/g, (_, digit: string) => `dee dee ar ${["zero", "one", "two", "three", "four", "five"][Number(digit)]}`).replace(/SpecSmith/g, "Spec Smith");

/** The Builder's warning card for the mismatched build, cropped to the card, at phone width. */
async function captureWarningCard(facts: RamFitFacts, baseUrl: string, outDir: string) {
  const route = builderRoute();
  const session = await launchBrowser({ width: 390, height: 844, deviceScaleFactor: 3 });
  try {
    const page = await session.context.newPage();
    await page.goto(new URL(route, baseUrl).toString(), { waitUntil: "networkidle" });
    const cardLocator = page.locator("div.p-3.rounded-lg", { hasText: facts.mismatch.title }).first();
    await cardLocator.waitFor({ state: "visible", timeout: 20_000 });
    await cardLocator.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const shown = squash(await cardLocator.innerText());
    const expected = [facts.mismatch.title, facts.mismatch.detail, `Fix: ${facts.mismatch.fix}`].map(squash);
    const missing = expected.filter((line) => !shown.includes(line));
    if (missing.length) throw new Error(`The Builder's card does not show the checker's verdict; refusing to use it. Missing: ${JSON.stringify(missing)}. Shown: ${shown}`);
    // Where the card's own words "is DDR4" and "only takes DDR5" sit, so the
    // video can highlight them without redrawing or retyping anything.
    const phrases = [`is ${facts.oldRam.type}`, `only takes ${facts.ddr5Board.supported_ram[0]}`];
    if (phrases.some((phrase) => !facts.mismatch.detail.includes(phrase))) throw new Error("The verdict no longer contains the phrases the video highlights.");
    const marks = await cardLocator.evaluate((element, wanted: string[]) => {
      const box = element.getBoundingClientRect();
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const found: { phrase: string; x: number; y: number; w: number; h: number }[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const content = node.textContent ?? "";
        for (const phrase of wanted) {
          const index = content.indexOf(phrase);
          if (index < 0 || found.some((entry) => entry.phrase === phrase)) continue;
          const range = document.createRange();
          range.setStart(node, index); range.setEnd(node, index + phrase.length);
          const rect = range.getClientRects()[0];
          if (rect) found.push({ phrase, x: (rect.left - box.left) / box.width, y: (rect.top - box.top) / box.height, w: rect.width / box.width, h: rect.height / box.height });
        }
      }
      return found;
    }, phrases);
    if (marks.length !== phrases.length) throw new Error(`Could not locate ${JSON.stringify(phrases)} on the Builder card.`);
    const path = join(outDir, "builder-warning-card.png");
    await cardLocator.screenshot({ path });
    return { path, route, url: new URL(route, baseUrl).toString(), shownText: shown, marks, viewport: "390x844 CSS px at 3x (phone width)" };
  } finally {
    await session.close();
  }
}

/** Temporary sound effects and a quiet bed, all synthesised; no third-party audio. */
async function soundDesign(outDir: string, scenes: PilotScene[], total: number) {
  const at = (id: PilotScene["id"]) => scenes.find((scene) => scene.id === id)!.startSecond;
  const jam = at("stop"), seat = at("boards") + 2.55;
  // Calm on purpose: soft whooshes under camera moves, one thud, one click.
  const effects: { name: string; startSecond: number; expr: string; seconds: number }[] = [
    { name: "push", startSecond: 0, seconds: 0.5, expr: "(random(5)*2-1)*0.10*sin(PI*t/0.5)" },
    { name: "thud", startSecond: jam, seconds: 0.45, expr: "0.9*sin(2*PI*58*t)*exp(-9*t)+(random(1)*2-1)*0.35*exp(-32*t)" },
    { name: "whoosh-push-in", startSecond: at("notch"), seconds: 1.0, expr: "(random(2)*2-1)*0.12*sin(PI*t/1.0)" },
    { name: "whoosh-pull-back", startSecond: at("boards"), seconds: 1.1, expr: "(random(3)*2-1)*0.12*sin(PI*t/1.1)" },
    { name: "click-1", startSecond: seat, seconds: 0.06, expr: "0.7*sin(2*PI*2400*t)*exp(-120*t)" },
    { name: "click-2", startSecond: seat + 0.07, seconds: 0.06, expr: "0.7*sin(2*PI*2200*t)*exp(-120*t)" },
    { name: "success", startSecond: seat + 0.15, seconds: 0.7, expr: "0.2*(sin(2*PI*880*t)*lt(t,0.18)+sin(2*PI*1320*t)*gte(t,0.15))*exp(-4*t)" },
    { name: "whoosh-ending", startSecond: at("catch") + 0.25, seconds: 0.8, expr: "(random(4)*2-1)*0.10*sin(PI*t/0.8)" },
    { name: "marker-1", startSecond: at("catch") + 1.3, seconds: 0.35, expr: "(random(8)*2-1)*0.05*sin(PI*t/0.35)" },
    { name: "cta-chime", startSecond: at("cta") + 0.2, seconds: 0.9, expr: "0.14*(sin(2*PI*659*t)+0.6*sin(2*PI*988*t))*exp(-3.5*t)" },
  ];
  const paths: string[] = [];
  for (const effect of effects) {
    const path = join(outDir, `sfx-${effect.name}.wav`);
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `aevalsrc='${effect.expr}':s=48000:d=${effect.seconds}`, "-ac", "2", path]);
    paths.push(path);
  }
  // Bed: a soft pad from the first frame, and a light beat (kick + hat, 100 bpm) that enters on the jam.
  const beatIn = at("stop");
  const padPath = join(outDir, "bed-pad.wav"), kickPath = join(outDir, "bed-kick.wav"), hatPath = join(outDir, "bed-hat.wav");
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i",
    `aevalsrc='0.05*(sin(2*PI*110*t)+0.7*sin(2*PI*164.81*t)+0.5*sin(2*PI*220*t)*lt(mod(t,4.8),2.4)+0.5*sin(2*PI*196*t)*gte(mod(t,4.8),2.4))*(0.7+0.3*sin(2*PI*0.83*t))':s=48000:d=${total}`,
    "-af", `lowpass=f=1800,afade=t=in:d=0.3,afade=t=out:st=${total - 1.2}:d=1.2`, "-ac", "2", padPath]);
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i",
    `aevalsrc='gte(t,${beatIn})*0.55*sin(2*PI*(48+110*exp(-28*mod(t-${beatIn},0.6)))*mod(t-${beatIn},0.6))*exp(-9*mod(t-${beatIn},0.6))':s=48000:d=${total}`,
    "-af", `afade=t=out:st=${total - 1.2}:d=1.2`, "-ac", "2", kickPath]);
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i",
    `aevalsrc='gte(t,${beatIn + 0.3})*(random(7)*2-1)*0.22*exp(-55*mod(t-${beatIn}-0.3,0.6))':s=48000:d=${total}`,
    "-af", `highpass=f=6000,afade=t=out:st=${total - 1.2}:d=1.2`, "-ac", "2", hatPath]);
  const bedPath = join(outDir, "bed.wav");
  await run("ffmpeg", ["-v", "error", "-y", "-i", padPath, "-i", kickPath, "-i", hatPath, "-filter_complex",
    "[0:a][1:a][2:a]amix=inputs=3:normalize=0[out]", "-map", "[out]", bedPath]);
  return { effects: effects.map(({ name, startSecond, seconds }, index) => ({ name, startSecond: Number(startSecond.toFixed(2)), seconds, path: paths[index] })), bedPath };
}

export async function renderRamFitPilot(outputDir = resolve(appRoot, "render-output/pilot-ram-fit")) {
  const facts = ramFitFacts();
  const scenes = pilotScenes(facts);
  const storyboard = pilotStoryboard(facts);
  const total = scenes.at(-1)!.endSecond;

  await rm(outputDir, { recursive: true, force: true });
  const framesDir = join(outputDir, "frames");
  await mkdir(framesDir, { recursive: true });

  const card = await captureWarningCard(facts, process.env.SPECSMITH_RENDER_BASE_URL ?? "http://localhost:5178", outputDir);

  // Temporary voice: one clip per scene, starting with its scene.
  const voice: { scene: string; startSecond: number; seconds: number; fitsScene: boolean; path: string }[] = [];
  for (const scene of scenes) {
    const path = join(outputDir, `voice-${scene.id}.wav`);
    const raw = join(outputDir, `voice-${scene.id}-raw.wav`);
    await run("espeak-ng", ["-v", "en-us", "-s", "180", "-p", "42", "-w", raw, forTempVoice(scene.narration)]);
    // Take the edge off: low cut, a little presence, gentle compression, a short room.
    await run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-af",
      "highpass=f=90,lowpass=f=9000,equalizer=f=2800:t=q:w=1.2:g=3,acompressor=threshold=-20dB:ratio=3:attack=5:release=90,aecho=0.85:0.5:38|61:0.10|0.06",
      "-ar", "48000", "-ac", "2", path]);
    const seconds = await duration(path);
    const startSecond = scene.startSecond + 0.05;
    voice.push({ scene: scene.id, startSecond, seconds: Number(seconds.toFixed(2)), fitsScene: startSecond + seconds <= scene.endSecond + 0.05, path });
  }
  if (voice.some((clip) => !clip.fitsScene)) {
    throw new Error(`Voice overruns its scene: ${JSON.stringify(voice.filter((clip) => !clip.fitsScene).map(({ scene, startSecond, seconds }) => ({ scene, startSecond, seconds })))}.`);
  }
  // Wrapped by the same rule MASTER #1's review measures, and drawn line for line.
  const captions = scenes.flatMap((scene, index) => captionTimings(scene, voice[index].startSecond, voice[index].seconds))
    .map((cue) => ({ ...cue, lines: wrapCaptionForRender(cue.text, CAPTION_LINE_MAX_CHARS).split("\\N") }));
  // MASTER #1's storyboard review, on the cues actually burned in.
  const review = reviewCreativeQuality({
    creativeId: "pilot-ram-fit", packageId: "pilot-ram-fit", storyboard, ctaRoute: "/builder", mediaSha256: null, now: new Date(0),
    captionCues: captions.map((cue) => ({ startSecond: cue.start, endSecond: cue.end, text: cue.text })),
  });

  // Frames.
  const inter = await loadInter();
  const catchScene = scenes.find((scene) => scene.id === "catch")!;
  const catchVoice = voice.find((clip) => clip.scene === "catch")!;
  const data = {
    fontFamily: inter.family,
    // Highlights land as the voice reaches "wrong board" and "flags it".
    cardMarks: card.marks.map((mark, index) => ({ ...mark, color: index === 0 ? "amber" : "cyan",
      at: Number((catchVoice.startSecond - catchScene.startSecond + catchVoice.seconds * (index === 0 ? 0.35 : 0.62)).toFixed(2)) })),
    scenes: Object.fromEntries(scenes.map((scene) => [scene.id, { start: scene.startSecond, end: scene.endSecond }])),
    captions,
    logoDataUrl: `data:image/png;base64,${(await readFile(resolve(appRoot, "public/favicon-512.png"))).toString("base64")}`,
    cardDataUrl: `data:image/png;base64,${(await readFile(card.path)).toString("base64")}`,
  };
  const sceneScript = await readFile(join(here, "scene.browser.js"), "utf8");
  const session = await launchBrowser({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  try {
    const page = await session.context.newPage();
    const fontFace = inter.dataUrl ? `<style>@font-face{font-family:"Inter";src:url(${inter.dataUrl}) format("woff2");font-weight:100 900;}</style>` : "";
    await page.setContent(`<!doctype html><html><head>${fontFace}</head><body style="margin:0;background:#08080D"><canvas id="c" width="1080" height="1920"></canvas><script>const DATA = ${JSON.stringify(data)};\n${sceneScript}</script></body></html>`);
    await page.evaluate("window.assetsReady");
    if (inter.dataUrl) await page.evaluate("Promise.all(['500 40px Inter','800 40px Inter','900 40px Inter'].map((f) => document.fonts.load(f)))");
    await page.evaluate("document.fonts.ready");
    const count = Math.round(total * FPS);
    for (let index = 0; index < count; index += 1) {
      const url = await page.evaluate(`window.renderAt(${(index / FPS).toFixed(4)})`) as string;
      await writeFile(join(framesDir, `frame-${String(index).padStart(4, "0")}.jpg`), Buffer.from(url.split(",")[1], "base64"));
    }
  } finally {
    await session.close();
  }

  // Mix: the voice on top; effects and the bed duck under it.
  const sound = await soundDesign(outputDir, scenes, total);
  const place = (inputs: { path: string; at: number; gain: number }[], out: string) => run("ffmpeg", ["-v", "error", "-y", ...inputs.flatMap((input) => ["-i", input.path]), "-filter_complex",
    `${inputs.map((input, index) => `[${index}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${input.gain},adelay=${Math.round(input.at * 1000)}:all=1[a${index}]`).join(";")};` +
    `${inputs.map((_, index) => `[a${index}]`).join("")}amix=inputs=${inputs.length}:normalize=0,apad=whole_dur=${total}[out]`,
    "-map", "[out]", "-t", String(total), out]);
  const voicePath = join(outputDir, "voice.wav"), musicPath = join(outputDir, "music.wav"), mixPath = join(outputDir, "mix.wav");
  await place(voice.map((clip) => ({ path: clip.path, at: clip.startSecond, gain: 1.5 })), voicePath);
  await place([...sound.effects.map((effect) => ({ path: effect.path, at: effect.startSecond, gain: 0.9 })), { path: sound.bedPath, at: 0, gain: 0.9 }], musicPath);
  await run("ffmpeg", ["-v", "error", "-y", "-i", voicePath, "-i", musicPath, "-filter_complex",
    "[0:a]asplit=2[v][key];[1:a][key]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=250[ducked];[v][ducked]amix=inputs=2:normalize=0,alimiter=limit=0.89[out]",
    "-map", "[out]", "-t", String(total), mixPath]);

  const videoPath = join(outputDir, "pilot-ram-fit-draft.mp4");
  await run("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", join(framesDir, "frame-%04d.jpg"), "-i", mixPath,
    "-t", String(total), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
    "-metadata", `comment=${TEMP_AUDIO}`, "-metadata", "title=DRAFT pilot: Can you reuse your old DDR4 RAM?", videoPath]);
  await rm(framesDir, { recursive: true, force: true });

  // Inspection: key moments at full size, and a sheet at phone size (360x640 each).
  const inspectDir = join(outputDir, "inspection");
  await mkdir(inspectDir, { recursive: true });
  const sceneAt = (id: PilotScene["id"], offset: number) => scenes.find((scene) => scene.id === id)!.startSecond + offset;
  const moments = [{ label: "00-first-frame", at: 0 }, { label: "01-approach", at: sceneAt("approach", 1.2) }, { label: "02-stopped", at: sceneAt("stop", 1.4) },
    { label: "03-notch", at: sceneAt("notch", 2.4) }, { label: "04-boards", at: sceneAt("boards", 1.3) }, { label: "05-seated", at: sceneAt("boards", 3.4) },
    { label: "06-builder-catch", at: sceneAt("catch", 2.6) }, { label: "07-cta", at: sceneAt("cta", 1.2) }, { label: "08-final", at: total - 0.05 }];
  const frames: string[] = [];
  for (const moment of moments) {
    const path = join(inspectDir, `${moment.label}.png`);
    await run("ffmpeg", ["-v", "error", "-y", "-ss", moment.at.toFixed(3), "-i", videoPath, "-frames:v", "1", path]);
    frames.push(path);
  }
  const sheetPath = join(outputDir, "phone-size-sheet.png");
  await run("ffmpeg", ["-v", "error", "-y", ...frames.flatMap((path) => ["-i", path]), "-filter_complex",
    `${frames.map((_, index) => `[${index}:v]scale=360:640:flags=area[s${index}]`).join(";")};${frames.map((_, index) => `[s${index}]`).join("")}` +
    `xstack=inputs=${frames.length}:layout=${frames.map((_, index) => `${(index % 3) * 360}_${Math.floor(index / 3) * 640}`).join("|")}:fill=black`,
    "-frames:v", "1", sheetPath]);

  // The existing render checks, on the bytes.
  const media = verifyRenderedMedia(videoPath);
  const probed = await probe(TOOLS, videoPath);
  const checks = {
    probe: probed,
    decodeErrors: await decodeErrors(TOOLS, videoPath),
    black: await blackIntervals(TOOLS, videoPath, probed.durationSeconds),
    frozen: await freezeIntervals(TOOLS, videoPath, probed.durationSeconds),
    audio: await audioLevels(TOOLS, videoPath),
  };

  const report = {
    label: "DRAFT PILOT. Compatibility facts read from the SpecSmith catalog and Builder checker at render time. Temporary sound. Not reviewed, not approved, not for publication.",
    video: { path: videoPath, sha256: media.sha256, bytes: media.bytes, durationSeconds: probed.durationSeconds },
    facts: {
      cpu: { id: facts.cpu.id, name: facts.cpu.name, socket: facts.cpu.socket, supported_ram: facts.cpu.supported_ram },
      ddr4Board: facts.ddr4Board, ddr5Board: facts.ddr5Board, oldRam: facts.oldRam,
      builderVerdict: facts.mismatch, cleanBuildPassed: facts.matchPassed, lga1700Boards: facts.lga1700Boards,
    },
    builderCard: { route: card.route, viewport: card.viewport, shownText: card.shownText, highlightedPhrases: card.marks.map((mark) => mark.phrase) },
    font: { family: inter.family, source: inter.source, sha256: inter.sha256, license: inter.sha256 ? "SIL Open Font License 1.1" : null },
    scenes, captions, voice: voice.map(({ path: _path, ...clip }) => clip), effects: sound.effects.map(({ path: _path, ...effect }) => effect),
    temporarySound: TEMP_AUDIO,
    master1StoryboardReview: { recommendedFixes: review.recommendedFixes, notAssessed: review.overall.filter((score) => score.provenance === "not-assessed").map((score) => score.dimension) },
    visualHonesty: reviewVisualHonesty(DECLARED_VISUALS),
    renderChecks: checks,
    inspectionFrames: frames, phoneSizeSheet: sheetPath,
  };
  await writeFile(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();
if (isMain) {
  renderRamFitPilot().then((report) => {
    console.log(report.label);
    console.log(`video: ${report.video.path} (${report.video.durationSeconds.toFixed(2)}s) sha256 ${report.video.sha256}`);
    for (const clip of report.voice) console.log(`  voice ${clip.scene}: ${clip.startSecond}s + ${clip.seconds}s`);
    console.log(`#1 storyboard review fixes: ${report.master1StoryboardReview.recommendedFixes.length}`);
    console.log(`render checks: ${JSON.stringify({ decode: report.renderChecks.decodeErrors.length, black: report.renderChecks.black, frozen: report.renderChecks.frozen, audio: report.renderChecks.audio })}`);
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
