// Bypass attempts against the publish-provenance boundary, driven through the
// REAL Metricool request builder with REAL compositor renders.
//
// Every attack here is one the previous design admitted: a caller-accessible
// seal, inputs "hashed" with the master's digest, artifacts marked as in the
// master without proof, and sign-offs not tied to the exact bytes. Each test
// names the refusal code it expects, so a test that passes for the wrong
// reason — the failure mode this subsystem keeps reproducing — is visible.
//
// publishBoundaryMutations.mjs re-introduces each original defect and runs
// this file, to show these tests are not inert.

// MUST STAY FIRST, AND MUST STAY A SIDE-EFFECT IMPORT: it installs the fake
// network before any adapter captures fetch. esbuild drops a named import
// whose binding is unused, which silently reorders the install.
import "./publishBoundary.fakeNetwork.ts";
import { fakeNetwork } from "./publishBoundary.fakeNetwork.ts";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isVerifiedHostedMaster, uploadAndVerifyMaster, type HostedMaster, type MasterUploader } from "./hostedMaster.ts";
import { isIssuedRenderReceipt, renderReceiptFor, type RenderReceipt } from "./motionCompositor.ts";
import { buildMetricoolPublishingRequest, type PublishingGateInput } from "./publishing.ts";
import { dependencyRecordFor, type DependencyRecord } from "./renderManifest.ts";
import {
  appendByte,
  CONTROL_LIAM_VOICE_ID,
  controlUploader,
  hostControl,
  substitutingUploader,
  CONTROL_TASKS,
  contentPackage,
  dimensions,
  fingerprint,
  idea,
  renderControl,
  type ControlRender,
} from "./publishBoundary.testkit.ts";

const NOW = new Date("2026-08-23T00:00:00Z");
const APPROVED_AT = "2026-09-20T10:00:00.000Z";
const CONFIG = {
  blogId: "6769542",
  timezone: "America/New_York",
  siteBaseUrl: "https://example.specsmithpc.test",
  connectedNetworks: ["instagram", "tiktok", "youtube"] as ("instagram" | "tiktok" | "youtube")[],
};

const sha256File = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

/**
 * An attacker's reimplementation of the compositor's private canonical form.
 * Kept here, not exported from the compositor, to show that knowing the
 * digest algorithm does not help: the registry, not the digest, is the check.
 */
