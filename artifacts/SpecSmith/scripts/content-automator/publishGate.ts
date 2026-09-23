// The gate a publishing request cannot be built without.
//
// THE FIRST VERSION OF THIS FILE WAS A GATE NOBODY HAD TO OPEN. It exported a
// correct verdict and the real publishing path — buildMetricoolPublishingRequest
// — never called it. Every refusal it could produce was advisory. A gate that
// the production caller can skip is documentation with a test suite.
//
// It is now a required argument of `PublishingGateInput`, so a request cannot
// be constructed without supplying provenance for every artifact and having
// that provenance pass. There is no default, no optional field and no fallback
// that lets a caller opt out.
//
// PROVENANCE IS DECLARED, NEVER INFERRED. The previous version read optional
// metadata and treated absence as "fine": an artifact with no `isFixture` key
// passed the fixture check, and an audio artifact with no `voice` key passed
// the voice check by not being caught. That is backwards. Every field below is
// REQUIRED and every missing, malformed or unrecognised value is a refusal —
// an artifact whose origin cannot be established is exactly the artifact that
// should not ship.
//
// NARRATION IS IDENTIFIED, NOT NAMED. Matching a voice called "Liam" proves
// nothing: a fixture can call itself anything. Identity here is the
// conjunction of three facts — the artifact's declared ROLE, a renderer that
// is actually the ElevenLabs adapter, and the configured Liam VOICE ID. A
// stand-in can satisfy at most one.

/** What an artifact is FOR. Declared by the producer, never guessed. */
export type ArtifactRole =
  | "hook-visual"
  | "evidence-visual"
  | "narration"
  | "music-bed"
  | "captions"
  | "master";

export const ARTIFACT_ROLES: readonly ArtifactRole[] = [
  "hook-visual", "evidence-visual", "narration", "music-bed", "captions", "master",
];

/**
 * Whether a paid provider was used, and whether that spend was authorised.
 *
 * `unapproved` is the honest state for anything produced without a recorded
 * approval, including free fixtures — the point is that no money was
 * authorised, so nothing that claims to have spent it can be trusted.
 */
export type ProviderStatus = "approved-paid" | "unpaid-first-party" | "unapproved";

export const PROVIDER_STATUSES: readonly ProviderStatus[] = [
  "approved-paid", "unpaid-first-party", "unapproved",
];

/** Everything that must be true of one artifact before it may ship. */
export interface ArtifactProvenance {
  taskId: string;
  role: ArtifactRole;
  /** The adapter that produced it. Must be a real, non-fixture renderer. */
  renderer: string;
  /** Must be explicitly false. `undefined` is a refusal, not a pass. */
  isFixture: boolean;
  providerStatus: ProviderStatus;
  /** Narration only: the provider voice id actually used. */
  voiceId?: string;
  /** Master only: the sha256 of the bytes this artifact is. */
  sha256?: string;
}

export type PublishRefusalCode =
  | "missing-provenance"
  | "malformed-provenance"
  | "fixture-artifact"
  | "unapproved-provider"
  | "narration-not-elevenlabs"
  | "narration-voice-not-liam"
  | "narration-missing"
  | "silent-music-bed"
  | "placeholder-hook"
  | "master-sha-mismatch"
  | "no-approval-record"
  | "malformed-approval";

export interface PublishRefusal {
  code: PublishRefusalCode;
  detail: string;
}

export type PublishVerdict =
  | { allowed: true; masterSha256: string }
  | { allowed: false; refusals: PublishRefusal[] };

/** Renderers that are fixtures by construction, whatever they declare. */
const FIXTURE_RENDERERS = new Set([
  "offline-card-video-fixture",
  "offline-silent-bed-fixture",
  "local-espeak-tts-fixture",
]);

/** The ElevenLabs adapter's renderer name, as elevenLabsTts.ts reports it. */
export const ELEVENLABS_RENDERER = "elevenlabs-tts";

/**
 * The Liam voice id, supplied by configuration and never hardcoded.
 *
 * There is no ElevenLabs credential in this repository to validate an id
 * against, and writing a plausible-looking one into source would be an
 * invention. The caller supplies it; an absent or blank id means narration
 * identity cannot be established, which is a refusal.
 */
export interface NarrationIdentityConfig {
  /** ELEVENLABS_VOICE_ID for Liam. Blank or absent refuses every narration. */
  liamVoiceId: string;
}

/** Who approved something, and when. Both are validated, not trusted. */
export interface ApprovalRecord {
  approvedBy: string;
  /** ISO-8601. Must parse, and must not be in the future. */
  approvedAt: string;
}

