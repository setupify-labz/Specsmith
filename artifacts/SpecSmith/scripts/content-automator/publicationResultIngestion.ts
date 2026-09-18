// The return leg: a real Metricool result, coming back into SpecSmith.
//
// WHERE THIS SITS
// ---------------
// readyToPublishHandoff.ts produces a READY_TO_PUBLISH manifest and stops
// there, deliberately: it never claims a post exists. A human then releases it
// through the connected Metricool workflow. This module is how what actually
// happened gets recorded — the provider's own identifiers, the state it
// reached, and when.
//
// It is the only path that may move a creative to `scheduled` or `published`,
// and it will do so ONLY on evidence: a result that matches an existing
// handoff, byte for byte on the media digest, carrying a provider identity the
// claimed state requires. Nothing here can be talked into inventing a
// publication.
//
// NO NETWORK, NO CREDENTIALS. This module never contacts Metricool. It reads a
// PUBLISH_RESULT document that a human (or ChatGPT, after using the connector)
// fills in from what the connector actually returned. Verifying that document
// against the handoff is the whole job.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { loadExistingHandoff, type ReadyToPublishManifest } from "./readyToPublishHandoff.ts";
import {
  advanceStoredPublicationLedger,
  loadStoredPublicationLedger,
} from "./publishingStore.ts";
import type { PublicationLedger, PublicationStatus } from "./publishing.ts";
import type { VideoPlatform } from "./types.ts";

export const PUBLISH_RESULT_KIND = "PUBLISH_RESULT" as const;
export const PUBLISH_RESULT_VERSION = "publish-result-v1";

/**
 * The states a connector result may claim.
 *
 * Deliberately narrower than PublicationStatus: this document reports what the
 * platform did with a post, so it cannot assert `generated`, `qc-passed`, or
 * any analytics state. Those belong to earlier and later stages and are not a
 * connector's to declare.
 */
export type PublishResultStatus = "scheduled" | "published" | "failed";

/** States that are meaningless without an identifier the platform issued. */
const REQUIRES_PROVIDER_IDENTITY: Record<PublishResultStatus, boolean> = {
  scheduled: true,
  published: true,
  // A failure has no post, so demanding an id would make honest failures
  // unreportable.
  failed: false,
};

/**
 * What ChatGPT fills in after using the Metricool connector.
 *
 * Kept as its own document, separate from ReadyToPublishManifest: the manifest
 * is SpecSmith's instruction outward and must stay exactly as it was when the
 * gates passed; this is the world's answer coming back. Mixing them would let
 * an answer quietly rewrite the instruction it was checked against.
 */
export interface PublishResultDocument {
  readonly kind: typeof PUBLISH_RESULT_KIND;
  readonly version: typeof PUBLISH_RESULT_VERSION;

  /** Must match the handoff exactly. */
  readonly creativeId: string;
  readonly platform: VideoPlatform;
  /** The handoff this result answers, by its media digest. */
  readonly handoffSha256: string;
  /** The package the handoff named, so a result cannot be reattached to another run. */
  readonly packageId: string;

  readonly status: PublishResultStatus;
  /** When the platform reported this. ISO-8601. */
  readonly occurredAt: string;

  readonly providerPostId?: string;
  readonly providerUuid?: string;
  readonly providerUrl?: string;

  /** Free-text, recorded verbatim. Required when reporting a failure. */
  readonly note?: string;
}

export type PublishResultRefusalCode =
  | "malformed-document"
  | "no-matching-handoff"
  | "handoff-sha-mismatch"
  | "package-mismatch"
  | "missing-provider-identity"
  | "conflicting-provider-id"
  | "invalid-transition"
  | "replayed-with-different-data";

export class PublishResultRefusedError extends Error {
  readonly code: PublishResultRefusalCode;
  constructor(code: PublishResultRefusalCode, message: string) {
    super(message);
    this.name = "PublishResultRefusedError";
    this.code = code;
  }
}

function resultDirectory(root: string): string {
  return join(root, "publish-results");
}

function resultPath(root: string, creativeId: string, platform: VideoPlatform, status: PublishResultStatus): string {
  return join(resultDirectory(root), `${creativeId}__${platform}__${status}.json`);
}

/**
 * Structural validation before anything is compared.
 *
 * A malformed document is refused rather than coerced: a missing field filled
 * with a default is exactly how a fabricated publication would enter.
 */
