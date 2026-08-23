import { describe, it, expect } from "vitest";

import {
  ingestMeshyAsset,
  isPublishableMeshyAsset,
  meshyAssetId,
  meshyRegistryEntries,
  MeshyIngestError,
  type MeshyIngestRequest,
  type MeshySourceReference,
} from "./meshyIngestion.ts";
import {
  buildProductVisualAssetRegistry,
  evaluatePublicationAssetBundle,
  selectApprovedProductVisualAsset,
  type EvaluatedProductVisualAsset,
} from "./productVisualAssets.ts";
import { cleanRestrictedFeatureReview } from "./assetRights.ts";

const clearedReference: MeshySourceReference = {
  uri: "library:specsmith/reference/generic-gpu-shell.png",
  sourceKind: "specsmith-owned",
  commercialUseAllowed: true,
  derivativeUseAllowed: true,
};

/** A well-formed request. Individual tests degrade one thing at a time. */
const baseRequest = (over: Partial<MeshyIngestRequest> = {}): MeshyIngestRequest => ({
  providerAssetId: "task-1234",
  taskId: "meshy-task-1234",
  assetKind: "preview-image",
  generationMode: "text-to-3d",
  prompt: "a generic angular graphics card, no branding, studio lighting",
  createdAt: "2026-08-23T10:00:00.000Z",
  fileUris: ["file:///tmp/meshy/preview-1234.png"],
  declaredGeometryMode: "generic-representative",
  observedFeatures: cleanRestrictedFeatureReview(),
  intendedUse: "editorial-publication",
  ...over,
});

/** The only shape that can legitimately reach `approved` on ingest. */
const fullyCleared = (over: Partial<MeshyIngestRequest> = {}): MeshyIngestRequest =>
  baseRequest({
    humanClearance: { reviewer: "policy-team", evidenceRef: "review-ticket-88", reviewedAt: "2026-08-23T11:00:00.000Z" },
    ...over,
  });

describe("Meshy assets are quarantined, never auto-published", () => {
  it("holds a safe generic asset with complete provenance rather than approving it", () => {
    // The headline rule. Everything about this asset is clean, and it still
    // does not auto-publish, because ingest-time review is automated and
    // cannot certify generated imagery.
    const result = ingestMeshyAsset(baseRequest());
    expect(result.publicationDecision).toBe("hold");
    expect(result.registryStatus).toBe("needs-review");
    expect(result.registryStatus).not.toBe("approved");
    expect(isPublishableMeshyAsset(result)).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/No human clearance recorded/);
  });

  it("records the asset in the registry even when it is held", () => {
    // Quarantine means tracked-and-unusable, not discarded: a held asset must
    // still be inspectable and re-reviewable later.
    const result = ingestMeshyAsset(baseRequest());
    expect(result.registryRecord.assetId).toBe(result.assetId);
    expect(result.registryRecord.createdBy).toBe("provider");
    expect(result.rightsManifest.assetId).toBe(result.assetId);
  });

  it("derives a stable asset id from the provider id, so re-ingest updates in place", () => {
    expect(meshyAssetId("task-1234")).toBe("meshy-task-1234");
    expect(ingestMeshyAsset(baseRequest()).assetId).toBe(ingestMeshyAsset(baseRequest()).assetId);
  });

  it("approves only when provenance, review and clearance are all present", () => {
    const result = ingestMeshyAsset(fullyCleared());
    expect(result.publicationDecision).toBe("allow");
    expect(result.registryStatus).toBe("approved");
    expect(isPublishableMeshyAsset(result)).toBe(true);
    expect(result.rightsManifest.reviewedBy).toBe("automated-and-human");
  });
});

