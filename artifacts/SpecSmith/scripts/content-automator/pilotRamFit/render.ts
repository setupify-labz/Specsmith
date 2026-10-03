// Render the RAM-fit pilot Short.
//
//   FINAL (the only path to a release candidate):
//     pnpm exec tsx scripts/content-automator/pilotRamFit/render.ts --liam-take <take dir>
//   DRAFT (labelled, never for release):
//     pnpm exec tsx scripts/content-automator/pilotRamFit/render.ts --temp-voice
//
// Needs the built app served at SPECSMITH_RENDER_BASE_URL (default
// http://localhost:5178) for the Builder warning capture.
//
// One standalone video, not a pipeline. The picture is locked (scene.browser.js);
// a final render times the cut, its three beats and its captions to the
// approved Liam take (takeTiming.ts) and refuses any other voice. The only
// screenshot is the Builder's own warning card, captured at the exact parts the
// video names; its text is read back and must equal checkCompatibility()'s
// verdict or the render stops. Effects and the bed are synthesised by ffmpeg.
// Type is Inter (SIL Open Font License), fetched once and pinned by SHA-256.
// No credential, no paid call, no publishing: this file only reads a take.

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
import { loadRamFitTake, planFromTake } from "./takeTiming.ts";

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
    const path = join(outDir, "builder-warning-card.png");
    await cardLocator.screenshot({ path });
    return { path, route, url: new URL(route, baseUrl).toString(), shownText: shown, viewport: "390x844 CSS px at 3x (phone width)" };
  } finally {
    await session.close();
  }
}

/** Synthesised effects and a quiet bed; no third-party audio. Hits are kept apart from the bed so the bed can duck under speech without swallowing them. */
async function soundDesign(outDir: string, scenes: PilotScene[], total: number, events: { jam: number; fix1: number; fix2: number }, proofAt: number) {
  const at = (id: PilotScene["id"]) => scenes.find((scene) => scene.id === id)!.startSecond;
  const { jam, fix1, fix2 } = events;
  type Effect = { name: string; startSecond: number; expr: string; seconds: number; bus: "hits" | "bed" };
  const effects: Effect[] = [
    { name: "push", bus: "bed", startSecond: 0, seconds: 0.45, expr: "(random(5)*2-1)*0.12*sin(PI*t/0.45)" },
    { name: "thud", bus: "hits", startSecond: jam, seconds: 0.45, expr: "0.95*sin(2*PI*55*t)*exp(-9*t)+(random(1)*2-1)*0.4*exp(-30*t)" },
    { name: "whoosh-push-in", bus: "bed", startSecond: at("notch"), seconds: 0.6, expr: "(random(2)*2-1)*0.12*sin(PI*t/0.6)" },
    { name: "whoosh-pull-back", bus: "bed", startSecond: at("choice"), seconds: 0.8, expr: "(random(3)*2-1)*0.12*sin(PI*t/0.8)" },
    ...[fix1, fix2].flatMap((seat, index): Effect[] => [
      { name: `click-${index}-a`, bus: "hits", startSecond: seat, seconds: 0.06, expr: "0.7*sin(2*PI*2400*t)*exp(-120*t)" },
      { name: `click-${index}-b`, bus: "hits", startSecond: seat + 0.07, seconds: 0.06, expr: "0.7*sin(2*PI*2200*t)*exp(-120*t)" },
      { name: `ding-${index}`, bus: "hits", startSecond: seat + 0.12, seconds: 0.6, expr: `0.18*sin(2*PI*${index ? 1320 : 988}*t)*exp(-5*t)` },
    ]),
    { name: "whoosh-payoff", bus: "bed", startSecond: at("payoff"), seconds: 0.6, expr: "(random(4)*2-1)*0.12*sin(PI*t/0.6)" },
    { name: "proof", bus: "bed", startSecond: at("payoff") + proofAt, seconds: 0.5, expr: "(random(8)*2-1)*0.08*sin(PI*t/0.5)" },
    { name: "cta-chime", bus: "hits", startSecond: at("cta") + 0.15, seconds: 0.9, expr: "0.14*(sin(2*PI*659*t)+0.6*sin(2*PI*988*t))*exp(-3.5*t)" },
  ];
  const paths: string[] = [];
  for (const effect of effects) {
    const path = join(outDir, `sfx-${effect.name}.wav`);
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `aevalsrc='${effect.expr}':s=48000:d=${effect.seconds}`, "-ac", "2", path]);
    paths.push(path);
  }
  // Bed: a soft pad from the first frame, and a light beat (kick + hat, 100 bpm) that enters on the jam.
  const beatIn = jam;
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
  return { effects: effects.map(({ name, startSecond, seconds, bus }, index) => ({ name, bus, startSecond: Number(startSecond.toFixed(2)), seconds, path: paths[index] })), bedPath };
}