function forgeDigest(receipt: Omit<RenderReceipt, "digest">): string {
  const inputs = [...receipt.inputs]
    .map((input) => ({
      taskId: input.taskId, role: input.role, resolvedPath: input.resolvedPath, sha256: input.sha256,
      bytes: input.bytes, kind: input.kind, mimeType: input.mimeType,
      timeline: input.timeline.map((use) => [use.index, use.startSecond, use.endSecond]),
      frames: input.frames.map((frame) => [frame.resolvedPath, frame.sha256]),
      renderer: input.renderer, provider: input.provider, declaredFixture: input.declaredFixture, voiceId: input.voiceId,
      evidence: input.evidence === null ? null : [
        input.evidence.issuer, input.evidence.sha256Matches, input.evidence.voiceId,
        input.evidence.modelId, input.evidence.endpointOrigin, input.evidence.requestId,
      ],
    }))
    .sort((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0));
  const p = receipt.parameters;
  const canonical = JSON.stringify({
    version: receipt.version, packageId: receipt.packageId, platform: receipt.platform,
    composeTaskId: receipt.composeTaskId, masterPath: receipt.masterPath, masterSha256: receipt.masterSha256,
    masterBytes: receipt.masterBytes,
    parameters: [
      p.width, p.height, p.fps, p.crf, p.preset, p.plannedDurationSeconds, p.finalDurationSeconds,
      p.captionsBurnedIn, p.musicIncluded, p.voiceGain, p.musicGain, p.ffmpegPath, p.ffprobePath,
    ],
    inputs,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

const bound = (receipt: RenderReceipt) => ({ masterSha256: receipt.masterSha256, receiptDigest: receipt.digest });

/** Every sign-off bound to `receipt`, unless overridden. */
function gateFor(receipt: RenderReceipt, over: Partial<PublishingGateInput> = {}): PublishingGateInput {
  return {
    qualityReview: {
      packageId: contentPackage.packageId,
      platform: "tiktok",
      decision: "pass",
      publishable: true,
      overallScore: 9.2,
      dimensionScores: { ...dimensions },
      issues: [],
      regenerateTaskIds: [],
      reviewedMediaSha256: receipt.masterSha256,
      reviewedReceiptDigest: receipt.digest,
    },
    assetBundle: {
      publishable: true,
      missingAssetIds: [],
      untrackedAssetIds: [],
      nonApprovedAssetIds: [],
      approvedMasterSha256: receipt.masterSha256,
      approvedMasterUri: "https://cdn.specsmithpc.com/masters/control.mp4",
      approvedReceiptDigest: receipt.digest,
    },
    renderReceipt: receipt,
    dependencyRecord: dependencyRecordFor(receipt),
    hostedMaster: HOSTED.get(receipt) as HostedMaster,
    narrationIdentity: { liamVoiceId: CONTROL_LIAM_VOICE_ID },
    inspection: { approvedBy: "aaron", approvedAt: APPROVED_AT, approved: true, ...bound(receipt) },
    paidProviderApproval: { approvedBy: "aaron", approvedAt: APPROVED_AT, ...bound(receipt) },
    ...over,
  };
}

const build = (gate: PublishingGateInput) => buildMetricoolPublishingRequest(
  idea, contentPackage, fingerprint("tiktok"), gate, CONFIG, "2026-08-24T18:00:00", NOW,
);

/** The refusal codes the builder threw with, or [] if it built a request. */
async function refusalCodes(gate: PublishingGateInput): Promise<string[]> {
  try {
    await build(gate);
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const codes = [...message.matchAll(/\[([a-z-]+)\]/g)].map((match) => match[1]);
    return codes.length > 0 ? codes : [`non-gate-error: ${message}`];
  }
}

const pathOf = (control: ControlRender, taskId: string): string =>
  fileURLToPath(control.artifacts[taskId].uri);

/**
 * Every render is uploaded to the controlled host and verified as soon as it
 * exists, so each gate below has a genuine HostedMaster for its receipt and
 * the hosting check is never what an unrelated test is refused for.
 */
const HOSTED = new WeakMap<RenderReceipt, HostedMaster>();
const renders: ControlRender[] = [];
async function fresh(options?: Parameters<typeof renderControl>[0]): Promise<ControlRender> {
  const control = await renderControl(options);
  renders.push(control);
  HOSTED.set(control.receipt, await hostControl(control));
  return control;
}

let clean: ControlRender;
let fixture: ControlRender;
beforeAll(async () => {
  clean = await fresh();
  fixture = await fresh({ fixtureNarration: true, fixtureMusic: true, fixtureHook: true });
}, 120_000);
afterAll(async () => {
  await Promise.all(renders.map((control) => rm(control.dir, { recursive: true, force: true })));
});

describe("the genuinely clean control reaches request construction", () => {
  it("builds a draft request carrying the re-hashed master digest", async () => {
    const request = await build(gateFor(clean.receipt));
    expect(request.finalMediaSha256).toBe(clean.receipt.masterSha256);
    expect(request.finalMediaSha256).toBe(sha256File(clean.receipt.masterPath));
    expect(request.draft).toBe(true);
  });

  it("records each consumed input's OWN digest, never the master's", async () => {
    // Defect 2: the offline pipeline gave every input the master's digest.
    expect(clean.receipt.inputs).toHaveLength(5);
    for (const consumed of clean.receipt.inputs) {
      expect(consumed.sha256).toBe(sha256File(consumed.resolvedPath));
      expect(consumed.sha256).not.toBe(clean.receipt.masterSha256);
    }
  });

  it("records exactly the inputs compositorState references, with their roles and timeline slots", async () => {
    // Defect 3: every artifact was marked inMaster without proof.
    const byTask = Object.fromEntries(clean.receipt.inputs.map((consumed) => [consumed.taskId, consumed]));
    expect(Object.keys(byTask).sort()).toEqual(
      [CONTROL_TASKS.hook, CONTROL_TASKS.evidence, CONTROL_TASKS.voice, CONTROL_TASKS.captions, CONTROL_TASKS.music].sort(),
    );
    expect(byTask[CONTROL_TASKS.unused]).toBeUndefined();
    expect(byTask[CONTROL_TASKS.hook].role).toBe("hook-visual");
    expect(byTask[CONTROL_TASKS.hook].timeline).toEqual([{ index: 0, startSecond: 0, endSecond: 1.5 }]);
    expect(byTask[CONTROL_TASKS.evidence].role).toBe("evidence-visual");
    expect(byTask[CONTROL_TASKS.evidence].timeline).toEqual([{ index: 1, startSecond: 1.5, endSecond: 3 }]);
    expect(byTask[CONTROL_TASKS.voice].role).toBe("narration");
    expect(byTask[CONTROL_TASKS.captions].role).toBe("captions");
    expect(byTask[CONTROL_TASKS.music].role).toBe("music-bed");
    expect(clean.receipt.parameters.musicIncluded).toBe(true);
    expect(clean.receipt.parameters.captionsBurnedIn).toBe(true);
  });
});

describe("callers cannot import or invoke a trusted seal operation", () => {
  it("exports no function that seals, issues, mints, registers or signs provenance", async () => {
    // Loaded here rather than as static namespace imports, so the scan reads
    // every public module surface in one place.
    const modules: Record<string, Record<string, unknown>> = {
      compositorModule: await import("./motionCompositor.ts"),
      gateModule: await import("./publishGate.ts"),
      publishingModule: await import("./publishing.ts"),
      manifestModule: await import("./renderManifest.ts"),
      elevenLabsModule: await import("./elevenLabsTts.ts"),
      captionModule: await import("./captionRender.ts"),
      hostedModule: await import("./hostedMaster.ts"),
    };
    const offenders: string[] = [];
    for (const [name, module] of Object.entries(modules)) {
      for (const [key, value] of Object.entries(module)) {
        if (typeof value !== "function") continue;
        if (/seal|mint|issue(?!d)|register|sign|trust|attest|canonical|describeArtifact|hashArtifact/i.test(key)) {
          offenders.push(`${name}.${key}`);
        }
      }
    }
    // isIssuedRenderReceipt is a predicate; it adds nothing to the registry.
    expect(offenders).toEqual([]);
    expect(Object.keys(modules.manifestModule)).not.toContain("sealRenderManifest");
    for (const privateName of ["ISSUED_RECEIPTS", "RECEIPT_BY_MASTER"]) {
      expect(Object.keys(modules.compositorModule)).not.toContain(privateName);
    }
    for (const privateName of ["EVIDENCE_BY_ARTIFACT", "BUILTIN_FETCH"]) {
      expect(Object.keys(modules.elevenLabsModule)).not.toContain(privateName);
    }
    expect(Object.keys(modules.captionModule)).not.toContain("CAPTION_EVIDENCE");
    expect(Object.keys(modules.hostedModule)).not.toContain("ISSUED_HOSTED");
  });

  it("refuses copies of a genuine receipt, however faithful", async () => {
    const copies: unknown[] = [
      { ...clean.receipt },
      structuredClone(clean.receipt),
      JSON.parse(JSON.stringify(clean.receipt)),
      Object.freeze({ ...clean.receipt }),
    ];
    for (const copy of copies) {
      expect(isIssuedRenderReceipt(copy)).toBe(false);
      expect(await refusalCodes(gateFor(clean.receipt, { renderReceipt: copy as RenderReceipt }))).toEqual(["untrusted-receipt"]);
    }
    expect(isIssuedRenderReceipt(clean.receipt)).toBe(true);
  });

  it("does not let a genuine receipt be edited in place", async () => {
    expect(Object.isFrozen(clean.receipt)).toBe(true);
    expect(Object.isFrozen(clean.receipt.inputs[0])).toBe(true);
    expect(() => {
      (clean.receipt.inputs[0] as { declaredFixture: boolean }).declaredFixture = true;
    }).toThrow(TypeError);
  });

  it("gives no receipt to a copy of the master artifact", async () => {
    expect(renderReceiptFor(clean.master)).toBe(clean.receipt);
    expect(renderReceiptFor({ ...clean.master })).toBeUndefined();
  });
});

describe("replacing a fixture entry with a clean-looking entry cannot pass", () => {
  it("refuses a fixture receipt whose narration entry is swapped for a clean one and re-digested", async () => {
    const cleanVoice = clean.receipt.inputs.find((consumed) => consumed.role === "narration")!;
    const forgedInputs = fixture.receipt.inputs.map((consumed) => (consumed.role === "narration" ? cleanVoice : consumed));
    const { digest: _discarded, ...rest } = fixture.receipt;
    // The strongest forgery available: the digest recomputed over the edit
    // exactly as the compositor computes it, so ONLY the issued-receipt
    // registry can tell it apart. The replica is proven faithful first.
    expect(forgeDigest(clean.receipt)).toBe(clean.receipt.digest);
    const unsigned = { ...rest, inputs: forgedInputs };
    const forged = Object.freeze({ ...unsigned, digest: forgeDigest(unsigned) }) as RenderReceipt;
    expect(await refusalCodes(gateFor(fixture.receipt, { renderReceipt: forged }))).toEqual(["untrusted-receipt"]);
  });

  it("refuses a fixture render whose dependency record names the clean narration instead", async () => {
    const record = dependencyRecordFor(fixture.receipt);
    const cleanVoice = dependencyRecordFor(clean.receipt).dependencies.find((claim) => claim.role === "narration")!;
    record.dependencies = record.dependencies.map((claim) => (claim.role === "narration" ? cleanVoice : claim));
    const codes = await refusalCodes(gateFor(fixture.receipt, { dependencyRecord: record }));
    expect(codes).toContain("dependency-record-mismatch");
    expect(codes).toContain("fixture-artifact");
  });

  it("refuses the clean receipt presented with the fixture render's sign-offs", async () => {
    const codes = await refusalCodes(gateFor(clean.receipt, {
      inspection: { approvedBy: "aaron", approvedAt: APPROVED_AT, approved: true, ...bound(fixture.receipt) },
    }));
    expect(codes).toContain("stale-approval");
  });
});

describe("changing bytes after rendering fails", () => {
  it("refuses when a consumed input is edited after rendering", async () => {
    const control = await fresh();
    await appendByte(pathOf(control, CONTROL_TASKS.voice));
    expect(await refusalCodes(gateFor(control.receipt))).toEqual(["input-changed"]);
  }, 60_000);

  it("refuses when a consumed input is replaced by a symlink to different bytes", async () => {
    const control = await fresh();
    const target = pathOf(control, CONTROL_TASKS.evidence);
    await rename(target, `${target}.orig`);
    await symlink(pathOf(control, CONTROL_TASKS.unused), target);
    expect(await refusalCodes(gateFor(control.receipt))).toEqual(["input-changed"]);
  }, 60_000);

  it("refuses when a consumed input is deleted", async () => {
    const control = await fresh();
    await rm(pathOf(control, CONTROL_TASKS.music));
    expect(await refusalCodes(gateFor(control.receipt))).toEqual(["missing-file"]);
  }, 60_000);

  it("refuses when the master is changed after approval", async () => {
    const control = await fresh();
    await appendByte(control.receipt.masterPath);
    expect(await refusalCodes(gateFor(control.receipt))).toEqual(["master-changed"]);
  }, 60_000);

  it("refuses when the master is replaced wholesale by another approved-looking file", async () => {
    const control = await fresh();
    await writeFile(control.receipt.masterPath, readFileSync(fixture.receipt.masterPath));
    expect(await refusalCodes(gateFor(control.receipt))).toEqual(["master-changed"]);
  }, 60_000);
});

describe("the dependency record must match what the compositor consumed", () => {
  const withRecord = (edit: (record: DependencyRecord) => void): Promise<string[]> => {
    const record = dependencyRecordFor(clean.receipt);
    edit(record);
    return refusalCodes(gateFor(clean.receipt, { dependencyRecord: record }));
  };

  it("refuses claiming an unused asset was included", async () => {
    const unusedPath = pathOf(clean, CONTROL_TASKS.unused);
    expect(await withRecord((record) => {
      record.dependencies.push({
        taskId: CONTROL_TASKS.unused, role: "evidence-visual", resolvedPath: unusedPath, sha256: sha256File(unusedPath),
      });
    })).toEqual(["extra-claimed-dependency"]);
  });

  it("refuses omitting a consumed asset", async () => {
    expect(await withRecord((record) => {
      record.dependencies = record.dependencies.filter((claim) => claim.role !== "music-bed");
    })).toEqual(["omitted-dependency"]);
  });

  it("refuses a duplicated role", async () => {
    expect(await withRecord((record) => {
      const voice = record.dependencies.find((claim) => claim.role === "narration")!;
      record.dependencies.push({ ...voice });
    })).toEqual(["duplicate-role"]);
  });

  it("refuses a claimed digest that is not the consumed one", async () => {
    expect(await withRecord((record) => {
      record.dependencies[0] = { ...record.dependencies[0], sha256: clean.receipt.masterSha256 };
    })).toEqual(["dependency-record-mismatch"]);
  });

  it("refuses a claimed role that is not the role it played", async () => {
    expect(await withRecord((record) => {
      const hook = record.dependencies.find((claim) => claim.role === "hook-visual")!;
      hook.role = "evidence-visual";
    })).toEqual(["dependency-record-mismatch"]);
  });

  it("refuses a record that names a different receipt", async () => {
    expect(await withRecord((record) => { record.receiptDigest = fixture.receipt.digest; }))
      .toEqual(["dependency-record-mismatch"]);
  });

  it("refuses a missing or malformed record", async () => {
    expect(await refusalCodes(gateFor(clean.receipt, { dependencyRecord: undefined as unknown as DependencyRecord })))
      .toEqual(["malformed-dependency-record"]);
  });
});

describe("approval for a previous receipt or master fails", () => {
  let previous: ControlRender;
  beforeAll(async () => { previous = await fresh(); }, 60_000);

  it("the previous render is a different receipt", async () => {
    expect(previous.receipt.digest).not.toBe(clean.receipt.digest);
  });

  it("refuses an inspection of the previous receipt", async () => {
    const codes = await refusalCodes(gateFor(clean.receipt, {
      inspection: { approvedBy: "aaron", approvedAt: APPROVED_AT, approved: true, ...bound(previous.receipt) },
    }));
    // Non-empty first: `every` on [] is true, which would pass a built request.
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.every((code) => code === "stale-approval")).toBe(true);
  });

  it("refuses an inspection bound to this master but the previous receipt", async () => {
    expect(await refusalCodes(gateFor(clean.receipt, {
      inspection: {
        approvedBy: "aaron", approvedAt: APPROVED_AT, approved: true,
        masterSha256: clean.receipt.masterSha256, receiptDigest: previous.receipt.digest,
      },
    }))).toEqual(["stale-approval"]);
  });

  it("refuses an inspection bound to this receipt but another master", async () => {
    expect(await refusalCodes(gateFor(clean.receipt, {
      inspection: {
        approvedBy: "aaron", approvedAt: APPROVED_AT, approved: true,
        masterSha256: fixture.receipt.masterSha256, receiptDigest: clean.receipt.digest,
      },
    }))).toEqual(["stale-approval"]);
  });

  it("refuses QC recorded against the previous receipt", async () => {
    const gate = gateFor(clean.receipt);
    gate.qualityReview = { ...gate.qualityReview, reviewedReceiptDigest: previous.receipt.digest };
    expect(await refusalCodes(gate)).toEqual(["stale-approval"]);
  });

  it("refuses QC with no receipt digest at all", async () => {
    const gate = gateFor(clean.receipt);
    gate.qualityReview = { ...gate.qualityReview, reviewedReceiptDigest: undefined };
    expect(await refusalCodes(gate)).toEqual(["stale-approval"]);
  });

  it("refuses rights evidence recorded against the previous receipt", async () => {
    const gate = gateFor(clean.receipt);
    gate.assetBundle = { ...gate.assetBundle, approvedReceiptDigest: previous.receipt.digest };
    expect(await refusalCodes(gate)).toEqual(["stale-approval"]);
  });

  it("refuses paid-spend approval recorded against the previous receipt", async () => {
    const codes = await refusalCodes(gateFor(clean.receipt, {
      paidProviderApproval: { approvedBy: "aaron", approvedAt: APPROVED_AT, ...bound(previous.receipt) },
    }));
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.every((code) => code === "stale-approval")).toBe(true);
  });
});

describe("fixtures, stand-ins and unapproved assets remain refused", () => {
  it("refuses the fixture render for every expected reason, even fully signed off", async () => {
    const codes = await refusalCodes(gateFor(fixture.receipt));
    expect(codes).toEqual(expect.arrayContaining([
      "fixture-artifact", "placeholder-hook", "silent-music-bed", "narration-not-elevenlabs", "narration-voice-not-liam",
    ]));
  });

  it("refuses fixture narration alone", async () => {
    const control = await fresh({ fixtureNarration: true });
    const codes = await refusalCodes(gateFor(control.receipt));
    expect(codes).toContain("fixture-artifact");
    expect(codes).toContain("narration-not-elevenlabs");
    expect(codes).toContain("narration-voice-not-liam");
  }, 60_000);

  it("refuses the silent bed alone", async () => {
    const control = await fresh({ fixtureMusic: true });
    expect(await refusalCodes(gateFor(control.receipt))).toEqual(["fixture-artifact", "silent-music-bed"]);
  }, 60_000);

  it("refuses the placeholder hook alone", async () => {
    const control = await fresh({ fixtureHook: true });
    expect(await refusalCodes(gateFor(control.receipt))).toEqual(["fixture-artifact", "placeholder-hook"]);
  }, 60_000);

  it("refuses a fixture that declares itself by flag only", async () => {
    const control = await fresh({ evidenceMetadata: { isFixture: true } });
    expect(await refusalCodes(gateFor(control.receipt))).toEqual(["fixture-artifact"]);
  }, 60_000);

  it("refuses narration merely NAMED Liam, or voiced with another id", async () => {
    // The real ElevenLabs adapter, asked for a voice whose id is literally "Liam".
    const named = await fresh({ narrationVoiceId: "Liam" });
    expect(await refusalCodes(gateFor(named.receipt))).toEqual(["narration-voice-not-liam"]);
    expect(await refusalCodes(gateFor(clean.receipt, { narrationIdentity: { liamVoiceId: "" } })))
      .toEqual(["narration-voice-not-liam"]);
  }, 60_000);

  it("refuses an input that records no provenance", async () => {
    const control = await fresh({ evidenceMetadata: { renderer: " ", provider: " " } });
    expect(await refusalCodes(gateFor(control.receipt))).toEqual(["unsupported-provenance"]);
  }, 60_000);

  it("refuses unapproved assets in the rights bundle", async () => {
    const gate = gateFor(clean.receipt);
    gate.assetBundle = { ...gate.assetBundle, publishable: false, nonApprovedAssetIds: ["asset-x"] };
    await expect(build(gate)).rejects.toThrow(/not-approved:asset-x/);
  });

  it("refuses a missing, rejected, anonymous or future-dated inspection", async () => {
    const base = { approvedBy: "aaron", approvedAt: APPROVED_AT, approved: true, ...bound(clean.receipt) };
    expect(await refusalCodes(gateFor(clean.receipt, { inspection: undefined as unknown as PublishingGateInput["inspection"] })))
      .toEqual(["no-approval-record"]);
    expect(await refusalCodes(gateFor(clean.receipt, { inspection: { ...base, approved: false } }))).toEqual(["no-approval-record"]);
    expect(await refusalCodes(gateFor(clean.receipt, { inspection: { ...base, approvedBy: " " } }))).toEqual(["malformed-approval"]);
    expect(await refusalCodes(gateFor(clean.receipt, { inspection: { ...base, approvedAt: "2999-01-01T00:00:00Z" } })))
      .toEqual(["malformed-approval"]);
    expect(await refusalCodes(gateFor(clean.receipt, { inspection: { ...base, approvedAt: "yesterday" } })))
      .toEqual(["malformed-approval"]);
  });

  it("refuses paid spend with no approval record", async () => {
    expect(await refusalCodes(gateFor(clean.receipt, { paidProviderApproval: undefined }))).toEqual(["malformed-approval"]);
  });

  it("refuses when no receipt is supplied at all", async () => {
    expect(await refusalCodes(gateFor(clean.receipt, { renderReceipt: undefined as unknown as RenderReceipt })))
      .toEqual(["untrusted-receipt"]);
  });
});

describe("the offline pipeline takes its provenance from the compositor", () => {
  // Defect 2 lived in endToEndOfflinePipeline.ts, which cannot run here (it
  // needs the built app served locally). Pin the fix at its source.
  const source = readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "endToEndOfflinePipeline.ts"), "utf-8");

  it("uses the compositor's receipt and a record derived from it", async () => {
    expect(source).toMatch(/renderReceiptFor\(finalArtifact\)/);
    expect(source).toMatch(/dependencyRecordFor\(offlineReceipt\)/);
  });

  it("assembles no provenance by hand and copies no master digest onto inputs", async () => {
    // The master's own asset record legitimately carries masterSha256; an
    // INPUT entry (one naming a task and a role) must never.
    expect(source).not.toMatch(/taskId:[^\n]*role:[^\n]*sha256:\s*masterSha256/);
    expect(source).not.toMatch(/inMaster/);
    expect(source).not.toMatch(/sealRenderManifest/);
  });
});

