export type AssetSourceKind =
  | "specsmith-owned"
  | "user-owned"
  | "manufacturer-authorized"
  | "licensed-third-party"
  | "public-domain"
  | "generated-no-reference"
  | "generated-from-cleared-inputs"
  | "unknown";

export type AssetIntendedUse = "internal-experiment" | "editorial-publication" | "commercial-marketing";
export type AssetPolicyDecision = "allow" | "hold" | "block";
export type FeaturePresence = "absent" | "present" | "unknown";

/**
 * This is a product-safety policy record, not a legal conclusion. The automator
 * deliberately fails closed when provenance or permissions are unclear.
 */
export interface AssetRightsGrant {
  sourceKind: AssetSourceKind;
  sourceUri?: string;
  /** Durable internal evidence reference: license file, contract id, release, etc. */
  evidenceRef?: string;
  commercialUseAllowed: boolean;
  derivativeUseAllowed: boolean;
  /** Required before an exact third-party industrial design can auto-publish. */
  designUseAuthorized: boolean;
  /** Required before copied logos/wordmarks could be used; SpecSmith policy still strips them by default. */
  trademarkUseAuthorized: boolean;
  attributionRequired: boolean;
  attributionText?: string;
}

export interface RestrictedVisualFeatureReview {
  logos: FeaturePresence;
  stylizedWordmarks: FeaturePresence;
  watermarks: FeaturePresence;
  copyrightedArtworkOrGraphics: FeaturePresence;
  serialNumbersOrStickerText: FeaturePresence;
  retailerMarks: FeaturePresence;
  copiedProductPhotography: FeaturePresence;
  /** Distinctive product-body geometry/trade-dress-like design, separate from logos. */
  distinctiveIndustrialDesign: FeaturePresence;
}

export interface AssetRightsManifest {
  assetId: string;
  assetType: "image" | "video" | "3d-model" | "texture";
  intendedUse: AssetIntendedUse;
  productId?: string;
  generationMode: "original" | "generated-no-reference" | "derived-from-references";
  sourceGrants: AssetRightsGrant[];
  parentAssetIds: string[];
  /** Exact product identity should normally be added later as plain deterministic text. */
  productIdentityMode: "none" | "deterministic-plain-text-overlay" | "baked-branding";
  restrictedFeatures: RestrictedVisualFeatureReview;
  /**
   * "automated" means an automated scorer/checker actually reviewed the
   * asset. A script constructing this record by itself is NOT automated
   * review — that is a human or Claude, once, off-line; record that
   * distinctly as "claude-code-manual-review" rather than implying tooling
   * that does not exist.
   */
  reviewedBy: "automated" | "human" | "automated-and-human" | "claude-code-manual-review" | "not-reviewed";
  notes?: string[];
}

export interface AssetPolicyIssue {
  code: string;
  severity: "hold" | "block";
  message: string;
}

export interface AssetPolicyResult {
  assetId: string;
  decision: AssetPolicyDecision;
  autoPublishAllowed: boolean;
  issues: AssetPolicyIssue[];
}

const FEATURE_KEYS: Array<keyof RestrictedVisualFeatureReview> = [
  "logos",
  "stylizedWordmarks",
  "watermarks",
  "copyrightedArtworkOrGraphics",
  "serialNumbersOrStickerText",
  "retailerMarks",
  "copiedProductPhotography",
];

function issue(issues: AssetPolicyIssue[], code: string, severity: AssetPolicyIssue["severity"], message: string): void {
  issues.push({ code, severity, message });
}

function sourceNeedsEvidence(kind: AssetSourceKind): boolean {
  return kind === "manufacturer-authorized" || kind === "licensed-third-party" || kind === "public-domain";
}

function sourceIsUnknown(kind: AssetSourceKind): boolean {
  return kind === "unknown";
}

function publishingUse(use: AssetIntendedUse): boolean {
  return use !== "internal-experiment";
}

/**
 * Conservative publication gate for visual assets.
 *
 * Key rule: a generated child cannot acquire broader rights than its inputs.
 * Unknown provenance, unknown visual features, or copied branding never auto-publish.
 */
