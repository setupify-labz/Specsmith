// MASTER #5 — Assignment binding and creative lineage (sections 7, 8, 19, 35, 52, 56).
//
// Two jobs, both about identity.
//
// ASSIGNMENT binds one published creative to one variant, before results are
// read, permanently. The failure this prevents is the most seductive one in all
// of content experimentation: looking at the numbers, noticing that the video
// you now prefer is in the losing arm, and deciding it was "really" the other
// variant. `bindAssignment` refuses a rebind outright — not with a warning,
// with an exception.
//
// LINEAGE answers "how many independent things am I actually looking at?".
// Three platform adaptations of one video are one idea observed three times,
// not three confirmations that the idea works. A repost is not a replication.
// Section 19 is blunt about this and so is `countIndependentUnits`.

import type { VideoPlatform } from "../../types.ts";
import type { ExperimentAssignment } from "./model.ts";

export class AssignmentError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AssignmentError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Lineage (section 8)
// ---------------------------------------------------------------------------

/**
 * How one creative relates to another.
 *
 * The relation decides whether two observations are independent evidence or the
 * same evidence counted twice.
 */
export type LineageRelation =
  /** Built from scratch for this experiment. Independent. */
  | "original"
  /** Same concept, one dimension deliberately changed. The experiment sibling. */
  | "experiment-sibling"
  /** Same cut, re-packaged for another platform. NOT independent. */
  | "platform-adaptation"
  /** Same asset posted again. Independent only if the design says so. */
  | "repost"
  /** The same creative re-rendered or edited. Supersedes its parent. */
  | "revision"
  /** Same concept, different topic. Independent for replication purposes. */
  | "topic-replication";

export const LINEAGE_RELATIONS: readonly LineageRelation[] = [
  "original", "experiment-sibling", "platform-adaptation", "repost", "revision", "topic-replication",
];

/**
 * Relations that produce an INDEPENDENT experimental unit.
 *
 * A platform adaptation is excluded: the same script, topic and moment carried
 * to another surface tells you about that surface, not a second time about the
 * idea. A repost is excluded by default and can only count when the design
 * explicitly declared it as a unit (section 56).
 */
const INDEPENDENT_RELATIONS = new Set<LineageRelation>(["original", "experiment-sibling", "topic-replication"]);

export function relationIsIndependent(relation: LineageRelation): boolean {
  return INDEPENDENT_RELATIONS.has(relation);
}

export interface CreativeLineageNode {
  readonly creativeId: string;
  readonly lineageId: string;
  readonly parentCreativeId: string | null;
  readonly relation: LineageRelation;
  readonly platform: VideoPlatform;
  readonly topicId: string;
  /** Present only for a repost the experiment design named as its own unit. */
  readonly declaredIndependentByDesign?: boolean;
}

/**
 * Group creatives into independent units.
 *
 * Correlated creatives (adaptations, reposts, revisions) collapse onto the
 * lineage root they descend from. What comes back is the honest count: how many
 * genuinely separate chances this idea had to succeed or fail.
 */
export interface IndependenceBreakdown {
  /** Every placement, including correlated ones. The number that flatters. */
  readonly rawPlacementCount: number;
  readonly uniqueCreativeCount: number;
  /** The number that may be used as a sample size. */
  readonly independentUnitCount: number;
  readonly units: readonly { readonly unitId: string; readonly creativeIds: readonly string[] }[];
  readonly correlatedGroups: readonly { readonly unitId: string; readonly creativeIds: readonly string[]; readonly why: string }[];
  readonly explanation: string;
}

