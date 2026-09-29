// Renders the GPU race DRAFT: a 12-15 second MP4 with placeholder narration
// and synthesized sound cues, key frames taken from that MP4, a contact sheet
// and a manifest.
//
// A DRAFT FOR REVIEW. Not a pipeline, not publishable: the manifest says so,
// nothing reads it as a publish candidate, no provider is called, and the
// narration is the offline espeak-ng placeholder, not the intended Liam read.
// The cut is timed from the placeholder's measured lines; a Liam take would
// re-time it from its own.
//
//   pnpm content:poc:gpu-race

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { launchBrowser } from "../uiRender/capture.ts";
import { compareFiguresFor, compareGamesFor, loadCompareData, partName, type CompareBuildPair, type CompareSetting } from "../resultCards/compareFigures.ts";
import { mixDraft, placedVoice, PLACEHOLDER_VOICE, SAMPLE_RATE, speakPlaceholder, synthesizeCues, wavBytes } from "./audio.ts";
import { CAPTION_BAND, MODEL_ESTIMATE_LABEL, sceneHtml, type SceneText } from "./scene.ts";
import { buildRaceTimeline, FPS, HEIGHT, narrationLines, WIDTH, type LineId, type RaceTimeline } from "./timeline.ts";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "..", "..", "..", "render-output", "gpu-race-draft");

export const RACE_BUILDS: CompareBuildPair = {
  a: { gpu: "rtx4080s", cpu: "r9-9950x3d" },
  b: { gpu: "rtx4080", cpu: "r9-9950x3d" },
};
export const RACE_SETTING: CompareSetting = { resolution: "1440p", preset: "high" };

