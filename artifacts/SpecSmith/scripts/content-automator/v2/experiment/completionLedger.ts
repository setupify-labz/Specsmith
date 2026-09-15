// MASTER #5 — Completion ledger (section 96).
//
// A truthful record of what is actually built, validated against the real
// source tree by completionLedger.test.ts. A section may not claim `tested`
// unless its modules exist, a non-test caller genuinely imports them, and a
// test file that exercises them exists.
//
// Writing "tested" beside a section whose module nobody imports fails a test.
// That is the point: a ledger that cannot be checked is a wish list.

export type SectionStatus =
  /** Built, wired into a real caller, and exercised by tests. */
  | "tested"
  /** Architecture exists and works; important behaviour remains. */
  | "partially-implemented"
  /** Needs real external access that does not exist here. */
  | "blocked-external"
  /** The system exists but no real observations do. */
  | "blocked-data"
  /** Intentionally belongs to a later MASTER, or deliberately not built. */
  | "deferred";

export const SECTION_STATUSES: readonly SectionStatus[] = [
  "tested", "partially-implemented", "blocked-external", "blocked-data", "deferred",
];

export interface SectionRecord {
  readonly section: number;
  readonly name: string;
  readonly status: SectionStatus;
  /** Paths relative to content-automator/. */
  readonly modules: readonly string[];
  readonly callers: readonly string[];
  readonly tests: readonly string[];
  readonly note: string;
}

const M_MODEL = "v2/experiment/model.ts";
const M_METRICS = "v2/experiment/metrics.ts";
const M_REGISTRY = "v2/experiment/registry.ts";
const M_ASSIGN = "v2/experiment/assignment.ts";
const M_OBS = "v2/experiment/observation.ts";
const M_VALIDITY = "v2/experiment/validity.ts";
const M_COMPARE = "v2/experiment/comparison.ts";
const M_INTERP = "v2/experiment/interpretation.ts";
const M_LEARN = "v2/experiment/learning.ts";
const M_DECISION = "v2/experiment/decision.ts";
const M_PASS = "v2/experiment/experimentPass.ts";
const M_FIXTURE = "v2/experiment/engineeringFixture.ts";
const M_LEDGER = "v2/experiment/completionLedger.ts";

const PIPELINE = "endToEndOfflinePipeline.ts";

const T_EXP = "v2/experiment/experiment.test.ts";
const T_INTERP = "v2/experiment/interpretation.test.ts";
const T_LEDGER = "v2/experiment/completionLedger.test.ts";