export function countIndependentUnits(nodes: readonly CreativeLineageNode[]): IndependenceBreakdown {
  const byUnit = new Map<string, CreativeLineageNode[]>();

  for (const node of nodes) {
    // The unit is the LINEAGE, not the creative. A producer expresses
    // independence by starting a new lineage: an original and an experiment
    // sibling each get their own lineageId, while a platform adaptation, a
    // repost and a revision all inherit their parent's.
    //
    // Grouping by creativeId instead would give each adaptation its own unit,
    // which is exactly the sample inflation section 19 forbids — three
    // placements of one idea would read as three confirmations.
    //
    // `declaredIndependentByDesign` is the single override, for a repost the
    // design deliberately treated as its own experimental unit (section 56).
    const unitId = node.declaredIndependentByDesign === true ? node.creativeId : node.lineageId;
    const group = byUnit.get(unitId) ?? [];
    group.push(node);
    byUnit.set(unitId, group);
  }

  const units = [...byUnit.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([unitId, group]) => ({ unitId, creativeIds: group.map((node) => node.creativeId).sort() }));

  const correlatedGroups = units
    .filter((unit) => unit.creativeIds.length > 1)
    .map((unit) => {
      const group = byUnit.get(unit.unitId)!;
      const relations = [...new Set(group.map((node) => node.relation))].sort();
      return {
        unitId: unit.unitId,
        creativeIds: unit.creativeIds,
        why:
          `${unit.creativeIds.length} placements share lineage ${unit.unitId} (${relations.join(", ")}). ` +
          "They are the same idea observed more than once, not independent confirmations of it.",
      };
    });

  const uniqueCreativeCount = new Set(nodes.map((node) => node.creativeId)).size;

  return {
    rawPlacementCount: nodes.length,
    uniqueCreativeCount,
    independentUnitCount: units.length,
    units,
    correlatedGroups,
    explanation:
      `${nodes.length} placement(s) across ${uniqueCreativeCount} creative(s) reduce to ${units.length} independent unit(s). ` +
      (correlatedGroups.length > 0
        ? `${correlatedGroups.length} group(s) are correlated and were not counted separately.`
        : "No correlated placements were found."),
  };
}

// ---------------------------------------------------------------------------
// Assignment binding (sections 7, 35, 52)
// ---------------------------------------------------------------------------

export interface AssignmentInput {
  readonly experimentId: string;
  readonly experimentRevision: number;
  readonly variantId: string;
  readonly creativeId: string;
  readonly creativeLineageId: string;
  readonly platform: VideoPlatform;
  readonly packageId: string;
  readonly approvedMediaSha256: string;
  readonly providerPostId: string | null;
  readonly publishedAt: string | null;
  readonly now: Date;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * An append-only ledger of assignments.
 *
 * Every rejection here corresponds to a specific way a comparison can be
 * quietly corrupted, and each one is a hard failure rather than a warning
 * because a warning in this position is an invitation.
 */
export class AssignmentLedger {
  private readonly byId = new Map<string, ExperimentAssignment>();
  private readonly byCreative = new Map<string, ExperimentAssignment>();
  private readonly byProviderPost = new Map<string, ExperimentAssignment>();

