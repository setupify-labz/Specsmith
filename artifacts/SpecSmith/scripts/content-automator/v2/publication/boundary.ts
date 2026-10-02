// MASTER #8: the publishing boundary.
//
// This module holds the ledger authority (publishing.claimLedgerAuthority), so
// it is the only code that can write a state past `generated`, other than the
// stopping states `rejected` and `failed`. Each write it makes rests on its own
// evidence:
//
//   machine-reviewed / human-review-pending
//       a packet issued by MASTER #7's reviewCreative, revalidated against the
//       current submission and files at the moment of writing.
//   publication-authorized / human-rejected
//       a decision verified by a TRUSTED approval verifier for exactly these
//       bytes, this cut, this destination and account, and this review version.
//       No such verifier exists for production in this repository
//       (PRODUCTION_APPROVAL_VERIFIERS is empty), so production publication
//       stays closed; see MISSING_APPROVAL_CAPABILITY.
//   submission-started ... published
//       the provider's own answer, bound to an idempotency key derived from
//       the authorization. A request that was built is not a submission, an
//       attempt is not an acceptance, and an unknown answer is never retried
//       blind.
//
// A simulation store (publishingStore.initPublicationStore) runs the same code
// with labelled simulated people and providers. Nothing simulated can be
// written to a production store, and nothing real to a simulation store.

import { realpath } from "node:fs/promises";

import {
  claimLedgerAuthority,
  type PublicationEvent,
  type PublicationLedger,
  type PublicationStatus,
} from "../../publishing.ts";
import {
  advanceStoredPublicationLedger,
  bindProviderPost,
  loadStoredPublicationLedger,
  publicationStoreMode,
} from "../../publishingStore.ts";
import type { VideoPlatform } from "../../types.ts";
import { MediaVerificationError, verifyRenderedMedia } from "../mediaVerification.ts";
import { HUMAN_GATES } from "../review/humanGates.ts";
import type { ReviewSubmission } from "../review/inputs.ts";
import { isIssuedReviewPacket, revalidateReviewPacket } from "../review/reviewCreative.ts";
import type { HumanGateId, ReviewPacket } from "../review/types.ts";
import { sha256Json, sha256Text } from "../review/util.ts";

const issueReceipt = claimLedgerAuthority();

export class PublicationBoundaryError extends Error {
  constructor(readonly code: PublicationRefusalCode, message: string) {
    super(message);
    this.name = "PublicationBoundaryError";
  }
}

export type PublicationRefusalCode =
  | "no-ledger"
  | "legacy-ledger"
  | "wrong-state"
  | "packet-not-issued"
  | "packet-stale"
  | "packet-for-other-creative"
  | "review-blocked"
  | "final-approval-blocked"
  | "no-trusted-approval-mechanism"
  | "untrusted-verifier"
  | "decision-unverifiable"
  | "decision-mismatch"
  | "not-authorized"
  | "request-mismatch"
  | "media-changed"
  | "outcome-unknown"
  | "provider-mode-mismatch"
  | "provider-result-unverified";

/** Where a post goes. Approval of one destination does not authorize another. */
export interface PublicationDestination {
  readonly provider: "metricool";
  readonly accountId: string;
  readonly platform: VideoPlatform;
}

async function simulatedStore(root: string): Promise<boolean> {
  return (await publicationStoreMode(root)) === "simulation";
}

async function write(root: string, creativeId: string, event: Omit<PublicationEvent, "at"> & { at: string }): Promise<PublicationLedger> {
  const full: PublicationEvent = { ...event };
  const current = await ledgerOrRefuse(root, creativeId);
  // Issued for this event, at the next position of this ledger, in this store.
  const receipt = issueReceipt(creativeId, full, { sequence: current.events.length, storeRoot: await realpath(root) });
  return advanceStoredPublicationLedger(root, creativeId, full, receipt);
}

async function ledgerOrRefuse(root: string, creativeId: string): Promise<PublicationLedger> {
  const ledger = await loadStoredPublicationLedger(root, creativeId);
  if (!ledger) throw new PublicationBoundaryError("no-ledger", `No publication ledger exists for ${creativeId}.`);
  if (ledger.legacy) {
    throw new PublicationBoundaryError("legacy-ledger",
      `${creativeId} has a legacy ledger (qc-passed at ${ledger.legacy.since}): ${ledger.legacy.reason} Review the media with MASTER #7 as a new creative.`);
  }
  return ledger;
}

const lastStatus = (ledger: PublicationLedger): PublicationStatus => ledger.events.at(-1)!.status;
const eventOf = (ledger: PublicationLedger, status: PublicationStatus) => [...ledger.events].reverse().find((event) => event.status === status);
const str = (value: unknown) => String(value ?? "");

/** The packet and submission must still describe the same inputs, right now. */
function revalidated(packet: ReviewPacket, submission: ReviewSubmission): void {
  if (!isIssuedReviewPacket(packet)) {
    throw new PublicationBoundaryError("packet-not-issued",
      "This review packet was not issued by MASTER #7's reviewCreative (it was built by hand, copied, or read from JSON). Only a packet reviewCreative issued for these bytes counts.");
  }
  const result = revalidateReviewPacket(packet, submission);
  if (!result.valid) {
    throw new PublicationBoundaryError("packet-stale",
      `The MASTER #7 packet no longer describes this creative: ${result.reasons.join(" ")} Repeat: ${result.plan?.checksToRepeat.join(", ") ?? "the review"}.`);
  }
}

// ---------------------------------------------------------------------------
// 1. Machine review
// ---------------------------------------------------------------------------

/**
 * Record that MASTER #7 reviewed these exact bytes and this cut.
 *
 * A blocked packet records a rejection: the creative must be fixed, rendered
 * and reviewed again as a new cut. Anything else records `machine-reviewed`
 * and then `human-review-pending`, because no verdict a machine can reach is
 * an approval.
 */
