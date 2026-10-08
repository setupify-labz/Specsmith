// MASTER #7: the Quality and Integrity Review Packet.
//
// One packet describes ONE exact creative in ONE exact platform cut. It is the
// record of what a machine established about the rendered bytes, what it could
// not establish, and what only a person can decide.
//
// WHAT THE VERDICT MEANS
// ----------------------
//   blocked                            A specific defect was found, or a person rejected the cut.
//   awaiting-human-review              No machine-found defect; people still have to decide.
//   eligible-to-request-final-approval Every check and every human gate passed. It does NOT mean
//                                      approved, scheduled or publishable: it only means someone may
//                                      now ask for final approval. With no trusted approval record in
//                                      this repository, no packet can reach it today.
//
// There is no aggregate score. A score cannot outvote a specific defect, so
// none is computed.

import type { VideoPlatform } from "../../types.ts";

export const REVIEW_PACKET_VERSION = "quality-integrity-review-packet-v1";

export type ReviewVerdict = "blocked" | "awaiting-human-review" | "eligible-to-request-final-approval";

/**
 * How a finding limits the verdict.
 *
 * - `blocking`: a defect the machine established. The packet is blocked.
 * - `needs-person`: the machine could not establish it either way. A named
 *   human gate must decide; the packet waits for people.
 * - `blocks-final-approval`: not a defect of this cut, but a condition that
 *   forbids final approval however the human review goes (synthetic research,
 *   a placeholder voice, unknown rights).
 * - `advisory`: worth an editor's attention; it does not limit the verdict.
 */
export type FindingSeverity = "blocking" | "needs-person" | "blocks-final-approval" | "advisory";

/** Who fixes it: the stage that produced the defect. */
export type FindingOwner =
  | "research"
  | "script"
  | "captions"
  | "disclosure"
  | "graphics"
  | "capture"
  | "narration"
  | "render"
  | "rights"
  | "platform-cut"
  | "human-review";

export interface ReviewFinding {
  readonly code: string;
  readonly severity: FindingSeverity;
  /** The check that produced it (an id from CHECKS). */
  readonly check: CheckId;
  /** "beat 2 caption", "12.40s", "asset ui-beat-3", ... */
  readonly location: string;
  /** What was observed, verbatim where it is text. */
  readonly evidence: string;
  readonly message: string;
  readonly owner: FindingOwner;
  /** What must run again once it is fixed. */
  readonly recheck: readonly (CheckId | HumanGateId)[];
  /** For `needs-person`: the gate that decides it. */
  readonly gate?: HumanGateId;
}

/** The manifest's asset records, by role. */
export const MANIFEST_ASSET_KEYS = ["manifest.captures", "manifest.disclosurePanel", "manifest.captions", "manifest.narration", "manifest.otherAssets"] as const;

/**
 * Every check a packet can report, and the input identities it depends on.
 * A change to any of those inputs invalidates the check, and only those.
 */
