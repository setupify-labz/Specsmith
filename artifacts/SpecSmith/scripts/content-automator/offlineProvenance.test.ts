// #158: the offline pipeline's fingerprint ratios and qc-passed ledger note
// must describe what actually happened: the visuals it really consumed, and
// the recorded manual inspection its QC verdict really rests on.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildOfflineSmokePlan } from "./offlineCompositorSmoke.ts";
import { qcPassedLedgerNote, visualMixFromReceipt } from "./offlineProvenance.ts";
import { parseRecordedRenderEvidence, type QualityReviewResult } from "./qualityReviewer.ts";
import type { RenderReceipt } from "./motionCompositor.ts";
import { dimensions, renderControl, type ControlRender } from "./publishBoundary.testkit.ts";
import { DETERMINISTIC_UI_RENDERER } from "./uiRender/deterministicUiRenderAdapter.ts";

const here = dirname(fileURLToPath(import.meta.url));
const source = (file: string) => readFileSync(join(here, file), "utf8");
const EVIDENCE_PATH = "fixtures/mp4-smoke-offline-observation.json";
/** The committed record, read and never edited. */
const evidence = parseRecordedRenderEvidence(JSON.parse(source(EVIDENCE_PATH)));

describe("the visual mix is read from the compositor's receipt", () => {
  let uiOnly: ControlRender;
  let withPlaceholderHook: ControlRender;
  beforeAll(async () => {
    // The test kit's visuals are stills stamped with the UI renderer's name;
    // the placeholder-hook variant swaps the hook for the offline card fixture.
    uiOnly = await renderControl({ fixtureNarration: true });
    withPlaceholderHook = await renderControl({ fixtureNarration: true, fixtureHook: true });
  }, 120_000);
  afterAll(async () => {
    for (const render of [uiOnly, withPlaceholderHook]) if (render) await rm(render.dir, { recursive: true, force: true });
  });

  it("credits UI captures as UI proof, and nothing as an exact product asset", () => {
    expect(visualMixFromReceipt(uiOnly.receipt)).toEqual({
      uiProofRatio: 1, generatedVisualRatio: 0, exactProductAssetRatio: 0,
    });
  });

  it("weights by on-screen time and credits a fixture visual with nothing", () => {
    const hook = withPlaceholderHook.receipt.inputs.find((input) => input.role === "hook-visual")!;
    expect(hook.renderer).toBe("offline-card-video-fixture");
    // Hook 0-1.5s is the fixture card; evidence 1.5-3s is a UI capture.
    expect(visualMixFromReceipt(withPlaceholderHook.receipt)).toEqual({
      uiProofRatio: 0.5, generatedVisualRatio: 0, exactProductAssetRatio: 0,
    });
  });

  it("reads only a genuine receipt", () => {
    expect(() => visualMixFromReceipt({ ...uiOnly.receipt } as RenderReceipt)).toThrow(/compositor issued/);
  });
});

describe("the offline pipeline's ratios are tied to its real inputs, not constants", () => {
  it("renders every on-screen visual with the deterministic UI adapter", () => {
    const { plan } = buildOfflineSmokePlan();
    const compose = plan.tasks.find((task) => task.capability === "motion-compositor")!;
    const timeline = compose.compositorState?.visualTimeline ?? [];
    expect(timeline.length).toBeGreaterThan(0);
    for (const slot of timeline) {
      const task = plan.tasks.find((candidate) => candidate.taskId === slot.visualTaskId)!;
      expect(task.capability, slot.visualTaskId).toBe("deterministic-ui-render");
    }
  });

  it("that adapter stamps the renderer name the classifier credits as UI proof", () => {
    expect(source("uiRender/deterministicUiRenderAdapter.ts")).toContain("renderer: DETERMINISTIC_UI_RENDERER,");
    expect(DETERMINISTIC_UI_RENDERER).toBe("specsmith-deterministic-ui-render");
  });

  it("the pipeline derives its ratios from this render's receipt and types none in", () => {
    const pipeline = source("endToEndOfflinePipeline.ts");
    expect(pipeline).toContain("...visualMixFromReceipt(offlineReceipt)");
    expect(pipeline).not.toMatch(/(uiProofRatio|generatedVisualRatio|exactProductAssetRatio)\s*:\s*[\d.]/);
  });
});

describe("the qc-passed ledger note names the real review and its bound digests", () => {
  const RECEIPT_DIGEST = "e".repeat(64);
  const passed = (over: Partial<QualityReviewResult> = {}): QualityReviewResult => ({
    packageId: "mp4-smoke-offline",
    platform: "youtube-shorts",
    reviewedMediaSha256: evidence.masterSha256,
    reviewedReceiptDigest: RECEIPT_DIGEST,
    decision: "pass",
    publishable: true,
    overallScore: 9.1,
    dimensionScores: { ...dimensions },
    issues: [],
    regenerateTaskIds: [],
    ...over,
  });

  it("says who inspected, when, where it is recorded, and which master and receipt", () => {
    const note = qcPassedLedgerNote(passed(), evidence, EVIDENCE_PATH);
    expect(note).toContain("recorded manual inspection");
    expect(note).toContain(evidence.reviewedBy);
    expect(note).toContain(evidence.reviewedAt);
    expect(note).toContain(EVIDENCE_PATH);
    expect(note).toContain(evidence.masterSha256);
    expect(note).toContain(RECEIPT_DIGEST);
    expect(note).toContain("9.1/10");
  });

  it("never claims an automated review, because no automated scorer ran", () => {
    expect(qcPassedLedgerNote(passed(), evidence, EVIDENCE_PATH)).not.toMatch(/automat/i);
    // The pipeline's note is this function's, and no literal note claims one.
    const pipeline = source("endToEndOfflinePipeline.ts");
    expect(pipeline).toContain("note: qcPassedLedgerNote(review, evidence,");
    expect(pipeline).not.toMatch(/note:\s*`[^`]*automated/i);
    expect(pipeline).not.toContain("Passed automated review");
  });

  it("refuses to describe a qc-passed event that did not occur", () => {
    expect(() => qcPassedLedgerNote(passed({ decision: "hold-for-human-review", publishable: false }), evidence, EVIDENCE_PATH))
      .toThrow(/did not pass/);
    expect(() => qcPassedLedgerNote(passed({ publishable: false }), evidence, EVIDENCE_PATH)).toThrow(/did not pass/);
    expect(() => qcPassedLedgerNote(passed({ reviewedMediaSha256: "f".repeat(64) }), evidence, EVIDENCE_PATH))
      .toThrow(/not bound to the master/);
    expect(() => qcPassedLedgerNote(passed({ reviewedReceiptDigest: undefined }), evidence, EVIDENCE_PATH))
      .toThrow(/no render receipt/);
  });
});

describe("the pipeline cannot reach a ledger state it did not earn", () => {
  it("advances to qc-passed only after QC passed and the artifact gate built a request, and no further", () => {
    const pipeline = source("endToEndOfflinePipeline.ts");
    const qcStop = pipeline.indexOf("if (!review.publishable) {");
    const gate = pipeline.indexOf("publishingRequest = await buildMetricoolPublishingRequest(");
    const advance = pipeline.indexOf("advanceStoredPublicationLedger(publishingStoreRoot");
    expect(qcStop).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(qcStop);
    expect(advance).toBeGreaterThan(gate);
    // The only state it advances to.
    expect([...pipeline.matchAll(/status:\s*"([a-z-]+)"/g)].map((match) => match[1])).toEqual(["qc-passed"]);
  });
});
