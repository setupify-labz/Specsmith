import { describe, expect, it } from "vitest";

import { cleanRestrictedFeatureReview } from "./assetRights.ts";
import {
  buildProductVisualAssetRegistry,
  evaluatePublicationAssetBundle,
  selectApprovedProductVisualAsset,
  type EvaluatedProductVisualAsset,
} from "./productVisualAssets.ts";
import {
  ingestMeshyAsset,
  isPublishableMeshyAsset,
  meshyAssetId,
  meshyRegistryEntries,
  MeshyIngestError,
  type MeshyIngestRequest,
  type MeshySourceReference,
} from "./meshyIngestion.ts";

const OUTPUT_SHA = "a".repeat(64);
const OTHER_SHA = "b".repeat(64);
const SOURCE_SHA = "c".repeat(64);

const MASTER_SHA = "d".repeat(64);

/**
 * The rendered master, registered as an ordinary SpecSmith-owned asset.
 *
 * evaluatePublicationAssetBundle resolves the hash it approves from this
 * record, so a bundle with no registered master has nothing to approve.
 */
const masterRecord = {
  assetId: "master",
  role: "specsmith-evidence",
  uri: "artifact://master.mp4",
  mimeType: "video/mp4",
  sha256: MASTER_SHA,
  version: 1,
  createdAt: "2026-08-23T20:00:00Z",
  createdBy: "specsmith",
  rights: {
    assetId: "master",
    assetType: "video",
    intendedUse: "commercial-marketing",
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
  },
} as const;

/** Registry containing the master plus the Meshy assets under test. */
function registryWithMaster(...assets: EvaluatedProductVisualAsset[]): Map<string, EvaluatedProductVisualAsset> {
  const registry = buildProductVisualAssetRegistry([masterRecord]);
  for (const asset of assets) registry.set(asset.assetId, asset);
  return registry;
}

const clearedReference: MeshySourceReference = {
  uri: "library:specsmith/reference/generic-gpu-shell.png",
  sha256: SOURCE_SHA,
  sourceKind: "specsmith-owned",
  commercialUseAllowed: true,
  derivativeUseAllowed: true,
};

const baseRequest = (over: Partial<MeshyIngestRequest> = {}): MeshyIngestRequest => ({
  providerAssetId: "task-1234-preview",
  providerTaskId: "task-1234",
  assetKind: "preview-image",
  generationMode: "text-to-image",
  prompt: "a generic angular graphics card, no branding, studio lighting",
  createdAt: "2026-08-23T10:00:00.000Z",
  outputFile: {
    uri: "artifact:meshy/task-1234/preview.png",
    mimeType: "image/png",
    sha256: OUTPUT_SHA,
  },
  declaredGeometryMode: "generic-representative",
  observedFeatures: cleanRestrictedFeatureReview(),
  intendedUse: "editorial-publication",
  ...over,
});

const fullyCleared = (over: Partial<MeshyIngestRequest> = {}): MeshyIngestRequest =>
  baseRequest({
    humanClearance: {
      reviewer: "policy-team",
      evidenceRef: "review-ticket-88",
      reviewedAt: "2026-08-23T11:00:00.000Z",
      assetSha256: OUTPUT_SHA,
    },
    ...over,
  });

describe("content-addressed Meshy identity and clearance", () => {
  it("holds a clean generic asset until a human clearance exists", () => {
    const result = ingestMeshyAsset(baseRequest());
    expect(result.publicationDecision).toBe("hold");
    expect(result.registryStatus).toBe("needs-review");
    expect(isPublishableMeshyAsset(result)).toBe(false);
    expect(result.registryRecord.sha256).toBe(OUTPUT_SHA);
  });

  it("approves a clean generic asset only after clearance bound to the exact bytes", () => {
    const result = ingestMeshyAsset(fullyCleared());
    expect(result.publicationDecision).toBe("allow");
    expect(result.registryStatus).toBe("approved");
    expect(isPublishableMeshyAsset(result)).toBe(true);
    expect(result.provenance.humanClearance?.assetSha256).toBe(OUTPUT_SHA);
    expect(result.rightsManifest.notes?.join("\n")).toContain("review-ticket-88");
    expect(result.rightsManifest.notes?.join("\n")).toContain(`outputSha256=${OUTPUT_SHA}`);
  });

  it("rejects a human clearance for different bytes", () => {
    expect(() => ingestMeshyAsset(fullyCleared({
      humanClearance: {
        reviewer: "policy-team",
        evidenceRef: "review-ticket-88",
        reviewedAt: "2026-08-23T11:00:00.000Z",
        assetSha256: OTHER_SHA,
      },
    }))).toThrow(/Review does not transfer across different bytes/);
  });

  it("includes the output hash in asset identity so changed bytes cannot inherit approval", () => {
    const first = meshyAssetId("task-1234-preview", OUTPUT_SHA);
    const changed = meshyAssetId("task-1234-preview", OTHER_SHA);
    expect(first).not.toBe(changed);
    expect(first).toContain(OUTPUT_SHA.slice(0, 16));
  });

  it("requires a complete human clearance record", () => {
    expect(() => ingestMeshyAsset(baseRequest({
      humanClearance: {
        reviewer: "",
        evidenceRef: "review-ticket-88",
        reviewedAt: "2026-08-23T11:00:00.000Z",
        assetSha256: OUTPUT_SHA,
      },
    }))).toThrow(/humanClearance.reviewer/);
    expect(() => ingestMeshyAsset(baseRequest({
      humanClearance: {
        reviewer: "policy-team",
        evidenceRef: "review-ticket-88",
        reviewedAt: "not-a-date",
        assetSha256: OUTPUT_SHA,
      },
    }))).toThrow(/valid timestamp/);
  });
});

