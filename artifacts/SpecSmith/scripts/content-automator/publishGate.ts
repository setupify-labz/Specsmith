// The gate a publishing request cannot be built without.
//
// It is a required step of `buildMetricoolPublishingRequest`: there is no
// default, no optional field and no fallback that lets a caller opt out.
// Every missing, malformed or unverifiable value is a refusal.
//
// ---------------------------------------------------------------------------
// TRUST MODEL — what this boundary enforces, and what it does not.
//
// This is an IN-PROCESS RUNTIME INVARIANT, NOT A CRYPTOGRAPHIC ONE. Nothing
// here is signed. The SHA-256 digests identify bytes; they do not
// authenticate who produced them.
//
// ENFORCED, against a caller using this module's public API in the same
// Node process that ran the render:
//
//  1. Provenance comes only from the compositor. The only accepted account of
//     a master is a `RenderReceipt` issued by createMotionCompositorAdapter
//     (motionCompositor.ts) from the files it actually opened. Receipts are
//     registered in a module-private WeakSet and deep-frozen; no exported
//     function creates, registers or edits one. A hand-built, spread, cloned
//     or JSON-round-tripped receipt is refused as untrusted, so clean-looking
//     entries cannot be substituted and "resealed".
//  2. The receipt records every consumed input: role (from compositorState,
//     not guessed), realpath, SHA-256 of the bytes (hashed before ffmpeg ran
//     and re-hashed after; a change mid-render aborts the receipt), timeline
//     slots, sequence frames, and the master's SHA-256.
//  3. At this boundary the master, every input and every sequence frame are
//     re-hashed from disk. A missing file, a changed byte or a swapped symlink
//     refuses.
//  4. The dependency record — an untrusted, persisted claim of what the
//     master contains — must name this receipt and master, and must match the
//     receipt's inputs exactly: no extra claimed file, no omitted consumed
//     file, no duplicated role, no edited path or digest.
//  5. QC, rights evidence, human inspection and paid-spend approval must each
//     be bound to BOTH the exact master digest and the exact receipt digest,
//     so a sign-off for a previous render or a previous receipt is stale.
//  6. Narration is accepted only with evidence the ElevenLabs adapter issued
//     in its own private registry for that exact artifact object: a request
//     to the official origin, made with the load-time global fetch (not an
//     injected transport), whose response bytes hash to the consumed file,
//     voiced with the configured Liam id. Captions likewise need evidence
//     from the caption adapter. Metadata labels such as
//     `provider: "elevenlabs"` grant nothing.
//  7. Fixture sources, a silent bed and a placeholder hook are refused.
//  8. The media Metricool will fetch must be a HostedMaster issued by
//     hostedMaster.ts: the verified local master, uploaded under a
//     content-addressed name, downloaded back and matched byte for byte,
//     bound to this receipt. The builder downloads it again just before
//     constructing the request.
//
// NOT ENFORCED — real limits, not caveats:
//
//  a. Visual and music-bed provenance is still SELF-DECLARED metadata. No
//     adapter issues evidence for them yet; they are refused when they name
//     a fixture source, but a clean label is not proof. (Their rights are
//     covered by the asset-rights bundle, which is not yet hash-bound to
//     individual receipt inputs.) ElevenLabs evidence proves this adapter
//     received those bytes from the official origin over the load-time
//     fetch; it does not verify a provider signature, because ElevenLabs
//     responses carry none. Code that replaces `globalThis.fetch` before the
//     adapter module first loads can therefore forge it.
//  b. Receipts do not survive the process. There is no persisted, signed
//     receipt, so render and publish must happen in the same process. A
//     cross-process design needs a signing key held outside this repository.
//  c. Code that can edit this module's source, monkeypatch Node built-ins
//     (fs, crypto) or reach module-private state is outside the model.
//  d. A host that serves Metricool different bytes than it serves this
//     process, or changes them after the builder's final re-download, is
//     not detectable here. Use immutable, content-addressed storage.
//  e. Sign-off records (QC, rights, inspection) are data. Their digest
//     binding is checked; the identity of whoever produced them is not
//     authenticated. Until it is tied to a trusted workflow or external
//     identity, the builder refuses `autoPublish` outright: every request is
//     a Metricool draft that a person must promote.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";

import { isVerifiedHostedMaster, type HostedMaster } from "./hostedMaster.ts";
import { isIssuedRenderReceipt, type RenderReceipt } from "./motionCompositor.ts";
import {
  ELEVENLABS_PROVIDER,
  FIXTURE_SOURCES,
  RECEIPT_ROLES,
  REQUIRED_ROLE_COUNTS,
  type DependencyRecord,
} from "./renderManifest.ts";

