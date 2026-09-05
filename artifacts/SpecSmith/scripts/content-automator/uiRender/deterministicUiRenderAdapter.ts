// The real `deterministic-ui-render` adapter.
//
// Implements the existing RenderAdapter contract from ../rendering.ts — it does
// not introduce a parallel rendering system. The orchestrator's rules are
// respected exactly: artifacts carry the context's taskId, at least one
// artifact is returned on success, and any failure throws so the orchestrator
// can record the attempt and fall back.
//
// WHERE THE STATE COMES FROM
// --------------------------
// ProductionTask.inputRequirements is prose. A deterministic render needs
// canonical ids, so the task carries an optional structured `uiRenderState`
// (added to ProductionTask in ../types.ts). A deterministic-ui-render task
// WITHOUT that field is a hard error rather than a best-effort guess: inferring
// "RTX 5090" from a sentence is exactly the fabrication this capability exists
// to prevent. The dry-run adapter remains available for planning and tests
// where no real capture is wanted.

import path from "node:path";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import type { RenderAdapter, RenderArtifact, RenderTaskContext } from "../rendering.ts";
import {
  focusOn,
  launchBrowser,
  openAndSettle,
  pageText,
  screenshot,
  UiCaptureError,
} from "./capture.ts";
import { ERROR_BOUNDARY_MARKERS, planSurface } from "./surfaces.ts";
import {
  parseUiRenderRequest,
  stateIdentifier,
  UiRenderStateError,
  VERTICAL_1080x1920,
  type UiRenderRequest,
} from "./uiRenderState.ts";

