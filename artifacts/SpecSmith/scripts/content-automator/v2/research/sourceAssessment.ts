// Source intelligence.
//
// A URL IS NOT EVIDENCE QUALITY
// ------------------------------
// The naive version of this module scores domains: nvidia.com gets 0.9, reddit
// gets 0.2, done. That is wrong in both directions. NVIDIA's own page is the
// best possible source for how much VRAM a card has and among the worst for
// how that card performs against a competitor, because the second question is
// one NVIDIA has an interest in the answer to. Reddit is poor evidence that a
// technical claim is true and good evidence that people are confused about it.
//
// So assessment here is a function of (source, question), never of source
// alone. SOURCE_FITNESS below is the table that makes that explicit.
//
// WHY GRADES AND NOT FLOATS
// --------------------------
// `sourceTrust: 0.873192` is false precision: nothing in the inputs justifies
// the third decimal place, and once a number like that exists people start
// averaging and thresholding it as though it meant something. Interpretable
// grades with attached reasons can be argued with, which is the point.

import {
  type ClaimKind,
  type Directness,
  type Grade,
  type SourceAssessment,
  type SourceSnapshot,
  type SourceType,
  INDIRECT_RETRIEVAL,
} from "./model.ts";

/**
 * How well each source type answers each kind of question.
 *
 * Read a row as: "for THIS kind of claim, how much does this source type's word
 * count". The asymmetries are the content — manufacturer documentation is
 * `high` for specifications and `low` for measured performance, and that single
 * distinction prevents a marketing chart being treated as a benchmark.
 *
 * Absent entries default to `low`, so a source type is never assumed competent
 * for a question nobody considered it for.
 */
const SOURCE_FITNESS: Partial<Record<ClaimKind, Partial<Record<SourceType, Grade>>>> = {
  specification: {
    "manufacturer-documentation": "high",
    "first-party-specsmith": "high",
    "independent-review": "medium",
    "retailer-listing": "medium",
    "editorial-article": "medium",
    "manufacturer-marketing": "medium",
    aggregator: "low",
  },
  "current-price": {
    // Only an actual listing evidences an actual price. An MSRP in an article
    // is an editorial field about a different thing.
    "retailer-listing": "high",
    "first-party-specsmith": "high",
    "editorial-article": "low",
    "manufacturer-documentation": "low",
    "manufacturer-marketing": "low",
  },
  availability: { "retailer-listing": "high", "first-party-specsmith": "medium" },
  "performance-measured": {
    "independent-benchmark": "high",
    "independent-review": "high",
    "first-party-specsmith": "high",
    // The load-bearing cell: a vendor's own chart is not an independent test.
    "manufacturer-marketing": "low",
    "manufacturer-documentation": "low",
    "community-discussion": "low",
    aggregator: "medium",
  },
  "performance-estimated": { "first-party-specsmith": "high", "independent-benchmark": "medium" },
  compatibility: {
    "manufacturer-documentation": "high",
    "first-party-specsmith": "high",
    "independent-review": "medium",
    "community-discussion": "low",
  },
  comparison: { "independent-benchmark": "high", "independent-review": "high", "manufacturer-marketing": "low" },
  recommendation: { "independent-review": "medium", "first-party-specsmith": "medium" },
  "audience-behaviour": {
    // Community discussion IS the primary evidence of what an audience asks.
    "community-discussion": "high",
    "social-post": "medium",
    aggregator: "low",
  },
  "misconception-exists": { "community-discussion": "high", "social-post": "medium" },
  "platform-guidance": {
    "platform-official-guidance": "high",
    "editorial-article": "low",
    "social-post": "low",
  },
  "specsmith-product": { "first-party-specsmith": "high" },
};

/** Source types whose authority is inherent rather than question-dependent. */
const BASE_AUTHORITY: Record<SourceType, Grade> = {
  "first-party-specsmith": "high",
  "manufacturer-documentation": "high",
  "platform-official-guidance": "high",
  "independent-benchmark": "high",
  "independent-review": "medium",
  "retailer-listing": "medium",
  "editorial-article": "medium",
  "manufacturer-marketing": "medium",
  aggregator: "low",
  "community-discussion": "low",
  "social-post": "low",
  unknown: "unknown",
};

/** Source types with a stake in the answer to a comparative or value question. */
const INTERESTED_PARTIES: readonly SourceType[] = [
  "manufacturer-marketing", "manufacturer-documentation", "retailer-listing",
];

/** Claim kinds where the source's own commercial interest is engaged. */
const COMMERCIALLY_LOADED: readonly ClaimKind[] = [
  "performance-measured", "comparison", "recommendation", "current-price", "availability",
];

const DEFAULT_DIRECTNESS: Record<SourceType, Directness> = {
  "first-party-specsmith": "primary",
  "manufacturer-documentation": "primary",
  "manufacturer-marketing": "primary",
  "retailer-listing": "primary",
  "independent-benchmark": "primary",
  "independent-review": "primary",
  "platform-official-guidance": "primary",
  "community-discussion": "primary",
  "social-post": "primary",
  "editorial-article": "secondary",
  aggregator: "secondary",
  unknown: "unknown",
};