export function parsePublishResult(input: unknown): PublishResultDocument {
  if (!input || typeof input !== "object") {
    throw new PublishResultRefusedError("malformed-document", "PUBLISH_RESULT must be an object.");
  }
  const raw = input as Record<string, unknown>;
  const text = (name: string): string => {
    const value = raw[name];
    if (typeof value !== "string" || !value.trim()) {
      throw new PublishResultRefusedError("malformed-document", `PUBLISH_RESULT.${name} is required.`);
    }
    return value.trim();
  };
  const optional = (name: string): string | undefined => {
    const value = raw[name];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string" || !value.trim()) {
      throw new PublishResultRefusedError("malformed-document", `PUBLISH_RESULT.${name} must be a non-empty string when present.`);
    }
    return value.trim();
  };

  if (raw.kind !== PUBLISH_RESULT_KIND) {
    throw new PublishResultRefusedError("malformed-document", `PUBLISH_RESULT.kind must be ${PUBLISH_RESULT_KIND}.`);
  }
  if (raw.version !== PUBLISH_RESULT_VERSION) {
    throw new PublishResultRefusedError("malformed-document", `PUBLISH_RESULT.version must be ${PUBLISH_RESULT_VERSION}.`);
  }

  const status = raw.status;
  if (status !== "scheduled" && status !== "published" && status !== "failed") {
    throw new PublishResultRefusedError(
      "malformed-document",
      `PUBLISH_RESULT.status must be scheduled, published or failed; got ${JSON.stringify(status)}.`,
    );
  }

  const occurredAt = text("occurredAt");
  if (!Number.isFinite(Date.parse(occurredAt))) {
    throw new PublishResultRefusedError("malformed-document", "PUBLISH_RESULT.occurredAt must be a valid timestamp.");
  }

  const handoffSha256 = text("handoffSha256").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(handoffSha256)) {
    throw new PublishResultRefusedError("malformed-document", "PUBLISH_RESULT.handoffSha256 must be a 64-character SHA-256 hex digest.");
  }

  const platform = raw.platform;
  if (platform !== "youtube-shorts" && platform !== "tiktok" && platform !== "instagram-reels") {
    throw new PublishResultRefusedError("malformed-document", `PUBLISH_RESULT.platform ${JSON.stringify(platform)} is not a SpecSmith platform.`);
  }

  if (status === "failed" && !optional("note")) {
    throw new PublishResultRefusedError("malformed-document", "PUBLISH_RESULT.note is required when reporting a failure, so the reason is recorded.");
  }

  return {
    kind: PUBLISH_RESULT_KIND,
    version: PUBLISH_RESULT_VERSION,
    creativeId: text("creativeId"),
    platform,
    handoffSha256,
    packageId: text("packageId"),
    status,
    occurredAt,
    providerPostId: optional("providerPostId"),
    providerUuid: optional("providerUuid"),
    providerUrl: optional("providerUrl"),
    note: optional("note"),
  };
}

/** Compares two accepted results for exact equality, for replay detection. */
function sameResult(a: PublishResultDocument, b: PublishResultDocument): boolean {
  const key = (doc: PublishResultDocument) => JSON.stringify({
    creativeId: doc.creativeId,
    platform: doc.platform,
    handoffSha256: doc.handoffSha256,
    packageId: doc.packageId,
    status: doc.status,
    occurredAt: doc.occurredAt,
    providerPostId: doc.providerPostId ?? null,
    providerUuid: doc.providerUuid ?? null,
    providerUrl: doc.providerUrl ?? null,
    note: doc.note ?? null,
  });
  return key(a) === key(b);
}

/** Any provider id already recorded on this ledger, from any earlier event. */
function existingProviderId(ledger: PublicationLedger): string | undefined {
  for (const event of ledger.events) {
    if (event.providerPostId) return event.providerPostId;
  }
  return undefined;
}

export interface IngestOptions {
  readonly storeRoot: string;
}

export interface IngestOutcome {
  readonly result: PublishResultDocument;
  readonly handoff: ReadyToPublishManifest;
  readonly ledger: PublicationLedger;
  /** True when this exact result had already been recorded and nothing changed. */
  readonly replayed: boolean;
}

/**
 * Records a real connector result, or refuses it.
 *
 * The order matters: every comparison against the handoff happens before the
 * ledger is touched, so a rejected result cannot leave a partial state behind.
 */
