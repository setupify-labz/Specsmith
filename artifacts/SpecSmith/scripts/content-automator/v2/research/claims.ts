// Claim atomization, and the observation/claim boundary.
//
// WHY ONE SENTENCE IS NOT ONE EVIDENCE UNIT
// ------------------------------------------
//   "GPU A is 20% faster, cheaper, and more efficient."
//
// That is three assertions with three different evidence bases. Held as one
// unit it takes the confidence of whichever part is best evidenced — usually
// the spec-sheet one — and carries the price claim along for free. Split, the
// price claim has to stand on a real listing or not be said.
//
// WHY THE LEAP FROM OBSERVATION TO CLAIM IS CHECKED
// -------------------------------------------------
//   Observation:  this listing displayed $549.99 at 14:02.
//   Valid claim:  this listing was $549.99 at 14:02.
//   Invalid leap: the RTX 5070 costs $549.99.
//
// The third is the one that gets someone to the shop for a price that was never
// general. `generalisesBeyondObservation` on the evidence link is where that is
// recorded, and describeLeap below is what detects it.

import {
  CLAIM_KINDS,
  MINIMUM_RISK_BY_KIND,
  CLAIM_RISK_ORDER,
  QUOTABLE_FORMS,
  type AtomicClaim,
  type ClaimConfiguration,
  type ClaimKind,
  type ClaimRisk,
  type MaterialForm,
  type Observation,
  type ResearchProvenance,
} from "./model.ts";

/** Conjunctions that usually join independent assertions rather than qualify one. */
const SPLIT_PATTERN = /\s*(?:,\s*and\s+|\s+and\s+|,\s+|;\s*|\s+but\s+|\s+while\s+|\s+whereas\s+)\s*/i;

/**
 * Words that tie each fragment to a kind of claim.
 *
 * Deliberately conservative: a fragment matching nothing becomes `comparison`
 * only when the parent did, and otherwise inherits the parent kind. Guessing a
 * kind wrongly would apply the wrong freshness and evidence rules, so ambiguity
 * inherits rather than invents.
 */
const KIND_MARKERS: readonly { readonly kind: ClaimKind; readonly pattern: RegExp }[] = [
  { kind: "current-price", pattern: /\b(cheap(er|est)?|price[ds]?|pricing|costs?|\$\d|msrp|deal|value for money)\b/i },
  { kind: "availability", pattern: /\b(in stock|out of stock|available|restock|sold out)\b/i },
  { kind: "performance-measured", pattern: /\b(fps|frames? per second|benchmark(ed)?|measured|1% low|frame ?time)\b/i },
  { kind: "performance-estimated", pattern: /\b(estimated|projected|should get|around \d+ ?fps)\b/i },
  { kind: "compatibility", pattern: /\b(compatible|fits?|socket|bottleneck|psu|wattage|clearance|supports?)\b/i },
  { kind: "specification", pattern: /\b(vram|gb of|memory|cores?|tdp|watts?|dimensions?|length|spec(ification)?s?)\b/i },
  { kind: "comparison", pattern: /\b(faster|slower|better|worse|more efficient|outperforms?|beats?|\d+% (faster|slower))\b/i },
  { kind: "recommendation", pattern: /\b(should buy|recommend|worth it|best (choice|pick|value)|go with)\b/i },
];

function classifyFragment(fragment: string, fallback: ClaimKind): ClaimKind {
  for (const marker of KIND_MARKERS) {
    if (marker.pattern.test(fragment)) return marker.kind;
  }
  return fallback;
}

/** Risk is the higher of what the caller asked for and the kind's own floor. */
export function riskFor(kind: ClaimKind, requested: ClaimRisk = "low"): ClaimRisk {
  const floor = MINIMUM_RISK_BY_KIND[kind];
  return CLAIM_RISK_ORDER[floor] >= CLAIM_RISK_ORDER[requested] ? floor : requested;
}

export interface AtomizeInput {
  readonly questionId: string;
  /** The compound statement as written. */
  readonly statement: string;
  /** The kind assumed for fragments that carry no marker of their own. */
  readonly defaultKind: ClaimKind;
  readonly subjectIds: readonly string[];
  readonly configuration?: ClaimConfiguration;
  readonly provenance: ResearchProvenance;
  /** Stable id prefix, so re-running produces the same claim ids. */
  readonly idPrefix: string;
}

/**
 * Splits a compound statement into independently-evidenced claims.
 *
 * Fragments shorter than a few characters, and fragments that are pure
 * qualifiers, are folded back into the previous claim rather than becoming
 * claims of their own — "faster, at 1440p" is one assertion, not two.
 */