export const CHECKS = {
  "media.bytes": { title: "File exists, is not empty, and its bytes match the render manifest's hash; the render was made from this script and plan", bindsTo: ["media", "script", "productionPlan", "manifest.target"] },
  "media.decode": { title: "Every frame and audio packet decodes", bindsTo: ["media"] },
  "media.format": { title: "Duration, resolution, aspect, frame rate, audio and codec match the platform cut", bindsTo: ["media", "platformCut", "manifest.target"] },
  "media.blank-frozen": { title: "No blank stretch, no freeze across a planned cut, no frozen tail", bindsTo: ["media", "script", "manifest.timeline"] },
  "media.audio-levels": { title: "Audio present and not clipped", bindsTo: ["media"] },
  "media.ending": { title: "The video reaches its planned end and the narration is not cut off", bindsTo: ["media", "script"] },
  "frames.bands": { title: "Sampled frames: disclosure band, story band against each beat's capture, caption ink, distinct cuts", bindsTo: ["media", "assets", "disclosure", "captions", "manifest.layout", "manifest.timeline", "manifest.captures", "manifest.disclosurePanel", "manifest.captions"] },
  // The planned caption set is the production plan's own cues when it has them (plannedCaptionCues).
  "captions.rendered-text": { title: "Burned-in caption file matches the planned caption cues and beat windows", bindsTo: ["captions", "script", "productionPlan", "manifest.captions"] },
  "narration.binding": { title: "Narration audio was synthesised from this script", bindsTo: ["script", "assets", "manifest.narration"] },
  // Sound outside the placed lines is explained only by a declared sound effect (manifest.otherAssets), whose bytes verified (assets).
  "narration.timing": { title: "Each narration line is spoken inside its beat's window, and no other sound plays but declared effects", bindsTo: ["script", "media", "assets", "manifest.narration", "manifest.otherAssets"] },
  "disclosure.content": { title: "The rendered disclosure panel carries the planned disclosure, verbatim, legibly", bindsTo: ["disclosure", "assets", "claims", "manifest.disclosurePanel"] },
  "disclosure.coverage": { title: "The disclosure is on screen for every claim, for the whole video", bindsTo: ["disclosure", "media", "claims"] },
  "disclosure.safe-area": { title: "Disclosure and captions stay inside the platform cut's safe area", bindsTo: ["platformCut", "disclosure", "captions", "manifest.layout"] },
  "claims.model": { title: "Every figure agrees with the model it comes from, ties kept apart from leads", bindsTo: ["claims", "evidence", "script", "captions", "title", "description", "graphics", "manifest.captions"] },
  // A beat's text includes the labels its motion graphic draws, read from the capture records
  // (timeline -> asset id -> metadata.onScreenText) and only for assets whose bytes verified.
  "claims.presentation": { title: "Estimates are labelled as estimates, conditions stated, nothing generalised or made exact", bindsTo: ["claims", "script", "captions", "evidence", "title", "description", "graphics", "disclosure", "assets", "manifest.timeline", "manifest.captures", "manifest.captions"] },
  "claims.screen": { title: "A figure is presented over a screen showing the build, settings and game it is about", bindsTo: ["claims", "assets", "script", "captions", "graphics", "manifest.timeline", "manifest.captures", "manifest.captions"] },
  "claims.undeclared": { title: "No figure appears in text without a declared, checkable claim", bindsTo: ["claims", "script", "captions", "graphics", "title", "description", "manifest.captions"] },
  "claims.research": { title: "Script, title and description against the research contract, through the strict gate (MASTER #2)", bindsTo: ["research", "script", "title", "description"] },
  "captures.current": { title: "Each capture still shows what the current model gives for its state", bindsTo: ["assets", "evidence", "manifest.timeline", "manifest.captures"] },
  "graphics.integrity": { title: "Editorial graphics show only supported values, at honest scale, attributed truthfully", bindsTo: ["graphics", "evidence", "assets", "manifest.timeline", "manifest.captures"] },
  "storyboard.quality": { title: "MASTER #1 storyboard review: no recommended fix or hard failure outstanding", bindsTo: ["script", "captions", "ctaDestination"] },
  "research.provenance": { title: "Research identity, and synthetic research kept marked as synthetic", bindsTo: ["research"] },
  "cta.destination": { title: "The call to action names the approved destination", bindsTo: ["script", "captions", "description", "ctaDestination", "manifest.captions"] },
  "rights.assets": { title: "Every asset in the render has source, permission, permitted use and scope", bindsTo: ["assets", "rights", ...MANIFEST_ASSET_KEYS] },
  "rights.placeholders": { title: "Placeholder voice, fixture audio and mock images stay identified", bindsTo: ["assets", "rights", ...MANIFEST_ASSET_KEYS] },
  "text.ocr": { title: "Rendered on-screen text read back from pixels (OCR)", bindsTo: ["media"] },
  "audio.asr": { title: "Spoken words transcribed from the audio (ASR)", bindsTo: ["media"] },
  "decisions.binding": { title: "Recorded human decisions name these exact bytes and this cut", bindsTo: ["media", "platformCut", "decisions"] },
} as const satisfies Record<string, { title: string; bindsTo: readonly BindingKey[] }>;

export type CheckId = keyof typeof CHECKS;

/** The input identities a packet binds to. */
export type BindingKey =
  | "media" | "platformCut" | "script" | "captions" | "disclosure" | "claims" | "evidence"
  | "research" | "graphics" | "assets" | "rights" | "decisions"
  /** The published title, the description, and the destination the call to action must name. */
  | "title" | "description" | "ctaDestination"
  /** The production plan the submission says the render was made from. */
  | "productionPlan"
  /**
   * The render manifest, part by part, as the checks read it: what was rendered
   * (cut, encode, script and plan identities, output path and recorded hash),
   * the band layout, the beat timeline, and each role's asset records
   * (path, recorded hash and metadata).
   */
  | "manifest.target" | "manifest.layout" | "manifest.timeline" | "manifest.captures"
  | "manifest.disclosurePanel" | "manifest.captions" | "manifest.narration" | "manifest.otherAssets";