describe("reference lineage is explicit and immutable", () => {
  it("blocks image-to-3d when required source lineage is missing", () => {
    const result = ingestMeshyAsset(fullyCleared({ generationMode: "image-to-3d", sourceReferences: [] }));
    expect(result.publicationDecision).toBe("block");
    expect(result.registryStatus).toBe("blocked");
    expect(result.rightsManifest.generationMode).toBe("derived-from-references");
    expect(result.rightsManifest.sourceGrants[0].sourceKind).toBe("unknown");
  });

  it("blocks image-to-image when required source lineage is missing", () => {
    expect(ingestMeshyAsset(fullyCleared({ generationMode: "image-to-image", sourceReferences: [] })).publicationDecision).toBe("block");
  });

  it("blocks texture generation when required source lineage is missing", () => {
    expect(ingestMeshyAsset(fullyCleared({ assetKind: "texture", outputFile: {
      uri: "artifact:meshy/task-1234/texture.png",
      mimeType: "image/png",
      sha256: OUTPUT_SHA,
    }, generationMode: "texture-generation", sourceReferences: [] })).publicationDecision).toBe("block");
  });

  it("refuses reference inputs mislabeled as text-only generation", () => {
    expect(() => ingestMeshyAsset(fullyCleared({
      generationMode: "text-to-image",
      sourceReferences: [clearedReference],
    }))).toThrow(/corresponding image-conditioned generation mode/);
  });

  it("rejects the old ambiguous image-generation mode at runtime", () => {
    const request = { ...fullyCleared(), generationMode: "image-generation" } as unknown as MeshyIngestRequest;
    expect(() => ingestMeshyAsset(request)).toThrow(/ambiguous generationMode/);
  });

  it("requires every source reference to have a URI and SHA-256", () => {
    expect(() => ingestMeshyAsset(fullyCleared({
      generationMode: "image-to-3d",
      sourceReferences: [{ ...clearedReference, uri: "" }],
    }))).toThrow(/sourceReferences\[0\]\.uri/);
    expect(() => ingestMeshyAsset(fullyCleared({
      generationMode: "image-to-3d",
      sourceReferences: [{ ...clearedReference, sha256: "abc" }],
    }))).toThrow(/SHA-256/);
  });

  it("blocks an unknown source and a reference that forbids derivatives", () => {
    const unknown = ingestMeshyAsset(fullyCleared({
      generationMode: "image-to-3d",
      sourceReferences: [{ ...clearedReference, sourceKind: "unknown" }],
    }));
    expect(unknown.publicationDecision).toBe("block");

    const noDerivative = ingestMeshyAsset(fullyCleared({
      generationMode: "image-to-3d",
      sourceReferences: [{ ...clearedReference, derivativeUseAllowed: false }],
    }));
    expect(noDerivative.publicationDecision).toBe("block");
  });

  it("persists the exact reference hashes into provenance and durable rights evidence", () => {
    const result = ingestMeshyAsset(fullyCleared({
      generationMode: "image-to-3d",
      sourceReferences: [clearedReference],
    }));
    expect(result.provenance.sourceReferences[0].sha256).toBe(SOURCE_SHA);
    expect(result.rightsManifest.sourceGrants[0].evidenceRef).toContain(`sha256:${SOURCE_SHA}`);
  });
});

