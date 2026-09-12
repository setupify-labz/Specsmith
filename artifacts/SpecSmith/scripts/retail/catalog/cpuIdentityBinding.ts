// Issue #101: decide whether a retail CPU listing may carry a canonical id.
//
// Fail-closed by construction. `resolveCpuIdentity` returns a binding only when
// every independent check agrees; any disagreement, any absence, any surprise
// returns null and the part stays unsupported. There is no "probably" branch.

import { verifyCpuModel } from '../rakuten/cpuModelMatch';
import { bindingFor, type CpuIdentityBinding } from './cpuIdentityRegistry';

/** How a binding is looked up. Injectable so tests drive this function itself. */
export type BindingLookup = (merchantProductId: string) => CpuIdentityBinding | null;

/**
 * The merchant's PRODUCT id from a Newegg product URL: the `/p/<id>` segment.
 *
 * Null when the URL has no such segment, which fails the binding closed rather
 * than falling back to the offer id — the offer id is the thing that rotates.
 */
export function merchantProductIdFrom(destination: string): string | null {
  try {
    const parts = new URL(destination).pathname.split('/').filter(Boolean);
    const at = parts.lastIndexOf('p');
    const id = at >= 0 ? parts[at + 1] : undefined;
    return id && /^[A-Za-z0-9]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

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
  /** Recorded for review, but the manufacturer record has not been read. */
  | 'manufacturer-unconfirmed'
  /** One or both parties state no manufacturer part number. */
  | 'mpn-missing'
  /** The retailer and the manufacturer name different part numbers. */
  | 'mpn-disagrees'
  | 'canonical-missing'
  | 'manufacturer-disagrees'
  | 'title-disagrees'
  | 'destination-unreadable'
  | 'destination-disagrees';

export type CpuIdentityOutcome =
  | { bound: true; canonicalCpuId: string; evidence: CpuIdentityBinding }
  | { bound: false; refusal: CpuIdentityRefusal; detail: string };

/**
 * Whether a hostname really is Newegg.
 *
 * `endsWith('newegg.com')` is not that test: it also accepts `evilnewegg.com`
 * and `newegg.com.attacker.test`. Only the apex itself or a genuine subdomain
 * under a leading dot qualifies.
 */
export function isNeweggHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return host === 'newegg.com' || host.endsWith('.newegg.com');
}

/** The merchant destination a tracked link points at, or null. */
export function decodeMerchantDestination(trackedAffiliateUrl: string): string | null {
  try {
    const murl = new URL(trackedAffiliateUrl).searchParams.get('murl');
    if (!murl) return null;
    const decoded = new URL(decodeURIComponent(murl));
    return isNeweggHost(decoded.hostname) ? decoded.toString() : null;
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
  lookup: BindingLookup = bindingFor,
): CpuIdentityOutcome {
  // The destination is read first because the binding is keyed on the
  // merchant's PRODUCT id, which lives in it. An unreadable or non-Newegg
  // destination therefore refuses before anything is looked up at all.
  const destination = decodeMerchantDestination(input.trackedAffiliateUrl);
  if (!destination) {
    return {
      bound: false,
      refusal: 'destination-unreadable',
      detail: 'The tracked link carries no readable Newegg destination, so the product it sells is unidentified.',
    };
  }
  const productId = merchantProductIdFrom(destination);
  if (!productId) {
    return {
      bound: false,
      refusal: 'destination-unreadable',
      detail: `The destination ${destination} names no /p/<id> product, so there is no stable identity to look up.`,
    };
  }

  const evidence = lookup(productId);
  if (!evidence) {
    return {
      bound: false,
      refusal: 'not-reviewed',
      detail: `Newegg product ${productId} has no reviewed identity binding.`,
    };
  }

  // THE INDEPENDENT SOURCE, CHECKED FIRST. Everything below this point is the
  // merchant describing its own record; none of it can establish what the part
  // is. Without the manufacturer's own statement about the MPN there is
  // nothing for the merchant's claim to be checked against, so the binding is
  // refused before any of the self-consistency checks are even reached.
  const { manufacturer } = evidence;
  if (manufacturer.status !== 'confirmed') {
    return {
      bound: false,
      refusal: 'manufacturer-unconfirmed',
      detail:
        `Manufacturer evidence is "${manufacturer.status}": the vendor's own records have not been ` +
        'read, so the part is not identified by the party that defines it.',
    };
  }

  // THE JOIN. The retailer names a part number; the manufacturer names the
  // part number its record describes. Exact string equality, both directions
  // required to be present. A missing number on either side is not a weaker
  // match to fall back from — there is simply no join, so nothing binds.
  const retailerMpn = evidence.retailer.mpn;
  const orderingCode = manufacturer.orderingCode;
  if (!retailerMpn || !orderingCode) {
    return {
      bound: false,
      refusal: 'mpn-missing',
      detail:
        `Part numbers must be stated by both parties to be compared. Retailer states ` +
        `${retailerMpn ? `"${retailerMpn}"` : 'none'}; manufacturer states ` +
        `${orderingCode ? `"${orderingCode}"` : 'none'}.`,
    };
  }
  if (retailerMpn !== orderingCode) {
    return {
      bound: false,
      refusal: 'mpn-disagrees',
      detail:
        `Retailer states MPN "${retailerMpn}"; the manufacturer's ordering record states ` +
        `"${orderingCode}". Two part numbers that are not the same string are not the same part.`,
    };
  }

  const canonical = canonicalCpus.find((c) => c.id === evidence.canonicalCpuId);
  if (!canonical) {
    return {
      bound: false,
      refusal: 'canonical-missing',
      detail: `Registry names canonical CPU "${evidence.canonicalCpuId}", which is not in the catalog.`,
    };
  }

  // What the vendor says the MPN is must be the part we are binding to. A
  // confirmed record that names a different chip is the case this whole
  // structure exists to catch.
  if (!manufacturer.statedProcessor || !verifyCpuModel(manufacturer.statedProcessor, canonical.name).ok) {
    return {
      bound: false,
      refusal: 'manufacturer-disagrees',
      detail:
        `The manufacturer record for ${manufacturer.orderingCode ?? 'this part'} states ` +
        `${manufacturer.statedProcessor ? `"${manufacturer.statedProcessor}"` : 'nothing readable'}, ` +
        `which does not verify as ${canonical.name}.`,
    };
  }

  // The registry records a past review; these re-check it against the feed as
  // it stands today, so a re-titled or re-pointed listing drops its binding
  // instead of silently keeping an estimate aimed at the wrong chip.
  const title = verifyCpuModel(input.name, canonical.name);
  if (!title.ok) {
    return { bound: false, refusal: 'title-disagrees', detail: `${title.reason}: ${title.detail}` };
  }

  // The product page's own slug must name the same chip as the title. Two
  // fields of one merchant record agreeing is not what admits the binding —
  // Intel's part number did that above — but a merchant contradicting itself
  // is still reason to refuse.
  if (!destinationNamesCpu(destination, canonical.name)) {
    return {
      bound: false,
      refusal: 'destination-disagrees',
      detail: `The merchant destination does not name ${canonical.name}; the listing contradicts itself.`,
    };
  }

  return { bound: true, canonicalCpuId: canonical.id, evidence };
}
