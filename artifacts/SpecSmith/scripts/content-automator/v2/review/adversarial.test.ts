// MASTER #7 adversarial suite, run against the real review path.
//
// Every case starts from the clean fixture cut, whose packet is
// awaiting-human-review with no blocking finding, and changes exactly one
// thing. Each test asserts the specific finding and the check that produced
// it, and that the clean packet does not have it, so no case passes merely
// because the fixture is blocked for some other reason.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DISCLOSURE_BANDED_LAYOUT } from "../../bandedLayout.ts";
import { DEMO_PAIRING } from "../../leadsVsAverage/facts.ts";
import { reviewCreativeQuality } from "../creativeQualityReview.ts";
import { captionCuesForScript } from "../../productionPlan.ts";
import type { ReviewSubmission } from "./inputs.ts";
import { buildReviewFixture, copy, ffmpeg, FIXTURE_CLAIMS, FIXTURE_STORYBOARD, SHORTS_VARIANT, type ReviewFixture } from "./reviewFixture.ts";
import { formatReviewPacket, isIssuedReviewPacket, planRechecks, requestFinalApproval, revalidateReviewPacket, reviewCreative, verdictFor } from "./reviewCreative.ts";
import { HUMAN_GATES } from "./humanGates.ts";
import type { ReviewPacket } from "./types.ts";
import { sha256File, sha256Text } from "./util.ts";

let dir: string;
let fixture: ReviewFixture;
let clean: ReviewPacket;
const NOW = new Date("2026-10-01T12:00:00.000Z");
const review = (submission: ReviewSubmission) => reviewCreative(submission, { now: NOW });
const codes = (packet: ReviewPacket) => packet.findings.map((entry) => entry.code);
const find = (packet: ReviewPacket, code: string) => packet.findings.filter((entry) => entry.code === code);
const RESULTS: { case: string; verdict: string; caughtBy: string }[] = [];
function caught(name: string, packet: ReviewPacket, code: string, check: string) {
  const hits = find(packet, code);
  expect(hits.length, `${name}: expected ${code}; got ${codes(packet).join(", ")}`).toBeGreaterThan(0);
  expect(hits.every((hit) => hit.check === check)).toBe(true);
  // Isolation: the clean cut does not carry this finding.
  expect(codes(clean)).not.toContain(code);
  for (const hit of hits) {
    expect(hit.owner).toBeTruthy();
    expect(hit.recheck.length).toBeGreaterThan(0);
    expect(hit.evidence.length).toBeGreaterThan(0);
  }
  RESULTS.push({ case: name, verdict: packet.verdict, caughtBy: `${check} → ${code} (${hits[0].severity})` });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "master7-adversarial-"));
  fixture = await buildReviewFixture(dir);
  clean = await review(fixture.submission());
}, 180_000);
afterAll(() => {
  if (process.env.MASTER7_RESULTS) writeFileSync(process.env.MASTER7_RESULTS, `${JSON.stringify(RESULTS, null, 2)}\n`);
  rmSync(dir, { recursive: true, force: true });
});

describe("the control", () => {
  it("the clean cut is awaiting human review with no blocking finding", () => {
    expect(clean.verdict).toBe("awaiting-human-review");
    expect(clean.findings.filter((entry) => entry.severity === "blocking")).toEqual([]);
  });
});