describe("exact product geometry", () => {
  it("holds an exact model without design-use authorization", () => {
    const result = ingestMeshyAsset(fullyCleared({
      generationMode: "text-to-3d",
      assetKind: "model",
      outputFile: { uri: "artifact:meshy/task-5090/model.glb", mimeType: "model/gltf-binary", sha256: OUTPUT_SHA },
      declaredGeometryMode: "licensed-exact",
      declaredProductTarget: "rtx5090",
    }));
    expect(result.publicationDecision).toBe("hold");
    expect(result.reviewFindings.distinctiveIndustrialDesign).toBe("present");
  });

  it("allows a text-to-3d exact model with matching design authorization and clean human review", () => {
    const result = ingestMeshyAsset(fullyCleared({
      generationMode: "text-to-3d",
      assetKind: "model",
      outputFile: { uri: "artifact:meshy/task-5090/model.glb", mimeType: "model/gltf-binary", sha256: OUTPUT_SHA },
      declaredGeometryMode: "licensed-exact",
      declaredProductTarget: "rtx5090",
      designAuthorization: { productId: "rtx5090", evidenceRef: "oem-design-license-5090", authorizedAt: "2026-08-01T00:00:00Z" },
      observedFeatures: cleanRestrictedFeatureReview({ distinctiveIndustrialDesign: "present" }),
    }));
    expect(result.publicationDecision).toBe("allow");
    expect(result.rightsManifest.sourceGrants[0].designUseAuthorized).toBe(true);
    expect(result.rightsManifest.notes?.join("\n")).toContain("oem-design-license-5090");
    expect(result.provenance.designAuthorization?.productId).toBe("rtx5090");
  });

  it("still requires reference permissions for a reference-derived exact model", () => {
    const result = ingestMeshyAsset(fullyCleared({
      generationMode: "image-to-3d",
      assetKind: "model",
      outputFile: { uri: "artifact:meshy/task-5090/model.glb", mimeType: "model/gltf-binary", sha256: OUTPUT_SHA },
      declaredGeometryMode: "licensed-exact",
      declaredProductTarget: "rtx5090",
      designAuthorization: { productId: "rtx5090", evidenceRef: "oem-design-license-5090" },
      sourceReferences: [{ ...clearedReference, designUseAuthorized: false }],
      observedFeatures: cleanRestrictedFeatureReview({ distinctiveIndustrialDesign: "present" }),
    }));
    expect(result.publicationDecision).toBe("hold");
  });

  it("allows reference-derived exact geometry only when product and source permissions both support it", () => {
    const result = ingestMeshyAsset(fullyCleared({
      generationMode: "image-to-3d",
      assetKind: "model",
      outputFile: { uri: "artifact:meshy/task-5090/model.glb", mimeType: "model/gltf-binary", sha256: OUTPUT_SHA },
      declaredGeometryMode: "licensed-exact",
      declaredProductTarget: "rtx5090",
      designAuthorization: { productId: "rtx5090", evidenceRef: "oem-design-license-5090" },
      sourceReferences: [{ ...clearedReference, designUseAuthorized: true }],
      observedFeatures: cleanRestrictedFeatureReview({ distinctiveIndustrialDesign: "present" }),
    }));
    expect(result.publicationDecision).toBe("allow");
  });

  it("rejects design authorization for the wrong product or no target", () => {
    expect(() => ingestMeshyAsset(fullyCleared({
      declaredGeometryMode: "licensed-exact",
      declaredProductTarget: "rtx5090",
      designAuthorization: { productId: "rtx4090", evidenceRef: "license" },
    }))).toThrow(/asset targets rtx5090/);
    expect(() => ingestMeshyAsset(fullyCleared({
      declaredGeometryMode: "licensed-exact",
      designAuthorization: { productId: "rtx5090", evidenceRef: "license" },
    }))).toThrow(/declaredProductTarget is missing/);
  });

  it("invalidates an earlier clearance when a supposedly generic asset is observed to be distinctive", () => {
    const result = ingestMeshyAsset(fullyCleared({
      declaredGeometryMode: "generic-representative",
      observedFeatures: cleanRestrictedFeatureReview({ distinctiveIndustrialDesign: "present" }),
    }));
    expect(result.publicationDecision).toBe("hold");
    expect(result.rightsManifest.reviewedBy).toBe("not-reviewed");
  });
});

