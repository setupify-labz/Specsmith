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

import {
  ELEVENLABS_PROVIDER,
  FIXTURE_SOURCES,
  manifestProblems,
  type ManifestEntry,
  type SealedRenderManifest,
} from "./renderManifest.ts";

export type PublishRefusalCode =
  | "missing-manifest"
  | "malformed-manifest"
  | "fixture-artifact"
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
  /**
   * The sealed account of every artifact in the master.
   *
   * Derived from the render, not authored by the caller — see
   * renderManifest.ts for why a caller-supplied list is an honour system.
   */
  manifest: SealedRenderManifest;
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

/**
 * Decides whether a render may be published. Refuses by default.
 *
 * Returns EVERY refusal rather than the first, so one pass over a draft tells
 * a person the whole distance to publishable instead of one step of it.
 */
export function evaluatePublishGate(input: PublishGateInput): PublishVerdict {
  const refusals: PublishRefusal[] = [];
  const now = input.now ?? new Date();
  const manifest = input.manifest;

  if (manifest === undefined || manifest === null) {
    return {
      allowed: false,
      refusals: [{ code: "missing-manifest", detail: "No sealed render manifest was supplied." }],
    };
  }

  // STRUCTURE FIRST, AND NOTHING ELSE IF IT FAILS. A broken seal means the
  // list cannot be trusted to describe the render at all, so judgements drawn
  // from its entries would be judgements about a fiction.
  const structural = manifestProblems(manifest);
  if (structural.length > 0) {
    return {
      allowed: false,
      refusals: structural.map((detail) => ({ code: "malformed-manifest" as const, detail })),
    };
  }

  const entries: readonly ManifestEntry[] = manifest.entries;

  for (const entry of entries) {
    // THE DECLARED FLAG IS NOT THE LAST WORD. A sealed manifest is still
    // written by something, and resealing after flipping `isFixture: false`
    // costs an attacker nothing. Known fixture renderers and providers are
    // recognised by name regardless of what the entry claims about itself.
    const isFixture = entry.isFixture
      || FIXTURE_SOURCES.has(entry.renderer)
      || FIXTURE_SOURCES.has(entry.provider);
    if (isFixture) {
      refusals.push({
        code: "fixture-artifact",
        detail: `${entry.taskId} came from ${entry.renderer || entry.provider}, which is a fixture.`,
      });
      if (entry.role === "hook-visual") {
        refusals.push({
          code: "placeholder-hook",
          detail: `${entry.taskId} is the placeholder card standing in for the hook beat.`,
        });
      }
      if (entry.role === "music-bed") {
        refusals.push({
          code: "silent-music-bed",
          detail: `${entry.taskId} is the silent stand-in bed; a licensed track has not been chosen.`,
        });
      }
    }
  }

  // NARRATION IDENTITY: role AND the ElevenLabs provider AND the configured
  // voice id. A stand-in can satisfy at most one.
  const narration = entries.filter((entry) => entry.role === "narration");
  const liamVoiceId = input.narrationIdentity?.liamVoiceId;
  for (const entry of narration) {
    if (entry.provider !== ELEVENLABS_PROVIDER && entry.renderer !== ELEVENLABS_PROVIDER) {
      refusals.push({
        code: "narration-not-elevenlabs",
        detail: `${entry.taskId} narration came from "${entry.provider || entry.renderer}", not ${ELEVENLABS_PROVIDER}.`,
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
        detail: `${entry.taskId} was voiced with "${entry.voiceId ?? ""}", not the configured Liam voice id.`,
      });
    }
  }

  // MASTER SHA: the reviewed digest must be the digest of these exact bytes.
  if (!isNonEmptyString(input.reviewedMasterSha256)) {
    refusals.push({
      code: "master-sha-mismatch",
      detail: "No reviewed master digest was supplied, so nothing ties the review to these bytes.",
    });
  } else if (normaliseDigest(manifest.masterSha256) !== normaliseDigest(input.reviewedMasterSha256)) {
    refusals.push({
      code: "master-sha-mismatch",
      detail:
        `The review covers ${input.reviewedMasterSha256.slice(0, 16)}… but the manifest's master is `
        + `${String(manifest.masterSha256).slice(0, 16)}…. Different bytes were reviewed.`,
    });
  }

  // PAID SPEND: any non-fixture artifact from a paid provider needs approval.
  const paidProviders = new Set([ELEVENLABS_PROVIDER, "google-gemini-api"]);
  const paid = entries.filter((entry) => paidProviders.has(entry.provider) || paidProviders.has(entry.renderer));
  if (paid.length > 0) {
    for (const problem of approvalProblems("paidProviderApproval", input.paidProviderApproval, now)) {
      refusals.push({
        code: "malformed-approval",
        detail: `${paid.map((entry) => entry.taskId).join(", ")} used a paid provider but ${problem}`,
      });
    }
  }

  // INSPECTION: present, well-formed, and an approval rather than a rejection.
  if (input.inspection === undefined) {
    refusals.push({ code: "no-approval-record", detail: "No inspection record was supplied for these bytes." });
  } else {
    for (const problem of approvalProblems("inspection", input.inspection, now)) {
      refusals.push({ code: "malformed-approval", detail: problem });
    }
    if (input.inspection.approved !== true) {
      refusals.push({ code: "no-approval-record", detail: "The inspection record does not say approved: true." });
    }
  }

  if (refusals.length > 0) return { allowed: false, refusals };
  return { allowed: true, masterSha256: manifest.masterSha256 };
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