describe("MASTER #7 adversarial cases", () => {
  it("1. a plausible SHA for a nonexistent file", async () => {
    const manifestPath = fixture.writeManifest("ghost", (manifest) => ({
      ...manifest, output: { ...manifest.output, path: join(dir, "never-rendered.mp4"), sha256: sha256Text("plausible") },
    }));
    const packet = await review({ ...fixture.submission(), renderManifestPath: manifestPath });
    caught("1 plausible SHA, no file", packet, "media-missing", "media.bytes");
    expect(packet.verdict).toBe("blocked");
    expect(packet.media.sha256).toBeNull();
  }, 60_000);

  it("2. a video modified after review", async () => {
    const cut = fixture.derive("modify-me", []);
    const packet = await review({ ...fixture.submission(), renderManifestPath: cut.manifestPath });
    expect(packet.verdict).toBe("awaiting-human-review");
    expect(revalidateReviewPacket(packet).valid).toBe(true);
    // Replace the reviewed bytes with another valid encode.
    ffmpeg("-i", fixture.videoPath, "-vf", "eq=brightness=0.02", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "copy", join(dir, "tampered.mp4"));
    copy(join(dir, "tampered.mp4"), cut.videoPath);
    const after = revalidateReviewPacket(packet);
    expect(after.valid).toBe(false);
    expect(after.reasons.join(" ")).toMatch(/changed after it was verified/);
    expect(after.plan?.changed).toContain("media");
    expect(after.plan?.gatesToRepeat).toEqual(HUMAN_GATES.map((gate) => gate.gate));
    expect(requestFinalApproval(packet).reasons.join(" ")).toMatch(/changed after it was verified/);
    const again = await review({ ...fixture.submission(), renderManifestPath: cut.manifestPath });
    caught("2 video modified after review", again, "media-differs-from-manifest", "media.bytes");
    expect(again.verdict).toBe("blocked");
  }, 90_000);

  it("3. an approval copied from another video or cut", async () => {
    const other = fixture.derive("other-cut", ["-vf", "eq=brightness=0.03"]);
    const copied = await review({ ...fixture.submission(), humanDecisions: [
      { gate: "hook-on-phone", outcome: "approved", by: "Editor", at: "2026-09-30T10:00:00Z", mediaSha256: sha256File(other.videoPath), variantId: SHORTS_VARIANT.variantId },
      { gate: "pacing", outcome: "approved", by: "Editor", at: "2026-09-30T10:00:00Z", mediaSha256: clean.media.sha256, variantId: "tiktok-1080x1920-30" },
    ] });
    caught("3 approval copied from another video or cut", copied, "approval-for-other-media", "decisions.binding");
    for (const gate of copied.humanGates.filter((entry) => entry.recordedDecisions.length)) {
      expect(gate.status).toBe("open");
      expect(gate.recordedDecisions.every((decision) => !decision.appliesToThisCut && decision.trusted === false)).toBe(true);
    }
    // Control: an approval naming these exact bytes and this cut is recorded, applies, and still does not close the gate.
    const exact = await review({ ...fixture.submission(), humanDecisions: [
      { gate: "hook-on-phone", outcome: "approved", by: "Editor", at: "2026-09-30T10:00:00Z", mediaSha256: clean.media.sha256, variantId: SHORTS_VARIANT.variantId },
    ] });
    expect(codes(exact)).not.toContain("approval-for-other-media");
    const gate = exact.humanGates.find((entry) => entry.gate === "hook-on-phone")!;
    expect(gate.status).toBe("open");
    expect(gate.recordedDecisions[0]).toMatchObject({ appliesToThisCut: true, trusted: false });
    expect(exact.verdict).toBe("awaiting-human-review");
  }, 90_000);

  it("4. synthetic research relabelled as production", async () => {
    const submission = fixture.submission();
    const packet = await review({ ...submission, research: { ...submission.research, declaredKind: "production" } });
    caught("4 synthetic research relabelled as production", packet, "synthetic-relabelled-production", "research.provenance");
    expect(packet.identities.researchKind).toBe("synthetic-fixture");
    expect(packet.verdict).toBe("blocked");
  }, 60_000);

  it("5. a stale Compare capture from before the 10 / 3 ties / 7 fix", async () => {
    const manifestPath = fixture.writeManifest("stale-capture", (manifest) => ({
      ...manifest,
      assets: manifest.assets.map((asset) => asset.assetId.startsWith("capture-0")
        // What a pre-fix build showed: the averages, and no tie count.
        ? { ...asset, metadata: { ...asset.metadata, verifiedText: "Est. Avg FPS: 121\nEst. Avg FPS: 123" } }
        : asset),
    }));
    const packet = await review({ ...fixture.submission(), renderManifestPath: manifestPath });
    caught("5 stale pre-fix Compare capture", packet, "stale-capture", "captures.current");
    expect(find(packet, "stale-capture")[0].message).toMatch(/3 ties/);
  }, 60_000);

  it("6. a tie labelled as a Build A lead on screen", async () => {
    const storyboard = structuredClone(FIXTURE_STORYBOARD);
    (storyboard.beats[0] as { onScreenText: string }).onScreenText = "13 games to 7";
    const cut = await fixture.renderCut("tie-as-lead", { storyboard });
    const submission = cut.submission();
    const claims = submission.claims.map((claim) => claim.claimId === "hook-tally-caption"
      ? { ...claim, text: "13 games to 7", statement: { kind: "tally" as const, pairing: DEMO_PAIRING, leadsA: 13, leadsB: 7, ties: null } }
      : claim);
    const packet = await review({ ...submission, claims });
    caught("6 tie labelled as a Build A lead", packet, "tie-counted-as-lead", "claims.model");
    expect(find(packet, "tie-counted-as-lead")[0].location).toBe("beat 1 caption");
  }, 90_000);

  it("7. estimated FPS labelled as a measured benchmark", async () => {
    // On screen: the caption calls the estimate measured.
    const storyboard = structuredClone(FIXTURE_STORYBOARD);
    (storyboard.beats[1] as { onScreenText: string }).onScreenText = "Measured average: 121 vs 123";
    const cut = await fixture.renderCut("measured-caption", { storyboard });
    const submission = cut.submission();
    const claims = submission.claims.map((claim) => claim.claimId === "averages-caption" ? { ...claim, text: "Measured average: 121 vs 123" } : claim);
    const packet = await review({ ...submission, claims });
    caught("7a estimate worded as measured on screen", packet, "estimate-presented-as-measured", "claims.presentation");
    // In the record: the figure declared as a benchmark.
    const relabelled = await review({ ...fixture.submission(), claims: FIXTURE_CLAIMS.map((claim) => claim.claimId === "averages-caption" ? { ...claim, basis: "measured-benchmark" as const } : claim) });
    caught("7b estimate declared as a measured benchmark", relabelled, "estimate-labelled-measured", "claims.presentation");
  }, 120_000);

  it("8. a planned disclosure missing, obscured or too brief in the render", async () => {
    const brief = fixture.derive("disclosure-too-brief", ["-vf", `drawbox=x=0:y=0:w=iw:h=${DISCLOSURE_BANDED_LAYOUT.disclosure.height}:color=black:t=fill:enable='gte(t,2)'`]);
    const briefPacket = await review({ ...fixture.submission(), renderManifestPath: brief.manifestPath });
    caught("8a disclosure too brief (gone after 2s)", briefPacket, "disclosure-not-on-screen", "disclosure.coverage");
    expect(find(briefPacket, "disclosure-not-on-screen").every((hit) => Number.parseFloat(hit.location) >= 2)).toBe(true);

    const obscured = fixture.derive("disclosure-obscured", ["-vf", "drawbox=x=0:y=60:w=iw:h=160:color=0x404040:t=fill"]);
    const obscuredPacket = await review({ ...fixture.submission(), renderManifestPath: obscured.manifestPath });
    caught("8b disclosure obscured", obscuredPacket, "disclosure-not-on-screen", "disclosure.coverage");

    const missing = await review({ ...fixture.submission(), disclosureLines: [] });
    caught("8c planned disclosure missing", missing, "required-disclosure-missing", "disclosure.content");
    caught("8c planned disclosure missing (panel)", missing, "disclosure-text-differs", "disclosure.content");
  }, 180_000);

  it("9. a correct number spoken over the wrong game or settings screen", async () => {
    const wrong = fixture.picture("capture-4k-ultra", "0x333366", 3);
    const cut = await fixture.renderCut("wrong-settings", { captures: [
      { path: fixture.files.captures[0], pairing: DEMO_PAIRING },
      { path: wrong, pairing: { ...DEMO_PAIRING, resolution: "4k", preset: "ultra" } },
      { path: fixture.files.captures[2], pairing: { ...DEMO_PAIRING, resolution: "1080p", preset: "low" } },
    ] });
    const packet = await review(cut.submission());
    caught("9 correct figure over the wrong settings screen", packet, "figure-over-wrong-settings", "claims.screen");
    // The frame check passes: the pixels are the planned capture. The defect is what that capture shows.
    expect(codes(packet)).not.toContain("story-band-mismatch");
    expect(find(packet, "figure-over-wrong-settings").map((hit) => hit.location)).toEqual(["beat 2 caption", "beat 2 narration"]);
  }, 90_000);

  it("10. a graphic showing a range the evidence or page does not supply", async () => {
    const packet = await review({ ...fixture.submission(), graphics: [{
      graphicId: "cyberpunk-range", beatIndex: 1, label: "Cyberpunk range shown on Compare",
      shows: { kind: "range", pairing: DEMO_PAIRING, of: "model-variance", build: "A", game: "Cyberpunk 2077", low: 60, high: 80 },
      attributedTo: "page", pageText: "60-80 FPS",
    }] });
    caught("10 unsupported range", packet, "graphic-range-unsupported", "graphics.integrity");
    caught("10 range attributed to a page that does not show it", packet, "attributed-to-page-not-shown", "graphics.integrity");
    // Control: the model's own band, attributed to the model, passes.
    const honest = await review({ ...fixture.submission(), graphics: [{
      graphicId: "cyberpunk-range", beatIndex: 1, label: "Model band for Cyberpunk",
      shows: { kind: "range", pairing: DEMO_PAIRING, of: "model-variance", build: "A", game: "Cyberpunk 2077", low: 63, high: 75 },
      attributedTo: "model",
    }] });
    expect(honest.findings.filter((entry) => entry.check === "graphics.integrity")).toEqual([]);
  }, 90_000);

  it("11. an unlicensed or unknown-rights sound or image", async () => {
    const sfx = join(dir, "whoosh.wav");
    ffmpeg("-f", "lavfi", "-i", "sine=frequency=880:duration=0.4", sfx);
    const manifestPath = fixture.writeManifest("with-sfx", (manifest) => ({
      ...manifest, assets: [...manifest.assets, { assetId: "sfx-whoosh", role: "sound-effect", path: sfx, sha256: sha256File(sfx)!, metadata: {} }],
    }));
    const unknown = await review({ ...fixture.submission(), renderManifestPath: manifestPath });
    caught("11a unknown-rights sound", unknown, "rights-unknown", "rights.assets");
    expect(unknown.verdict).toBe("awaiting-human-review"); // unknown rights forbid final approval
    expect(find(unknown, "rights-unknown")[0].severity).toBe("blocks-final-approval");

    const submission = fixture.submission();
    const unlicensed = await review({ ...submission, renderManifestPath: manifestPath, rights: [...submission.rights, {
      assetId: "sfx-whoosh", kind: "sound-effect", source: "downloaded from a sound site",
      license: { kind: "none", evidence: null, permittedUse: [], attribution: null, expiresAt: null, scope: null },
      generation: null, transformations: [], placeholder: { isPlaceholder: false, why: null },
    }] });
    caught("11b unlicensed sound", unlicensed, "unlicensed-asset", "rights.assets");
    expect(unlicensed.verdict).toBe("blocked");

    const relabelled = await review({ ...submission, rights: submission.rights.map((record) => record.assetId === "narration"
      ? { ...record, placeholder: { isPlaceholder: false, why: null } } : record) });
    caught("11c placeholder voice relabelled as final", relabelled, "placeholder-relabelled", "rights.placeholders");
  }, 120_000);

  it("12. a correct storyboard with unrelated valid video bytes", async () => {
    const unrelated = join(dir, "unrelated.mp4");
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=1080x1920:r=30:d=6", "-f", "lavfi", "-i", "sine=frequency=330:duration=6",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", unrelated);
    const manifestPath = fixture.writeManifest("unrelated", (manifest) => ({
      ...manifest, output: { ...manifest.output, path: unrelated, sha256: sha256File(unrelated)! },
    }));
    const packet = await review({ ...fixture.submission(), renderManifestPath: manifestPath });
    caught("12 valid but unrelated video bytes", packet, "story-band-mismatch", "frames.bands");
    caught("12 valid but unrelated video bytes (disclosure)", packet, "disclosure-not-on-screen", "disclosure.coverage");
    expect(codes(packet)).not.toContain("media-differs-from-manifest");
  }, 90_000);

  it("13. a strong score with one unresolved factual or readability fix", async () => {
    const storyboard = structuredClone(FIXTURE_STORYBOARD);
    (storyboard.beats[1] as { onScreenText: string }).onScreenText = "Est. average: 121 vs 123 though A leads more games";
    const quality = reviewCreativeQuality({ creativeId: "x", packageId: "x", storyboard, captionCues: captionCuesForScript(storyboard), ctaRoute: "/compare", mediaSha256: null });
    expect(quality.recommendedFixes).toHaveLength(1);
    expect(quality.productionQualityScore).toBeGreaterThanOrEqual(9);
    const cut = await fixture.renderCut("one-fix", { storyboard });
    const submission = cut.submission();
    const claims = submission.claims.map((claim) => claim.claimId === "averages-caption"
      ? { ...claim, text: "Est. average: 121 vs 123" } : claim);
    const packet = await review({ ...submission, claims });
    caught("13 strong score, one unresolved fix", packet, "storyboard-fix-outstanding", "storyboard.quality");
    expect(packet.verdict).toBe("blocked");
    expect(JSON.stringify(packet)).not.toMatch(/productionQualityScore|overallScore/);
  }, 90_000);

  it("14. a direct call to a lower-level function that bypasses the workflow", () => {
    const forged = { ...clean, verdict: "eligible-to-request-final-approval" } as ReviewPacket;
    expect(isIssuedReviewPacket(forged)).toBe(false);
    expect(requestFinalApproval(forged)).toEqual({ granted: false, reasons: ["Not a packet issued by reviewCreative."] });
    expect(revalidateReviewPacket(forged).valid).toBe(false);
    const roundTripped = JSON.parse(JSON.stringify(clean)) as ReviewPacket;
    expect(requestFinalApproval(roundTripped).granted).toBe(false);
    expect(() => { (clean as { verdict: string }).verdict = "eligible-to-request-final-approval"; }).toThrow(TypeError);
    // The verdict function alone cannot produce eligibility while gates are open.
    expect(verdictFor([], clean.humanGates)).toBe("awaiting-human-review");
    RESULTS.push({ case: "14 forged / copied / mutated packet, or verdict computed directly", verdict: "refused", caughtBy: "isIssuedReviewPacket + requestFinalApproval → \"Not a packet issued by reviewCreative.\"; packets are frozen" });
  });
});

