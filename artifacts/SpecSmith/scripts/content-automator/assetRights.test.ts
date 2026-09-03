import { describe, expect, it } from "vitest";
import {
  assertAssetMayPublish,
  assertReferenceMayBeUsedForDerivativeGeneration,
  cleanRestrictedFeatureReview,
  evaluateAssetRights,
  generatedNoReferenceGrant,
  type AssetRightsGrant,
  type AssetRightsManifest,
} from "./assetRights.ts";
import { buildRightsSafeVisualPrompt, buildVisualRightsPolicyState } from "./rightsSafeVisuals.ts";

function ownedGrant(overrides: Partial<AssetRightsGrant> = {}): AssetRightsGrant {
  return {
    sourceKind: "specsmith-owned",
    commercialUseAllowed: true,
    derivativeUseAllowed: true,
    designUseAuthorized: true,
    trademarkUseAuthorized: false,
    attributionRequired: false,
    ...overrides,
  };
}

function cleanManifest(overrides: Partial<AssetRightsManifest> = {}): AssetRightsManifest {
  return {
    assetId: "asset-1",
    assetType: "image",
    intendedUse: "commercial-marketing",
    generationMode: "original",
    sourceGrants: [ownedGrant()],
    parentAssetIds: [],
    productIdentityMode: "deterministic-plain-text-overlay",
    restrictedFeatures: cleanRestrictedFeatureReview(),
    reviewedBy: "automated-and-human",
    ...overrides,
  };
}

