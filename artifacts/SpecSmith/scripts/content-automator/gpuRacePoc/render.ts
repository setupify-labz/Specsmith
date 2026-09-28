// Renders the 8-second GPU race proof of concept: an MP4 with synthesized
// sound cues, key frames taken from that MP4, a contact sheet and a manifest.
//
// A PROOF OF CONCEPT FOR VISUAL REVIEW. Not a pipeline, not publishable: the
// manifest says so, nothing reads it as a publish candidate, no provider is
// called and no voice is generated.
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
import { synthesizeCues, wavBytes } from "./audio.ts";
import { MODEL_ESTIMATE_LABEL, sceneHtml, type SceneText } from "./scene.ts";
import { buildRaceTimeline, FPS, HEIGHT, WIDTH, type RaceTimeline } from "./timeline.ts";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "..", "..", "..", "render-output", "gpu-race-poc");

export const RACE_BUILDS: CompareBuildPair = {
  a: { gpu: "rtx4080s", cpu: "r9-9950x3d" },
  b: { gpu: "rtx4080", cpu: "r9-9950x3d" },
};
export const RACE_SETTING: CompareSetting = { resolution: "1440p", preset: "high" };
/** Seconds to pull as key frames: cold open, race, flips, stamp, pull-back, reveal. */
export const KEY_FRAME_SECONDS = [0.4, 1.8, 3.4, 5.0, 5.7, 7.6] as const;

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

export async function raceInputs(): Promise<{ timeline: RaceTimeline; text: SceneText; sources: { path: string; sha256: string }[] }> {
  const data = await loadCompareData();
  if (RACE_BUILDS.a.cpu !== RACE_BUILDS.b.cpu) throw new Error("The race credits the GPU; both builds must share a CPU.");
  const figures = compareFiguresFor(data, RACE_BUILDS, RACE_SETTING);
  const rows = compareGamesFor(data, RACE_BUILDS, RACE_SETTING);
  const names = { a: partName(data, "gpu", RACE_BUILDS.a.gpu), b: partName(data, "gpu", RACE_BUILDS.b.gpu) };
  const timeline = buildRaceTimeline(figures, rows, names);
  const outright = figures.leadsA - figures.ties;
  const text: SceneText = {
    label: MODEL_ESTIMATE_LABEL,
    setting: `${RACE_SETTING.resolution} ${RACE_SETTING.preset === "high" ? "High" : "Ultra"} · ${figures.games} games`,
    nameA: names.a.toUpperCase(),
    nameB: names.b.toUpperCase(),
    leadsValue: `${outright}/${figures.games}`,
    leadsCaption: figures.ties ? `MODELLED GAME LEADS · ${figures.ties} TIES` : "MODELLED GAME LEADS",
    gapValue: `${figures.avgA - figures.avgB} FPS`,
    gapCaption: "apart on average",
    avgA: String(figures.avgA),
    versus: " vs ",
    avgB: String(figures.avgB),
    avgCaption: "est. avg FPS",
  };
  return { timeline, text, sources: data.sources };
}

async function main(): Promise<void> {
  const { timeline, text, sources } = await raceInputs();
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(join(OUT_DIR, "key-frames"), { recursive: true });
  const work = await mkdtemp(join(tmpdir(), "gpu-race-"));

  const session = await launchBrowser({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  try {
    const page = await session.context.newPage();
    await page.setContent(sceneHtml(timeline, text), { waitUntil: "load" });
    await page.evaluate("document.fonts.ready");
    const canvas = page.locator("#c");
    for (let frame = 0; frame < timeline.frames.length; frame += 1) {
      await page.evaluate(`window.__draw(${frame})`);
      await canvas.screenshot({ path: join(work, `${String(frame).padStart(4, "0")}.png`) });
    }
  } finally {
    await session.close();
  }

  const wav = join(work, "cues.wav");
  await writeFile(wav, wavBytes(synthesizeCues(timeline.cues)));
  const mp4 = join(OUT_DIR, "gpu-race-poc.mp4");
  await run("ffmpeg", [
    "-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(work, "%04d.png"), "-i", wav,
    "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", mp4,
  ]);
  await rm(work, { recursive: true, force: true });

  const keyFrames = [];
  for (const second of KEY_FRAME_SECONDS) {
    const file = join(OUT_DIR, "key-frames", `t${second.toFixed(1).padStart(4, "0")}s.png`);
    await run("ffmpeg", ["-y", "-loglevel", "error", "-ss", second.toFixed(3), "-i", mp4, "-frames:v", "1", file]);
    keyFrames.push({ second, file: file.slice(OUT_DIR.length + 1), sha256: sha256(await readFile(file)) });
  }
  const sheet = join(OUT_DIR, "gpu-race-poc.key-frames.png");
  await run("ffmpeg", [
    "-y", "-loglevel", "error", ...keyFrames.flatMap((frame) => ["-i", join(OUT_DIR, frame.file)]), "-filter_complex",
    `${keyFrames.map((_, i) => `[${i}:v]scale=360:640[s${i}]`).join(";")};${keyFrames.map((_, i) => `[s${i}]`).join("")}` +
      `xstack=inputs=${keyFrames.length}:layout=${keyFrames.map((_, i) => `${i * 360}_0`).join("|")}[out]`,
    "-map", "[out]", "-frames:v", "1", sheet,
  ]);

  const probe = JSON.parse(await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name", "-of", "json", mp4]));
  const mp4Sha256 = sha256(await readFile(mp4));
  await writeFile(join(OUT_DIR, "gpu-race-poc.json"), `${JSON.stringify({
    kind: "gpu-race-proof-of-concept",
    publishable: false,
    note: "Proof of concept for visual review. Sound is synthesized offline cues; no voice, no provider. Not a publish candidate.",
    label: text.label,
    setting: RACE_SETTING,
    builds: RACE_BUILDS,
    figures: timeline.figures,
    figureSource: "estimateFpsForBuild + getAverageFps (the Compare page's own functions)",
    dataSources: sources,
    distanceRatio: timeline.distanceRatio,
    tiles: timeline.tiles,
    cues: timeline.cues,
    mp4: { file: "gpu-race-poc.mp4", sha256: mp4Sha256, probe },
    keyFrames,
  }, null, 2)}\n`);

  console.log(`MP4:        ${mp4}`);
  console.log(`sha256:     ${mp4Sha256}`);
  console.log(`duration:   ${Number(probe.format.duration).toFixed(2)}s, streams ${probe.streams.map((s: { codec_type: string; codec_name: string }) => `${s.codec_type}/${s.codec_name}`).join(", ")}`);
  console.log(`key frames: ${sheet}`);
  console.log(`figures:    ${JSON.stringify(timeline.figures)}`);
  console.log(`flips:      ${timeline.tiles.map((tile) => `${tile.initials}@${tile.flipAt.toFixed(2)}`).join(" ")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
