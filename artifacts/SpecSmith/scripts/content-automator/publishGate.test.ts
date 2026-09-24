// Unit coverage for the gate's own logic, called directly. The tests that
// matter most live in publishBoundary.test.ts, where they run against the
// REAL buildMetricoolPublishingRequest — a gate nobody calls passes its own
// tests indefinitely.

// MUST STAY FIRST, AND MUST STAY A SIDE-EFFECT IMPORT: it installs the fake
// network before any adapter captures fetch.
import "./publishBoundary.fakeNetwork";

import { rm } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  approvalProblems,
  assertPublishable,
  evaluatePublishGate,
  type PublishGateInput,
} from "./publishGate";
import type { RenderReceipt } from "./motionCompositor";
import { dependencyRecordFor } from "./renderManifest";
import type { HostedMaster } from "./hostedMaster";
import { CONTROL_LIAM_VOICE_ID, hostControl, renderControl, type ControlRender } from "./publishBoundary.testkit";

const NOW = new Date("2026-09-23T12:00:00Z");

const renders: ControlRender[] = [];
const HOSTED = new WeakMap<RenderReceipt, HostedMaster>();
let clean: ControlRender;
let fixture: ControlRender;
let selfCleared: ControlRender;
beforeAll(async () => {
  clean = await renderControl();
  fixture = await renderControl({ fixtureNarration: true, fixtureMusic: true, fixtureHook: true });
  // A known fixture renderer that declares isFixture: false about itself.
  selfCleared = await renderControl({
    evidenceMetadata: { renderer: "offline-card-video-fixture", provider: "ffmpeg-offline-fixture", isFixture: false },
  });
  renders.push(clean, fixture, selfCleared);
  for (const control of renders) HOSTED.set(control.receipt, await hostControl(control));
}, 120_000);
afterAll(async () => {
  await Promise.all(renders.map((control) => rm(control.dir, { recursive: true, force: true })));
});

const signedOff = (receipt: RenderReceipt, over: Partial<PublishGateInput> = {}): PublishGateInput => {
  const binding = { masterSha256: receipt.masterSha256, receiptDigest: receipt.digest };
  return {
    receipt,
    dependencyRecord: dependencyRecordFor(receipt),
    hostedMaster: HOSTED.get(receipt) as HostedMaster,
    qualityReview: binding,
    rightsEvidence: binding,
    narrationIdentity: { liamVoiceId: CONTROL_LIAM_VOICE_ID },
    inspection: { approvedBy: "aaron", approvedAt: "2026-09-23T10:00:00Z", approved: true, ...binding },
    paidProviderApproval: { approvedBy: "aaron", approvedAt: "2026-09-23T10:00:00Z", ...binding },
    now: NOW,
    ...over,
  };
};

const codes = (input: PublishGateInput): string[] => {
  const verdict = evaluatePublishGate(input);
  return verdict.allowed ? [] : verdict.refusals.map((refusal) => refusal.code);
};

describe("approval identity and timestamp validation", () => {
  it("accepts an approval with an identity and a past timestamp", () => {
    expect(approvalProblems("x", { approvedBy: "aaron", approvedAt: "2026-09-23T10:00:00Z" }, NOW)).toEqual([]);
  });

  it("rejects an absent approval", () => {
    expect(approvalProblems("x", undefined, NOW)).toEqual(["x is absent."]);
  });

  it("rejects an anonymous approval", () => {
    expect(approvalProblems("x", { approvedBy: "   ", approvedAt: "2026-09-23T10:00:00Z" }, NOW))
      .toEqual([expect.stringContaining("approvedBy is empty")]);
  });

  it("rejects a timestamp that is not a timestamp", () => {
    expect(approvalProblems("x", { approvedBy: "aaron", approvedAt: "last tuesday" }, NOW))
      .toEqual([expect.stringContaining("not a valid timestamp")]);
  });

  it("rejects an approval dated in the future", () => {
    expect(approvalProblems("x", { approvedBy: "aaron", approvedAt: "2099-01-01T00:00:00Z" }, NOW))
      .toEqual([expect.stringContaining("in the future")]);
  });

  it("tolerates a minute of clock skew but not a day", () => {
    const skewed = new Date(NOW.getTime() + 30_000).toISOString();
    expect(approvalProblems("x", { approvedBy: "aaron", approvedAt: skewed }, NOW)).toEqual([]);
    const tomorrow = new Date(NOW.getTime() + 86_400_000).toISOString();
    expect(approvalProblems("x", { approvedBy: "aaron", approvedAt: tomorrow }, NOW)).toHaveLength(1);
  });
});