export type PublishRefusalCode =
  | "untrusted-receipt"
  | "missing-file"
  | "master-changed"
  | "input-changed"
  | "missing-role"
  | "duplicate-role"
  | "malformed-dependency-record"
  | "dependency-record-mismatch"
  | "extra-claimed-dependency"
  | "omitted-dependency"
  | "unsupported-provenance"
  | "fixture-artifact"
  | "narration-not-elevenlabs"
  | "narration-voice-not-liam"
  | "silent-music-bed"
  | "placeholder-hook"
  | "stale-approval"
  | "hosted-master-unverified"
  | "hosted-master-mismatch"
  | "no-approval-record"
  | "malformed-approval";

export interface PublishRefusal {
  code: PublishRefusalCode;
  detail: string;
}

export type PublishVerdict =
  | { allowed: true; masterSha256: string; receiptDigest: string }
  | { allowed: false; refusals: PublishRefusal[] };

/**
 * The Liam voice id, supplied by configuration and never hardcoded. An absent
 * or blank id means narration identity cannot be established: a refusal.
 */
export interface NarrationIdentityConfig {
  /** ELEVENLABS_VOICE_ID for Liam. Blank or absent refuses every narration. */
  liamVoiceId: string;
}

/** The exact bytes and the exact receipt a sign-off covers. Both are required. */
export interface DigestBinding {
  masterSha256: string;
  receiptDigest: string;
}

/** Who approved something, and when. Both are validated, not trusted. */
export interface ApprovalRecord {
  approvedBy: string;
  /** ISO-8601. Must parse, and must not be in the future. */
  approvedAt: string;
}

export type BoundApproval = ApprovalRecord & DigestBinding;

export interface PublishGateInput {
  /** Must be a receipt the compositor issued. Anything else is refused. */
  receipt: RenderReceipt;
  /** The persisted claim of the master's inputs, reconciled against the receipt. */
  dependencyRecord: DependencyRecord;
  /** The verified hosted copy Metricool will fetch. Only uploadAndVerifyMaster makes one. */
  hostedMaster: HostedMaster;
  /** What QC reviewed. */
  qualityReview: DigestBinding;
  /** What the rights evidence cleared. */
  rightsEvidence: DigestBinding;
  narrationIdentity: NarrationIdentityConfig;
  /** Required. Absent refuses. */
  inspection?: BoundApproval & { approved: boolean };
  /** Required when any input came from a paid provider. */
  paidProviderApproval?: BoundApproval;
  /** Clock injection for tests. */
  now?: Date;
}

const PAID_PROVIDERS = new Set([ELEVENLABS_PROVIDER, "google-gemini-api"]);
const HEX_DIGEST = /^[0-9a-f]{64}$/;
const SINGLE_ROLES = RECEIPT_ROLES.filter((role) => REQUIRED_ROLE_COUNTS[role].max === 1);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/** Hex digests compare case-insensitively; anything that is not a digest is "". */
const normaliseDigest = (value: unknown): string => {
  const digest = typeof value === "string" ? value.trim().toLowerCase() : "";
  return HEX_DIGEST.test(digest) ? digest : "";
};

const short = (digest: unknown): string => `${String(digest ?? "").slice(0, 16)}…`;

/** Re-hashes a file from disk. `undefined` when it is missing or unreadable. */
function rehash(path: string): { sha256: string; realPath: string } | undefined {
  try {
    const realPath = realpathSync(path);
    return { sha256: createHash("sha256").update(readFileSync(realPath)).digest("hex"), realPath };
  } catch {
    return undefined;
  }
}

/** Validates an approval's identity and timestamp. Returns refusal details. */
export function approvalProblems(
  label: string,
  approval: ApprovalRecord | undefined,
  now: Date,
): string[] {
  if (approval === undefined || approval === null) return [`${label} is absent.`];
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
      // A minute of clock skew is tolerated; an approval dated next week is a
      // placeholder someone forgot to replace.
      problems.push(`${label}.approvedAt "${approval.approvedAt}" is in the future.`);
    }
  }
  return problems;
}

