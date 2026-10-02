// Publication integrity, with no opinion about how a post reaches a platform.
//
// WHY THIS IS A SEPARATE MODULE
// -----------------------------
// SpecSmith's guarantees about a publication — these bytes are the bytes that
// were reviewed and rights-cleared, this creative goes out once — are
// properties of the CONTENT and the LEDGER, not of the wire protocol. They
// were originally written inside the Metricool REST client, which quietly made
// them REST-shaped: a different delivery route would have had to reimplement
// them or skip them.
//
// The founder's current Metricool plan does not expose REST at all, so the
// active route today is a human-reviewed handoff manifest, and REST is a
// future adapter that may never be switched on. Both routes must be held to
// exactly the same standard. Putting the checks here is what makes that true
// by construction rather than by discipline: there is one implementation, and
// a new delivery route gets it by calling these functions.
//
// Nothing in this file performs or knows about I/O to any third party.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { assertNotAlreadyPublished, type MetricoolPublishingRequest, type PublicationLedger } from "./publishing.ts";
import type { VideoPlatform } from "./types.ts";

/** Every way a publication attempt can be refused on integrity grounds. */
export type PublicationIntegrityCode =
  | "media-missing"
  | "media-mismatch"
  | "already-published"
  | "unsupported-platform-state"
  | "scheduling-ambiguous"
  | "not-authorized"
  | "rights-not-approved";

export class PublicationIntegrityError extends Error {
  readonly code: PublicationIntegrityCode;
  constructor(code: PublicationIntegrityCode, message: string) {
    super(message);
    this.name = "PublicationIntegrityError";
    this.code = code;
  }
}

/**
 * The finished, already-approved unit of work.
 *
 * `request` is publishing.ts's output, unmodified — it has already passed
 * assertPublishGate, which bound the reviewed digest to the rights-approved
 * master. `mediaPath` is the local file whose bytes are about to leave, and
 * `approvedMasterSha256` is what the rights registry holds for that master.
 */
export interface ApprovedPublicationPackage {
  readonly request: MetricoolPublishingRequest;
  readonly mediaPath: string;
  readonly approvedMasterSha256: string;
}

/** Platforms SpecSmith can publish. A platform outside this set fails closed. */
const PUBLISHABLE: Record<VideoPlatform, true> = {
  "youtube-shorts": true,
  tiktok: true,
  "instagram-reels": true,
};

export async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

/**
 * Re-hashes the bytes about to be published and refuses anything but an exact
 * three-way match: the file on disk, the digest the request was built around,
 * and the digest the rights registry approved.
 *
 * assertPublishGate already bound reviewed-to-approved when the REQUEST was
 * built. Between that moment and this one the file on disk can change — a
 * re-render writes the same path, a cache is repopulated, a sync clobbers it.
 * Whatever happens next is the irreversible step, whether that is an API call
 * or a manifest a human acts on, so the bytes are re-hashed immediately
 * before it. A mismatch is never repaired; it throws.
 */
export async function verifyApprovedMedia(pkg: ApprovedPublicationPackage): Promise<string> {
  let size: number;
  try {
    size = (await stat(pkg.mediaPath)).size;
  } catch {
    throw new PublicationIntegrityError("media-missing", `Final media is not readable at ${pkg.mediaPath}.`);
  }
  if (size === 0) {
    throw new PublicationIntegrityError("media-missing", `Final media at ${pkg.mediaPath} is empty.`);
  }

  const requested = pkg.request.finalMediaSha256.trim().toLowerCase();
  const approved = pkg.approvedMasterSha256.trim().toLowerCase();
  for (const [name, value] of [["request.finalMediaSha256", requested], ["approvedMasterSha256", approved]] as const) {
    if (!/^[a-f0-9]{64}$/.test(value)) {
      throw new PublicationIntegrityError("media-mismatch", `${name} must be a 64-character SHA-256 hex digest.`);
    }
  }
  if (requested !== approved) {
    throw new PublicationIntegrityError(
      "media-mismatch",
      `The request was built for ${requested} but the rights registry approved ${approved}. Clearance does not transfer across renders.`,
    );
  }

  const actual = await sha256OfFile(pkg.mediaPath);
  if (actual !== approved) {
    throw new PublicationIntegrityError(
      "media-mismatch",
      `The bytes at ${pkg.mediaPath} hash to ${actual}, not the rights-approved ${approved}. The file changed after approval; refusing to release it.`,
    );
  }
  return actual;
}

/**
 * Refuses a creative that has already gone out, by any route.
 *
 * Two distinct refusals: a ledger already carrying a `published` event, and one
 * already carrying a `scheduled` event that holds a provider id — the latter is
 * a post already sitting at the platform, and releasing it again would create a
 * duplicate the ledger cannot express.
 */
export function assertNotAlreadyReleased(ledger: PublicationLedger, platform: VideoPlatform): void {
  assertNotAlreadyPublished([ledger], ledger.creativeId);
  // A draft or schedule the provider accepted is a post that already exists.
  const scheduled = ledger.events.find(
    (event: PublicationLedger["events"][number]) => (event.status === "scheduled" || event.status === "draft-submitted") && event.providerPostId,
  );
  if (scheduled) {
    throw new PublicationIntegrityError(
      "already-published",
      `Creative ${ledger.creativeId} already has ${platform} post ${scheduled.providerPostId} scheduled at ${scheduled.at}; refusing a duplicate.`,
    );
  }
}

