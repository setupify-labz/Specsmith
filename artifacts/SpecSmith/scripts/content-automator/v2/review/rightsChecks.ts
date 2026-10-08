// Rights and provenance for every asset the render manifest says went into the cut.
//
// Unknown rights do not fail open: they forbid final approval. An asset the
// record calls licensed without evidence is unknown, not licensed. A
// placeholder (the espeak-ng voice, a test fixture image) stays a placeholder
// whatever its record says: the renderer's own metadata marks it, and a record
// that claims otherwise is a relabelling, which blocks.
//
// Repo-created assets (SpecSmith UI captures, the disclosure panel, burned-in
// captions) only need enough to be reviewable: where they came from and what
// made them.

import type { AssetKind, AssetRightsRecord, RenderManifestAsset } from "./inputs.ts";
import { REQUIRED_USE } from "./inputs.ts";
import type { ReviewFinding } from "./types.ts";

const REPO_CREATED: readonly AssetKind[] = ["specsmith-ui-capture", "disclosure-panel", "caption-render", "repo-generated-graphic"];
const GENERATED: readonly AssetKind[] = ["generated-image", "generated-audio"];

/** What the renderer's own metadata says about whether an asset is a placeholder. */
export function placeholderEvidence(asset: RenderManifestAsset): string | null {
  const meta = asset.metadata;
  if (meta.isFixture === true) return "renderer metadata isFixture: true";
  if (meta.fixture === true) return "renderer metadata fixture: true";
  for (const key of ["renderer", "provider"] as const) {
    const value = meta[key];
    if (typeof value === "string" && /fixture|placeholder|mock/i.test(value)) return `renderer metadata ${key}: ${value}`;
  }
  return null;
}

/** The kind the renderer's metadata implies, where it implies one. */
function kindFromRenderer(asset: RenderManifestAsset): AssetKind | null {
  const renderer = String(asset.metadata.renderer ?? "");
  if (renderer === "specsmith-deterministic-ui-render" && asset.metadata.realUi === true) return "specsmith-ui-capture";
  if (renderer === "specsmith-disclosure-overlay") return "disclosure-panel";
  if (asset.role === "narration") return "narration";
  if (renderer === "specsmith-synth-sound-effects") return "sound-effect";
  if (renderer === "specsmith-synth-music-and-effects") return "music";
  if (asset.role === "captions") return "caption-render";
  return null;
}