/** A sign-off covers these bytes AND this receipt, or it covers something else. */
function bindingProblems(label: string, binding: DigestBinding | undefined, receipt: RenderReceipt): string[] {
  if (binding === undefined || binding === null || typeof binding !== "object") {
    return [`${label} carries no digest binding.`];
  }
  const problems: string[] = [];
  const master = normaliseDigest(binding.masterSha256);
  const digest = normaliseDigest(binding.receiptDigest);
  if (!master) problems.push(`${label}.masterSha256 is missing or not a SHA-256 digest.`);
  else if (master !== receipt.masterSha256) {
    problems.push(`${label} covers master ${short(master)}, not this master ${short(receipt.masterSha256)}.`);
  }
  if (!digest) problems.push(`${label}.receiptDigest is missing or not a SHA-256 digest.`);
  else if (digest !== receipt.digest) {
    problems.push(`${label} covers receipt ${short(digest)}, not this receipt ${short(receipt.digest)}.`);
  }
  return problems;
}

/**
 * Decides whether a render may be published. Refuses by default.
 *
 * Returns EVERY refusal rather than the first, except when the receipt itself
 * is untrusted: then nothing it says is evidence, so nothing is derived from it.
 */
export function evaluatePublishGate(input: PublishGateInput): PublishVerdict {
  const refusals: PublishRefusal[] = [];
  const refuse = (code: PublishRefusalCode, detail: string): void => {
    refusals.push({ code, detail });
  };
  const now = input?.now ?? new Date();
  const receipt = input?.receipt;

  if (!isIssuedRenderReceipt(receipt)) {
    return {
      allowed: false,
      refusals: [{
        code: "untrusted-receipt",
        detail:
          "The render receipt was not issued by the compositor, or was altered after issue. "
          + "Only the receipt createMotionCompositorAdapter returned for this master is accepted.",
      }],
    };
  }

  // 1. THE MASTER, RE-HASHED NOW.
  const master = rehash(receipt.masterPath);
  if (!master) {
    refuse("missing-file", `The master ${receipt.masterPath} is missing or unreadable.`);
  } else if (master.realPath !== receipt.masterPath || master.sha256 !== receipt.masterSha256) {
    refuse(
      "master-changed",
      `The master at ${receipt.masterPath} is now ${short(master.sha256)}; the receipt recorded ${short(receipt.masterSha256)}.`,
    );
  }

  // 2. EVERY CONSUMED INPUT AND FRAME, RE-HASHED NOW.
  for (const consumed of receipt.inputs) {
    const current = rehash(consumed.resolvedPath);
    if (!current) {
      refuse("missing-file", `${consumed.taskId} (${consumed.role}) at ${consumed.resolvedPath} is missing or unreadable.`);
    } else if (current.realPath !== consumed.resolvedPath || current.sha256 !== consumed.sha256) {
      refuse(
        "input-changed",
        `${consumed.taskId} (${consumed.role}) changed after rendering: ${short(current.sha256)} now, ${short(consumed.sha256)} when consumed.`,
      );
    }
    for (const frame of consumed.frames) {
      const frameNow = rehash(frame.resolvedPath);
      if (!frameNow) refuse("missing-file", `${consumed.taskId} frame ${frame.resolvedPath} is missing or unreadable.`);
      else if (frameNow.realPath !== frame.resolvedPath || frameNow.sha256 !== frame.sha256) {
        refuse("input-changed", `${consumed.taskId} frame ${frame.resolvedPath} changed after rendering.`);
      }
    }
  }

  // 3. THE MASTER MUST HAVE CONSUMED EVERY REQUIRED ROLE.
  for (const role of RECEIPT_ROLES) {
    const count = receipt.inputs.filter((consumed) => consumed.role === role).length;
    const { min, max } = REQUIRED_ROLE_COUNTS[role];
    if (count < min) refuse("missing-role", `The master consumed no ${role}; a publishable master needs one.`);
    if (count > max) refuse("duplicate-role", `The master consumed ${count} ${role} inputs; at most ${max} is allowed.`);
  }

  // 4. THE DEPENDENCY RECORD, RECONCILED ENTRY BY ENTRY.
  const record = input.dependencyRecord;
  if (!record || typeof record !== "object" || !Array.isArray(record.dependencies)) {
    refuse("malformed-dependency-record", "No dependency record with a dependencies array was supplied.");
  } else {
    for (const problem of bindingProblems("dependencyRecord", record, receipt)) {
      refuse("dependency-record-mismatch", problem);
    }
    const consumedByTask = new Map(receipt.inputs.map((consumed) => [consumed.taskId, consumed]));
    const claimedTasks = new Set<string>();
    const claimedRoles = new Map<string, number>();
    for (const [index, claim] of record.dependencies.entries()) {
      if (!claim || typeof claim !== "object" || !isNonEmptyString(claim.taskId)) {
        refuse("malformed-dependency-record", `dependencies[${index}] has no taskId.`);
        continue;
      }
      if (claimedTasks.has(claim.taskId)) {
        refuse("duplicate-role", `${claim.taskId} is claimed more than once.`);
        continue;
      }
      claimedTasks.add(claim.taskId);
      claimedRoles.set(claim.role, (claimedRoles.get(claim.role) ?? 0) + 1);
      const consumed = consumedByTask.get(claim.taskId);
      if (!consumed) {
        refuse("extra-claimed-dependency", `${claim.taskId} is claimed as ${claim.role}, but the compositor never consumed it.`);
        continue;
      }
      if (claim.role !== consumed.role) {
        refuse("dependency-record-mismatch", `${claim.taskId} is claimed as ${claim.role}; the compositor used it as ${consumed.role}.`);
      }
      if (claim.resolvedPath !== consumed.resolvedPath) {
        refuse("dependency-record-mismatch", `${claim.taskId} is claimed at ${claim.resolvedPath}; the compositor read ${consumed.resolvedPath}.`);
      }
      if (normaliseDigest(claim.sha256) !== consumed.sha256) {
        refuse("dependency-record-mismatch", `${claim.taskId} is claimed as ${short(claim.sha256)}; the compositor consumed ${short(consumed.sha256)}.`);
      }
    }
    for (const role of SINGLE_ROLES) {
      const count = claimedRoles.get(role) ?? 0;
      if (count > 1) refuse("duplicate-role", `The dependency record claims ${count} ${role} inputs; a master has one.`);
    }
    for (const consumed of receipt.inputs) {
      if (!claimedTasks.has(consumed.taskId)) {
        refuse("omitted-dependency", `${consumed.taskId} (${consumed.role}) was consumed by the compositor but is missing from the dependency record.`);
      }
    }
  }

  // 5. PROVENANCE OF EVERY CONSUMED INPUT.
  const liamVoiceId = input.narrationIdentity?.liamVoiceId;
  for (const consumed of receipt.inputs) {
    if (!isNonEmptyString(consumed.renderer) && !isNonEmptyString(consumed.provider)) {
      refuse("unsupported-provenance", `${consumed.taskId} records neither a renderer nor a provider.`);
    }
    const audioRole = consumed.role === "narration" || consumed.role === "music-bed";
    if (audioRole && consumed.kind !== "audio") {
      refuse("unsupported-provenance", `${consumed.taskId} fills ${consumed.role} but is a ${consumed.kind}, not audio.`);
    }
    if (consumed.role === "captions" && consumed.kind !== "captions") {
      refuse("unsupported-provenance", `${consumed.taskId} fills captions but is a ${consumed.kind}.`);
    }
    if (consumed.role === "captions"
        && !(consumed.evidence?.issuer === "specsmith-ass-captions" && consumed.evidence.sha256Matches)) {
      refuse(
        "unsupported-provenance",
        `${consumed.taskId} has no caption-adapter evidence for these exact bytes; a caption label is not proof.`,
      );
    }

    // The declared flag is not the last word: known fixture sources are
    // recognised by name whatever the artifact claims about itself.
    const isFixture = consumed.declaredFixture
      || FIXTURE_SOURCES.has(consumed.renderer)
      || FIXTURE_SOURCES.has(consumed.provider);
    if (isFixture) {
      refusals.push({
        code: "fixture-artifact",
        detail: `${consumed.taskId} came from ${consumed.renderer || consumed.provider}, which is a fixture.`,
      });
      if (consumed.role === "hook-visual") {
        refusals.push({
          code: "placeholder-hook",
          detail: `${consumed.taskId} is the placeholder card standing in for the hook beat.`,
        });
      }
      if (consumed.role === "music-bed") {
        refusals.push({
          code: "silent-music-bed",
          detail: `${consumed.taskId} is the silent stand-in bed; a licensed track has not been chosen.`,
        });
      }
    }

    // NARRATION IDENTITY comes from adapter-issued evidence, never from
    // metadata: the ElevenLabs adapter's own registry entry for this artifact,
    // for these exact bytes, voiced with the configured Liam id.
    if (consumed.role === "narration") {
      const evidence = consumed.evidence;
      if (evidence?.issuer !== "elevenlabs-tts") {
        refusals.push({
          code: "narration-not-elevenlabs",
          detail:
            `${consumed.taskId} carries no ElevenLabs adapter evidence (declared "${consumed.provider || consumed.renderer}"); `
            + "a provider label is not proof.",
        });
      } else if (!evidence.sha256Matches) {
        refusals.push({
          code: "narration-not-elevenlabs",
          detail: `${consumed.taskId}: the consumed file is not the audio ElevenLabs returned; it changed after the adapter wrote it.`,
        });
      }
      if (!isNonEmptyString(liamVoiceId)) {
        refusals.push({
          code: "narration-voice-not-liam",
          detail: `${consumed.taskId}: no Liam voice id is configured (ELEVENLABS_VOICE_ID), so the voice cannot be verified.`,
        });
      } else if (evidence?.issuer !== "elevenlabs-tts") {
        refusals.push({
          code: "narration-voice-not-liam",
          detail: `${consumed.taskId}: without ElevenLabs adapter evidence the voice is unverifiable; a voiceId label is not proof.`,
        });
      } else if (evidence.voiceId !== liamVoiceId) {
        refusals.push({
          code: "narration-voice-not-liam",
          detail: `${consumed.taskId} was requested with voice "${evidence.voiceId}", not the configured Liam voice id.`,
        });
      }
    }
  }

  // 6. THE HOSTED COPY METRICOOL WILL FETCH.
  const hosted = input.hostedMaster;
  if (!isVerifiedHostedMaster(hosted)) {
    refuse(
      "hosted-master-unverified",
      "No hosted master from uploadAndVerifyMaster was supplied; a URL and a digest from the caller prove nothing about the bytes it serves.",
    );
  } else if (hosted.sha256 !== receipt.masterSha256 || hosted.receiptDigest !== receipt.digest) {
    refuse(
      "hosted-master-mismatch",
      `The hosted master ${hosted.uri} was verified for master ${short(hosted.sha256)} / receipt ${short(hosted.receiptDigest)}, `
      + `not this master ${short(receipt.masterSha256)} / receipt ${short(receipt.digest)}.`,
    );
  }

  // 7. EVERY SIGN-OFF BOUND TO THESE BYTES AND THIS RECEIPT.
  for (const problem of bindingProblems("qualityReview", input.qualityReview, receipt)) {
    refuse("stale-approval", problem);
  }
  for (const problem of bindingProblems("rightsEvidence", input.rightsEvidence, receipt)) {
    refuse("stale-approval", problem);
  }

  // A paid source is recognised by evidence OR by label: either one requires
  // approval, so a label can only ever add a requirement, never remove one.
  const paid = receipt.inputs.filter((consumed) =>
    consumed.evidence?.issuer === "elevenlabs-tts"
    || PAID_PROVIDERS.has(consumed.provider) || PAID_PROVIDERS.has(consumed.renderer));
  if (paid.length > 0) {
    const paidIds = paid.map((consumed) => consumed.taskId).join(", ");
    for (const problem of approvalProblems("paidProviderApproval", input.paidProviderApproval, now)) {
      refuse("malformed-approval", `${paidIds} used a paid provider but ${problem}`);
    }
    if (input.paidProviderApproval) {
      for (const problem of bindingProblems("paidProviderApproval", input.paidProviderApproval, receipt)) {
        refuse("stale-approval", problem);
      }
    }
  }

  if (input.inspection === undefined || input.inspection === null) {
    refuse("no-approval-record", "No inspection record was supplied for these bytes.");
  } else {
    for (const problem of approvalProblems("inspection", input.inspection, now)) {
      refuse("malformed-approval", problem);
    }
    if (input.inspection.approved !== true) {
      refuse("no-approval-record", "The inspection record does not say approved: true.");
    }
    for (const problem of bindingProblems("inspection", input.inspection, receipt)) {
      refuse("stale-approval", problem);
    }
  }

  if (refusals.length > 0) return { allowed: false, refusals };
  return { allowed: true, masterSha256: receipt.masterSha256, receiptDigest: receipt.digest };
}

/** Throws unless publication is allowed. The only safe way to call the gate. */
export function assertPublishable(input: PublishGateInput): { masterSha256: string; receiptDigest: string } {
  const verdict = evaluatePublishGate(input);
  if (verdict.allowed) return { masterSha256: verdict.masterSha256, receiptDigest: verdict.receiptDigest };
  throw new Error(
    `Publication refused (${verdict.refusals.length}):\n`
    + verdict.refusals.map((refusal) => `  [${refusal.code}] ${refusal.detail}`).join("\n"),
  );
}