/** Key moments to pull as frames, from the timeline's own events. */
export function keyFrameTimes(timeline: RaceTimeline): { label: string; second: number }[] {
  const spot = timeline.tiles.filter((tile) => tile.spotlight);
  const frameOf = (predicate: (frame: RaceTimeline["frames"][number]) => boolean) => timeline.frames.find(predicate)?.t;
  const times = [
    { label: "opening", second: 0.3 },
    { label: "first-flip", second: 1.0 },
    ...spot.map((tile, index) => ({ label: `spotlight-${index + 1}`, second: tile.flipAt + 0.45 })),
    { label: "counter-climbing", second: frameOf((frame) => frame.count >= 12) ?? 0 },
    { label: "count-complete", second: (frameOf((frame) => frame.complete >= 1) ?? 0) },
    { label: "pull-back", second: frameOf((frame) => frame.pullback >= 0.5) ?? 0 },
    { label: "averages", second: (frameOf((frame) => frame.reveal >= 1) ?? 0) + 0.2 },
    { label: "verdict", second: timeline.durationSeconds - 0.1 },
  ];
  return times.map((time) => ({ ...time, second: Number(time.second.toFixed(2)) })).sort((a, b) => a.second - b.second);
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${command} exited ${code}: ${err.slice(-800)}`))));
  });
}

export async function raceData() {
  const data = await loadCompareData();
  if (RACE_BUILDS.a.cpu !== RACE_BUILDS.b.cpu) throw new Error("The race credits the GPU; both builds must share a CPU.");
  const figures = compareFiguresFor(data, RACE_BUILDS, RACE_SETTING);
  const rows = compareGamesFor(data, RACE_BUILDS, RACE_SETTING);
  const names = { a: partName(data, "gpu", RACE_BUILDS.a.gpu), b: partName(data, "gpu", RACE_BUILDS.b.gpu) };
  return { figures, rows, names, sources: data.sources };
}

export function sceneText(timeline: RaceTimeline): SceneText {
  const { figures, names } = timeline;
  return {
    label: MODEL_ESTIMATE_LABEL,
    setting: `${RACE_SETTING.resolution} ${RACE_SETTING.preset === "high" ? "High" : "Ultra"} · same CPU`,
    nameA: names.a.toUpperCase(),
    nameB: names.b.toUpperCase(),
    countTotal: `/${figures.games}`,
    countCaption: figures.ties ? `MODELLED GAME LEADS · ${figures.ties} TIES` : "MODELLED GAME LEADS",
    spotlightCaption: `${names.a} leads · modelled`,
    verdictLead: "yet only",
    gapValue: `${figures.avgA - figures.avgB} FPS`,
    verdictTail: "apart on average",
    avgA: String(figures.avgA),
    versus: " vs ",
    avgB: String(figures.avgB),
    avgCaption: "est. avg FPS",
  };
}

async function main(): Promise<void> {
  const { figures, rows, names, sources } = await raceData();
  // Speak each line first: the cut is timed from what the voice actually takes.
  const voice = new Map<string, Float32Array>();
  for (const line of narrationLines(figures)) voice.set(line.id, await speakPlaceholder(line.text));
  const lineSeconds = Object.fromEntries([...voice].map(([id, samples]) => [id, samples.length / SAMPLE_RATE])) as Record<LineId, number>;
  const timeline = buildRaceTimeline(figures, rows, names, lineSeconds);
  const text = sceneText(timeline);
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(join(OUT_DIR, "key-frames"), { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "gpu-race-"));

  const session = await launchBrowser({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  try {
    const page = await session.context.newPage();
    await page.setContent(sceneHtml(timeline, text), { waitUntil: "load" });
    await page.evaluate("document.fonts.ready");
    const widths = (await page.evaluate("window.__captionWidths()")) as number[];
    const tooWide = timeline.captions.filter((_, index) => widths[index] > CAPTION_BAND.maxWidth);
    if (tooWide.length) throw new Error(`Captions wider than their band: ${tooWide.map((entry) => entry.text).join(" | ")}`);
    const canvas = page.locator("#c");
    for (let frame = 0; frame < timeline.frames.length; frame += 1) {
      await page.evaluate(`window.__draw(${frame})`);
      await canvas.screenshot({ path: join(work, `${String(frame).padStart(4, "0")}.png`) });
    }
  } finally {
    await session.close();
  }

  const wav = join(work, "cues.wav");
  await writeFile(wav, wavBytes(mixDraft(synthesizeCues(timeline.cues, timeline.durationSeconds), placedVoice(timeline.lines, voice))));
  const mp4 = join(OUT_DIR, "gpu-race-draft.mp4");
  await run("ffmpeg", [
    "-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(work, "%04d.png"), "-i", wav,
    "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p",
    // Short-form platforms play at about -14 LUFS; the draft is levelled to match.
    "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", String(SAMPLE_RATE),
    "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", mp4,
  ]);
  await rm(work, { recursive: true, force: true });

  const keyFrames = [];
  for (const { label, second } of keyFrameTimes(timeline)) {
    const file = join(OUT_DIR, "key-frames", `t${second.toFixed(2).padStart(5, "0")}s-${label}.png`);
    await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", second.toFixed(3), "-i", mp4, "-frames:v", "1", file]);
    keyFrames.push({ label, second, file: file.slice(OUT_DIR.length + 1), sha256: sha256(await readFile(file)) });
  }
  const sheet = join(OUT_DIR, "gpu-race-draft.key-frames.png");
  await run("ffmpeg", [
    "-y", "-loglevel", "error", ...keyFrames.flatMap((frame) => ["-i", join(OUT_DIR, frame.file)]), "-filter_complex",
    `${keyFrames.map((_, i) => `[${i}:v]scale=360:640[s${i}]`).join(";")};${keyFrames.map((_, i) => `[s${i}]`).join("")}` +
      `xstack=inputs=${keyFrames.length}:layout=${keyFrames.map((_, i) => `${(i % 5) * 360}_${Math.floor(i / 5) * 640}`).join("|")}:fill=black[out]`,
    "-map", "[out]", "-frames:v", "1", sheet,
  ]);

  const probe = JSON.parse(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name", "-of", "json", mp4]));
  const mp4Sha256 = sha256(await readFile(mp4));
  await writeFile(join(OUT_DIR, "gpu-race-draft.json"), `${JSON.stringify({
    kind: "gpu-race-narrated-draft",
    publishable: false,
    note: "Draft for review. Narration is the offline espeak-ng placeholder, not Liam; effects are synthesized offline. No provider was called. Not a publish candidate.",
    label: text.label,
    setting: RACE_SETTING,
    builds: RACE_BUILDS,
    figures: timeline.figures,
    figureSource: "estimateFpsForBuild + getAverageFps (the Compare page's own functions)",
    dataSources: sources,
    distanceRatio: timeline.distanceRatio,
    narration: { voice: PLACEHOLDER_VOICE, intendedVoice: "Liam (not generated)", lines: timeline.lines },
    captions: timeline.captions,
    durationSeconds: timeline.durationSeconds,
    tiles: timeline.tiles,
    cues: timeline.cues,
    mp4: { file: "gpu-race-draft.mp4", sha256: mp4Sha256, probe },
    keyFrames,
  }, null, 2)}\n`);

  console.log(`MP4:        ${mp4}`);
  console.log(`sha256:     ${mp4Sha256}`);
  console.log(`duration:   ${Number(probe.format.duration).toFixed(2)}s, streams ${probe.streams.map((s: { codec_type: string; codec_name: string }) => `${s.codec_type}/${s.codec_name}`).join(", ")}`);
  console.log(`key frames: ${sheet}`);
  console.log(`figures:    ${JSON.stringify(timeline.figures)}`);
  for (const line of timeline.lines) console.log(`  ${line.start.toFixed(2).padStart(5)}-${(line.start + line.seconds).toFixed(2).padEnd(5)}s  ${line.text}`);
  for (const caption of timeline.captions) console.log(`  caption ${caption.start.toFixed(2).padStart(5)}-${caption.end.toFixed(2).padEnd(5)}s  ${caption.text}`);
  for (const frame of keyFrames) console.log(`  key ${frame.second.toFixed(2).padStart(5)}s ${frame.label}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
