// Turns one sweep into a publishable snapshot — or refuses to.
//
// PURE. No I/O, no clock, no environment. The CLI supplies the sweep, the
// timestamp and the previous snapshot; every decision about whether the result
// may be published is made here, so it can be tested without a network.
//
// PUBLISHING IS A DECISION, NOT A SERIALIZATION STEP
// --------------------------------------------------
// A snapshot replaces the one people currently see. That makes writing it the
// riskiest thing this pilot does: a bad sweep does not merely fail, it
// overwrites a known-good file with a worse one, and the failure is invisible
// because the site keeps working — with fewer, or wrong, prices. So this
// module refuses in three situations, each of which has produced exactly that
// outcome in systems like it:
//
//   1. ANY GPU REQUEST FAILED. A partial sweep is not a smaller snapshot, it
//      is an unknown one: a GPU whose request failed has no offers in the
//      result for the same reason a GPU with genuinely no listings has none,
//      and publishing merges the two. Availability is already unknown here;
//      coverage must not become unknown too.
//   2. THE STORE COLLAPSED. Feeds move by a few percent between runs. Losing
//      half of them in one sweep is a symptom — an upstream outage answering
//      200 with an empty catalogue, a keyword change, a matcher regression —
//      and none of those are facts worth publishing over a good file.
//   3. THE RESULT DOES NOT VALIDATE. Checked with the same parser the browser
//      runs, so a file that would be refused at read time is never written.

import {
  parseOfferSnapshot,
  AVAILABILITY_UNKNOWN,
  OFFER_SNAPSHOT_SCHEMA_VERSION,
  type GpuOfferResult,
  type GpuOfferSnapshot,
  type SnapshotGpu,
  type SnapshotOffer,
  type SnapshotProblem,
} from '../../../src/lib/retail/offerSnapshot';
import { RAKUTEN_ADAPTER_VERSION, type NeweggOffer } from '../rakuten/types';
import type { GpuFailure } from '../coverage/coverageReport';

/**
 * What the sweep produced for one catalogue GPU.
 *
 * `failure` and `offers` are mutually exclusive by construction: a GPU either
 * answered or it did not, and there is no shape here that says both.
 */
export type GpuSweepOutcome =
  | {
      gpuId: string;
      status: 'ok';
      /** Accepted listings only. Rejections are counted by the sweep and never persisted. */
      offers: readonly NeweggOffer[];
      /** True when the feed returned no matching listing at all. */
      emptyResult: boolean;
      /** Listings seen before admission, so 'all rejected' can be told from 'nothing listed'. */
      itemsSeen: number;
    }
  | { gpuId: string; status: 'failed'; failure: GpuFailure };

/**
 * A store may not lose more than half of itself in one sweep.
 *
 * Half is deliberately generous. The rule is not tuned to catch a bad day; it
 * is there to catch a broken one, where the honest answer is "keep yesterday's
 * file and tell someone" rather than "publish this".
 */
export const MAX_SHRINK_RATIO = 0.5;

/**
 * Below these, the previous snapshot is too small to reason about.
 *
 * Going from 2 GPUs with offers to 0 is a 100% drop and means almost nothing;
 * going from 40 to 3 means a great deal. Without a floor the guard would fire
 * constantly on a store that is legitimately tiny, and a guard that fires on
 * noise is a guard people switch off.
 */
export const MIN_BASELINE_GPUS_WITH_OFFERS = 5;
export const MIN_BASELINE_OFFERS = 20;

/** Why a candidate was not published. A closed set; the payload is numbers. */
export type SnapshotRefusalCode =
  /** At least one GPU's request failed, so coverage is unknown rather than measured. */
  | 'gpu-request-failed'
  /** The expected id list is itself unusable — empty, or naming the same GPU twice. */
  | 'expected-ids-invalid'
  /** A catalogue GPU the sweep was supposed to cover has no outcome. */
  | 'outcome-missing-gpu'
  /** An outcome arrived for a GPU that was not in the expected list. */
  | 'outcome-unexpected-gpu'
  /** Two outcomes arrived for the same GPU. */
  | 'outcome-duplicate-gpu'
  /** Far fewer GPUs have offers than last time. */
  | 'gpu-coverage-collapse'
  /** Far fewer offers in total than last time. */
  | 'offer-count-collapse'
  /** An offer was filed under a GPU it was not verified against. A defect, not a condition. */
  | 'offer-gpu-mismatch'
  /** The built snapshot does not satisfy the schema the browser enforces. */
  | 'schema-invalid';