describe("what no packet can reach", () => {
  it("every gate approved for these exact bytes still leaves the cut awaiting human review, and final approval is refused", async () => {
    const decisions = HUMAN_GATES.map((gate) => ({ gate: gate.gate, outcome: "approved" as const, by: "Editor", at: "2026-09-30T10:00:00Z", mediaSha256: clean.media.sha256, variantId: SHORTS_VARIANT.variantId }));
    const packet = await review({ ...fixture.submission(), humanDecisions: decisions });
    expect(packet.verdict).toBe("awaiting-human-review");
    expect(packet.humanGates.every((gate) => gate.status === "open")).toBe(true);
    const request = requestFinalApproval(packet);
    expect(request.granted).toBe(false);
    expect(request.reasons.join(" ")).toMatch(/no trusted approval record/);
  }, 60_000);

  it("a recorded rejection always blocks", async () => {
    const packet = await review({ ...fixture.submission(), humanDecisions: [
      { gate: "voice-and-mix", outcome: "rejected", by: "", at: "not a time", mediaSha256: null, variantId: null },
    ] });
    expect(packet.verdict).toBe("blocked");
    expect(find(packet, "human-rejection")[0].check).toBe("decisions.binding");
  }, 60_000);

  it("a missing media tool fails clearly instead of passing", async () => {
    const packet = await reviewCreative(fixture.submission(), { now: NOW, ffprobePath: join(dir, "no-such-ffprobe") });
    expect(packet.verdict).toBe("blocked");
    expect(find(packet, "media-tool-missing")[0].message).toMatch(/not available/);
    expect(packet.checksUnavailable.map((record) => record.check)).toEqual(expect.arrayContaining(["media.decode", "frames.bands", "narration.timing"]));
    expect(packet.checksCompleted.map((record) => record.check)).not.toContain("frames.bands");
  }, 60_000);
});