export interface PublishGateInput {
  /** One entry per artifact that contributed to the master, plus the master. */
  artifacts: readonly ArtifactProvenance[];
  /** The digest a reviewer actually watched, read from the QC verdict. */
  reviewedMasterSha256: string;
  narrationIdentity: NarrationIdentityConfig;
  /** Required. Absent refuses. */
  inspection?: ApprovalRecord & { approved: boolean };
  /** Required when any artifact declares `approved-paid`. */
  paidProviderApproval?: ApprovalRecord;
  /** Clock injection for tests. */
  now?: Date;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Hex digests compare case-insensitively.
 *
 * `AAAA…` and `aaaa…` are the same bytes, and the surrounding publishing code
 * has normalised case on both sides for exactly that reason since before this
 * gate existed. Comparing raw strings here reintroduced a mismatch it had
 * already fixed — caught by its own regression test.
 */
const normaliseDigest = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

/** Validates an approval's identity and timestamp. Returns refusal details. */
export function approvalProblems(
  label: string,
  approval: ApprovalRecord | undefined,
  now: Date,
): string[] {
  if (approval === undefined) return [`${label} is absent.`];
  const problems: string[] = [];
  if (!isNonEmptyString(approval.approvedBy)) {
    problems.push(`${label}.approvedBy is empty; an approval needs an identity.`);
  }
  if (!isNonEmptyString(approval.approvedAt)) {
    problems.push(`${label}.approvedAt is empty.`);
  } else {
    const at = new Date(approval.approvedAt);
    if (Number.isNaN(at.getTime())) {
      problems.push(`${label}.approvedAt "${approval.approvedAt}" is not a valid timestamp.`);
    } else if (at.getTime() > now.getTime() + 60_000) {
      // A minute of clock skew is tolerated; an approval dated next week is
      // not an approval, it is a placeholder someone forgot to replace.
      problems.push(`${label}.approvedAt "${approval.approvedAt}" is in the future.`);
    }
  }
  return problems;
}

/** Structural validation of one provenance record. */
function provenanceProblems(entry: ArtifactProvenance, index: number): string[] {
  const where = isNonEmptyString(entry?.taskId) ? entry.taskId : `artifacts[${index}]`;
  const problems: string[] = [];
  if (!isNonEmptyString(entry?.taskId)) problems.push(`${where}: taskId is required.`);
  if (!ARTIFACT_ROLES.includes(entry?.role)) {
    problems.push(`${where}: role "${String(entry?.role)}" is not a declared artifact role.`);
  }
  if (!isNonEmptyString(entry?.renderer)) problems.push(`${where}: renderer is required.`);
  if (typeof entry?.isFixture !== "boolean") {
    problems.push(`${where}: isFixture must be explicitly true or false, not ${String(entry?.isFixture)}.`);
  }
  if (!PROVIDER_STATUSES.includes(entry?.providerStatus)) {
    problems.push(`${where}: providerStatus "${String(entry?.providerStatus)}" is not recognised.`);
  }
  if (entry?.role === "narration" && !isNonEmptyString(entry?.voiceId)) {
    problems.push(`${where}: narration must declare the voiceId it was produced with.`);
  }
  if (entry?.role === "master" && !isNonEmptyString(entry?.sha256)) {
    problems.push(`${where}: the master must declare its own sha256.`);
  }
  return problems;
}

/**
 * Decides whether a render may be published. Refuses by default.
 *
 * Returns EVERY refusal rather than the first, so one pass over a draft tells
 * a person the whole distance to publishable instead of one step of it.
 */
export function evaluatePublishGate(input: PublishGateInput): PublishVerdict {
  const refusals: PublishRefusal[] = [];
  const now = input.now ?? new Date();
  const artifacts = Array.isArray(input.artifacts) ? input.artifacts : [];

  if (artifacts.length === 0) {
    return {
      allowed: false,
      refusals: [{
        code: "missing-provenance",
        detail: "No artifact provenance was supplied. Publication needs an account of every artifact.",
      }],
    };
  }

  for (const [index, entry] of artifacts.entries()) {
    for (const problem of provenanceProblems(entry, index)) {
      refusals.push({ code: "malformed-provenance", detail: problem });
    }
  }
  // Structural problems make every judgement below unreliable, so stop here
  // rather than reporting conclusions drawn from fields that did not validate.
  if (refusals.length > 0) return { allowed: false, refusals };

  for (const entry of artifacts) {
    if (entry.isFixture || FIXTURE_RENDERERS.has(entry.renderer)) {
      refusals.push({
        code: "fixture-artifact",
        detail: `${entry.taskId} was produced by ${entry.renderer}, which is a fixture.`,
      });
    }
    if (entry.renderer === "offline-card-video-fixture" || (entry.role === "hook-visual" && entry.isFixture)) {
      refusals.push({
        code: "placeholder-hook",
        detail: `${entry.taskId} is the placeholder card standing in for the hook beat.`,
      });
    }
    if (entry.role === "music-bed" && entry.renderer.includes("silent")) {
      refusals.push({
        code: "silent-music-bed",
        detail: `${entry.taskId} is the silent stand-in bed; a licensed track has not been chosen.`,
      });
    }
    if (entry.providerStatus === "unapproved") {
      refusals.push({
        code: "unapproved-provider",
        detail: `${entry.taskId} declares providerStatus "unapproved".`,
      });
    }
    if (entry.providerStatus === "approved-paid") {
      for (const problem of approvalProblems("paidProviderApproval", input.paidProviderApproval, now)) {
        refusals.push({
          code: "malformed-approval",
          detail: `${entry.taskId} claims approved paid spend but ${problem}`,
        });
      }
    }
  }

  // NARRATION IDENTITY: role AND renderer AND configured voice id.
  const narration = artifacts.filter((entry) => entry.role === "narration");
  if (narration.length === 0) {
    refusals.push({
      code: "narration-missing",
      detail: "No artifact declares the narration role, so narration identity cannot be established.",
    });
  }
  const liamVoiceId = input.narrationIdentity?.liamVoiceId;
  for (const entry of narration) {
    if (entry.renderer !== ELEVENLABS_RENDERER) {
      refusals.push({
        code: "narration-not-elevenlabs",
        detail: `${entry.taskId} narration renderer is "${entry.renderer}", not ${ELEVENLABS_RENDERER}.`,
      });
    }
    if (!isNonEmptyString(liamVoiceId)) {
      refusals.push({
        code: "narration-voice-not-liam",
        detail:
          `${entry.taskId}: no Liam voice id is configured (ELEVENLABS_VOICE_ID), so the narration voice `
          + "cannot be verified against anything.",
      });
    } else if (entry.voiceId !== liamVoiceId) {
      refusals.push({
        code: "narration-voice-not-liam",
        detail: `${entry.taskId} was voiced with "${entry.voiceId}", not the configured Liam voice id.`,
      });
    }
  }

  // MASTER SHA: the reviewed digest must be the digest of these exact bytes.
  const masters = artifacts.filter((entry) => entry.role === "master");
  if (masters.length !== 1) {
    refusals.push({
      code: "malformed-provenance",
      detail: `Exactly one artifact must declare the master role; found ${masters.length}.`,
    });
  } else if (!isNonEmptyString(input.reviewedMasterSha256)) {
    refusals.push({
      code: "master-sha-mismatch",
      detail: "No reviewed master digest was supplied, so nothing ties the review to these bytes.",
    });
  } else if (normaliseDigest(masters[0].sha256) !== normaliseDigest(input.reviewedMasterSha256)) {
    refusals.push({
      code: "master-sha-mismatch",
      detail:
        `The review covers ${input.reviewedMasterSha256.slice(0, 16)}… but the master is `
        + `${String(masters[0].sha256).slice(0, 16)}…. Different bytes were reviewed.`,
    });
  }

  // INSPECTION: present, well-formed, and an approval rather than a rejection.
  const inspectionProblems = approvalProblems("inspection", input.inspection, now);
  if (input.inspection === undefined) {
    refusals.push({ code: "no-approval-record", detail: "No inspection record was supplied for these bytes." });
  } else {
    for (const problem of inspectionProblems) {
      refusals.push({ code: "malformed-approval", detail: problem });
    }
    if (input.inspection.approved !== true) {
      refusals.push({
        code: "no-approval-record",
        detail: "The inspection record does not say approved: true.",
      });
    }
  }

  if (refusals.length > 0) return { allowed: false, refusals };
  return { allowed: true, masterSha256: masters[0].sha256 as string };
}

/** Throws unless publication is allowed. The only safe way to call the gate. */
export function assertPublishable(input: PublishGateInput): string {
  const verdict = evaluatePublishGate(input);
  if (verdict.allowed) return verdict.masterSha256;
  throw new Error(
    `Publication refused (${verdict.refusals.length}):\n`
    + verdict.refusals.map((refusal) => `  [${refusal.code}] ${refusal.detail}`).join("\n"),
  );
}
