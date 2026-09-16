#!/usr/bin/env tsx
/**
 * Burn the estimate disclosure onto the storyboard stills.
 *
 * The Compare page prints its disclosure near the top, which is scrolled out of
 * frame once a capture is framed on the tally or the table. In the video the
 * disclosure is a persistent burned-in band, so a preview without it is not a
 * preview of what a viewer would see.
 *
 * This reuses the real caption renderer's ASS document, so the band in these
 * previews is produced by the same code that would produce it in a render.
 * No text-to-speech, no provider call, no video.
 */

import { execFile } from "node:child_process";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { buildAssDocument } from "./captionRender.ts";
import { STILLS_OUTPUT_DIR } from "./storyboardStills.ts";

const run = promisify(execFile);

export const ESTIMATE_DISCLOSURE =
  "FPS values are SpecSmith model estimates, not measured benchmarks of these exact systems.";

export async function burnDisclosure(directory = STILLS_OUTPUT_DIR): Promise<readonly string[]> {
  const ass = buildAssDocument({
    durationSeconds: 1,
    cues: [],
    disclosures: [{ text: ESTIMATE_DISCLOSURE }],
  });
  const assPath = join(directory, "disclosure.ass");
  await writeFile(assPath, ass, "utf8");

  const sources = (await readdir(directory)).filter(
    (name) => name.endsWith(".png") && !name.includes("-with-disclosure"),
  );
  const written: string[] = [];

  for (const name of sources.sort()) {
    const out = join(directory, name.replace(/\.png$/, "-with-disclosure.png"));
    await run("ffmpeg", [
      "-v", "error", "-y",
      "-i", join(directory, name),
      "-vf", `subtitles=${assPath.replace(/:/g, "\\:")}`,
      "-frames:v", "1",
      out,
    ]);
    written.push(out);
  }
  return written;
}

burnDisclosure()
  .then((files) => {
    console.log(`Burned the estimate disclosure onto ${files.length} stills:`);
    for (const file of files) console.log(`  ${file}`);
  })
  .catch((error: unknown) => {
    console.error("DISCLOSURE BURN FAILED:");
    console.error(error);
    process.exitCode = 1;
  });