export function checkRights(input: {
  readonly assets: readonly RenderManifestAsset[];
  readonly records: readonly AssetRightsRecord[];
  readonly now: Date;
}): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  const add = (code: string, severity: ReviewFinding["severity"], asset: string, evidence: string, message: string,
    check: "rights.assets" | "rights.placeholders" = "rights.assets") =>
    out.push({ code, severity, check, location: `asset ${asset}`, evidence, message, owner: "rights", recheck: [check, "rights-and-publication"] });

  for (const record of input.records) {
    if (!input.assets.some((asset) => asset.assetId === record.assetId)) {
      add("rights-record-for-absent-asset", "advisory", record.assetId, record.source, "A rights record names an asset the render manifest does not list; it was not used.");
    }
  }

  for (const asset of input.assets) {
    const record = input.records.find((entry) => entry.assetId === asset.assetId);
    const evidence = placeholderEvidence(asset);
    if (!record) {
      add("rights-unknown", "blocks-final-approval", asset.assetId, `${asset.role} ${asset.path}`,
        "No rights record: its source, permission and permitted use are unknown, so the cut cannot be approved for publication.");
      if (evidence) add("placeholder-asset", "blocks-final-approval", asset.assetId, evidence, `This ${asset.role} is a placeholder and can never be published.`, "rights.placeholders");
      continue;
    }

    // What it is: a UI capture is not product photography and not an illustration.
    const implied = kindFromRenderer(asset);
    if (implied && implied !== record.kind && !(implied === "narration" && record.kind === "generated-audio")) {
      add("asset-kind-mismatch", "blocking", asset.assetId, `record: ${record.kind}; renderer: ${implied}`,
        `The rights record calls this ${record.kind}, but the renderer that made it records ${implied}. Each kind carries different rights; it must be described as what it is.`);
    }

    // Placeholders stay identified.
    if (evidence && !record.placeholder.isPlaceholder) {
      add("placeholder-relabelled", "blocking", asset.assetId, evidence,
        "The rights record says this is not a placeholder, but the renderer marked it as one. A flag cannot promote a fixture.", "rights.placeholders");
    } else if (evidence || record.placeholder.isPlaceholder || record.kind === "test-fixture") {
      add("placeholder-asset", "blocks-final-approval", asset.assetId, evidence ?? record.placeholder.why ?? record.kind,
        `This ${asset.role} is a placeholder (${record.placeholder.why ?? evidence ?? record.kind}). It may be reviewed for craft but never published.`, "rights.placeholders");
    }

    // A sound effect is repo-made only when its renderer says it synthesized it here (soundEffects.ts): no samples.
    const synthesizedHere = record.kind === "sound-effect" && asset.metadata.renderer === "specsmith-synth-sound-effects" && asset.metadata.isLicensedSample === false;

    // Permission.
    const license = record.license;
    if (!record.source.trim()) add("source-missing", "blocks-final-approval", asset.assetId, "(empty)", "The record does not say where the asset came from.");
    if (license.kind === "none") {
      add("unlicensed-asset", "blocking", asset.assetId, record.source, "The record says there is no license or permission for this asset.");
    } else if (license.kind === "unknown") {
      add("rights-unknown", "blocks-final-approval", asset.assetId, record.source, "Its license is unknown, so the cut cannot be approved for publication.");
    } else if (license.kind === "repo-owned") {
      if (!REPO_CREATED.includes(record.kind) && !GENERATED.includes(record.kind) && record.kind !== "narration" && record.kind !== "test-fixture" && !synthesizedHere) {
        add("repo-ownership-unsupported", "blocks-final-approval", asset.assetId, record.kind,
          `A ${record.kind} is not something the repository makes; repo ownership needs evidence it was created here.`);
      }
    } else if (!license.evidence?.trim()) {
      add("license-evidence-missing", "blocks-final-approval", asset.assetId, license.kind,
        `The record says ${license.kind}, but gives no license or permission evidence; that is unknown rights.`);
    }
    if (license.kind !== "none" && license.kind !== "unknown" && !license.permittedUse.includes(REQUIRED_USE)) {
      add("use-not-permitted", "blocking", asset.assetId, license.permittedUse.join(", ") || "(none)",
        `Its permitted use does not include ${REQUIRED_USE}.`);
    }
    if (license.expiresAt !== null) {
      const expires = Date.parse(license.expiresAt);
      if (!Number.isFinite(expires)) add("license-expiry-unreadable", "blocks-final-approval", asset.assetId, license.expiresAt, "The license expiry cannot be read.");
      else if (expires <= input.now.getTime()) add("license-expired", "blocking", asset.assetId, license.expiresAt, "The license has expired.");
    }
    if ((license.kind === "licensed" || license.kind === "permission") && license.attribution === null && /attribution/i.test(license.scope ?? "")) {
      add("attribution-missing", "blocking", asset.assetId, license.scope ?? "", "The license requires attribution, and none is recorded.");
    }

    // Generated and repo-made assets keep their generation record.
    if ((GENERATED.includes(record.kind) || REPO_CREATED.includes(record.kind) || synthesizedHere) && (!record.generation?.generator.trim() || !record.generation.inputs.trim())) {
      add("generation-record-missing", "blocks-final-approval", asset.assetId, record.kind,
        "A generated or repo-made asset must say what made it and from what; without that it is not reviewable.");
    }
  }
  return out;
}
