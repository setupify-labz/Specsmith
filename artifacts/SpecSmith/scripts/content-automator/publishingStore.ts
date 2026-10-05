import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  advancePublicationLedger,
  replayPublicationLedger,
  startPublicationLedger,
  type PublicationEvent,
  type PublicationLedger,
  type TransitionReceipt,
} from "./publishing.ts";
import { realpath } from "node:fs/promises";
// The publication boundary claims the ledger authority when it loads. Importing
// it here guarantees it holds the authority before this store can write any
// protected state, so no other module can become the issuer first.
import "./v2/publication/boundary.ts";
import {
  recordAnalyticsSnapshot,
  type AnalyticsSnapshot,
} from "./analyticsIngestion.ts";
import type { CreativeFingerprint, VideoPlatform } from "./types.ts";

const STORE_VERSION = 1;

interface StoredPublicationEvent {
  version: typeof STORE_VERSION;
  creativeId: string;
  packageId: string;
  platform: VideoPlatform;
  event: PublicationEvent;
  /**
   * The creative fingerprint, written once with the creation event.
   *
   * WHY IT LIVES HERE AND NOWHERE ELSE. Analytics attribution needs the
   * fingerprint, the ideaId and the target duration, and every one of those is
   * already inside the fingerprint that createStoredPublicationLedger is
   * handed. Before this it was dropped on the floor, so downstream code had to
   * ask a caller to supply it again — a second source of truth that could
   * disagree with the creative actually published.
   *
   * Recorded on the CREATION event only: the fingerprint describes what was
   * made, so it is a fact about the creative, not about a later transition.
   * Optional in the type because ledgers written before this change do not
   * have it; loadStoredCreativeFingerprint returns null for those rather than
   * reconstructing one, and the collector skips the creative with a named
   * reason instead of inventing an attribution.
   */
  fingerprint?: CreativeFingerprint;
}

function storageKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

async function writeJsonExclusive(path: string, value: unknown): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  } finally {
    await handle?.close();
  }
}

function ledgerDirectory(root: string, creativeId: string): string {
  return join(root, "publication-ledgers", storageKey(creativeId));
}

function analyticsDirectory(root: string, creativeId: string): string {
  return join(root, "analytics-snapshots", storageKey(creativeId));
}

function eventPath(directory: string, index: number): string {
  return join(directory, `${String(index).padStart(6, "0")}.json`);
}

