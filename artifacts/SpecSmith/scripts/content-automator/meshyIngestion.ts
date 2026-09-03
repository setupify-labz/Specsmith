// Meshy asset ingestion — a provider feeding the rights system, not a bypass.
//
// The contract is intentionally strict: one physical output file equals one
// registry asset, content identity includes SHA-256, reference-conditioned
// generation must declare every consumed input, and a human clearance is bound
// to the exact output bytes it reviewed.

import {
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

/**
 * Reference semantics are explicit. The old catch-all `image-generation` name
 * was ambiguous because it could mean text-to-image or image-conditioned
 * generation, which made it possible to omit required source lineage.
 */
export type MeshyGenerationMode =
  | "text-to-3d"
  | "image-to-3d"
  | "text-to-image"
  | "image-to-image"
  | "texture-generation";

export interface MeshyOutputFile {
  /** One concrete output only. Multi-output Meshy jobs are ingested once per file. */
  uri: string;
  mimeType: string;
  sha256: string;
}

/** One exact upstream input Meshy consumed. */
export interface MeshySourceReference {
  uri: string;
  /** Hash of the exact source bytes, not merely the URL that happened to serve them. */
  sha256: string;
  sourceKind: AssetSourceKind;
  evidenceRef?: string;
  commercialUseAllowed: boolean;
  derivativeUseAllowed: boolean;
  designUseAuthorized?: boolean;
  trademarkUseAuthorized?: boolean;
  attributionRequired?: boolean;
  attributionText?: string;
}

/** Human review is approval of exact bytes, not of a mutable provider URL. */
export interface MeshyHumanClearance {
  reviewer: string;
  evidenceRef: string;
  reviewedAt: string;
  assetSha256: string;
}

/** Recorded permission to depict the named product's distinctive design. */
export interface MeshyDesignAuthorization {
  productId: string;
  evidenceRef: string;
  authorizedAt?: string;
}

export interface MeshyIngestRequest {
  /** Must identify this output within Meshy. Different output files need different ids. */
  providerAssetId: string;
  providerTaskId?: string;
  assetKind: MeshyAssetKind;
  generationMode: MeshyGenerationMode;
  prompt?: string;
  modelSettings?: Record<string, string | number | boolean>;
  createdAt: string;
  outputFile: MeshyOutputFile;
  /** Every input Meshy consumed. Required for image-conditioned/texture modes. */
  sourceReferences?: MeshySourceReference[];
  /** The SpecSmith catalog product this visual claims to depict, if any. */
  declaredProductTarget?: string;
  declaredGeometryMode: ProductGeometryMode;
  designAuthorization?: MeshyDesignAuthorization;
  /** Anything omitted remains unknown, never absent. */
  observedFeatures?: Partial<RestrictedVisualFeatureReview>;
  humanClearance?: MeshyHumanClearance;
  intendedUse: AssetIntendedUse;
}

export interface MeshyProvenance {
  provider: typeof MESHY_PROVIDER;
  providerAssetId: string;
  providerTaskId?: string;
  generationMode: MeshyGenerationMode;
  prompt?: string;
  modelSettings?: Record<string, string | number | boolean>;
  createdAt: string;
  outputFile: MeshyOutputFile;
  sourceReferences: MeshySourceReference[];
  humanClearance?: MeshyHumanClearance;
  designAuthorization?: MeshyDesignAuthorization;
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
  reasons: string[];
}

const ASSET_KINDS = new Set<MeshyAssetKind>(["image", "preview-image", "model", "texture"]);
const GENERATION_MODES = new Set<MeshyGenerationMode>([
  "text-to-3d",
  "image-to-3d",
  "text-to-image",
  "image-to-image",
  "texture-generation",
]);
const INTENDED_USES = new Set<AssetIntendedUse>(["internal-experiment", "editorial-publication", "commercial-marketing"]);
const GEOMETRY_MODES = new Set<ProductGeometryMode>(["generic-representative", "licensed-exact"]);

const REFERENCE_CONSUMING_MODES: ReadonlySet<MeshyGenerationMode> = new Set([
  "image-to-3d",
  "image-to-image",
  "texture-generation",
]);
const REFERENCE_FREE_MODES: ReadonlySet<MeshyGenerationMode> = new Set(["text-to-3d", "text-to-image"]);

const VALID_URI = /^(?:file:|https?:|s3:|gs:|artifact:|library:|sandbox:)/;
const SHA256 = /^[a-fA-F0-9]{64}$/;

const DEFAULT_MIME_BY_KIND: Record<MeshyAssetKind, string[]> = {
  image: ["image/png", "image/jpeg", "image/webp"],
  "preview-image": ["image/png", "image/jpeg", "image/webp"],
  model: ["model/gltf-binary", "model/gltf+json", "application/octet-stream"],
  texture: ["image/png", "image/jpeg", "image/webp"],
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
  return request.declaredProductTarget ? "product-illustration" : "generic-hook";
}

function normalizedSha256(value: string, field: string): string {
  const trimmed = value?.trim?.() ?? "";
  if (!SHA256.test(trimmed)) {
    throw new MeshyIngestError("invalid-sha256", `${field} must be a 64-character SHA-256 hex digest.`);
  }
  return trimmed.toLowerCase();
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new MeshyIngestError("missing-field", `${field} is required.`);
  return value.trim();
}

function requireValidUri(value: unknown, field: string): string {
  const uri = requireNonEmpty(value, field);
  if (!VALID_URI.test(uri)) throw new MeshyIngestError("invalid-uri", `${field} uses an unsupported URI scheme.`);
  return uri;
}

function requireTimestamp(value: unknown, field: string): string {
  const timestamp = requireNonEmpty(value, field);
  if (!Number.isFinite(Date.parse(timestamp))) throw new MeshyIngestError("invalid-timestamp", `${field} must be a valid timestamp.`);
  return timestamp;
}

/**
 * Content-addressed identity: if Meshy changes the bytes behind the same provider
 * id, it becomes a new asset and cannot inherit the old review.
 */
export function meshyAssetId(providerAssetId: string, sha256: string): string {
  const provider = requireNonEmpty(providerAssetId, "providerAssetId").replace(/[^A-Za-z0-9._-]/g, "-");
  const digest = normalizedSha256(sha256, "outputFile.sha256");
  return `meshy-${provider}-${digest.slice(0, 16)}`;
}

function toGrant(reference: MeshySourceReference): AssetRightsGrant {
  return {
    sourceKind: reference.sourceKind,
    sourceUri: reference.uri,
    // Keep both the legal evidence and the immutable input hash in the durable
    // evidence string because AssetRightsGrant predates content hashes.
    evidenceRef: [reference.evidenceRef?.trim(), `sha256:${reference.sha256.toLowerCase()}`].filter(Boolean).join(" | "),
    commercialUseAllowed: reference.commercialUseAllowed,
    derivativeUseAllowed: reference.derivativeUseAllowed,
    designUseAuthorized: reference.designUseAuthorized === true,
    trademarkUseAuthorized: reference.trademarkUseAuthorized === true,
    attributionRequired: reference.attributionRequired === true,
    attributionText: reference.attributionText,
  };
}

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
    if (value === "absent" || value === "present" || value === "unknown") merged[key] = value;
    else if (value !== undefined) throw new MeshyIngestError("invalid-feature-state", `observedFeatures.${key} is invalid.`);
  }
  return merged;
}