export interface SnapshotRefusal {
  code: SnapshotRefusalCode;
  /** Counts, never text: this reaches a CI log and a terminal. */
  failedGpus: number;
  gpusWithOffers: number;
  previousGpusWithOffers: number;
  offers: number;
  previousOffers: number;
  /** Set only for 'schema-invalid'; the parser's closed problem code. */
  problem: SnapshotProblem | null;
  /**
   * The offending catalogue ids, for the coverage codes above; empty otherwise.
   *
   * These are SpecSmith's own ids, read from src/data/gpus.json — the same
   * strings the coverage report already carries. Nothing from the feed reaches
   * this field: an outcome's gpuId is the catalogue entry that was swept, not
   * anything a listing said.
   */
  gpuIds: readonly string[];
}

export type SnapshotBuild =
  | { ok: true; snapshot: GpuOfferSnapshot }
  | { ok: false; refusal: SnapshotRefusal };

export interface BuildInput {
  /**
   * Every catalogue GPU this sweep was supposed to cover.
   *
   * Required, not optional. The sweep's own output cannot answer "did we cover
   * the catalogue?" — a loop that stopped early produces a shorter list of
   * perfectly valid outcomes, and the resulting snapshot would silently drop
   * the GPUs it never reached while looking, to every later reader, exactly
   * like a catalogue that no longer contains them. Only the caller knows what
   * was asked for, so the caller has to say.
   */
  expectedGpuIds: readonly string[];
  outcomes: readonly GpuSweepOutcome[];
  /** ISO 8601. Supplied by the caller so this stays pure. */
  generatedAt: string;
  /** The snapshot currently published, when there is one. The collapse baseline. */
  previous?: GpuOfferSnapshot | null;
  adapterVersion?: number;
}

/** Counts what a snapshot holds, for the collapse comparison. */
export function snapshotSize(snapshot: GpuOfferSnapshot): { gpusWithOffers: number; offers: number } {
  const groups = snapshot.gpus.filter((g) => g.offers.length > 0);
  return { gpusWithOffers: groups.length, offers: groups.reduce((n, g) => n + g.offers.length, 0) };
}

/**
 * Narrows a verified offer to what is published.
 *
 * The stored record is smaller than the adapter's: the category fields and the
 * merchant id were admission EVIDENCE, spent when the listing was accepted,
 * and the canonical GPU id becomes the group key. Publishing less is the point
 * — a field nobody reads is a field that can only leak.
 */
export function toSnapshotOffer(offer: NeweggOffer): SnapshotOffer {
  return {
    sku: offer.sku,
    upc: offer.upc,
    productName: offer.productName,
    retailPrice: offer.retailPrice,
    salePrice: offer.salePrice,
    currency: offer.currency,
    imageUrl: offer.imageUrl,
    trackedAffiliateUrl: offer.trackedAffiliateUrl,
    fetchedAt: offer.fetchedAt,
    // Not copied from anywhere. There is no field in a listing that says
    // whether the item is in stock, so there is nothing to copy.
    availability: AVAILABILITY_UNKNOWN,
  };
}

/**
 * Why this GPU shows no offers.
 *
 * The distinction survives into the published file because it is the one a
 * reader most needs and cannot reconstruct: "nothing listed" and "listings
 * came back and none of them were this card" look identical from the outside
 * and mean very different things about coverage. Neither says anything about
 * stock.
 */
function resultFor(outcome: Extract<GpuSweepOutcome, { status: 'ok' }>): GpuOfferResult {
  if (outcome.offers.length > 0) return 'offers';
  return outcome.emptyResult && outcome.itemsSeen === 0 ? 'no-matching-listing' : 'listings-all-rejected';
}