describe("recheck planning", () => {
  it("repeats only what a change invalidates", async () => {
    const submission = fixture.submission();
    const rightsChanged = await review({ ...submission, rights: submission.rights.map((record) => ({ ...record, source: `${record.source} (re-described)` })) });
    const rights = planRechecks(clean.bindings, rightsChanged.bindings);
    expect(rights.changed).toEqual(["rights"]);
    expect(rights.checksToRepeat).toEqual(["rights.assets", "rights.placeholders"]);
    expect(rights.gatesToRepeat).toEqual(["rights-and-publication"]);

    const claimsChanged = await review({ ...submission, claims: submission.claims.slice(0, 3) });
    const claims = planRechecks(clean.bindings, claimsChanged.bindings);
    expect(claims.changed).toEqual(["claims"]);
    expect(claims.gatesToRepeat).toEqual(["factual-takeaway", "disclosures-in-context"]);
    expect(claims.checksToRepeat).not.toContain("media.decode");
    expect(claims.stillValidGates).toContain("voice-and-mix");

    const recut = fixture.derive("recut", []);
    const media = planRechecks(clean.bindings, (await review({ ...submission, renderManifestPath: recut.manifestPath })).bindings);
    expect(media.changed).toContain("media");
    expect(media.gatesToRepeat).toEqual(HUMAN_GATES.map((gate) => gate.gate));
  }, 120_000);

  it("the editor's text leads with the verdict and says it is not an approval", () => {
    const text = formatReviewPacket(clean);
    expect(text.split("\n")[1]).toBe("Verdict: awaiting-human-review");
    expect(text).toMatch(/not an approval/);
    expect(text).not.toMatch(/\bpublish(?:able)? ready\b|\bready to publish\b/i);
  });
});
