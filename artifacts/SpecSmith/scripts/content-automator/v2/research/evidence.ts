// Freshness, applicability, corroboration and conflict.
//
// These four are grouped because they are the four ways evidence can be REAL
// and still not support the claim in front of it:
//
//   freshness       it was true, and may not be now
//   applicability   it is true, of something else
//   corroboration   it looks like three sources and is one
//   conflict        two sources disagree and averaging them invents a third
//                   number nobody measured
//
// WHY THERE IS NO GLOBAL STALE-AFTER DURATION
// --------------------------------------------
// A retail price is stale within hours. A CPU socket is never stale. A game
// benchmark is invalidated by a patch rather than by the calendar. One global
// TTL would either treat sockets as expiring or treat prices as current, and
// both are wrong in a way that reaches a viewer.
//
// This mirrors the freshness doctrine already in src/lib/retail/offerSnapshot.ts,
// where the OLDEST stamp in a snapshot decides the whole snapshot's status —
// the same principle applied per claim kind instead of per file.

import { classifyFormFactor } from "../../../../src/lib/measured/hardwareMatch.ts";
import {
  APPLICABILITY_ORDER,
  type Applicability,
  type AtomicClaim,
  type ClaimConfiguration,
  type ClaimEvidenceLink,
  type ClaimKind,
  type Conflict,
  type Corroboration,
  type Freshness,
  type Observation,
  type SourceSnapshot,
} from "./model.ts";
import { describeLeap } from "./claims.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * How long evidence of each kind stays usable, and what invalidates it.
 *
 * `timeless: true` means the calendar does not age it — a socket is a socket.
 * `versionSensitive` names the field whose change matters more than elapsed
 * time: a two-day-old benchmark on last week's patch is worse than a two-month
 * -old one on the current patch, and only the version field can say so.
 */
interface FreshnessRule {
  readonly currentWithinMs?: number;
  readonly agingWithinMs?: number;
  readonly timeless?: boolean;
  readonly versionSensitive?: readonly (keyof ClaimConfiguration)[];
  readonly why: string;
}

const FRESHNESS_RULES: Record<ClaimKind, FreshnessRule> = {
  "current-price": {
    currentWithinMs: 6 * HOUR,
    agingWithinMs: DAY,
    why: "Retail prices move daily; a stale price presented as current is the failure SpecSmith's pricing rules exist to prevent.",
  },
  availability: {
    currentWithinMs: 2 * HOUR,
    agingWithinMs: 12 * HOUR,
    why: "Stock state changes faster than price and is not recoverable by rounding.",
  },
  specification: {
    timeless: true,
    why: "A published specification does not change for a shipped product; a revision would be a different SKU.",
  },
  compatibility: {
    timeless: true,
    versionSensitive: ["driverVersion"],
    why: "Physical and socket compatibility is stable, though driver-dependent behaviour is not.",
  },
  "performance-measured": {
    currentWithinMs: 120 * DAY,
    agingWithinMs: 365 * DAY,
    versionSensitive: ["gameVersion", "driverVersion"],
    why: "A benchmark is invalidated by a game patch or driver release rather than by elapsed time alone.",
  },
  "performance-estimated": {
    currentWithinMs: 90 * DAY,
    agingWithinMs: 365 * DAY,
    versionSensitive: ["gameVersion"],
    why: "An estimate tracks the catalogue it was computed from.",
  },
  comparison: {
    currentWithinMs: 120 * DAY,
    agingWithinMs: 365 * DAY,
    versionSensitive: ["gameVersion", "driverVersion"],
    why: "A relative result inherits the volatility of the measurements behind it.",
  },
  recommendation: {
    currentWithinMs: 30 * DAY,
    agingWithinMs: 90 * DAY,
    why: "A buying recommendation depends on prices and availability that move underneath it.",
  },
  "audience-behaviour": {
    currentWithinMs: 30 * DAY,
    agingWithinMs: 180 * DAY,
    why: "What an audience asks about shifts with releases and seasons.",
  },
  "platform-guidance": {
    currentWithinMs: 90 * DAY,
    agingWithinMs: 270 * DAY,
    why: "Platform rules and recommendations change without notice; old guidance is often confidently wrong.",
  },
  "misconception-exists": {
    currentWithinMs: 180 * DAY,
    agingWithinMs: 540 * DAY,
    why: "Misconceptions persist, but evidence that one is still current ages.",
  },
  "specsmith-product": {
    currentWithinMs: 30 * DAY,
    agingWithinMs: 120 * DAY,
    why: "SpecSmith's own routes and features change with deploys.",
  },
};

export interface FreshnessResult {
  readonly freshness: Freshness;
  readonly reason: string;
}

/**
 * Judges whether an observation is fresh enough for a claim kind, at a time.
 *
 * `now` is required rather than defaulted to `new Date()` so the classification
 * is deterministic and testable: a rule about time that cannot be tested at a
 * chosen time is a rule nobody has checked.
 */