describe("missing provenance blocks", () => {
  it("blocks an image-to-3d asset with no recorded source lineage", () => {
    // Meshy consumed an input image here. If nobody can say which, the asset
    // cannot be assumed clean.
    const result = ingestMeshyAsset(fullyCleared({ generationMode: "image-to-3d", sourceReferences: [] }));
    expect(result.publicationDecision).toBe("block");
    expect(result.registryStatus).toBe("blocked");
    expect(result.reasons.join(" ")).toMatch(/no source reference lineage/i);
  });

  it("blocks texture generation with no lineage", () => {
    const result = ingestMeshyAsset(fullyCleared({ assetKind: "texture", generationMode: "texture-generation" }));
    expect(result.publicationDecision).toBe("block");
  });

  it("blocks a reference of unknown origin", () => {
    const result = ingestMeshyAsset(fullyCleared({
      generationMode: "image-to-3d",
      sourceReferences: [{ ...clearedReference, sourceKind: "unknown" }],
    }));
    expect(result.publicationDecision).toBe("block");
    expect(result.reasons.join(" ")).toMatch(/unknown-source/);
  });

  it("blocks a licensed reference with no durable evidence reference", () => {
    const result = ingestMeshyAsset(fullyCleared({
      generationMode: "image-to-3d",
      sourceReferences: [{ ...clearedReference, sourceKind: "licensed-third-party", evidenceRef: "  " }],
    }));
    expect(result.publicationDecision).toBe("block");
    expect(result.reasons.join(" ")).toMatch(/missing-license-evidence/);
  });

  it("blocks a reference that does not permit derivative generation", () => {
    const result = ingestMeshyAsset(fullyCleared({
      generationMode: "image-to-3d",
      sourceReferences: [{ ...clearedReference, derivativeUseAllowed: false }],
    }));
    expect(result.publicationDecision).toBe("block");
  });

  it("accepts a text-to-3d asset with no references as generated-no-reference", () => {
    // No inputs is legitimate here — but it still does not grant the right to
    // depict someone's exact product.
    const result = ingestMeshyAsset(fullyCleared());
    expect(result.rightsManifest.generationMode).toBe("generated-no-reference");
    expect(result.rightsManifest.sourceGrants[0].designUseAuthorized).toBe(false);
  });
});

describe("exact product geometry is held without recorded authorization", () => {
  it("holds an exact-design asset when no authorization exists", () => {
    // The asset may exist in the system; it may not become production output.
    const result = ingestMeshyAsset(fullyCleared({
      declaredGeometryMode: "licensed-exact",
      declaredProductTarget: "rtx5090",
    }));
    expect(result.publicationDecision).toBe("hold");
    expect(result.geometryMode).toBe("licensed-exact");
    expect(result.reasons.join(" ")).toMatch(/no design-use authorization is recorded/i);
  });

  it("allows an exact-design asset only with authorization naming the product", () => {
    const result = ingestMeshyAsset(fullyCleared({
      declaredGeometryMode: "licensed-exact",
      declaredProductTarget: "rtx5090",
      designAuthorization: { productId: "rtx5090", evidenceRef: "oem-agreement-2026-03" },
      sourceReferences: [{ ...clearedReference, designUseAuthorized: true }],
      generationMode: "image-to-3d",
      observedFeatures: cleanRestrictedFeatureReview({ distinctiveIndustrialDesign: "present" }),
    }));
    expect(result.publicationDecision).toBe("allow");
  });

  it("refuses an authorization that names a different product than the asset targets", () => {
    expect(() => ingestMeshyAsset(fullyCleared({
      declaredGeometryMode: "licensed-exact",
      declaredProductTarget: "rtx5090",
      designAuthorization: { productId: "rtx4090", evidenceRef: "oem-agreement" },
    }))).toThrow(MeshyIngestError);
  });

  it("trusts an observation of distinctive design over a 'generic' label", () => {
    // A caller asserting "generic" while the review found distinctive design is
    // contradicting itself; the observation is the safer of the two.
    const result = ingestMeshyAsset(fullyCleared({
      declaredGeometryMode: "generic-representative",
      observedFeatures: cleanRestrictedFeatureReview({ distinctiveIndustrialDesign: "present" }),
    }));
    expect(result.publicationDecision).toBe("hold");
    expect(result.reasons.join(" ")).toMatch(/declared generic but distinctive industrial design was observed/i);
  });
});

describe("restricted features hold or block", () => {
  it("treats unstated features as unknown, not absent", () => {
    // The single most important default in the module: a caller that says
    // nothing about logos must not get an asset marked logo-free.
    const result = ingestMeshyAsset(fullyCleared({ observedFeatures: undefined }));
    expect(result.reviewFindings.logos).toBe("unknown");
    expect(result.reviewFindings.copiedProductPhotography).toBe("unknown");
    expect(result.publicationDecision).not.toBe("allow");
  });

  for (const feature of [
    "logos",
    "stylizedWordmarks",
    "watermarks",
    "copyrightedArtworkOrGraphics",
    "serialNumbersOrStickerText",
    "retailerMarks",
    "copiedProductPhotography",
  ] as const) {
    it(`blocks an asset showing ${feature}`, () => {
      const result = ingestMeshyAsset(fullyCleared({
        observedFeatures: cleanRestrictedFeatureReview({ [feature]: "present" }),
      }));
      expect(result.publicationDecision).toBe("block");
      expect(result.registryStatus).toBe("blocked");
    });
  }

  it("never bakes branding into the manifest", () => {
    expect(ingestMeshyAsset(baseRequest()).rightsManifest.productIdentityMode).toBe("none");
  });
});

