import { describe, expect, it } from "vitest";
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
      record("approved"),
      record("held", { rights: manifest("held", { reviewedBy: "not-reviewed" }) }),
    ]);

    const result = evaluatePublicationAssetBundle(registry, {
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
