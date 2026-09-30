// publishReady may rest only on bytes that were actually read and hashed, on a
// quality review of THOSE bytes, and on human decisions from a trusted record.
// On #165 each case below produced publishReady: true.

import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildContentCreativeReport, NO_TRUSTED_APPROVAL_RECORD, type HumanGate } from "./contentCreativeReport.ts";
import { HUMAN_ONLY_DIMENSIONS, reviewCreativeQuality } from "./creativeQualityReview.ts";
import { isVerifiedMedia, MediaVerificationError, verifyRenderedMedia, type VerifiedMedia } from "./mediaVerification.ts";
import type { CaptionCue } from "../captionRender.ts";
import type { PlatformScriptStoryboard, StoryboardBeat } from "../types.ts";

const NOW = new Date("2026-09-14T00:00:00.000Z");
const dir = mkdtempSync(join(tmpdir(), "media-binding-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function render(name: string, bytes: string): VerifiedMedia {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return verifyRenderedMedia(path, NOW);
}

const beat = (overrides: Partial<StoryboardBeat> & Pick<StoryboardBeat, "startSecond" | "endSecond" | "purpose">): StoryboardBeat => ({
  narration: "SpecSmith holds the rest of the build constant.",
  visualDirection: `unique direction ${overrides.startSecond}`,
  onScreenText: "REAL SPECS",
  factDependencies: [],
  ...overrides,
});
const storyboard: PlatformScriptStoryboard = {
  platform: "youtube-shorts",
  targetDurationSeconds: 24,
  title: "RTX 4080 Super vs RTX 4080",
  narrationStyle: "direct",
  beats: [
    beat({ startSecond: 0, endSecond: 2, purpose: "hook", onScreenText: "Names hidden" }),
    beat({ startSecond: 2, endSecond: 8, purpose: "commitment", onScreenText: "LOCK YOUR PICK" }),
    beat({ startSecond: 8, endSecond: 16, purpose: "evidence", onScreenText: "REAL SPECS" }),
    beat({ startSecond: 16, endSecond: 24, purpose: "cta", onScreenText: "OPEN COMPARE", narration: "Open /compare and change the cards." }),
  ],
  finalCta: "Open SpecSmith Compare.",
  factualGuardrails: [],
};
const cues = (board: PlatformScriptStoryboard): CaptionCue[] =>
  board.beats.map((entry) => ({ startSecond: entry.startSecond, endSecond: entry.endSecond, text: entry.onScreenText }));
const reviewOf = (mediaSha256: string | null) => reviewCreativeQuality({
  creativeId: "creative-1", packageId: "pkg-1", storyboard, captionCues: cues(storyboard), ctaRoute: "/compare", mediaSha256, now: NOW,
});
const GATES = [...HUMAN_ONLY_DIMENSIONS, "audio-listening-review"];
const approvals = (mediaSha256: string, decision: Partial<NonNullable<HumanGate["decision"]>> = {}) =>
  Object.fromEntries(GATES.map((gate) => [gate, { by: "aaron", at: NOW.toISOString(), outcome: "approved", mediaSha256, ...decision }])) as
    Record<string, HumanGate["decision"]>;
const report = (input: Partial<Parameters<typeof buildContentCreativeReport>[0]>) =>
  buildContentCreativeReport({ review: reviewOf(null), fingerprint: null, now: NOW, ...input });

describe("rendered media is verified from its bytes", () => {
  it("hashes the actual file, and refuses a path with nothing at it", () => {
    const media = render("a.mp4", "render A");
    expect(media.sha256).toBe(sha("render A"));
    expect(isVerifiedMedia(media)).toBe(true);
    expect(() => verifyRenderedMedia(join(dir, "missing.mp4"))).toThrow(MediaVerificationError);
    writeFileSync(join(dir, "empty.mp4"), "");
    expect(() => verifyRenderedMedia(join(dir, "empty.mp4"))).toThrow(/empty/);
  });

  it("refuses a plausible hash for a file that does not exist", () => {
    const plausible = "a".repeat(64);
    const forged = { path: join(dir, "missing.mp4"), sha256: plausible, bytes: 1, verifiedAt: NOW.toISOString() };
    const result = report({ review: reviewOf(plausible), media: forged, recordedHumanDecisions: approvals(plausible) });
    expect(result.publishReady).toBe(false);
    expect(result.identity.mediaVerified).toBe(false);
    expect(result.blockedBy.join(" ")).toMatch(/not produced by verifyRenderedMedia/);
  });

  it("refuses media whose file changed after review", () => {
    const media = render("changed.mp4", "render as reviewed");
    const review = reviewOf(media.sha256);
    writeFileSync(media.path, "render edited afterwards");
    const result = report({ review, media, recordedHumanDecisions: approvals(media.sha256) });
    expect(result.publishReady).toBe(false);
    expect(result.identity.mediaVerified).toBe(false);
    expect(result.blockedBy.join(" ")).toMatch(/changed after it was verified/);
  });

  it("refuses a quality review with no media binding", () => {
    const media = render("unbound.mp4", "render with an unbound review");
    const result = report({ review: reviewOf(null), media, recordedHumanDecisions: approvals(media.sha256) });
    expect(result.publishReady).toBe(false);
    expect(result.blockedBy.join(" ")).toMatch(/quality review has no media binding/);
  });

  it("refuses a quality review of other bytes", () => {
    const media = render("reviewed-other.mp4", "render B");
    const result = report({ review: reviewOf(sha("render C")), media, recordedHumanDecisions: approvals(media.sha256) });
    expect(result.publishReady).toBe(false);
    expect(result.blockedBy.join(" ")).toMatch(/quality review measured other media/);
  });
});

describe("human approvals", () => {
  it("does not count an approval of a different render", () => {
    const media = render("current.mp4", "current render");
    const result = report({ review: reviewOf(media.sha256), media, recordedHumanDecisions: approvals(sha("earlier render")) });
    expect(result.publishReady).toBe(false);
    expect(result.blockedBy.join(" ")).toMatch(/made about other media/);
  });

  it("does not accept an anonymous, undated or future-dated approval", () => {
    const media = render("dated.mp4", "dated render");
    for (const bad of [{ by: " " }, { at: "not a date" }, { at: new Date(NOW.getTime() + 86_400_000).toISOString() }]) {
      const result = report({ review: reviewOf(media.sha256), media, recordedHumanDecisions: approvals(media.sha256, bad) });
      expect(result.publishReady, JSON.stringify(bad)).toBe(false);
    }
  });

  it("does not close any gate from a caller-supplied name and time, however complete", () => {
    const media = render("complete.mp4", "complete render");
    const result = report({ review: reviewOf(media.sha256), media, recordedHumanDecisions: approvals(media.sha256) });
    expect(result.identity.mediaVerified).toBe(true);
    expect(result.blockedBy).toEqual(result.humanGates.map((gate) => `Human gate ${gate.gate}: ${NO_TRUSTED_APPROVAL_RECORD}.`));
    expect(result.publishReady).toBe(false);
  });

  it("still honours a recorded rejection: refusing to proceed never needs proof", () => {
    const media = render("rejected.mp4", "rejected render");
    const decisions = { ...approvals(media.sha256), "audio-listening-review": { by: "aaron", at: NOW.toISOString(), outcome: "rejected" as const } };
    const result = report({ review: reviewOf(media.sha256), media, recordedHumanDecisions: decisions });
    expect(result.blockedBy.join(" ")).toMatch(/Human gate rejected: audio-listening-review/);
  });
});