export function atomizeClaim(input: AtomizeInput): AtomicClaim[] {
  const subject = input.subjectIds.join(" vs ");
  const raw = input.statement.trim().replace(/\.$/, "");
  const fragments = raw.split(SPLIT_PATTERN).map((entry) => entry.trim()).filter(Boolean);

  // A fragment with no verb and no marker is a qualifier on the one before it.
  const merged: string[] = [];
  for (const fragment of fragments) {
    const isQualifier = /^(?:at|in|on|for|with|under|during)\b/i.test(fragment) || fragment.split(/\s+/).length < 2;
    if (isQualifier && merged.length > 0) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}, ${fragment}`;
      continue;
    }
    merged.push(fragment);
  }

  if (merged.length <= 1) {
    const kind = classifyFragment(raw, input.defaultKind);
    return [{
      claimId: `${input.idPrefix}-1`,
      questionId: input.questionId,
      proposition: raw,
      kind,
      risk: riskFor(kind),
      configuration: input.configuration,
      subjectIds: input.subjectIds,
      provenance: input.provenance,
    }];
  }

  // The first fragment carries the grammatical subject; later fragments often
  // do not ("GPU A is 20% faster" / "cheaper"). Re-attaching it keeps each
  // claim independently readable, which is what makes it independently
  // checkable.
  const leadSubject = /^([A-Z0-9][\w .\-]*?)\s+(?:is|are|was|were|has|have|costs?|gets?)\b/.exec(merged[0]);
  const prefix = leadSubject ? leadSubject[1] : subject;

  return merged.map((fragment, index) => {
    const standalone = index === 0 || /^[A-Z0-9]/.test(fragment) && /\b(is|are|was|were|has|have|costs?|gets?)\b/.test(fragment)
      ? fragment
      : prefix
        // The fragment already carries its own verb ("is 40% faster",
        // "costs $549.99"); inserting another produced "GPU-A is costs $549.99".
        ? `${prefix} ${fragment}`
        : fragment;
    const kind = classifyFragment(fragment, input.defaultKind);
    return {
      claimId: `${input.idPrefix}-${index + 1}`,
      questionId: input.questionId,
      proposition: standalone,
      kind,
      risk: riskFor(kind),
      configuration: input.configuration,
      subjectIds: input.subjectIds,
      provenance: input.provenance,
    };
  });
}

/**
 * The weakest claim in a set.
 *
 * Creative copy that combines several claims may not sound more certain than
 * its weakest material component, and this is how that rule gets a value to
 * compare against.
 */
export function weakestRisk(claims: readonly AtomicClaim[]): ClaimRisk {
  return claims.reduce<ClaimRisk>(
    (worst, claim) => (CLAIM_RISK_ORDER[claim.risk] > CLAIM_RISK_ORDER[worst] ? claim.risk : worst),
    "low",
  );
}

export class QuoteIntegrityError extends Error {
  readonly code = "quote-integrity";
}

/**
 * Renders an observation for use in a script, refusing to fake a quote.
 *
 * A paraphrase or a model summary put inside quotation marks becomes a
 * fabricated quotation attributed to a real publisher, which is both a
 * misattribution and, for a source with a lawyer, a real problem. There is
 * deliberately no flag to override this.
 */
export function renderObservationForScript(
  observation: Observation,
  options: { readonly asQuote: boolean },
): string {
  if (!options.asQuote) {
    const attribution = observation.form === "inference" ? "SpecSmith inference" : "per the source";
    return `${observation.content} (${attribution})`;
  }
  if (!QUOTABLE_FORMS.includes(observation.form)) {
    throw new QuoteIntegrityError(
      `Observation ${observation.observationId} is a ${observation.form}, which may never be presented as a quotation. Only ${QUOTABLE_FORMS.join(" or ")} may be quoted.`,
    );
  }
  return `"${observation.content}"`;
}

/** Whether a piece of material may ever appear in quotation marks. */
export function isQuotable(form: MaterialForm): boolean {
  return QUOTABLE_FORMS.includes(form);
}

/**
 * Detects a claim asserting more than its observation shows.
 *
 * The checks are deliberately narrow and evidence-driven: a claim about a
 * configuration the observation did not fix, a claim dropping the time bound an
 * observation had, or a claim about a family when the observation was about one
 * SKU. Each returns the reason, so the generalization can be argued rather than
 * merely blocked.
 */
export function describeLeap(claim: AtomicClaim, observation: Observation): string[] {
  const leaps: string[] = [];
  const observed = observation.configuration;
  const claimed = claim.configuration;

  // A time-bounded observation supporting an unbounded present-tense claim.
  const TIME_BOUND_KINDS: readonly ClaimKind[] = ["current-price", "availability"];
  if (TIME_BOUND_KINDS.includes(claim.kind) && !/\b(at|on|as of)\b/i.test(claim.proposition)) {
    leaps.push(
      `A ${claim.kind} observation is true of one moment and one listing. "${claim.proposition}" states it without a time or seller, which the observation does not support.`,
    );
  }

  if (observed && claimed) {
    for (const key of ["resolution", "preset", "gameVersion", "driverVersion", "upscaler", "formFactor", "sku"] as const) {
      const observedValue = observed[key];
      const claimedValue = claimed[key];
      if (observedValue !== undefined && claimedValue !== undefined && observedValue !== claimedValue) {
        leaps.push(`Observation fixed ${key}=${String(observedValue)} but the claim is about ${key}=${String(claimedValue)}.`);
      }
    }
  }

  // An observation about one exact SKU supporting a claim with no SKU at all.
  if (observed?.sku && !claimed?.sku && claim.kind === "specification") {
    leaps.push(
      `Observation is about SKU ${observed.sku}; the claim drops the SKU and so asserts a property of the whole family.`,
    );
  }

  return leaps;
}

/** Guards against an unrecognised kind reaching the evidence rules. */
export function isClaimKind(value: unknown): value is ClaimKind {
  return typeof value === "string" && (CLAIM_KINDS as readonly string[]).includes(value);
}
