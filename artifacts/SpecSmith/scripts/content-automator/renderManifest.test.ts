// Built from REAL adapter output wherever an adapter can run here.
//
// The defect that produced this file was a translator that read `renderer`
// and `voice` while the ElevenLabs adapter emits `provider` and `voiceId`.
// Every test passed, because every test handed the translator a handcrafted
// record shaped the way the translator expected. Handcrafted provenance tests
// the test author's belief about an adapter, not the adapter.
//
// So the offline adapters are invoked for real and their artifacts are fed
// in unmodified. ElevenLabs cannot be invoked — it is a paid call with no
// credential here — so its metadata shape is pinned by reading the adapter's
// own source, which fails if the field names ever move again.

import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLocalFixtureTtsAdapter } from "./localFixtureTts";
import { createOfflineCardVideoAdapter, createOfflineSilentBedAdapter } from "./offlineBeatFixtures";
import {
  describeArtifact,
  hashArtifactBytes,
  manifestProblems,
  manifestSealIsIntact,
  sealRenderManifest,
  ELEVENLABS_PROVIDER,
  type ManifestEntry,
} from "./renderManifest";
import type { RenderTaskContext } from "./rendering";
import type { ProductionTask, VideoPlatform } from "./types";

let workDir = "";
beforeAll(async () => { workDir = await mkdtemp(join(tmpdir(), "specsmith-manifest-")); });
afterAll(async () => { if (workDir) await rm(workDir, { recursive: true, force: true }); });

const context = (taskId: string, over: Partial<ProductionTask> = {}): RenderTaskContext => ({
  packageId: "pkg", campaignId: "camp", ideaId: "compare-rtx4080s-rtx4080",
  platform: "youtube-shorts" as VideoPlatform, targetDurationSeconds: 24,
  task: {
    taskId, capability: "video-generation", sourceBeat: 0,
    purpose: "p", inputRequirements: [], outputRequirements: [], ...over,
  },
  dependencyArtifacts: [],
});

