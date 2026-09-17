// THINGS THAT ARE NOT DEFECTS, BUT ARE NOT DECISIONS EITHER.
//
// The gate beside this file rejects listings that are demonstrably not the
// product their category claims to hold — a TPM module is not a motherboard,
// and no reasonable person calls that a matter of taste.
//
// This file is for the other pile. The 2026-09-17 dry run also proposed to
// publish a 128 MB DDR-266 stick, a Dell OptiPlex 7010 replacement board, a
// 180 W HP Pavilion power supply, and a 300 W Supermicro unit priced at
// $411.99. Every one of those IS a real, complete, consumer-purchasable
// product. Whether SpecSmith should sell it to someone assembling a gaming PC
// is a PRODUCT-SCOPE QUESTION, and product scope is not mine to set.
//
// SO NOTHING HERE FILTERS. There is no `screen…` function in this file and no
// `kept` array, deliberately: every export takes listings and returns
// FINDINGS. The selection path calls it, attaches the findings to the run
// report, and publishes exactly the same rows it would have published without
// it. A test asserts that.
//
// WHY THAT SEPARATION IS WORTH THE FILE
// -------------------------------------
// A silent filter and a reported finding look identical in the output — the
// listing is gone either way — but they differ in what happens NEXT. A
// filtered listing is a decision nobody made and nobody can review. A reported
// one is a question with a name, a count, and the exact SKUs attached, which
// is the form a scope decision has to arrive in.
//
// WHERE THE THRESHOLDS COME FROM, AND WHAT THEY ARE NOT
// -----------------------------------------------------
// Two numbers below are SPECSMITH-DEFINED CHOICES, not industry facts, and are
// labelled as such wherever they surface: the 450 W floor and the 2.5x
// unit-price multiple. Their justification is in the doc comment on each
// function, including the margin between the flagged rows and the nearest
// legitimate one — which for the price multiple is thin.

import type { RetailPartCategory } from '../../../src/lib/retail/partCatalog';

/** Why a listing needs a scope decision. Reported; never acted on here. */
export type ScopeFlag =
  /** Memory from a generation no current gaming build can use. */
  | 'legacy-ram'
  /** A board that only fits one prebuilt chassis, sold by its OEM model. */
  | 'oem-proprietary-motherboard'
  /** A supply whose stated wattage is below what a gaming build draws. */
  | 'low-wattage-psu'
  /** A price far out of line with the listing's own stated specification. */
  | 'extreme-unit-price';

/** One listing, one reason, and the measurement that produced it. */
export interface ScopeFinding {
  sku: string;
  category: RetailPartCategory;
  name: string;
  priceUsd: number;
  flag: ScopeFlag;
  /** The evidence, in words a reviewer can check against the title. */
  detail: string;
}

const normalize = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9+./-]+/g, ' ').trim();

/**
 * The wattage the TITLE states, or null.
 *
 * First match wins, which is what the merchant titles actually support:
 * "JBON 600WS Power Supply 500W" has a model number before the rating, and
 * "SAMA B650 650W ... (450W)" has the GPU-rail figure after it. `\bw\b`
 * declines the model number — `600WS` has no boundary after the W — and
 * first-match declines the trailing rail figure.
 */
export function statedWatts(title: string): number | null {
  const match = /\b(\d{3,4})\s*(?:w\b|watt)/.exec(title);
  return match === null ? null : Number(match[1]);
}

/** The capacity the TITLE states, in GB, or null. `128MB` counts as 0.125. */
export function statedGigabytes(title: string): number | null {
  const gb = /\b(\d{1,4})\s*gb\b/.exec(title);
  if (gb !== null) return Number(gb[1]);
  const mb = /\b(\d{2,4})\s*mb\b/.exec(title);
  if (mb !== null) return Number(mb[1]) / 1024;
  return null;
}