describe("narration identity comes from adapter-issued evidence, never from metadata", () => {
  it("refuses arbitrary non-ElevenLabs audio forged with clean ElevenLabs metadata, even with a genuine receipt", async () => {
    const forged = await fresh({ forgedNarration: true });
    const voice = forged.receipt.inputs.find((consumed) => consumed.role === "narration")!;
    // The forgery is perfect at the label level and the compositor DID issue
    // a genuine receipt for it — which is exactly why labels cannot be trusted.
    expect(isIssuedRenderReceipt(forged.receipt)).toBe(true);
    expect(voice.provider).toBe("elevenlabs");
    expect(voice.voiceId).toBe(CONTROL_LIAM_VOICE_ID);
    expect(voice.evidence).toBeNull();
    expect(await refusalCodes(gateFor(forged.receipt))).toEqual(["narration-not-elevenlabs", "narration-voice-not-liam"]);
  }, 60_000);

  it("refuses the real adapter when its transport was injected, though the bytes are identical", async () => {
    const injected = await fresh({ injectedTransportNarration: true });
    const voice = injected.receipt.inputs.find((consumed) => consumed.role === "narration")!;
    expect(voice.evidence).toBeNull();
    expect(await refusalCodes(gateFor(injected.receipt))).toEqual(["narration-not-elevenlabs", "narration-voice-not-liam"]);
  }, 60_000);

  it("refuses genuine ElevenLabs narration whose file was replaced before the compositor read it", async () => {
    const swapped = await fresh({
      afterNarration: async (artifact) => {
        await writeFile(fileURLToPath(artifact.uri), readFileSync(pathOf(clean, CONTROL_TASKS.music)));
      },
    }).catch((error: unknown) => error);
    // The kit's own guard accepts this render (evidence exists), so the gate
    // must be what refuses it: the evidence digest is not the consumed digest.
    expect(swapped).not.toBeInstanceOf(Error);
    const control = swapped as ControlRender;
    const voice = control.receipt.inputs.find((consumed) => consumed.role === "narration")!;
    expect(voice.evidence?.issuer).toBe("elevenlabs-tts");
    expect(voice.evidence?.sha256Matches).toBe(false);
    expect(await refusalCodes(gateFor(control.receipt))).toEqual(["narration-not-elevenlabs"]);
  }, 60_000);

  it("refuses a caption file labelled as the caption adapter's but not produced by it", async () => {
    const forged = await fresh({ forgedCaptions: true });
    const captions = forged.receipt.inputs.find((consumed) => consumed.role === "captions")!;
    expect(captions.renderer).toBe("specsmith-ass-captions");
    expect(captions.evidence).toBeNull();
    expect(await refusalCodes(gateFor(forged.receipt))).toEqual(["unsupported-provenance"]);
  }, 60_000);

  it("records the clean control's evidence: official origin, Liam's id, the exact bytes", () => {
    const voice = clean.receipt.inputs.find((consumed) => consumed.role === "narration")!;
    expect(voice.evidence).toMatchObject({
      issuer: "elevenlabs-tts",
      sha256Matches: true,
      voiceId: CONTROL_LIAM_VOICE_ID,
      endpointOrigin: "https://api.elevenlabs.io",
    });
  });
});