describe("an untrusted receipt stops the gate before it draws conclusions", () => {
  it("reports only untrusted-receipt for a receipt-shaped object", () => {
    const verdict = evaluatePublishGate(signedOff({ ...clean.receipt }));
    expect(verdict).toEqual({ allowed: false, refusals: [expect.objectContaining({ code: "untrusted-receipt" })] });
  });

  it("refuses an absent receipt outright", () => {
    expect(codes(signedOff(clean.receipt, { receipt: undefined as unknown as RenderReceipt }))).toEqual(["untrusted-receipt"]);
  });

  it("allows the genuine receipt with every binding in place", () => {
    expect(evaluatePublishGate(signedOff(clean.receipt))).toEqual({
      allowed: true, masterSha256: clean.receipt.masterSha256, receiptDigest: clean.receipt.digest,
    });
  });
});

describe("the hosted master is checked by the gate itself, not only by the builder", () => {
  // The builder's re-download also rejects an unissued record; this pins the
  // gate's own check so neither layer silently depends on the other.
  it("refuses a caller-built hosted record with the right URI and digests", () => {
    const forged = Object.freeze({ ...HOSTED.get(clean.receipt)! }) as HostedMaster;
    expect(codes(signedOff(clean.receipt, { hostedMaster: forged }))).toEqual(["hosted-master-unverified"]);
  });

  it("refuses a genuine hosted record for another render", () => {
    expect(codes(signedOff(clean.receipt, { hostedMaster: HOSTED.get(fixture.receipt)! })))
      .toEqual(["hosted-master-mismatch"]);
  });
});

describe("digests compare as digests, not as strings", () => {
  it("treats upper and lower case hex as the same bytes", () => {
    const upper = {
      masterSha256: clean.receipt.masterSha256.toUpperCase(),
      receiptDigest: clean.receipt.digest.toUpperCase(),
    };
    expect(codes(signedOff(clean.receipt, { qualityReview: upper, rightsEvidence: upper }))).toEqual([]);
  });

  it("refuses a binding that is not a digest at all", () => {
    expect(codes(signedOff(clean.receipt, { qualityReview: { masterSha256: "not-a-digest", receiptDigest: clean.receipt.digest } })))
      .toEqual(["stale-approval"]);
  });
});

describe("a fixture cannot declare its way out", () => {
  it("recognises a known fixture renderer even when the artifact says isFixture: false", () => {
    expect(selfCleared.receipt.inputs.some((consumed) => consumed.renderer === "offline-card-video-fixture" && !consumed.declaredFixture))
      .toBe(true);
    expect(() => assertPublishable(signedOff(selfCleared.receipt))).toThrow(/fixture-artifact/);
  });
});

describe("every refusal is reported, not just the first", () => {
  it("names the whole distance to publishable in one pass", () => {
    const input = signedOff(fixture.receipt);
    delete input.inspection;
    const found = new Set(codes(input));
    for (const code of ["fixture-artifact", "placeholder-hook", "silent-music-bed", "narration-not-elevenlabs", "narration-voice-not-liam", "no-approval-record"]) {
      expect(found).toContain(code);
    }
    expect(codes(input).length).toBeGreaterThanOrEqual(7);
  });
});
