// What a review is asked to review, and what the renderer says it produced.
//
// Everything in here is a CLAIM until the review checks it: the render
// manifest is a file anyone can edit, so every file it names is hashed again,
// every capture's text is recomputed from the model, and every figure is
// recomputed from its statement. Only the review's own measurements become
// findings.

import type { ComparePairing } from "../../leadsVsAverage/facts.ts";
import type { BandedLayout } from "../../bandedLayout.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";
import type { ResearchCreativeContract } from "../research/creativeContract.ts";
import type { MeasurementLookalikeSubject } from "../creative/visualHonesty.ts";
import type { HumanGateId, PlatformVariant } from "./types.ts";

export const RENDER_MANIFEST_VERSION = "render-manifest-v1";

export type ManifestMetadata = Readonly<Record<string, string | number | boolean>>;

export interface RenderManifestAsset {
  readonly assetId: string;
  readonly role: "capture" | "disclosure-panel" | "captions" | "narration" | "music" | "sound-effect" | "image" | "graphic" | "video-clip";
  readonly path: string;
  /** As the renderer recorded it. The review hashes the file again. */
  readonly sha256: string;
  readonly metadata: ManifestMetadata;
}

/** Written by the renderer next to the video. Binds the output to what went into it. */
export interface RenderManifest {
  readonly version: typeof RENDER_MANIFEST_VERSION;
  readonly variantId: string;
  readonly output: {
    readonly path: string;
    readonly sha256: string;
    readonly encode: { readonly width: number; readonly height: number; readonly fps: number; readonly videoCodec: string; readonly audioCodec: string | null };
  };
  readonly storyboardSha256: string;
  readonly productionPlanSha256: string;
  readonly layout: BandedLayout;
  readonly disclosurePanelAssetId: string;
  readonly captionsAssetId: string;
  readonly narrationAssetId: string | null;
  /**
   * Where each beat's narration was placed, when the narration renderer
   * recorded it. Null when it did not (a continuous take): timing against the
   * beats is then unknown, not assumed.
   */
  readonly narrationSegments: readonly { readonly beatIndex: number; readonly startSecond: number; readonly endSecond: number }[] | null;
  readonly beats: readonly {
    readonly beatIndex: number;
    readonly startSecond: number;
    readonly endSecond: number;
    readonly captureAssetIds: readonly string[];
    /** True when the story band is meant to move; a freeze there is a defect. */
    readonly motion: boolean;
  }[];
  readonly assets: readonly RenderManifestAsset[];
}

/** Where a figure's value comes from. Not how it is worded: the wording is checked. */
export type ClaimBasis = "model-estimate" | "measured-benchmark" | "research-claim" | "editorial-illustration" | "synthetic-fixture";

export type ClaimStatement =
  | { readonly kind: "tally"; readonly pairing: ComparePairing; readonly leadsA: number; readonly leadsB: number; readonly ties: number | null }
  | { readonly kind: "averages"; readonly pairing: ComparePairing; readonly averageA: number; readonly averageB: number }
  | { readonly kind: "average-difference"; readonly pairing: ComparePairing; readonly leader: "A" | "B"; readonly difference: number }
  | { readonly kind: "game-fps"; readonly pairing: ComparePairing; readonly game: string; readonly build: "A" | "B"; readonly fps: number }
  | { readonly kind: "game-margin"; readonly pairing: ComparePairing; readonly game: string; readonly leader: "A" | "B" | "tie"; readonly margin: number }
  | { readonly kind: "lead-range"; readonly pairing: ComparePairing; readonly build: "A" | "B"; readonly low: number; readonly high: number }
  | { readonly kind: "research"; readonly researchClaimId: string };

export interface MeasurementProvenance {
  readonly source: string;
  readonly url: string;
  readonly hardware: string;
  readonly settings: string;
  readonly resolution: string;
  readonly game: string;
  readonly capturedAt: string;
}

/** One figure or factual statement as the viewer meets it. */
export interface PresentedClaim {
  readonly claimId: string;
  /** 0-based beat it is presented in. */
  readonly beatIndex: number;
  readonly where: "narration" | "caption" | "title" | "description" | "graphic";
  /** The exact words as presented; must occur in that surface. */
  readonly text: string;
  readonly basis: ClaimBasis;
  readonly statement: ClaimStatement;
  /** Required when basis is measured-benchmark. */
  readonly measurement?: MeasurementProvenance;
}

