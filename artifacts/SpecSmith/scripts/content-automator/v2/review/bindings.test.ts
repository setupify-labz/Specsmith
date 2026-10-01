// The title, the description and the approved call-to-action destination are
// inputs the review checks, so each is bound into the packet. Changing one
// must invalidate exactly the checks and gates that read it: in a new review,
// and against a packet that was already issued.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ReviewSubmission } from "./inputs.ts";
import { buildReviewFixture, FIXTURE_CONTRACT, type ReviewFixture } from "./reviewFixture.ts";
import { planRechecks, requestFinalApproval, revalidateReviewPacket, reviewCreative } from "./reviewCreative.ts";
import { CHECKS, type BindingKey, type CheckId, type HumanGateId, type ReviewPacket } from "./types.ts";

let dir: string;
let fixture: ReviewFixture;
let clean: ReviewPacket;
const NOW = new Date("2026-10-01T12:00:00.000Z");

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "master7-bindings-"));
  fixture = await buildReviewFixture(dir);
  clean = await reviewCreative(fixture.submission(), { now: NOW });
}, 180_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const CASES: {
  key: BindingKey;
  label: RegExp;
  change: (submission: ReviewSubmission) => ReviewSubmission;
  checks: CheckId[];
  gates: HumanGateId[];
}[] = [
  {
    key: "title", label: /^The title changed after review\.$/,
    change: (submission) => ({ ...submission, title: "Ahead in more games, a little behind on average" }),
    checks: ["claims.model", "claims.presentation", "claims.undeclared", "claims.research"],
    gates: ["factual-takeaway", "rights-and-publication"],
  },
  {
    key: "description", label: /^The description changed after review\.$/,
    change: (submission) => ({ ...submission, description: "SpecSmith model estimates for two builds. Compare your own at /compare." }),
    checks: ["claims.model", "claims.presentation", "claims.undeclared", "claims.research", "cta.destination"],
    gates: ["factual-takeaway", "rights-and-publication"],
  },
  {
    key: "ctaDestination", label: /^The approved call-to-action destination changed after review\.$/,
    change: (submission) => ({ ...submission, approvedDestination: "/builder" }),
    checks: ["storyboard.quality", "cta.destination"],
    gates: ["rights-and-publication"],
  },
];

describe("title, description and CTA destination are bound into the packet", () => {
  it("records each identity", () => {
    expect(clean.bindings.title).toMatch(/^[0-9a-f]{64}$/);
    expect(clean.bindings.description).toMatch(/^[0-9a-f]{64}$/);
    expect(clean.bindings.ctaDestination).toMatch(/^[0-9a-f]{64}$/);
    expect(clean.identities).toMatchObject({ titleSha256: clean.bindings.title, descriptionSha256: clean.bindings.description, approvedDestination: "/compare" });
  });

  it("every check that reads them is bound to them", () => {
    const reads: Record<string, CheckId[]> = {
      title: ["claims.model", "claims.presentation", "claims.undeclared", "claims.research"],
      description: ["claims.model", "claims.presentation", "claims.undeclared", "claims.research", "cta.destination"],
      ctaDestination: ["storyboard.quality", "cta.destination"],
    };
    for (const [key, checks] of Object.entries(reads)) {
      for (const check of checks) expect(CHECKS[check].bindsTo as readonly string[], `${check} must bind ${key}`).toContain(key);
    }
  });

  for (const testCase of CASES) {
    it(`changing the ${testCase.key} in a new review invalidates exactly its checks and gates`, async () => {
      const changed = await reviewCreative(testCase.change(fixture.submission()), { now: NOW });
      const plan = planRechecks(clean.bindings, changed.bindings);
      expect(plan.changed).toEqual([testCase.key]);
      expect(plan.checksToRepeat).toEqual(testCase.checks);
      expect(plan.gatesToRepeat).toEqual(testCase.gates);
      // Nothing about the media is invalidated by a text or destination change.
      expect(plan.stillValidChecks).toEqual(expect.arrayContaining(["media.bytes", "media.decode", "frames.bands", "narration.timing"]));
      expect(plan.stillValidGates).toEqual(expect.arrayContaining(["voice-and-mix", "pacing", "style-fits-audience"]));
    }, 60_000);

    it(`changing the ${testCase.key} after the packet was issued invalidates it`, () => {
      expect(revalidateReviewPacket(clean, fixture.submission())).toEqual({ valid: true, reasons: [], plan: null });
      const result = revalidateReviewPacket(clean, testCase.change(fixture.submission()));
      expect(result.valid).toBe(false);
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toMatch(testCase.label);
      expect(result.plan?.changed).toEqual([testCase.key]);
      expect(result.plan?.checksToRepeat).toEqual(testCase.checks);
      expect(result.plan?.gatesToRepeat).toEqual(testCase.gates);
      expect(requestFinalApproval(clean, testCase.change(fixture.submission())).reasons.join(" ")).toMatch(testCase.label.source.slice(1, -3));
    });
  }

  it("all three changed at once invalidate the union, still nothing about the media", () => {
    const all = CASES.reduce((submission, testCase) => testCase.change(submission), fixture.submission());
    const result = revalidateReviewPacket(clean, all);
    expect(result.plan?.changed).toEqual(["title", "description", "ctaDestination"]);
    expect(new Set(result.plan?.checksToRepeat)).toEqual(new Set(CASES.flatMap((testCase) => testCase.checks)));
    expect(result.plan?.checksToRepeat).not.toContain("media.bytes");
  });

  it("other submission edits after issue are caught too, and a submission for another cut is refused", () => {
    const submission = fixture.submission();
    const claims = revalidateReviewPacket(clean, { ...submission, claims: submission.claims.slice(1) });
    expect(claims.plan?.changed).toEqual(["claims"]);
    const otherCut = revalidateReviewPacket(clean, { ...submission, variant: { ...submission.variant, variantId: "tiktok-1080x1920-30" } });
    expect(otherCut.valid).toBe(false);
    expect(otherCut.plan?.changed).toContain("platformCut");
    expect(otherCut.plan?.gatesToRepeat).toContain("hook-on-phone");
  });
});

describe("the re-run checks see the new values", () => {
  it("a new destination makes the old CTA and description fail", async () => {
    const packet = await reviewCreative({ ...fixture.submission(), approvedDestination: "/builder" }, { now: NOW });
    expect(packet.verdict).toBe("blocked");
    expect(packet.findings.filter((entry) => entry.check === "cta.destination").map((entry) => entry.code))
      .toEqual(expect.arrayContaining(["cta-missing", "cta-wrong-destination"]));
  }, 60_000);

  it("the research gate reads the published title and description, not only the storyboard", async () => {
    const proposition = "The RTX 5060 Ti is the best value graphics card of 2026.";
    const contract = { ...FIXTURE_CONTRACT, unsafeClaims: [{ claimId: "best-value", proposition, state: "unknown" as const, reason: "No evidence.", wouldBecomeSafeIf: ["A price-performance study."] }] };
    const base = fixture.submission();
    const quiet = await reviewCreative({ ...base, research: { ...base.research, contract } }, { now: NOW });
    expect(quiet.findings.filter((entry) => entry.check === "claims.research")).toEqual([]);
    const titled = await reviewCreative({ ...base, research: { ...base.research, contract }, title: proposition, description: `Why ${proposition}` }, { now: NOW });
    const research = titled.findings.filter((entry) => entry.check === "claims.research");
    expect(research.map((entry) => entry.location).sort()).toEqual(["description", "title"]);
    expect(research.every((entry) => entry.severity === "blocking")).toBe(true);
  }, 60_000);
});