describe("asset rights policy", () => {
  it("allows a clean first-party asset with explicit commercial and derivative rights", () => {
    const result = evaluateAssetRights(cleanManifest());
    expect(result.decision).toBe("allow");
    expect(result.autoPublishAllowed).toBe(true);
    expect(result.issues).toEqual([]);
    expect(() => assertAssetMayPublish(cleanManifest())).not.toThrow();
  });

  it("blocks unknown-source references", () => {
    const result = evaluateAssetRights(cleanManifest({
      generationMode: "derived-from-references",
      sourceGrants: [{
        sourceKind: "unknown",
        commercialUseAllowed: false,
        derivativeUseAllowed: false,
        designUseAuthorized: false,
        trademarkUseAuthorized: false,
        attributionRequired: false,
      }],
    }));
    expect(result.decision).toBe("block");
    expect(result.autoPublishAllowed).toBe(false);
    expect(result.issues.some((entry) => entry.code === "unknown-source")).toBe(true);
  });

  it("blocks derivative generation when a reference does not permit derivatives", () => {
    const grant = ownedGrant({ derivativeUseAllowed: false });
    expect(() => assertReferenceMayBeUsedForDerivativeGeneration(grant)).toThrow(/does not permit derivative generation/i);

    const result = evaluateAssetRights(cleanManifest({
      generationMode: "derived-from-references",
      sourceGrants: [grant],
    }));
    expect(result.issues.some((entry) => entry.code === "derivative-use-not-allowed")).toBe(true);
  });

  it("requires durable license evidence for licensed third-party sources", () => {
    const result = evaluateAssetRights(cleanManifest({
      sourceGrants: [{
        sourceKind: "licensed-third-party",
        commercialUseAllowed: true,
        derivativeUseAllowed: true,
        designUseAuthorized: false,
        trademarkUseAuthorized: false,
        attributionRequired: false,
      }],
    }));
    expect(result.decision).toBe("block");
    expect(result.issues.some((entry) => entry.code === "missing-license-evidence")).toBe(true);
  });

  it("blocks baked logos, wordmarks, copied photography, and other restricted visual features", () => {
    const result = evaluateAssetRights(cleanManifest({
      restrictedFeatures: cleanRestrictedFeatureReview({ logos: "present", copiedProductPhotography: "present" }),
    }));
    expect(result.decision).toBe("block");
    expect(result.issues.some((entry) => entry.code === "restricted-feature-logos")).toBe(true);
    expect(result.issues.some((entry) => entry.code === "restricted-feature-copiedProductPhotography")).toBe(true);
  });

  it("blocks baked branding even if a source says trademark use is authorized", () => {
    const result = evaluateAssetRights(cleanManifest({
      productIdentityMode: "baked-branding",
      sourceGrants: [ownedGrant({ trademarkUseAuthorized: true })],
    }));
    expect(result.decision).toBe("block");
    expect(result.issues.some((entry) => entry.code === "baked-branding-disallowed")).toBe(true);
  });

  it("holds exact/distinctive industrial geometry when design-use authorization is absent", () => {
    const result = evaluateAssetRights(cleanManifest({
      generationMode: "derived-from-references",
      sourceGrants: [ownedGrant({ designUseAuthorized: false })],
      restrictedFeatures: cleanRestrictedFeatureReview({ distinctiveIndustrialDesign: "present" }),
    }));
    expect(result.decision).toBe("hold");
    expect(result.autoPublishAllowed).toBe(false);
    expect(result.issues.some((entry) => entry.code === "industrial-design-not-authorized")).toBe(true);
  });

  it("allows exact geometry only when every recorded source authorizes design use and the asset is otherwise clean", () => {
    const result = evaluateAssetRights(cleanManifest({
      generationMode: "derived-from-references",
      sourceGrants: [ownedGrant({ designUseAuthorized: true })],
      restrictedFeatures: cleanRestrictedFeatureReview({ distinctiveIndustrialDesign: "present" }),
    }));
    expect(result.decision).toBe("allow");
    expect(result.autoPublishAllowed).toBe(true);
  });

  it("holds publishable assets when restricted-feature review is incomplete", () => {
    const result = evaluateAssetRights(cleanManifest({
      restrictedFeatures: cleanRestrictedFeatureReview({ watermarks: "unknown" }),
      reviewedBy: "not-reviewed",
    }));
    expect(result.decision).toBe("hold");
    expect(result.issues.some((entry) => entry.code === "unreviewed-feature-watermarks")).toBe(true);
    expect(result.issues.some((entry) => entry.code === "visual-review-required")).toBe(true);
  });

  it("accepts an honest claude-code-manual-review value as a completed review, not automated tooling", () => {
    const result = evaluateAssetRights(cleanManifest({ reviewedBy: "claude-code-manual-review" }));
    expect(result.decision).toBe("allow");
    expect(result.autoPublishAllowed).toBe(true);
    expect(result.issues.some((entry) => entry.code === "visual-review-required")).toBe(false);
  });

  it("treats no-reference generation as eligible only after the actual pixels are reviewed", () => {
    const beforeReview = evaluateAssetRights(cleanManifest({
      generationMode: "generated-no-reference",
      sourceGrants: [generatedNoReferenceGrant()],
      reviewedBy: "not-reviewed",
      restrictedFeatures: cleanRestrictedFeatureReview({ logos: "unknown" }),
    }));
    expect(beforeReview.decision).toBe("hold");

    const afterReview = evaluateAssetRights(cleanManifest({
      generationMode: "generated-no-reference",
      sourceGrants: [generatedNoReferenceGrant()],
    }));
    expect(afterReview.decision).toBe("allow");
  });
});

describe("rights-safe visual planning", () => {
  it("encodes a cleared-only, no-baked-branding policy", () => {
    const policy = buildVisualRightsPolicyState();
    expect(policy.referencePolicy).toBe("cleared-only");
    expect(policy.brandingMode).toBe("no-baked-third-party-branding");
    expect(policy.productIdentityMode).toBe("deterministic-plain-text-overlay");
    expect(policy.requireRightsManifestBeforePublish).toBe(true);
  });

  it("adds explicit no-logo/no-copy rules to provider prompts", () => {
    const prompt = buildRightsSafeVisualPrompt("Create a dramatic GPU reveal.");
    expect(prompt).toContain("Do not render third-party logos");
    expect(prompt).toContain("Do not reproduce a source photograph as a near-copy");
    expect(prompt).toContain("deterministic plain text");
    expect(prompt).toContain("generic, representative PC-hardware silhouette");
  });
});