export function assessFreshness(
  observation: Observation,
  claimKind: ClaimKind,
  now: Date,
  claimConfiguration?: ClaimConfiguration,
): FreshnessResult {
  const rule = FRESHNESS_RULES[claimKind];

  // A version mismatch beats the clock. Checked first for exactly that reason.
  for (const field of rule.versionSensitive ?? []) {
    const observed = observation.configuration?.[field];
    const claimed = claimConfiguration?.[field];
    if (observed !== undefined && claimed !== undefined && observed !== claimed) {
      return {
        freshness: "expired",
        reason: `Observed at ${field}=${String(observed)} but the claim concerns ${field}=${String(claimed)}. ${rule.why}`,
      };
    }
  }

  if (rule.timeless) {
    return { freshness: "timeless", reason: rule.why };
  }

  const observedAt = Date.parse(observation.observedAt);
  if (!Number.isFinite(observedAt)) {
    return { freshness: "unknown", reason: "The observation carries no parseable time, so its age cannot be established." };
  }

  const age = now.getTime() - observedAt;
  if (age < 0) {
    return { freshness: "unknown", reason: "The observation claims a time in the future; its age is not interpretable." };
  }

  const hours = Math.round(age / HOUR);
  if (rule.currentWithinMs !== undefined && age <= rule.currentWithinMs) {
    return { freshness: "current", reason: `Observed ${hours}h ago, inside the ${Math.round(rule.currentWithinMs / HOUR)}h window. ${rule.why}` };
  }
  if (rule.agingWithinMs !== undefined && age <= rule.agingWithinMs) {
    return { freshness: "aging", reason: `Observed ${hours}h ago, past the current window but inside the usable one. ${rule.why}` };
  }
  return {
    freshness: "stale",
    reason: `Observed ${hours}h ago, beyond the usable window for a ${claimKind} claim. ${rule.why}`,
  };
}

export interface ApplicabilityResult {
  readonly applicability: Applicability;
  readonly reasons: readonly string[];
}

/**
 * Whether evidence about one configuration says anything about another.
 *
 * The laptop/desktop check uses the SAME classifier the measured-observation
 * system uses (src/lib/measured/hardwareMatch.ts). Reimplementing that boundary
 * here would create a second definition of "is this a mobile part", and the two
 * would drift until one of them let a laptop 4070 benchmark stand in for a
 * desktop card.
 */
export function assessApplicability(
  claim: AtomicClaim,
  observation: Observation,
): ApplicabilityResult {
  const reasons: string[] = [];
  const observed = observation.configuration;
  const claimed = claim.configuration;

  if (!observed || !claimed) {
    return {
      applicability: "unknown",
      reasons: ["One side carries no configuration, so whether the evidence applies cannot be established."],
    };
  }

  // Form factor is absolute: a mobile part is a different product.
  for (const part of ["gpu", "cpu"] as const) {
    const observedName = observed[part];
    const claimedName = claimed[part];
    if (!observedName || !claimedName) continue;
    const observedForm = observed.formFactor ?? classifyFormFactor(observedName, part);
    const claimedForm = claimed.formFactor ?? classifyFormFactor(claimedName, part);
    if (observedForm !== claimedForm) {
      return {
        applicability: "not-applicable",
        reasons: [`Evidence is about a ${observedForm} ${part} (${observedName}); the claim is about a ${claimedForm} ${part} (${claimedName}). These are different products that share a name.`],
      };
    }
  }

  // An exact-SKU claim needs exact-SKU evidence.
  if (claimed.sku && observed.sku && claimed.sku !== observed.sku) {
    return {
      applicability: "not-applicable",
      reasons: [`Evidence is for SKU ${observed.sku}; the claim is about SKU ${claimed.sku}.`],
    };
  }
  if (claimed.sku && !observed.sku) {
    reasons.push(`The claim names SKU ${claimed.sku} but the evidence is not SKU-specific, so board-partner differences are unaccounted for.`);
  }

  let mismatches = 0;
  for (const key of ["gameId", "resolution", "preset", "upscaler", "rayTracing", "frameGeneration"] as const) {
    const observedValue = observed[key];
    const claimedValue = claimed[key];
    if (observedValue === undefined || claimedValue === undefined) continue;
    if (observedValue !== claimedValue) {
      mismatches += 1;
      reasons.push(`${key}: evidence ${String(observedValue)}, claim ${String(claimedValue)}.`);
    }
  }

  // A frame-generated figure is not a rendered-frame figure, whatever else matches.
  if (observed.frameGeneration === true && claimed.frameGeneration !== true) {
    return {
      applicability: "not-applicable",
      reasons: [...reasons, "Evidence reports frame-generated displayed frames; the claim is about rendered frames. These are not the same measurement."],
    };
  }

  if (mismatches === 0 && reasons.length === 0) return { applicability: "exact", reasons: ["Every fixed condition matches."] };
  if (mismatches === 0) return { applicability: "close", reasons };
  if (mismatches === 1) return { applicability: "partial", reasons };
  return { applicability: "weak", reasons };
}

