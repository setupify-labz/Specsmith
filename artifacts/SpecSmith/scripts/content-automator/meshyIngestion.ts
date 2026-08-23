// Meshy asset ingestion — a provider feeding the rights system, not a bypass.
//
// Meshy can generate genuinely useful hardware visuals. It can also drift into
// near-copy geometry, invented NVIDIA-ish wordmarks, retailer stickers and
// textures that look lifted from product photography. Nothing here tries to
// decide which happened. Ingestion's job is to record what is known, refuse to
// assume what is not, and hand the result to the existing policy engine in
// assetRights.ts.
//
// THE TWO RULES THAT MATTER
// -------------------------
// 1. Unstated is UNKNOWN, never absent. A caller that does not assert "this
//    render has no logos" gets `unknown`, which the policy engine holds on.
//    Defaulting to "absent" would let a silent integration publish exactly the
//    assets this pipeline exists to stop.
//
// 2. Restrictions are written INTO the manifest, not applied on top of it.
//    An earlier version computed the engine's decision and then tightened it
//    afterwards, which a test caught as a fail-open: rebuilding the registry
//    from stored records re-ran the engine on the manifest alone and promoted
//    held assets back to approved. So the reasons for holding now live in the
//    manifest itself (reviewedBy, distinctiveIndustrialDesign), and any
//    consumer re-evaluating independently reaches the same answer. The floor
//    that remains is belt-and-braces: it can only tighten, never widen.
//
// WHY MESHY NEVER AUTO-APPROVES
// -----------------------------
// The ingest-time review is automated: it reads declarations from the caller
// and file metadata. That is enough to catch missing provenance and declared
// exactness, and nowhere near enough to certify that a generated image contains
// no brand-like mark. So an ingested Meshy asset caps at `hold` until a human
// clearance is recorded against it. Exact third-party industrial design caps at
// `hold` even then, unless design-use authorization is on file.

import {
  cleanRestrictedFeatureReview,
  evaluateAssetRights,
  generatedNoReferenceGrant,
  type AssetIntendedUse,
  type AssetPolicyDecision,
  type AssetRightsGrant,
  type AssetRightsManifest,
  type AssetSourceKind,
  type FeaturePresence,
  type RestrictedVisualFeatureReview,
} from "./assetRights.ts";
import {
  evaluateProductVisualAsset,
  type EvaluatedProductVisualAsset,
  type ProductVisualAssetRecord,
  type ProductVisualAssetRole,
  type ProductVisualAssetStatus,
} from "./productVisualAssets.ts";
import type { ProductGeometryMode } from "./rightsSafeVisuals.ts";

export const MESHY_PROVIDER = "meshy" as const;

export class MeshyIngestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MeshyIngestError";
    this.code = code;
  }
}

export type MeshyAssetKind = "image" | "preview-image" | "model" | "texture";

export type MeshyGenerationMode =
  | "text-to-3d"
  | "image-to-3d"
  | "image-generation"
  | "texture-generation";

/** One upstream input Meshy was given. Lineage, recorded per reference. */
export interface MeshySourceReference {
  uri: string;
  sourceKind: AssetSourceKind;
  evidenceRef?: string;
  commercialUseAllowed: boolean;
  derivativeUseAllowed: boolean;
  designUseAuthorized?: boolean;
  trademarkUseAuthorized?: boolean;
  attributionRequired?: boolean;
  attributionText?: string;
}

/** A recorded human sign-off. Without one, ingestion cannot reach `approved`. */
export interface MeshyHumanClearance {
  reviewer: string;
  /** Durable reference: review ticket, doc id, signed note. */
  evidenceRef: string;
  reviewedAt: string;
}

/** Recorded permission to depict a specific third-party product's exact design. */
export interface MeshyDesignAuthorization {
  productId: string;
  evidenceRef: string;
}

