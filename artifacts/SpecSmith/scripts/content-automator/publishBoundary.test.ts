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

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as compositorModule from "./motionCompositor.ts";
import { isIssuedRenderReceipt, renderReceiptFor, type RenderReceipt } from "./motionCompositor.ts";
import * as gateModule from "./publishGate.ts";
import * as publishingModule from "./publishing.ts";
import { buildMetricoolPublishingRequest, type PublishingGateInput } from "./publishing.ts";
import * as manifestModule from "./renderManifest.ts";
import { dependencyRecordFor, type DependencyRecord } from "./renderManifest.ts";
import {
  appendByte,
  CONTROL_LIAM_VOICE_ID,
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
function refusalCodes(gate: PublishingGateInput): string[] {
  try {
    build(gate);
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const codes = [...message.matchAll(/\[([a-z-]+)\]/g)].map((match) => match[1]);
    return codes.length > 0 ? codes : [`non-gate-error: ${message}`];
  }
}

const pathOf = (control: ControlRender, taskId: string): string =>
  fileURLToPath(control.artifacts[taskId].uri);

const renders: ControlRender[] = [];
async function fresh(options?: Parameters<typeof renderControl>[0]): Promise<ControlRender> {
  const control = await renderControl(options);
  renders.push(control);
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
  it("builds a draft request carrying the re-hashed master digest", () => {
    const request = build(gateFor(clean.receipt));
    expect(request.finalMediaSha256).toBe(clean.receipt.masterSha256);
    expect(request.finalMediaSha256).toBe(sha256File(clean.receipt.masterPath));
    expect(request.draft).toBe(true);
  });

  it("records each consumed input's OWN digest, never the master's", () => {
    // Defect 2: the offline pipeline gave every input the master's digest.
    expect(clean.receipt.inputs).toHaveLength(5);
    for (const consumed of clean.receipt.inputs) {
      expect(consumed.sha256).toBe(sha256File(consumed.resolvedPath));
      expect(consumed.sha256).not.toBe(clean.receipt.masterSha256);
    }
  });

  it("records exactly the inputs compositorState references, with their roles and timeline slots", () => {
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
  it("exports no function that seals, issues, mints, registers or signs provenance", () => {
    const modules = { compositorModule, gateModule, publishingModule, manifestModule };
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
    expect(Object.keys(manifestModule)).not.toContain("sealRenderManifest");
    expect(Object.keys(compositorModule)).not.toContain("ISSUED_RECEIPTS");
    expect(Object.keys(compositorModule)).not.toContain("RECEIPT_BY_MASTER");
  });

  it("refuses copies of a genuine receipt, however faithful", () => {
    const copies: unknown[] = [
      { ...clean.receipt },
      structuredClone(clean.receipt),
      JSON.parse(JSON.stringify(clean.receipt)),
      Object.freeze({ ...clean.receipt }),
    ];
    for (const copy of copies) {
      expect(isIssuedRenderReceipt(copy)).toBe(false);
      expect(refusalCodes(gateFor(clean.receipt, { renderReceipt: copy as RenderReceipt }))).toEqual(["untrusted-receipt"]);
    }
    expect(isIssuedRenderReceipt(clean.receipt)).toBe(true);
  });

  it("does not let a genuine receipt be edited in place", () => {
    expect(Object.isFrozen(clean.receipt)).toBe(true);
    expect(Object.isFrozen(clean.receipt.inputs[0])).toBe(true);
    expect(() => {
      (clean.receipt.inputs[0] as { declaredFixture: boolean }).declaredFixture = true;
    }).toThrow(TypeError);
  });

  it("gives no receipt to a copy of the master artifact", () => {
    expect(renderReceiptFor(clean.master)).toBe(clean.receipt);
    expect(renderReceiptFor({ ...clean.master })).toBeUndefined();
  });
});

describe("replacing a fixture entry with a clean-looking entry cannot pass", () => {
  it("refuses a fixture receipt whose narration entry is swapped for a clean one and re-digested", () => {
    const cleanVoice = clean.receipt.inputs.find((consumed) => consumed.role === "narration")!;
    const forgedInputs = fixture.receipt.inputs.map((consumed) => (consumed.role === "narration" ? cleanVoice : consumed));
    const { digest: _discarded, ...rest } = fixture.receipt;
    // The strongest forgery available: the digest recomputed over the edit
    // exactly as the compositor computes it, so ONLY the issued-receipt
    // registry can tell it apart. The replica is proven faithful first.
    expect(forgeDigest(clean.receipt)).toBe(clean.receipt.digest);
    const unsigned = { ...rest, inputs: forgedInputs };
    const forged = Object.freeze({ ...unsigned, digest: forgeDigest(unsigned) }) as RenderReceipt;
    expect(refusalCodes(gateFor(fixture.receipt, { renderReceipt: forged }))).toEqual(["untrusted-receipt"]);
  });

  it("refuses a fixture render whose dependency record names the clean narration instead", () => {
    const record = dependencyRecordFor(fixture.receipt);
    const cleanVoice = dependencyRecordFor(clean.receipt).dependencies.find((claim) => claim.role === "narration")!;
    record.dependencies = record.dependencies.map((claim) => (claim.role === "narration" ? cleanVoice : claim));
    const codes = refusalCodes(gateFor(fixture.receipt, { dependencyRecord: record }));
    expect(codes).toContain("dependency-record-mismatch");
    expect(codes).toContain("fixture-artifact");
  });

  it("refuses the clean receipt presented with the fixture render's sign-offs", () => {
    const codes = refusalCodes(gateFor(clean.receipt, {
      inspection: { approvedBy: "aaron", approvedAt: APPROVED_AT, approved: true, ...bound(fixture.receipt) },
    }));
    expect(codes).toContain("stale-approval");
  });
});

describe("changing bytes after rendering fails", () => {
  it("refuses when a consumed input is edited after rendering", async () => {
    const control = await fresh();
    await appendByte(pathOf(control, CONTROL_TASKS.voice));
    expect(refusalCodes(gateFor(control.receipt))).toEqual(["input-changed"]);
  }, 60_000);

  it("refuses when a consumed input is replaced by a symlink to different bytes", async () => {
    const control = await fresh();
    const target = pathOf(control, CONTROL_TASKS.evidence);
    await rename(target, `${target}.orig`);
    await symlink(pathOf(control, CONTROL_TASKS.unused), target);
    expect(refusalCodes(gateFor(control.receipt))).toEqual(["input-changed"]);
  }, 60_000);

  it("refuses when a consumed input is deleted", async () => {
    const control = await fresh();
    await rm(pathOf(control, CONTROL_TASKS.music));
    expect(refusalCodes(gateFor(control.receipt))).toEqual(["missing-file"]);
  }, 60_000);

  it("refuses when the master is changed after approval", async () => {
    const control = await fresh();
    await appendByte(control.receipt.masterPath);
    expect(refusalCodes(gateFor(control.receipt))).toEqual(["master-changed"]);
  }, 60_000);

  it("refuses when the master is replaced wholesale by another approved-looking file", async () => {
    const control = await fresh();
    await writeFile(control.receipt.masterPath, readFileSync(fixture.receipt.masterPath));
    expect(refusalCodes(gateFor(control.receipt))).toEqual(["master-changed"]);
  }, 60_000);
});

describe("the dependency record must match what the compositor consumed", () => {
  const withRecord = (edit: (record: DependencyRecord) => void): string[] => {
    const record = dependencyRecordFor(clean.receipt);
    edit(record);
    return refusalCodes(gateFor(clean.receipt, { dependencyRecord: record }));
  };

  it("refuses claiming an unused asset was included", () => {
    const unusedPath = pathOf(clean, CONTROL_TASKS.unused);
    expect(withRecord((record) => {
      record.dependencies.push({
        taskId: CONTROL_TASKS.unused, role: "evidence-visual", resolvedPath: unusedPath, sha256: sha256File(unusedPath),
      });
    })).toEqual(["extra-claimed-dependency"]);
  });

  it("refuses omitting a consumed asset", () => {
    expect(withRecord((record) => {
      record.dependencies = record.dependencies.filter((claim) => claim.role !== "music-bed");
    })).toEqual(["omitted-dependency"]);
  });

  it("refuses a duplicated role", () => {
    expect(withRecord((record) => {
      const voice = record.dependencies.find((claim) => claim.role === "narration")!;
      record.dependencies.push({ ...voice });
    })).toEqual(["duplicate-role"]);
  });

  it("refuses a claimed digest that is not the consumed one", () => {
    expect(withRecord((record) => {
      record.dependencies[0] = { ...record.dependencies[0], sha256: clean.receipt.masterSha256 };
    })).toEqual(["dependency-record-mismatch"]);
  });

  it("refuses a claimed role that is not the role it played", () => {
    expect(withRecord((record) => {
      const hook = record.dependencies.find((claim) => claim.role === "hook-visual")!;
      hook.role = "evidence-visual";
    })).toEqual(["dependency-record-mismatch"]);
  });

  it("refuses a record that names a different receipt", () => {
    expect(withRecord((record) => { record.receiptDigest = fixture.receipt.digest; }))
      .toEqual(["dependency-record-mismatch"]);
  });

  it("refuses a missing or malformed record", () => {
    expect(refusalCodes(gateFor(clean.receipt, { dependencyRecord: undefined as unknown as DependencyRecord })))
      .toEqual(["malformed-dependency-record"]);
  });
});

describe("approval for a previous receipt or master fails", () => {
  let previous: ControlRender;
  beforeAll(async () => { previous = await fresh(); }, 60_000);

  it("the previous render is a different receipt", () => {
    expect(previous.receipt.digest).not.toBe(clean.receipt.digest);
  });

  it("refuses an inspection of the previous receipt", () => {
    expect(refusalCodes(gateFor(clean.receipt, {
      inspection: { approvedBy: "aaron", approvedAt: APPROVED_AT, approved: true, ...bound(previous.receipt) },
    })).every((code) => code === "stale-approval")).toBe(true);
  });

  it("refuses an inspection bound to this master but the previous receipt", () => {
    expect(refusalCodes(gateFor(clean.receipt, {
      inspection: {
        approvedBy: "aaron", approvedAt: APPROVED_AT, approved: true,
        masterSha256: clean.receipt.masterSha256, receiptDigest: previous.receipt.digest,
      },
    }))).toEqual(["stale-approval"]);
  });

  it("refuses an inspection bound to this receipt but another master", () => {
    expect(refusalCodes(gateFor(clean.receipt, {
      inspection: {
        approvedBy: "aaron", approvedAt: APPROVED_AT, approved: true,
        masterSha256: fixture.receipt.masterSha256, receiptDigest: clean.receipt.digest,
      },
    }))).toEqual(["stale-approval"]);
  });

  it("refuses QC recorded against the previous receipt", () => {
    const gate = gateFor(clean.receipt);
    gate.qualityReview = { ...gate.qualityReview, reviewedReceiptDigest: previous.receipt.digest };
    expect(refusalCodes(gate)).toEqual(["stale-approval"]);
  });

  it("refuses QC with no receipt digest at all", () => {
    const gate = gateFor(clean.receipt);
    gate.qualityReview = { ...gate.qualityReview, reviewedReceiptDigest: undefined };
    expect(refusalCodes(gate)).toEqual(["stale-approval"]);
  });

  it("refuses rights evidence recorded against the previous receipt", () => {
    const gate = gateFor(clean.receipt);
    gate.assetBundle = { ...gate.assetBundle, approvedReceiptDigest: previous.receipt.digest };
    expect(refusalCodes(gate)).toEqual(["stale-approval"]);
  });

  it("refuses paid-spend approval recorded against the previous receipt", () => {
    expect(refusalCodes(gateFor(clean.receipt, {
      paidProviderApproval: { approvedBy: "aaron", approvedAt: APPROVED_AT, ...bound(previous.receipt) },
    })).every((code) => code === "stale-approval")).toBe(true);
  });
});

describe("fixtures, stand-ins and unapproved assets remain refused", () => {
  it("refuses the fixture render for every expected reason, even fully signed off", () => {
    const codes = refusalCodes(gateFor(fixture.receipt));
    expect(codes).toEqual(expect.arrayContaining([
      "fixture-artifact", "placeholder-hook", "silent-music-bed", "narration-not-elevenlabs", "narration-voice-not-liam",
    ]));
  });

  it("refuses fixture narration alone", async () => {
    const control = await fresh({ fixtureNarration: true });
    const codes = refusalCodes(gateFor(control.receipt));
    expect(codes).toContain("fixture-artifact");
    expect(codes).toContain("narration-not-elevenlabs");
    expect(codes).toContain("narration-voice-not-liam");
  }, 60_000);

  it("refuses the silent bed alone", async () => {
    const control = await fresh({ fixtureMusic: true });
    expect(refusalCodes(gateFor(control.receipt))).toEqual(["fixture-artifact", "silent-music-bed"]);
  }, 60_000);

  it("refuses the placeholder hook alone", async () => {
    const control = await fresh({ fixtureHook: true });
    expect(refusalCodes(gateFor(control.receipt))).toEqual(["fixture-artifact", "placeholder-hook"]);
  }, 60_000);

  it("refuses a fixture that declares itself by flag only", async () => {
    const control = await fresh({ evidenceMetadata: { isFixture: true } });
    expect(refusalCodes(gateFor(control.receipt))).toEqual(["fixture-artifact"]);
  }, 60_000);

  it("refuses narration merely NAMED Liam, or voiced with another id", async () => {
    const named = await fresh({ narrationMetadata: { voiceId: "Liam" } });
    expect(refusalCodes(gateFor(named.receipt))).toEqual(["narration-voice-not-liam"]);
    expect(refusalCodes(gateFor(clean.receipt, { narrationIdentity: { liamVoiceId: "" } })))
      .toEqual(["narration-voice-not-liam"]);
  }, 60_000);

  it("refuses an input that records no provenance", async () => {
    const control = await fresh({ evidenceMetadata: { renderer: " ", provider: " " } });
    expect(refusalCodes(gateFor(control.receipt))).toEqual(["unsupported-provenance"]);
  }, 60_000);

  it("refuses unapproved assets in the rights bundle", () => {
    const gate = gateFor(clean.receipt);
    gate.assetBundle = { ...gate.assetBundle, publishable: false, nonApprovedAssetIds: ["asset-x"] };
    expect(() => build(gate)).toThrow(/not-approved:asset-x/);
  });

  it("refuses a missing, rejected, anonymous or future-dated inspection", () => {
    const base = { approvedBy: "aaron", approvedAt: APPROVED_AT, approved: true, ...bound(clean.receipt) };
    expect(refusalCodes(gateFor(clean.receipt, { inspection: undefined as unknown as PublishingGateInput["inspection"] })))
      .toEqual(["no-approval-record"]);
    expect(refusalCodes(gateFor(clean.receipt, { inspection: { ...base, approved: false } }))).toEqual(["no-approval-record"]);
    expect(refusalCodes(gateFor(clean.receipt, { inspection: { ...base, approvedBy: " " } }))).toEqual(["malformed-approval"]);
    expect(refusalCodes(gateFor(clean.receipt, { inspection: { ...base, approvedAt: "2999-01-01T00:00:00Z" } })))
      .toEqual(["malformed-approval"]);
    expect(refusalCodes(gateFor(clean.receipt, { inspection: { ...base, approvedAt: "yesterday" } })))
      .toEqual(["malformed-approval"]);
  });

  it("refuses paid spend with no approval record", () => {
    expect(refusalCodes(gateFor(clean.receipt, { paidProviderApproval: undefined }))).toEqual(["malformed-approval"]);
  });

  it("refuses when no receipt is supplied at all", () => {
    expect(refusalCodes(gateFor(clean.receipt, { renderReceipt: undefined as unknown as RenderReceipt })))
      .toEqual(["untrusted-receipt"]);
  });
});

describe("the offline pipeline takes its provenance from the compositor", () => {
  // Defect 2 lived in endToEndOfflinePipeline.ts, which cannot run here (it
  // needs the built app served locally). Pin the fix at its source.
  const source = readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "endToEndOfflinePipeline.ts"), "utf-8");

  it("uses the compositor's receipt and a record derived from it", () => {
    expect(source).toMatch(/renderReceiptFor\(finalArtifact\)/);
    expect(source).toMatch(/dependencyRecordFor\(offlineReceipt\)/);
  });

  it("assembles no provenance by hand and copies no master digest onto inputs", () => {
    // The master's own asset record legitimately carries masterSha256; an
    // INPUT entry (one naming a task and a role) must never.
    expect(source).not.toMatch(/taskId:[^\n]*role:[^\n]*sha256:\s*masterSha256/);
    expect(source).not.toMatch(/inMaster/);
    expect(source).not.toMatch(/sealRenderManifest/);
  });
});
