// MASTER #8: performance observations from a provider, for publications SpecSmith made.
//
// An observation is stored only when it can be traced to one of our own
// provider-confirmed publications: the provider post id must be bound to a
// creative whose ledger reached `published`, on the account and platform that
// publication was authorized for. Each stored observation carries the creative,
// the platform cut and the final media hash it describes, the metric's
// definition from MASTER #5's registry (definitions are platform-local), and
// whether the number was observed, is unavailable, or was derived from observed
// numbers.
//
// THE RULES
//   - Absent is not zero. A metric the provider did not return is stored as
//     unavailable, with no number.
//   - Repeated imports are idempotent. The same batch twice is a no-op; a
//     different value for the same metric at the same collection time is a
//     conflict and is refused.
//   - History is kept. A late-arriving older batch is stored, and "latest" is
//     always the newest collection time, so an older number never replaces a
//     newer one.
//   - No synthetic or simulated numbers in a production store, and no real
//     numbers in a simulation store.
//   - Numbers enter only from a TRUSTED SOURCE. A batch is accepted only when
//     a registered ObservationSource issued it: an authenticated provider fetch
//     or a verifiable (signed) provider export. A batch a caller assembled,
//     whatever it says about itself (`simulated: false`, an adapter name, a raw
//     "provider response"), is not evidence of where its numbers came from.
//     PRODUCTION_OBSERVATION_SOURCES is EMPTY: no such source exists for the
//     current Metricool plan, so production ingestion is closed. Numbers a
//     person supplies by hand can be kept with recordUnverifiedObservations,
//     labelled unverified, outside the learning report and the ledger.
//   - Website clicks are recorded only with attribution: a tracked URL whose
//     utm_content is this creative and a named measuring source. Nothing is
//     inferred from views, and sales and conversions are not recorded at all.

