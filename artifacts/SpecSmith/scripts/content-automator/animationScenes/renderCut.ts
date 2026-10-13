// The one renderer for spec-driven Shorts: a CutSpec in, a silent MP4 and a
// sound-effects MP4 out. Every frame is rendered fresh, in index order, in the
// pinned Chromium (uiRender/capture.ts) with Inter embedded; the encoder
// refuses a frame sequence that is not contiguous and ordered; text under
// 42 px on screen, or text that does not fit, stops the render.

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launchBrowser } from "../uiRender/capture.ts";
import { SPECSMITH_MOTION_COLOURS } from "./colours.ts";
import { PAGE_LIBRARY } from "./library.ts";
import { mixCues, PEAK_DBFS, RECIPES, run } from "./sound.ts";
import { specProblems, type CutSpec } from "./spec.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = resolve(here, "../nextVideoRefreshRate/fonts");
const FONT_FILES = { 400: "inter-latin-400-normal.woff2", 600: "inter-latin-600-normal.woff2", 700: "inter-latin-700-normal.woff2" } as const;
export const LAYOUT = Object.freeze({ width: 1080, height: 1920, label: { y: 0, height: 200 }, story: { y: 200, height: 1400 }, captions: { y: 1600, height: 320 } });
export const MIN_FINAL_PX = 42;

export function frameNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `f-${String(index).padStart(4, "0")}.png`);
}

export async function renderCut(spec: CutSpec, outputDir: string) {
  const problems = specProblems(spec);
  if (problems.length) throw new Error(`Spec ${spec.id} is not renderable:\n- ${problems.join("\n- ")}`);
  await mkdir(outputDir, { recursive: true });
  const framesDir = join(outputDir, `${spec.id}-frames`);
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  // The full-size frames and the sound work folder are temporary: removed on failure as well as success, so a
  // failed render leaves a small report folder, not hundreds of PNGs.
  try {
  const faces: string[] = [];
  for (const [weight, file] of Object.entries(FONT_FILES)) faces.push(`@font-face{font-family:Inter;font-weight:${weight};src:url(data:font/woff2;base64,${(await readFile(join(FONT_DIR, file))).toString("base64")}) format('woff2');}`);
  const state = { layout: LAYOUT, colours: SPECSMITH_MOTION_COLOURS, spec };
  const count = Math.round(spec.durationSeconds * spec.fps), names = frameNames(count);
  const session = await launchBrowser({ width: LAYOUT.width, height: LAYOUT.height, deviceScaleFactor: 1 });
  let measured: { minFinalPx: number; misfits: string[] };
  try {
    const page = await session.context.newPage();
    await page.setContent(`<!doctype html><html><head><style>${faces.join("")}</style></head><body style="margin:0;background:#0A0A0F"><canvas id="c" width="${LAYOUT.width}" height="${LAYOUT.height}"></canvas><script>const S = ${JSON.stringify(state)};${PAGE_LIBRARY}</script></body></html>`);
    await page.evaluate(`Promise.all([400, 600, 700].map((w) => document.fonts.load(w + ' 48px Inter')))`);
    if (!(await page.evaluate(`[400, 600, 700].every((w) => document.fonts.check(w + ' 48px Inter'))`))) throw new Error("Inter did not load; refusing to render in a fallback font.");
    for (let index = 0; index < count; index += 1) {
      const url = await page.evaluate(`window.renderAt(${(index / spec.fps).toFixed(4)})`) as string;
      await writeFile(join(framesDir, names[index]), Buffer.from(url.split(",")[1], "base64"));
    }
    measured = await page.evaluate("window.measured()") as { minFinalPx: number; misfits: string[] };
  } finally {
    await session.close();
  }
  if (measured.misfits.length) throw new Error(`Text does not fit at a readable size: ${[...new Set(measured.misfits)].join(" | ")}`);
  if (measured.minFinalPx < MIN_FINAL_PX) throw new Error(`Smallest type is ${measured.minFinalPx.toFixed(1)}px on screen, under ${MIN_FINAL_PX}px.`);
  const onDisk = (await readdir(framesDir)).filter((f) => f.endsWith(".png")).sort();
  if (onDisk.length !== count || onDisk.some((name, i) => name !== names[i])) throw new Error("The frame files are not one contiguous, ordered sequence.");
  const silentPath = join(outputDir, `${spec.id}-silent.mp4`);
  await run("ffmpeg", ["-v", "error", "-y", "-framerate", String(spec.fps), "-start_number", "0", "-i", join(framesDir, "f-%04d.png"),
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "0:v", "-map", "1:a",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
    "-t", spec.durationSeconds.toFixed(3), "-movflags", "+faststart", silentPath]);
  await rm(framesDir, { recursive: true, force: true });
  const sfxPath = join(outputDir, `${spec.id}-sfx.mp4`);
  await mixCues(spec.cues.map((c) => ({ recipe: RECIPES[c.kind], peakDbfs: c.peakDbfs ?? PEAK_DBFS[c.kind], at: c.at })), spec.durationSeconds, silentPath, sfxPath, join(outputDir, `${spec.id}-sound-work`));
  const sha = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
  return { silentPath, sfxPath, silentSha256: await sha(silentPath), sfxSha256: await sha(sfxPath), minFinalPx: measured.minFinalPx, frames: count };
  } finally {
    await rm(framesDir, { recursive: true, force: true });
    await rm(join(outputDir, `${spec.id}-sound-work`), { recursive: true, force: true });
  }
}