export interface UiRenderAdapterOptions {
  /** Origin of a running SpecSmith instance, e.g. http://localhost:4173 */
  baseUrl: string;
  /** Directory for rendered assets. Created if missing. */
  outputDir: string;
  navigationTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function assertNoErrorBoundary(text: string, url: string): void {
  for (const marker of ERROR_BOUNDARY_MARKERS) {
    if (text.includes(marker)) {
      throw new UiCaptureError("error-boundary", `${url} rendered an error boundary ("${marker}") — refusing to ship the capture.`);
    }
  }
}

/**
 * Post-capture verification.
 *
 * Deliberately re-checked after the screenshot as well as before it: the wait
 * in openAndSettle proves the state arrived, this proves it was still true at
 * capture time. A visually valid screenshot of the wrong state is a failed
 * render, so both ends are checked.
 */
function verifyState(text: string, expected: string[], url: string): void {
  const missing = expected.filter((needle) => !text.includes(needle));
  if (missing.length) {
    throw new UiCaptureError(
      "verification-failed",
      `Capture of ${url} does not show the requested state. Missing: ${missing.map((m) => JSON.stringify(m)).join(", ")}.`,
    );
  }
}

/** Flat primitives only — RenderArtifact.metadata does not accept nesting. */
function buildMetadata(
  request: UiRenderRequest,
  route: string,
  subjectIds: string[],
  bytes: number,
  frameCount: number,
): Record<string, string | number | boolean> {
  const viewport = request.viewport ?? VERTICAL_1080x1920;
  return {
    renderer: "specsmith-deterministic-ui-render",
    provider: "playwright-chromium",
    feature: request.state.surface,
    route,
    subjectIds: subjectIds.join(","),
    captureType: request.captureType,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    pixelWidth: viewport.width * viewport.deviceScaleFactor,
    pixelHeight: viewport.height * viewport.deviceScaleFactor,
    stateId: stateIdentifier(request),
    byteSize: bytes,
    frameCount,
    realUi: true,
    generated: false,
  };
}

export function createDeterministicUiRenderAdapter(options: UiRenderAdapterOptions): RenderAdapter {
  const timeoutMs = options.navigationTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    name: "specsmith-ui-render",
    capability: "deterministic-ui-render",

    async render(context: RenderTaskContext): Promise<RenderArtifact[]> {
      const rawState = (context.task as { uiRenderState?: unknown }).uiRenderState;
      if (rawState === undefined) {
        throw new UiRenderStateError(
          "missing-state",
          `Task ${context.task.taskId} requests deterministic-ui-render but carries no uiRenderState. This adapter will not infer hardware from prose — attach a typed state or use the dry-run adapter.`,
        );
      }

      const request = parseUiRenderRequest(rawState);
      const plan = planSurface(request);
      const url = `${options.baseUrl.replace(/\/$/, "")}${plan.route}`;
      const viewport = request.viewport ?? VERTICAL_1080x1920;
      const stateId = stateIdentifier(request);

      await fs.mkdir(options.outputDir, { recursive: true });

      const session = await launchBrowser(viewport);
      try {
        const isSequence = request.captureType === "sequence";
        const page = await openAndSettle(session.context, url, {
          expectedText: plan.expectedText,
          timeoutMs,
          // A sequence samples the UI over time, so its animations must run.
          freezeAnimations: !isSequence,
        });

        const before = await pageText(page);
        assertNoErrorBoundary(before, url);
        verifyState(before, plan.expectedText, url);

        // Frame the 9:16 crop on the meaningful region rather than the top of
        // the page. Failing to find the anchor is an error, not a shrug: it
        // would silently produce a capture of whatever happened to be at the
        // top, which for Compare is an expanded part picker.
        if (plan.focusText) {
          const framed = await focusOn(page, plan.focusText);
          if (!framed) {
            throw new UiCaptureError(
              "framing-failed",
              `Could not locate "${plan.focusText}" to frame the capture at ${url}.`,
            );
          }
        }

        // Unique per task+state, so two captures never overwrite each other.
        const baseName = `${context.task.taskId}__${stateId}`.slice(0, 180);

        if (!isSequence) {
          const finalPath = path.join(options.outputDir, `${baseName}.png`);
          // Written to a temp name first, then renamed: a reader never sees a
          // half-written PNG, and a crashed render leaves no artifact claiming
          // to be complete.
          const tempPath = `${finalPath}.partial`;
          await screenshot(page, tempPath);
          const after = await pageText(page);
          verifyState(after, plan.expectedText, url);
          await fs.rename(tempPath, finalPath);
          const { size } = await fs.stat(finalPath);

          return [{
            artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-ui`,
            taskId: context.task.taskId,
            kind: "image",
            uri: `file://${finalPath}`,
            mimeType: "image/png",
            metadata: buildMetadata(request, plan.route, plan.subjectIds, size, 1),
          }];
        }

        // Sequence: a deterministic series of frames plus timing metadata. V1
        // stops short of encoding MP4 — the compositor is a later step and
        // consuming frames + a manifest keeps this adapter's output inspectable.
        const frameDir = path.join(options.outputDir, baseName);
        await fs.mkdir(frameDir, { recursive: true });
        const frames: { index: number; label: string; file: string; atMs: number; provedBy?: string; bytes: number; sha256: string }[] = [];
        let elapsed = 0;
        let totalBytes = 0;

        for (const [index, step] of plan.sequence.entries()) {
          if (step.action?.kind === "clickText") {
            // Matched by visible text rather than a CSS class, so the sequence
            // survives styling changes and reads like the interaction it is.
            const target = page.getByRole("button", { name: step.action.text, exact: false }).first();
            await target.click({ timeout: timeoutMs });
          }

          // The state change is proven by a DOM condition before the frame is
          // taken. Without this a "sequence" degrades into the same screenshot
          // several times, which is what makes a manifest worthless.
          if (step.waitForText) {
            try {
              await page.waitForFunction(
                `document.body.innerText.includes(${JSON.stringify(step.waitForText)})`,
                undefined,
                { timeout: timeoutMs },
              );
            } catch {
              throw new UiCaptureError(
                "sequence-step-failed",
                `Sequence step "${step.label}" at ${url} did not reach its expected state: "${step.waitForText}" never appeared.`,
              );
            }
          }

          // Settling after the condition holds: the state is already correct,
          // this only lets the transition finish so the frame is not mid-fade.
          await page.waitForTimeout(step.settleMs);
          elapsed += step.settleMs;

          // Re-frame on whatever this step just changed. A sequence moves the
          // interesting region between frames — a crate reveal pushes the grid
          // around as cards appear — so a single pre-sequence framing leaves
          // later frames pointing at whatever ended up there instead.
          if (step.waitForText) await focusOn(page, step.waitForText);
          const file = path.join(frameDir, `frame-${String(index).padStart(3, "0")}-${step.label}.png`);
          await screenshot(page, file);
          const bytes = (await fs.stat(file)).size;
          totalBytes += bytes;
          const sha256 = createHash("sha256").update(await fs.readFile(file)).digest("hex");
          // `provedBy` records the DOM condition that made this frame a
          // distinct state, so a compositor (or a reviewer) can see that the
          // frames are not duplicates.
          frames.push({ index, label: step.label, file, atMs: elapsed, provedBy: step.waitForText, bytes, sha256 });
        }

        const after = await pageText(page);
        assertNoErrorBoundary(after, url);
        // Text that only exists once the reveal has been driven — for Build
        // Crate, the eight parts this seed produces.
        if (plan.revealedText?.length) verifyState(after, plan.revealedText, url);

        // A sequence must actually be a sequence. Identical frames mean the
        // steps changed nothing and the "clip" is one still billed N times, so
        // that is a failed render rather than a quiet non-event. Hashes make
        // the claim checkable by anyone reading the manifest.
        const uniqueFrames = new Set(frames.map((f) => f.sha256));
        if (frames.length > 1 && uniqueFrames.size === 1) {
          throw new UiCaptureError(
            "sequence-not-distinct",
            `All ${frames.length} frames of ${url} are byte-identical — the sequence steps produced no visible change.`,
          );
        }

        const manifestPath = path.join(frameDir, "manifest.json");
        await fs.writeFile(
          manifestPath,
          `${JSON.stringify({
            stateId,
            route: plan.route,
            subjectIds: plan.subjectIds,
            viewport,
            distinctFrames: uniqueFrames.size,
            frameCount: frames.length,
            frames,
          }, null, 2)}\n`,
        );

        return [{
          artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-ui-sequence`,
          taskId: context.task.taskId,
          kind: "image",
          uri: `file://${manifestPath}`,
          mimeType: "application/json",
          metadata: buildMetadata(request, plan.route, plan.subjectIds, totalBytes, frames.length),
        }];
      } finally {
        await session.close();
      }
    },
  };
}