/**
 * Memory a current build cannot use, or cannot identify.
 *
 * Three signals, each read off the title:
 *
 *   - a pre-DDR4 generation is NAMED — `DDR1`, `DDR2`, `DDR 266`, `PC 2100`,
 *     `PC2-`, `PC3-`. DDR4 is deliberately absent: DDR4 kits are a legitimate
 *     purchase and five are in the same run.
 *   - the stated capacity is 4 GB OR LESS. The nine legacy rows are 128 MB to
 *     2 GB; the smallest modern kit in the run is 16 GB, so the floor is not
 *     close to anything real.
 *   - NOTHING is stated. `SAMSUNG M378B5173Cb0-Ck0 Memory For Desktop
 *     Memory-M378B5173Cb0-Ck0` gives a beginner no generation, no capacity and
 *     no speed. That is its own reason to ask, so it is reported rather than
 *     passed over for failing to match a generation pattern.
 */
export function isLegacyRam(title: string): boolean {
  if (/\bddr\s*-?\s*[123]\b/.test(title)) return true;
  if (/\bddr\s+(?:200|266|333|400)\b/.test(title)) return true;
  if (/\bpc\s*-?\s*(?:2|3)\s*-\s*\d{4}\b/.test(title)) return true;
  if (/\bpc\s*(?:2100|2700|3200|4200|5300|6400|8500|10600|12800)\b/.test(title)) return true;

  const capacity = statedGigabytes(title);
  if (capacity !== null && capacity <= 4) return true;
  // Neither a generation nor a capacity: unidentifiable to a beginner.
  if (capacity === null && !/\bddr\d?\b/.test(title)) return true;
  return false;
}

/**
 * A board sold as a spare for one named prebuilt chassis.
 *
 *   9SIBT5SM0Z2557  "Dell Optiplex 5070 SFF ... Motherboard YJMC0 ..."   $39.99
 *   9SIAGUZKG99228  "Dell 773VG Optiplex 7010 ... Desktop Motherboard"   $44.00
 *   9SIBT5SKME3318  "Dell Inspiron 3470 ... Motherboard D02VH 0D02VH"    $44.00
 *   9SIBT5SKME3325  "For Dell VOSTRO 3470 SFF Desktop Motherboard ..."   $44.00
 *   9SIC6J1KVX0070  "HP 437340-001 DC7800 LGA 775/Socket T DDR2 ..."     $45.00
 *   9SIC6J1KVX3470  "Dell Optiplex 790 990 USFF ... Motherboard NKW6Y"   $45.00
 *
 * These are genuine products and they work — in the one chassis they were
 * made for, with that chassis's proprietary front-panel header, standoff
 * pattern and power connector. They are the six cheapest boards in the
 * catalogue after the accessories, which is exactly why they were selected,
 * and a beginner buying on price would find nothing else fits.
 *
 * The rule needs BOTH an OEM and one of its SYSTEM FAMILIES, because "Dell"
 * alone appears on legitimate retail parts (a Dell-branded memory module) and
 * a family name alone is too generic to key on.
 */
export function isOemProprietaryBoard(title: string): boolean {
  const oem = /\b(dell|hp|h-p|compaq|lenovo|ibm|acer|gateway|emachines|packard bell|fujitsu)\b/;
  const systemFamily = /\b(optiplex|inspiron|vostro|dimension|precision|pavilion|thinkcentre|thinkstation|elitedesk|prodesk|elitebook|aspire|veriton|essentio|dc\s*\d{4}|dx\s*\d{4})\b/;
  return oem.test(title) && systemFamily.test(title);
}