  /**
   * Bind a creative to a variant.
   *
   * Exact replay is idempotent — re-running a pipeline must not fail. Any
   * CONFLICTING replay is refused by name.
   */
  bind(input: AssignmentInput): ExperimentAssignment {
    if (!SHA256_PATTERN.test(input.approvedMediaSha256)) {
      throw new AssignmentError(
        "malformed-sha",
        `approvedMediaSha256 "${input.approvedMediaSha256}" is not a sha256 digest. Performance must bind to the exact bytes ` +
          "that shipped; loose identifiers permit 'probably this video'.",
      );
    }

    const assignmentId = `assign-${input.experimentId}-r${input.experimentRevision}-${input.creativeId}`;
    const candidate: ExperimentAssignment = {
      assignmentId,
      experimentId: input.experimentId,
      experimentRevision: input.experimentRevision,
      variantId: input.variantId,
      creativeId: input.creativeId,
      creativeLineageId: input.creativeLineageId,
      platform: input.platform,
      packageId: input.packageId,
      approvedMediaSha256: input.approvedMediaSha256,
      providerPostId: input.providerPostId,
      publishedAt: input.publishedAt,
      assignedAt: input.now.toISOString(),
      method: "explicit-declaration",
    };

    // 1. The same creative may not sit in two variants (NC1).
    const existingForCreative = this.byCreative.get(input.creativeId);
    if (existingForCreative !== undefined) {
      if (existingForCreative.variantId !== input.variantId) {
        throw new AssignmentError(
          "creative-already-assigned",
          `Creative ${input.creativeId} is already assigned to variant "${existingForCreative.variantId}" in experiment ` +
            `${existingForCreative.experimentId}. Reassigning it to "${input.variantId}" would let one video count as evidence ` +
            "for both sides of its own comparison.",
        );
      }
      if (existingForCreative.experimentId !== input.experimentId) {
        throw new AssignmentError(
          "creative-in-other-experiment",
          `Creative ${input.creativeId} is already assigned in experiment ${existingForCreative.experimentId}. ` +
            "One creative cannot serve as an independent unit in two experiments at once.",
        );
      }
      if (existingForCreative.approvedMediaSha256 !== input.approvedMediaSha256) {
        throw new AssignmentError(
          "media-changed-after-assignment",
          `Creative ${input.creativeId} was assigned with media ${existingForCreative.approvedMediaSha256.slice(0, 12)} and is now ` +
            `${input.approvedMediaSha256.slice(0, 12)}. Different bytes are a different creative; re-render means re-assign as a revision.`,
        );
      }
    }

    // 2. One provider post is one published thing (NC17).
    if (input.providerPostId !== null) {
      const existingForPost = this.byProviderPost.get(input.providerPostId);
      if (existingForPost !== undefined && existingForPost.creativeId !== input.creativeId) {
        throw new AssignmentError(
          "provider-post-collision",
          `Provider post ${input.providerPostId} is already bound to creative ${existingForPost.creativeId}. ` +
            "Binding it to a second creative would attribute one post's analytics to two different videos.",
        );
      }
    }

    // 3. Conflicting replay of the same assignment id (section 52).
    const existingById = this.byId.get(assignmentId);
    if (existingById !== undefined) {
      const sameExceptTimestamp =
        existingById.variantId === candidate.variantId &&
        existingById.approvedMediaSha256 === candidate.approvedMediaSha256 &&
        existingById.packageId === candidate.packageId &&
        existingById.platform === candidate.platform &&
        existingById.providerPostId === candidate.providerPostId;
      if (sameExceptTimestamp) return existingById;
      throw new AssignmentError(
        "conflicting-assignment-replay",
        `Assignment ${assignmentId} already exists with different content. An exact replay is idempotent; a conflicting one ` +
          "is a different assignment wearing the same identity.",
      );
    }

    // 4. Chronology (section 53).
    if (input.publishedAt !== null && Date.parse(input.publishedAt) < Date.parse(candidate.assignedAt)) {
      throw new AssignmentError(
        "assigned-after-publish",
        `Creative ${input.creativeId} was published at ${input.publishedAt} but assigned at ${candidate.assignedAt}. ` +
          "Assignment after publication cannot be distinguished from choosing the variant once the result was visible.",
      );
    }

    this.byId.set(assignmentId, candidate);
    this.byCreative.set(input.creativeId, candidate);
    if (input.providerPostId !== null) this.byProviderPost.set(input.providerPostId, candidate);
    return candidate;
  }

  /**
   * Attach a provider post and publication time to an existing assignment.
   *
   * Publication happens after assignment, so this is legal — but the variant is
   * NOT re-openable here, which is the point.
   */
  recordPublication(creativeId: string, providerPostId: string, publishedAt: string): ExperimentAssignment {
    const existing = this.byCreative.get(creativeId);
    if (existing === undefined) {
      throw new AssignmentError("unknown-creative", `Creative ${creativeId} has no assignment to attach a publication to.`);
    }
    if (existing.providerPostId !== null && existing.providerPostId !== providerPostId) {
      throw new AssignmentError(
        "provider-post-rebind",
        `Creative ${creativeId} is already bound to provider post ${existing.providerPostId}; rebinding to ${providerPostId} ` +
          "would move its analytics to a different published object.",
      );
    }
    if (Date.parse(publishedAt) < Date.parse(existing.assignedAt)) {
      throw new AssignmentError(
        "publish-before-assignment",
        `Publication at ${publishedAt} precedes assignment at ${existing.assignedAt}.`,
      );
    }

    const collision = this.byProviderPost.get(providerPostId);
    if (collision !== undefined && collision.creativeId !== creativeId) {
      throw new AssignmentError(
        "provider-post-collision",
        `Provider post ${providerPostId} is already bound to creative ${collision.creativeId}.`,
      );
    }

    const updated: ExperimentAssignment = { ...existing, providerPostId, publishedAt };
    this.byId.set(updated.assignmentId, updated);
    this.byCreative.set(creativeId, updated);
    this.byProviderPost.set(providerPostId, updated);
    return updated;
  }