import { mkdir, open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { creativeForProviderPost, loadStoredPublicationLedger, publicationStoreMode } from "../../publishingStore.ts";
import type { VideoPlatform } from "../../types.ts";
import { metricsForPlatform, type MetricUnit } from "../experiment/metrics.ts";
import { sha256Json, sha256Text } from "../review/util.ts";
import { loadAuthorization, recordMetricsObserved } from "./boundary.ts";

export const OBSERVATION_BATCH_KIND = "PROVIDER_OBSERVATIONS" as const;
export const OBSERVATION_RECORD_VERSION = "provider-observation-v1";

/** One collection of metrics for one post, as a provider returned it. */
export interface ProviderObservationBatch {
  readonly kind: typeof OBSERVATION_BATCH_KIND;
  readonly provider: "metricool";
  readonly platform: VideoPlatform;
  readonly accountId: string;
  readonly providerPostId: string;
  readonly collectedAt: string;
  /** Keyed by the provider's own field names. Null or "unavailable" means not returned. */
  readonly metrics: Readonly<Record<string, number | "unavailable" | null>>;
  /** Share of viewers still watching at each second, when the provider returns a curve. */
  readonly retentionCurve?: { readonly seconds: readonly number[]; readonly shareWatching: readonly number[] } | "unavailable";
  /** Required before any site-click number is kept. */
  readonly attribution?: { readonly trackedUrl: string; readonly utmContent: string; readonly measuredBy: string } | null;
  /** The provider's response, kept verbatim for audit. */
  readonly raw: unknown;
}

/** Which post's numbers to fetch. */
export interface ObservationRequest {
  readonly provider: "metricool";
  readonly platform: VideoPlatform;
  readonly accountId: string;
  readonly providerPostId: string;
}

/**
 * Where numbers may come from. A source authenticates the provider (an API
 * call made with the account's own credentials, or a provider export whose
 * signature it checks) and returns what that provider said. Only sources this
 * module registers can issue batches; an object that merely has this shape
 * cannot.
 */
export interface ObservationSource {
  readonly sourceId: string;
  /** "authenticated-fetch" or "verified-export" in production; "simulated" for fakes. */
  readonly mechanism: "authenticated-fetch" | "verified-export" | "simulated";
  readonly simulated: boolean;
  fetch(request: ObservationRequest): Promise<ProviderObservationBatch>;
}

/**
 * Sources trusted for production. EMPTY: the current Metricool plan exposes no
 * REST API, and neither Metricool nor the connector supplies a signed export.
 * Adding one is a reviewed code change in this module.
 */
export const PRODUCTION_OBSERVATION_SOURCES: readonly ObservationSource[] = Object.freeze([]);

export const MISSING_METRICS_CAPABILITY =
  "No verified metrics source exists for production. Required: either an authenticated provider fetch (SpecSmith calling the " +
  "provider's analytics API with the account's own credentials, so the numbers come straight from the provider) or a verifiable " +
  "export (a provider export carrying a signature or checksum SpecSmith can check against the provider). The current Metricool plan " +
  "has no REST API and the connector returns unsigned text, so neither exists. Until one is implemented and added to " +
  "PRODUCTION_OBSERVATION_SOURCES, production metrics cannot enter the learning report; numbers supplied by hand are kept only as unverified.";

interface Issued { readonly source: ObservationSource; readonly sha256: string }
const ISSUED_BATCHES = new WeakMap<object, Issued>();
const SIMULATED_SOURCES = new WeakSet<ObservationSource>();

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** Issue a batch from a registered source: a frozen copy, remembered with its digest. */
function issue(source: ObservationSource, body: ProviderObservationBatch): ProviderObservationBatch {
  const batch = deepFreeze(structuredClone(body));
  ISSUED_BATCHES.set(batch, { source, sha256: sha256Json(batch) });
  return batch;
}

export interface SimulatedObservationSource extends ObservationSource {
  /** What the simulated provider will answer for a post. */
  stage(body: ProviderObservationBatch): void;
  /** Stage and fetch in one step, for tests. */
  respond(body: ProviderObservationBatch): ProviderObservationBatch;
}

/**
 * A SIMULATED metrics source for tests and offline demonstrations. It
 * authenticates nothing: its batches say so, and a production store refuses
 * them.
 */
export function createSimulatedObservationSource(): SimulatedObservationSource {
  const staged = new Map<string, ProviderObservationBatch>();
  const source: SimulatedObservationSource = {
    sourceId: "SIMULATED metrics source (authenticates nothing; test and demo only)",
    mechanism: "simulated",
    simulated: true,
    stage(body) { staged.set(body.providerPostId, body); },
    respond(body) { return issue(source, body); },
    async fetch(request) {
      const body = staged.get(request.providerPostId);
      if (!body) throw new Error(`SIMULATED: nothing staged for post ${request.providerPostId}.`);
      return issue(source, body);
    },
  };
  SIMULATED_SOURCES.add(source);
  return Object.freeze(source);
}

/** Fetch from a source and import, checking the answer is about the post asked for. */
export async function collectProviderObservations(input: {
  readonly storeRoot: string;
  readonly source: ObservationSource;
  readonly request: ObservationRequest;
  readonly now?: Date;
}): Promise<ImportReport> {
  const { request } = input;
  await trustedIssuer(input.storeRoot, null, input.source);
  const batch = await input.source.fetch(request);
  if (batch.providerPostId !== request.providerPostId || batch.accountId !== request.accountId || batch.platform !== request.platform || batch.provider !== request.provider) {
    throw new ObservationRefusedError("identity-mismatch", `Asked ${request.provider} for post ${request.providerPostId}; the source answered about post ${batch.providerPostId}.`);
  }
  return importProviderObservations({ storeRoot: input.storeRoot, batch, now: input.now });
}

/** The registered source that issued this batch, if the store accepts it; otherwise a refusal. */
async function trustedIssuer(storeRoot: string, batch: ProviderObservationBatch | null, claimed?: ObservationSource): Promise<ObservationSource> {
  const mode = await publicationStoreMode(storeRoot);
  const issued = batch ? ISSUED_BATCHES.get(batch) : undefined;
  if (batch && issued && sha256Json(batch) !== issued.sha256) {
    throw new ObservationRefusedError("unverified-source", "This batch changed after its source issued it.");
  }
  const source = claimed ?? issued?.source;
  if (mode === "production") {
    if (source && (source.simulated || SIMULATED_SOURCES.has(source))) {
      throw new ObservationRefusedError("synthetic-in-production", "Simulated, fixture or synthetic numbers are never imported into production analytics.");
    }
    if (!source || !PRODUCTION_OBSERVATION_SOURCES.includes(source)) {
      throw new ObservationRefusedError("no-verified-source", batch && !issued
        ? `This batch was assembled by a caller, not fetched by a verified source; its own labels prove nothing. ${MISSING_METRICS_CAPABILITY}`
        : MISSING_METRICS_CAPABILITY);
    }
    return source;
  }
  if (!source || !SIMULATED_SOURCES.has(source)) {
    throw new ObservationRefusedError(source && !source.simulated ? "store-mode" : "unverified-source", source && !source.simulated
      ? "A simulation store takes only simulated observations; real numbers must not be mixed with simulated ones."
      : "This batch was not issued by a registered source (a simulated source, in a simulation store).");
  }
  return source;
}

export type ObservationState = "observed" | "unavailable" | "derived";

export interface ObservationRecord {
  readonly version: typeof OBSERVATION_RECORD_VERSION;
  readonly observationId: string;
  readonly platform: VideoPlatform;
  readonly provider: "metricool";
  readonly accountId: string;
  readonly providerPostId: string;
  readonly creativeId: string;
  readonly variantId: string;
  readonly mediaSha256: string;
  readonly metricId: string;
  readonly providerField: string | null;
  /** Null unless observed or derived. Never a stand-in zero. */
  readonly value: number | null;
  readonly unit: MetricUnit | "share-curve" | null;
  /** MASTER #5 registry definition, scoped to this platform; null when SpecSmith has none for the field. */
  readonly definitionId: string | null;
  readonly definition: string | null;
  readonly state: ObservationState;
  readonly unavailableReason?: string;
  readonly derivedFrom?: readonly string[];
  readonly formula?: string;
  readonly curve?: { readonly seconds: readonly number[]; readonly shareWatching: readonly number[] };
  readonly source: string;
  /** How the source established the numbers came from the provider. */
  readonly sourceMechanism: ObservationSource["mechanism"];
  readonly simulated: boolean;
  readonly collectedAt: string;
  readonly publishedAt: string;
  readonly publicationAgeHours: number;
  readonly rawSha256: string;
}

export class ObservationRefusedError extends Error {
  constructor(readonly code: "malformed" | "store-mode" | "synthetic-in-production" | "no-verified-source" | "unverified-source" | "unknown-post" | "legacy-unverified" | "not-published" | "identity-mismatch" | "impossible-timing" | "conflicting-observation", message: string) {
    super(message);
    this.name = "ObservationRefusedError";
  }
}

const SYNTHETIC_MARKER = /SYNTHETIC|FIXTURE|SIMULATED|SIM-POST/i;

async function writeExclusive(path: string, value: unknown): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    await handle?.close();
  }
}

