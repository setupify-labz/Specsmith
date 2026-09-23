// Unit coverage for the gate's own logic. The tests that matter most for the
// defect this closes live in publishing.test.ts, where they run against the
// REAL buildMetricoolPublishingRequest — a gate nobody calls passes its own
// tests indefinitely.

import { describe, expect, it } from "vitest";

import {
  approvalProblems,
  assertPublishable,
  evaluatePublishGate,
  type PublishGateInput,
} from "./publishGate";
import { ELEVENLABS_PROVIDER, sealRenderManifest, type ManifestEntry } from "./renderManifest";

const SHA = "e3a3d07fc5faad39a05f53a935e6aba35d90c19caeaf74ed21cded2b3e282148";
const LIAM = "configured-liam-voice-id";
const NOW = new Date("2026-09-23T12:00:00Z");

const cleanEntries = (): ManifestEntry[] => [
  { taskId: "hook", role: "hook-visual", renderer: "gemini-veo", provider: "google-gemini-api", isFixture: false, sha256: "1".repeat(64), inMaster: true },
  { taskId: "evidence", role: "evidence-visual", renderer: "specsmith-deterministic-ui-render", provider: "playwright-chromium", isFixture: false, sha256: "2".repeat(64), inMaster: true },
  { taskId: "voice", role: "narration", renderer: ELEVENLABS_PROVIDER, provider: ELEVENLABS_PROVIDER, isFixture: false, sha256: "3".repeat(64), inMaster: true, voiceId: LIAM },
  { taskId: "captions", role: "captions", renderer: "specsmith-ass-captions", provider: "specsmith-ass-captions", isFixture: false, sha256: "4".repeat(64), inMaster: true },
  { taskId: "music", role: "music-bed", renderer: "licensed-library", provider: "licensed-library", isFixture: false, sha256: "5".repeat(64), inMaster: true },
  { taskId: "compose", role: "master", renderer: "specsmith-ffmpeg-compositor", provider: "specsmith-ffmpeg-compositor", isFixture: false, sha256: SHA, inMaster: true },
];

const clean = (): PublishGateInput => ({
  manifest: sealRenderManifest(cleanEntries(), SHA),
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
  it("reports manifest problems and nothing derived from them", () => {
    // Judgements about voice or digests read entries that did not validate,
    // so reporting them alongside would be reporting guesses.
    const input = clean();
    input.manifest = sealRenderManifest([{ taskId: "voice", role: "narration" } as ManifestEntry], SHA);
    const verdict = evaluatePublishGate(input);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(new Set(verdict.refusals.map((refusal) => refusal.code))).toEqual(new Set(["malformed-manifest"]));
    }
  });

  it("refuses an absent manifest outright", () => {
    const verdict = evaluatePublishGate({ ...clean(), manifest: undefined as never });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.refusals[0].code).toBe("missing-manifest");
  });

  it("requires exactly one master", () => {
    const entries = [...cleanEntries(), { ...cleanEntries()[5], taskId: "compose-2" }];
    expect(() => assertPublishable({ ...clean(), manifest: sealRenderManifest(entries, SHA) }))
      .toThrow(/master artifacts are present/);
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

describe("a fixture cannot declare its way out", () => {
  it("recognises a known fixture renderer even when the entry says otherwise", () => {
    // Resealing after flipping the flag costs an attacker nothing, so the
    // gate recomputes rather than trusting what the entry claims.
    const entries = cleanEntries().map((entry) =>
      (entry.taskId === "music"
        ? { ...entry, renderer: "offline-silent-bed-fixture", provider: "ffmpeg-offline-fixture", isFixture: false }
        : entry));
    expect(() => assertPublishable({ ...clean(), manifest: sealRenderManifest(entries, SHA) }))
      .toThrow(/fixture-artifact/);
  });
});

describe("every refusal is reported, not just the first", () => {
  it("names the whole distance to publishable in one pass", () => {
    const entries = cleanEntries().map((entry) => {
      if (entry.role === "hook-visual") return { ...entry, renderer: "offline-card-video-fixture", provider: "ffmpeg-offline-fixture", isFixture: true };
      if (entry.role === "narration") return { ...entry, renderer: "local-espeak-tts-fixture", provider: "espeak-ng-offline-fixture", isFixture: true, voiceId: "en-us" };
      if (entry.role === "music-bed") return { ...entry, renderer: "offline-silent-bed-fixture", provider: "ffmpeg-offline-fixture", isFixture: true };
      return entry;
    });
    const input = { ...clean(), manifest: sealRenderManifest(entries, SHA) };
    delete input.inspection;
    const verdict = evaluatePublishGate(input);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      const codes = new Set(verdict.refusals.map((refusal) => refusal.code));
      expect(codes).toContain("fixture-artifact");
      expect(codes).toContain("placeholder-hook");
      expect(codes).toContain("silent-music-bed");
      expect(codes).toContain("narration-not-elevenlabs");
      expect(codes).toContain("no-approval-record");
      expect(verdict.refusals.length).toBeGreaterThanOrEqual(7);
    }
  });
});