describe("restricted features and product identity", () => {
  it("treats omitted visual review fields as unknown", () => {
    const result = ingestMeshyAsset(fullyCleared({ observedFeatures: undefined }));
    expect(result.reviewFindings.logos).toBe("unknown");
    expect(result.publicationDecision).toBe("hold");
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
    it(`blocks ${feature}`, () => {
      const result = ingestMeshyAsset(fullyCleared({
        observedFeatures: cleanRestrictedFeatureReview({ [feature]: "present" }),
      }));
      expect(result.publicationDecision).toBe("block");
    });
  }

  it("never bakes product branding and uses deterministic plain text for named products", () => {
    const generic = ingestMeshyAsset(baseRequest());
    expect(generic.rightsManifest.productIdentityMode).toBe("none");
    const named = ingestMeshyAsset(baseRequest({ declaredProductTarget: "rtx5090" }));
    expect(named.rightsManifest.productIdentityMode).toBe("deterministic-plain-text-overlay");
  });
});

describe("input hardening", () => {
  it("rejects missing or malformed output identity", () => {
    expect(() => ingestMeshyAsset({ ...baseRequest(), outputFile: undefined } as unknown as MeshyIngestRequest)).toThrow(/outputFile is required/);
    expect(() => ingestMeshyAsset(baseRequest({ outputFile: { ...baseRequest().outputFile, uri: "" } }))).toThrow(/outputFile.uri/);
    expect(() => ingestMeshyAsset(baseRequest({ outputFile: { ...baseRequest().outputFile, sha256: "bad" } }))).toThrow(/SHA-256/);
  });

  it("rejects MIME types that do not match the asset kind", () => {
    expect(() => ingestMeshyAsset(baseRequest({ assetKind: "model", outputFile: { ...baseRequest().outputFile, mimeType: "image/png" } }))).toThrow(/does not accept mimeType/);
  });

  it("rejects invalid timestamps and unsupported URI schemes", () => {
    expect(() => ingestMeshyAsset(baseRequest({ createdAt: "not-a-date" }))).toThrow(/valid timestamp/);
    expect(() => ingestMeshyAsset(baseRequest({ outputFile: { ...baseRequest().outputFile, uri: "ftp://example.com/file.png" } }))).toThrow(/unsupported URI scheme/);
  });
});

describe("shared registry and final publication gate", () => {
  const registryOf = (...requests: MeshyIngestRequest[]): Map<string, EvaluatedProductVisualAsset> =>
    buildProductVisualAssetRegistry(meshyRegistryEntries(requests.map(ingestMeshyAsset)).map((entry) => ({
      assetId: entry.assetId,
      productId: entry.productId,
      role: entry.role,
      uri: entry.uri,
      mimeType: entry.mimeType,
      sha256: entry.sha256,
      version: entry.version,
      createdAt: entry.createdAt,
      createdBy: entry.createdBy,
      rights: entry.rights,
    })));

  it("does not lose a hold when rebuilt through the shared registry", () => {
    const registry = registryOf(baseRequest());
    const [entry] = [...registry.values()];
    expect(entry.status).toBe("needs-review");
  });

  it("does not lose a missing-lineage block when rebuilt through the shared registry", () => {
    const registry = registryOf(fullyCleared({ generationMode: "image-to-3d", sourceReferences: [] }));
    const [entry] = [...registry.values()];
    expect(entry.status).toBe("blocked");
  });

  it("refuses held Meshy assets during production selection", () => {
    const held = ingestMeshyAsset(baseRequest({ declaredProductTarget: "rtx5090" }));
    const registry = new Map([[held.assetId, held.evaluated]]);
    expect(() => selectApprovedProductVisualAsset(registry, { productId: "rtx5090", roles: ["product-illustration"] }))
      .toThrow(/No rights-approved visual asset/);
  });

  it("selects an approved Meshy asset after exact-byte clearance", () => {
    const approved = ingestMeshyAsset(fullyCleared({ declaredProductTarget: "rtx5090" }));
    const registry = new Map([[approved.assetId, approved.evaluated]]);
    expect(selectApprovedProductVisualAsset(registry, { productId: "rtx5090", roles: ["product-illustration"] }).assetId)
      .toBe(approved.assetId);
  });

  it("blocks the final master if a held Meshy asset was used", () => {
    const held = ingestMeshyAsset(baseRequest());
    const bundle = evaluatePublicationAssetBundle(registryWithMaster(held.evaluated), {
      masterAssetId: "master",
      usedAssetIds: [held.assetId],
      expectedVisualAssetIds: [held.assetId],
    });
    expect(bundle.publishable).toBe(false);
    expect(bundle.nonApprovedAssetIds).toContain(held.assetId);
    // A clean master does not rescue a bundle whose components are held.
    expect(bundle.approvedMasterSha256).toBe(MASTER_SHA);
  });

  it("passes the final bundle gate for an approved Meshy asset", () => {
    const approved = ingestMeshyAsset(fullyCleared());
    const bundle = evaluatePublicationAssetBundle(registryWithMaster(approved.evaluated), {
      masterAssetId: "master",
      usedAssetIds: [approved.assetId],
      expectedVisualAssetIds: [approved.assetId],
    });
    expect(bundle.publishable).toBe(true);
    expect(bundle.approvedMasterSha256).toBe(MASTER_SHA);
  });
});
