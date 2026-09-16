#!/usr/bin/env tsx
/**
 * Render an editorial graphic mockup to a 1080x1920 PNG.
 *
 * A local HTML file through the same headless Chromium the UI capture uses.
 * No product change, no provider call, no video: this exists so a layout can be
 * judged before anything is built into the renderer.
 */
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Rendered mockups land in render-output/, which is gitignored, so generated
 * images stay out of a source directory. The HTML beside this script is the
 * reviewable artifact; the PNG is reproducible from it at any time.
 */
const DEFAULT_OUTPUT_DIR = join(here, "..", "..", "..", "render-output", "mockups");

async function main(): Promise<void> {
  const input = resolve(process.argv[2] ?? join(here, "gameFrame.html"));
  const output = resolve(process.argv[3] ?? join(DEFAULT_OUTPUT_DIR, "gameFrame.png"));
  await mkdir(dirname(output), { recursive: true });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1080, height: 1920 },
      deviceScaleFactor: 1,
    });
    await page.goto(pathToFileURL(input).toString(), { waitUntil: "load" });
    await page.screenshot({ path: output, type: "png", fullPage: false });
    console.log(`Rendered ${input}\n      -> ${output}`);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error("MOCKUP RENDER FAILED:");
  console.error(error);
  process.exitCode = 1;
});
