// THE ACTIVE PUBLICATION ROUTE.
//
// The founder's Metricool plan does not expose REST API access, so SpecSmith
// cannot schedule a post programmatically. What it can do — and what this
// module does — is produce a READY_TO_PUBLISH manifest: a complete, verified,
// self-describing handoff that a human releases through the ChatGPT/Metricool
// connector.
//
// WHAT A MANIFEST MEANS, AND WHAT IT DOES NOT
// -------------------------------------------
// Producing one asserts exactly this: at the moment it was written, every
// SpecSmith publication gate passed and the media on disk still hashed to the
// rights-approved master. It asserts NOTHING about the post existing. This
// module never advances the ledger to `scheduled` or `published`, never
// invents a provider id, and never writes a state implying the post went out —
// those states belong to whatever observes the platform actually accepting it.
// A manifest is permission to publish, not a record of having published.
//
// It is held to the SAME standard as the REST adapter because both call
// publicationIntegrity.ts. There is one implementation of "is this fit to
// release", so the route that is actually in use cannot be the weaker one.
//
// NO NETWORK. This module makes no request to Metricool or anywhere else, and
// imports nothing that can.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  assertPublicationGatesPassed,
  PublicationIntegrityError,
  verifyApprovedMedia,
  type ApprovedPublicationPackage,
} from "./publicationIntegrity.ts";
import { loadStoredPublicationLedger } from "./publishingStore.ts";
import type { PublicationStatus } from "./publishing.ts";
import type { VideoPlatform } from "./types.ts";

export const HANDOFF_KIND = "READY_TO_PUBLISH" as const;
const HANDOFF_VERSION = "ready-to-publish-v1";

/**
 * The handoff a human acts on.
 *
 * Every field a person needs in order to release the post correctly, and
 * nothing that would let them believe it is already released.
 */
export interface ReadyToPublishManifest {
  readonly kind: typeof HANDOFF_KIND;
  readonly version: typeof HANDOFF_VERSION;
  /** When this manifest was produced, and therefore when the checks were true. */
  readonly preparedAt: string;

  readonly creativeId: string;
  readonly packageId: string;
  readonly campaignId: string;
  readonly ideaId: string;
  readonly platform: VideoPlatform;

  /** The exact approved media, by reference and by digest. */
  readonly media: {
    /** The publishable reference the request carries (what the connector uploads or links). */
    readonly reference: string;
    /** The local file these checks were run against. */
    readonly localPath: string;
    /** Verified against the real bytes at localPath at preparedAt. */
    readonly sha256: string;
  };

  readonly caption: string;
  readonly hashtags: readonly string[];
  readonly trackedWebsiteUrl: string;

  readonly schedule: {
    /** Local wall-clock time, unambiguous in `timezone`. */
    readonly localDateTime: string;
    readonly timezone: string;
  };

  /**
   * What the human should choose in the connector. "draft" means save for
   * review; "public" means release. Taken from the request's own draft flag —
   * this module never upgrades a draft request to public.
   */
  readonly intent: "draft" | "public";

  readonly qc: {
    readonly state: "passed";
    /** The ledger event that is the evidence. */
    readonly at: string;
  };

  readonly rights: {
    readonly state: "approved";
    readonly approvedMasterSha256: string;
  };

  /**
   * The ledger state at preparation time. Always a pre-release state: if this
   * ever reads `scheduled` or `published`, the manifest should not exist.
   */
  readonly ledgerStatusAtPreparation: PublicationStatus;

  /** Said plainly, inside the artifact, so it cannot be misread downstream. */
  readonly notice: string;
}

export class HandoffRefusedError extends Error {
  readonly code: "duplicate-handoff" | "already-released";
  constructor(code: "duplicate-handoff" | "already-released", message: string) {
    super(message);
    this.name = "HandoffRefusedError";
    this.code = code;
  }
}

function handoffDirectory(root: string): string {
  return join(root, "ready-to-publish");
}

function handoffPath(root: string, creativeId: string, platform: VideoPlatform): string {
  return join(handoffDirectory(root), `${creativeId}__${platform}.json`);
}

/**
 * Duplicate refusal for the handoff route.
 *
 * Kept in its own durable record rather than as a ledger state, deliberately.
 * The ledger's vocabulary describes what happened to the POST, and there is no
 * honest ledger status for "a human was handed a manifest" — inventing one, or
 * borrowing `scheduled`, would be exactly the fabricated publication state
 * this module exists to avoid. So handoffs are tracked beside the ledger, and
 * the ledger keeps meaning what it always meant.
 */
