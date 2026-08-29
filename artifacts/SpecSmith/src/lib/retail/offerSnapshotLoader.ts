// Reads the published GPU offer snapshot in the browser.
//
// BROWSER-SAFE. It fetches one static JSON file and validates it. It holds no
// credential, talks to no API, and cannot: the snapshot is produced by a
// server-only sweep and published as an asset, so nothing on this side of the
// wire ever needs a token.
//
// WHY A FETCHED ASSET RATHER THAN A BUNDLED IMPORT
// ------------------------------------------------
// Two reasons, and the second is the important one:
//
//   1. The snapshot is refreshed on a schedule and the code is not. Importing
//      it would put dated prices inside a content-hashed bundle.
//   2. "No snapshot has been published yet" is a real state, and an import
//      cannot express it — a missing file is a build error. Here it is a 404,
//      which this returns as 'absent'. That matters because absent and invalid
//      want opposite responses: one is normal before the first sweep, the
//      other is a defect.
//
// THIS FUNCTION NEVER THROWS AND NEVER RETURNS A PRICE IT CANNOT STAND BEHIND.
// A network failure, a 404, a truncated body, a hand-edited file and a stale
// sweep all come back as a status, and only 'ok' carries offers.

import {
  viewSnapshot,
  type SnapshotView,
} from './offerSnapshot';

/**
 * Where the writer publishes and the browser reads.
 *
 * Under /data/ rather than /assets/: /assets/* is content-hashed and cached
 * immutably by the edge (see public/_headers), which is exactly wrong for a
 * file whose whole purpose is to change on a schedule under a fixed name.
 */
export const OFFER_SNAPSHOT_URL = '/data/gpu-offers.json';

export interface LoadOptions {
  fetch?: typeof globalThis.fetch;
  /** Epoch milliseconds. Injected so freshness is testable without waiting a day. */
  now?: number;
  maxAgeMs?: number;
  url?: string;
  signal?: AbortSignal;
}

/**
 * Fetches and validates the snapshot.
 *
 * `cache: 'no-cache'` asks the browser to revalidate rather than serve a copy
 * it already has: a cached snapshot is by definition an older one, and the
 * staleness rule can only refuse what it can see. A stale response that slips
 * through anyway is still caught by `viewSnapshot`, which is why the freshness
 * check lives on the data and not on the transport.
 */
export async function loadOfferSnapshot(options: LoadOptions = {}): Promise<SnapshotView> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const url = options.url ?? OFFER_SNAPSHOT_URL;
  const now = options.now ?? Date.now();

  let response: Response;
  try {
    response = await doFetch(url, { cache: 'no-cache', signal: options.signal });
  } catch {
    // A network failure is not a bad snapshot; it is no snapshot. Reported the
    // same way as a missing one, because the page can do nothing about either
    // and both mean "show no price".
    return { status: 'absent' };
  }

  if (response.status === 404) return { status: 'absent' };
  if (!response.ok) return { status: 'absent' };

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    // A body that is not JSON is a real defect — a truncated download, or an
    // HTML error page served with a 200 — so it is 'invalid', not 'absent'.
    return { status: 'invalid', problem: 'not-an-object' };
  }

  return viewSnapshot(raw, { now, maxAgeMs: options.maxAgeMs });
}
