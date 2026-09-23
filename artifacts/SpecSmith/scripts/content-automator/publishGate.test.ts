// Unit coverage for the gate's own logic. The tests that matter most for the
// defect this closes live in publishing.test.ts, where they run against the
// REAL buildMetricoolPublishingRequest — a gate nobody calls passes its own
// tests indefinitely.

import { describe, expect, it } from "vitest";

import {
  approvalProblems,
  assertPublishable,
  ELEVENLABS_RENDERER,
  evaluatePublishGate,
  type ArtifactProvenance,
  type PublishGateInput,
} from "./publishGate";

const SHA = "e3a3d07fc5faad39a05f53a935e6aba35d90c19caeaf74ed21cded2b3e282148";
const LIAM = "configured-liam-voice-id";
const NOW = new Date("2026-09-23T12:00:00Z");

const clean = (): PublishGateInput => ({
  artifacts: [
    { taskId: "voice", role: "narration", renderer: ELEVENLABS_RENDERER, isFixture: false, providerStatus: "approved-paid", voiceId: LIAM },
    { taskId: "compose", role: "master", renderer: "specsmith-ffmpeg-compositor", isFixture: false, providerStatus: "unpaid-first-party", sha256: SHA },
  ],
  reviewedMasterSha256: SHA,
  narrationIdentity: { liamVoiceId: LIAM },
  inspection: { approvedBy: "aaron", approvedAt: "2026-09-23T10:00:00Z", approved: true },
  paidProviderApproval: { approvedBy: "aaron", approvedAt: "2026-09-23T10:00:00Z" },
  now: NOW,
});

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

describe("structural problems stop the gate before it draws conclusions", () => {
  it("reports malformed provenance and nothing derived from it", () => {
    // Judgements about voice or digests read fields that did not validate, so
    // reporting them alongside would be reporting guesses.
    const input = clean();
    input.artifacts = [{ taskId: "voice", role: "narration" } as ArtifactProvenance];
    const verdict = evaluatePublishGate(input);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(new Set(verdict.refusals.map((refusal) => refusal.code))).toEqual(new Set(["malformed-provenance"]));
    }
  });

  it("refuses an empty artifact list outright", () => {
    const verdict = evaluatePublishGate({ ...clean(), artifacts: [] });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.refusals[0].code).toBe("missing-provenance");
  });

  it("requires exactly one master", () => {
    const input = clean();
    input.artifacts = [...input.artifacts, { ...input.artifacts[1], taskId: "compose-2" }];
    expect(() => assertPublishable(input)).toThrow(/Exactly one artifact must declare the master role/);
  });
});

describe("digests compare as digests, not as strings", () => {
  it("treats upper and lower case hex as the same bytes", () => {
    // The surrounding publishing code has normalised case on both sides since
    // before this gate existed; comparing raw strings reintroduced a mismatch
    // it had already fixed.
    const input = clean();
    input.reviewedMasterSha256 = SHA.toUpperCase();
    expect(evaluatePublishGate(input).allowed).toBe(true);
  });

  it("still refuses genuinely different bytes", () => {
    const input = clean();
    input.reviewedMasterSha256 = "f".repeat(64);
    expect(() => assertPublishable(input)).toThrow(/master-sha-mismatch/);
  });
});

describe("every refusal is reported, not just the first", () => {
  it("names the whole distance to publishable in one pass", () => {
    const input = clean();
    input.artifacts = [
      { taskId: "hook", role: "hook-visual", renderer: "offline-card-video-fixture", isFixture: true, providerStatus: "unapproved" },
      { taskId: "voice", role: "narration", renderer: "local-espeak-tts-fixture", isFixture: true, providerStatus: "unapproved", voiceId: "en-us" },
      { taskId: "music", role: "music-bed", renderer: "offline-silent-bed-fixture", isFixture: true, providerStatus: "unapproved" },
      { taskId: "compose", role: "master", renderer: "specsmith-ffmpeg-compositor", isFixture: false, providerStatus: "unpaid-first-party", sha256: SHA },
    ];
    delete input.inspection;
    const verdict = evaluatePublishGate(input);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      const codes = new Set(verdict.refusals.map((refusal) => refusal.code));
      expect(codes).toContain("fixture-artifact");
      expect(codes).toContain("placeholder-hook");
      expect(codes).toContain("silent-music-bed");
      expect(codes).toContain("narration-not-elevenlabs");
      expect(codes).toContain("unapproved-provider");
      expect(codes).toContain("no-approval-record");
      expect(verdict.refusals.length).toBeGreaterThanOrEqual(8);
    }
  });
});