function parseStoredEvent(raw: string, path: string): StoredPublicationEvent {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Publication ledger event ${path} is not valid JSON.`);
  }
  if (typeof value !== "object" || value === null) throw new Error(`Publication ledger event ${path} is invalid.`);
  const candidate = value as Partial<StoredPublicationEvent>;
  if (
    candidate.version !== STORE_VERSION ||
    typeof candidate.creativeId !== "string" ||
    typeof candidate.packageId !== "string" ||
    typeof candidate.platform !== "string" ||
    typeof candidate.event !== "object" ||
    candidate.event === null ||
    typeof candidate.event.status !== "string" ||
    typeof candidate.event.at !== "string"
  ) {
    throw new Error(`Publication ledger event ${path} has an unsupported shape.`);
  }
  return candidate as StoredPublicationEvent;
}

/** Creates exactly one durable ledger for a creative. A second run fails. */
export async function createStoredPublicationLedger(
  root: string,
  fingerprint: CreativeFingerprint,
  at = new Date(),
): Promise<PublicationLedger> {
  const ledger = startPublicationLedger(fingerprint, at);
  const directory = ledgerDirectory(root, fingerprint.creativeId);
  await mkdir(directory, { recursive: true });
  const created = await writeJsonExclusive(eventPath(directory, 0), {
    version: STORE_VERSION,
    creativeId: ledger.creativeId,
    packageId: ledger.packageId,
    platform: ledger.platform,
    event: ledger.events[0],
    fingerprint,
  } satisfies StoredPublicationEvent);
  if (!created) {
    throw new Error(`A durable publication ledger already exists for ${fingerprint.creativeId}; refusing a duplicate run.`);
  }
  return ledger;
}

export async function loadStoredPublicationLedger(
  root: string,
  creativeId: string,
): Promise<PublicationLedger | null> {
  const directory = ledgerDirectory(root, creativeId);
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => /^\d{6}\.json$/.test(name)).sort();
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
  if (names.length === 0) return null;
  names.forEach((name, index) => {
    if (name !== `${String(index).padStart(6, "0")}.json`) {
      throw new Error(`Publication ledger ${creativeId} has a missing or duplicate event slot at ${index}.`);
    }
  });

  const stored = await Promise.all(names.map(async (name) => (
    parseStoredEvent(await readFile(join(directory, name), "utf8"), join(directory, name))
  )));
  const first = stored[0];
  if (first.creativeId !== creativeId || first.event.status !== "generated") {
    throw new Error(`Publication ledger ${creativeId} has an invalid first event.`);
  }
  const base: PublicationLedger = {
    creativeId: first.creativeId,
    packageId: first.packageId,
    platform: first.platform,
    events: [first.event],
  };
  for (const entry of stored.slice(1)) {
    if (entry.creativeId !== base.creativeId || entry.packageId !== base.packageId || entry.platform !== base.platform) {
      throw new Error(`Publication ledger ${creativeId} changes identity between events.`);
    }
  }
  // Receipts were checked when each event was written; replay checks the
  // transitions and the evidence each state must carry.
  return replayPublicationLedger(base, stored.slice(1).map((entry) => entry.event));
}

/** Atomically claims the next event slot, so concurrent advances cannot both win. */
export async function advanceStoredPublicationLedger(
  root: string,
  creativeId: string,
  event: Omit<PublicationEvent, "at"> & { at?: string },
  receipt?: TransitionReceipt,
): Promise<PublicationLedger> {
  const current = await loadStoredPublicationLedger(root, creativeId);
  if (!current) throw new Error(`No durable publication ledger exists for ${creativeId}.`);
  // A simulated event never lands in a production store, and a simulation
  // store never holds an event that does not say it was simulated.
  const mode = await publicationStoreMode(root);
  if (mode === "production" && event.simulated) {
    throw new Error(`Refusing to write a simulated "${event.status}" event into the production store at ${root}.`);
  }
  if (mode === "simulation" && !event.simulated && !["generated", "rejected", "failed"].includes(event.status)) {
    throw new Error(`Store ${root} is a simulation store; every "${event.status}" event written to it must be labelled simulated.`);
  }
  const next = advancePublicationLedger(current, event, receipt, { storeRoot: await realpath(root) });
  const storedEvent = next.events.at(-1);
  if (!storedEvent) throw new Error(`Publication ledger ${creativeId} produced no next event.`);
  const created = await writeJsonExclusive(eventPath(ledgerDirectory(root, creativeId), current.events.length), {
    version: STORE_VERSION,
    creativeId: current.creativeId,
    packageId: current.packageId,
    platform: current.platform,
    event: storedEvent,
  } satisfies StoredPublicationEvent);
  if (!created) {
    throw new Error(`Publication ledger ${creativeId} was advanced concurrently; reload before retrying.`);
  }
  return next;
}

function parseSnapshot(raw: string, path: string): AnalyticsSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Analytics snapshot ${path} is not valid JSON.`);
  }
  if (typeof value !== "object" || value === null) throw new Error(`Analytics snapshot ${path} is invalid.`);
  const candidate = value as Partial<AnalyticsSnapshot>;
  if (
    typeof candidate.creativeId !== "string" ||
    typeof candidate.platform !== "string" ||
    typeof candidate.window !== "string" ||
    typeof candidate.record !== "object" ||
    candidate.record === null
  ) {
    throw new Error(`Analytics snapshot ${path} has an unsupported shape.`);
  }
  return candidate as AnalyticsSnapshot;
}