describe("provenance is read from what adapters ACTUALLY emit", () => {
  it("reads the espeak fixture's real metadata, including its voice key", async () => {
    const adapter = createLocalFixtureTtsAdapter({ outputDir: join(workDir, "tts") });
    const [artifact] = await adapter.render(context("youtube-shorts-voice", {
      capability: "text-to-speech",
      // The TTS adapters read their script from inputRequirements.
      inputRequirements: ["Pick the faster card before the names show."],
    }));
    const entry = describeArtifact(artifact, "narration", await hashArtifactBytes(artifact), true);

    expect(entry.renderer).toBe("local-espeak-tts-fixture");
    expect(entry.provider).toBe("espeak-ng-offline-fixture");
    expect(entry.isFixture).toBe(true);
    expect(entry.voiceId).toBe("en-us");
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);

  it("reads the card fixture's real metadata", async () => {
    const adapter = createOfflineCardVideoAdapter({ outputDir: join(workDir, "card") });
    const [artifact] = await adapter.render(context("youtube-shorts-beat-1-visual"));
    const entry = describeArtifact(artifact, "hook-visual", await hashArtifactBytes(artifact), true);
    expect(entry.renderer).toBe("offline-card-video-fixture");
    expect(entry.isFixture).toBe(true);
  }, 60_000);

  it("reads the silent bed's real metadata", async () => {
    const adapter = createOfflineSilentBedAdapter({ outputDir: join(workDir, "bed") });
    const [artifact] = await adapter.render(context("youtube-shorts-audio", { capability: "music-sfx" }));
    const entry = describeArtifact(artifact, "music-bed", await hashArtifactBytes(artifact), true);
    expect(entry.renderer).toBe("offline-silent-bed-fixture");
    expect(entry.isFixture).toBe(true);
  }, 60_000);

  it("reads ElevenLabs' provider/voiceId shape, which is NOT renderer/voice", async () => {
    // THE BUG THIS FILE EXISTS FOR. elevenLabsTts.ts emits `provider` and
    // `voiceId`; an earlier translator read `renderer` and `voice`. Against a
    // genuine ElevenLabs render that meant no renderer and no voice id, so the
    // gate would have refused the real thing as an unidentifiable fixture.
    const artifact = {
      artifactId: "a", taskId: "youtube-shorts-voice", kind: "audio" as const,
      uri: "file:///nonexistent.mp3", mimeType: "audio/mpeg",
      metadata: { provider: ELEVENLABS_PROVIDER, voiceId: "liam-voice-id", modelId: "m", bytes: 1 },
    };
    const entry = describeArtifact(artifact, "narration", "a".repeat(64), true);
    expect(entry.provider).toBe(ELEVENLABS_PROVIDER);
    expect(entry.voiceId).toBe("liam-voice-id");
    // No `renderer` key at all, so renderer falls back to the provider rather
    // than reading as blank and tripping the "no source recorded" refusal.
    expect(entry.renderer).toBe(ELEVENLABS_PROVIDER);
    expect(entry.isFixture).toBe(false);
  });

  it("pins the ElevenLabs metadata field names against a future rename", () => {
    // Its adapter cannot be invoked here, so the shape is asserted from the
    // source. If the keys move again this fails instead of the gate silently
    // refusing every real narration.
    const source = readFileSync(new URL("./elevenLabsTts.ts", import.meta.url), "utf-8");
    expect(source).toMatch(/provider:\s*"elevenlabs"/);
    expect(source).toMatch(/voiceId:\s*config\.voiceId/);
  });

  it("refuses to hash bytes it cannot read", async () => {
    const missing = {
      artifactId: "a", taskId: "t", kind: "video" as const,
      uri: "file:///definitely/not/here.mp4", mimeType: "video/mp4", metadata: {},
    };
    expect(await hashArtifactBytes(missing)).toBe("");
  });
});

const entry = (over: Partial<ManifestEntry> = {}): ManifestEntry => ({
  taskId: "t", role: "evidence-visual", renderer: "specsmith-deterministic-ui-render",
  provider: "playwright-chromium", isFixture: false, sha256: "a".repeat(64), inMaster: true, ...over,
});

/** A structurally complete manifest: one of every required role. */
const completeEntries = (): ManifestEntry[] => [
  entry({ taskId: "hook", role: "hook-visual" }),
  entry({ taskId: "evidence", role: "evidence-visual" }),
  entry({ taskId: "voice", role: "narration", provider: ELEVENLABS_PROVIDER, renderer: ELEVENLABS_PROVIDER, voiceId: "liam" }),
  entry({ taskId: "captions", role: "captions", renderer: "specsmith-ass-captions" }),
  entry({ taskId: "music", role: "music-bed", renderer: "licensed-library" }),
  entry({ taskId: "compose", role: "master", renderer: "specsmith-ffmpeg-compositor", sha256: "b".repeat(64) }),
];

describe("the seal makes tampering visible", () => {
  it("verifies a manifest it sealed itself", () => {
    const manifest = sealRenderManifest(completeEntries(), "b".repeat(64));
    expect(manifestSealIsIntact(manifest)).toBe(true);
    expect(manifestProblems(manifest)).toEqual([]);
  });

  it("breaks when an entry is REMOVED", () => {
    // The omission attack: hand the gate a shorter list and every remaining
    // entry is clean.
    const manifest = sealRenderManifest(completeEntries(), "b".repeat(64));
    const shortened = { ...manifest, entries: manifest.entries.filter((e) => e.taskId !== "music") };
    expect(manifestSealIsIntact(shortened)).toBe(false);
  });

  it("breaks when an entry is ADDED", () => {
    const manifest = sealRenderManifest(completeEntries(), "b".repeat(64));
    const padded = { ...manifest, entries: [...manifest.entries, entry({ taskId: "extra" })] };
    expect(manifestSealIsIntact(padded)).toBe(false);
  });

  it("breaks when an entry is EDITED", () => {
    const manifest = sealRenderManifest(completeEntries(), "b".repeat(64));
    const edited = {
      ...manifest,
      entries: manifest.entries.map((e) => (e.taskId === "voice" ? { ...e, isFixture: false, voiceId: "liam" } : e)),
    };
    // Editing a clean entry to another clean value still breaks the seal.
    expect(manifestSealIsIntact({ ...edited, entries: edited.entries.map((e) => ({ ...e, renderer: "x" })) })).toBe(false);
  });

  it("does not depend on the order entries were assembled in", () => {
    const forward = sealRenderManifest(completeEntries(), "b".repeat(64));
    const reversed = sealRenderManifest([...completeEntries()].reverse(), "b".repeat(64));
    expect(reversed.seal).toBe(forward.seal);
  });
});

describe("structural refusals", () => {
  const problemsFor = (entries: ManifestEntry[], master = "b".repeat(64)) =>
    manifestProblems(sealRenderManifest(entries, master));

  it("refuses a duplicated task id", () => {
    const entries = [...completeEntries(), entry({ taskId: "hook", role: "evidence-visual" })];
    expect(problemsFor(entries).join(" ")).toMatch(/hook appears more than once/);
  });

  it("refuses an unhashed artifact", () => {
    const entries = completeEntries().map((e) => (e.taskId === "captions" ? { ...e, sha256: "" } : e));
    expect(problemsFor(entries).join(" ")).toMatch(/captions is unhashed/);
  });

  it("refuses an artifact that is not part of the master", () => {
    const entries = completeEntries().map((e) => (e.taskId === "evidence" ? { ...e, inMaster: false } : e));
    expect(problemsFor(entries).join(" ")).toMatch(/not part of the master/);
  });

  it("refuses an unknown role", () => {
    const entries = completeEntries().map((e) =>
      (e.taskId === "evidence" ? { ...e, role: "b-roll" as ManifestEntry["role"] } : e));
    expect(problemsFor(entries).join(" ")).toMatch(/unknown role/);
  });

  it("refuses an artifact recording neither renderer nor provider", () => {
    const entries = completeEntries().map((e) =>
      (e.taskId === "evidence" ? { ...e, renderer: "", provider: "" } : e));
    expect(problemsFor(entries).join(" ")).toMatch(/neither a renderer nor a provider/);
  });

  it("refuses a second master", () => {
    const entries = [...completeEntries(), entry({ taskId: "compose-2", role: "master" })];
    expect(problemsFor(entries).join(" ")).toMatch(/master artifacts are present/);
  });

  it("names every required role that is missing", () => {
    for (const role of ["hook-visual", "evidence-visual", "narration", "captions", "music-bed", "master"] as const) {
      const entries = completeEntries().filter((e) => e.role !== role);
      expect(problemsFor(entries).join(" "), role).toMatch(new RegExp(`no ${role} artifact is present`));
    }
  });

  it("refuses when the master entry's digest is not the manifest's", () => {
    const entries = completeEntries().map((e) => (e.role === "master" ? { ...e, sha256: "c".repeat(64) } : e));
    expect(problemsFor(entries).join(" ")).toMatch(/not the manifest's master digest/);
  });
});