export interface MeshyIngestRequest {
  providerAssetId: string;
  taskId?: string;
  assetKind: MeshyAssetKind;
  generationMode: MeshyGenerationMode;
  prompt?: string;
  modelSettings?: Record<string, string | number | boolean>;
  createdAt: string;
  fileUris: string[];
  /** Every input Meshy consumed. Required for any image/texture-derived mode. */
  sourceReferences?: MeshySourceReference[];
  /** The SpecSmith product this asset claims to depict, if any. */
  declaredProductTarget?: string;
  declaredGeometryMode: ProductGeometryMode;
  designAuthorization?: MeshyDesignAuthorization;
  /**
   * Restricted features the caller has actually inspected. Anything omitted
   * stays `unknown` — see the header: unstated is never absent.
   */
  observedFeatures?: Partial<RestrictedVisualFeatureReview>;
  humanClearance?: MeshyHumanClearance;
  intendedUse: AssetIntendedUse;
}

export interface MeshyProvenance {
  provider: typeof MESHY_PROVIDER;
  providerAssetId: string;
  taskId?: string;
  generationMode: MeshyGenerationMode;
  prompt?: string;
  modelSettings?: Record<string, string | number | boolean>;
  createdAt: string;
  fileUris: string[];
  referenceUris: string[];
}

export interface MeshyIngestResult {
  assetId: string;
  registryStatus: ProductVisualAssetStatus;
  publicationDecision: AssetPolicyDecision;
  geometryMode: ProductGeometryMode;
  rightsManifest: AssetRightsManifest;
  registryRecord: ProductVisualAssetRecord;
  evaluated: EvaluatedProductVisualAsset;
  reviewFindings: RestrictedVisualFeatureReview;
  provenance: MeshyProvenance;
  /** Human-readable explanation of the decision, most severe first. */
  reasons: string[];
}

/** Modes where Meshy consumed an upstream image; lineage is mandatory. */
const REFERENCE_CONSUMING_MODES: ReadonlySet<MeshyGenerationMode> = new Set([
  "image-to-3d",
  "texture-generation",
]);

const MIME_BY_KIND: Record<MeshyAssetKind, string> = {
  image: "image/png",
  "preview-image": "image/png",
  model: "model/gltf-binary",
  texture: "image/png",
};

const ASSET_TYPE_BY_KIND: Record<MeshyAssetKind, AssetRightsManifest["assetType"]> = {
  image: "image",
  "preview-image": "image",
  model: "3d-model",
  texture: "texture",
};

function roleFor(request: MeshyIngestRequest): ProductVisualAssetRole {
  if (request.assetKind === "texture") return "texture";
  if (request.assetKind === "model") return "3d-production-asset";
  // An image that claims a specific product is an illustration of that product;
  // one that does not is only ever a generic hook visual.
  return request.declaredProductTarget ? "product-illustration" : "generic-hook";
}

/** Stable, derived from the provider's own id so re-ingesting is idempotent. */
export function meshyAssetId(providerAssetId: string): string {
  const trimmed = providerAssetId.trim();
  if (!trimmed) throw new MeshyIngestError("missing-provider-id", "Meshy asset requires a providerAssetId.");
  return `meshy-${trimmed.replace(/[^A-Za-z0-9._-]/g, "-")}`;
}

function toGrant(reference: MeshySourceReference): AssetRightsGrant {
  return {
    sourceKind: reference.sourceKind,
    sourceUri: reference.uri,
    evidenceRef: reference.evidenceRef,
    commercialUseAllowed: reference.commercialUseAllowed,
    derivativeUseAllowed: reference.derivativeUseAllowed,
    // Design and trademark authorization are opt-in: a reference that does not
    // explicitly grant them does not grant them.
    designUseAuthorized: reference.designUseAuthorized === true,
    trademarkUseAuthorized: reference.trademarkUseAuthorized === true,
    attributionRequired: reference.attributionRequired === true,
    attributionText: reference.attributionText,
  };
}

/**
 * Merges declared observations over an all-unknown baseline.
 *
 * Deliberately NOT cleanRestrictedFeatureReview(): that helper starts from
 * "absent", which is the right default for an asset SpecSmith drew itself and
 * exactly the wrong one for a generative provider.
 */
