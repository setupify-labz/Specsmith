import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import type { RenderReceipt } from "./motionCompositor.ts";
import { renderControl, type ControlRender } from "./publishBoundary.testkit.ts";
import { cleanRestrictedFeatureReview, type AssetRightsManifest } from "./assetRights.ts";
import {
  buildProductVisualAssetRegistry,
  evaluatePublicationAssetBundle,
  evaluateProductVisualAsset,
  selectApprovedProductVisualAsset,
  type ProductVisualAssetRecord,
} from "./productVisualAssets.ts";

function manifest(assetId: string, overrides: Partial<AssetRightsManifest> = {}): AssetRightsManifest {
  return {
    assetId,
    assetType: "3d-model",
    intendedUse: "commercial-marketing",
    productId: "rtx4080s",
    generationMode: "original",
    sourceGrants: [{
      sourceKind: "specsmith-owned",
      commercialUseAllowed: true,
      derivativeUseAllowed: true,
      designUseAuthorized: true,
      trademarkUseAuthorized: false,
      attributionRequired: false,
    }],
    parentAssetIds: [],
    productIdentityMode: "deterministic-plain-text-overlay",
    restrictedFeatures: cleanRestrictedFeatureReview(),
    reviewedBy: "automated-and-human",
    ...overrides,
  };
}

function record(assetId: string, overrides: Partial<ProductVisualAssetRecord> = {}): ProductVisualAssetRecord {
  return {
    assetId,
    productId: "rtx4080s",
    role: "3d-production-asset",
    uri: `artifact://${assetId}.glb`,
    mimeType: "model/gltf-binary",
    version: 1,
    createdAt: "2026-08-23T20:00:00Z",
    createdBy: "specsmith",
    rights: manifest(assetId),
    ...overrides,
  };
}

const MASTER_SHA256 = "c".repeat(64);

/** The rendered master, registered as an asset in its own right. */
function master(overrides: Partial<ProductVisualAssetRecord> = {}): ProductVisualAssetRecord {
  return record("master", {
    role: "specsmith-evidence",
    uri: "https://cdn.specsmithpc.com/masters/master-v1.mp4",
    mimeType: "video/mp4",
    sha256: MASTER_SHA256,
    ...overrides,
  });
}

describe("product visual asset registry", () => {
  it("approves only assets that pass the rights policy", () => {
    expect(evaluateProductVisualAsset(record("clean")).status).toBe("approved");
    const blocked = record("blocked", {
      rights: manifest("blocked", {
        restrictedFeatures: cleanRestrictedFeatureReview({ logos: "present" }),
      }),
    });
    expect(evaluateProductVisualAsset(blocked).status).toBe("blocked");
  });

  it("quarantines exact/distinctive geometry until design-use authorization is recorded", () => {
    const held = record("exact-fe", {
      rights: manifest("exact-fe", {
        generationMode: "derived-from-references",
        sourceGrants: [{
          sourceKind: "manufacturer-authorized",
          evidenceRef: "license:press-kit-terms-v1",
          commercialUseAllowed: true,
          derivativeUseAllowed: true,
          designUseAuthorized: false,
          trademarkUseAuthorized: false,
          attributionRequired: false,
        }],
        restrictedFeatures: cleanRestrictedFeatureReview({ distinctiveIndustrialDesign: "present" }),
      }),
    });
    expect(evaluateProductVisualAsset(held).status).toBe("needs-review");
  });

  it("selects the newest approved asset and never falls back to held assets", () => {
    const registry = buildProductVisualAssetRegistry([
      record("v1", { version: 1 }),
      record("v2", { version: 2, createdAt: "2026-08-23T21:00:00Z" }),
      record("held", {
        version: 99,
        rights: manifest("held", { reviewedBy: "not-reviewed" }),
      }),
    ]);

    const selected = selectApprovedProductVisualAsset(registry, {
      productId: "rtx4080s",
      roles: ["3d-production-asset"],
    });
    expect(selected.assetId).toBe("v2");
  });

  it("fails closed when no approved visual exists", () => {
    const registry = buildProductVisualAssetRegistry([
      record("held", { rights: manifest("held", { reviewedBy: "not-reviewed" }) }),
    ]);
    expect(() => selectApprovedProductVisualAsset(registry, {
      productId: "rtx4080s",
      roles: ["3d-production-asset"],
    })).toThrow(/No rights-approved visual asset/);
  });

  it("blocks a final master if any used visual is unregistered, unexpected, or not approved", () => {
    const registry = buildProductVisualAssetRegistry([
      master(),
      record("approved"),
      record("held", { rights: manifest("held", { reviewedBy: "not-reviewed" }) }),
    ]);

    const result = evaluatePublicationAssetBundle(registry, {
      masterAssetId: "master",
      usedAssetIds: ["approved", "held", "unknown"],
      expectedVisualAssetIds: ["approved", "held"],
    });
    expect(result.publishable).toBe(false);
    expect(result.missingAssetIds).toContain("unknown");
    expect(result.untrackedAssetIds).toContain("unknown");
    expect(result.nonApprovedAssetIds).toContain("held");
    expect(result.nonApprovedAssetIds).toContain("unknown");
  });
});