export async function ingestPublishResult(
  input: unknown,
  options: IngestOptions,
): Promise<IngestOutcome> {
  const result = parsePublishResult(input);

  // 1. There must be a handoff for exactly this creative and platform. Without
  //    one, no publication state may be created at all — this is the check
  //    that makes a manifest a precondition rather than a formality.
  const handoff = await loadExistingHandoff(options.storeRoot, result.creativeId, result.platform);
  if (!handoff) {
    throw new PublishResultRefusedError(
      "no-matching-handoff",
      `No READY_TO_PUBLISH handoff exists for ${result.creativeId} on ${result.platform}. A publication result cannot create publication state on its own.`,
    );
  }

  // 2. It must answer THAT handoff's media, not some other render of the same
  //    creative.
  if (handoff.media.sha256.toLowerCase() !== result.handoffSha256) {
    throw new PublishResultRefusedError(
      "handoff-sha-mismatch",
      `Result reports handoff ${result.handoffSha256} but the stored handoff for ${result.creativeId} is ${handoff.media.sha256}. A result cannot be transferred between renders.`,
    );
  }
  if (handoff.packageId !== result.packageId) {
    throw new PublishResultRefusedError(
      "package-mismatch",
      `Result reports package ${result.packageId} but the handoff belongs to ${handoff.packageId}.`,
    );
  }

  // 3. A state that implies a post must name it.
  if (REQUIRES_PROVIDER_IDENTITY[result.status] && !result.providerPostId) {
    throw new PublishResultRefusedError(
      "missing-provider-identity",
      `A "${result.status}" result must carry providerPostId; without it there is no publication to attribute analytics to.`,
    );
  }

  const ledger = await loadStoredPublicationLedger(options.storeRoot, result.creativeId);
  if (!ledger) {
    throw new PublishResultRefusedError(
      "no-matching-handoff",
      `No durable publication ledger exists for ${result.creativeId}, so there is nothing to record against.`,
    );
  }

  // 4. Replay. An identical result is a no-op; a different one for the same
  //    creative/platform/status is a contradiction, not an update.
  const stored = await loadStoredResult(options.storeRoot, result.creativeId, result.platform, result.status);
  if (stored) {
    if (sameResult(stored, result)) {
      return { result: stored, handoff, ledger, replayed: true };
    }
    throw new PublishResultRefusedError(
      "replayed-with-different-data",
      `A different "${result.status}" result was already recorded for ${result.creativeId} on ${result.platform}. Recorded publication facts are not editable.`,
    );
  }

  // 5. A provider id already on the ledger must not be contradicted.
  const already = existingProviderId(ledger);
  if (already && result.providerPostId && already !== result.providerPostId) {
    throw new PublishResultRefusedError(
      "conflicting-provider-id",
      `Ledger ${result.creativeId} already records provider post ${already}; this result claims ${result.providerPostId}.`,
    );
  }

  // 6. The transition must be one the ledger allows. advancePublicationLedger
  //    enforces the table; this pre-check turns it into a named refusal so a
  //    fabricated jump (qc-passed straight to published, say) reports why.
  const current = ledger.events[ledger.events.length - 1].status;
  assertTransitionIsNotFabricated(current, result.status, result.creativeId);

  const advanced = await advanceStoredPublicationLedger(options.storeRoot, result.creativeId, {
    status: result.status as PublicationStatus,
    at: result.occurredAt,
    note: result.note ?? `metricool-connector:${result.status}`,
    ...(result.providerPostId ? { providerPostId: result.providerPostId } : {}),
    ...(result.providerUuid ? { providerUuid: result.providerUuid } : {}),
    ...(result.providerUrl ? { providerUrl: result.providerUrl } : {}),
  });

  await writeStoredResult(options.storeRoot, result);
  return { result, handoff, ledger: advanced, replayed: false };
}

/**
 * Refuses a jump that would assert a state the creative never passed through.
 *
 * `published` is reachable only from `scheduled`: a creative that was never
 * scheduled cannot have been published, and accepting that claim would create
 * a publication with no scheduling history — precisely the fabricated state
 * the handoff route exists to prevent.
 */
function assertTransitionIsNotFabricated(
  current: PublicationStatus,
  next: PublishResultStatus,
  creativeId: string,
): void {
  const allowed: Record<PublishResultStatus, PublicationStatus[]> = {
    scheduled: ["qc-passed"],
    published: ["scheduled"],
    failed: ["generated", "qc-passed", "scheduled", "published"],
  };
  if (!allowed[next].includes(current)) {
    throw new PublishResultRefusedError(
      "invalid-transition",
      `Cannot record "${next}" for ${creativeId} from "${current}": that would assert a state the creative never passed through.`,
    );
  }
}

export async function loadStoredResult(
  root: string,
  creativeId: string,
  platform: VideoPlatform,
  status: PublishResultStatus,
): Promise<PublishResultDocument | null> {
  try {
    return parsePublishResult(JSON.parse(await readFile(resultPath(root, creativeId, platform, status), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeStoredResult(root: string, result: PublishResultDocument): Promise<void> {
  await mkdir(resultDirectory(root), { recursive: true });
  await writeFile(
    resultPath(root, result.creativeId, result.platform, result.status),
    `${JSON.stringify(result, null, 2)}\n`,
    { flag: "wx" },
  );
}

/** The blank a human or ChatGPT fills in. Carries no invented values. */
export function publishResultTemplate(handoff: ReadyToPublishManifest): Record<string, unknown> {
  return {
    kind: PUBLISH_RESULT_KIND,
    version: PUBLISH_RESULT_VERSION,
    creativeId: handoff.creativeId,
    platform: handoff.platform,
    handoffSha256: handoff.media.sha256,
    packageId: handoff.packageId,
    status: "<scheduled | published | failed — what the connector actually reported>",
    occurredAt: "<ISO-8601 timestamp the connector reported>",
    providerPostId: "<the platform's post id; required for scheduled and published>",
    providerUuid: "<optional, if the connector returned one>",
    providerUrl: "<optional, if the connector returned one>",
    note: "<required when status is failed>",
  };
}