function reviewFrom(observed: Partial<RestrictedVisualFeatureReview> | undefined): RestrictedVisualFeatureReview {
  const baseline: RestrictedVisualFeatureReview = {
    logos: "unknown",
    stylizedWordmarks: "unknown",
    watermarks: "unknown",
    copyrightedArtworkOrGraphics: "unknown",
    serialNumbersOrStickerText: "unknown",
    retailerMarks: "unknown",
    copiedProductPhotography: "unknown",
    distinctiveIndustrialDesign: "unknown",
  };
  if (!observed) return baseline;
  const merged = { ...baseline };
  for (const [key, value] of Object.entries(observed) as [keyof RestrictedVisualFeatureReview, FeaturePresence | undefined][]) {
    if (value) merged[key] = value;
  }
  return merged;
}

const SEVERITY_RANK: Record<AssetPolicyDecision, number> = { allow: 0, hold: 1, block: 2 };

/** Returns whichever decision is more restrictive. Never widens. */
function tightest(a: AssetPolicyDecision, b: AssetPolicyDecision): AssetPolicyDecision {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function validate(request: MeshyIngestRequest): void {
  if (!request.fileUris.length) {
    throw new MeshyIngestError("missing-files", `Meshy asset ${request.providerAssetId} has no file URIs.`);
  }
  if (!request.createdAt.trim()) {
    throw new MeshyIngestError("missing-created-at", `Meshy asset ${request.providerAssetId} has no createdAt.`);
  }
  if (request.designAuthorization && request.declaredProductTarget &&
      request.designAuthorization.productId !== request.declaredProductTarget) {
    throw new MeshyIngestError(
      "authorization-product-mismatch",
      `Design authorization names product ${request.designAuthorization.productId} but the asset targets ${request.declaredProductTarget}.`,
    );
  }
}

/**
 * Normalizes a Meshy output into a quarantined registry record plus its rights
 * manifest, and decides whether it may be published.
 *
 * Never throws on a policy problem — a blocked asset is a normal, recorded
 * outcome. It throws only when the input is too malformed to describe at all,
 * because inventing the missing parts is what this module exists to prevent.
 */
export function ingestMeshyAsset(request: MeshyIngestRequest): MeshyIngestResult {
  validate(request);

  const assetId = meshyAssetId(request.providerAssetId);
  const references = request.sourceReferences ?? [];
  const reasons: string[] = [];
  let providerFloor: AssetPolicyDecision = "allow";
  const tighten = (decision: AssetPolicyDecision, reason: string) => {
    providerFloor = tightest(providerFloor, decision);
    reasons.push(reason);
  };

  // Lineage. image-to-3d and texture-generation always consumed something; if
  // the caller cannot say what, the asset is unusable rather than assumed safe.
  if (REFERENCE_CONSUMING_MODES.has(request.generationMode) && references.length === 0) {
    tighten(
      "block",
      `${request.generationMode} consumed an input image, but no source reference lineage was recorded. Refusing to treat unknown input as clean.`,
    );
  }

  const derived = references.length > 0;
  const grants: AssetRightsGrant[] = derived
    ? references.map(toGrant)
    // text-to-3d / image-generation with no inputs: generated from nothing but
    // a prompt. Still not a licence to depict someone's exact product.
    : [generatedNoReferenceGrant()];

  const reviewFindings = reviewFrom(request.observedFeatures);

  // A "licensed-exact" claim IS an assertion that distinctive industrial design
  // is present, so record it as such. This matters beyond bookkeeping: it makes
  // the policy engine reach the hold on its own, rather than depending on this
  // module's floor surviving a round-trip through the registry.
  if (request.declaredGeometryMode === "licensed-exact") {
    reviewFindings.distinctiveIndustrialDesign = "present";
  }

  // Exactness. A "licensed-exact" claim is only honoured when authorization is
  // recorded; otherwise the asset may exist internally but never auto-publish.
  const geometryMode: ProductGeometryMode = request.declaredGeometryMode;
  const exactAuthorized = Boolean(request.designAuthorization?.evidenceRef.trim());
  if (geometryMode === "licensed-exact") {
    if (!exactAuthorized) {
      tighten(
        "hold",
        "Asset claims exact third-party industrial design but no design-use authorization is recorded. Held: it may exist internally, but cannot become a production asset.",
      );
    } else if (!request.declaredProductTarget) {
      tighten("hold", "Exact-design authorization was supplied without naming the product it covers.");
    }
  }
  // A declared-generic asset that nonetheless shows distinctive design is a
  // contradiction; trust the observation, not the label.
  if (geometryMode === "generic-representative" && reviewFindings.distinctiveIndustrialDesign === "present") {
    tighten(
      "hold",
      "Asset is declared generic but distinctive industrial design was observed in it. The observation wins.",
    );
  }

  // Human review. Automated ingest cannot certify that a generated image is
  // free of brand-like marks, so approval requires a recorded sign-off.
  const cleared = Boolean(request.humanClearance?.evidenceRef.trim());
  if (!cleared) {
    tighten(
      "hold",
      "No human clearance recorded. Meshy output is held by default because ingest-time review is automated and cannot certify generated imagery.",
    );
  }

  const manifest: AssetRightsManifest = {
    assetId,
    assetType: ASSET_TYPE_BY_KIND[request.assetKind],
    intendedUse: request.intendedUse,
    productId: request.declaredProductTarget,
    generationMode: derived ? "derived-from-references" : "generated-no-reference",
    sourceGrants: grants,
    parentAssetIds: [],
    // Meshy is never allowed to bake branding; product identity is added
    // downstream as deterministic plain text.
    productIdentityMode: "none",
    restrictedFeatures: reviewFindings,
    // Without a recorded human sign-off this is genuinely "not-reviewed" as far
    // as publication is concerned: the provider declared some fields, which is
    // not a restricted-feature review of generated imagery. Saying so in the
    // manifest is what makes the hold DURABLE — evaluateAssetRights() then
    // reaches it independently, so rebuilding the registry from stored records
    // cannot quietly promote a held asset back to approved.
    reviewedBy: cleared ? "automated-and-human" : "not-reviewed",
    notes: [
      `provider=${MESHY_PROVIDER}`,
      `providerAssetId=${request.providerAssetId}`,
      `generationMode=${request.generationMode}`,
      `geometryMode=${geometryMode}`,
    ],
  };

  const record: ProductVisualAssetRecord = {
    assetId,
    productId: request.declaredProductTarget,
    role: roleFor(request),
    uri: request.fileUris[0],
    mimeType: MIME_BY_KIND[request.assetKind],
    version: 1,
    createdAt: request.createdAt,
    createdBy: "provider",
    rights: manifest,
  };

  const evaluated = evaluateProductVisualAsset(record);
  const basePolicy = evaluateAssetRights(manifest);
  for (const entry of basePolicy.issues) reasons.push(`${entry.severity}: ${entry.code} — ${entry.message}`);

  // The floor only ever tightens the engine's decision.
  const publicationDecision = tightest(basePolicy.decision, providerFloor);
  const registryStatus: ProductVisualAssetStatus =
    publicationDecision === "allow" ? "approved" : publicationDecision === "hold" ? "needs-review" : "blocked";

  reasons.sort((a, b) => {
    const rank = (s: string) => (s.startsWith("block") || s.includes("Refusing") ? 0 : 1);
    return rank(a) - rank(b);
  });

  return {
    assetId,
    registryStatus,
    publicationDecision,
    geometryMode,
    rightsManifest: manifest,
    registryRecord: record,
    evaluated: { ...evaluated, status: registryStatus, policyDecision: publicationDecision },
    reviewFindings,
    provenance: {
      provider: MESHY_PROVIDER,
      providerAssetId: request.providerAssetId,
      taskId: request.taskId,
      generationMode: request.generationMode,
      prompt: request.prompt,
      modelSettings: request.modelSettings,
      createdAt: request.createdAt,
      fileUris: [...request.fileUris],
      referenceUris: references.map((entry) => entry.uri),
    },
    reasons,
  };
}

/**
 * Registry entries for a batch of ingested Meshy assets.
 *
 * Returns the evaluated records with the provider floor already applied, so a
 * caller cannot accidentally register the un-floored version.
 */
export function meshyRegistryEntries(results: readonly MeshyIngestResult[]): EvaluatedProductVisualAsset[] {
  return results.map((result) => result.evaluated);
}

/** True only for assets that cleared every gate. Used by production selection. */
export function isPublishableMeshyAsset(result: MeshyIngestResult): boolean {
  return result.publicationDecision === "allow" && result.registryStatus === "approved";
}