/**
 * A supply whose stated wattage is below what a gaming build draws.
 *
 * THE 450 W FLOOR IS A SPECSMITH CHOICE, not a standard. It is defensible in
 * this catalogue rather than in general: the cheapest discrete GPU SpecSmith
 * sells draws more than a prebuilt office machine's entire supply was built
 * for, and every unit the floor catches is an OEM spare —
 *
 *   9SIAKRCA5A4244  COMPAQ 308437-001 240W ATX POWER SUPPLY               $36.99
 *   9SIC6VHM4Y2376  Bestec ATX-300-12E Rev. D1R 300W Gateway Power Supply $38.80
 *   9SIB66RK698428  300W PSU For Supermicro PWS-305-PQ Multi-Output       $261.99
 *   9SIBZT2KGK5661  For H-P-Pavilion 500 110 ATX Power Supply PSU 180W    $267.31
 *   9SIB66RK698513  For 500 110 ATX Power Supply 180W 742317-001 PCD010   $269.99
 *   9SIB66RK699001  PSU For Supermicro PWS-305-PQ PS2/ATX 300W            $411.99
 *
 * — while the nearest retail unit, a 450 W Silverstone SFX at $266.19, sits
 * exactly ON the floor and is NOT flagged. A supply whose title states no
 * wattage is not flagged either; that is a different gap, and guessing would
 * be the error this codebase keeps correcting.
 */
export function isLowWattagePsu(title: string): boolean {
  const watts = statedWatts(title);
  return watts !== null && watts < 450;
}

/** A SpecSmith-defined multiple of the category's median unit price. */
export const EXTREME_UNIT_PRICE_MULTIPLE = 2.5;