/** Builds the full link between one claim and one observation. */
export function linkEvidence(
  claim: AtomicClaim,
  observation: Observation,
  stance: ClaimEvidenceLink["stance"],
  now: Date,
): ClaimEvidenceLink {
  const applicability = assessApplicability(claim, observation);
  const freshness = assessFreshness(observation, claim.kind, now, claim.configuration);
  const leaps = describeLeap(claim, observation);
  return {
    claimId: claim.claimId,
    observationId: observation.observationId,
    stance,
    applicability: applicability.applicability,
    applicabilityReasons: applicability.reasons,
    freshness: freshness.freshness,
    freshnessReason: freshness.reason,
    generalisesBeyondObservation: leaps.length > 0,
  };
}

/**
 * Counts how many INDEPENDENT origins support a claim.
 *
 * Three articles citing one press release are one piece of evidence. Sources
 * are collapsed by their upstream lineage first and by publisher second: two
 * URLs from one publisher are also one origin, because a publisher running the
 * same wire story twice has not tested anything twice.
 */
export function assessCorroboration(
  claimId: string,
  snapshots: readonly SourceSnapshot[],
): Corroboration {
  const groups = new Map<string, string[]>();
  for (const snapshot of snapshots) {
    // Lineage first: a declared upstream is the strongest dependence signal.
    const key = snapshot.upstreamSourceId ?? `publisher:${snapshot.source.publisher.trim().toLowerCase()}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(snapshot.snapshotId);
    else groups.set(key, [snapshot.snapshotId]);
  }

  const dependentGroups = [...groups.values()].filter((group) => group.length > 1);
  const independentOriginCount = groups.size;

  const reason = dependentGroups.length
    ? `${snapshots.length} snapshot(s) collapse to ${independentOriginCount} independent origin(s): ${dependentGroups.map((group) => group.join(" + ")).join("; ")} share an origin and do not corroborate each other.`
    : `${independentOriginCount} independent origin(s), none sharing a publisher or declared upstream source.`;

  return {
    claimId,
    snapshotIds: snapshots.map((snapshot) => snapshot.snapshotId),
    independentOriginCount,
    dependentGroups,
    reason,
  };
}

/**
 * Records a disagreement, and whether a difference explains it.
 *
 * Note what this does NOT do: it never picks a winner on the basis that one
 * number is nicer, and it never averages. When a configuration or date
 * difference explains the disagreement, the conflict is resolved because the
 * sources were measuring different things; otherwise it stays open and the
 * claim becomes `disputed`.
 */
export function detectConflict(
  claim: AtomicClaim,
  observations: readonly Observation[],
): Conflict | null {
  const contradicting = observations.filter((entry) => entry.fields !== undefined);
  if (contradicting.length < 2) return null;

  // Compare the numeric field the claim is about across observations.
  const numericKeys = new Set<string>();
  for (const observation of contradicting) {
    for (const [key, value] of Object.entries(observation.fields ?? {})) {
      if (typeof value === "number") numericKeys.add(key);
    }
  }

  for (const key of [...numericKeys].sort()) {
    const values = contradicting
      .map((observation) => ({ observation, value: observation.fields?.[key] }))
      .filter((entry): entry is { observation: Observation; value: number } => typeof entry.value === "number");
    if (values.length < 2) continue;

    const min = Math.min(...values.map((entry) => entry.value));
    const max = Math.max(...values.map((entry) => entry.value));
    // A disagreement worth recording, not float noise.
    if (min === 0 || (max - min) / Math.abs(min) < 0.05) continue;

    const configs = values.map((entry) => entry.observation.configuration ?? {});
    const explanation = explainDifference(configs);
    return {
      claimId: claim.claimId,
      snapshotIds: values.map((entry) => entry.observation.snapshotId),
      whatConflicts: `${key} ranges from ${min} to ${max} across sources (${Math.round(((max - min) / Math.abs(min)) * 100)}% spread).`,
      explanation,
      resolved: explanation !== undefined,
      resolutionReason: explanation
        ? `The sources measured different things (${explanation}), so they do not actually contradict each other.`
        : undefined,
    };
  }

  return null;
}

/** Finds a configuration difference that would explain two numbers differing. */
function explainDifference(configs: readonly ClaimConfiguration[]): Conflict["explanation"] {
  const differs = (key: keyof ClaimConfiguration) => {
    const present = configs.map((config) => config[key]).filter((value) => value !== undefined);
    return present.length > 1 && new Set(present.map(String)).size > 1;
  };
  if (differs("resolution") || differs("preset") || differs("upscaler") || differs("rayTracing") || differs("frameGeneration")) {
    return "different-configuration";
  }
  if (differs("gameVersion") || differs("driverVersion")) return "different-date";
  return undefined;
}

/** The weakest applicability across a set of links — the one that governs. */
export function weakestApplicability(links: readonly ClaimEvidenceLink[]): Applicability {
  if (links.length === 0) return "unknown";
  return links.reduce<Applicability>(
    (worst, link) => (APPLICABILITY_ORDER[link.applicability] < APPLICABILITY_ORDER[worst] ? link.applicability : worst),
    "exact",
  );
}