export function evaluateAssetRights(manifest: AssetRightsManifest): AssetPolicyResult {
  const issues: AssetPolicyIssue[] = [];
  const isPublishing = publishingUse(manifest.intendedUse);

  if (!manifest.assetId.trim()) issue(issues, "missing-asset-id", "block", "Asset id is required.");

  if (manifest.generationMode === "derived-from-references" && manifest.sourceGrants.length === 0) {
    issue(issues, "missing-reference-provenance", "block", "Derived assets require explicit provenance for every reference input.");
  }

  for (const grant of manifest.sourceGrants) {
    if (sourceIsUnknown(grant.sourceKind)) {
      issue(issues, "unknown-source", "block", "Unknown-source visual references may not enter the publishable asset pipeline.");
      continue;
    }
    if (sourceNeedsEvidence(grant.sourceKind) && !grant.evidenceRef?.trim()) {
      issue(issues, "missing-license-evidence", "block", `${grant.sourceKind} assets require a durable license/evidence reference.`);
    }
    if (manifest.generationMode === "derived-from-references" && !grant.derivativeUseAllowed) {
      issue(issues, "derivative-use-not-allowed", "block", "A reference source does not permit derivative generation.");
    }
    if (isPublishing && !grant.commercialUseAllowed) {
      issue(issues, "commercial-use-not-allowed", "block", "A source grant does not permit publication in the commercial SpecSmith content pipeline.");
    }
    if (grant.attributionRequired && !grant.attributionText?.trim()) {
      issue(issues, "missing-attribution", "hold", "Attribution is required but no attribution text is recorded.");
    }
  }

  for (const key of FEATURE_KEYS) {
    const state = manifest.restrictedFeatures[key];
    if (state === "present") {
      issue(
        issues,
        `restricted-feature-${key}`,
        "block",
        `Asset contains restricted third-party visual feature: ${key}. Remove it and represent product identity with deterministic plain text instead.`,
      );
    } else if (state === "unknown" && isPublishing) {
      issue(issues, `unreviewed-feature-${key}`, "hold", `Cannot publish until ${key} is confirmed absent.`);
    }
  }

  if (manifest.productIdentityMode === "baked-branding") {
    issue(
      issues,
      "baked-branding-disallowed",
      "block",
      "SpecSmith's automated visual policy forbids baked third-party logos/wordmarks. Use a deterministic plain-text product label downstream.",
    );
  }

  const designState = manifest.restrictedFeatures.distinctiveIndustrialDesign;
  if (designState === "unknown" && isPublishing) {
    issue(issues, "industrial-design-unreviewed", "hold", "Distinctive product geometry must be reviewed before publication.");
  } else if (designState === "present" && isPublishing) {
    const allAuthorized = manifest.sourceGrants.length > 0 && manifest.sourceGrants.every((grant) => grant.designUseAuthorized);
    if (!allAuthorized) {
      issue(
        issues,
        "industrial-design-not-authorized",
        "hold",
        "Exact/distinctive third-party product geometry is not eligible for automatic publication without recorded design-use authorization. Keep it internal or obtain explicit clearance.",
      );
    }
  }

  if (isPublishing && manifest.reviewedBy === "not-reviewed") {
    issue(issues, "visual-review-required", "hold", "Publishable visual assets require an explicit restricted-feature review.");
  }

  const blocked = issues.some((entry) => entry.severity === "block");
  const held = issues.some((entry) => entry.severity === "hold");
  const decision: AssetPolicyDecision = blocked ? "block" : held ? "hold" : "allow";

  return {
    assetId: manifest.assetId,
    decision,
    autoPublishAllowed: decision === "allow" && isPublishing,
    issues,
  };
}

export function assertAssetMayPublish(manifest: AssetRightsManifest): void {
  const result = evaluateAssetRights(manifest);
  if (!result.autoPublishAllowed) {
    const details = result.issues.map((entry) => `${entry.code}: ${entry.message}`).join(" | ") || "asset is not approved for automatic publication";
    throw new Error(`Asset ${manifest.assetId} failed rights gate: ${details}`);
  }
}

export function assertReferenceMayBeUsedForDerivativeGeneration(grant: AssetRightsGrant): void {
  if (sourceIsUnknown(grant.sourceKind)) throw new Error("Unknown-source references are not permitted for derivative generation.");
  if (!grant.derivativeUseAllowed) throw new Error("Reference does not permit derivative generation.");
  if (sourceNeedsEvidence(grant.sourceKind) && !grant.evidenceRef?.trim()) {
    throw new Error(`${grant.sourceKind} reference is missing license/evidence metadata.`);
  }
}

export function cleanRestrictedFeatureReview(overrides: Partial<RestrictedVisualFeatureReview> = {}): RestrictedVisualFeatureReview {
  return {
    logos: "absent",
    stylizedWordmarks: "absent",
    watermarks: "absent",
    copyrightedArtworkOrGraphics: "absent",
    serialNumbersOrStickerText: "absent",
    retailerMarks: "absent",
    copiedProductPhotography: "absent",
    distinctiveIndustrialDesign: "absent",
    ...overrides,
  };
}

export function unknownRestrictedFeatureReview(): RestrictedVisualFeatureReview {
  return {
    logos: "unknown",
    stylizedWordmarks: "unknown",
    watermarks: "unknown",
    copyrightedArtworkOrGraphics: "unknown",
    serialNumbersOrStickerText: "unknown",
    retailerMarks: "unknown",
    copiedProductPhotography: "unknown",
    distinctiveIndustrialDesign: "unknown",
  };
}

export function generatedNoReferenceGrant(): AssetRightsGrant {
  return {
    sourceKind: "generated-no-reference",
    commercialUseAllowed: true,
    derivativeUseAllowed: true,
    designUseAuthorized: false,
    trademarkUseAuthorized: false,
    attributionRequired: false,
  };
}