const SEVERITY_RANK: Record<AssetPolicyDecision, number> = { allow: 0, hold: 1, block: 2 };
function tightest(a: AssetPolicyDecision, b: AssetPolicyDecision): AssetPolicyDecision {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function validateReference(reference: MeshySourceReference, index: number): MeshySourceReference {
  const prefix = `sourceReferences[${index}]`;
  const uri = requireValidUri(reference?.uri, `${prefix}.uri`);
  const sha256 = normalizedSha256(reference?.sha256, `${prefix}.sha256`);
  if (typeof reference.sourceKind !== "string") throw new MeshyIngestError("invalid-source-kind", `${prefix}.sourceKind is required.`);
  return { ...reference, uri, sha256 };
}

function validateHumanClearance(clearance: MeshyHumanClearance | undefined, outputSha256: string): MeshyHumanClearance | undefined {
  if (!clearance) return undefined;
  const reviewer = requireNonEmpty(clearance.reviewer, "humanClearance.reviewer");
  const evidenceRef = requireNonEmpty(clearance.evidenceRef, "humanClearance.evidenceRef");
  const reviewedAt = requireTimestamp(clearance.reviewedAt, "humanClearance.reviewedAt");
  const assetSha256 = normalizedSha256(clearance.assetSha256, "humanClearance.assetSha256");
  if (assetSha256 !== outputSha256) {
    throw new MeshyIngestError(
      "clearance-hash-mismatch",
      `Human clearance is for sha256:${assetSha256}, but the ingested output is sha256:${outputSha256}. Review does not transfer across different bytes.`,
    );
  }
  return { reviewer, evidenceRef, reviewedAt, assetSha256 };
}

function validateDesignAuthorization(
  authorization: MeshyDesignAuthorization | undefined,
  target: string | undefined,
): MeshyDesignAuthorization | undefined {
  if (!authorization) return undefined;
  const productId = requireNonEmpty(authorization.productId, "designAuthorization.productId");
  const evidenceRef = requireNonEmpty(authorization.evidenceRef, "designAuthorization.evidenceRef");
  const authorizedAt = authorization.authorizedAt === undefined
    ? undefined
    : requireTimestamp(authorization.authorizedAt, "designAuthorization.authorizedAt");
  if (!target) {
    throw new MeshyIngestError("authorization-missing-product-target", "Design authorization was supplied but declaredProductTarget is missing.");
  }
  if (productId !== target) {
    throw new MeshyIngestError(
      "authorization-product-mismatch",
      `Design authorization names product ${productId}, but the asset targets ${target}.`,
    );
  }
  return { productId, evidenceRef, ...(authorizedAt ? { authorizedAt } : {}) };
}

function validateRequest(request: MeshyIngestRequest): {
  createdAt: string;
  outputFile: MeshyOutputFile;
  references: MeshySourceReference[];
  humanClearance?: MeshyHumanClearance;
  designAuthorization?: MeshyDesignAuthorization;
} {
  if (!request || typeof request !== "object") throw new MeshyIngestError("malformed-request", "Meshy ingest request must be an object.");
  requireNonEmpty(request.providerAssetId, "providerAssetId");
  const createdAt = requireTimestamp(request.createdAt, "createdAt");

  if (!ASSET_KINDS.has(request.assetKind)) throw new MeshyIngestError("invalid-asset-kind", `Unsupported assetKind: ${String(request.assetKind)}.`);
  if (!GENERATION_MODES.has(request.generationMode)) {
    throw new MeshyIngestError(
      "invalid-generation-mode",
      `Unsupported or ambiguous generationMode: ${String(request.generationMode)}. Use text-to-image or image-to-image explicitly.`,
    );
  }
  if (!INTENDED_USES.has(request.intendedUse)) throw new MeshyIngestError("invalid-intended-use", `Unsupported intendedUse: ${String(request.intendedUse)}.`);
  if (!GEOMETRY_MODES.has(request.declaredGeometryMode)) throw new MeshyIngestError("invalid-geometry-mode", `Unsupported declaredGeometryMode: ${String(request.declaredGeometryMode)}.`);

  if (!request.outputFile || typeof request.outputFile !== "object") throw new MeshyIngestError("missing-output-file", "outputFile is required.");
  const outputFile: MeshyOutputFile = {
    uri: requireValidUri(request.outputFile.uri, "outputFile.uri"),
    mimeType: requireNonEmpty(request.outputFile.mimeType, "outputFile.mimeType").toLowerCase(),
    sha256: normalizedSha256(request.outputFile.sha256, "outputFile.sha256"),
  };
  if (!DEFAULT_MIME_BY_KIND[request.assetKind].includes(outputFile.mimeType)) {
    throw new MeshyIngestError(
      "mime-kind-mismatch",
      `assetKind=${request.assetKind} does not accept mimeType=${outputFile.mimeType}.`,
    );
  }

  const references = (request.sourceReferences ?? []).map(validateReference);
  if (REFERENCE_FREE_MODES.has(request.generationMode) && references.length > 0) {
    throw new MeshyIngestError(
      "reference-mode-mismatch",
      `${request.generationMode} declares no reference input, but sourceReferences were supplied. Use the corresponding image-conditioned generation mode.`,
    );
  }

  const target = request.declaredProductTarget?.trim() || undefined;
  const humanClearance = validateHumanClearance(request.humanClearance, outputFile.sha256);
  const designAuthorization = validateDesignAuthorization(request.designAuthorization, target);

  return { createdAt, outputFile, references, humanClearance, designAuthorization };
}

function missingLineageGrant(mode: MeshyGenerationMode): AssetRightsGrant {
  return {
    sourceKind: "unknown",
    sourceUri: `meshy:missing-lineage:${mode}`,
    evidenceRef: undefined,
    commercialUseAllowed: false,
    derivativeUseAllowed: false,
    designUseAuthorized: false,
    trademarkUseAuthorized: false,
    attributionRequired: false,
  };
}

function evidenceNotes(
  outputFile: MeshyOutputFile,
  humanClearance: MeshyHumanClearance | undefined,
  designAuthorization: MeshyDesignAuthorization | undefined,
): string[] {
  const notes = [`outputSha256=${outputFile.sha256}`];
  if (humanClearance) notes.push(`humanClearance=${JSON.stringify(humanClearance)}`);
  if (designAuthorization) notes.push(`designAuthorization=${JSON.stringify(designAuthorization)}`);
  return notes;
}

/**
 * Normalize one concrete Meshy output into the shared quarantine/rights model.
 * Policy problems are recorded as hold/block results. Structurally unsafe input
 * is rejected because inventing missing identity/evidence would be worse.
 */
export function ingestMeshyAsset(request: MeshyIngestRequest): MeshyIngestResult {
  const validated = validateRequest(request);
  const target = request.declaredProductTarget?.trim() || undefined;
  const assetId = meshyAssetId(request.providerAssetId, validated.outputFile.sha256);
  const reasons: string[] = [];
  let providerFloor: AssetPolicyDecision = "allow";
  const tighten = (decision: AssetPolicyDecision, reason: string) => {
    providerFloor = tightest(providerFloor, decision);
    reasons.push(reason);
  };

  const requiresReferences = REFERENCE_CONSUMING_MODES.has(request.generationMode);
  const missingRequiredLineage = requiresReferences && validated.references.length === 0;
  if (missingRequiredLineage) {
    tighten(
      "block",
      `${request.generationMode} consumed reference input, but no source reference lineage was recorded.`,
    );
  }

  const reviewFindings = reviewFrom(request.observedFeatures);
  if (request.declaredGeometryMode === "licensed-exact") reviewFindings.distinctiveIndustrialDesign = "present";

  const genericContradiction = request.declaredGeometryMode === "generic-representative" &&
    reviewFindings.distinctiveIndustrialDesign === "present";
  if (genericContradiction) {
    tighten("hold", "Asset is declared generic but distinctive industrial design was observed. The observation wins and clearance must be repeated under an exact-design classification.");
  }

  const exactAuthorizationValid = request.declaredGeometryMode === "licensed-exact" &&
    Boolean(target && validated.designAuthorization && validated.designAuthorization.productId === target);
  if (request.declaredGeometryMode === "licensed-exact" && !exactAuthorizationValid) {
    tighten("hold", "Asset claims exact third-party industrial design but no matching design-use authorization is recorded.");
  }

  const effectiveHumanClearance = validated.humanClearance && !genericContradiction ? validated.humanClearance : undefined;
  if (!effectiveHumanClearance) {
    tighten("hold", "No valid human clearance is bound to these exact output bytes. Meshy assets do not auto-approve.");
  }

  const derived = requiresReferences || validated.references.length > 0;
  let grants: AssetRightsGrant[];
  if (missingRequiredLineage) {
    // Put the failure into the manifest itself so rebuilding the shared registry
    // cannot accidentally promote a blocked provider result.
    grants = [missingLineageGrant(request.generationMode)];
  } else if (validated.references.length > 0) {
    grants = validated.references.map(toGrant);
  } else {
    const generated = generatedNoReferenceGrant();
    generated.sourceUri = "meshy:generated-no-reference";
    // Fix the text-to-3D exact-model hole: a separate product design
    // authorization can authorize generated geometry even when there is no
    // reference grant. It does not grant trademark use.
    generated.designUseAuthorized = exactAuthorizationValid;
    if (validated.designAuthorization) generated.evidenceRef = validated.designAuthorization.evidenceRef;
    grants = [generated];
  }

  const manifest: AssetRightsManifest = {
    assetId,
    assetType: ASSET_TYPE_BY_KIND[request.assetKind],
    intendedUse: request.intendedUse,
    productId: target,
    generationMode: derived ? "derived-from-references" : "generated-no-reference",
    sourceGrants: grants,
    parentAssetIds: [],
    productIdentityMode: target ? "deterministic-plain-text-overlay" : "none",
    restrictedFeatures: reviewFindings,
    reviewedBy: effectiveHumanClearance ? "automated-and-human" : "not-reviewed",
    notes: [
      `provider=${MESHY_PROVIDER}`,
      `providerAssetId=${request.providerAssetId}`,
      ...(request.providerTaskId ? [`providerTaskId=${request.providerTaskId}`] : []),
      `generationMode=${request.generationMode}`,
      `geometryMode=${request.declaredGeometryMode}`,
      ...evidenceNotes(validated.outputFile, validated.humanClearance, validated.designAuthorization),
    ],
  };

  const record: ProductVisualAssetRecord = {
    assetId,
    productId: target,
    role: roleFor(request),
    uri: validated.outputFile.uri,
    mimeType: validated.outputFile.mimeType,
    sha256: validated.outputFile.sha256,
    version: 1,
    createdAt: validated.createdAt,
    createdBy: "provider",
    rights: manifest,
  };

  const basePolicy = evaluateAssetRights(manifest);
  for (const entry of basePolicy.issues) reasons.push(`${entry.severity}: ${entry.code} — ${entry.message}`);
  const publicationDecision = tightest(basePolicy.decision, providerFloor);
  const registryStatus: ProductVisualAssetStatus = publicationDecision === "allow"
    ? "approved"
    : publicationDecision === "hold"
      ? "needs-review"
      : "blocked";

  const evaluatedBase = evaluateProductVisualAsset(record);
  const evaluated: EvaluatedProductVisualAsset = {
    ...evaluatedBase,
    status: registryStatus,
    policyDecision: publicationDecision,
    policyIssueCodes: [...new Set([
      ...evaluatedBase.policyIssueCodes,
      ...(publicationDecision !== basePolicy.decision ? [`meshy-provider-floor-${publicationDecision}`] : []),
    ])],
  };

  const severityRank = (text: string) => text.startsWith("block") || text.includes("no source reference lineage") ? 0 : text.startsWith("hold") ? 1 : 2;
  reasons.sort((a, b) => severityRank(a) - severityRank(b));

  return {
    assetId,
    registryStatus,
    publicationDecision,
    geometryMode: request.declaredGeometryMode,
    rightsManifest: manifest,
    registryRecord: record,
    evaluated,
    reviewFindings,
    provenance: {
      provider: MESHY_PROVIDER,
      providerAssetId: request.providerAssetId,
      providerTaskId: request.providerTaskId,
      generationMode: request.generationMode,
      prompt: request.prompt,
      modelSettings: request.modelSettings,
      createdAt: validated.createdAt,
      outputFile: { ...validated.outputFile },
      sourceReferences: validated.references.map((entry) => ({ ...entry })),
      humanClearance: validated.humanClearance ? { ...validated.humanClearance } : undefined,
      designAuthorization: validated.designAuthorization ? { ...validated.designAuthorization } : undefined,
    },
    reasons,
  };
}

export function meshyRegistryEntries(results: readonly MeshyIngestResult[]): EvaluatedProductVisualAsset[] {
  return results.map((result) => result.evaluated);
}

export function isPublishableMeshyAsset(result: MeshyIngestResult): boolean {
  return result.publicationDecision === "allow" && result.registryStatus === "approved";
}