describe("the bytes at the hosted URI must be the approved master", () => {
  it("refuses at upload when the host serves different bytes than the valid local master", async () => {
    const control = await fresh();
    // The local master is intact and approved…
    expect(sha256File(control.receipt.masterPath)).toBe(control.receipt.masterSha256);
    // …but the host serves something else at the returned URI.
    await expect(uploadAndVerifyMaster(control.receipt, substitutingUploader)).rejects.toThrow(/hosted-master-mismatch/);
  }, 60_000);

  it("the real builder refuses when the hosted bytes change after verification", async () => {
    const control = await fresh();
    const hosted = HOSTED.get(control.receipt)!;
    const served = fakeNetwork.objects.get(hosted.uri)!;
    const altered = new Uint8Array(served);
    altered[0] ^= 0xff;
    // Renders are deterministic, so identical masters share one
    // content-addressed object; restore it for the other tests.
    fakeNetwork.objects.set(hosted.uri, altered);
    try {
      // Local master still valid; every sign-off still bound; only the host changed.
      expect(sha256File(control.receipt.masterPath)).toBe(control.receipt.masterSha256);
      expect(await refusalCodes(gateFor(control.receipt))).toEqual(["hosted-master-mismatch"]);
    } finally {
      fakeNetwork.objects.set(hosted.uri, served);
    }
  }, 60_000);

  it("the real builder refuses when the host stops serving the object", async () => {
    const control = await fresh();
    const uri = HOSTED.get(control.receipt)!.uri;
    const served = fakeNetwork.objects.get(uri)!;
    fakeNetwork.objects.delete(uri);
    try {
      expect(await refusalCodes(gateFor(control.receipt))).toEqual(["hosted-download-failed"]);
    } finally {
      fakeNetwork.objects.set(uri, served);
    }
  }, 60_000);

  it("refuses a caller-built hosted record: a URL plus a digest is not evidence", async () => {
    const genuine = HOSTED.get(clean.receipt)!;
    const forged = Object.freeze({ ...genuine }) as HostedMaster;
    expect(isVerifiedHostedMaster(forged)).toBe(false);
    expect(await refusalCodes(gateFor(clean.receipt, { hostedMaster: forged }))).toEqual(["hosted-master-unverified"]);
  });

  it("refuses a missing hosted master", async () => {
    expect(await refusalCodes(gateFor(clean.receipt, { hostedMaster: undefined as unknown as HostedMaster })))
      .toEqual(["hosted-master-unverified"]);
  });

  it("refuses a hosted master verified for a different render", async () => {
    expect(await refusalCodes(gateFor(clean.receipt, { hostedMaster: HOSTED.get(fixture.receipt)! })))
      .toContain("hosted-master-mismatch");
  });

  it("refuses an uploader that returns plain http or a non-content-addressed URL", async () => {
    const http: MasterUploader = { async upload() { return { uri: "http://media.control.test/masters/x.mp4" }; } };
    const unnamed: MasterUploader = { async upload() { return { uri: "https://media.control.test/masters/latest.mp4" }; } };
    await expect(uploadAndVerifyMaster(clean.receipt, http)).rejects.toThrow(/hosted-uri-invalid/);
    await expect(uploadAndVerifyMaster(clean.receipt, unnamed)).rejects.toThrow(/hosted-uri-invalid/);
  });

  it("refuses to upload for a receipt the compositor did not issue", async () => {
    await expect(uploadAndVerifyMaster({ ...clean.receipt } as RenderReceipt, controlUploader))
      .rejects.toThrow(/untrusted-receipt/);
  });

  it("puts only the verified hosted URI in the request, and downloads it again to build it", async () => {
    const hosted = HOSTED.get(clean.receipt)!;
    const before = fakeNetwork.requests.filter((request) => request === `GET ${hosted.uri}`).length;
    const request = await build(gateFor(clean.receipt));
    expect(request.media).toEqual([hosted.uri]);
    expect(fakeNetwork.requests.filter((entry) => entry === `GET ${hosted.uri}`).length).toBe(before + 1);
  });
});