export async function recordMachineReview(input: {
  readonly storeRoot: string;
  readonly packet: ReviewPacket;
  readonly submission: ReviewSubmission;
  readonly now?: Date;
}): Promise<PublicationLedger> {
  const { packet, submission, storeRoot } = input;
  revalidated(packet, submission);
  const ledger = await ledgerOrRefuse(storeRoot, packet.creativeId);
  if (ledger.platform !== submission.variant.platform) {
    throw new PublicationBoundaryError("packet-for-other-creative", `The ledger is for ${ledger.platform}; the packet reviewed a ${submission.variant.platform} cut.`);
  }
  if (lastStatus(ledger) !== "generated") {
    throw new PublicationBoundaryError("wrong-state", `${packet.creativeId} is "${lastStatus(ledger)}"; a machine review is recorded once, against a newly rendered creative.`);
  }
  const at = (input.now ?? new Date()).toISOString();
  const simulated = await simulatedStore(storeRoot);
  if (packet.verdict === "blocked") {
    return write(storeRoot, packet.creativeId, {
      status: "rejected", at, simulated: simulated || undefined,
      note: `MASTER #7 blocked this cut: ${packet.summary}`,
      evidence: { reviewPacketId: packet.packetId, mediaSha256: packet.media.sha256 ?? "unverified", blockingCodes: packet.findings.filter((entry) => entry.severity === "blocking").map((entry) => entry.code).join(",") },
    });
  }
  const finalApprovalBlockers = [...new Set(packet.findings.filter((entry) => entry.severity === "blocks-final-approval").map((entry) => entry.code))];
  await write(storeRoot, packet.creativeId, {
    status: "machine-reviewed", at, simulated: simulated || undefined,
    note: `MASTER #7 ${packet.verdict}: ${packet.summary}`,
    evidence: {
      reviewPacketId: packet.packetId,
      reviewPacketVersion: packet.version,
      reviewVerdict: packet.verdict,
      mediaSha256: packet.media.sha256 ?? "unverified",
      variantId: packet.platformVariantId,
      reviewBindingsSha256: sha256Json(packet.bindings),
      finalApprovalBlockers: finalApprovalBlockers.join(",") || "none",
    },
  });
  return write(storeRoot, packet.creativeId, {
    status: "human-review-pending", at, simulated: simulated || undefined,
    note: `${packet.humanGates.length} human gate(s) open. Not approved.`,
    evidence: { reviewPacketId: packet.packetId, openGates: packet.humanGates.map((gate) => gate.gate).join(",") },
  });
}

// ---------------------------------------------------------------------------
// 2. Trusted human decision
// ---------------------------------------------------------------------------

/** A decision as a trusted verifier established it. Only verifiers produce these. */
export interface VerifiedDecision {
  readonly decisionId: string;
  /** The authenticated identity, as the mechanism authenticated it. */
  readonly reviewerId: string;
  readonly approvalMechanism: string;
  readonly decidedAt: string;
  readonly outcome: "approved" | "rejected";
  /** Each human gate, decided. Every gate must be approved for publication. */
  readonly gates: Readonly<Partial<Record<HumanGateId, "approved" | "rejected">>>;
  readonly mediaSha256: string;
  readonly variantId: string;
  readonly destination: PublicationDestination;
  /** The exact review version decided on. */
  readonly reviewPacketId: string;
  readonly reviewBindingsSha256: string;
  readonly simulated: boolean;
}

/**
 * Turns whatever an approval mechanism produced into a VerifiedDecision, or
 * throws. A verifier authenticates the reviewer and the integrity of what they
 * approved; it is not a place to accept a name typed into JSON.
 */
export interface TrustedApprovalVerifier {
  readonly mechanism: string;
  readonly simulated: boolean;
  verify(claim: unknown, now: Date): Promise<VerifiedDecision>;
}

/**
 * Verifiers trusted for production. EMPTY: this repository has no mechanism
 * that authenticates a reviewer and binds their decision to exact media bytes,
 * cut, destination and review version. Adding one is a reviewed code change.
 */
export const PRODUCTION_APPROVAL_VERIFIERS: readonly TrustedApprovalVerifier[] = Object.freeze([]);

export const MISSING_APPROVAL_CAPABILITY =
  "No trusted approval mechanism exists for production. Required: an authenticated reviewer identity (not a typed name), " +
  "a tamper-evident decision record (signature or an authenticated service's audit log), and a decision payload that names " +
  "the media SHA-256, the platform cut, the destination provider and account, and the MASTER #7 packet id and bindings it approves. " +
  "The candidate available to this repository is a GitHub Actions environment with required reviewers, whose approvals GitHub " +
  "authenticates and records; it needs a protected environment configured by the repository owner and a workflow that binds the " +
  "approval to these fields. Until one is implemented and added to PRODUCTION_APPROVAL_VERIFIERS, production publication is closed.";

const SIMULATED_VERIFIERS = new WeakSet<TrustedApprovalVerifier>();

/**
 * A SIMULATED approval verifier, for tests and offline demonstrations in a
 * simulation store only. It authenticates nobody: every decision it returns
 * says so. A production store refuses it.
 */
export function createSimulatedApprovalVerifier(): TrustedApprovalVerifier {
  const verifier: TrustedApprovalVerifier = {
    mechanism: "SIMULATED approval (authenticates nobody; test and demo only)",
    simulated: true,
    async verify(claim) {
      const raw = claim as Partial<VerifiedDecision> & { simulatedReviewer?: string };
      if (!raw || typeof raw !== "object" || !raw.simulatedReviewer) throw new Error("A simulated decision names its simulated reviewer.");
      return {
        decisionId: str(raw.decisionId) || `simulated-${sha256Json(raw).slice(0, 12)}`,
        reviewerId: `SIMULATED:${raw.simulatedReviewer}`,
        approvalMechanism: verifier.mechanism,
        decidedAt: str(raw.decidedAt),
        outcome: raw.outcome === "rejected" ? "rejected" : "approved",
        gates: raw.gates ?? {},
        mediaSha256: str(raw.mediaSha256),
        variantId: str(raw.variantId),
        destination: raw.destination as PublicationDestination,
        reviewPacketId: str(raw.reviewPacketId),
        reviewBindingsSha256: str(raw.reviewBindingsSha256),
        simulated: true,
      };
    },
  };
  SIMULATED_VERIFIERS.add(verifier);
  return Object.freeze(verifier);
}