/** Source types that publish their test method often enough to expect one. */
const TRANSPARENT_BY_DEFAULT: readonly SourceType[] = [
  "independent-benchmark", "first-party-specsmith", "manufacturer-documentation",
];

function downgrade(grade: Grade): Grade {
  if (grade === "high") return "medium";
  if (grade === "medium") return "low";
  return grade;
}

/**
 * Assesses one snapshot FOR ONE KIND OF CLAIM.
 *
 * The claimKind argument is not optional and has no default, because an
 * assessment without a question is the domain-scoring mistake this module
 * exists to avoid.
 */
export function assessSource(snapshot: SourceSnapshot, claimKind: ClaimKind): SourceAssessment {
  const type = snapshot.source.sourceType;
  const reasons: string[] = [];
  const limitations: string[] = [];

  const relevance = SOURCE_FITNESS[claimKind]?.[type] ?? "low";
  reasons.push(`${type} is graded ${relevance} for ${claimKind} claims.`);
  if (relevance === "low") {
    limitations.push(`This source type is weak evidence for a ${claimKind} claim, whatever its general reputation.`);
  }

  let authority = BASE_AUTHORITY[type];
  // A source nobody actually read cannot lend its authority to anything: the
  // material might not say what a search summary reports it says.
  const materialObserved = !INDIRECT_RETRIEVAL.includes(snapshot.retrievalMethod);
  if (!materialObserved) {
    authority = downgrade(authority);
    limitations.push("The underlying material was never observed directly; this is a report about the source, not the source.");
    reasons.push(`Retrieved via ${snapshot.retrievalMethod}, so the original was not read.`);
  }

  // Retelling is not a second opinion.
  let directness = DEFAULT_DIRECTNESS[type];
  if (snapshot.upstreamSourceId) {
    directness = directness === "primary" ? "secondary" : "tertiary";
    limitations.push(`Restates ${snapshot.upstreamSourceId}; it is not independent of it.`);
    reasons.push("Declares an upstream source, so it is a retelling.");
  }

  const conflicted = INTERESTED_PARTIES.includes(type) && COMMERCIALLY_LOADED.includes(claimKind);
  if (conflicted) {
    limitations.push(`This source has a commercial interest in the answer to a ${claimKind} question.`);
    reasons.push("Commercial interest engaged by this claim kind.");
  }

  const independence: Grade = conflicted
    ? "low"
    : snapshot.upstreamSourceId
      ? "low"
      : type === "independent-benchmark" || type === "independent-review"
        ? "high"
        : type === "unknown"
          ? "unknown"
          : "medium";

  const transparency: Grade = TRANSPARENT_BY_DEFAULT.includes(type)
    ? materialObserved ? "high" : "medium"
    : type === "community-discussion" || type === "social-post"
      ? "low"
      : "medium";

  if (!snapshot.publishedAt) {
    limitations.push("No publication date, so age cannot be established.");
  }
  if (!snapshot.contentHash) {
    limitations.push("No content hash, so a later change to this source would be undetectable.");
  }

  return {
    snapshotId: snapshot.snapshotId,
    authority,
    directness,
    methodologicalTransparency: transparency,
    independence,
    relevanceToClaimKind: relevance,
    conflictOfInterest: conflicted ? "likely" : snapshot.upstreamSourceId ? "possible" : "none-known",
    materialObserved,
    limitations,
    reasons,
  };
}

/**
 * Ranks snapshots for a question, best first.
 *
 * The ordering is by fitness for THIS claim kind before general authority, so a
 * retailer listing outranks a manufacturer page for a price question and loses
 * to it for a specification question. Ties break deterministically on
 * snapshotId so the same inputs always produce the same order.
 */
export function rankSourcesForClaim(
  snapshots: readonly SourceSnapshot[],
  claimKind: ClaimKind,
): { snapshot: SourceSnapshot; assessment: SourceAssessment }[] {
  const score = (grade: Grade) => (grade === "high" ? 3 : grade === "medium" ? 2 : grade === "low" ? 1 : 0);
  const directnessScore = (value: Directness) =>
    value === "primary" ? 3 : value === "secondary" ? 2 : value === "tertiary" ? 1 : 0;

  return snapshots
    .map((snapshot) => ({ snapshot, assessment: assessSource(snapshot, claimKind) }))
    .sort((a, b) => {
      const fitness = score(b.assessment.relevanceToClaimKind) - score(a.assessment.relevanceToClaimKind);
      if (fitness !== 0) return fitness;
      const authority = score(b.assessment.authority) - score(a.assessment.authority);
      if (authority !== 0) return authority;
      const direct = directnessScore(b.assessment.directness) - directnessScore(a.assessment.directness);
      if (direct !== 0) return direct;
      const independence = score(b.assessment.independence) - score(a.assessment.independence);
      if (independence !== 0) return independence;
      return a.snapshot.snapshotId.localeCompare(b.snapshot.snapshotId);
    });
}