export type GraphicContent =
  | { readonly kind: "bars"; readonly pairing: ComparePairing; readonly of: "averages" | "game-fps"; readonly game?: string;
      readonly values: readonly [number, number]; readonly barLengthsPx: readonly [number, number]; readonly axisStartsAtZero: boolean }
  | { readonly kind: "range"; readonly pairing: ComparePairing; readonly of: "lead-range"; readonly build: "A" | "B"; readonly low: number; readonly high: number }
  | { readonly kind: "range"; readonly pairing: ComparePairing; readonly of: "model-variance"; readonly build: "A" | "B"; readonly game: string; readonly low: number; readonly high: number }
  | { readonly kind: "outcomes"; readonly pairing: ComparePairing; readonly perGame: readonly { readonly game: string; readonly outcome: "A" | "B" | "tie" }[] }
  | { readonly kind: "metaphor"; readonly metaphor: string; readonly subject: MeasurementLookalikeSubject | "other" };

/** A drawn editorial graphic: what it shows, and who it says the numbers come from. */
export interface EditorialGraphic {
  readonly graphicId: string;
  readonly beatIndex: number;
  /** Its on-screen text. */
  readonly label: string;
  readonly shows: GraphicContent;
  readonly attributedTo: "model" | "page" | "illustration";
  /** When attributed to the page: the text the page must actually show. */
  readonly pageText?: string;
}

export type AssetKind =
  | "specsmith-ui-capture"
  | "product-photography"
  | "editorial-illustration"
  | "repo-generated-graphic"
  | "disclosure-panel"
  | "caption-render"
  | "narration"
  | "music"
  | "sound-effect"
  | "generated-image"
  | "generated-audio"
  | "stock-media"
  | "test-fixture";

export interface AssetRightsRecord {
  readonly assetId: string;
  readonly kind: AssetKind;
  /** Where it came from: a repo path and generator, a vendor, a URL. */
  readonly source: string;
  readonly license: {
    readonly kind: "repo-owned" | "licensed" | "permission" | "public-domain" | "unknown" | "none";
    /** A license id, contract reference or permission record. Null when there is none. */
    readonly evidence: string | null;
    readonly permittedUse: readonly string[];
    readonly attribution: string | null;
    readonly expiresAt: string | null;
    readonly scope: string | null;
  };
  /** Required for generated and repo-generated assets: what made it, from what. */
  readonly generation: { readonly generator: string; readonly inputs: string } | null;
  readonly transformations: readonly string[];
  readonly placeholder: { readonly isPlaceholder: boolean; readonly why: string | null };
}

/** A decision someone says a person made. Recorded; never proof by itself. */
export interface HumanDecisionClaim {
  readonly gate: HumanGateId;
  readonly outcome: "approved" | "rejected";
  readonly by: string;
  readonly at: string;
  readonly mediaSha256: string | null;
  readonly variantId: string | null;
  readonly note?: string;
}

/** The use every asset must permit for a SpecSmith short to go out. */
export const REQUIRED_USE = "commercial-social-video";

export interface ReviewSubmission {
  readonly creativeId: string;
  readonly variant: PlatformVariant;
  readonly research: {
    readonly contract: ResearchCreativeContract;
    /** What the caller says the research is. Checked against the contract's own markers. */
    readonly declaredKind: "production" | "synthetic-fixture";
    readonly evidenceSnapshotIds: readonly string[];
  };
  readonly concept: { readonly conceptId: string; readonly body: unknown };
  readonly storyboard: PlatformScriptStoryboard;
  readonly title: string;
  readonly description: string;
  /** The destination the mission approved for the call to action. */
  readonly approvedDestination: string;
  /** The disclosure lines the plan requires, verbatim. */
  readonly disclosureLines: readonly string[];
  readonly productionPlan: unknown;
  readonly claims: readonly PresentedClaim[];
  readonly graphics: readonly EditorialGraphic[];
  /** The review reads the manifest from disk and hashes it; it is not passed as an object. */
  readonly renderManifestPath: string;
  readonly rights: readonly AssetRightsRecord[];
  readonly humanDecisions?: readonly HumanDecisionClaim[];
}