/** The key every provider request and response for this authorization is bound to. */
export function idempotencyKeyFor(input: {
  readonly creativeId: string; readonly variantId: string; readonly mediaSha256: string; readonly destination: PublicationDestination;
  readonly reviewPacketId: string; readonly titleSha256: string; readonly descriptionSha256: string;
}): string {
  return `specsmith-${sha256Json(input).slice(0, 40)}`;
}

/**
 * Record a human decision, if a trusted verifier establishes it.
 *
 * Refuses (and writes nothing) when the verifier is not trusted for this store,
 * the packet is not issued or is stale, the decision names other bytes, another
 * cut, another destination or another review version, or any gate is left
 * undecided. A verified rejection is written and blocks for good. An approval
 * is refused in production while the packet carries a condition that forbids
 * final approval (synthetic research, a placeholder voice, unknown rights).
 */
export async function authorizePublication(input: {
  readonly storeRoot: string;
  readonly packet: ReviewPacket;
  readonly submission: ReviewSubmission;
  readonly destination: PublicationDestination;
  readonly decisionClaim: unknown;
  readonly verifier: TrustedApprovalVerifier;
  /** Simulation only: proceed past final-approval blockers, recording each one. Ignored in production. */
  readonly simulationAcknowledgesFinalApprovalBlockers?: boolean;
  readonly now?: Date;
}): Promise<PublicationLedger> {
  const { storeRoot, packet, submission, destination, verifier } = input;
  const now = input.now ?? new Date();
  const simulated = await simulatedStore(storeRoot);

  if (simulated) {
    if (!SIMULATED_VERIFIERS.has(verifier)) throw new PublicationBoundaryError("untrusted-verifier", "A simulation store accepts only the simulated verifier, so no real decision is recorded as simulated.");
  } else if (PRODUCTION_APPROVAL_VERIFIERS.length === 0) {
    throw new PublicationBoundaryError("no-trusted-approval-mechanism", MISSING_APPROVAL_CAPABILITY);
  } else if (!PRODUCTION_APPROVAL_VERIFIERS.includes(verifier)) {
    throw new PublicationBoundaryError("untrusted-verifier", `Verifier "${verifier.mechanism}" is not a trusted production verifier.`);
  }

  revalidated(packet, submission);
  const ledger = await ledgerOrRefuse(storeRoot, packet.creativeId);
  if (lastStatus(ledger) !== "human-review-pending") {
    throw new PublicationBoundaryError("wrong-state", `${packet.creativeId} is "${lastStatus(ledger)}"; a human decision is recorded only while human review is pending.`);
  }
  const reviewed = eventOf(ledger, "machine-reviewed");
  if (reviewed?.evidence?.reviewPacketId !== packet.packetId) {
    throw new PublicationBoundaryError("packet-stale", `The ledger recorded review ${str(reviewed?.evidence?.reviewPacketId)}; this decision is about packet ${packet.packetId}. Record the new review first.`);
  }

  let decision: VerifiedDecision;
  try {
    decision = await verifier.verify(input.decisionClaim, now);
  } catch (error) {
    throw new PublicationBoundaryError("decision-unverifiable", `The approval mechanism could not verify this decision: ${(error as Error).message}`);
  }
  if (decision.simulated !== simulated) {
    throw new PublicationBoundaryError("untrusted-verifier", "A simulated decision cannot be recorded in a production store, or a real one in a simulation store.");
  }

  // The decision must be about exactly this.
  const mismatches: string[] = [];
  if (decision.mediaSha256 !== packet.media.sha256) mismatches.push(`media ${decision.mediaSha256.slice(0, 12) || "(none)"}… is not the reviewed ${str(packet.media.sha256).slice(0, 12)}…`);
  if (decision.variantId !== packet.platformVariantId) mismatches.push(`cut ${decision.variantId || "(none)"} is not ${packet.platformVariantId}`);
  if (decision.reviewPacketId !== packet.packetId) mismatches.push(`review ${decision.reviewPacketId || "(none)"} is not packet ${packet.packetId}`);
  if (decision.reviewBindingsSha256 !== sha256Json(packet.bindings)) mismatches.push("the reviewed inputs (title, description, plan, manifest...) differ from what was approved");
  if (JSON.stringify(decision.destination) !== JSON.stringify(destination)) mismatches.push(`destination ${JSON.stringify(decision.destination)} is not ${JSON.stringify(destination)}`);
  if (destination.platform !== submission.variant.platform) mismatches.push(`destination platform ${destination.platform} is not the cut's ${submission.variant.platform}`);
  const decidedAt = Date.parse(decision.decidedAt);
  if (!Number.isFinite(decidedAt) || decidedAt > now.getTime() || decidedAt < Date.parse(packet.reviewedAt)) mismatches.push("the decision time is missing, in the future, or before the review existed");
  if (!decision.reviewerId.trim()) mismatches.push("no authenticated reviewer");
  if (mismatches.length) {
    throw new PublicationBoundaryError("decision-mismatch", `The decision does not authorize this publication: ${mismatches.join("; ")}.`);
  }

  const at = now.toISOString();
  const rejectedGates = HUMAN_GATES.filter((gate) => decision.gates[gate.gate] === "rejected").map((gate) => gate.gate);
  if (decision.outcome === "rejected" || rejectedGates.length) {
    return write(storeRoot, packet.creativeId, {
      status: "human-rejected", at, simulated: simulated || undefined,
      note: `Rejected by ${decision.reviewerId}${rejectedGates.length ? ` at gate(s) ${rejectedGates.join(", ")}` : ""}.`,
      evidence: { reviewPacketId: packet.packetId, decisionId: decision.decisionId, approvalMechanism: decision.approvalMechanism, reviewerId: decision.reviewerId, rejectedGates: rejectedGates.join(",") || "all" },
    });
  }
  const undecided = HUMAN_GATES.filter((gate) => decision.gates[gate.gate] !== "approved").map((gate) => gate.gate);
  if (undecided.length) {
    throw new PublicationBoundaryError("decision-mismatch", `Every human gate must be decided; still open: ${undecided.join(", ")}.`);
  }
  if (packet.verdict === "blocked") throw new PublicationBoundaryError("review-blocked", "MASTER #7 blocked this cut.");
  const blockers = [...new Set(packet.findings.filter((entry) => entry.severity === "blocks-final-approval").map((entry) => entry.code))];
  if (blockers.length && !(simulated && input.simulationAcknowledgesFinalApprovalBlockers)) {
    throw new PublicationBoundaryError("final-approval-blocked",
      `Final approval is impossible while the packet carries: ${blockers.join(", ")}. These are not judgments a reviewer can waive (synthetic research, placeholder assets, unknown rights).`);
  }

  return write(storeRoot, packet.creativeId, {
    status: "publication-authorized", at, simulated: simulated || undefined,
    note: simulated
      ? `SIMULATED authorization by ${decision.reviewerId}.${blockers.length ? ` In production this would be refused: ${blockers.join(", ")}.` : ""}`
      : `Authorized by ${decision.reviewerId} via ${decision.approvalMechanism}.`,
    evidence: {
      reviewPacketId: packet.packetId,
      reviewBindingsSha256: decision.reviewBindingsSha256,
      mediaSha256: decision.mediaSha256,
      variantId: decision.variantId,
      destinationProvider: destination.provider,
      destinationAccount: destination.accountId,
      destinationPlatform: destination.platform,
      decisionId: decision.decisionId,
      reviewerId: decision.reviewerId,
      approvalMechanism: decision.approvalMechanism,
      decidedAt: decision.decidedAt,
      titleSha256: packet.bindings.title,
      descriptionSha256: packet.bindings.description,
      ctaDestinationSha256: packet.bindings.ctaDestination,
      idempotencyKey: idempotencyKeyFor({
        creativeId: packet.creativeId, variantId: packet.platformVariantId, mediaSha256: decision.mediaSha256, destination,
        reviewPacketId: packet.packetId, titleSha256: packet.bindings.title, descriptionSha256: packet.bindings.description,
      }),
      finalApprovalBlockersOverriddenInSimulation: simulated ? blockers.join(",") || "none" : "none",
    },
  });
}