const postDirectory = (root: string, providerPostId: string) => join(root, "observations", sha256Text(providerPostId).slice(0, 32));

export interface ImportReport {
  readonly creativeId: string;
  readonly stored: readonly ObservationRecord[];
  readonly alreadyPresent: number;
  readonly rawSha256: string;
}

/**
 * Validate and store one batch, or refuse it whole. The batch must have been
 * issued by a registered source (see collectProviderObservations); a batch a
 * caller assembled is refused however it describes itself.
 */
export async function importProviderObservations(input: {
  readonly storeRoot: string;
  readonly batch: ProviderObservationBatch;
  readonly now?: Date;
}): Promise<ImportReport> {
  const { storeRoot, batch } = input;
  const now = input.now ?? new Date();
  if (batch?.kind !== OBSERVATION_BATCH_KIND || !batch.providerPostId?.trim() || !batch.accountId?.trim() || typeof batch.metrics !== "object") {
    throw new ObservationRefusedError("malformed", "Not a PROVIDER_OBSERVATIONS batch with a post id, an account and metrics.");
  }
  const source = await trustedIssuer(storeRoot, batch);
  // Belt and braces for a future production source: values only, never field names.
  if (!source.simulated && SYNTHETIC_MARKER.test(JSON.stringify([batch.providerPostId, batch.accountId, batch.raw]))) {
    throw new ObservationRefusedError("synthetic-in-production", "Simulated, fixture or synthetic numbers are never imported into production analytics.");
  }

  const creativeId = await creativeForProviderPost(storeRoot, batch.provider, batch.providerPostId);
  if (!creativeId) throw new ObservationRefusedError("unknown-post", `Post ${batch.providerPostId} is not one SpecSmith published; its numbers cannot be attributed to a creative.`);
  const ledger = await loadStoredPublicationLedger(storeRoot, creativeId);
  if (ledger?.legacy) {
    throw new ObservationRefusedError("legacy-unverified", `${creativeId} has a legacy ledger (${ledger.legacy.reason}); its publication was never confirmed under MASTER #8, so its numbers are not attributed.`);
  }
  const published = ledger?.events.find((event) => event.status === "published" && event.providerPostId === batch.providerPostId);
  if (!ledger || !published) throw new ObservationRefusedError("not-published", `${creativeId} has no provider-confirmed publication of post ${batch.providerPostId}.`);
  const authorization = await loadAuthorization(storeRoot, creativeId);
  if (!authorization || authorization.destination.accountId !== batch.accountId || authorization.platform !== batch.platform || ledger.platform !== batch.platform) {
    throw new ObservationRefusedError("identity-mismatch", `The batch is for ${batch.platform} account ${batch.accountId}; ${creativeId} was authorized for ${authorization?.platform} account ${authorization?.destination.accountId}.`);
  }
  const collected = Date.parse(batch.collectedAt);
  const publishedAt = Date.parse(published.at);
  if (!Number.isFinite(collected) || collected < publishedAt || collected > now.getTime()) {
    throw new ObservationRefusedError("impossible-timing", `Collected at ${batch.collectedAt}, but the post was published at ${published.at} and it is now ${now.toISOString()}.`);
  }

  const rawSha256 = sha256Json({ source: source.sourceId, batch });
  const directory = postDirectory(storeRoot, batch.providerPostId);
  await mkdir(join(directory, "raw"), { recursive: true });
  await writeExclusive(join(directory, "raw", `${rawSha256}.json`), { source: source.sourceId, mechanism: source.mechanism, batch });

  const ageHours = Math.round(((collected - publishedAt) / 3_600_000) * 100) / 100;
  const base = {
    version: OBSERVATION_RECORD_VERSION, platform: batch.platform, provider: batch.provider, accountId: batch.accountId,
    providerPostId: batch.providerPostId, creativeId, variantId: authorization.variantId, mediaSha256: authorization.mediaSha256,
    source: source.sourceId, sourceMechanism: source.mechanism, simulated: source.simulated, collectedAt: batch.collectedAt, publishedAt: published.at,
    publicationAgeHours: ageHours, rawSha256,
  } as const;
  const idFor = (metricId: string) => `obs-${sha256Text(`${batch.providerPostId}|${metricId}|${batch.collectedAt}`).slice(0, 24)}`;
  const records: ObservationRecord[] = [];
  const definitions = metricsForPlatform(batch.platform);
  const seenFields = new Set<string>();

  for (const definition of definitions) {
    if (!definition.providerField) continue;
    seenFields.add(definition.providerField);
    const raw = batch.metrics[definition.providerField];
    const common = {
      ...base, observationId: idFor(definition.metricId), metricId: definition.metricId, providerField: definition.providerField,
      unit: definition.unit, definitionId: `${definition.platform}:${definition.metricId}`, definition: definition.meaning,
    };
    if (definition.metricId === "site-clicks" && typeof raw === "number") {
      const a = batch.attribution;
      if (!a || a.utmContent !== creativeId || !a.measuredBy.trim() || new URL(a.trackedUrl).searchParams.get("utm_content") !== creativeId) {
        records.push({ ...common, value: null, state: "unavailable", unavailableReason: "A click count was supplied without attribution to this creative's tracked URL and a measuring source; it was not recorded." });
        continue;
      }
    }
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) records.push({ ...common, value: raw, state: "observed" });
    else records.push({ ...common, value: null, state: "unavailable", unavailableReason: raw === undefined ? "The provider did not return this field." : "The provider reported it unavailable." });
  }
  // Fields SpecSmith has no definition for are kept, and never compared.
  for (const [field, raw] of Object.entries(batch.metrics)) {
    if (seenFields.has(field)) continue;
    records.push({ ...base, observationId: idFor(`provider:${field}`), metricId: `provider:${field}`, providerField: field,
      value: typeof raw === "number" ? raw : null, unit: null, definitionId: null, definition: null,
      state: typeof raw === "number" ? "observed" : "unavailable",
      ...(typeof raw === "number" ? {} : { unavailableReason: "Not returned." }) });
  }
  if (batch.retentionCurve && batch.retentionCurve !== "unavailable" && batch.retentionCurve.seconds.length === batch.retentionCurve.shareWatching.length && batch.retentionCurve.seconds.length > 1) {
    records.push({ ...base, observationId: idFor("retention-curve"), metricId: "retention-curve", providerField: "retentionCurve", value: null,
      unit: "share-curve", definitionId: `${batch.platform}:retention-curve`, definition: "Share of viewers still watching at each second, as this platform's provider reports it.",
      state: "observed", curve: { seconds: [...batch.retentionCurve.seconds], shareWatching: [...batch.retentionCurve.shareWatching] } });
  } else {
    records.push({ ...base, observationId: idFor("retention-curve"), metricId: "retention-curve", providerField: "retentionCurve", value: null,
      unit: "share-curve", definitionId: `${batch.platform}:retention-curve`, definition: null, state: "unavailable",
      unavailableReason: "The provider returned no retention curve; where viewers left is unknown." });
  }
  // Derived from observed values only, and labelled with its formula.
  const views = records.find((record) => record.metricId === "views" && record.state === "observed");
  if (views && ageHours > 0) {
    records.push({ ...base, observationId: idFor("views-per-hour"), metricId: "views-per-hour", providerField: null, value: Math.round((views.value! / ageHours) * 100) / 100,
      unit: "count", definitionId: `${batch.platform}:views-per-hour(derived)`, definition: "Observed views divided by hours since publication.",
      state: "derived", derivedFrom: [views.observationId], formula: `views / publicationAgeHours (${views.value} / ${ageHours})` });
  }

  const stored: ObservationRecord[] = [];
  let alreadyPresent = 0;
  for (const record of records) {
    const path = join(directory, `${record.observationId}.json`);
    if (await writeExclusive(path, record)) { stored.push(record); continue; }
    const existing = JSON.parse(await readFile(path, "utf8")) as ObservationRecord;
    if (existing.value !== record.value || existing.state !== record.state) {
      throw new ObservationRefusedError("conflicting-observation",
        `${record.metricId} for post ${batch.providerPostId} at ${batch.collectedAt} is already recorded as ${existing.value ?? existing.state}; this batch says ${record.value ?? record.state}. Recorded observations are not edited.`);
    }
    alreadyPresent += 1;
  }

  const status = ledger.events.at(-1)!.status;
  if (stored.length && (status === "published" || status === "analytics-partial")) {
    const complete = ageHours >= 168;
    if (status === "published" || complete) {
      await recordMetricsObserved({ storeRoot, creativeId, observationIds: stored.map((record) => record.observationId), complete, now });
    }
  }
  return { creativeId, stored, alreadyPresent, rawSha256 };
}

