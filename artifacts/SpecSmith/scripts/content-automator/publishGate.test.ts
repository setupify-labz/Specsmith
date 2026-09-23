// A gate is only worth having if it refuses. Most of these tests build a
// draft that is publishable in every respect but one, and check that the one
// is enough — because the failure mode that matters is not "refuses
// everything", it is "let one thing through".

import { describe, expect, it } from "vitest";

import {
  APPROVED_NARRATION_VOICE,
  assertPublishable,
  evaluatePublishGate,
  type InspectionRecord,
  type PublishGateInput,
} from "./publishGate";
import type { RenderArtifact } from "./rendering";

const SHA = "e3a3d07fc5faad39a05f53a935e6aba35d90c19caeaf74ed21cded2b3e282148";

const artifact = (over: Partial<RenderArtifact> & { metadata?: Record<string, unknown> } = {}): RenderArtifact => ({
  artifactId: "a", taskId: "t", kind: "video", uri: "file:///a.mp4", mimeType: "video/mp4",
  metadata: {}, ...over,
} as RenderArtifact);

/** A draft that clears every condition. Each test spoils exactly one. */
const publishable = (): PublishGateInput => ({
  masterSha256: SHA,
  inspection: { masterSha256: SHA, inspectedBy: "aaron", inspectedAt: "2026-09-23T21:00:00Z", approved: true },
  artifacts: [
    artifact({ taskId: "beat-1", kind: "video", metadata: { renderer: "gemini-veo" } }),
    artifact({ taskId: "voice", kind: "audio", metadata: { renderer: "elevenlabs-tts", voice: APPROVED_NARRATION_VOICE } }),
    artifact({ taskId: "compose", kind: "video", metadata: { renderer: "specsmith-ffmpeg-compositor" } }),
  ],
});

describe("the gate lets a genuinely clean render through", () => {
  it("allows publication when every condition is affirmatively met", () => {
    const verdict = evaluatePublishGate(publishable());
    expect(verdict).toEqual({ allowed: true, masterSha256: SHA });
    expect(assertPublishable(publishable())).toBe(SHA);
  });
});

describe("each condition alone makes publishing impossible", () => {
  const spoil = (input: PublishGateInput): string[] => {
    const verdict = evaluatePublishGate(input);
    expect(verdict.allowed).toBe(false);
    return verdict.allowed ? [] : verdict.refusals.map((refusal) => refusal.code);
  };

  it("refuses any artifact that labels itself a fixture", () => {
    const input = publishable();
    (input.artifacts[0].metadata as Record<string, unknown>).isFixture = true;
    expect(spoil(input)).toContain("fixture-artifact");
  });

  it("refuses the silent music bed", () => {
    const input = publishable();
    input.artifacts = [...input.artifacts, artifact({
      taskId: "music", kind: "audio",
      metadata: { renderer: "offline-silent-bed-fixture", isSilent: true, requiresLicensedReplacement: true, voice: APPROVED_NARRATION_VOICE },
    })];
    expect(spoil(input)).toContain("silent-music-bed");
  });

  it("refuses the placeholder hook card", () => {
    const input = publishable();
    (input.artifacts[0].metadata as Record<string, unknown>).renderer = "offline-card-video-fixture";
    expect(spoil(input)).toContain("placeholder-hook");
  });

  it("refuses narration that is not Liam", () => {
    const input = publishable();
    (input.artifacts[1].metadata as Record<string, unknown>).voice = "en-us";
    expect(spoil(input)).toContain("non-liam-narration");
  });

  it("refuses narration whose voice is not recorded at all", () => {
    // Unidentified is not "probably fine". The gate has to see Liam, not
    // merely fail to see something else.
    const input = publishable();
    delete (input.artifacts[1].metadata as Record<string, unknown>).voice;
    expect(spoil(input)).toContain("non-liam-narration");
  });

  it("refuses a paid provider with no recorded approval to spend", () => {
    const input = publishable();
    (input.artifacts[0].metadata as Record<string, unknown>).isPaidProvider = true;
    expect(spoil(input)).toContain("unapproved-paid-provider");
  });

  it("allows a paid provider once the spend is approved", () => {
    const input = publishable();
    (input.artifacts[0].metadata as Record<string, unknown>).isPaidProvider = true;
    input.paidProviderApproval = { approvedBy: "aaron", approvedAt: "2026-09-23T21:00:00Z" };
    expect(evaluatePublishGate(input).allowed).toBe(true);
  });

  it("refuses bytes that no inspection record covers", () => {
    const input = publishable();
    delete input.inspection;
    expect(spoil(input)).toContain("no-approval-record");
  });

  it("refuses when the inspection covers DIFFERENT bytes", () => {
    // The exact defect the sha-binding exists for: a real inspection, of a
    // real render, that is not this one.
    const input = publishable();
    (input.inspection as InspectionRecord).masterSha256 = "0".repeat(64);
    expect(spoil(input)).toContain("unapproved-master-sha");
  });

  it("refuses when the inspection recorded a rejection", () => {
    const input = publishable();
    (input.inspection as InspectionRecord).approved = false;
    expect(spoil(input)).toContain("unapproved-master-sha");
  });
});