/** What a publication-authorized event established. */
export interface AuthorizedPublication {
  readonly creativeId: string;
  readonly platform: VideoPlatform;
  readonly mediaSha256: string;
  readonly variantId: string;
  readonly destination: PublicationDestination;
  readonly reviewPacketId: string;
  readonly titleSha256: string;
  readonly descriptionSha256: string;
  readonly idempotencyKey: string;
  readonly simulated: boolean;
}

export async function loadAuthorization(storeRoot: string, creativeId: string): Promise<AuthorizedPublication | null> {
  const ledger = await loadStoredPublicationLedger(storeRoot, creativeId);
  const event = ledger ? eventOf(ledger, "publication-authorized") : undefined;
  if (!ledger || !event?.evidence) return null;
  const e = event.evidence;
  return {
    creativeId,
    platform: ledger.platform,
    mediaSha256: str(e.mediaSha256),
    variantId: str(e.variantId),
    destination: { provider: str(e.destinationProvider) as "metricool", accountId: str(e.destinationAccount), platform: str(e.destinationPlatform) as VideoPlatform },
    reviewPacketId: str(e.reviewPacketId),
    titleSha256: str(e.titleSha256),
    descriptionSha256: str(e.descriptionSha256),
    idempotencyKey: str(e.idempotencyKey),
    simulated: event.simulated === true,
  };
}

// ---------------------------------------------------------------------------
// 3. Provider requests and answers
// ---------------------------------------------------------------------------

/** What is sent to a provider. Built here, sent only by submitAuthorizedPublication. */
export interface ProviderPublicationRequest {
  readonly version: "provider-publication-request-v1";
  readonly idempotencyKey: string;
  readonly creativeId: string;
  readonly platform: VideoPlatform;
  readonly variantId: string;
  readonly mediaSha256: string;
  /** An https URL the provider fetches the approved bytes from. */
  readonly mediaUrl: string;
  readonly destination: PublicationDestination;
  /** The reviewed title and description, verbatim. */
  readonly title: string;
  readonly description: string;
  /** Always a draft: going live is a separate, human act in the provider. */
  readonly mode: "draft";
  readonly schedule: { readonly localDateTime: string; readonly timezone: string } | null;
  readonly requestSha256: string;
}

/**
 * Build the request for an authorized creative. Pure: constructing a request
 * sends nothing and changes no state.
 */
export function buildProviderRequest(input: {
  readonly authorization: AuthorizedPublication;
  readonly submission: ReviewSubmission;
  readonly mediaUrl: string;
  readonly schedule?: { readonly localDateTime: string; readonly timezone: string } | null;
}): ProviderPublicationRequest {
  const { authorization, submission } = input;
  if (sha256Text(submission.title) !== authorization.titleSha256 || sha256Text(submission.description) !== authorization.descriptionSha256) {
    throw new PublicationBoundaryError("request-mismatch", "The title or description differs from the one reviewed and authorized; a revised text needs a new review and a new decision.");
  }
  if (submission.creativeId !== authorization.creativeId || submission.variant.variantId !== authorization.variantId) {
    throw new PublicationBoundaryError("request-mismatch", "The submission is for another creative or cut than the authorization.");
  }
  let url: URL;
  try { url = new URL(input.mediaUrl); } catch { throw new PublicationBoundaryError("request-mismatch", "mediaUrl must be an absolute https URL."); }
  if (url.protocol !== "https:") throw new PublicationBoundaryError("request-mismatch", "mediaUrl must use https.");
  const body = {
    version: "provider-publication-request-v1" as const,
    idempotencyKey: authorization.idempotencyKey,
    creativeId: authorization.creativeId,
    platform: authorization.platform,
    variantId: authorization.variantId,
    mediaSha256: authorization.mediaSha256,
    mediaUrl: url.toString(),
    destination: authorization.destination,
    title: submission.title,
    description: submission.description,
    mode: "draft" as const,
    schedule: input.schedule ?? null,
  };
  return { ...body, requestSha256: sha256Json(body) };
}

