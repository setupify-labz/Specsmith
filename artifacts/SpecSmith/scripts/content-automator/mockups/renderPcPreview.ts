#!/usr/bin/env tsx
/**
 * Render the five-second PC preview.
 *
 * A one-off review artifact, deliberately NOT wired into the content pipeline:
 * no adapter, no capability, no production plan. It drives the same headless
 * Chromium the UI capture already uses and the same ffmpeg the compositor
 * already uses, and nothing else.
 *
 * The scene is a stylised CSS illustration. There is no 3D model behind it
 * because this repository contains none, and no 3D engine to render one with.
 */

import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { chromium } from "playwright";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

export const PREVIEW_SECONDS = 5;
export const PREVIEW_FPS = 30;
const FRAME_COUNT = PREVIEW_SECONDS * PREVIEW_FPS;

async function main(): Promise<void> {
  const scene = join(here, "pcScene.html");
  const outDir = join(here, "..", "..", "..", "render-output", "pc-preview");
  const frameDir = join(outDir, "frames");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(frameDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(scene).toString(), { waitUntil: "load" });

    for (let index = 0; index < FRAME_COUNT; index += 1) {
      // Every frame is a pure function of t, so the sequence is reproducible.
      const t = FRAME_COUNT === 1 ? 0 : index / (FRAME_COUNT - 1);
      await page.evaluate((value) => {
        (window as unknown as { renderFrame: (v: number) => void }).renderFrame(value);
      }, t);
      await page.screenshot({
        path: join(frameDir, `frame-${String(index).padStart(4, "0")}.png`),
        type: "png",
        animations: "disabled",
      });
    }
    console.log(`Captured ${FRAME_COUNT} frames at ${PREVIEW_FPS}fps.`);
  } finally {
    await browser.close();
  }

  const output = join(outDir, "pc-preview-5s.mp4");
  await run("ffmpeg", [
    "-v", "error", "-y",
    "-framerate", String(PREVIEW_FPS),
    "-i", join(frameDir, "frame-%04d.png"),
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    output,
  ]);

  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,size:stream=width,height,codec_name,avg_frame_rate",
    "-of", "default=noprint_wrappers=1",
    output,
  ]);
  console.log(`\n${output}\n${stdout.trim()}`);
}

main().catch((error: unknown) => {
  console.error("PC PREVIEW RENDER FAILED:");
  console.error(error);
  process.exitCode = 1;
});
