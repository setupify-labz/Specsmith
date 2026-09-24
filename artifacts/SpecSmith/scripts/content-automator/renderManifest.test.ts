// The provenance vocabulary and the dependency record.
//
// Provenance is read from what adapters ACTUALLY emit. The defect behind this
// file was a translator that read `renderer` and `voice` while the ElevenLabs
// adapter emits `provider` and `voiceId`; every test passed because every
// test handed it a handcrafted record. So the offline adapters are invoked
// for real and rendered through the real compositor, and the receipt's
// provenance is asserted. ElevenLabs cannot be invoked (paid, no credential),
// so its metadata shape is pinned by reading the adapter's own source.

// MUST STAY FIRST, AND MUST STAY A SIDE-EFFECT IMPORT: it installs the fake
// network before any adapter captures fetch.
import "./publishBoundary.fakeNetwork";

import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dependencyRecordFor, ELEVENLABS_PROVIDER, FIXTURE_SOURCES } from "./renderManifest";
import { renderControl, type ControlRender } from "./publishBoundary.testkit";

let clean: ControlRender;
let fixture: ControlRender;
beforeAll(async () => {
  clean = await renderControl();
  fixture = await renderControl({ fixtureNarration: true, fixtureMusic: true, fixtureHook: true });
}, 120_000);
afterAll(async () => {
  for (const control of [clean, fixture]) if (control) await rm(control.dir, { recursive: true, force: true });
});

const input = (control: ControlRender, role: string) =>
  control.receipt.inputs.find((consumed) => consumed.role === role)!;

describe("the receipt records provenance from what adapters ACTUALLY emit", () => {
  it("reads the espeak fixture's real metadata, including its voice key", () => {
    const voice = input(fixture, "narration");
    expect(voice.renderer).toBe("local-espeak-tts-fixture");
    expect(voice.provider).toBe("espeak-ng-offline-fixture");
    expect(voice.declaredFixture).toBe(true);
    expect(voice.voiceId).toBe("en-us");
    expect(voice.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reads the card fixture's and the silent bed's real metadata", () => {
    expect(input(fixture, "hook-visual").renderer).toBe("offline-card-video-fixture");
    expect(input(fixture, "music-bed").renderer).toBe("offline-silent-bed-fixture");
    for (const role of ["hook-visual", "narration", "music-bed"]) {
      const consumed = input(fixture, role);
      expect(FIXTURE_SOURCES.has(consumed.renderer) || FIXTURE_SOURCES.has(consumed.provider)).toBe(true);
    }
  });

  it("reads ElevenLabs' provider/voiceId shape, which is NOT renderer/voice", () => {
    // The control narration carries only `provider` and `voiceId`, as
    // elevenLabsTts.ts emits. The renderer falls back to the provider rather
    // than reading blank and tripping the no-provenance refusal.
    const voice = input(clean, "narration");
    expect(voice.provider).toBe(ELEVENLABS_PROVIDER);
    expect(voice.renderer).toBe(ELEVENLABS_PROVIDER);
    expect(voice.voiceId).toBe("test-liam-voice-id");
    expect(voice.declaredFixture).toBe(false);
  });

  it("pins the ElevenLabs metadata field names against a future rename", () => {
    const source = readFileSync(new URL("./elevenLabsTts.ts", import.meta.url), "utf-8");
    expect(source).toMatch(/provider:\s*"elevenlabs"/);
    expect(source).toMatch(/voiceId:\s*config\.voiceId/);
  });
});

describe("the dependency record is data, not trust", () => {
  it("copies the receipt's inputs, master and digest exactly", () => {
    const record = dependencyRecordFor(clean.receipt);
    expect(record.masterSha256).toBe(clean.receipt.masterSha256);
    expect(record.receiptDigest).toBe(clean.receipt.digest);
    expect(record.dependencies).toEqual(clean.receipt.inputs.map((consumed) => ({
      taskId: consumed.taskId, role: consumed.role, resolvedPath: consumed.resolvedPath, sha256: consumed.sha256,
    })));
  });

  it("returns a mutable copy, so editing it cannot touch the frozen receipt", () => {
    const record = dependencyRecordFor(clean.receipt);
    record.dependencies[0].sha256 = "0".repeat(64);
    expect(clean.receipt.inputs[0].sha256).not.toBe("0".repeat(64));
  });

  it("exports no way to seal or mint provenance", async () => {
    const manifestModule = await import("./renderManifest");
    expect(Object.keys(manifestModule).sort()).toEqual([
      "ELEVENLABS_PROVIDER", "FIXTURE_SOURCES", "RECEIPT_ROLES", "REQUIRED_ROLE_COUNTS", "dependencyRecordFor",
    ]);
  });
});
