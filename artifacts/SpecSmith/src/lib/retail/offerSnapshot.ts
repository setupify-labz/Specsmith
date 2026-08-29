// The GPU offer snapshot: schema, validation, and the freshness rule.
//
// BROWSER-SAFE AND PURE. No I/O, no clock, no environment, no credential, and
// no import from scripts/. It is the ONE definition of the snapshot's shape,
// imported by both sides on purpose: the server-only writer validates through
// the same `parseOfferSnapshot` the browser runs, so a file that would be
// refused at read time cannot be written in the first place.
//
// WHAT A SNAPSHOT IS
// ------------------
// A dated list of real retailer LISTINGS for catalogue GPUs, captured in one
// sweep. It is not the catalogue's `price_usd` (an editorial estimate about a
// PART, refreshed by hand) and it is not a search link. It is observational:
// "this SKU was listed at this price when we asked, at this instant".
//
// AVAILABILITY IS UNKNOWN, ALWAYS
// -------------------------------
// The feed behind this is a catalogue of listings, not an inventory. A part
// can be on a shelf and absent from it, and a part can be listed and out of
// stock. So `availability` is the literal 'unknown' on every offer and on the
// snapshot itself, and the validator REFUSES any other value. That is not a
// default waiting to be improved — it is the only honest answer this data
// supports, and making it a required literal means a future writer that tries
// to publish a stock claim fails validation rather than shipping one.
//
// NOTHING HERE IS INFERRED
// ------------------------
// Every field is the merchant's own value, carried through unchanged. A field
// the feed does not publish is null. A record missing something required is
// refused whole rather than completed with a guess.

/** Bump on any change to the persisted shape. A reader refuses a version it does not know. */
export const OFFER_SNAPSHOT_SCHEMA_VERSION = 1;

/** The only availability value this system can honestly publish. */
export const AVAILABILITY_UNKNOWN = 'unknown';

/**
 * The sentence a UI must show beside any price from this snapshot.
 *
 * Exported as a constant so there is one wording, and so a test can assert
 * that neither it nor anything else here claims stock.
 */
export const AVAILABILITY_NOTICE =
  'Availability is unknown. These are listings the retailer published when we last checked, not an inventory: the price may have changed and the item may or may not be purchasable.';

/**
 * How old a snapshot may be and still be shown.
 *
 * Retail prices move daily, and a stale price shown as current is worse than
 * no price at all: it is a specific, checkable claim that is wrong. Twenty-six
 * hours gives a once-a-day refresh room to be late without going dark, and
 * refuses anything that has plainly missed a cycle.
 */
export const DEFAULT_MAX_SNAPSHOT_AGE_MS = 26 * 60 * 60 * 1000;

/**
 * Tolerance for a `generatedAt` in the future.
 *
 * A snapshot stamped ahead of the reader's clock is either clock skew (small)
 * or a bogus timestamp (large). A large one is refused rather than treated as
 * maximally fresh — otherwise the single easiest way to defeat the staleness
 * rule would be to write a date far enough ahead.
 */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Why a GPU has the offers it has — including why it has none. */
export type GpuOfferResult =
  /** At least one listing was verified as this part. */
  | 'offers'
  /** The feed returned no listing matching this part. Says nothing about stock. */
  | 'no-matching-listing'
  /** Listings came back and every one was refused (wrong variant, wrong capacity, not new). */
  | 'listings-all-rejected';

export const ALL_GPU_OFFER_RESULTS: readonly GpuOfferResult[] = [
  'offers',
  'no-matching-listing',
  'listings-all-rejected',
];

/** One published listing. Every field is the merchant's own. */
export interface SnapshotOffer {
  /** The retailer's item number. The listing's identity. */
  sku: string;
  /** Manufacturer UPC when the feed published one; null when it did not. */
  upc: string | null;
  /** The merchant's product title, verbatim. */
  productName: string;
  /** List price. */
  retailPrice: number;
  /** Discounted price, or null when nothing is discounted. Never 0. */
  salePrice: number | null;
  /** ISO 4217 code, as published. */
  currency: string;
  imageUrl: string;
  /** The tracked deep link the network generated. Used verbatim; attribution lives in it. */
  trackedAffiliateUrl: string;
  /** When this listing was read. A price with no timestamp is not evidence. */
  fetchedAt: string;
  /** Always 'unknown'. See the header. */
  availability: typeof AVAILABILITY_UNKNOWN;
}

