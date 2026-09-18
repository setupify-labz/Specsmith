// MASTER #5 — Experiment registry, design hash and preregistration
// (sections 2, 6, 11, 24, 52, 84, 85, 87).
//
// This file exists to make ONE class of cheating impossible: deciding what you
// were testing after you have seen the results.
//
// The mechanism is preregistration. Before any observation is read, the design
// — primary metric, window, variants, controlled differences, stop rules — is
// hashed and frozen. Every later evaluation checks that hash. Changing the
// primary metric because a different one favoured your variant produces a new
// revision with a new hash, and the evaluation refuses to treat it as the
// experiment that was registered.
//
// This is not paranoia about dishonesty. Post-hoc metric switching is something
// careful people do accidentally, constantly, because the metric that moved is
// genuinely more interesting than the one that did not.

import { createHash } from "node:crypto";

import {
  designIsFrozen,
  dimensionIsForbidden,
  type Experiment,
  type ExperimentStatus,
  type ExperimentVariant,
} from "./model.ts";
import { lookupMetric, MANDATORY_GUARDRAIL_IDS, primaryMetricSuitsObjective } from "./metrics.ts";

export class ExperimentDesignError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ExperimentDesignError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Design hash (section 85)
// ---------------------------------------------------------------------------

/**
 * The fields that define what the experiment IS.
 *
 * Deliberately excludes status, timestamps and provenance: an experiment moving
 * from `ready` to `running` is the same experiment, but an experiment whose
 * primary metric changed is not. Keys are sorted so the hash is stable
 * regardless of object construction order.
 */
export function canonicalDesign(experiment: Experiment): string {
  const canonical = {
    experimentId: experiment.experimentId,
    hypothesis: {
      proposition: experiment.hypothesis.proposition,
      expectedDirection: experiment.hypothesis.expectedDirection,
      primaryMetricId: experiment.hypothesis.primaryMetricId,
      measurementWindow: experiment.hypothesis.measurementWindow,
      falsificationCondition: experiment.hypothesis.falsificationCondition,
    },
    scope: experiment.scope,
    primaryMetricId: experiment.primaryMetricId,
    secondaryMetricIds: [...experiment.secondaryMetricIds].sort(),
    guardrailMetricIds: [...experiment.guardrailMetricIds].sort(),
    missionId: experiment.missionId,
    observationWindow: experiment.observationWindow,
    variants: [...experiment.variants]
      .map((variant) => ({
        variantId: variant.variantId,
        isControl: variant.isControl,
        differences: [...variant.differences]
          .map((difference) => ({ dimension: difference.dimension, control: difference.control, variant: difference.variant }))
          .sort((a, b) => a.dimension.localeCompare(b.dimension)),
      }))
      .sort((a, b) => a.variantId.localeCompare(b.variantId)),
    invariants: experiment.invariants,
    minimumEvidence: experiment.minimumEvidence,
    stopConditions: [...experiment.stopConditions].map((c) => c.code).sort(),
  };
  // Deliberately NOT `JSON.stringify(canonical, Object.keys(canonical).sort())`.
  // An array replacer is a key WHITELIST applied at every level, so every
  // nested field — the minimum-evidence numbers, each controlled difference's
  // control and variant values, every invariant — would be silently dropped
  // from the hash. The design could then be edited after registration in all
  // the places that matter most while the hash stayed identical.
  return stableStringify(canonical);
}

/**
 * Deterministic JSON with keys sorted at every level.
 *
 * Object key order is an accident of construction, so hashing raw
 * `JSON.stringify` output would make an identical design hash differently
 * depending on how it was built.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(",")}}`;
}

export function computeDesignHash(experiment: Experiment): string {
  return createHash("sha256").update(canonicalDesign(experiment)).digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------------------
// Design validation (sections 2, 11, 12)
// ---------------------------------------------------------------------------

export interface DesignFinding {
  readonly code: string;
  readonly severity: "hard-fail" | "warning";
  readonly message: string;
}

/**
 * Check a design before it may be registered.
 *
 * Every hard failure here is something that would make the eventual result
 * uninterpretable or unsafe, caught at design time when it is still cheap to
 * fix rather than at result time when the videos already exist.
 */