/**
 * Checks that consume another check's result. The disclosure's coverage is
 * measured by the frame check, and the estimate-label and qualifier checks
 * credit the on-screen disclosure only when coverage and content verified it,
 * so whatever invalidates those invalidates these too.
 */
export const CHECK_USES: Readonly<Partial<Record<CheckId, readonly CheckId[]>>> = {
  "disclosure.coverage": ["frames.bands"],
  "claims.presentation": ["disclosure.coverage", "disclosure.content"],
};

export type HumanGateId =
  | "hook-on-phone"
  | "factual-takeaway"
  | "readable-at-size"
  | "pacing"
  | "style-fits-audience"
  | "voice-and-mix"
  | "disclosures-in-context"
  | "rights-and-publication";

export interface CheckRecord {
  readonly check: CheckId;
  readonly status: "passed" | "failed" | "unavailable" | "not-applicable";
  /** Why it is unavailable or not applicable, or what it measured. */
  readonly detail: string;
}

export interface HumanGateRecord {
  readonly gate: HumanGateId;
  readonly question: string;
  readonly bindsTo: readonly BindingKey[];
  readonly status: "open" | "rejected";
  /** Every recorded decision for this gate, and why it does or does not count. */
  readonly recordedDecisions: readonly {
    readonly outcome: "approved" | "rejected";
    readonly by: string;
    readonly at: string;
    readonly mediaSha256: string | null;
    readonly variantId: string | null;
    /** Always false: nothing in this repository can confirm a person made it. */
    readonly trusted: false;
    readonly appliesToThisCut: boolean;
    readonly note: string;
  }[];
}

export interface PlatformVariant {
  readonly variantId: string;
  readonly platform: VideoPlatform;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly minDurationSeconds: number;
  readonly maxDurationSeconds: number;
  readonly requiresAudio: boolean;
  /**
   * Insets, in pixels at this size, that the platform's own interface may
   * cover. Null when no verified source for them exists: the safe-area check
   * then reports itself unavailable instead of using guessed numbers.
   */
  readonly safeArea: { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number; readonly source: string } | null;
}

export interface ReviewPacket {
  readonly version: typeof REVIEW_PACKET_VERSION;
  readonly packetId: string;
  readonly reviewedAt: string;
  readonly creativeId: string;
  readonly platformVariantId: string;
  readonly verdict: ReviewVerdict;
  /** One line for an editor: why the verdict is what it is. */
  readonly summary: string;
  /** Plain words, so nobody reads more into the verdict than it says. */
  readonly verdictMeaning: string;
  readonly identities: {
    readonly researchContractSha256: string;
    readonly researchQuestionId: string;
    readonly researchKind: "production" | "synthetic-fixture";
    readonly evidenceSnapshotIds: readonly string[];
    readonly modelSnapshotSha256: string;
    readonly conceptId: string;
    readonly conceptSha256: string;
    readonly storyboardSha256: string;
    readonly narrationSha256: string;
    readonly captionsSha256: string;
    readonly disclosuresSha256: string;
    readonly claimsSha256: string;
    readonly graphicsSha256: string;
    readonly productionPlanSha256: string;
    readonly titleSha256: string;
    readonly descriptionSha256: string;
    readonly approvedDestination: string;
    readonly renderManifestSha256: string;
    readonly assetsSha256: string;
    readonly rightsManifestSha256: string;
    readonly platformCutSha256: string;
  };
  readonly media: {
    readonly path: string;
    /** Computed here from the file's bytes. */
    readonly sha256: string | null;
    readonly bytes: number | null;
    readonly durationSeconds: number | null;
    readonly width: number | null;
    readonly height: number | null;
    readonly fps: number | null;
    readonly videoCodec: string | null;
    readonly audioCodec: string | null;
    readonly audioChannels: number | null;
  };
  readonly assets: readonly { readonly assetId: string; readonly role: string; readonly sha256: string | null; readonly kind: string; readonly rights: string }[];
  /** Ranked: blocking first. */
  readonly findings: readonly ReviewFinding[];
  readonly checksCompleted: readonly CheckRecord[];
  readonly checksUnavailable: readonly CheckRecord[];
  readonly humanGates: readonly HumanGateRecord[];
  /** Why no human gate can close in this repository today. */
  readonly approvalMechanism: { readonly trustedApprovalAvailable: false; readonly why: string };
  /** The exact input identities this packet is bound to, per binding key. */
  readonly bindings: Readonly<Record<BindingKey, string>>;
}
