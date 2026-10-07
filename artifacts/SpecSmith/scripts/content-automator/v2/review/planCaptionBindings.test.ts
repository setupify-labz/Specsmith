// The caption check reads the production plan's own caption cues when the plan
// carries them (plannedCaptionCues), so the plan is one of its inputs. Changing
// ONLY those cues must request the caption check again: in a fresh review
// compared with the old one, and against a packet that was already issued.
// The other inputs the motion-graphic review reads are bound directly too, not
// only through another check's result.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { captionCuesForScript } from "../../productionPlan.ts";
import type { ReviewSubmission } from "./inputs.ts";
import { buildReviewFixture, type ReviewFixture } from "./reviewFixture.ts";
import { planRechecks, revalidateReviewPacket, reviewCreative } from "./reviewCreative.ts";
import { CHECKS, type BindingKey, type CheckId, type ReviewPacket } from "./types.ts";
import { sha256Json } from "./util.ts";

let dir: string;
let fixture: ReviewFixture;
let base: ReviewSubmission;
let issued: ReviewPacket;
const NOW = new Date("2026-10-01T12:00:00.000Z");
const review = (submission: ReviewSubmission) => reviewCreative(submission, { now: NOW });
const codes = (packet: ReviewPacket) => packet.findings.filter((entry) => entry.check === "captions.rendered-text").map((entry) => entry.code);

/** A plan carrying caption cues; the manifest records exactly this plan. */
const planWith = (cues: ReturnType<typeof captionCuesForScript>, submission: ReviewSubmission) =>
  ({ ...(submission.productionPlan as object), tasks: [{ capability: "caption-render", captionRenderState: { cues } }] });

/** Only the plan's caption cues change: the last cue is dropped, as if a graphic now carried it. */
const changeCaptionCues = (submission: ReviewSubmission): ReviewSubmission => {
  const cues = (submission.productionPlan as { tasks: { captionRenderState: { cues: unknown[] } }[] }).tasks[0].captionRenderState.cues;
  return { ...submission, productionPlan: { ...(submission.productionPlan as object), tasks: [{ capability: "caption-render", captionRenderState: { cues: cues.slice(0, -1) } }] } };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "master7-plan-captions-"));
  fixture = await buildReviewFixture(dir);
  const submission = fixture.submission();
  const productionPlan = planWith(captionCuesForScript(submission.storyboard), submission);
  const renderManifestPath = fixture.writeManifest("plan-with-cues", (manifest) => ({ ...manifest, productionPlanSha256: sha256Json(productionPlan) }));
  base = { ...submission, productionPlan, renderManifestPath };
  issued = await review(base);
}, 180_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the caption check depends on the production plan", () => {
  it("the base review reads the plan's cues and finds the burned captions are that set", () => {
    expect(issued.checksCompleted.find((entry) => entry.check === "captions.rendered-text")?.status).toBe("passed");
    expect(codes(issued)).toEqual([]);
    expect(revalidateReviewPacket(issued, base)).toEqual({ valid: true, reasons: [], plan: null });
  });

  it("a fresh review with only the plan's caption cues changed finds the difference, and the comparison repeats the caption check", async () => {
    const changed = await review(changeCaptionCues(base));
    // Meaningful: the burned captions are no longer the planned set.
    expect(codes(changed)).toContain("caption-count-differs");
    const plan = planRechecks(issued.bindings, changed.bindings);
    expect(plan.changed).toEqual(["productionPlan"]);
    expect(plan.checksToRepeat).toContain("captions.rendered-text");
    expect(plan.stillValidChecks).not.toContain("captions.rendered-text");
  }, 60_000);

  it("an issued packet revalidated against only a changed plan caption set requests the caption check again", () => {
    const result = revalidateReviewPacket(issued, changeCaptionCues(base));
    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(["The production plan changed after review."]);
    expect(result.plan?.changed).toEqual(["productionPlan"]);
    expect(result.plan?.checksToRepeat).toContain("captions.rendered-text");
    expect(result.plan?.stillValidChecks).not.toContain("captions.rendered-text");
  });
});

describe("every input the motion-graphic review added is bound directly to the checks that read it", () => {
  // Direct, not only transitive: claims.presentation also repeats when the
  // frame check does (CHECK_USES), but its own reads must not depend on that.
  const reads: [BindingKey, CheckId[]][] = [
    // plannedCaptionCues
    ["productionPlan", ["captions.rendered-text"]],
    // graphicTextByBeat: timeline -> capture asset -> metadata.onScreenText, verified bytes only
    ["manifest.timeline", ["claims.presentation", "claims.screen"]],
    ["manifest.captures", ["claims.presentation", "claims.screen"]],
    ["assets", ["claims.presentation", "claims.screen"]],
    // motion clips in the frame check (metadata.renderer)
    ["manifest.captures", ["frames.bands"]],
    // narrationSpans (narrationSegments) and the narration's textSha256 metadata
    ["manifest.narration", ["narration.timing", "narration.binding"]],
    // synthesized sound effects' renderer metadata in the rights checks
    ["manifest.otherAssets", ["rights.assets", "rights.placeholders"]],
  ];
  for (const [key, checks] of reads) {
    for (const check of checks) {
      it(`${check} binds ${key}`, () => {
        expect(CHECKS[check].bindsTo as readonly string[]).toContain(key);
      });
    }
  }
});