// REGRESSION (review item 1): the approved master hash must be a fact READ FROM
// the registry, not a string a caller hands in. Before this, the bundle result
// carried no hash at all and the publishing gate compared two caller-supplied
// arguments to each other — which any caller could satisfy with the same
// unreviewed digest twice.
describe("the approved master hash is derived from the registry", () => {
  it("reports the stored hash of an approved master", () => {
    const result = evaluatePublicationAssetBundle(buildProductVisualAssetRegistry([master(), record("approved")]), {
      masterAssetId: "master",
      usedAssetIds: ["approved"],
      expectedVisualAssetIds: ["approved"],
    });
    expect(result.approvedMasterSha256).toBe(MASTER_SHA256);
    expect(result.approvedMasterUri).toBe("https://cdn.specsmithpc.com/masters/master-v1.mp4");
    expect(result.publishable).toBe(true);
  });

  it("normalises case so an upper-case digest still compares equal", () => {
    const registry = buildProductVisualAssetRegistry([master({ sha256: MASTER_SHA256.toUpperCase() })]);
    const result = evaluatePublicationAssetBundle(registry, {
      masterAssetId: "master",
      usedAssetIds: [],
      expectedVisualAssetIds: [],
    });
    expect(result.approvedMasterSha256).toBe(MASTER_SHA256);
  });

  it("checks the master for rights alongside the component assets", () => {
    const registry = buildProductVisualAssetRegistry([
      master({ rights: manifest("master", { reviewedBy: "not-reviewed" }) }),
    ]);
    const result = evaluatePublicationAssetBundle(registry, {
      masterAssetId: "master",
      usedAssetIds: [],
      expectedVisualAssetIds: [],
    });
    expect(result.nonApprovedAssetIds).toContain("master");
    // A master that is not approved has no approved hash to report, so there
    // is nothing for the publishing gate to bind to.
    expect(result.approvedMasterSha256).toBeNull();
    expect(result.approvedMasterUri).toBeNull();
    expect(result.publishable).toBe(false);
  });

  it("refuses to publish a master that is registered without a hash", () => {
    const registry = buildProductVisualAssetRegistry([master({ sha256: undefined })]);
    const result = evaluatePublicationAssetBundle(registry, {
      masterAssetId: "master",
      usedAssetIds: [],
      expectedVisualAssetIds: [],
    });
    // The record is otherwise fine — it is the missing digest alone that makes
    // the bundle unpublishable, because nothing pins WHICH bytes were cleared.
    expect(result.nonApprovedAssetIds).toEqual([]);
    expect(result.approvedMasterSha256).toBeNull();
    expect(result.approvedMasterUri).toBeNull();
    expect(result.publishable).toBe(false);
  });

  it("rejects a stored value that is not a sha-256 digest", () => {
    const registry = buildProductVisualAssetRegistry([master({ sha256: "not-a-digest" })]);
    expect(evaluatePublicationAssetBundle(registry, {
      masterAssetId: "master",
      usedAssetIds: [],
      expectedVisualAssetIds: [],
    }).approvedMasterSha256).toBeNull();
  });

  it("refuses to publish a master that is not in the registry at all", () => {
    const registry = buildProductVisualAssetRegistry([record("approved")]);
    const result = evaluatePublicationAssetBundle(registry, {
      masterAssetId: "master",
      usedAssetIds: ["approved"],
      expectedVisualAssetIds: ["approved"],
    });
    expect(result.missingAssetIds).toContain("master");
    expect(result.approvedMasterSha256).toBeNull();
    expect(result.approvedMasterUri).toBeNull();
    expect(result.publishable).toBe(false);
  });
});

// RIGHTS EVIDENCE BINDS TO THE COMPOSITOR'S RECEIPT, OR TO NOTHING.
describe("the rights bundle is bound to the genuine render receipt", () => {
  let control: ControlRender;
  let other: ControlRender;
  beforeAll(async () => {
    control = await renderControl({ fixtureNarration: true });
    other = await renderControl({ fixtureNarration: true, fixtureHook: true });
  }, 120_000);
  afterAll(async () => {
    for (const render of [control, other]) if (render) await rm(render.dir, { recursive: true, force: true });
  });

  const bundle = (sha256: string, renderReceipt?: RenderReceipt) => evaluatePublicationAssetBundle(
    buildProductVisualAssetRegistry([master({ sha256 })]),
    { renderReceipt, usedAssetIds: [], expectedVisualAssetIds: [], masterAssetId: "master" },
  );

  it("records the receipt digest when the receipt's master is the approved master", () => {
    const result = bundle(control.receipt.masterSha256, control.receipt);
    expect(result.publishable).toBe(true);
    expect(result.approvedReceiptDigest).toBe(control.receipt.digest);
  });

  it("records no receipt digest without a receipt, leaving the gate to refuse", () => {
    const result = bundle(control.receipt.masterSha256);
    expect(result.approvedReceiptDigest ?? null).toBeNull();
  });

  it("is unpublishable when the supplied receipt describes a different master", () => {
    const result = bundle(control.receipt.masterSha256, other.receipt);
    expect(result.publishable).toBe(false);
    expect(result.approvedReceiptDigest).toBeNull();
  });

  it("is unpublishable when the supplied receipt is a copy", () => {
    const result = bundle(control.receipt.masterSha256, { ...control.receipt } as RenderReceipt);
    expect(result.publishable).toBe(false);
    expect(result.approvedReceiptDigest).toBeNull();
  });
});