export function validateDesign(experiment: Experiment): readonly DesignFinding[] {
  const findings: DesignFinding[] = [];
  const fail = (code: string, message: string) => findings.push({ code, severity: "hard-fail", message });
  const warn = (code: string, message: string) => findings.push({ code, severity: "warning", message });

  // --- Variants -----------------------------------------------------------
  if (experiment.variants.length < 2) {
    fail("too-few-variants", "An experiment needs at least two variants; there is nothing to compare otherwise.");
  }
  const controls = experiment.variants.filter((variant) => variant.isControl);
  if (controls.length !== 1) {
    fail(
      "control-count",
      `Exactly one variant must be the control; found ${controls.length}. Without a single reference point there is no comparison, only a ranking.`,
    );
  }
  const variantIds = experiment.variants.map((variant) => variant.variantId);
  if (new Set(variantIds).size !== variantIds.length) {
    fail("duplicate-variant-id", "Two variants share an identifier, so assignments could not be attributed to either.");
  }

  // Many tiny arms is exploration, not evidence (section 67).
  if (experiment.variants.length > 3) {
    warn(
      "many-arms",
      `${experiment.variants.length} variants with a small unit budget is exploratory: each arm gets very few observations, ` +
        "so the comparison between any specific pair will be weak. Treat the result as hypothesis generation.",
    );
  }

  // --- Controlled differences (section 4) ---------------------------------
  for (const variant of experiment.variants) {
    if (variant.isControl) {
      if (variant.differences.length > 0) {
        fail("control-has-differences", `The control "${variant.variantId}" declares differences; the control is the reference and changes nothing.`);
      }
      continue;
    }
    if (variant.differences.length === 0) {
      fail("variant-has-no-difference", `Variant "${variant.variantId}" declares no controlled difference, so it is not testing anything.`);
    }
    for (const difference of variant.differences) {
      if (dimensionIsForbidden(difference.dimension)) {
        fail(
          "forbidden-dimension",
          `Variant "${variant.variantId}" proposes changing "${difference.dimension}", which is an integrity guarantee owned by ` +
            "MASTER #1-#4, not a creative variable. Performance may never be bought by weakening it.",
        );
      }
      if (difference.control === difference.variant) {
        fail(
          "difference-changes-nothing",
          `Variant "${variant.variantId}" declares "${difference.dimension}" as a difference but control and variant values are identical.`,
        );
      }
    }
  }

  // --- Metrics (sections 10, 11) ------------------------------------------
  const primary = lookupMetric(experiment.scope.platform, experiment.primaryMetricId);
  if (primary === null) {
    fail("unknown-primary-metric", `"${experiment.primaryMetricId}" is not a defined metric on ${experiment.scope.platform}.`);
  } else {
    const suitability = primaryMetricSuitsObjective(experiment.scope.objective, experiment.primaryMetricId, experiment.scope.platform);
    if (!suitability.permitted) fail("primary-metric-unsuitable", suitability.reason);

    if (!primary.validWindows.includes(experiment.observationWindow)) {
      fail(
        "metric-window-mismatch",
        `"${experiment.primaryMetricId}" is not meaningful at the ${experiment.observationWindow} window (valid: ${primary.validWindows.join(", ")}).`,
      );
    }
    if (!primary.availableToday) {
      warn(
        "primary-metric-unavailable",
        `"${experiment.primaryMetricId}" has no connected provider today, so this experiment cannot yet produce a result. ` +
          "The design is still worth registering; it simply cannot be evaluated until analytics exist.",
      );
    }
  }

  if (experiment.hypothesis.primaryMetricId !== experiment.primaryMetricId) {
    fail(
      "hypothesis-metric-mismatch",
      `The hypothesis names "${experiment.hypothesis.primaryMetricId}" as its primary metric but the experiment declares ` +
        `"${experiment.primaryMetricId}". The thing being predicted must be the thing being measured.`,
    );
  }
  if (experiment.hypothesis.measurementWindow !== experiment.observationWindow) {
    fail(
      "hypothesis-window-mismatch",
      `The hypothesis measures at ${experiment.hypothesis.measurementWindow} but the experiment observes at ${experiment.observationWindow}.`,
    );
  }
  if (experiment.secondaryMetricIds.includes(experiment.primaryMetricId)) {
    fail(
      "primary-also-secondary",
      "The primary metric is also listed as secondary, which blurs which metric actually decides the experiment.",
    );
  }

  // --- Guardrails (section 12) --------------------------------------------
  for (const mandatory of MANDATORY_GUARDRAIL_IDS) {
    if (experiment.guardrailMetricIds.includes(mandatory)) continue;
    fail(
      "missing-mandatory-guardrail",
      `Guardrail "${mandatory}" is mandatory on every experiment and is missing. Integrity gates are not opt-in.`,
    );
  }

  // --- Hypothesis (section 3) ---------------------------------------------
  if (experiment.hypothesis.falsificationCondition.trim().length < 12) {
    fail("no-falsification", "The hypothesis has no usable falsification condition, so no result could ever disconfirm it.");
  }
  if (experiment.hypothesis.whatWouldNotCountAsConfirmation.length === 0) {
    fail(
      "no-non-confirmation",
      "The hypothesis does not say what would look like support but must not be counted as it. That list is what stops " +
        "a favourable secondary metric being read as confirmation.",
    );
  }
  if (experiment.scope.audienceWasUnknown && /beginner|advanced|expert|novice/i.test(experiment.hypothesis.proposition)) {
    fail(
      "audience-claimed-but-unknown",
      "The hypothesis describes an audience level, but MASTER #4 could not establish who this content reached. " +
        "A result cannot later be said to be about beginners if no beginner was ever observed.",
    );
  }

  // --- Stopping (section 24) ----------------------------------------------
  if (experiment.stopConditions.length === 0) {
    fail(
      "no-stop-conditions",
      "No stop conditions were declared before results. An experiment without a stopping rule stops when someone likes the numbers.",
    );
  }
  if (experiment.minimumEvidence.minimumIndependentUnitsPerVariant < 1) {
    fail("no-minimum-evidence", "The minimum evidence requirement must be at least one independent unit per variant.");
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Preregistration (section 84)
// ---------------------------------------------------------------------------

export interface Preregistration {
  readonly experimentId: string;
  readonly revision: number;
  readonly designHash: string;
  readonly registeredAt: string;
  readonly primaryMetricId: string;
  readonly observationWindow: import("../../types.ts").SnapshotWindow;
  readonly variantIds: readonly string[];
  readonly stopConditionCodes: readonly string[];
}

/**
 * Freeze the design and stamp it.
 *
 * Refuses a design with any hard failure: registering a broken design would
 * mean the preregistration certifies something uninterpretable.
 */
export function registerExperiment(experiment: Experiment, now: Date): { readonly experiment: Experiment; readonly preregistration: Preregistration } {
  const findings = validateDesign(experiment);
  const blocking = findings.filter((finding) => finding.severity === "hard-fail");
  if (blocking.length > 0) {
    throw new ExperimentDesignError(
      "design-invalid",
      `Experiment ${experiment.experimentId} cannot be registered: ` +
        blocking.map((finding) => `${finding.code} — ${finding.message}`).join(" | "),
    );
  }

  const designHash = computeDesignHash(experiment);
  const registered: Experiment = {
    ...experiment,
    status: "ready",
    designHash,
    registeredAt: now.toISOString(),
  };

  return {
    experiment: registered,
    preregistration: {
      experimentId: experiment.experimentId,
      revision: experiment.revision,
      designHash,
      registeredAt: now.toISOString(),
      primaryMetricId: experiment.primaryMetricId,
      observationWindow: experiment.observationWindow,
      variantIds: experiment.variants.map((variant) => variant.variantId).sort(),
      stopConditionCodes: experiment.stopConditions.map((condition) => condition.code).sort(),
    },
  };
}

export interface PreregistrationCheck {
  readonly matches: boolean;
  readonly findings: readonly DesignFinding[];
}

/**
 * Check an experiment against what was preregistered.
 *
 * Called before any result is produced. Each mismatch names the specific
 * post-hoc move it caught, because "design changed" is not actionable and
 * "the primary metric changed from X to Y after registration" is.
 */
export function checkAgainstPreregistration(experiment: Experiment, preregistration: Preregistration): PreregistrationCheck {
  const findings: DesignFinding[] = [];
  const fail = (code: string, message: string) => findings.push({ code, severity: "hard-fail", message });

  if (experiment.experimentId !== preregistration.experimentId) {
    fail("identity-mismatch", `Experiment ${experiment.experimentId} checked against preregistration for ${preregistration.experimentId}.`);
  }
  if (experiment.primaryMetricId !== preregistration.primaryMetricId) {
    fail(
      "primary-metric-changed",
      `The primary metric was "${preregistration.primaryMetricId}" at registration and is now "${experiment.primaryMetricId}". ` +
        "Switching the deciding metric after registration lets any result become a win.",
    );
  }
  if (experiment.observationWindow !== preregistration.observationWindow) {
    fail(
      "window-changed",
      `The observation window was ${preregistration.observationWindow} at registration and is now ${experiment.observationWindow}. ` +
        "The window is part of experiment identity; changing it is cherry-picking when to look.",
    );
  }

  const currentVariants = experiment.variants.map((variant) => variant.variantId).sort();
  if (JSON.stringify(currentVariants) !== JSON.stringify([...preregistration.variantIds])) {
    fail(
      "variants-changed",
      `Variants were [${preregistration.variantIds.join(", ")}] at registration and are now [${currentVariants.join(", ")}]. ` +
        "Dropping an arm after seeing results is survivorship bias.",
    );
  }

  const currentHash = computeDesignHash(experiment);
  if (currentHash !== preregistration.designHash) {
    fail(
      "design-hash-mismatch",
      `The design hash is ${currentHash} but ${preregistration.designHash} was registered. Something in the frozen design ` +
        "changed after registration; a changed design requires a new revision, not an edit.",
    );
  }

  return { matches: findings.length === 0, findings };
}

// ---------------------------------------------------------------------------
// The registry (sections 6, 52)
// ---------------------------------------------------------------------------

export interface RegistryEntry {
  readonly experiment: Experiment;
  readonly preregistration: Preregistration;
}

/**
 * An append-only store of experiment revisions.
 *
 * Historical designs are never edited. Revising a running experiment produces a
 * new revision beside the old one, so a result produced under revision 1
 * remains reconstructable after revision 2 exists.
 */
export class ExperimentRegistry {
  private readonly revisions = new Map<string, RegistryEntry[]>();

  register(experiment: Experiment, now: Date): RegistryEntry {
    const { experiment: registered, preregistration } = registerExperiment(experiment, now);
    const history = this.revisions.get(experiment.experimentId) ?? [];

    const existing = history.find((entry) => entry.experiment.revision === registered.revision);
    if (existing !== undefined) {
      // Exact replay is idempotent; a conflicting replay is a different design
      // wearing the same identity and must not silently overwrite.
      if (existing.preregistration.designHash === preregistration.designHash) return existing;
      throw new ExperimentDesignError(
        "conflicting-revision",
        `Experiment ${experiment.experimentId} revision ${registered.revision} is already registered with design hash ` +
          `${existing.preregistration.designHash}, but this registration has hash ${preregistration.designHash}. ` +
          "A changed design needs a new revision; history is not rewritten.",
      );
    }

    const entry: RegistryEntry = { experiment: registered, preregistration };
    history.push(entry);
    history.sort((a, b) => a.experiment.revision - b.experiment.revision);
    this.revisions.set(experiment.experimentId, history);
    return entry;
  }

  /**
   * Create a new revision of an experiment whose design must change.
   *
   * The only sanctioned way to change a frozen design. The previous revision
   * stays exactly as it was.
   */
  revise(experimentId: string, changes: Partial<Experiment>, now: Date): RegistryEntry {
    const current = this.current(experimentId);
    if (current === null) {
      throw new ExperimentDesignError("unknown-experiment", `No experiment ${experimentId} is registered.`);
    }
    const next: Experiment = {
      ...current.experiment,
      ...changes,
      experimentId,
      revision: current.experiment.revision + 1,
      status: "draft",
      registeredAt: null,
    };
    return this.register(next, now);
  }

  current(experimentId: string): RegistryEntry | null {
    const history = this.revisions.get(experimentId);
    return history === undefined || history.length === 0 ? null : history[history.length - 1];
  }

  revision(experimentId: string, revision: number): RegistryEntry | null {
    return (this.revisions.get(experimentId) ?? []).find((entry) => entry.experiment.revision === revision) ?? null;
  }

  history(experimentId: string): readonly RegistryEntry[] {
    return this.revisions.get(experimentId) ?? [];
  }

  all(): readonly RegistryEntry[] {
    return [...this.revisions.keys()].sort().map((id) => this.current(id)).filter((entry): entry is RegistryEntry => entry !== null);
  }

  /** Experiments in a family, for scoped replication reasoning (section 80). */
  family(familyId: string): readonly RegistryEntry[] {
    return this.all().filter((entry) => entry.experiment.familyId === familyId);
  }

  /**
   * Move an experiment's status without touching its design.
   *
   * Status is not part of the design hash, so this is a legal in-place change —
   * and it is the ONLY in-place change the registry permits on a frozen design.
   */
  transition(experimentId: string, status: ExperimentStatus, now: Date): RegistryEntry {
    const current = this.current(experimentId);
    if (current === null) {
      throw new ExperimentDesignError("unknown-experiment", `No experiment ${experimentId} is registered.`);
    }
    const updated: Experiment = {
      ...current.experiment,
      status,
      startedAt: status === "running" && current.experiment.startedAt === null ? now.toISOString() : current.experiment.startedAt,
      closedAt: designIsFrozen(status) && status !== "running" && status !== "paused" ? now.toISOString() : current.experiment.closedAt,
    };
    const entry: RegistryEntry = { experiment: updated, preregistration: current.preregistration };
    const history = this.revisions.get(experimentId)!;
    history[history.length - 1] = entry;
    return entry;
  }
}