export const UNVERIFIED_OBSERVATION_VERSION = "unverified-observation-v1";

export interface UnverifiedObservationRecord {
  readonly version: typeof UNVERIFIED_OBSERVATION_VERSION;
  readonly verification: "unverified";
  readonly reason: string;
  readonly suppliedBy: string;
  readonly receivedAt: string;
  readonly providerPostId: string;
  readonly sha256: string;
  /** Kept verbatim. Never stored as observations, never compared, never moves the ledger. */
  readonly supplied: unknown;
}

/**
 * Keep numbers a person supplied (typed from a dashboard, pasted from the
 * connector, an unsigned CSV) so they are not lost, labelled UNVERIFIED. They
 * are stored apart from observations: loadObservations never returns them, the
 * learning report only counts them as unknowns, and the ledger is not touched.
 */
export async function recordUnverifiedObservations(input: {
  readonly storeRoot: string;
  readonly providerPostId: string;
  readonly suppliedBy: string;
  readonly supplied: unknown;
  readonly now?: Date;
}): Promise<UnverifiedObservationRecord> {
  if (!input.providerPostId?.trim() || !input.suppliedBy?.trim()) {
    throw new ObservationRefusedError("malformed", "Unverified numbers must name the post they claim to describe and who supplied them.");
  }
  const sha256 = sha256Json(input.supplied ?? null);
  const record: UnverifiedObservationRecord = {
    version: UNVERIFIED_OBSERVATION_VERSION, verification: "unverified",
    reason: "Supplied by a person or an unsigned export, not fetched by a verified source. Not evidence of performance.",
    suppliedBy: input.suppliedBy, receivedAt: (input.now ?? new Date()).toISOString(), providerPostId: input.providerPostId, sha256,
    supplied: input.supplied ?? null,
  };
  const directory = join(postDirectory(input.storeRoot, input.providerPostId), "unverified");
  await mkdir(directory, { recursive: true });
  await writeExclusive(join(directory, `${sha256.slice(0, 32)}.json`), record);
  return record;
}

