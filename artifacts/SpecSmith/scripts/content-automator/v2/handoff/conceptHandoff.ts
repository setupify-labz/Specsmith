// MASTER #6 -> MASTER #1: a reviewed concept becomes a creative report.
//
// THE IDENTITIES THAT MUST STAY ATTACHED
// ---------------------------------------
//   research contract   sha256 of the contract the mission carried
//   mission             missionId, and the brief hash derived from it
//   authored batch      attempt number, and the hash of the concepts the checks ran on
//   chosen concept      conceptId, and the hash of that exact concept
//   storyboard          the hash of the storyboard the proposal pass built from it
//   rendered media      sha256 computed from the file's bytes (mediaVerification.ts)
//   quality review      made here, about that storyboard, bound to those bytes
//   human decisions     recorded per gate; closing one needs a trusted record, which does not exist yet
//
// WHAT IS RECOMPUTED, NOT TRUSTED
// --------------------------------
// The handoff re-runs every workflow check (evaluateAuthoredBatch) instead of
// reading review-packet.json, which is a file anyone can edit. The concept and
// storyboard are the ones the proposal pass produced; the caller supplies only
// the conceptId. The quality review is made here, so it cannot describe some
// other storyboard. Handoffs are frozen and issued through a module-private
// WeakSet, so a copied or JSON-round-tripped handoff is refused.
//
// WHAT CAN NEVER HAPPEN BY INFERENCE
// -----------------------------------
// A handoff is `human-review-ready` and `approved: false`, always. The report
// built from it keeps every #6 outstanding approval as a human gate, adds the
// concept choice as one, blocks synthetic research outright, and names the gap
// that nothing ties rendered bytes to this storyboard.

import { createHash } from "node:crypto";

import { captionCuesForScript } from "../../productionPlan.ts";
import { buildContentCreativeReport, type ContentCreativeReport, type HumanGate } from "../contentCreativeReport.ts";
import { reviewCreativeQuality } from "../creativeQualityReview.ts";
import { isVerifiedMedia, type VerifiedMedia } from "../mediaVerification.ts";
import { buildCreativeBrief, OUTSTANDING_HUMAN_APPROVALS } from "../creative/fileWorkflow.ts";
import { evaluateAuthoredBatch } from "../creative/fileWorkflowPass.ts";
import type { CreativeMissionInput } from "../creative/proposalPass.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";

export const HANDOFF_VERSION = "concept-handoff-v1";

export const SYNTHETIC_RESEARCH_BLOCKER =
  "Research is synthetic engineering fixture data: a creative built on it may never be published.";
export const RENDER_PROVENANCE_GAP =
  "Render provenance: nothing in this repository ties the verified media bytes to this storyboard; the file may not be a render of this concept.";

export class ConceptHandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConceptHandoffError";
  }
}

export interface HandoffIdentities {
  readonly researchContractSha256: string;
  readonly missionId: string;
  readonly briefHash: string;
  readonly syntheticResearch: boolean;
  readonly batch: { readonly attempt: number; readonly batchHash: string };
  readonly concept: { readonly conceptId: string; readonly conceptSha256: string };
  readonly storyboardSha256: string;
}

export interface ConceptHandoff {
  readonly version: typeof HANDOFF_VERSION;
  /** The only status a handoff can have. It is a request for review, not a result of one. */
  readonly status: "human-review-ready";
  readonly approved: false;
  readonly identities: HandoffIdentities;
  /** Who picked this concept from the batch. A name given here is recorded, not verified. */
  readonly conceptSelection: { readonly conceptId: string; readonly selectedBy: string | null; readonly trusted: false };
  /** What the MASTER #6 packet left for people to do. Carried into the report as gates. */
  readonly outstandingApprovals: readonly string[];
  readonly storyboard: PlatformScriptStoryboard;
  readonly ctaRoute: string;
  readonly createdAt: string;
}

const ISSUED = new WeakSet<object>();
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}

/**
 * Stable gate ids for the #6 packet's outstanding approvals, by exact text.
 *
 * Explicit rather than derived from the prose, and an approval this table does
 * not know is refused: a new #6 gate must not silently vanish from the report.
 */
const GATE_IDS: Readonly<Record<string, string>> = {
  [OUTSTANDING_HUMAN_APPROVALS[0]]: "creative-review",
  [OUTSTANDING_HUMAN_APPROVALS[1]]: "readability-review",
  [OUTSTANDING_HUMAN_APPROVALS[2]]: "rendered-media-review",
  [OUTSTANDING_HUMAN_APPROVALS[3]]: "audio-review",
  [OUTSTANDING_HUMAN_APPROVALS[4]]: "rights-and-disclosure-sign-off",
  [OUTSTANDING_HUMAN_APPROVALS[5]]: "publishing-authorization",
};

export function gateIdFor(outstanding: string): string {
  const id = GATE_IDS[outstanding];
  if (!id) throw new ConceptHandoffError(`Unknown outstanding approval "${outstanding}": map it to a gate before handing off.`);
  return id;
}