  forCreative(creativeId: string): ExperimentAssignment | null {
    return this.byCreative.get(creativeId) ?? null;
  }

  forProviderPost(providerPostId: string): ExperimentAssignment | null {
    return this.byProviderPost.get(providerPostId) ?? null;
  }

  forExperiment(experimentId: string): readonly ExperimentAssignment[] {
    return [...this.byId.values()]
      .filter((assignment) => assignment.experimentId === experimentId)
      .sort((a, b) => a.assignmentId.localeCompare(b.assignmentId));
  }

  forVariant(experimentId: string, variantId: string): readonly ExperimentAssignment[] {
    return this.forExperiment(experimentId).filter((assignment) => assignment.variantId === variantId);
  }

  all(): readonly ExperimentAssignment[] {
    return [...this.byId.values()].sort((a, b) => a.assignmentId.localeCompare(b.assignmentId));
  }
}

// ---------------------------------------------------------------------------
// Selection-bias protection (section 23)
// ---------------------------------------------------------------------------

export interface SelectionBiasFinding {
  readonly code: string;
  readonly message: string;
}

/**
 * Compare what was ASSIGNED against what is being ANALYSED.
 *
 * The registry knows the intended assignments before any outcome is read, so a
 * creative that was assigned but is missing from analysis is detectable — and
 * that gap is exactly what survivorship bias looks like from the inside.
 */
export function detectSelectionBias(
  assigned: readonly ExperimentAssignment[],
  analysedCreativeIds: readonly string[],
): readonly SelectionBiasFinding[] {
  const findings: SelectionBiasFinding[] = [];
  const analysed = new Set(analysedCreativeIds);

  const missing = assigned.filter((assignment) => !analysed.has(assignment.creativeId));
  if (missing.length > 0) {
    findings.push({
      code: "assigned-but-not-analysed",
      message:
        `${missing.length} assigned creative(s) are absent from the analysis: ${missing.map((a) => `${a.creativeId} (${a.variantId})`).join(", ")}. ` +
        "Every assigned unit must be accounted for; dropping one silently is survivorship bias, whether or not it was deliberate.",
    });
  }

  const assignedIds = new Set(assigned.map((assignment) => assignment.creativeId));
  const extra = analysedCreativeIds.filter((id) => !assignedIds.has(id));
  if (extra.length > 0) {
    findings.push({
      code: "analysed-but-not-assigned",
      message:
        `${extra.length} creative(s) appear in the analysis without an assignment: ${extra.join(", ")}. ` +
        "An unassigned creative cannot be evidence for a variant it was never part of.",
    });
  }

  // Every arm must still be represented; a variant analysed to zero units means
  // the comparison lost a side.
  const byVariant = new Map<string, number>();
  for (const assignment of assigned) {
    const present = analysed.has(assignment.creativeId) ? 1 : 0;
    byVariant.set(assignment.variantId, (byVariant.get(assignment.variantId) ?? 0) + present);
  }
  for (const [variantId, count] of [...byVariant.entries()].sort()) {
    if (count === 0) {
      findings.push({
        code: "variant-entirely-missing",
        message: `Variant "${variantId}" has no analysed observations at all, so there is no comparison left to make.`,
      });
    }
  }

  return findings;
}
