// End to end through the real review path: a clean cut and a defective one.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DISCLOSURE_BANDED_LAYOUT } from "../../bandedLayout.ts";
import { DEMO_PAIRING } from "../../leadsVsAverage/facts.ts";
import { buildReviewFixture, FIXTURE_STORYBOARD, type ReviewFixture } from "./reviewFixture.ts";
import { formatReviewPacket, reviewCreative } from "./reviewCreative.ts";
import { CHECKS, type ReviewPacket } from "./types.ts";
import { sha256File } from "./util.ts";

let dir: string;
let fixture: ReviewFixture;
let clean: ReviewPacket;
let defective: ReviewPacket;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "master7-e2e-"));
  fixture = await buildReviewFixture(dir);
  clean = await reviewCreative(fixture.submission());

  // A defective creative: a tie-inflated tally on screen, an estimate called measured,
  // and the disclosure gone after two seconds.
  const storyboard = structuredClone(FIXTURE_STORYBOARD);
  (storyboard.beats[0] as { onScreenText: string }).onScreenText = "13 games to 7";
  (storyboard.beats[1] as { onScreenText: string }).onScreenText = "Measured average: 121 vs 123";
  const cut = await fixture.renderCut("defective", { storyboard });
  const blanked = join(dir, "defective-blanked.mp4");
  const { ffmpeg } = await import("./reviewFixture.ts");
  ffmpeg("-i", cut.videoPath, "-vf", `drawbox=x=0:y=0:w=iw:h=${DISCLOSURE_BANDED_LAYOUT.disclosure.height}:color=black:t=fill:enable='gte(t,2)'`,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "copy", blanked);
  const { writeRenderManifest } = await import("./renderManifest.ts");
  const manifestPath = join(dir, "defective-blanked.manifest.json");
  writeRenderManifest(manifestPath, { ...cut.manifest, output: { ...cut.manifest.output, path: blanked, sha256: sha256File(blanked)! } });
  const submission = cut.submission();
  defective = await reviewCreative({
    ...submission,
    renderManifestPath: manifestPath,
    claims: submission.claims.map((claim) => {
      if (claim.claimId === "hook-tally-caption") return { ...claim, text: "13 games to 7", statement: { kind: "tally" as const, pairing: DEMO_PAIRING, leadsA: 13, leadsB: 7, ties: null } };
      if (claim.claimId === "averages-caption") return { ...claim, text: "Measured average: 121 vs 123" };
      return claim;
    }),
  });
}, 240_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("a mechanically clean creative", () => {
  it("reaches awaiting-human-review, never approval, and says so", () => {
    expect(clean.verdict).toBe("awaiting-human-review");
    expect(clean.summary).toMatch(/^AWAITING HUMAN REVIEW \(not approved\)/);
    expect(clean.verdictMeaning).toMatch(/not an approval/);
    expect(clean.humanGates).toHaveLength(8);
    expect(clean.humanGates.every((gate) => gate.status === "open")).toBe(true);
    expect(clean.approvalMechanism.trustedApprovalAvailable).toBe(false);
  });

  it("is bound to the bytes it reviewed and every input identity", () => {
    expect(clean.media.sha256).toBe(sha256File(fixture.videoPath));
    expect(clean.media).toMatchObject({ width: 1080, height: 1920, fps: 30, videoCodec: "h264", audioCodec: "aac" });
    for (const value of Object.values(clean.identities)) expect(value).toBeTruthy();
    expect(clean.identities.researchKind).toBe("synthetic-fixture");
    expect(clean.assets.map((asset) => asset.rights)).toContain("repo-owned (PLACEHOLDER)");
  });

  it("accounts for every check: completed, unavailable or not applicable, with a reason", () => {
    const accounted = [...clean.checksCompleted, ...clean.checksUnavailable].map((record) => record.check).sort();
    expect(accounted).toEqual(Object.keys(CHECKS).sort());
    for (const record of clean.checksUnavailable) expect(record.detail.length).toBeGreaterThan(10);
    expect(clean.checksUnavailable.map((record) => record.check)).toEqual(expect.arrayContaining(["text.ocr", "audio.asr", "disclosure.safe-area"]));
  });
});

describe("a defective creative", () => {
  it("is blocked, with actionable findings for each defect", () => {
    expect(defective.verdict).toBe("blocked");
    const blocking = defective.findings.filter((entry) => entry.severity === "blocking");
    expect(blocking.map((entry) => entry.code)).toEqual(expect.arrayContaining(["disclosure-not-on-screen", "tie-counted-as-lead", "estimate-presented-as-measured"]));
    for (const entry of blocking) {
      expect(entry.location).not.toBe("");
      expect(entry.owner).toBeTruthy();
      expect(entry.recheck.length).toBeGreaterThan(0);
    }
    // Blocking findings come first, so an editor reads the fixes before anything else.
    expect(defective.findings[0].severity).toBe("blocking");
    const text = formatReviewPacket(defective);
    expect(text).toMatch(/Verdict: blocked/);
    expect(text.indexOf("Fix before anything else")).toBeLessThan(text.indexOf("Only a person can decide"));
  });
});