export async function loadUnverifiedObservations(storeRoot: string, providerPostId: string): Promise<UnverifiedObservationRecord[]> {
  const directory = join(postDirectory(storeRoot, providerPostId), "unverified");
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return Promise.all(names.filter((name) => name.endsWith(".json")).sort()
    .map(async (name) => JSON.parse(await readFile(join(directory, name), "utf8")) as UnverifiedObservationRecord));
}

/** Record that a collection failed or was temporarily unavailable. No numbers are written. */
export async function recordObservationFailure(input: {
  readonly storeRoot: string;
  readonly providerPostId: string;
  readonly attemptedAt: string;
  readonly reason: string;
  readonly temporary: boolean;
}): Promise<void> {
  const directory = join(postDirectory(input.storeRoot, input.providerPostId), "failures");
  await mkdir(directory, { recursive: true });
  await writeExclusive(join(directory, `${sha256Json(input).slice(0, 24)}.json`), { ...input, recordedValues: "none" });
}

export async function loadObservations(storeRoot: string, providerPostId: string): Promise<ObservationRecord[]> {
  const directory = postDirectory(storeRoot, providerPostId);
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => name.startsWith("obs-") && name.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records = await Promise.all(names.map(async (name) => JSON.parse(await readFile(join(directory, name), "utf8")) as ObservationRecord));
  return records.sort((a, b) => Date.parse(a.collectedAt) - Date.parse(b.collectedAt) || a.metricId.localeCompare(b.metricId));
}

export async function loadObservationFailures(storeRoot: string, providerPostId: string): Promise<{ attemptedAt: string; reason: string; temporary: boolean }[]> {
  const directory = join(postDirectory(storeRoot, providerPostId), "failures");
  try {
    const names = await readdir(directory);
    return Promise.all(names.map(async (name) => JSON.parse(await readFile(join(directory, name), "utf8"))));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** The newest observation of a metric. An older import never displaces it. */
export function latestObservation(records: readonly ObservationRecord[], metricId: string): ObservationRecord | null {
  return records.filter((record) => record.metricId === metricId)
    .reduce<ObservationRecord | null>((latest, record) => (!latest || Date.parse(record.collectedAt) > Date.parse(latest.collectedAt) ? record : latest), null);
}