/** Stores a window once. Identical retries are idempotent; rewrites fail. */
export async function recordStoredAnalyticsSnapshot(
  root: string,
  snapshot: AnalyticsSnapshot,
): Promise<AnalyticsSnapshot> {
  const directory = analyticsDirectory(root, snapshot.creativeId);
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${snapshot.platform}-${snapshot.window}.json`);
  if (await writeJsonExclusive(path, snapshot)) return snapshot;
  const existing = parseSnapshot(await readFile(path, "utf8"), path);
  recordAnalyticsSnapshot([existing], snapshot);
  return existing;
}

export async function loadStoredAnalyticsSnapshots(
  root: string,
  creativeId: string,
): Promise<AnalyticsSnapshot[]> {
  const directory = analyticsDirectory(root, creativeId);
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
  const snapshots = await Promise.all(names.map(async (name) => {
    const path = join(directory, name);
    return parseSnapshot(await readFile(path, "utf8"), path);
  }));
  if (snapshots.some((snapshot) => snapshot.creativeId !== creativeId)) {
    throw new Error(`Analytics store ${creativeId} contains a snapshot for another creative.`);
  }
  return snapshots.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
}

/**
 * The fingerprint recorded when this creative's ledger was created.
 *
 * Returns null when the ledger does not exist, or when it predates fingerprint
 * persistence. Null means "SpecSmith does not know", and every caller must
 * treat it that way — there is nothing here that reconstructs a plausible
 * fingerprint from other fields.
 */
export async function loadStoredCreativeFingerprint(
  root: string,
  creativeId: string,
): Promise<CreativeFingerprint | null> {
  const path = eventPath(ledgerDirectory(root, creativeId), 0);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
  const stored = parseStoredEvent(raw, path);
  return stored.fingerprint ?? null;
}

// ---------------------------------------------------------------------------
// Store mode
// ---------------------------------------------------------------------------
//
// A store is either production or a labelled simulation. A root with no marker
// is production: the safe default is the one with the strictest rules. A
// simulation store is created deliberately and says so in every event; nothing
// written there can be mistaken for something that happened.

export type PublicationStoreMode = "production" | "simulation";

interface StoreModeRecord {
  readonly version: 1;
  readonly mode: PublicationStoreMode;
  readonly createdAt: string;
  readonly purpose: string;
}

const MODE_FILE = "store-mode.json";

/** Mark a new store as production or simulation. A store's mode is set once. */
export async function initPublicationStore(root: string, mode: PublicationStoreMode, purpose: string, at = new Date()): Promise<void> {
  await mkdir(root, { recursive: true });
  const created = await writeJsonExclusive(join(root, MODE_FILE), { version: 1, mode, createdAt: at.toISOString(), purpose } satisfies StoreModeRecord);
  if (!created && (await publicationStoreMode(root)) !== mode) {
    throw new Error(`Store ${root} is already a ${await publicationStoreMode(root)} store; its mode cannot change.`);
  }
}

export async function publicationStoreMode(root: string): Promise<PublicationStoreMode> {
  try {
    const record = JSON.parse(await readFile(join(root, MODE_FILE), "utf8")) as Partial<StoreModeRecord>;
    if (record.mode === "simulation" || record.mode === "production") return record.mode;
    throw new Error(`Store ${root} has an unreadable mode marker.`);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return "production";
    throw error;
  }
}

/** Every creative with a ledger in this store, read from each ledger's first event. */
export async function listStoredCreativeIds(root: string): Promise<string[]> {
  let directories: string[];
  try {
    directories = await readdir(join(root, "publication-ledgers"));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
  const ids: string[] = [];
  for (const directory of directories.sort()) {
    const path = join(root, "publication-ledgers", directory, "000000.json");
    try {
      ids.push(parseStoredEvent(await readFile(path, "utf8"), path).creativeId);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Provider post index: which creative a provider's post id belongs to
// ---------------------------------------------------------------------------

function providerPostPath(root: string, provider: string, providerPostId: string): string {
  return join(root, "provider-posts", `${storageKey(`${provider}:${providerPostId}`)}.json`);
}

/** Bind a provider post id to one creative, once. Rebinding it elsewhere fails. */
export async function bindProviderPost(root: string, provider: string, providerPostId: string, creativeId: string): Promise<void> {
  await mkdir(join(root, "provider-posts"), { recursive: true });
  const path = providerPostPath(root, provider, providerPostId);
  if (await writeJsonExclusive(path, { provider, providerPostId, creativeId })) return;
  const existing = JSON.parse(await readFile(path, "utf8")) as { creativeId: string };
  if (existing.creativeId !== creativeId) {
    throw new Error(`Provider post ${provider}:${providerPostId} is already bound to ${existing.creativeId}, not ${creativeId}.`);
  }
}

export async function creativeForProviderPost(root: string, provider: string, providerPostId: string): Promise<string | null> {
  try {
    return (JSON.parse(await readFile(providerPostPath(root, provider, providerPostId), "utf8")) as { creativeId: string }).creativeId;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}
