// The render manifest: written by the renderer, next to the video, at render time.
//
// It binds the output bytes to the storyboard, plan, captures, disclosure
// panel, captions and narration that went into them, each by the hash of its
// own file. It is a record, not a proof: the review re-reads every file it
// names and treats any difference as a defect.

import { writeFileSync } from "node:fs";

import type { BandedLayout } from "../../bandedLayout.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";
import { RENDER_MANIFEST_VERSION, type ManifestMetadata, type RenderManifest, type RenderManifestAsset } from "./inputs.ts";
import { sha256File, sha256Json } from "./util.ts";

export interface ManifestFile {
  readonly assetId: string;
  readonly path: string;
  readonly metadata?: ManifestMetadata;
}

function asset(file: ManifestFile, role: RenderManifestAsset["role"]): RenderManifestAsset {
  const sha256 = sha256File(file.path);
  if (sha256 === null) throw new Error(`Cannot record ${file.assetId}: ${file.path} does not exist.`);
  return { assetId: file.assetId, role, path: file.path, sha256, metadata: file.metadata ?? {} };
}

export function buildRenderManifest(input: {
  readonly variantId: string;
  readonly outputPath: string;
  readonly encode: RenderManifest["output"]["encode"];
  readonly storyboard: PlatformScriptStoryboard;
  readonly productionPlan: unknown;
  readonly layout: BandedLayout;
  readonly disclosurePanel: ManifestFile;
  readonly captions: ManifestFile;
  readonly narration: ManifestFile | null;
  readonly narrationSegments: RenderManifest["narrationSegments"];
  readonly beats: readonly { readonly startSecond: number; readonly endSecond: number; readonly captures: readonly ManifestFile[]; readonly motion?: boolean }[];
  readonly otherAssets?: readonly (ManifestFile & { readonly role: RenderManifestAsset["role"] })[];
}): RenderManifest {
  const outputSha = sha256File(input.outputPath);
  if (outputSha === null) throw new Error(`Cannot record the render: ${input.outputPath} does not exist.`);
  const assets = new Map<string, RenderManifestAsset>();
  const keep = (entry: RenderManifestAsset) => {
    const existing = assets.get(entry.assetId);
    if (existing && existing.sha256 !== entry.sha256) throw new Error(`Asset id ${entry.assetId} names two different files.`);
    assets.set(entry.assetId, entry);
  };
  keep(asset(input.disclosurePanel, "disclosure-panel"));
  keep(asset(input.captions, "captions"));
  if (input.narration) keep(asset(input.narration, "narration"));
  for (const beat of input.beats) for (const capture of beat.captures) keep(asset(capture, "capture"));
  for (const other of input.otherAssets ?? []) keep(asset(other, other.role));
  return {
    version: RENDER_MANIFEST_VERSION,
    variantId: input.variantId,
    output: { path: input.outputPath, sha256: outputSha, encode: input.encode },
    storyboardSha256: sha256Json(input.storyboard),
    productionPlanSha256: sha256Json(input.productionPlan),
    layout: input.layout,
    disclosurePanelAssetId: input.disclosurePanel.assetId,
    captionsAssetId: input.captions.assetId,
    narrationAssetId: input.narration?.assetId ?? null,
    narrationSegments: input.narrationSegments,
    beats: input.beats.map((beat, beatIndex) => ({
      beatIndex, startSecond: beat.startSecond, endSecond: beat.endSecond,
      captureAssetIds: beat.captures.map((capture) => capture.assetId), motion: beat.motion ?? false,
    })),
    assets: [...assets.values()],
  };
}

export function writeRenderManifest(path: string, manifest: RenderManifest): void {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