export async function loadExistingHandoff(
  root: string,
  creativeId: string,
  platform: VideoPlatform,
): Promise<ReadyToPublishManifest | null> {
  try {
    const raw = await readFile(handoffPath(root, creativeId, platform), "utf8");
    return JSON.parse(raw) as ReadyToPublishManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function listHandoffs(root: string): Promise<string[]> {
  try {
    return (await readdir(handoffDirectory(root))).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export interface HandoffOptions {
  readonly storeRoot: string;
  readonly now?: Date;
}

/**
 * Produces the manifest, or refuses.
 *
 * Fails closed on: no ledger, quality review not passed, rights not approved,
 * media missing or changed since approval, an ambiguous schedule, an
 * unsupported platform, a creative already released, and a manifest already
 * written for this creative and platform. Every one of those is checked BEFORE
 * anything is written, so a refused handoff leaves no artifact behind.
 */
export async function prepareReadyToPublishHandoff(
  pkg: ApprovedPublicationPackage,
  options: HandoffOptions,
): Promise<ReadyToPublishManifest> {
  const { request } = pkg;
  const now = options.now ?? new Date();

  const ledger = await loadStoredPublicationLedger(options.storeRoot, request.creativeId);
  if (!ledger) {
    throw new PublicationIntegrityError(
      "unsupported-platform-state",
      `No durable publication ledger exists for ${request.creativeId}; a publication must be ledgered before it can be handed off.`,
    );
  }

  // The same gates the REST adapter applies. One implementation, both routes.
  assertPublicationGatesPassed(pkg, ledger);

  const existing = await loadExistingHandoff(options.storeRoot, request.creativeId, request.platform);
  if (existing) {
    throw new HandoffRefusedError(
      "duplicate-handoff",
      `A READY_TO_PUBLISH manifest already exists for ${request.creativeId} on ${request.platform}, prepared at ${existing.preparedAt}. Refusing to hand the same creative off twice.`,
    );
  }

  // Last, and against the real bytes.
  const sha256 = await verifyApprovedMedia(pkg);

  const qcEvent = ledger.events.find((event) => event.status === "qc-passed");
  if (!qcEvent) {
    // assertPublicationGatesPassed already guarantees this; kept so the
    // manifest can never be built from an absent event.
    throw new PublicationIntegrityError("qc-not-passed", `Creative ${request.creativeId} has no qc-passed event.`);
  }

  const manifest: ReadyToPublishManifest = {
    kind: HANDOFF_KIND,
    version: HANDOFF_VERSION,
    preparedAt: now.toISOString(),
    creativeId: request.creativeId,
    packageId: request.packageId,
    campaignId: request.campaignId,
    ideaId: request.ideaId,
    platform: request.platform,
    media: {
      reference: request.media[0],
      localPath: pkg.mediaPath,
      sha256,
    },
    caption: request.text,
    hashtags: [...request.hashtags],
    trackedWebsiteUrl: request.trackedWebsiteUrl,
    schedule: {
      localDateTime: request.date,
      timezone: request.timezone,
    },
    // Never upgraded here. A draft request produces a draft intent.
    intent: request.draft ? "draft" : "public",
    qc: { state: "passed", at: qcEvent.at },
    rights: { state: "approved", approvedMasterSha256: pkg.approvedMasterSha256.trim().toLowerCase() },
    ledgerStatusAtPreparation: ledger.events[ledger.events.length - 1].status,
    notice:
      "This manifest means the creative is cleared to publish. It is NOT a record of publication. "
      + "SpecSmith has not scheduled or posted anything; no provider post id exists yet. "
      + "Release it through the Metricool connector, then record the real result in the publication ledger.",
  };

  // A released creative must never reach this line, but the manifest itself is
  // also checked: writing one that claims a post-release ledger state would
  // make the artifact self-contradictory.
  if (manifest.ledgerStatusAtPreparation === "scheduled" || manifest.ledgerStatusAtPreparation === "published") {
    throw new HandoffRefusedError(
      "already-released",
      `Creative ${request.creativeId} is already ${manifest.ledgerStatusAtPreparation}; a handoff manifest would misrepresent it.`,
    );
  }

  await mkdir(handoffDirectory(options.storeRoot), { recursive: true });
  // Exclusive create: two concurrent runs cannot both believe they produced
  // the handoff.
  try {
    await writeFile(handoffPath(options.storeRoot, request.creativeId, request.platform), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new HandoffRefusedError(
        "duplicate-handoff",
        `A READY_TO_PUBLISH manifest for ${request.creativeId} on ${request.platform} was written concurrently; refusing a duplicate.`,
      );
    }
    throw error;
  }

  return manifest;
}