export async function buildConceptHandoff(input: {
  readonly directory: string;
  readonly mission: Omit<CreativeMissionInput, "concepts">;
  readonly conceptId: string;
  readonly selectedBy?: string;
  readonly memoryObservations?: readonly string[];
  readonly now?: Date;
}): Promise<ConceptHandoff> {
  // Refuses a mislabelled synthetic mission before anything runs (or is written).
  const brief = buildCreativeBrief(input.mission, input.memoryObservations ?? []);
  const evaluation = await evaluateAuthoredBatch(input.directory, input.mission, brief);
  const { packet, pass } = evaluation;
  if (!packet.humanReviewReady) {
    throw new ConceptHandoffError(
      `Attempt ${evaluation.attempts} is not ready for human review (the proposal pass alone reported "${packet.status}"). ` +
        `${evaluation.feedback?.nextStep ?? "No batch has been authored."} Only a batch that passed every machine check can be handed off.`,
    );
  }
  if (packet.batchHash === null) throw new ConceptHandoffError("The checked batch has no hash; nothing identifies what was reviewed.");
  const proposal = pass.result.proposals.find((entry) => entry.concept.conceptId === input.conceptId);
  if (!proposal) {
    throw new ConceptHandoffError(`Concept "${input.conceptId}" is not in the checked batch (${packet.conceptIds.join(", ")}).`);
  }
  if (!proposal.contractEligible) throw new ConceptHandoffError(`Concept "${input.conceptId}" did not pass the machine checks.`);

  const storyboard = structuredClone(proposal.storyboard);
  const handoff: ConceptHandoff = deepFreeze({
    version: HANDOFF_VERSION,
    status: "human-review-ready",
    approved: false,
    identities: {
      researchContractSha256: sha256(input.mission.research),
      missionId: input.mission.missionId,
      briefHash: brief.briefHash,
      syntheticResearch: brief.syntheticResearch,
      batch: { attempt: evaluation.attempts, batchHash: packet.batchHash },
      concept: { conceptId: proposal.concept.conceptId, conceptSha256: sha256(proposal.concept) },
      storyboardSha256: sha256(storyboard),
    },
    conceptSelection: { conceptId: proposal.concept.conceptId, selectedBy: input.selectedBy ?? null, trusted: false },
    outstandingApprovals: [...packet.outstandingApprovals],
    storyboard,
    ctaRoute: input.mission.productDestination,
    createdAt: (input.now ?? new Date()).toISOString(),
  } as ConceptHandoff);
  ISSUED.add(handoff);
  return handoff;
}

export function isConceptHandoff(value: unknown): value is ConceptHandoff {
  return typeof value === "object" && value !== null && ISSUED.has(value);
}

/**
 * The MASTER #1 report for a handed-off concept.
 *
 * The quality review is made here, about the handoff's own storyboard, and
 * bound to the verified media (or to none). It measures storyboard text and
 * timing; it does not look at frames or listen to audio.
 */
export function buildHandoffCreativeReport(input: {
  readonly handoff: ConceptHandoff;
  readonly media: VerifiedMedia | null;
  readonly recordedHumanDecisions?: Readonly<Record<string, HumanGate["decision"]>>;
  readonly now?: Date;
}): ContentCreativeReport {
  const { handoff } = input;
  if (!isConceptHandoff(handoff)) throw new ConceptHandoffError("This handoff was not issued by buildConceptHandoff; its identities cannot be trusted.");
  if (sha256(handoff.storyboard) !== handoff.identities.storyboardSha256) {
    throw new ConceptHandoffError("The handoff's storyboard no longer matches the storyboard it hashed.");
  }
  const now = input.now ?? new Date();
  const review = reviewCreativeQuality({
    creativeId: `${handoff.identities.missionId}/${handoff.identities.concept.conceptId}`,
    packageId: handoff.identities.briefHash,
    storyboard: handoff.storyboard,
    // The cues the renderer burns in, as the MASTER #6 storyboard gate measured them.
    captionCues: captionCuesForScript(handoff.storyboard),
    ctaRoute: handoff.ctaRoute,
    // Only bytes that were read and hashed can bind the review.
    mediaSha256: isVerifiedMedia(input.media) ? input.media.sha256 : null,
    now,
  });

  const additionalBlockers: string[] = [];
  if (handoff.identities.syntheticResearch) additionalBlockers.push(SYNTHETIC_RESEARCH_BLOCKER);
  if (input.media !== null) additionalBlockers.push(RENDER_PROVENANCE_GAP);

  return buildContentCreativeReport({
    review,
    fingerprint: null,
    media: input.media,
    provenance: {
      ...handoff.identities,
      handoffVersion: handoff.version,
      conceptSelection: handoff.conceptSelection,
      reviewScope: "The quality review measures the storyboard's text and timing only; it does not inspect frames or audio.",
    },
    additionalHumanGates: [
      { gate: "concept-selection", why: "A person chooses which of the three reviewed concepts to produce. A conceptId passed by a caller is not that choice." },
      ...handoff.outstandingApprovals.map((outstanding) => ({ gate: gateIdFor(outstanding), why: outstanding })),
    ],
    additionalBlockers,
    recordedHumanDecisions: input.recordedHumanDecisions,
    now,
  });
}