/**
 * The checks every delivery route must pass before anything leaves.
 *
 * Authorization is read from the ledger rather than taken as a parameter: a
 * `publication-authorized` event can only be written by the publication
 * boundary, after a revalidated MASTER #7 packet and a trusted human decision.
 * A legacy `qc-passed` ledger is never accepted. Rights are represented by the
 * approved master digest, which verifyApprovedMedia then binds to real bytes.
 */
export function assertPublicationGatesPassed(
  pkg: ApprovedPublicationPackage,
  ledger: PublicationLedger,
): void {
  const { request } = pkg;

  if (!PUBLISHABLE[request.platform]) {
    throw new PublicationIntegrityError("unsupported-platform-state", `Platform ${request.platform} cannot be published by SpecSmith.`);
  }
  if (ledger.platform !== request.platform) {
    throw new PublicationIntegrityError("unsupported-platform-state", `Ledger ${request.creativeId} is ${ledger.platform}, not ${request.platform}.`);
  }
  if (ledger.creativeId !== request.creativeId) {
    throw new PublicationIntegrityError("unsupported-platform-state", `Ledger ${ledger.creativeId} does not describe creative ${request.creativeId}.`);
  }
  if (!request.media.length) {
    throw new PublicationIntegrityError("media-missing", `Request ${request.requestId} carries no media reference.`);
  }
  if (!request.date || !request.timezone) {
    throw new PublicationIntegrityError("scheduling-ambiguous", `Request ${request.requestId} has no unambiguous local date/timezone pair.`);
  }
  // publishing.ts already rejects nonexistent and ambiguous wall-clock times
  // when the request is built. This re-asserts the invariant rather than
  // trusting a hand-assembled request object.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(request.date)) {
    throw new PublicationIntegrityError("scheduling-ambiguous", `Request ${request.requestId} date must be local YYYY-MM-DDTHH:mm:ss.`);
  }

  // Authorization. The ledger must hold a `publication-authorized` event, which
  // only the publication boundary can write (a trusted human decision on a
  // revalidated MASTER #7 packet), and must be waiting to be sent. The request
  // must carry exactly what was authorized: the bytes, the account and
  // platform, and the reviewed text.
  if (ledger.legacy) {
    throw new PublicationIntegrityError(
      "not-authorized",
      `Creative ${request.creativeId} has a legacy ledger (qc-passed at ${ledger.legacy.since}): ${ledger.legacy.reason} It is not MASTER #7 reviewed or authorized and may not be released.`,
    );
  }
  const blocked = ledger.events.find(
    (event: PublicationLedger["events"][number]) => ["rejected", "failed", "human-rejected"].includes(event.status),
  );
  if (blocked) {
    throw new PublicationIntegrityError("not-authorized", `Creative ${request.creativeId} was ${blocked.status} at ${blocked.at}; it may not be released.`);
  }
  const authorized = [...ledger.events].reverse().find((event: PublicationLedger["events"][number]) => event.status === "publication-authorized");
  if (!authorized?.evidence) {
    throw new PublicationIntegrityError(
      "not-authorized",
      `Creative ${request.creativeId} has no publication authorization: a MASTER #7 review and a trusted human decision are both required. (A legacy qc-passed state is not one.)`,
    );
  }
  const current = ledger.events.at(-1)?.status;
  if (current !== "publication-authorized" && current !== "submission-failed") {
    throw new PublicationIntegrityError("not-authorized", `Creative ${request.creativeId} is "${current}"; only an authorized creative awaiting release can be released.`);
  }
  const evidence = authorized.evidence;
  const textSha = (text: string) => createHash("sha256").update(text).digest("hex");
  const problems: string[] = [];
  if (String(evidence.mediaSha256).toLowerCase() !== request.finalMediaSha256.trim().toLowerCase()) problems.push("the request names other media than was authorized");
  if (evidence.destinationAccount !== request.blog_id) problems.push(`account ${request.blog_id} was not authorized (authorized: ${String(evidence.destinationAccount)})`);
  if (evidence.destinationPlatform !== request.platform) problems.push(`platform ${request.platform} was not authorized`);
  if (textSha(request.text) !== evidence.descriptionSha256) problems.push("the post text is not the reviewed and authorized description");
  const title = request.youtube_title ?? request.tiktok_title;
  if (title !== undefined && textSha(title) !== evidence.titleSha256) problems.push("the title is not the reviewed and authorized title");
  if (problems.length) {
    throw new PublicationIntegrityError("not-authorized", `Creative ${request.creativeId} cannot be released as requested: ${problems.join("; ")}.`);
  }

  // Rights. A missing or malformed approved digest is refused here so the
  // failure names rights rather than surfacing later as a generic mismatch.
  const approved = pkg.approvedMasterSha256?.trim().toLowerCase() ?? "";
  if (!/^[a-f0-9]{64}$/.test(approved)) {
    throw new PublicationIntegrityError(
      "rights-not-approved",
      `Creative ${request.creativeId} has no rights-approved master digest; there is nothing to bind the release to.`,
    );
  }

  assertNotAlreadyReleased(ledger, request.platform);
}