/** What a provider adapter reports back from a submission. */
export type ProviderSubmitOutcome =
  | { readonly kind: "draft-accepted"; readonly providerPostId: string; readonly echoedIdempotencyKey?: string }
  | { readonly kind: "schedule-accepted"; readonly providerPostId: string; readonly scheduledFor: string; readonly echoedIdempotencyKey?: string }
  | { readonly kind: "published"; readonly providerPostId: string; readonly providerUrl?: string; readonly echoedIdempotencyKey?: string }
  /** Definite: the provider refused and created nothing. */
  | { readonly kind: "rejected"; readonly reason: string }
  /** No reliable answer: a post may or may not exist. */
  | { readonly kind: "unknown"; readonly reason: string };

/** What a provider says when asked about a post. */
export type ProviderLookup =
  | { readonly kind: "found"; readonly state: "draft" | "scheduled" | "published"; readonly providerPostId: string;
      readonly providerUrl?: string; readonly scheduledFor?: string; readonly idempotencyKey?: string; readonly mediaSha256?: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unsupported"; readonly reason: string }
  | { readonly kind: "unknown"; readonly reason: string };

export interface PublicationProvider {
  readonly providerId: "metricool";
  /** True for fakes. A simulated provider is refused by a production store, and a real one by a simulation store. */
  readonly simulated: boolean;
  submit(request: ProviderPublicationRequest): Promise<ProviderSubmitOutcome>;
  lookupByIdempotencyKey(idempotencyKey: string): Promise<ProviderLookup>;
  lookupPost(providerPostId: string): Promise<ProviderLookup>;
}

async function providerMatchesStore(storeRoot: string, provider: PublicationProvider): Promise<boolean> {
  const simulated = await simulatedStore(storeRoot);
  if (provider.simulated !== simulated) {
    throw new PublicationBoundaryError("provider-mode-mismatch", provider.simulated
      ? "A simulated provider cannot act on a production store."
      : "A real provider cannot act on a simulation store: a demonstration must never reach a real account.");
  }
  return simulated;
}

export type SubmissionReport =
  | { readonly kind: "already-accepted"; readonly status: PublicationStatus; readonly providerPostId: string; readonly ledger: PublicationLedger }
  | { readonly kind: "accepted"; readonly status: "draft-submitted" | "scheduled" | "published"; readonly providerPostId: string; readonly ledger: PublicationLedger }
  | { readonly kind: "rejected"; readonly reason: string; readonly ledger: PublicationLedger }
  | { readonly kind: "unknown"; readonly reason: string; readonly ledger: PublicationLedger };

const ACCEPTED_STATES: readonly PublicationStatus[] = ["draft-submitted", "scheduled", "published", "analytics-partial", "analytics-complete"];

/**
 * Send an authorized creative to the provider, once.
 *
 * Records `submission-started` before the call, so a crash or timeout after
 * sending is visible. A provider answer advances the ledger only when it names
 * a post (and echoes the idempotency key when it echoes one). Retrying is
 * allowed after a definite refusal; after an unknown answer it is refused until
 * reconcileSubmission has asked the provider what happened. A creative already
 * accepted returns its existing post without another call.
 */
export async function submitAuthorizedPublication(input: {
  readonly storeRoot: string;
  readonly request: ProviderPublicationRequest;
  readonly mediaPath: string;
  readonly provider: PublicationProvider;
  readonly now?: Date;
}): Promise<SubmissionReport> {
  const { storeRoot, request, provider } = input;
  const now = input.now ?? new Date();
  const simulated = await providerMatchesStore(storeRoot, provider);
  const ledger = await ledgerOrRefuse(storeRoot, request.creativeId);
  const status = lastStatus(ledger);

  const accepted = ledger.events.find((event) => ACCEPTED_STATES.includes(event.status) && event.providerPostId);
  if (accepted) return { kind: "already-accepted", status, providerPostId: accepted.providerPostId!, ledger };
  if (status === "submission-started" || status === "submission-unknown") {
    throw new PublicationBoundaryError("outcome-unknown",
      `The last submission of ${request.creativeId} has no reliable outcome. Ask the provider first (reconcileSubmission); resending could create a duplicate post.`);
  }
  if (status !== "publication-authorized" && status !== "submission-failed") {
    throw new PublicationBoundaryError("not-authorized", `${request.creativeId} is "${status}"; only an authorized creative can be submitted.`);
  }

  const authorization = await loadAuthorization(storeRoot, request.creativeId);
  if (!authorization) throw new PublicationBoundaryError("not-authorized", `${request.creativeId} has no publication authorization.`);
  const { requestSha256, ...body } = request;
  const problems: string[] = [];
  if (sha256Json(body) !== requestSha256) problems.push("the request was altered after it was built");
  if (request.idempotencyKey !== authorization.idempotencyKey) problems.push("its idempotency key is not the authorization's");
  if (request.mediaSha256 !== authorization.mediaSha256) problems.push("it names other media");
  if (request.variantId !== authorization.variantId) problems.push("it is for another cut");
  if (JSON.stringify(request.destination) !== JSON.stringify(authorization.destination)) problems.push("it goes to another destination or account");
  if (sha256Text(request.title) !== authorization.titleSha256 || sha256Text(request.description) !== authorization.descriptionSha256) problems.push("its title or description is not the authorized text");
  if (request.mode !== "draft") problems.push("only drafts are sent");
  if (problems.length) throw new PublicationBoundaryError("request-mismatch", `Refusing to send: ${problems.join("; ")}.`);
  try {
    const media = verifyRenderedMedia(input.mediaPath, now);
    if (media.sha256 !== authorization.mediaSha256) {
      throw new PublicationBoundaryError("media-changed", `The file at ${input.mediaPath} is not the authorized media (${media.sha256.slice(0, 12)}… vs ${authorization.mediaSha256.slice(0, 12)}…).`);
    }
  } catch (error) {
    if (error instanceof MediaVerificationError) throw new PublicationBoundaryError("media-changed", error.message);
    throw error;
  }

  const attempt = ledger.events.filter((event) => event.status === "submission-started").length + 1;
  const tag = simulated || undefined;
  await write(storeRoot, request.creativeId, {
    status: "submission-started", at: now.toISOString(), simulated: tag,
    note: `${simulated ? "SIMULATED " : ""}draft submission ${attempt} to ${provider.providerId}.`,
    evidence: { idempotencyKey: request.idempotencyKey, requestSha256: request.requestSha256, attempt, provider: provider.providerId, account: request.destination.accountId },
  });

  let outcome: ProviderSubmitOutcome;
  try {
    outcome = await provider.submit(request);
  } catch (error) {
    outcome = { kind: "unknown", reason: `No answer from the provider: ${(error as Error).message}` };
  }
  return recordOutcome(storeRoot, request.creativeId, request.idempotencyKey, outcome, "provider-response", simulated, now);
}

/** Map a provider answer to the state it proves, and write it. */
async function recordOutcome(storeRoot: string, creativeId: string, idempotencyKey: string, outcome: ProviderSubmitOutcome,
  confirmedBy: "provider-response" | "provider-lookup", simulated: boolean, now: Date): Promise<SubmissionReport> {
  const at = now.toISOString();
  const tag = simulated || undefined;
  const label = simulated ? "SIMULATED provider: " : "";
  if (outcome.kind === "rejected") {
    const ledger = await write(storeRoot, creativeId, { status: "submission-failed", at, simulated: tag, note: `${label}${outcome.reason}`, evidence: { idempotencyKey, reason: outcome.reason } });
    return { kind: "rejected", reason: outcome.reason, ledger };
  }
  const id = outcome.kind === "unknown" ? "" : outcome.providerPostId?.trim() ?? "";
  const echoed = outcome.kind === "unknown" ? undefined : outcome.echoedIdempotencyKey;
  if (outcome.kind === "unknown" || !id || (echoed !== undefined && echoed !== idempotencyKey)) {
    // A success without a post id, or one that answers another request, is a
    // partial answer: a post may exist. It is recorded as unknown, not success.
    const reason = outcome.kind === "unknown" ? outcome.reason
      : !id ? "The provider reported success but named no post." : `The provider answered request ${echoed}, not ${idempotencyKey}.`;
    const ledger = await write(storeRoot, creativeId, { status: "submission-unknown", at, simulated: tag, note: `${label}${reason}`, evidence: { idempotencyKey, reason } });
    return { kind: "unknown", reason, ledger };
  }
  await bindProviderPost(storeRoot, "metricool", id, creativeId);
  const status = outcome.kind === "draft-accepted" ? "draft-submitted" : outcome.kind === "schedule-accepted" ? "scheduled" : "published";
  const ledger = await write(storeRoot, creativeId, {
    status, at, simulated: tag, providerPostId: id,
    ...(outcome.kind === "published" && outcome.providerUrl ? { providerUrl: outcome.providerUrl } : {}),
    note: `${label}${status} confirmed by ${confirmedBy}.`,
    evidence: { idempotencyKey, confirmedBy, ...(outcome.kind === "schedule-accepted" ? { scheduledFor: outcome.scheduledFor } : {}) },
  });
  return { kind: "accepted", status, providerPostId: id, ledger };
}

function outcomeFromLookup(lookup: ProviderLookup & { kind: "found" }): ProviderSubmitOutcome {
  if (lookup.state === "draft") return { kind: "draft-accepted", providerPostId: lookup.providerPostId, echoedIdempotencyKey: lookup.idempotencyKey };
  if (lookup.state === "scheduled") return { kind: "schedule-accepted", providerPostId: lookup.providerPostId, scheduledFor: lookup.scheduledFor ?? "unknown", echoedIdempotencyKey: lookup.idempotencyKey };
  return { kind: "published", providerPostId: lookup.providerPostId, providerUrl: lookup.providerUrl, echoedIdempotencyKey: lookup.idempotencyKey };
}

/**
 * Resolve a submission whose outcome is unknown by asking the provider, by
 * idempotency key. Writes nothing when the provider cannot say.
 */
export async function reconcileSubmission(input: {
  readonly storeRoot: string;
  readonly creativeId: string;
  readonly provider: PublicationProvider;
  readonly now?: Date;
}): Promise<{ resolved: boolean; reason: string; report?: SubmissionReport }> {
  const simulated = await providerMatchesStore(input.storeRoot, input.provider);
  const ledger = await ledgerOrRefuse(input.storeRoot, input.creativeId);
  const status = lastStatus(ledger);
  if (status !== "submission-unknown" && status !== "submission-started") {
    return { resolved: false, reason: `Nothing to reconcile: ${input.creativeId} is "${status}".` };
  }
  const key = str(eventOf(ledger, "submission-started")?.evidence?.idempotencyKey);
  const lookup = await input.provider.lookupByIdempotencyKey(key);
  const now = input.now ?? new Date();
  if (lookup.kind === "found") {
    if (lookup.idempotencyKey !== undefined && lookup.idempotencyKey !== key) {
      return { resolved: false, reason: "The provider returned a post for another request." };
    }
    return { resolved: true, reason: `The provider holds post ${lookup.providerPostId} (${lookup.state}).`, report: await recordOutcome(input.storeRoot, input.creativeId, key, outcomeFromLookup(lookup), "provider-lookup", simulated, now) };
  }
  if (lookup.kind === "absent") {
    return { resolved: true, reason: "The provider confirms no post exists for this request; a retry is safe.",
      report: await recordOutcome(input.storeRoot, input.creativeId, key, { kind: "rejected", reason: "Provider confirms no post exists for this idempotency key." }, "provider-lookup", simulated, now) };
  }
  return { resolved: false, reason: `The provider cannot say (${lookup.kind}: ${lookup.reason}). The outcome stays unknown and the creative may not be resent; check the provider's dashboard by hand.` };
}

/** Ask the provider whether a draft or schedule has since been published, and record only what it confirms. */
export async function confirmProviderState(input: {
  readonly storeRoot: string;
  readonly creativeId: string;
  readonly provider: PublicationProvider;
  readonly now?: Date;
}): Promise<{ changed: boolean; ledger: PublicationLedger; reason: string }> {
  const simulated = await providerMatchesStore(input.storeRoot, input.provider);
  const ledger = await ledgerOrRefuse(input.storeRoot, input.creativeId);
  const status = lastStatus(ledger);
  if (status !== "draft-submitted" && status !== "scheduled") return { changed: false, ledger, reason: `Nothing to confirm: ${status}.` };
  const current = ledger.events.at(-1)!;
  const lookup = await input.provider.lookupPost(current.providerPostId!);
  if (lookup.kind !== "found") return { changed: false, ledger, reason: `The provider did not confirm a change (${lookup.kind}).` };
  if (lookup.providerPostId !== current.providerPostId) return { changed: false, ledger, reason: "The provider answered about another post." };
  const order = { draft: 0, scheduled: 1, published: 2 } as const;
  const was = status === "draft-submitted" ? 0 : 1;
  if (order[lookup.state] <= was) return { changed: false, ledger, reason: `Still ${lookup.state}.` };
  const key = str(eventOf(ledger, "submission-started")?.evidence?.idempotencyKey);
  const report = await recordOutcome(input.storeRoot, input.creativeId, key, outcomeFromLookup({ ...lookup, idempotencyKey: undefined }), "provider-lookup", simulated, input.now ?? new Date());
  return { changed: true, ledger: report.ledger, reason: `The provider confirms ${lookup.state}.` };
}

/**
 * Record a result a person reports from outside SpecSmith (for example after
 * releasing a handoff through a connector), only once the provider itself
 * confirms it. A typed post id is a claim; the provider's answer is the fact.
 */
export async function recordReportedProviderResult(input: {
  readonly storeRoot: string;
  readonly creativeId: string;
  readonly reportedProviderPostId: string;
  readonly provider: PublicationProvider | null;
  readonly now?: Date;
}): Promise<SubmissionReport> {
  if (!input.provider) {
    throw new PublicationBoundaryError("provider-result-unverified",
      `A reported post id (${input.reportedProviderPostId}) cannot be recorded without asking the provider; no provider lookup is available in this environment.`);
  }
  const simulated = await providerMatchesStore(input.storeRoot, input.provider);
  const ledger = await ledgerOrRefuse(input.storeRoot, input.creativeId);
  const status = lastStatus(ledger);
  if (status !== "submission-started" && status !== "submission-unknown") {
    throw new PublicationBoundaryError("wrong-state", `${input.creativeId} is "${status}"; a reported result answers a submission in progress.`);
  }
  const lookup = await input.provider.lookupPost(input.reportedProviderPostId);
  if (lookup.kind !== "found" || lookup.providerPostId !== input.reportedProviderPostId) {
    throw new PublicationBoundaryError("provider-result-unverified", `The provider does not confirm post ${input.reportedProviderPostId} (${lookup.kind}).`);
  }
  const authorization = await loadAuthorization(input.storeRoot, input.creativeId);
  if (lookup.mediaSha256 !== undefined && lookup.mediaSha256 !== authorization?.mediaSha256) {
    throw new PublicationBoundaryError("provider-result-unverified", "The provider's post carries other media than the authorized bytes.");
  }
  const key = str(eventOf(ledger, "submission-started")?.evidence?.idempotencyKey);
  return recordOutcome(input.storeRoot, input.creativeId, key, outcomeFromLookup({ ...lookup, idempotencyKey: undefined }), "provider-lookup", simulated, input.now ?? new Date());
}

/**
 * Hand an authorized creative to a person to release by hand (the connector
 * route). Records `submission-started` with the channel, so the ledger says a
 * release is in a person's hands, not that a post exists. The idempotency key
 * is the authorization's.
 */
export async function recordHandoffSubmission(input: {
  readonly storeRoot: string;
  readonly creativeId: string;
  readonly requestSha256: string;
  readonly manifestSha256: string;
  readonly now?: Date;
}): Promise<PublicationLedger> {
  const ledger = await ledgerOrRefuse(input.storeRoot, input.creativeId);
  const status = lastStatus(ledger);
  if (status !== "publication-authorized" && status !== "submission-failed") {
    throw new PublicationBoundaryError("not-authorized", `${input.creativeId} is "${status}"; only an authorized creative can be handed off for release.`);
  }
  const authorization = await loadAuthorization(input.storeRoot, input.creativeId);
  if (!authorization) throw new PublicationBoundaryError("not-authorized", `${input.creativeId} has no publication authorization.`);
  const simulated = await simulatedStore(input.storeRoot);
  return write(input.storeRoot, input.creativeId, {
    status: "submission-started", at: (input.now ?? new Date()).toISOString(), simulated: simulated || undefined,
    note: "Handed to a person to release through the provider. No post exists until the provider confirms one.",
    evidence: {
      idempotencyKey: authorization.idempotencyKey, requestSha256: input.requestSha256, manifestSha256: input.manifestSha256,
      attempt: ledger.events.filter((event) => event.status === "submission-started").length + 1, channel: "human-handoff",
    },
  });
}

/**
 * A person reports that a release they made by hand failed. Their report is
 * recorded as an unknown outcome, not a failure: only the provider can say no
 * post exists, so a retry stays blocked until reconcileSubmission asks it.
 */
export async function recordReportedFailure(input: {
  readonly storeRoot: string;
  readonly creativeId: string;
  readonly reason: string;
  readonly now?: Date;
}): Promise<PublicationLedger> {
  const ledger = await ledgerOrRefuse(input.storeRoot, input.creativeId);
  const status = lastStatus(ledger);
  if (status !== "submission-started") {
    throw new PublicationBoundaryError("wrong-state", `${input.creativeId} is "${status}"; a reported failure answers a release in progress.`);
  }
  const simulated = await simulatedStore(input.storeRoot);
  return write(input.storeRoot, input.creativeId, {
    status: "submission-unknown", at: (input.now ?? new Date()).toISOString(), simulated: simulated || undefined,
    note: `A person reported a failure: ${input.reason} Unconfirmed by the provider.`,
    evidence: { idempotencyKey: str(eventOf(ledger, "submission-started")?.evidence?.idempotencyKey), reason: `reported by a person, unconfirmed: ${input.reason}` },
  });
}

/**
 * SIMULATION STORES ONLY. Seed a ledger to a later state for tests whose
 * subject comes after publication (analytics, reports), without running a
 * review, a decision or a provider. Every event says it was seeded, and a
 * production store refuses this outright.
 */
export async function seedSimulatedLedger(input: {
  readonly storeRoot: string;
  readonly creativeId: string;
  readonly through: "publication-authorized" | "submission-started" | "draft-submitted" | "scheduled" | "published";
  readonly mediaSha256: string;
  readonly variantId: string;
  readonly destination: PublicationDestination;
  readonly title: string;
  readonly description: string;
  readonly providerPostId?: string;
  readonly providerUrl?: string;
  readonly at?: Date;
}): Promise<PublicationLedger> {
  if (!(await simulatedStore(input.storeRoot))) {
    throw new PublicationBoundaryError("provider-mode-mismatch", "seedSimulatedLedger works only in a simulation store; production ledgers are written by the real boundary.");
  }
  const at = (input.at ?? new Date()).toISOString();
  const seeded = "SEEDED SIMULATION: no review, decision or provider was involved.";
  const reviewPacketId = `SEEDED-${input.creativeId}`;
  const idempotencyKey = idempotencyKeyFor({
    creativeId: input.creativeId, variantId: input.variantId, mediaSha256: input.mediaSha256, destination: input.destination,
    reviewPacketId, titleSha256: sha256Text(input.title), descriptionSha256: sha256Text(input.description),
  });
  const steps: (Omit<PublicationEvent, "at"> & { at: string })[] = [
    { status: "machine-reviewed", at, simulated: true, note: seeded, evidence: { reviewPacketId, reviewPacketVersion: "seeded", reviewVerdict: "seeded", mediaSha256: input.mediaSha256, variantId: input.variantId, reviewBindingsSha256: "seeded" } },
    { status: "human-review-pending", at, simulated: true, note: seeded, evidence: { reviewPacketId } },
    { status: "publication-authorized", at, simulated: true, note: seeded, evidence: {
      reviewPacketId, reviewBindingsSha256: "seeded", mediaSha256: input.mediaSha256, variantId: input.variantId,
      destinationProvider: input.destination.provider, destinationAccount: input.destination.accountId, destinationPlatform: input.destination.platform,
      decisionId: "seeded", reviewerId: "SEEDED", approvalMechanism: "seeded simulation", decidedAt: at,
      titleSha256: sha256Text(input.title), descriptionSha256: sha256Text(input.description), idempotencyKey,
    } },
  ];
  const order = ["publication-authorized", "submission-started", "draft-submitted", "scheduled", "published"];
  const reach = order.indexOf(input.through);
  if (reach >= 1) steps.push({ status: "submission-started", at, simulated: true, note: seeded, evidence: { idempotencyKey, requestSha256: "seeded", attempt: 1 } });
  const post = input.providerPostId ?? `SIM-SEEDED-${input.creativeId}`;
  if (reach >= 2) steps.push({ status: "draft-submitted", at, simulated: true, note: seeded, providerPostId: post, evidence: { idempotencyKey, confirmedBy: "seeded" } });
  if (reach >= 3) steps.push({ status: "scheduled", at, simulated: true, note: seeded, providerPostId: post, evidence: { idempotencyKey, confirmedBy: "seeded", scheduledFor: at } });
  if (reach >= 4) steps.push({ status: "published", at, simulated: true, note: seeded, providerPostId: post, ...(input.providerUrl ? { providerUrl: input.providerUrl } : {}), evidence: { idempotencyKey, confirmedBy: "seeded" } });
  let ledger = await ledgerOrRefuse(input.storeRoot, input.creativeId);
  for (const step of steps) ledger = await write(input.storeRoot, input.creativeId, step);
  if (reach >= 2) await bindProviderPost(input.storeRoot, "metricool", post, input.creativeId);
  return ledger;
}

// ---------------------------------------------------------------------------
// 4. Metrics observed (written by observations.ts through this door)
// ---------------------------------------------------------------------------

/** Record that metrics were observed after publication. Only after a confirmed publication. */
export async function recordMetricsObserved(input: {
  readonly storeRoot: string;
  readonly creativeId: string;
  readonly observationIds: readonly string[];
  readonly complete: boolean;
  readonly now?: Date;
}): Promise<PublicationLedger> {
  const ledger = await ledgerOrRefuse(input.storeRoot, input.creativeId);
  const status = lastStatus(ledger);
  if (status !== "published" && status !== "analytics-partial") {
    throw new PublicationBoundaryError("wrong-state", `${input.creativeId} is "${status}"; metrics are recorded only after a provider-confirmed publication.`);
  }
  const simulated = await simulatedStore(input.storeRoot);
  return write(input.storeRoot, input.creativeId, {
    status: input.complete ? "analytics-complete" : "analytics-partial",
    at: (input.now ?? new Date()).toISOString(), simulated: simulated || undefined,
    evidence: { observationIds: input.observationIds.join(",") },
  });
}
