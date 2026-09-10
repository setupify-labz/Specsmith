import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  advancePublicationLedger,
  startPublicationLedger,
  type PublicationEvent,
  type PublicationLedger,
} from "./publishing.ts";
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
  let ledger: PublicationLedger = {
    creativeId: first.creativeId,
    packageId: first.packageId,
    platform: first.platform,
    events: [first.event],
  };
  for (const entry of stored.slice(1)) {
    if (
      entry.creativeId !== ledger.creativeId ||
      entry.packageId !== ledger.packageId ||
      entry.platform !== ledger.platform
    ) {
      throw new Error(`Publication ledger ${creativeId} changes identity between events.`);
    }
    ledger = advancePublicationLedger(ledger, entry.event);
  }
  return ledger;
}

/** Atomically claims the next event slot, so concurrent advances cannot both win. */
export async function advanceStoredPublicationLedger(
  root: string,
  creativeId: string,
  event: Omit<PublicationEvent, "at"> & { at?: string },
): Promise<PublicationLedger> {
  const current = await loadStoredPublicationLedger(root, creativeId);
  if (!current) throw new Error(`No durable publication ledger exists for ${creativeId}.`);
  const next = advancePublicationLedger(current, event);
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
