import {
  evaluateAssetRights,
  type AssetPolicyDecision,
  type AssetRightsManifest,
} from "./assetRights.ts";

export type ProductVisualAssetRole =
  | "generic-hook"
  | "product-illustration"
  | "exact-product-reference"
  | "3d-production-asset"
  | "texture"
  | "specsmith-evidence";

export type ProductVisualAssetStatus = "quarantined" | "needs-review" | "approved" | "blocked";

export interface ProductVisualAssetRecord {
  assetId: string;
  productId?: string;
  role: ProductVisualAssetRole;
  uri: string;
  mimeType: string;
  sha256?: string;
  version: number;
  createdAt: string;
  createdBy: "specsmith" | "provider" | "user" | "import";
  rights: AssetRightsManifest;
}

export interface EvaluatedProductVisualAsset extends ProductVisualAssetRecord {
  status: ProductVisualAssetStatus;
  policyDecision: AssetPolicyDecision;
  policyIssueCodes: string[];
}

function validUri(uri: string): boolean {
  return /^(?:file:|https?:|s3:|gs:|artifact:|library:|sandbox:)/.test(uri);
}

function statusFromDecision(decision: AssetPolicyDecision): ProductVisualAssetStatus {
  if (decision === "allow") return "approved";
  if (decision === "hold") return "needs-review";
  return "blocked";
}

export function evaluateProductVisualAsset(record: ProductVisualAssetRecord): EvaluatedProductVisualAsset {
  if (!record.assetId.trim()) throw new Error("Product visual asset requires an assetId.");
  if (record.rights.assetId !== record.assetId) {
    throw new Error(`Rights manifest assetId ${record.rights.assetId} does not match registry assetId ${record.assetId}.`);
  }
  if (!Number.isInteger(record.version) || record.version < 1) throw new Error(`Asset ${record.assetId} has invalid version.`);
  if (!validUri(record.uri)) throw new Error(`Asset ${record.assetId} has unsupported URI scheme.`);
  if (!record.mimeType.trim()) throw new Error(`Asset ${record.assetId} requires a mime type.`);
  if (record.productId && record.rights.productId && record.productId !== record.rights.productId) {
    throw new Error(`Asset ${record.assetId} product id does not match its rights manifest.`);
  }

  const policy = evaluateAssetRights(record.rights);
  return {
    ...record,
    status: statusFromDecision(policy.decision),
    policyDecision: policy.decision,
    policyIssueCodes: policy.issues.map((entry) => entry.code),
  };
}

export function buildProductVisualAssetRegistry(
  records: ProductVisualAssetRecord[],
): Map<string, EvaluatedProductVisualAsset> {
  const registry = new Map<string, EvaluatedProductVisualAsset>();
  for (const record of records) {
    if (registry.has(record.assetId)) throw new Error(`Duplicate product visual asset id: ${record.assetId}`);
    registry.set(record.assetId, evaluateProductVisualAsset(record));
  }
  return registry;
}

export interface AssetSelectionRequest {
  productId?: string;
  roles: ProductVisualAssetRole[];
  mimeTypes?: string[];
}

/**
 * Selects only assets already approved by the rights gate. It never falls back
 * to quarantined or unknown assets just to keep a render moving.
 */
export function selectApprovedProductVisualAsset(
  registry: Map<string, EvaluatedProductVisualAsset>,
  request: AssetSelectionRequest,
): EvaluatedProductVisualAsset {
  const roleRank = new Map(request.roles.map((role, index) => [role, index]));
  const matches = [...registry.values()]
    .filter((asset) => asset.status === "approved")
    .filter((asset) => request.productId === undefined || asset.productId === request.productId)
    .filter((asset) => roleRank.has(asset.role))
    .filter((asset) => !request.mimeTypes || request.mimeTypes.includes(asset.mimeType))
    .sort((a, b) => {
      const roleDelta = (roleRank.get(a.role) ?? Number.MAX_SAFE_INTEGER) - (roleRank.get(b.role) ?? Number.MAX_SAFE_INTEGER);
      if (roleDelta !== 0) return roleDelta;
      if (a.version !== b.version) return b.version - a.version;
      return b.createdAt.localeCompare(a.createdAt);
    });

  const selected = matches[0];
  if (!selected) {
    throw new Error(
      `No rights-approved visual asset available for product=${request.productId ?? "<any>"}, roles=${request.roles.join(",")}.`,
    );
  }
  return selected;
}

export interface PublicationAssetBundleRequest {
  usedAssetIds: string[];
  /** Every externally sourced/generated visual that appears in the final master must be listed. */
  expectedVisualAssetIds: string[];
  /**
   * Registry id of the rendered master itself.
   *
   * The master is an asset like any other and must be registered and approved.
   * Its recorded sha256 is the only authority on which bytes this bundle
   * approves — a hash supplied separately by a caller proves nothing.
   */
  masterAssetId: string;
}

export interface PublicationAssetBundleResult {
  publishable: boolean;
  missingAssetIds: string[];
  untrackedAssetIds: string[];
  nonApprovedAssetIds: string[];
  /**
   * SHA-256 of the approved master, read from the registry.
   *
   * Null when the master is absent, not approved, or registered without a
   * hash — all of which also make the bundle unpublishable.
   */
  approvedMasterSha256: string | null;
  /** URI of that same approved master, read from the registry. */
  approvedMasterUri: string | null;
}

/**
 * Final fail-closed bundle check. This prevents an editor/provider from slipping
 * an unregistered image/model/video into a master after the individual assets
 * were reviewed.
 */
export function evaluatePublicationAssetBundle(
  registry: Map<string, EvaluatedProductVisualAsset>,
  request: PublicationAssetBundleRequest,
): PublicationAssetBundleResult {
  const expected = new Set(request.expectedVisualAssetIds);
  // The master is always part of what this bundle covers, so it is checked
  // alongside the component assets rather than trusted separately.
  const used = new Set([...request.usedAssetIds, request.masterAssetId]);
  const missingAssetIds = [...used].filter((assetId) => !registry.has(assetId));
  const untrackedAssetIds = [...used].filter((assetId) => !expected.has(assetId) && assetId !== request.masterAssetId);
  const nonApprovedAssetIds = [...used].filter((assetId) => registry.get(assetId)?.status !== "approved");

  const master = registry.get(request.masterAssetId);
  const masterDigest = master?.status === "approved" ? master.sha256?.trim().toLowerCase() : undefined;
  const approvedMasterSha256 = masterDigest && /^[a-f0-9]{64}$/.test(masterDigest) ? masterDigest : null;
  const approvedMasterUri = master?.status === "approved" && approvedMasterSha256 !== null
    ? master.uri.trim()
    : null;

  return {
    publishable:
      missingAssetIds.length === 0 &&
      untrackedAssetIds.length === 0 &&
      nonApprovedAssetIds.length === 0 &&
      approvedMasterSha256 !== null,
    missingAssetIds,
    untrackedAssetIds,
    nonApprovedAssetIds,
    approvedMasterSha256,
    approvedMasterUri,
  };
}