export interface SnapshotGpu {
  /** The catalogue GPU id these listings were verified against. */
  gpuId: string;
  result: GpuOfferResult;
  /** Accepted listings only. Rejected ones are never persisted. */
  offers: SnapshotOffer[];
}

export interface GpuOfferSnapshot {
  schemaVersion: number;
  /** The adapter rules that produced it, so offers built by older rules are detectable. */
  adapterVersion: number;
  /** When the sweep ran. ISO 8601, UTC. */
  generatedAt: string;
  availability: typeof AVAILABILITY_UNKNOWN;
  gpus: SnapshotGpu[];
}

/**
 * Why a candidate snapshot was refused. A closed set, never free text.
 *
 * Free text here would be a field able to carry anything a malformed file
 * contained, into a page. A code cannot.
 */
export type SnapshotProblem =
  | 'not-an-object'
  | 'schema-version-unsupported'
  | 'adapter-version-invalid'
  | 'generated-at-invalid'
  | 'availability-not-unknown'
  | 'gpus-not-an-array'
  | 'gpu-entry-invalid'
  | 'duplicate-gpu-id'
  | 'result-contradicts-offers'
  | 'offer-invalid';

export type SnapshotParse =
  | { ok: true; snapshot: GpuOfferSnapshot }
  | { ok: false; problem: SnapshotProblem };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A non-empty string with no surrounding whitespace to trim away. */
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** A real, finite, non-negative amount. NaN, Infinity and negatives are not prices. */
const isPrice = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** An ISO 8601 instant the runtime can actually parse. */
export const isInstant = (v: unknown): v is string =>
  isText(v) && Number.isFinite(Date.parse(v));

/**
 * An http(s) URL and nothing else.
 *
 * A snapshot is a file, and a file can be edited. `javascript:` and `data:`
 * URLs in an href are how a bad one would become a bad page, so the scheme is
 * checked here rather than trusted at render time.
 */
export const isHttpUrl = (v: unknown): boolean => {
  if (!isText(v)) return false;
  try {
    const scheme = new URL(v).protocol;
    return scheme === 'http:' || scheme === 'https:';
  } catch {
    return false;
  }
};

function parseOffer(raw: unknown): SnapshotOffer | null {
  if (!isObject(raw)) return null;
  const { sku, upc, productName, retailPrice, salePrice, currency, imageUrl, trackedAffiliateUrl, fetchedAt, availability } = raw;

  if (!isText(sku) || !isText(productName) || !isText(currency)) return null;
  if (upc !== null && !isText(upc)) return null;
  if (!isPrice(retailPrice)) return null;
  // Null means "nothing discounted". A zero would make every un-discounted
  // card look free, so it is not a value this schema accepts at all.
  if (salePrice !== null && (!isPrice(salePrice) || salePrice === 0)) return null;
  if (!isHttpUrl(imageUrl) || !isHttpUrl(trackedAffiliateUrl)) return null;
  if (!isInstant(fetchedAt)) return null;
  if (availability !== AVAILABILITY_UNKNOWN) return null;

  return {
    sku,
    upc: upc === null ? null : (upc as string),
    productName,
    retailPrice,
    salePrice: salePrice === null ? null : (salePrice as number),
    currency,
    imageUrl: imageUrl as string,
    trackedAffiliateUrl: trackedAffiliateUrl as string,
    fetchedAt,
    availability: AVAILABILITY_UNKNOWN,
  };
}

/**
 * Validates an untrusted value as a snapshot.
 *
 * Structural, field by field. The browser reads this file over the network at
 * runtime, so "it was correct when we wrote it" is not a property it can rely
 * on — a truncated download, a stale cache entry or a hand-edited file all
 * arrive looking like JSON.
 */