export const MASTER5_LEDGER: readonly SectionRecord[] = [
  { section: 1, name: "Observation/interpretation/causal/decision/learning separation", status: "tested", modules: [M_MODEL, M_INTERP], callers: [M_PASS], tests: [T_INTERP],
    note: "Five distinct types with no function that promotes one to the next without stating what justified the step." },
  { section: 2, name: "Strict experiment model", status: "tested", modules: [M_MODEL], callers: [M_REGISTRY, M_PASS], tests: [T_EXP],
    note: "Experiment carries hypothesis, scope, metrics, variants, invariants, minimum evidence, stop and invalidation conditions, provenance and a design hash. No opaque test score." },
  { section: 3, name: "Hypothesis contract", status: "tested", modules: [M_MODEL], callers: [M_REGISTRY], tests: [T_EXP],
    note: "Scoped, falsifiable, metric-bound, window-bound. A design with no falsification condition or no what-would-not-count list is refused." },
  { section: 4, name: "Controlled difference model", status: "tested", modules: [M_MODEL, M_VALIDITY], callers: [M_PASS], tests: [T_INTERP],
    note: "Declared differences are compared against what actually shipped; undeclared changes become confounders and the test is classified multi-factor rather than forbidden." },
  { section: 5, name: "Experiment validity engine", status: "tested", modules: [M_VALIDITY], callers: [M_PASS], tests: [T_INTERP],
    note: "Six states, each explaining itself. Topic, platform, mission, objective and factual payload drift are fatal; duration and audience drift are serious." },
  { section: 6, name: "Immutable experiment registry", status: "tested", modules: [M_REGISTRY], callers: [M_PASS], tests: [T_EXP],
    note: "Append-only revisions. Exact re-registration is idempotent; a conflicting one is refused; revise() creates a new revision and leaves the old intact." },
  { section: 7, name: "Deterministic assignment", status: "tested", modules: [M_ASSIGN], callers: [M_PASS], tests: [T_EXP],
    note: "Binds experiment, revision, variant, creative, lineage, platform, package, media SHA and provider post. Post-hoc variant relabeling hard-fails." },
  { section: 8, name: "Creative lineage", status: "tested", modules: [M_ASSIGN], callers: [M_PASS, M_VALIDITY], tests: [T_EXP],
    note: "Six relations. Units are grouped by lineage, so platform adaptations and reposts fold onto their parent rather than inflating the sample." },
  { section: 9, name: "Metric registry", status: "tested", modules: [M_METRICS], callers: [M_COMPARE, M_PASS], tests: [T_EXP],
    note: "Ten metrics per platform with meaning, unit, direction, roles, valid windows and caveats. availableToday is false for all, because nothing is connected." },
  { section: 10, name: "Metric semantics tied to objective", status: "tested", modules: [M_METRICS], callers: [M_REGISTRY], tests: [T_EXP],
    note: "OBJECTIVE_PRIMARY_METRICS maps MASTER #3 objectives to defensible metrics. An education mission decided on clicks is refused as a strategy change." },
  { section: 11, name: "Exactly one primary metric", status: "tested", modules: [M_REGISTRY, M_COMPARE], callers: [M_PASS], tests: [T_EXP, T_INTERP],
    note: "Registered before results. detectCherryPicking catches a winner claimed against or without the primary metric." },
  { section: 12, name: "Guardrail metrics", status: "tested", modules: [M_METRICS, M_COMPARE], callers: [M_PASS], tests: [T_INTERP],
    note: "Seven integrity guardrails, five mandatory on every design. A failure cancels a win rather than reducing it." },
  { section: 13, name: "Observation window semantics", status: "tested", modules: [M_OBS], callers: [M_PASS, M_COMPARE], tests: [T_EXP],
    note: "Window is part of identity. Cross-window comparison, multi-window sampling and substitution each hard-fail by name." },
  { section: 14, name: "Analytics ingestion boundary", status: "tested", modules: [M_OBS], callers: [M_PASS], tests: [T_EXP],
    note: "Consumes the existing AnalyticsResultDocument. No competing analytics truth source, no Metricool call, no REST token." },
  { section: 15, name: "Metric availability states", status: "tested", modules: [M_METRICS], callers: [M_OBS, M_COMPARE], tests: [T_EXP],
    note: "Seven states, one of which carries a number. unavailable/failed/not-collected/not-due/unknown never become zero; a measured zero stays zero." },
  { section: 16, name: "Performance observation", status: "tested", modules: [M_OBS], callers: [M_PASS], tests: [T_EXP],
    note: "Immutable, carrying every identity field plus window, publish time, due time, validity, collection status and provenance." },
  { section: 17, name: "Performance comparison", status: "tested", modules: [M_COMPARE], callers: [M_PASS], tests: [T_INTERP],
    note: "Nine outcomes. Indistinguishable, unavailable, confounded and insufficient are real results; no winner is forced." },
  { section: 18, name: "No fake statistical significance", status: "tested", modules: [M_COMPARE, M_INTERP], callers: [M_PASS], tests: [T_INTERP],
    note: "No p-value or confidence figure anywhere. A structural test asserts the source contains none, and limitations say so explicitly." },
  { section: 19, name: "Sample size safeguards", status: "tested", modules: [M_ASSIGN, M_COMPARE], callers: [M_PASS], tests: [T_EXP, T_INTERP],
    note: "Raw placements, unique creatives and independent units are reported separately. Only the last may be used as a sample size." },
  { section: 20, name: "Small sample protection", status: "tested", modules: [M_COMPARE], callers: [M_PASS], tests: [T_INTERP],
    note: "Evidence states cap at anecdotal for a single comparison regardless of how clean the design was." },
  { section: 21, name: "Replication logic", status: "tested", modules: [M_LEARN], callers: [M_PASS], tests: [T_INTERP],
    note: "Five kinds. A platform replication extends scope rather than confirming; a topic replication is the most informative." },
  { section: 22, name: "Confounding detection", status: "tested", modules: [M_VALIDITY], callers: [M_PASS], tests: [T_INTERP],
    note: "The canonical five-variable case is classified confounded with every confounder named and ranked by severity." },
  { section: 23, name: "Selection bias", status: "tested", modules: [M_ASSIGN], callers: [M_PASS], tests: [T_EXP],
    note: "Intended assignments are known before analysis, so an assigned-but-unanalysed creative and an unassigned-but-analysed one are both detected." },
  { section: 24, name: "Stopping rules", status: "tested", modules: [M_MODEL, M_DECISION], callers: [M_PASS], tests: [T_INTERP],
    note: "Ten codes declared before results. An undeclared reason cannot stop an experiment unless it is an integrity or validity stop." },
  { section: 25, name: "Early stopping", status: "tested", modules: [M_MODEL, M_DECISION], callers: [M_PASS], tests: [T_EXP, T_INTERP],
    note: "Only four codes permit early stopping. 'The numbers look good' is not among them and planned-units-reached is explicitly not an early stop." },
  { section: 26, name: "Performance interpretation", status: "tested", modules: [M_INTERP], callers: [M_PASS], tests: [T_INTERP],
    note: "Structured output covering what happened, what may and may not be inferred, confounders, alternatives, counterfactuals and next action." },
  { section: 27, name: "Causal language gate", status: "tested", modules: [M_INTERP], callers: [M_PASS], tests: [T_INTERP],
    note: "Four strengths with concrete permitted and forbidden phrasings. Unscoped claims are forbidden at every strength." },
  { section: 28, name: "Correlation vs causation", status: "tested", modules: [M_MODEL, M_VALIDITY], callers: [M_INTERP], tests: [T_EXP],
    note: "observational-comparison is a distinct validity state and never permits a causal reading." },
  { section: 29, name: "Topic effects", status: "tested", modules: [M_VALIDITY], callers: [M_PASS], tests: [T_INTERP],
    note: "A topic change is fatal to a creative conclusion, with the reason stated in the confounder explanation." },
  { section: 30, name: "Platform effects", status: "tested", modules: [M_METRICS, M_COMPARE], callers: [M_PASS], tests: [T_EXP, T_INTERP],
    note: "Cross-platform metric comparison is refused rather than normalized; no averaging across platforms exists." },
  { section: 31, name: "Audience effects", status: "tested", modules: [M_VALIDITY, M_LEARN], callers: [M_PASS], tests: [T_INTERP],
    note: "audienceWasUnknown forbids describing a result as being about any audience, at design time and again at claim time." },
  { section: 32, name: "Mission effects", status: "tested", modules: [M_METRICS, M_VALIDITY], callers: [M_REGISTRY, M_PASS], tests: [T_EXP, T_INTERP],
    note: "Metric choice traces to the mission objective, and an objective-scope claim beyond the experiment is refused." },
  { section: 33, name: "Creative dimension taxonomy", status: "tested", modules: [M_MODEL], callers: [M_REGISTRY], tests: [T_EXP],
    note: "Twenty-five extensible dimensions, plus sixteen forbidden ones that are integrity guarantees rather than creative variables." },
  { section: 34, name: "Variant fingerprint", status: "partially-implemented", modules: [M_MODEL, M_VALIDITY], callers: [M_PASS], tests: [T_INTERP],
    note: "ShippedVariantFacts carries dimensionValues and reuses the existing VideoPerformanceRecord fingerprint fields. A richer fingerprint join awaits a real published creative." },
  { section: 35, name: "Exact creative attribution", status: "tested", modules: [M_ASSIGN, M_OBS], callers: [M_PASS], tests: [T_EXP],
    note: "experiment to assignment to creative to package to SHA to provider post to analytics to observation. A non-sha256 identifier is refused." },
  { section: 36, name: "Immutability", status: "tested", modules: [M_OBS, M_REGISTRY], callers: [M_PASS], tests: [T_EXP],
    note: "Observations are append-only with conflicting replay refused; designs are versioned; interpretations are separate objects." },
  { section: 37, name: "Snapshots separate from interpretations", status: "tested", modules: [M_OBS, M_INTERP], callers: [M_PASS], tests: [T_EXP, T_INTERP],
    note: "PerformanceObservation and PerformanceInterpretation are different types with different lifetimes." },
  { section: 38, name: "Contradictory results", status: "tested", modules: [M_LEARN], callers: [M_PASS], tests: [T_INTERP],
    note: "Conflict is a first-class evidence state, never averaged, and generates discriminating questions." },
  { section: 39, name: "Evidence accumulation by scope", status: "tested", modules: [M_LEARN], callers: [M_PASS], tests: [T_INTERP],
    note: "Supported/conflicting/unknown per scope, with untested scopes named rather than assumed." },
  { section: 40, name: "Learning candidates", status: "tested", modules: [M_LEARN], callers: [M_PASS], tests: [T_INTERP],
    note: "Typed candidates with scope, evidence, replication status, caveats, prohibited overgeneralizations and a recommended memory action." },
  { section: 41, name: "Failure learning", status: "tested", modules: [M_LEARN], callers: [M_PASS], tests: [T_INTERP],
    note: "Eleven failure codes, each with what it teaches and how to prevent it. Broken experiments are recorded, not discarded." },
  { section: 42, name: "Null results", status: "tested", modules: [M_COMPARE, M_LEARN], callers: [M_PASS], tests: [T_INTERP],
    note: "An indistinguishable result yields evidence that the dimension may not matter in this scope, and is written as such." },
  { section: 43, name: "Negative results", status: "tested", modules: [M_LEARN], callers: [M_PASS], tests: [T_INTERP],
    note: "A loss is scoped to the experiment and the prohibited-overgeneralization list forbids 'never use this again'." },
  { section: 44, name: "Opportunity cost", status: "tested", modules: [M_DECISION], callers: [M_PASS], tests: [T_INTERP],
    note: "Considers evidence state, units collected, competing hypotheses and production burden. No paid provider is involved." },
  { section: 45, name: "Experiment value heuristic", status: "tested", modules: [M_DECISION], callers: [M_PASS], tests: [T_INTERP],
    note: "Four named considerations with stated weights, explicitly labelled a heuristic rather than expected-value mathematics." },
  { section: 46, name: "Explore vs exploit", status: "tested", modules: [M_DECISION], callers: [M_PASS], tests: [T_INTERP],
    note: "Five stances, every one carrying requiresExecutiveArbitration: true so no volume decision can be expressed here." },
  { section: 47, name: "No performance-based integrity erosion", status: "tested", modules: [M_MODEL, M_METRICS, M_COMPARE], callers: [M_PASS], tests: [T_EXP, T_INTERP],
    note: "Integrity dimensions cannot be experimental variables, and a guardrail failure forces do-not-store regardless of performance." },
  { section: 48, name: "No dark pattern optimization", status: "tested", modules: [M_MODEL, M_METRICS], callers: [M_REGISTRY], tests: [T_EXP],
    note: "cta-integrity and mission-integrity guardrails plus forbidden dimensions make urgency, bait and deception unproposable." },
  { section: 49, name: "Performance explanation", status: "tested", modules: [M_INTERP, M_DECISION], callers: [M_PASS], tests: [T_INTERP],
    note: "Every verdict, confounder, refusal and recommendation carries a stated reason. No opaque model score exists." },
  { section: 50, name: "Experiment report", status: "tested", modules: [M_PASS], callers: [PIPELINE], tests: [T_LEDGER],
    note: "formatExperimentReport prints hypothesis, scope, variants, controlled difference, validity, metric, window, comparison, evidence, confounders, can/cannot say, guardrails, decision, next test, candidate, limitations and synthetic status." },
  { section: 51, name: "Strict ingestion contracts", status: "tested", modules: [M_OBS, M_REGISTRY, M_ASSIGN], callers: [M_PASS], tests: [T_EXP],
    note: "Strict versions, validated timestamps, duplicate refusal, conflicting-replay refusal, NaN/Infinity/negative rejection, explicit synthetic marker and mandatory provenance." },
  { section: 52, name: "Identity collision protection", status: "tested", modules: [M_ASSIGN, M_OBS, M_REGISTRY], callers: [M_PASS], tests: [T_EXP],
    note: "Creative in two variants, one post on two creatives, conflicting assignment replay, conflicting observation replay and conflicting revision are each refused." },
  { section: 53, name: "Timestamp logic", status: "tested", modules: [M_ASSIGN, M_OBS], callers: [M_PASS], tests: [T_EXP],
    note: "Assignment before publish, publish before due, due before capture, capture not in the future. A 24h result read minutes after publishing is refused." },
  { section: 54, name: "Window due calculator", status: "tested", modules: [M_OBS], callers: [M_PASS], tests: [T_EXP],
    note: "Deterministic states: not-yet-due, due, collected, missed, failed. Built on the existing snapshotDueAt." },
  { section: 55, name: "Missed windows", status: "tested", modules: [M_OBS], callers: [M_PASS], tests: [T_EXP],
    note: "A defined six-hour tolerance, then MISSED. Substitution with a neighbouring window is refused by name." },
  { section: 56, name: "Multiple posts of the same creative", status: "tested", modules: [M_ASSIGN], callers: [M_PASS], tests: [T_EXP],
    note: "A repost is correlated by default and counts as its own unit only when the design declared it so." },
  { section: 57, name: "Platform analytics differences", status: "tested", modules: [M_METRICS], callers: [M_COMPARE], tests: [T_EXP, T_INTERP],
    note: "metricsAreComparable refuses cross-platform comparison. No normalization function exists to be misused." },
  { section: 58, name: "Normalization", status: "tested", modules: [M_METRICS], callers: [M_COMPARE], tests: [T_EXP],
    note: "No metric is normalized anywhere; the refusal is the documented behaviour." },
  { section: 59, name: "No composite score", status: "tested", modules: [M_METRICS, M_COMPARE], callers: [M_PASS], tests: [T_LEDGER],
    note: "No composite exists. A structural test asserts the source defines no blended score." },
  { section: 60, name: "Performance diagnosis", status: "tested", modules: [M_INTERP], callers: [M_PASS], tests: [T_INTERP],
    note: "Ten descriptive diagnoses, separated from experiment judgment, each stating what it does not establish." },
  { section: 61, name: "Retention shape", status: "blocked-data", modules: [M_METRICS], callers: [M_OBS], tests: [T_EXP],
    note: "RetentionPoint exists on the frozen VideoPerformanceRecord, but no connected source supplies a curve, so none is modelled or fabricated." },
  { section: 62, name: "Comment signals", status: "blocked-external", modules: [M_METRICS], callers: [M_COMPARE], tests: [T_EXP],
    note: "Comment COUNT is defined with neutral direction; no comment ingestion or sentiment analysis exists, so engagement quality is unknown." },
  { section: 63, name: "Conversion signals", status: "blocked-external", modules: [M_METRICS], callers: [M_OBS], tests: [T_EXP],
    note: "site-clicks and profile-visits are defined and map to the existing contract; no connected source supplies them, so they read as not-collected." },
  { section: 64, name: "Query/search feedback", status: "deferred", modules: [], callers: [], tests: [],
    note: "Search Console data belongs to MASTER #3's signal domain and is deliberately not turned into a post-performance metric here." },
  { section: 65, name: "Cost tracking", status: "partially-implemented", modules: [M_MODEL], callers: [M_PASS], tests: [T_LEDGER],
    note: "resourcePosture and generationCost fields exist upstream; MASTER #5 records that its own path is $0 incremental and treats unknown cost as unknown." },
  { section: 66, name: "Resource efficiency", status: "deferred", modules: [M_DECISION], callers: [], tests: [T_INTERP],
    note: "assessOpportunityCost frames the question; answering whether an expensive step helped needs controlled evidence that does not exist yet." },
  { section: 67, name: "Multi-arm tests", status: "tested", modules: [M_REGISTRY], callers: [M_PASS], tests: [T_EXP],
    note: "More than two variants are structurally supported and warned about: many tiny arms is exploratory, not evidence." },
  { section: 68, name: "Sequential testing", status: "deferred", modules: [], callers: [], tests: [],
    note: "Deliberately absent. A simple deterministic lifecycle is preferred to unjustified sequential statistics." },
  { section: 69, name: "Holdouts", status: "partially-implemented", modules: [M_MODEL], callers: [M_REGISTRY], tests: [T_EXP],
    note: "The control concept is first-class and exactly one control is required; a dedicated holdout arm is representable but not required." },
  { section: 70, name: "Baselines", status: "tested", modules: [M_MODEL], callers: [M_COMPARE], tests: [T_EXP],
    note: "Four baseline kinds mapped to their evidentiary validity; a historical baseline is observational, never a control." },
  { section: 71, name: "Historical comparisons", status: "tested", modules: [M_MODEL, M_VALIDITY], callers: [M_INTERP], tests: [T_INTERP],
    note: "Observational comparisons motivate experiments and cannot become causal proof." },
  { section: 72, name: "Performance outliers", status: "tested", modules: [M_COMPARE], callers: [M_PASS], tests: [T_INTERP],
    note: "outlier-needs-replication flags without dropping or universalising, and names novelty as a live explanation." },
  { section: 73, name: "Virality", status: "tested", modules: [M_COMPARE], callers: [M_PASS], tests: [T_INTERP],
    note: "No universal threshold and the word is not used as a category; extremity is relative to the account own recent baseline." },
  { section: 74, name: "Baseline freshness", status: "tested", modules: [M_COMPARE], callers: [M_PASS], tests: [T_INTERP],
    note: "A baseline older than ninety days is treated as no baseline." },
  { section: 75, name: "Content fatigue", status: "deferred", modules: [], callers: [], tests: [],
    note: "Needs published history that does not exist; MASTER #6 memory will support it more deeply." },
  { section: 76, name: "Novelty effect", status: "tested", modules: [M_COMPARE], callers: [M_PASS], tests: [T_INTERP],
    note: "Named explicitly in the outlier explanation as a reason a spike may not be durable." },
  { section: 77, name: "Generalization levels", status: "tested", modules: [M_MODEL], callers: [M_LEARN], tests: [T_EXP],
    note: "Eight levels with per-level evidence requirements. Global is unreachable at any strength." },
  { section: 78, name: "Evidence strength model", status: "tested", modules: [M_MODEL, M_COMPARE], callers: [M_PASS], tests: [T_EXP, T_INTERP],
    note: "Seven named states, no decimals. Conflicting is its own state rather than a midpoint." },
  { section: 79, name: "Contradiction matrix", status: "tested", modules: [M_LEARN], callers: [M_PASS], tests: [T_INTERP],
    note: "Five stances per experiment with no silent averaging." },
  { section: 80, name: "Experiment families", status: "tested", modules: [M_MODEL, M_REGISTRY], callers: [M_PASS], tests: [T_EXP],
    note: "familyId groups related experiments and the registry can list a family for scoped replication reasoning." },
  { section: 81, name: "Next-best experiment", status: "tested", modules: [M_DECISION], callers: [M_PASS], tests: [T_INTERP],
    note: "Branches on why the current result is unsatisfying and names what to hold constant and what to vary." },
  { section: 82, name: "Counterfactual reasoning", status: "tested", modules: [M_INTERP], callers: [M_PASS], tests: [T_INTERP],
    note: "Four counterfactual questions asked and deliberately not answered." },
  { section: 83, name: "Alternative explanations", status: "tested", modules: [M_VALIDITY], callers: [M_INTERP], tests: [T_INTERP],
    note: "Every confounder plus posting day, elapsed time and random variation. None is ranked as the true cause." },
  { section: 84, name: "Pre-registration", status: "tested", modules: [M_REGISTRY], callers: [M_PASS], tests: [T_EXP],
    note: "Design frozen and hashed before results; post-hoc metric, window and arm changes are each detected by name." },
  { section: 85, name: "Design hash", status: "tested", modules: [M_REGISTRY], callers: [M_PASS], tests: [T_EXP],
    note: "Deterministic over canonical design fields, excluding status and timestamps." },
  { section: 86, name: "Result hash", status: "tested", modules: [M_PASS], callers: [PIPELINE], tests: [T_LEDGER],
    note: "Deterministic over design, assignments, selected observations and interpretation version." },
  { section: 87, name: "Determinism", status: "tested", modules: [M_PASS], callers: [PIPELINE], tests: [T_LEDGER],
    note: "now is always an argument. A structural test asserts no module calls Date.now or new Date() with no argument." },
  { section: 88, name: "Synthetic engineering fixtures", status: "tested", modules: [M_FIXTURE], callers: [M_PASS, PIPELINE], tests: [T_EXP, T_INTERP],
    note: "Every fixture carries SYNTHETIC_ENGINEERING_FIXTURE and invented figures about parts that do not exist." },
  { section: 89, name: "Offline demonstration", status: "tested", modules: [M_PASS, M_FIXTURE], callers: [PIPELINE], tests: [T_LEDGER],
    note: "Stage 1f of the real pipeline runs the full chain on synthetic input and proves production refuses it." },
  { section: 90, name: "Negative control suite", status: "tested", modules: [M_MODEL, M_REGISTRY, M_ASSIGN, M_OBS, M_COMPARE, M_VALIDITY, M_INTERP, M_LEARN], callers: [M_PASS], tests: [T_EXP, T_INTERP],
    note: "Twenty-two controls, each failing tests when its guard is disabled. Listed in the commit message." },
  { section: 91, name: "Adversarial testing", status: "tested", modules: [M_REGISTRY, M_ASSIGN, M_OBS, M_COMPARE, M_VALIDITY, M_INTERP, M_LEARN], callers: [M_PASS], tests: [T_EXP, T_INTERP],
    note: "Attacks on ids, timestamps, windows, metrics, NaN, Infinity, duplicates, replay, wrong platform/creative/package/SHA/post, reassignment, cherry-picking, tiny samples, outliers, survivorship, confounding, scope expansion and guardrail override." },
  { section: 92, name: "Real failure modes tested", status: "tested", modules: [M_REGISTRY, M_ASSIGN, M_OBS], callers: [M_PASS], tests: [T_EXP, T_INTERP],
    note: "The suites are written as attempts to take tempting shortcuts, and each one fails." },
  { section: 93, name: "No fake data", status: "tested", modules: [M_FIXTURE], callers: [PIPELINE], tests: [T_LEDGER],
    note: "Fixture figures describe fictional hardware and are marked synthetic everywhere they appear." },
  { section: 94, name: "Zero-cost core", status: "tested", modules: [M_PASS], callers: [PIPELINE], tests: [T_LEDGER],
    note: "assertZeroCostExperiment is called by the pipeline and a structural test proves no module reaches a paid provider." },
  { section: 95, name: "No network dependency", status: "tested", modules: [M_OBS, M_PASS], callers: [PIPELINE], tests: [T_LEDGER],
    note: "A structural test asserts no fetch, no http import, no process.env and no provider adapter import anywhere in the layer." },
  { section: 96, name: "Completion ledger", status: "tested", modules: [M_LEDGER], callers: [PIPELINE], tests: [T_LEDGER],
    note: "This file, validated against the real source tree: tested requires module, real caller and test." },
  { section: 97, name: "Real pipeline integration", status: "tested", modules: [M_PASS, M_FIXTURE], callers: [PIPELINE], tests: [T_LEDGER],
    note: "Stage 1f reports experiment, hypothesis, variants, controlled variable, validity, metric, window, observations, comparison, evidence, confounders, guardrails, decision, next test, candidate, limitations and synthetic state." },
  { section: 98, name: "MASTER #1-#4 boundaries", status: "tested", modules: [M_MODEL, M_METRICS], callers: [M_PASS], tests: [T_EXP, T_LEDGER],
    note: "Cannot authorise a claim, remove a caveat, change a mission, invent an audience or bypass accessibility: integrity dimensions are unproposable and guardrails are mandatory." },
  { section: 99, name: "MASTER #6 boundary", status: "tested", modules: [M_LEARN], callers: [M_PASS], tests: [T_INTERP, T_LEDGER],
    note: "Emits LearningCandidate with a recommended memory action. A structural test asserts no memory write path exists." },
  { section: 100, name: "MASTER #8 boundary", status: "tested", modules: [M_DECISION], callers: [M_PASS], tests: [T_INTERP, T_LEDGER],
    note: "Every stance carries requiresExecutiveArbitration: true and no publish or schedule function exists." },
];

export function sectionsByStatus(status: SectionStatus): readonly SectionRecord[] {
  return MASTER5_LEDGER.filter((record) => record.status === status);
}

export function formatMaster5Ledger(records: readonly SectionRecord[] = MASTER5_LEDGER): string {
  const lines: string[] = ["MASTER #5 COMPLETION LEDGER"];
  for (const status of SECTION_STATUSES) {
    const group = records.filter((record) => record.status === status);
    if (group.length === 0) continue;
    lines.push(`  ${status.toUpperCase()} (${group.length})`);
    for (const record of group) lines.push(`    ${record.section}. ${record.name}`);
  }
  lines.push(`  TOTAL: ${records.length} sections`);
  return lines.join("\n");
}
