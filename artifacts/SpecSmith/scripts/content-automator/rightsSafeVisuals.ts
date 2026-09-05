export type ProductGeometryMode = "generic-representative" | "licensed-exact";

export interface VisualRightsPolicyState {
  referencePolicy: "cleared-only";
  productGeometryMode: ProductGeometryMode;
  brandingMode: "no-baked-third-party-branding";
  productIdentityMode: "deterministic-plain-text-overlay";
  requireRightsManifestBeforePublish: true;
  requireRestrictedFeatureReviewBeforePublish: true;
  forbiddenVisualFeatures: string[];
}

export const FORBIDDEN_GENERATED_VISUAL_FEATURES = [
  "third-party logos",
  "stylized brand wordmarks",
  "watermarks",
  "retailer marks",
  "serial numbers",
  "stickers or label text",
  "copied product photography",
  "copyrighted artwork or proprietary decorative graphics",
  "invented readable product text",
] as const;

export function buildVisualRightsPolicyState(
  productGeometryMode: ProductGeometryMode = "generic-representative",
): VisualRightsPolicyState {
  return {
    referencePolicy: "cleared-only",
    productGeometryMode,
    brandingMode: "no-baked-third-party-branding",
    productIdentityMode: "deterministic-plain-text-overlay",
    requireRightsManifestBeforePublish: true,
    requireRestrictedFeatureReviewBeforePublish: true,
    forbiddenVisualFeatures: [...FORBIDDEN_GENERATED_VISUAL_FEATURES],
  };
}

/**
 * Provider-neutral policy appended to generative visual prompts.
 *
 * Exact product naming is deliberately kept out of the pixels and applied later
 * as normal SpecSmith typography. `licensed-exact` is only appropriate when the
 * upstream rights manifest records explicit design-use authorization.
 */
export function rightsSafePromptRules(
  productGeometryMode: ProductGeometryMode = "generic-representative",
): string[] {
  const geometryRule = productGeometryMode === "licensed-exact"
    ? "The production system has separately cleared exact geometry use. Match only the cleared geometry supplied by approved references; do not copy any unapproved markings, artwork, labels, or branding."
    : "Use a generic, representative PC-hardware silhouette and neutral industrial styling. Do not reproduce distinctive third-party product-body geometry when no explicit design-use authorization is recorded.";

  return [
    geometryRule,
    "Do not render third-party logos, logo shapes, stylized wordmarks, watermarks, retailer marks, stickers, serial numbers, labels, packaging art, or proprietary decorative graphics.",
    "Do not reproduce a source photograph as a near-copy. Build an original scene/composition instead.",
    "Do not invent readable model names or brand text. Product identity is added later by SpecSmith as deterministic plain text outside the generated asset.",
    "Use neutral materials and lighting where branding would otherwise appear.",
    "If a requested visual would require copying an uncleared protected feature, omit that feature rather than approximating it.",
  ];
}

export function buildRightsSafeVisualPrompt(
  basePrompt: string,
  productGeometryMode: ProductGeometryMode = "generic-representative",
): string {
  const base = basePrompt.replace(/\s+/g, " ").trim();
  return [base, ...rightsSafePromptRules(productGeometryMode)].filter(Boolean).join(" ");
}