export function buildSnapshot(input: BuildInput): SnapshotBuild {
  const { expectedGpuIds, outcomes, generatedAt } = input;
  const previous = input.previous ?? null;
  const previousSize = previous ? snapshotSize(previous) : { gpusWithOffers: 0, offers: 0 };

  const failedGpus = outcomes.filter((o) => o.status === 'failed').length;
  const empty = { failedGpus, previousSize, gpusWithOffers: 0, offers: 0 };

  // THE SWEEP MUST HAVE COVERED EXACTLY THE CATALOGUE — checked first, because
  // every count below is meaningless if it did not. A short sweep would
  // otherwise pass through as a smaller-but-valid snapshot.
  const expected = new Set(expectedGpuIds);
  if (expectedGpuIds.length === 0 || expected.size !== expectedGpuIds.length) {
    return { ok: false, refusal: refusal('expected-ids-invalid', empty, duplicatesOf(expectedGpuIds)) };
  }

  const duplicates = duplicatesOf(outcomes.map((o) => o.gpuId));
  if (duplicates.length > 0) return { ok: false, refusal: refusal('outcome-duplicate-gpu', empty, duplicates) };

  const swept = new Set(outcomes.map((o) => o.gpuId));
  const unexpected = [...swept].filter((id) => !expected.has(id));
  if (unexpected.length > 0) return { ok: false, refusal: refusal('outcome-unexpected-gpu', empty, unexpected) };

  const missing = expectedGpuIds.filter((id) => !swept.has(id));
  if (missing.length > 0) return { ok: false, refusal: refusal('outcome-missing-gpu', empty, missing) };

  const gpus: SnapshotGpu[] = [];
  for (const outcome of outcomes) {
    if (outcome.status === 'failed') continue;
    for (const offer of outcome.offers) {
      if (offer.canonicalGpuId !== outcome.gpuId) {
        return {
          ok: false,
          refusal: refusal('offer-gpu-mismatch', { failedGpus, previousSize, gpusWithOffers: 0, offers: 0 }),
        };
      }
    }
    gpus.push({ gpuId: outcome.gpuId, result: resultFor(outcome), offers: outcome.offers.map(toSnapshotOffer) });
  }

  const candidate: GpuOfferSnapshot = {
    schemaVersion: OFFER_SNAPSHOT_SCHEMA_VERSION,
    adapterVersion: input.adapterVersion ?? RAKUTEN_ADAPTER_VERSION,
    generatedAt,
    availability: AVAILABILITY_UNKNOWN,
    gpus,
  };
  const size = snapshotSize(candidate);
  const counts = { failedGpus, previousSize, gpusWithOffers: size.gpusWithOffers, offers: size.offers };

  // Order matters. A failed sweep is refused before its numbers are compared
  // to anything, because those numbers are not measurements.
  if (failedGpus > 0) return { ok: false, refusal: refusal('gpu-request-failed', counts) };

  if (
    previousSize.gpusWithOffers >= MIN_BASELINE_GPUS_WITH_OFFERS &&
    size.gpusWithOffers < previousSize.gpusWithOffers * (1 - MAX_SHRINK_RATIO)
  ) {
    return { ok: false, refusal: refusal('gpu-coverage-collapse', counts) };
  }
  if (previousSize.offers >= MIN_BASELINE_OFFERS && size.offers < previousSize.offers * (1 - MAX_SHRINK_RATIO)) {
    return { ok: false, refusal: refusal('offer-count-collapse', counts) };
  }

  // The same parser the browser runs, over the same JSON the browser will
  // receive — round-tripped, so a value that cannot survive serialization
  // (undefined, NaN, a Date) is caught here rather than at read time.
  const parsed = parseOfferSnapshot(JSON.parse(JSON.stringify(candidate)));
  if (!parsed.ok) return { ok: false, refusal: { ...refusal('schema-invalid', counts), problem: parsed.problem } };

  return { ok: true, snapshot: parsed.snapshot };
}

function refusal(
  code: SnapshotRefusalCode,
  counts: { failedGpus: number; previousSize: { gpusWithOffers: number; offers: number }; gpusWithOffers: number; offers: number },
  gpuIds: readonly string[] = [],
): SnapshotRefusal {
  return {
    code,
    failedGpus: counts.failedGpus,
    gpusWithOffers: counts.gpusWithOffers,
    previousGpusWithOffers: counts.previousSize.gpusWithOffers,
    offers: counts.offers,
    previousOffers: counts.previousSize.offers,
    problem: null,
    gpuIds,
  };
}

/** Ids appearing more than once, each reported once, in first-seen order. */
function duplicatesOf(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  return [...repeated];
}

/** One line for an operator. Counts and a code — never a URL, a name or a price. */
export function describeRefusal(r: SnapshotRefusal): string {
  const detail = r.problem === null ? '' : ` (${r.problem})`;
  // Capped: a refusal naming all 57 catalogue ids is a wall of text where a
  // handful is a diagnosis.
  const shown = r.gpuIds.slice(0, 5);
  const ids =
    r.gpuIds.length === 0
      ? ''
      : ` GPU(s): ${shown.join(', ')}${r.gpuIds.length > shown.length ? ` and ${r.gpuIds.length - shown.length} more` : ''}.`;
  return (
    `Snapshot not published [${r.code}]${detail}: ` +
    `${r.failedGpus} failed GPU(s); ${r.gpusWithOffers} GPU(s) with offers and ${r.offers} offer(s), ` +
    `against ${r.previousGpusWithOffers} and ${r.previousOffers} previously.${ids}`
  );
}