describe("the gate refuses the actual draft this repository renders", () => {
  /** The real artifact metadata `content:e2e:storyboard` produces today. */
  const currentDraft = (): PublishGateInput => ({
    masterSha256: SHA,
    artifacts: [
      artifact({ taskId: "beat-1-visual", kind: "video", metadata: { renderer: "offline-card-video-fixture", isFixture: true, isPaidProvider: false } }),
      artifact({ taskId: "beat-2-visual", kind: "image", metadata: { renderer: "specsmith-ui-render" } }),
      artifact({ taskId: "voice", kind: "audio", metadata: { renderer: "local-espeak-tts-fixture", voice: "en-us", isFixture: true, isPaidProvider: false } }),
      artifact({ taskId: "audio", kind: "audio", metadata: { renderer: "offline-silent-bed-fixture", isSilent: true, requiresLicensedReplacement: true, isFixture: true } }),
      artifact({ taskId: "compose", kind: "video", metadata: { renderer: "specsmith-ffmpeg-compositor" } }),
    ],
  });

  it("is impossible to publish, for every reason at once", () => {
    const verdict = evaluatePublishGate(currentDraft());
    expect(verdict.allowed).toBe(false);
    const codes = verdict.allowed ? [] : new Set(verdict.refusals.map((refusal) => refusal.code));
    expect(codes).toContain("fixture-artifact");
    expect(codes).toContain("placeholder-hook");
    expect(codes).toContain("silent-music-bed");
    expect(codes).toContain("non-liam-narration");
    expect(codes).toContain("no-approval-record");
  });

  it("reports every refusal at once rather than one at a time", () => {
    // One pass tells a person the whole distance to publishable.
    const verdict = evaluatePublishGate(currentDraft());
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.refusals.length).toBeGreaterThanOrEqual(5);
  });

  it("throws from assertPublishable, naming each reason", () => {
    expect(() => assertPublishable(currentDraft())).toThrow(/Publication refused/);
    expect(() => assertPublishable(currentDraft())).toThrow(/fixture-artifact/);
    expect(() => assertPublishable(currentDraft())).toThrow(/non-liam-narration/);
  });

  it("stays refused even after the bytes are inspected and approved", () => {
    // Inspection clears ONE condition. A signed-off fixture render is still a
    // fixture render — this is the composition that a per-check gate would
    // have let slip.
    const input = currentDraft();
    input.inspection = { masterSha256: SHA, inspectedBy: "aaron", inspectedAt: "2026-09-23T21:00:00Z", approved: true };
    const verdict = evaluatePublishGate(input);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      const codes = verdict.refusals.map((refusal) => refusal.code);
      expect(codes).not.toContain("no-approval-record");
      expect(codes).toContain("fixture-artifact");
    }
  });
});