/** The unit a category's price can be divided by, when the title states it. */
function unitFor(category: RetailPartCategory, title: string): { size: number; label: string } | null {
  if (category === 'psu') {
    const watts = statedWatts(title);
    return watts === null || watts <= 0 ? null : { size: watts, label: 'W' };
  }
  if (category === 'ram') {
    const gb = statedGigabytes(title);
    return gb === null || gb <= 0 ? null : { size: gb, label: 'GB' };
  }
  return null;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * The two prices a listing carries. `salePrice` is null unless the merchant
 * set one; 130 of the 500 listings in run 35275594594 did.
 */
export interface ListingPrice {
  retailPrice: number;
  salePrice: number | null;
}

/**
 * THE PRICE A SHOPPER ACTUALLY PAYS, and the one every price judgement here
 * must be made on.
 *
 * Exported and used by the generator rather than inlined, because an inlined
 * `salePrice ?? retailPrice` is exactly the expression a fixture silently
 * fails to reproduce. An independent review found that: the fixture carried
 * raw `retailPrice` while the generator passed the effective price, so the
 * unit-price medians the tests asserted on were computed from prices no
 * shopper would have been charged. Both sides now call this function, and the
 * fixture-integrity test re-derives every row through it.
 */
export function effectivePriceUsd(listing: ListingPrice): number {
  return listing.salePrice ?? listing.retailPrice;
}

/**
 * What a listing looks like to this file.
 *
 * The field is `priceUsd`, NOT `retailPrice`. The old name was the defect's
 * hiding place: a caller holding an `AffiliatePart` could assign its
 * `retailPrice` straight across and be wrong on 130 of 500 rows without any
 * type error, because the name it was assigning to matched the name it came
 * from. `priceUsd` does not match anything on `AffiliatePart`, so it has to be
 * computed — and `effectivePriceUsd` above is the only thing that computes it.
 */
export interface ScopeCandidate {
  sku: string;
  category: RetailPartCategory;
  name: string;
  priceUsd: number;
}

/**
 * Listings priced far out of line with their own stated specification.
 *
 * COMPARED AGAINST THE RUN, NOT AGAINST A PRICE I BELIEVE IS RIGHT. The
 * reference is the median unit price of the same category in the same run, so
 * the test says "this listing is an outlier HERE" — a claim the data supports
 * — rather than "this listing is overpriced", which would need market pricing
 * this repository does not have.
 *
 * Only `psu` and `ram` are measured, because only their titles state the unit
 * the price divides by. A GPU title states no comparable quantity, so no
 * outlier claim is made about GPUs rather than one invented from price alone.
 *
 * THE 2.5x MULTIPLE IS A SPECSMITH CHOICE AND THE MARGIN IS THIN. Against the
 * 2026-09-17 run it separates the four OEM supplies (2.9x, 4.6x, 5.0x, 5.0x
 * the $0.298/W median) from the nearest retail unit, a 450 W Silverstone SFX
 * at 2.0x. One legitimate product sits half a step below the line.
 *
 * AND IT DOES NOT FLAG THE MEMORY IT WAS EXPECTED TO, which is the finding
 * rather than a gap. The seven "16GB RAM Replacement for ..." modules at
 * $333.62 land at $20.85/GB against a category median of $20.62/GB — 1.0x —
 * and the 128 GB HyperX DDR4 kit at $1299 is BELOW the median at $10.15/GB.
 * Neither is an outlier in this feed, because the WHOLE RAM CATEGORY is priced
 * at roughly $20/GB. Whether that is the market or the feed is a question this
 * test cannot answer, and it does not pretend to; it is the scope decision the
 * report exists to surface.
 *
 * The only memory it does flag is the 128 MB DDR-266 stick at $150.00/GB
 * (7.3x), which `legacy-ram` reports independently. A listing carrying two
 * flags is reported twice, on purpose: the reasons are separate questions.
 */
export function extremeUnitPriceFindings(candidates: readonly ScopeCandidate[]): ScopeFinding[] {
  const measured = candidates
    .map((row) => {
      const unit = unitFor(row.category, normalize(row.name));
      return unit === null ? null : { row, unit, unitPrice: row.priceUsd / unit.size };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const medians = new Map<RetailPartCategory, number>();
  for (const category of new Set(measured.map((entry) => entry.row.category))) {
    medians.set(category, median(measured.filter((e) => e.row.category === category).map((e) => e.unitPrice)));
  }

  const findings: ScopeFinding[] = [];
  for (const entry of measured) {
    const reference = medians.get(entry.row.category);
    if (reference === undefined || reference <= 0) continue;
    const multiple = entry.unitPrice / reference;
    if (multiple < EXTREME_UNIT_PRICE_MULTIPLE) continue;
    findings.push({
      sku: entry.row.sku,
      category: entry.row.category,
      name: entry.row.name,
      priceUsd: entry.row.priceUsd,
      flag: 'extreme-unit-price',
      detail:
        `$${entry.unitPrice.toFixed(2)}/${entry.unit.label} is ${multiple.toFixed(1)}x the ` +
        `${entry.row.category} median of $${reference.toFixed(2)}/${entry.unit.label} in this run ` +
        `(SpecSmith-defined threshold: ${EXTREME_UNIT_PRICE_MULTIPLE}x)`,
    });
  }
  return findings;
}

/**
 * Every scope question the selected listings raise.
 *
 * Returns findings only. It takes no decision, removes nothing, and its
 * caller publishes the same rows whether it is called or not.
 */
export function reportProductScope(candidates: readonly ScopeCandidate[]): ScopeFinding[] {
  const findings: ScopeFinding[] = [];

  for (const row of candidates) {
    const title = normalize(row.name);
    const base = { sku: row.sku, category: row.category, name: row.name, priceUsd: row.priceUsd };

    if (row.category === 'ram' && isLegacyRam(title)) {
      const gb = statedGigabytes(title);
      findings.push({
        ...base,
        flag: 'legacy-ram',
        detail: gb === null ? 'no DDR generation or capacity stated' : `stated capacity ${gb} GB`,
      });
    }
    if (row.category === 'motherboard' && isOemProprietaryBoard(title)) {
      findings.push({ ...base, flag: 'oem-proprietary-motherboard', detail: 'sold by prebuilt OEM system model' });
    }
    if (row.category === 'psu' && isLowWattagePsu(title)) {
      findings.push({
        ...base,
        flag: 'low-wattage-psu',
        detail: `stated ${statedWatts(title)} W, below the SpecSmith-defined 450 W floor`,
      });
    }
  }

  findings.push(...extremeUnitPriceFindings(candidates));
  return findings;
}

/** The findings as a count per flag, for a run report that has to stay small. */
export function summariseProductScope(findings: readonly ScopeFinding[]): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const finding of findings) tally[finding.flag] = (tally[finding.flag] ?? 0) + 1;
  return tally;
}