export function parseOfferSnapshot(raw: unknown): SnapshotParse {
  if (!isObject(raw)) return { ok: false, problem: 'not-an-object' };
  if (raw.schemaVersion !== OFFER_SNAPSHOT_SCHEMA_VERSION) return { ok: false, problem: 'schema-version-unsupported' };
  if (typeof raw.adapterVersion !== 'number' || !Number.isInteger(raw.adapterVersion) || raw.adapterVersion < 1) {
    return { ok: false, problem: 'adapter-version-invalid' };
  }
  if (!isInstant(raw.generatedAt)) return { ok: false, problem: 'generated-at-invalid' };
  if (raw.availability !== AVAILABILITY_UNKNOWN) return { ok: false, problem: 'availability-not-unknown' };
  if (!Array.isArray(raw.gpus)) return { ok: false, problem: 'gpus-not-an-array' };

  const gpus: SnapshotGpu[] = [];
  const seen = new Set<string>();
  for (const entry of raw.gpus) {
    if (!isObject(entry) || !isText(entry.gpuId) || !Array.isArray(entry.offers)) {
      return { ok: false, problem: 'gpu-entry-invalid' };
    }
    if (!ALL_GPU_OFFER_RESULTS.includes(entry.result as GpuOfferResult)) {
      return { ok: false, problem: 'gpu-entry-invalid' };
    }
    if (seen.has(entry.gpuId)) return { ok: false, problem: 'duplicate-gpu-id' };
    seen.add(entry.gpuId);

    const offers: SnapshotOffer[] = [];
    for (const rawOffer of entry.offers) {
      const offer = parseOffer(rawOffer);
      if (offer === null) return { ok: false, problem: 'offer-invalid' };
      offers.push(offer);
    }

    // The result and the list have to agree. A group saying 'offers' with an
    // empty list, or 'no-matching-listing' with three of them, means the two
    // were written by different code paths and one of them is wrong — and a
    // reader would have no way to tell which.
    const result = entry.result as GpuOfferResult;
    if ((result === 'offers') !== (offers.length > 0)) return { ok: false, problem: 'result-contradicts-offers' };

    gpus.push({ gpuId: entry.gpuId, result, offers });
  }

  return {
    ok: true,
    snapshot: {
      schemaVersion: OFFER_SNAPSHOT_SCHEMA_VERSION,
      adapterVersion: raw.adapterVersion,
      generatedAt: raw.generatedAt,
      availability: AVAILABILITY_UNKNOWN,
      gpus,
    },
  };
}

/**
 * What a reader is allowed to show.
 *
 * 'absent' is a real state, not an error: no snapshot has been published yet.
 * It is deliberately distinct from 'invalid', because they call for opposite
 * responses — one waits, the other is a bug.
 */
export type SnapshotView =
  | { status: 'ok'; snapshot: GpuOfferSnapshot; ageMs: number }
  | { status: 'stale'; generatedAt: string; ageMs: number }
  | { status: 'invalid'; problem: SnapshotProblem }
  | { status: 'absent' };

export interface FreshnessOptions {
  /** Reader's clock, in epoch milliseconds. */
  now: number;
  maxAgeMs?: number;
}

/**
 * Parses, then applies the freshness rule.
 *
 * THE OLDEST TIMESTAMP WINS. Age is measured from `generatedAt` AND from every
 * offer's own `fetchedAt`, and the oldest of them decides. A writer that
 * carried yesterday's offers forward under today's header would otherwise
 * publish stale prices under a fresh date — which is precisely the failure
 * this rule exists to prevent, and the one a header-only check cannot see.
 *
 * A snapshot stamped further ahead than MAX_CLOCK_SKEW_MS is invalid rather
 * than fresh: a future date must not be a way to buy immortality.
 */
export function viewSnapshot(raw: unknown, options: FreshnessOptions): SnapshotView {
  const parsed = parseOfferSnapshot(raw);
  if (!parsed.ok) return { status: 'invalid', problem: parsed.problem };

  const { snapshot } = parsed;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_SNAPSHOT_AGE_MS;

  const stamps = [Date.parse(snapshot.generatedAt)];
  for (const gpu of snapshot.gpus) for (const offer of gpu.offers) stamps.push(Date.parse(offer.fetchedAt));

  const newest = Math.max(...stamps);
  if (newest - options.now > MAX_CLOCK_SKEW_MS) return { status: 'invalid', problem: 'generated-at-invalid' };

  const ageMs = options.now - Math.min(...stamps);
  if (ageMs > maxAgeMs) return { status: 'stale', generatedAt: snapshot.generatedAt, ageMs };

  return { status: 'ok', snapshot, ageMs };
}

/** The offers for one GPU, or an empty list — never a guess, never a stale one. */
export function offersForGpu(view: SnapshotView, gpuId: string): SnapshotOffer[] {
  if (view.status !== 'ok') return [];
  return view.snapshot.gpus.find((g) => g.gpuId === gpuId)?.offers ?? [];
}

/** The price a shopper would pay: the discounted one when there is one. */
export function effectivePrice(offer: SnapshotOffer): number {
  return offer.salePrice ?? offer.retailPrice;
}
