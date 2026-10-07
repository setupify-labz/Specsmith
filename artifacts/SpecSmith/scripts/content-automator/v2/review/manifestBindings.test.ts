// The production plan and the render manifest are inputs the review reads, so
// both are bound into the packet: the plan whole, the manifest part by part.
// A change to either must invalidate exactly the checks that read it, in a
// fresh review and against a packet that was already issued, even when the
// MP4 and every asset file are byte-for-byte the same.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEMO_PAIRING } from "../../leadsVsAverage/facts.ts";
import type { RenderManifest, ReviewSubmission } from "./inputs.ts";
import { writeRenderManifest } from "./renderManifest.ts";
import { buildReviewFixture, fixtureCaptureMetadata, type ReviewFixture } from "./reviewFixture.ts";
import { planRechecks, requestFinalApproval, revalidateReviewPacket, reviewCreative } from "./reviewCreative.ts";
import type { CheckId, HumanGateId, ReviewPacket } from "./types.ts";

let dir: string;
let fixture: ReviewFixture;
let clean: ReviewPacket;
const NOW = new Date("2026-10-01T12:00:00.000Z");
const review = (submission: ReviewSubmission) => reviewCreative(submission, { now: NOW });
const codes = (packet: ReviewPacket) => packet.findings.map((entry) => entry.code);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "master7-manifest-bindings-"));
  fixture = await buildReviewFixture(dir);
  clean = await review(fixture.submission());
}, 180_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Only the production plan changes. */
const changePlan = (submission: ReviewSubmission): ReviewSubmission =>
  ({ ...submission, productionPlan: { ...(submission.productionPlan as object), beats: 4 } });
/** The render's plan identity, and the planned caption cues the caption check reads from the plan. */
const PLAN_CHECKS: CheckId[] = ["media.bytes", "captions.rendered-text"];

/**
 * Only render-manifest metadata changes: beat 2's capture record now says it
 * shows Compare at 4K Ultra (with that state's verified text). The PNG, every
 * other asset and the MP4 are untouched.
 */
const changeCaptureRecord = (manifest: RenderManifest): RenderManifest => ({
  ...manifest,
  assets: manifest.assets.map((asset) => asset.assetId.startsWith("capture-1")
    ? { ...asset, metadata: fixtureCaptureMetadata({ ...DEMO_PAIRING, resolution: "4k", preset: "ultra" }) }
    : asset),
});
const CAPTURE_CHECKS: CheckId[] = [
  "frames.bands", "disclosure.coverage", "claims.presentation", "claims.screen", "captures.current", "graphics.integrity", "rights.assets", "rights.placeholders",
];
const CAPTURE_GATES: HumanGateId[] = ["rights-and-publication"];
const MEDIA_CHECKS: CheckId[] = ["media.bytes", "media.decode", "media.format", "media.audio-levels", "media.ending", "narration.timing"];

describe("only the production plan changes", () => {
  it("a fresh review changes its finding, and planRechecks repeats exactly the check that reads the plan", async () => {
    const changed = await review(changePlan(fixture.submission()));
    // Meaningful: the review now finds the render was made from another plan.
    expect(codes(changed)).toContain("render-of-other-plan");
    expect(codes(clean)).not.toContain("render-of-other-plan");
    const plan = planRechecks(clean.bindings, changed.bindings);
    expect(plan.changed).toEqual(["productionPlan"]);
    expect(plan.checksToRepeat).toEqual(PLAN_CHECKS);
    expect(plan.gatesToRepeat).toEqual([]);
  }, 60_000);

  it("an issued packet is invalidated by it, with the same plan", () => {
    const result = revalidateReviewPacket(clean, changePlan(fixture.submission()));
    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(["The production plan changed after review."]);
    expect(result.plan?.changed).toEqual(["productionPlan"]);
    expect(result.plan?.checksToRepeat).toEqual(PLAN_CHECKS);
    expect(result.plan?.gatesToRepeat).toEqual([]);
    expect(requestFinalApproval(clean, changePlan(fixture.submission())).reasons).toContain("The production plan changed after review.");
  });
});

