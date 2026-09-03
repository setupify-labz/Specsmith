# SpecSmith visual asset rights architecture

This system is intentionally conservative. It is a product policy and engineering gate, not a legal opinion. When provenance, permission, or visual review is unclear, automation stops instead of guessing.

## Goal

Make high-retention PC-hardware videos without allowing the content machine to silently ingest random web images, copied product photography, third-party logos, watermarks, proprietary graphics, or uncleared exact industrial designs.

The core rule is simple:

> Generated assets never acquire broader rights than their inputs.

## Pipeline

1. **Reference intake**
   - Every external reference receives an `AssetRightsGrant`.
   - Arbitrary/search-result URLs are not considered production-safe evidence by themselves.
   - Unknown provenance is blocked.
   - Licensed/manufacturer/public-domain inputs need a durable `evidenceRef`.
   - Derivative generation requires `derivativeUseAllowed=true` for every reference.

2. **Quarantine**
   - New images, videos, textures, and 3D models enter the asset registry as candidates.
   - They are evaluated before selection for a render.
   - A model being visually impressive does not change its rights state.

3. **Generation policy**
   - Default generated hardware is `generic-representative`, not an exact third-party industrial design.
   - Generated pixels may not contain third-party logos, stylized wordmarks, watermarks, retailer marks, serials, stickers, packaging art, copied product photography, or proprietary decorative graphics.
   - Product names are added later with deterministic, plain SpecSmith typography rather than baked branding.
   - `licensed-exact` geometry is reserved for assets whose source grants explicitly record design-use authorization.

4. **Restricted-feature review**
   - Each generated/imported visual records whether restricted features are `absent`, `present`, or `unknown`.
   - `present` logos/wordmarks/watermarks/copied photography block publication.
   - `unknown` values hold publication.
   - Distinctive exact industrial geometry is held from automatic publication unless every source grant records `designUseAuthorized=true`.

5. **Locked registry**
   - Only `approved` records can be selected by `selectApprovedProductVisualAsset()`.
   - A newer or prettier asset never overrides a held/blocked policy state.
   - Selection fails closed when there is no approved asset; it does not fall back to an unreviewed model.

6. **Composition**
   - The compositor should consume registry `assetId`s, not arbitrary URLs.
   - Exact product identity, prices, specs, captions, and results are deterministic overlays/evidence layers.
   - Real SpecSmith UI remains the factual proof layer.

7. **Final publication bundle gate**
   - Every non-first-party visual used in the final master must be listed in the expected asset bundle.
   - Missing, untracked, or non-approved assets make the bundle non-publishable.
   - This prevents a late editing/provider step from slipping an unreviewed visual into an otherwise-approved video.

## Rights states

- **allow / approved**: policy checks are satisfied for the declared use.
- **hold / needs-review**: not automatically publishable; more evidence or review is required.
- **block / blocked**: the asset contains a prohibited feature or lacks required permission/provenance.

Internal experiments may still be useful for testing provider quality, but internal status must never be confused with publication approval.

## Exact-model strategy

There are two safe engineering paths:

### A. Rights-cleared exact asset

Use only when SpecSmith has recorded permission covering the exact reference/derivative/design use. The resulting 3D model can preserve exact geometry, but generated/captured third-party logos and wordmarks are still stripped by default. Plain product naming is overlaid downstream.

### B. Generic representative asset

Default when exact design rights are not recorded. Use a neutral GPU/CPU/component shape for motion and spectacle, then identify the actual product with plain deterministic text and show real SpecSmith data/UI for the decision.

This keeps cinematic storytelling separate from product identity and evidence.

## Source policy

Preferred production sources:

- SpecSmith-created photos/renders/assets.
- User-owned inputs with recorded permission for the requested use.
- Explicitly licensed third-party assets with derivative/commercial terms recorded.
- Manufacturer assets only when the relevant terms/permission are recorded for the intended use.
- Public-domain assets with evidence recorded.

Not production-safe by default:

- Google Images/search results.
- Random retailer/review-site photos.
- Scraped Amazon imagery.
- Assets with unknown provenance.
- Press images whose terms have not been checked for the intended derivative/commercial use.

## Meshy / generative 3D

Meshy can be an asset-creation provider, but it does not determine publication rights. A Meshy output must carry the lineage of every reference input and pass the same restricted-feature gate as any other asset.

A generated child cannot turn an uncleared reference into a cleared asset.

## Files

- `assetRights.ts` — source grants, restricted-feature review, fail-closed publication decision.
- `rightsSafeVisuals.ts` — provider-neutral prompt rules and structured generation policy.
- `productVisualAssets.ts` — quarantine/approval registry, asset selection, final bundle gate.
- `assetRights.test.ts` / `productVisualAssets.test.ts` — regression tests for the safety invariants.

## Non-negotiable invariants

1. No unknown-source reference enters derivative generation.
2. No generated/captured third-party logo or stylized wordmark auto-publishes.
3. No copied product photo auto-publishes through the generative asset path.
4. No exact/distinctive third-party industrial geometry auto-publishes without recorded design-use authorization.
5. No asset with incomplete restricted-feature review auto-publishes.
6. No unregistered visual can enter an automatically publishable final master.
7. Product identity and factual claims are deterministic layers; generative visuals are not evidence.
