// Issue #101: decide whether a retail CPU listing may carry a canonical id.
//
// Fail-closed by construction. `resolveCpuIdentity` returns a binding only when
// every independent check agrees; any disagreement, any absence, any surprise
// returns null and the part stays unsupported. There is no "probably" branch.

import { verifyCpuModel } from '../rakuten/cpuModelMatch';
import { bindingFor, type CpuIdentityBinding } from './cpuIdentityRegistry';

export interface CpuIdentityInput {
  /** Published catalogue part id. */
  retailPartId: string;
  /** The listing title exactly as the merchant supplies it. */
  name: string;
  /** The record's tracked deep link. */
  trackedAffiliateUrl: string;
}

export interface CanonicalCpuLike {
  id: string;
  name: string;
}

export type CpuIdentityRefusal =
  | 'not-reviewed'
  | 'canonical-missing'
  | 'title-disagrees'
  | 'destination-unreadable'
  | 'destination-disagrees';

export type CpuIdentityOutcome =
  | { bound: true; canonicalCpuId: string; evidence: CpuIdentityBinding }
  | { bound: false; refusal: CpuIdentityRefusal; detail: string };

/** The merchant destination a tracked link points at, or null. */
export function decodeMerchantDestination(trackedAffiliateUrl: string): string | null {
  try {
    const murl = new URL(trackedAffiliateUrl).searchParams.get('murl');
    if (!murl) return null;
    const decoded = new URL(decodeURIComponent(murl));
    return decoded.host.endsWith('newegg.com') ? decoded.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Whether the merchant's own deep link corroborates the canonical part.
 *
 * The product slug is the merchant naming the item in a second, independent
 * field of the same record. Requiring it means a binding never rests on the
 * title alone — the exact "title guess" #101 rules out.
 */
export function destinationNamesCpu(destination: string, cpuName: string): boolean {
  let slugTokens: string[];
  try {
    slugTokens = decodeURIComponent(new URL(destination).pathname)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  } catch {
    return false;
  }
  const wanted = cpuName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (wanted.length === 0) return false;

  // Whole-token comparison, not substring. "ryzen-9-9950x" is a PREFIX of
  // "ryzen-9-9950x3d", so a substring test would let the stacked-cache part
  // corroborate the part without it — the single most consequential gaming
  // confusion in AMD's range, admitted by a matching rule rather than caught.
  for (let i = 0; i + wanted.length <= slugTokens.length; i += 1) {
    if (wanted.every((token, k) => slugTokens[i + k] === token)) return true;
  }
  return false;
}

/**
 * Resolves one listing to a canonical CPU, or refuses with the reason.
 *
 * Requires, in order: a reviewed registry entry; that entry's canonical id to
 * exist; the CURRENT title to verify that exact processor; a readable Newegg
 * destination; and that destination to name the same processor.
 */
export function resolveCpuIdentity(
  input: CpuIdentityInput,
  canonicalCpus: readonly CanonicalCpuLike[],
): CpuIdentityOutcome {
  const evidence = bindingFor(input.retailPartId);
  if (!evidence) {
    return { bound: false, refusal: 'not-reviewed', detail: `${input.retailPartId} has no reviewed identity binding.` };
  }

  const canonical = canonicalCpus.find((c) => c.id === evidence.canonicalCpuId);
  if (!canonical) {
    return {
      bound: false,
      refusal: 'canonical-missing',
      detail: `Registry names canonical CPU "${evidence.canonicalCpuId}", which is not in the catalog.`,
    };
  }

  // The registry records a past review; this re-checks it against the feed as
  // it stands today, so a re-titled listing drops its binding instead of
  // silently keeping an estimate pointed at the wrong chip.
  const title = verifyCpuModel(input.name, canonical.name);
  if (!title.ok) {
    return { bound: false, refusal: 'title-disagrees', detail: `${title.reason}: ${title.detail}` };
  }

  const destination = decodeMerchantDestination(input.trackedAffiliateUrl);
  if (!destination) {
    return {
      bound: false,
      refusal: 'destination-unreadable',
      detail: 'The tracked link carries no readable Newegg destination to corroborate the title against.',
    };
  }
  if (!destinationNamesCpu(destination, canonical.name)) {
    return {
      bound: false,
      refusal: 'destination-disagrees',
      detail: `The merchant destination does not name ${canonical.name}; title and link disagree, so identity is not established.`,
    };
  }

  return { bound: true, canonicalCpuId: canonical.id, evidence };
}