describe("the provider floor can only tighten, never widen", () => {
  it("keeps a block from the rights engine even though the floor is only a hold", () => {
    // A logo makes the engine say block; the Meshy floor says hold. The result
    // must be block — this layer must never be able to upgrade a decision.
    const result = ingestMeshyAsset(baseRequest({
      observedFeatures: cleanRestrictedFeatureReview({ logos: "present" }),
    }));
    expect(result.publicationDecision).toBe("block");
  });

  it("holds even when the rights engine alone would allow", () => {
    const cleared = fullyCleared();
    const withoutClearance = { ...cleared, humanClearance: undefined };
    expect(ingestMeshyAsset(cleared).publicationDecision).toBe("allow");
    expect(ingestMeshyAsset(withoutClearance).publicationDecision).toBe("hold");
  });
});

describe("malformed input is refused outright", () => {
  it("refuses an asset with no files", () => {
    expect(() => ingestMeshyAsset(baseRequest({ fileUris: [] }))).toThrow(/no file URIs/);
  });

  it("refuses an empty provider id", () => {
    expect(() => ingestMeshyAsset(baseRequest({ providerAssetId: "   " }))).toThrow(MeshyIngestError);
  });

  it("refuses a missing creation timestamp", () => {
    expect(() => ingestMeshyAsset(baseRequest({ createdAt: "" }))).toThrow(/createdAt/);
  });
});

describe("production selection and the final publication gate", () => {
  const registryOf = (...requests: MeshyIngestRequest[]): Map<string, EvaluatedProductVisualAsset> =>
    buildProductVisualAssetRegistry(meshyRegistryEntries(requests.map(ingestMeshyAsset)).map((entry) => ({
      assetId: entry.assetId,
      productId: entry.productId,
      role: entry.role,
      uri: entry.uri,
      mimeType: entry.mimeType,
      version: entry.version,
      createdAt: entry.createdAt,
      createdBy: entry.createdBy,
      rights: entry.rights,
    })));

  it("refuses to select a held Meshy asset for production", () => {
    const held = ingestMeshyAsset(baseRequest({ declaredProductTarget: "rtx5090" }));
    expect(held.registryStatus).toBe("needs-review");
    const registry = new Map([[held.assetId, held.evaluated]]);
    expect(() => selectApprovedProductVisualAsset(registry, { productId: "rtx5090", roles: ["product-illustration"] }))
      .toThrow(/No rights-approved visual asset/);
  });

  it("selects an approved Meshy asset once it is cleared", () => {
    const approved = ingestMeshyAsset(fullyCleared({ declaredProductTarget: "rtx5090" }));
    const registry = new Map([[approved.assetId, approved.evaluated]]);
    const selected = selectApprovedProductVisualAsset(registry, { productId: "rtx5090", roles: ["product-illustration"] });
    expect(selected.assetId).toBe(approved.assetId);
  });

  it("fails the final publication bundle when a held Meshy asset is used", () => {
    // The last line of defence: even if something selected a held asset, the
    // bundle gate refuses to publish the master.
    const held = ingestMeshyAsset(baseRequest());
    const registry = new Map([[held.assetId, held.evaluated]]);
    const bundle = evaluatePublicationAssetBundle(registry, {
      usedAssetIds: [held.assetId],
      expectedVisualAssetIds: [held.assetId],
    });
    expect(bundle.publishable).toBe(false);
    expect(bundle.nonApprovedAssetIds).toContain(held.assetId);
  });

  it("passes the bundle gate only for cleared assets", () => {
    const approved = ingestMeshyAsset(fullyCleared());
    const registry = new Map([[approved.assetId, approved.evaluated]]);
    const bundle = evaluatePublicationAssetBundle(registry, {
      usedAssetIds: [approved.assetId],
      expectedVisualAssetIds: [approved.assetId],
    });
    expect(bundle.publishable).toBe(true);
  });

  it("integrates with the shared registry builder without losing the floor", () => {
    // Round-tripping through buildProductVisualAssetRegistry must not
    // re-evaluate a held asset back into approved.
    const registry = registryOf(baseRequest());
    const [entry] = [...registry.values()];
    expect(entry.status).not.toBe("approved");
  });
});
