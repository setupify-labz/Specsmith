#!/usr/bin/env tsx
/**
 * Three vertical still previews for the "Ten to Seven" storyboard.
 *
 * Stills only. No text-to-speech, no provider call, no compositing, no video.
 * Its whole purpose is to settle whether the per-game table can be framed
 * legibly at vertical width BEFORE anyone spends credits on narration.
 */

import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { RenderAdapterRegistry, renderPlatformPlan } from "./rendering.ts";
import type { PlatformProductionPlan, ProductionPlanPackage, ProductionTask } from "./types.ts";
import { createDeterministicUiRenderAdapter } from "./uiRender/deterministicUiRenderAdapter.ts";

const here = dirname(fileURLToPath(import.meta.url));
const baseUrl = process.env.SPECSMITH_RENDER_BASE_URL ?? "http://localhost:5178";

export const STILLS_OUTPUT_DIR = join(here, "..", "..", "render-output", "storyboard-stills");

/** One resolution and preset across all three moments, as agreed. */
const COMPARE_STATE = {
  surface: "compare",
  gpuA: "rtx5060ti",
  cpuA: "i3-13100f",
  gpuB: "rtx4060ti",
  cpuB: "r5-9600x",
  resolution: "1440p",
  preset: "high",
} as const;

export interface StillMoment {
  readonly id: string;
  readonly purpose: string;
  /** Text the crop is framed on. */
  readonly focusText: string;
}

/**
 * 540x960 at 2x is the standard 1080x1920 canvas.
 *
 * A tighter 360x640@3 was tried to make table rows fill more of the frame. It
 * enlarges the text but the page drops to a phone layout where the per-game
 * table overflows horizontally, and the verdict column — the one that reads
 * "Build A", "Build B" or "Tie" — is cut off mid-word. Bigger text that loses
 * the column carrying the point is not an improvement, so it was rejected.
 */
const CAPTURE_VIEWPORT = { width: 540, height: 960, deviceScaleFactor: 2 } as const;

export const MOMENTS: readonly StillMoment[] = [
  {
    id: "1-summary",
    purpose: "The three figures together: 10 leads, 7 leads, 3 ties, with both estimated averages beneath.",
    // The surface default already lands here; named explicitly so all three
    // moments are described the same way.
    focusText: "RTX 5060 Ti + i3-13100F",
  },
  {
    id: "2-selected-games-b-higher",
    purpose: "The three catalog games where Build B carries the higher model estimate by the widest margin.",
    focusText: "Valorant",
  },
  {
    id: "3-selected-games-a-higher",
    purpose: "The three catalog games where Build A carries the higher model estimate by the widest margin.",
    focusText: "Alan Wake 2",
  },
];

function stillTask(moment: StillMoment): ProductionTask {
  return {
    taskId: `storyboard-still-${moment.id}`,
    capability: "deterministic-ui-render",
    sourceBeat: null,
    purpose: moment.purpose,
    inputRequirements: ["Real SpecSmith Compare UI only."],
    outputRequirements: ["1080x1920 deterministic capture, framed on the named text."],
    uiRenderState: {
      state: COMPARE_STATE,
      captureType: "static",
      focusText: moment.focusText,
      viewport: CAPTURE_VIEWPORT,
    },
  };
}

export async function renderStoryboardStills(outputDir = STILLS_OUTPUT_DIR) {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const registry = new RenderAdapterRegistry().register(
    createDeterministicUiRenderAdapter({ baseUrl, outputDir }),
  );

  const tasks = MOMENTS.map(stillTask);
  const plan: PlatformProductionPlan = {
    platform: "youtube-shorts",
    targetDurationSeconds: 1,
    tasks,
    renderOrder: tasks.map((task) => task.taskId),
    qualityChecks: ["Every still is a real Compare capture at 1440p/High.", "No narration, no compositing, no video."],
  };

  const pkg: ProductionPlanPackage = {
    packageId: "storyboard-stills",
    ideaId: "ten-to-seven",
    campaignId: "storyboard-stills",
    platforms: [plan],
  };

  const result = await renderPlatformPlan(pkg, plan, registry, { maxAttemptsPerCapability: 1 });
  const failures = result.taskResults.filter((task) => task.status !== "succeeded");
  return { result, failures, outputDir };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).toString();

if (isMain) {
  renderStoryboardStills()
    .then(({ result, failures, outputDir }) => {
      console.log(`Stills written to ${outputDir}`);
      for (const task of result.taskResults) {
        const artifact = task.artifacts?.[0];
        console.log(`  ${task.taskId}: ${task.status}${artifact ? ` -> ${artifact.uri}` : ""}${task.error ? ` (${task.error})` : ""}`);
      }
      if (failures.length > 0) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      console.error("STILL PREVIEW FAILED:");
      console.error(error);
      process.exitCode = 1;
    });
}