describe("only render-manifest metadata changes; the MP4 and asset bytes stay the same", () => {
  it("a fresh review changes its findings, and planRechecks repeats exactly the checks that read capture records", async () => {
    const manifestPath = fixture.writeManifest("capture-record-changed", changeCaptureRecord);
    const changed = await review({ ...fixture.submission(), renderManifestPath: manifestPath });
    // The bytes are the same...
    expect(changed.media.sha256).toBe(clean.media.sha256);
    expect(changed.bindings.media).toBe(clean.bindings.media);
    expect(changed.bindings.assets).toBe(clean.bindings.assets);
    // ...but the findings are not: the figures in beat 2 now sit over a screen recorded as 4K Ultra.
    expect(codes(changed)).toContain("figure-over-wrong-settings");
    expect(codes(clean)).not.toContain("figure-over-wrong-settings");
    const plan = planRechecks(clean.bindings, changed.bindings);
    expect(plan.changed).toEqual(["manifest.captures"]);
    expect(plan.checksToRepeat).toEqual(CAPTURE_CHECKS);
    expect(plan.gatesToRepeat).toEqual(CAPTURE_GATES);
    for (const check of MEDIA_CHECKS) expect(plan.stillValidChecks).toContain(check);
  }, 60_000);

  it("an issued packet is invalidated when its manifest file is edited, and only those checks repeat", async () => {
    const manifestPath = fixture.writeManifest("issued", (manifest) => manifest);
    const submission = { ...fixture.submission(), renderManifestPath: manifestPath };
    const issued = await review(submission);
    expect(revalidateReviewPacket(issued, submission)).toEqual({ valid: true, reasons: [], plan: null });

    writeRenderManifest(manifestPath, changeCaptureRecord(fixture.manifest));
    for (const result of [revalidateReviewPacket(issued), revalidateReviewPacket(issued, submission)]) {
      expect(result.valid).toBe(false);
      expect(result.reasons).toEqual(["The render manifest's capture records changed after review."]);
      expect(result.plan?.changed).toEqual(["manifest.captures"]);
      expect(result.plan?.checksToRepeat).toEqual(CAPTURE_CHECKS);
      expect(result.plan?.gatesToRepeat).toEqual(CAPTURE_GATES);
    }
    expect(requestFinalApproval(issued).reasons).toContain("The render manifest's capture records changed after review.");
  }, 60_000);

  it("other manifest parts invalidate only their own readers", async () => {
    const manifestPath = fixture.writeManifest("issued-parts", (manifest) => manifest);
    const issued = await review({ ...fixture.submission(), renderManifestPath: manifestPath });
    const edit = (mutate: (manifest: RenderManifest) => RenderManifest) => {
      writeRenderManifest(manifestPath, mutate(structuredClone(fixture.manifest)));
      return revalidateReviewPacket(issued).plan;
    };
    const narration = edit((manifest) => ({ ...manifest, narrationSegments: manifest.narrationSegments!.map((segment) => ({ ...segment, endSecond: segment.endSecond + 0.5 })) }));
    expect(narration?.changed).toEqual(["manifest.narration"]);
    expect(narration?.checksToRepeat).toEqual(["narration.binding", "narration.timing", "rights.assets", "rights.placeholders"]);
    const layout = edit((manifest) => ({ ...manifest, layout: { ...manifest.layout, captions: { y: 1620, height: 300 } } }));
    expect(layout?.changed).toEqual(["manifest.layout"]);
    expect(layout?.checksToRepeat).toEqual(["frames.bands", "disclosure.coverage", "disclosure.safe-area", "claims.presentation"]);
    const target = edit((manifest) => ({ ...manifest, output: { ...manifest.output, encode: { ...manifest.output.encode, fps: 60 } } }));
    expect(target?.changed).toEqual(["manifest.target"]);
    expect(target?.checksToRepeat).toEqual(["media.bytes", "media.format"]);
  }, 60_000);

  it("reformatting the manifest file without changing its content invalidates nothing", async () => {
    const manifestPath = fixture.writeManifest("issued-reformatted", (manifest) => manifest);
    const issued = await review({ ...fixture.submission(), renderManifestPath: manifestPath });
    writeFileSync(manifestPath, JSON.stringify(fixture.manifest));
    expect(revalidateReviewPacket(issued)).toEqual({ valid: true, reasons: [], plan: null });
  }, 60_000);
});