/** Peak and mean level of one stretch of a file, in dB. */
async function levelsBetween(path: string, start: number, seconds: number): Promise<{ maxDb: number; meanDb: number }> {
  const out = await new Promise<string>((resolvePromise, reject) => {
    const child = spawn("ffmpeg", ["-v", "info", "-ss", start.toFixed(3), "-t", seconds.toFixed(3), "-i", path, "-af", "volumedetect", "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (chunk: Buffer) => { err += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", () => resolvePromise(err));
  });
  const read = (key: string) => { const match = new RegExp(`${key}:\\s*(-?[\\d.]+|-inf) dB`).exec(out)?.[1]; return match === undefined || match === "-inf" ? -Infinity : Number(match); };
  return { maxDb: read("max_volume"), meanDb: read("mean_volume") };
}

/** Integrated loudness and true peak of the finished mix (EBU R128). */
async function loudness(path: string): Promise<{ integratedLufs: number; truePeakDbtp: number; rangeLu: number }> {
  const out = await new Promise<string>((resolvePromise, reject) => {
    const child = spawn("ffmpeg", ["-v", "info", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (chunk: Buffer) => { err += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", () => resolvePromise(err));
  });
  const summary = out.slice(out.lastIndexOf("Summary:"));
  const num = (pattern: RegExp) => Number(pattern.exec(summary)?.[1] ?? NaN);
  return { integratedLufs: num(/I:\s*(-?[\d.]+) LUFS/), truePeakDbtp: num(/Peak:\s*(-?[\d.]+) dBFS/), rangeLu: num(/LRA:\s*(-?[\d.]+) LU/) };
}

export type RenderMode = { readonly mode: "final"; readonly takeDir: string } | { readonly mode: "draft" };

export async function renderRamFitPilot(options: RenderMode, outputDir = resolve(appRoot, options.mode === "final" ? "render-output/pilot-ram-fit-final" : "render-output/pilot-ram-fit")) {
  const facts = ramFitFacts();
  // FINAL: the locked cut timed to the approved Liam take, or nothing. There is no fallback voice.
  const take = options.mode === "final" ? await loadRamFitTake(options.takeDir) : null;
  const plan = take ? planFromTake(take, pilotScenes(facts)) : null;
  const scenes = plan ? plan.scenes : pilotScenes(facts);
  const storyboard = pilotStoryboard(facts, scenes);
  const total = scenes.at(-1)!.endSecond;
  const events = plan ? plan.events : { jam: scenes[0].startSecond + 0.5, fix1: scenes[2].startSecond + 1.25, fix2: scenes[2].startSecond + 2.25 };
  const proofAt = plan ? plan.proofAt : 1.45;

  await rm(outputDir, { recursive: true, force: true });
  const framesDir = join(outputDir, "frames");
  await mkdir(framesDir, { recursive: true });

  const card = await captureWarningCard(facts, process.env.SPECSMITH_RENDER_BASE_URL ?? "http://localhost:5178", outputDir);

  const voice: { scene: string; startSecond: number; seconds: number; path: string; source: string }[] = [];
  let cues: { text: string; start: number; end: number }[];
  if (take && plan) {
    // Each line cut from the take at its own timestamps and placed at its shot.
    const lines = plan.voice;
    for (const [index, line] of lines.entries()) {
      const next = lines[index + 1];
      const from = Math.max(0, line.takeStart - 0.03);
      const to = next ? Math.min(line.takeEnd + 0.15, next.takeStart - 0.01) : line.takeEnd + 0.25;
      const path = join(outputDir, `voice-${line.id}.wav`);
      await run("ffmpeg", ["-v", "error", "-y", "-ss", from.toFixed(3), "-to", to.toFixed(3), "-i", take.audioPath,
        "-af", `afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, to - from - 0.03).toFixed(3)}:d=0.03`, "-ar", "48000", "-ac", "2", path]);
      voice.push({ scene: line.id, startSecond: Number((line.at - (line.takeStart - from)).toFixed(3)), seconds: Number((to - from).toFixed(3)), path, source: `Liam take ${from.toFixed(3)}-${to.toFixed(3)} s` });
    }
    cues = [...plan.captions];
  } else {
    // DRAFT ONLY: the espeak placeholder, labelled on screen and in the file.
    for (const scene of scenes) {
      const path = join(outputDir, `voice-${scene.id}.wav`);
      const raw = join(outputDir, `voice-${scene.id}-raw.wav`);
      await run("espeak-ng", ["-v", "en-us", "-s", "200", "-p", "42", "-w", raw, forTempVoice(scene.narration)]);
      await run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-af",
        "highpass=f=90,lowpass=f=9000,equalizer=f=2800:t=q:w=1.2:g=3,acompressor=threshold=-20dB:ratio=3:attack=5:release=90,aecho=0.85:0.5:38|61:0.10|0.06",
        "-ar", "48000", "-ac", "2", path]);
      voice.push({ scene: scene.id, startSecond: scene.startSecond + 0.05, seconds: Number((await duration(path)).toFixed(2)), path, source: "espeak-ng placeholder" });
    }
    const over = voice.filter((clip, index) => clip.startSecond + clip.seconds > scenes[index].endSecond + 0.05);
    if (over.length) throw new Error(`Voice overruns its scene: ${JSON.stringify(over.map(({ scene, startSecond, seconds }) => ({ scene, startSecond, seconds })))}.`);
    cues = scenes.flatMap((scene, index) => captionTimings(scene, voice[index].startSecond, voice[index].seconds));
  }
  // Wrapped by the same rule MASTER #1's review measures, and drawn line for line.
  const captions = cues.map((cue) => ({ ...cue, lines: wrapCaptionForRender(cue.text, CAPTION_LINE_MAX_CHARS).split("\\N") }));
  const review = reviewCreativeQuality({
    creativeId: "pilot-ram-fit", packageId: "pilot-ram-fit", storyboard, ctaRoute: "/builder", mediaSha256: null, now: new Date(0),
    captionCues: captions.map((cue) => ({ startSecond: cue.start, endSecond: cue.end, text: cue.text })),
  });

  // Frames.
  const inter = await loadInter();
  const data = {
    fontFamily: inter.family,
    scenes: Object.fromEntries(scenes.map((scene) => [scene.id, { start: scene.startSecond, end: scene.endSecond }])),
    captions,
    events,
    proofAt,
    draftTag: take ? null : "DRAFT · temp voice",
    logoDataUrl: `data:image/png;base64,${(await readFile(resolve(appRoot, "public/favicon-512.png"))).toString("base64")}`,
    cardDataUrl: `data:image/png;base64,${(await readFile(card.path)).toString("base64")}`,
  };
  const sceneScript = await readFile(join(here, "scene.browser.js"), "utf8");
  const session = await launchBrowser({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  try {
    const page = await session.context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const fontFace = inter.dataUrl ? `<style>@font-face{font-family:"Inter";src:url(${inter.dataUrl}) format("woff2");font-weight:100 900;}</style>` : "";
    await page.setContent(`<!doctype html><html><head>${fontFace}</head><body style="margin:0;background:#08080D"><canvas id="c" width="1080" height="1920"></canvas><script>const DATA = ${JSON.stringify(data)};\n${sceneScript}</script></body></html>`);
    if (pageErrors.length) throw new Error(`The scene script failed in the page: ${pageErrors.join("; ")}`);
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

  // Mix: voice on top; the bed ducks under it; hits (the jam, the seats) stay clear of the ducking.
  const sound = await soundDesign(outputDir, scenes, total, events, proofAt);
  const place = (inputs: { path: string; at: number; gain: number }[], out: string) => run("ffmpeg", ["-v", "error", "-y", ...inputs.flatMap((input) => ["-i", input.path]), "-filter_complex",
    `${inputs.map((input, index) => `[${index}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${input.gain},adelay=${Math.max(0, Math.round(input.at * 1000))}:all=1[a${index}]`).join(";")};` +
    `${inputs.map((_, index) => `[a${index}]`).join("")}amix=inputs=${inputs.length}:normalize=0,apad=whole_dur=${total}[out]`,
    "-map", "[out]", "-t", String(total), out]);
  const voicePath = join(outputDir, "voice.wav"), bedBusPath = join(outputDir, "bed-bus.wav"), hitsPath = join(outputDir, "hits.wav");
  const rawMixPath = join(outputDir, "mix-raw.wav"), mixPath = join(outputDir, "mix.wav");
  await place(voice.map((clip) => ({ path: clip.path, at: clip.startSecond, gain: take ? 1.0 : 1.5 })), voicePath);
  await place([...sound.effects.filter((effect) => effect.bus === "bed").map((effect) => ({ path: effect.path, at: effect.startSecond, gain: 0.9 })), { path: sound.bedPath, at: 0, gain: 0.9 }], bedBusPath);
  // The jam thud sits a set distance under the narrator's own peak on line 1:
  // clearly heard, never louder than the words. Derived from the take, not guessed.
  const THUD_UNDER_VOICE_DB = 6;
  const line1Peak = (await levelsBetween(voice[0].path, 0, voice[0].seconds)).maxDb;
  const thudPeak = (await levelsBetween(sound.effects.find((effect) => effect.name === "thud")!.path, 0, 1)).maxDb;
  const hitsGain = Number.isFinite(line1Peak) && Number.isFinite(thudPeak)
    ? Number((10 ** ((line1Peak - THUD_UNDER_VOICE_DB - thudPeak) / 20)).toFixed(4))
    : 0.5;
  await place(sound.effects.filter((effect) => effect.bus === "hits").map((effect) => ({ path: effect.path, at: effect.startSecond, gain: hitsGain })), hitsPath);
  await run("ffmpeg", ["-v", "error", "-y", "-i", voicePath, "-i", bedBusPath, "-i", hitsPath, "-filter_complex",
    "[0:a]asplit=2[v][key];[1:a][key]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=250[ducked];[v][ducked][2:a]amix=inputs=3:normalize=0[out]",
    "-map", "[out]", "-t", String(total), rawMixPath]);
  // Shorts-style loudness, two passes so the gain is linear rather than pumping.
  const measure = await new Promise<string>((resolvePromise, reject) => {
    const child = spawn("ffmpeg", ["-v", "info", "-i", rawMixPath, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (chunk: Buffer) => { err += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", () => resolvePromise(err));
  });
  const m = JSON.parse(measure.slice(measure.lastIndexOf("{"), measure.lastIndexOf("}") + 1)) as Record<string, string>;
  await run("ffmpeg", ["-v", "error", "-y", "-i", rawMixPath, "-af",
    `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
    "-ar", "48000", "-ac", "2", mixPath]);

  const fileName = take ? "specsmith-ram-fit-final.mp4" : "pilot-ram-fit-draft.mp4";
  const videoPath = join(outputDir, fileName);
  const comment = take
    ? `Narration: ElevenLabs Liam (voice ${take.voiceId}), take sha256 ${take.audioSha256}. Effects and bed synthesised; no third-party audio.`
    : TEMP_AUDIO;
  await run("ffmpeg", ["-v", "error", "-y", "-framerate", String(FPS), "-i", join(framesDir, "frame-%04d.jpg"), "-i", mixPath,
    "-t", String(total), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
    "-metadata", `comment=${comment}`, "-metadata", `title=${take ? "" : "DRAFT pilot: "}DDR4 RAM won't fit a DDR5 slot`, videoPath]);
  await rm(framesDir, { recursive: true, force: true });

  // Inspection: each beat at full size, and a sheet at phone size (360x640 each).
  const inspectDir = join(outputDir, "inspection");
  await mkdir(inspectDir, { recursive: true });
  const sceneAt = (id: PilotScene["id"], offset: number) => scenes.find((scene) => scene.id === id)!.startSecond + offset;
  const moments = [{ label: "00-first-frame", at: 0 }, { label: "01-jammed", at: events.jam + 0.35 }, { label: "02-notch", at: sceneAt("notch", 1.1) },
    { label: "03-fix1", at: events.fix1 + 0.4 }, { label: "04-fix2", at: events.fix2 + 0.45 }, { label: "05-payoff", at: sceneAt("payoff", 1.0) },
    { label: "06-proof", at: sceneAt("payoff", proofAt + 0.6) }, { label: "07-cta", at: sceneAt("cta", 1.0) }, { label: "08-final", at: total - 0.05 }];
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
  const stripPath = join(outputDir, "timeline-4fps.png");
  await run("ffmpeg", ["-v", "error", "-y", "-i", videoPath, "-vf", "fps=4,scale=180:320:flags=area,tile=8x7", "-frames:v", "1", stripPath]);

  // The existing render checks, on the bytes, and the mix measured where it matters.
  const media = verifyRenderedMedia(videoPath);
  const probed = await probe(TOOLS, videoPath);
  const line1 = voice[0];
  const jamWindow = { start: events.jam - 0.05, seconds: 0.45 };
  const mix = {
    loudness: await loudness(videoPath),
    // The thud must be heard, and must not cover the words around it.
    jamThudPeakDb: (await levelsBetween(hitsPath, jamWindow.start, jamWindow.seconds)).maxDb,
    line1VoicePeakDb: (await levelsBetween(voicePath, line1.startSecond, line1.seconds)).maxDb,
    voiceMeanInJamWindowDb: (await levelsBetween(voicePath, jamWindow.start, jamWindow.seconds)).meanDb,
    thudMeanInJamWindowDb: (await levelsBetween(hitsPath, jamWindow.start, jamWindow.seconds)).meanDb,
    hitsGain,
  };
  const thudUnderVoice = mix.line1VoicePeakDb - mix.jamThudPeakDb;
  const mixFindings = [
    ...(thudUnderVoice < 3 ? [`The jam thud peaks only ${thudUnderVoice.toFixed(1)} dB under the voice: it may cover the words.`] : []),
    ...(thudUnderVoice > 10 ? [`The jam thud peaks ${thudUnderVoice.toFixed(1)} dB under the voice: it may not be heard on a phone speaker.`] : []),
    ...(Math.abs(mix.loudness.integratedLufs + 14) > 1 ? [`Integrated loudness is ${mix.loudness.integratedLufs} LUFS, not about -14.`] : []),
    ...(mix.loudness.truePeakDbtp > -1 ? [`True peak ${mix.loudness.truePeakDbtp} dBTP is above -1.`] : []),
  ];
  const checks = {
    probe: probed,
    decodeErrors: await decodeErrors(TOOLS, videoPath),
    black: await blackIntervals(TOOLS, videoPath, probed.durationSeconds),
    frozen: await freezeIntervals(TOOLS, videoPath, probed.durationSeconds),
    audio: await audioLevels(TOOLS, videoPath),
    mix: { ...mix, thudUnderVoiceDb: Number(thudUnderVoice.toFixed(1)), findings: mixFindings },
  };

  const report = {
    label: take
      ? "FINAL CANDIDATE. Liam narration (approved script), compatibility facts read from the SpecSmith catalog and Builder checker at render time. Not published; a person must watch and approve it."
      : "DRAFT PILOT. Temporary espeak voice. Not for publication.",
    mode: options.mode,
    video: { path: videoPath, sha256: media.sha256, bytes: media.bytes, durationSeconds: probed.durationSeconds },
    take: take ? { voiceId: take.voiceId, voiceUsed: take.voiceUsed, modelId: take.modelId, audioSha256: take.audioSha256, providerReportedCharacterCost: take.providerReportedCharacterCost, lineTimings: take.lineTimings } : null,
    timing: plan ? { events: plan.events, proofAt: plan.proofAt, adjustments: plan.adjustments, voice: plan.voice } : { events, proofAt },
    facts: {
      cpu: { id: facts.cpu.id, name: facts.cpu.name, socket: facts.cpu.socket, supported_ram: facts.cpu.supported_ram },
      ddr4Board: facts.ddr4Board, ddr5Board: facts.ddr5Board, oldRam: facts.oldRam, newRam: facts.newRam,
      builderVerdict: facts.mismatch, fix1Passed: facts.newRamPassed, fix2Passed: facts.matchPassed, lga1700Boards: facts.lga1700Boards,
    },
    builderCard: { route: card.route, viewport: card.viewport, shownText: card.shownText },
    font: { family: inter.family, source: inter.source, sha256: inter.sha256, license: inter.sha256 ? "SIL Open Font License 1.1" : null },
    scenes, captions, voice: voice.map(({ path: _path, ...clip }) => clip), effects: sound.effects.map(({ path: _path, ...effect }) => effect),
    master1StoryboardReview: { recommendedFixes: review.recommendedFixes, notAssessed: review.overall.filter((score) => score.provenance === "not-assessed").map((score) => score.dimension) },
    visualHonesty: reviewVisualHonesty(DECLARED_VISUALS),
    renderChecks: checks,
    inspectionFrames: frames, phoneSizeSheet: sheetPath, timelineStrip: stripPath,
  };
  await writeFile(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

/** `--liam-take <dir>` renders the final; `--temp-voice` renders a labelled draft. Nothing else is accepted. */
export function renderModeFromArgs(argv: readonly string[]): RenderMode {
  const takeIndex = argv.indexOf("--liam-take");
  if (takeIndex >= 0) {
    const takeDir = argv[takeIndex + 1];
    if (!takeDir || takeDir.startsWith("--")) throw new Error("--liam-take needs the take directory.");
    return { mode: "final", takeDir: resolve(takeDir) };
  }
  if (argv.includes("--temp-voice")) return { mode: "draft" };
  throw new Error("Choose --liam-take <dir> for the final (Liam only, no fallback voice) or --temp-voice for a labelled draft.");
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();
if (isMain) {
  Promise.resolve().then(() => renderRamFitPilot(renderModeFromArgs(process.argv.slice(2)))).then((report) => {
    console.log(report.label);
    console.log(`video: ${report.video.path} (${report.video.durationSeconds.toFixed(2)}s) sha256 ${report.video.sha256}`);
    for (const clip of report.voice) console.log(`  voice ${clip.scene}: at ${clip.startSecond}s for ${clip.seconds}s (${clip.source})`);
    console.log(`events: ${JSON.stringify(report.timing.events)}`);
    console.log(`#1 storyboard review fixes: ${report.master1StoryboardReview.recommendedFixes.length}`);
    console.log(`render checks: ${JSON.stringify({ decode: report.renderChecks.decodeErrors.length, black: report.renderChecks.black, frozen: report.renderChecks.frozen, mix: report.renderChecks.mix })}`);
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
