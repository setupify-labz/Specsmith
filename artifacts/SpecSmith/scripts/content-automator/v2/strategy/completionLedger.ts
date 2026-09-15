// MASTER #3 completion ledger.
//
// Same doctrine as the MASTER #1 and #2 ledgers: a status nobody validates is a
// wish. completionLedger.test.ts reads the real source tree and refuses a
// `tested` claim without an existing test, or an `integrated` claim without a
// caller that genuinely imports one of the named modules.

export type SectionStatus =
  | "tested"
  | "integrated"
  | "partially-implemented"
  | "blocked-external"
  | "blocked-data"
  | "deferred-to-master"
  | "not-applicable";

export const SECTION_STATUSES: readonly SectionStatus[] = [
  "tested", "integrated", "partially-implemented",
  "blocked-external", "blocked-data", "deferred-to-master", "not-applicable",
];

export interface SectionRecord {
  readonly section: number;
  readonly name: string;
  readonly status: SectionStatus;
  readonly modules: readonly string[];
  readonly callers: readonly string[];
  readonly tests: readonly string[];
  readonly note: string;
}

const MODEL = "v2/strategy/model.ts";
const SIGNALS = "v2/strategy/signals.ts";
const OPP = "v2/strategy/opportunity.ts";
const PORT = "v2/strategy/portfolio.ts";
const PRIO = "v2/strategy/priority.ts";
const MISSION = "v2/strategy/contentMission.ts";
const HYP = "v2/strategy/hypotheses.ts";
const CRITIC = "v2/strategy/critic.ts";
const PASS = "v2/strategy/strategyPass.ts";
const LOOP = "v2/strategy/closedLoop.ts";
const FIXTURE = "v2/strategy/engineeringFixture.ts";
const PIPELINE = "endToEndOfflinePipeline.ts";

const T_SIGNALS = "v2/strategy/signals.test.ts";
const T_PRIO = "v2/strategy/priority.test.ts";
const T_LOOP = "v2/strategy/strategyLoop.test.ts";
const T_OPP = "v2/strategy/opportunity.test.ts";

export const MASTER3_LEDGER: readonly SectionRecord[] = [
  { section: 1, name: "Strategic objective model", status: "tested", modules: [MODEL], callers: [PRIO], tests: [T_PRIO],
    note: "Twenty-two typed objectives, each with a measurability and an explicit tension list. Objectives are not interchangeable: affiliate intent declares tensions against trust and education, and the priority model reads them." },
  { section: 2, name: "Strategic content pillars", status: "tested", modules: [MODEL], callers: [OPP, MISSION], tests: [T_PRIO],
    note: "Twenty pillars carrying the claim kinds they inevitably assert, freshness sensitivity, product surface, audience level, inherent risks and repeatability. A pillar cannot opt out of its claim kinds' evidence bar." },
  { section: 3, name: "Opportunity object", status: "tested", modules: [MODEL, OPP], callers: [PASS], tests: [T_PRIO, T_LOOP],
    note: "Thirty-plus fields including origins, evidence state copied from MASTER #2, all four unknown-capable signal states, decay bounds, resource posture, risks, per-facet confidence and lineage. Immutable: strategy bumps a version rather than mutating." },
  { section: 4, name: "Opportunity types", status: "tested", modules: [MODEL, OPP], callers: [PASS], tests: [T_PRIO, T_OPP],
    note: "Twenty classes with per-class decay rules. A launch expires in thirty days and an evergreen explainer never does, and only classes whose rule says so may claim urgency at all." },
  { section: 5, name: "Why-now intelligence", status: "tested", modules: [OPP], callers: [PASS], tests: [T_LOOP, T_SIGNALS, T_OPP],
    note: "establishWhyNow returns insufficient-evidence — never time-sensitive — when a class could be urgent but no temporal evidence exists. That branch is what stops urgency being manufactured." },
  { section: 6, name: "Strategic hypothesis registry", status: "tested", modules: [HYP], callers: [PASS], tests: [T_LOOP],
    note: "Every hypothesis is born untested, requires a mechanism and a falsification criterion, and cannot reach a measured status without a measurement reference. Strategy cannot mark its own bets vindicated." },
  { section: 7, name: "Opportunity scoring without fake precision", status: "tested", modules: [PRIO], callers: [PASS], tests: [T_PRIO],
    note: "Two stages: vetoes then interpretable bands. No float, and unknown is a distinct band that is never read as low. A blocking risk cannot be outscored, asserted by six tests." },
  { section: 8, name: "Multi-objective strategy", status: "tested", modules: [MODEL, PRIO], callers: [PASS], tests: [T_PRIO],
    note: "Tensions are recorded as explicit tradeoffs with a named resolution rather than blended into one scalar. The commercial tradeoff is always emitted." },
  { section: 9, name: "Product-led strategy", status: "tested", modules: [MODEL, SIGNALS, MISSION], callers: [PASS], tests: [T_SIGNALS, T_LOOP],
    note: "Product readiness comes from real first-party route observation. A surface that is not shipped blocks the opportunity and the CTA, and usefulWithoutCta records whether the piece survives losing its CTA." },
  { section: 10, name: "Search and social intersection", status: "partially-implemented", modules: [SIGNALS], callers: [OPP], tests: [T_SIGNALS],
    note: "The ingestion shape, the impression floor and the unknown-not-low rule are real and tested. No Search Console or social analytics source is connected, so every live reading is unknown/not-configured." },
  { section: 11, name: "Community pain and question intelligence", status: "partially-implemented", modules: [SIGNALS], callers: [OPP], tests: [T_SIGNALS],
    note: "Observation floors, clustering by question and the refusal to call one post a cluster are tested. No community collector exists, so audience need is unverified in every production pass." },
  { section: 12, name: "Competitive whitespace", status: "partially-implemented", modules: [SIGNALS], callers: [OPP], tests: [T_SIGNALS],
    note: "Zero observed pieces for an uncovered question returns unknown rather than whitespace, which is the guard the brief asks for. No competitor survey exists." },
  { section: 13, name: "Portfolio strategy", status: "tested", modules: [PORT], callers: [PASS], tests: [T_PRIO],
    note: "Saturation limits derive from each pillar's repeatability. With no published history every verdict is unknown rather than healthy, and a saturated pillar sends a sound opportunity to the backlog instead of the front." },
  { section: 14, name: "Content mission", status: "tested", modules: [MISSION], callers: [PASS, LOOP, PIPELINE], tests: [T_LOOP, T_OPP],
    note: "Carries objective, audience problem, angle, format class, permitted and forbidden claims copied verbatim from MASTER #2, required wording, CTA intent and the reason it deserves production. It does not touch shot-level execution." },
  { section: 15, name: "Angle intelligence", status: "tested", modules: [MISSION], callers: [PASS], tests: [T_LOOP],
    note: "A library of angles per pillar, each ranked on objective fit and then on how FEW claim kinds it asserts. Angles needing evidence the contract never approved are rejected with the reason recorded." },
  { section: 16, name: "Format strategy", status: "tested", modules: [MISSION], callers: [PASS], tests: [T_LOOP],
    note: "Thirteen strategic format classes chosen with the angle. MASTER #1 still owns how to execute them." },
  { section: 17, name: "Idea generation boundary", status: "tested", modules: [OPP], callers: [PASS], tests: [T_LOOP],
    note: "Opportunities derive only from a real research result's claims and gaps. There is no free-form idea generator anywhere in the production path." },
  { section: 18, name: "Trend ingestion boundary", status: "tested", modules: [SIGNALS], callers: [OPP], tests: [T_SIGNALS],
    note: "A trend needs at least three points; a two-point 10-to-900 jump returns unknown. With no collector the state is unknown/not-configured, and nothing may be described as trending." },
  { section: 19, name: "First-party SpecSmith opportunity", status: "partially-implemented", modules: [SIGNALS], callers: [OPP, LOOP], tests: [T_SIGNALS, T_LOOP],
    note: "Route observation is real and non-synthetic, and is what lets the positive path run at all. Usage telemetry, internal search and outbound clicks are not collected, so those interfaces stay dormant rather than being filled with invented numbers." },
  { section: 20, name: "Evidence escalation", status: "tested", modules: [CRITIC], callers: [PASS], tests: [T_LOOP],
    note: "A blocked opportunity emits a ResearchRequest naming the exact claim, source quality, freshness and applicability that would unblock it, plus whether it is obtainable today. Strategy never lowers its own bar instead." },
  { section: 21, name: "Research budget and stopping rule", status: "tested", modules: [CRITIC], callers: [PASS], tests: [T_LOOP],
    note: "researchWorthPursuing refuses to queue a gap that could not change a decision: no observed audience need and no product connection means dropping the topic rather than researching it." },
  { section: 22, name: "Zero-dollar resource awareness", status: "tested", modules: [MODEL, PASS], callers: [PIPELINE], tests: [T_LOOP],
    note: "Six resource postures; blocked-without-paid can never reach an approved mission. assertZeroCostCore runs in the pipeline and throws if it ever does." },
  { section: 23, name: "Content saturation and duplication", status: "tested", modules: [PORT], callers: [PASS], tests: [T_PRIO],
    note: "Duplication is judged on normalized subject sets and thesis content words, so word order, casing, separators and a product-name typo cannot split a duplicate into two." },
  { section: 24, name: "Strategic novelty", status: "tested", modules: [PORT], callers: [PASS], tests: [T_PRIO],
    note: "Six real axes — topic, subjects, angle, objective, format, product connection. Rewording is deliberately not an axis, and a test asserts a reordered thesis is not novel." },
  { section: 25, name: "Cannibalization and redundancy", status: "tested", modules: [PORT], callers: [PASS], tests: [T_PRIO],
    note: "Overlapping subjects with no stronger evidence and no new angle returns adds-little, which vetoes. Stronger evidence plus a new angle returns supersedes, which is a legitimate reason to republish." },
  { section: 26, name: "Content series intelligence", status: "partially-implemented", modules: [MODEL, OPP], callers: [PASS], tests: [T_PRIO],
    note: "parentOpportunityId and clusterOpportunities give a series its lineage and group one domain's problems together. Automatic series expansion is deliberately absent: without a published history there is no way to tell a series from spam." },
  { section: 27, name: "Sequencing", status: "partially-implemented", modules: [MODEL], callers: [PASS], tests: [],
    note: "parentOpportunityId records a dependency between opportunities. A sequencing planner that orders a multi-piece arc needs audience data MASTER #4 will supply and published results MASTER #5 will measure." },
  { section: 28, name: "Strategic calendar and cadence", status: "tested", modules: [MODEL, PRIO], callers: [PASS], tests: [T_PRIO, T_OPP],
    note: "Ten strategic actions covering produce-now, produce-next, evergreen backlog, three hold reasons, three refusals and retire. Nothing here schedules anything: no Metricool call, no date assignment." },
  { section: 29, name: "Opportunity decay", status: "tested", modules: [OPP, PRIO], callers: [PASS], tests: [T_PRIO, T_OPP],
    note: "detectedAt, bestBefore, expiresAt and lastValidatedAt on every opportunity, with per-class rules. An expired time-sensitive opportunity is retired, asserted by test." },
  { section: 30, name: "Strategic risk model", status: "tested", modules: [MODEL, OPP], callers: [PRIO], tests: [T_PRIO],
    note: "Nineteen risk codes, ten of them blocking. A blocking risk vetoes rather than lowering a score." },
  { section: 31, name: "Affiliate and commercial integrity", status: "tested", modules: [PRIO], callers: [PASS], tests: [T_PRIO],
    note: "The commercial guard is a rule, not a weight: an opportunity whose only case is commission is vetoed, and commercial value may never raise a tier or break a tie. Tested in both directions." },
  { section: 32, name: "Brand strategy", status: "partially-implemented", modules: [MODEL], callers: [PRIO], tests: [T_PRIO],
    note: "category-association is a typed objective marked human-judgment-only, which is the honest encoding: desired association is expressible, observed association needs audience data nobody has." },
  { section: 33, name: "Strategic positioning", status: "deferred-to-master", modules: [], callers: [], tests: [],
    note: "Positioning candidates need observed audience perception to choose between them. MASTER #4 builds audience intelligence; writing positioning statements now would be aspiration typed as strategy." },
  { section: 34, name: "Differentiation intelligence", status: "tested", modules: [MODEL, PRIO, CRITIC], callers: [PASS], tests: [T_PRIO, T_LOOP],
    note: "Pillars declare what SpecSmith can SHOW rather than only say, and the critic asks whether a generic creator could make the same piece equally well when no surface is involved." },
  { section: 35, name: "Beginner clarity strategy", status: "partially-implemented", modules: [MODEL, MISSION], callers: [PASS], tests: [T_LOOP],
    note: "Audience level is carried on every pillar, opportunity, angle and mission, and an advanced angle is rejected for a beginner opportunity. Jargon load and explanation burden are deferred to MASTER #4." },
  { section: 36, name: "Expert and enthusiast strategy", status: "partially-implemented", modules: [MODEL, MISSION], callers: [PASS], tests: [T_LOOP],
    note: "Advanced pillars and advanced angles exist and are selected by audience level, so not everything is pitched at beginners. Full personas belong to MASTER #4." },
  { section: 37, name: "Opportunity clustering", status: "tested", modules: [OPP], callers: [PASS], tests: [T_LOOP],
    note: "clusterOpportunities groups a domain's separate user problems under one strategic cluster, deterministically ordered." },
  { section: 38, name: "Knowledge-gap strategy", status: "tested", modules: [OPP, CRITIC], callers: [PASS], tests: [T_LOOP],
    note: "A blocking research gap becomes its own opportunity marked as a research task rather than a production one, and carries a research request instead of a mission." },
  { section: 39, name: "Content and portfolio gap", status: "blocked-data", modules: [], callers: [], tests: [],
    note: "What SpecSmith is not covering requires a record of what it has covered. Nothing has been published, so assessBalance reports unknown rather than inventing a distribution." },
  { section: 40, name: "Opportunity explanations", status: "tested", modules: [PRIO, PASS], callers: [PIPELINE], tests: [T_PRIO, T_LOOP],
    note: "Every recommendation carries dimensions with reasons, vetoes with details, reasons to act and not to act, tradeoffs and a plain-language explanation. A test asserts the explanation is not a score." },
  { section: 41, name: "Counterfactual strategy", status: "tested", modules: [CRITIC], callers: [PASS], tests: [T_LOOP],
    note: "Five counterfactuals per opportunity, each flagging whether it reveals fragility. Typed as reasoning so they can never be mistaken for observations." },
  { section: 42, name: "Strategic adversarial critic", status: "tested", modules: [CRITIC], callers: [PASS], tests: [T_LOOP],
    note: "Twelve challenges, each answered from stored state rather than prose. A fatal challenge blocks the mission even when the priority model authorised it." },
  { section: 43, name: "Strategy confidence", status: "tested", modules: [MODEL, OPP], callers: [PASS], tests: [T_LOOP],
    note: "Six separate facets — existence, timing, audience need, mechanism, evidence, feasibility — each an interpretable level with reasons. No probability is invented." },
  { section: 44, name: "Unknown state", status: "tested", modules: [MODEL, SIGNALS], callers: [OPP, PRIO], tests: [T_SIGNALS, T_PRIO, T_OPP],
    note: "Trend, search demand, competitor coverage, community pain and why-now all include unknown, and the priority model records unmeasured dimensions as unmeasured rather than weak. This is the most-tested guard in MASTER #3." },
  { section: 45, name: "Strategy result artifact", status: "tested", modules: [PASS], callers: [LOOP, PIPELINE], tests: [T_LOOP],
    note: "STRATEGY_RESULT binds run identity, the exact research pass, the signal bundle, every decision, missions, clusters, hypotheses, research requests, portfolio balance, the no-op reason and a deterministic hash. It claims no publication and no analytics." },
  { section: 46, name: "Idempotency", status: "tested", modules: [PASS, OPP], callers: [LOOP], tests: [T_LOOP],
    note: "Opportunity ids are content-derived, so the same input yields the same identity. The result hash is identical across runs and changes when the decision changes, both asserted." },
  { section: 47, name: "Immutability and auditability", status: "tested", modules: [MODEL, HYP, PASS], callers: [PASS], tests: [T_LOOP],
    note: "A mission traces to an opportunity, to a research claim id, to a research-result origin. Hypothesis history is append-only. A test walks that chain end to end." },
  { section: 48, name: "Strategy report", status: "tested", modules: [PASS], callers: [PIPELINE], tests: [T_LOOP],
    note: "Per-opportunity tier, vetoes, reasons both ways, challenges, tradeoffs, research needed, hypotheses, portfolio state and limitations. The no-op path states plainly that producing nothing is a success." },
  { section: 49, name: "Engineering fixture", status: "tested", modules: [FIXTURE], callers: [PIPELINE], tests: [T_SIGNALS, T_LOOP],
    note: "Six fixtures marked SYNTHETIC_ENGINEERING_FIXTURE: no signals, rich signals, product not ready, a fake two-point trend, an empty competitor survey and a fabricated portfolio history. Production ingestion refuses all of them." },
  { section: 50, name: "Negative controls", status: "tested", modules: [SIGNALS, PRIO, PORT, OPP, MISSION, HYP], callers: [PIPELINE], tests: [T_SIGNALS, T_PRIO, T_LOOP, T_OPP],
    note: "Ten controls, each failing tests when its guard is disabled; two of them only became load-bearing once opportunity.test.ts exercised establishWhyNow and buildContentMission directly. The list and what each proves are recorded in the commit message." },
  { section: 51, name: "Adversarial tests", status: "tested", modules: [SIGNALS, PRIO, PORT], callers: [PASS], tests: [T_SIGNALS, T_PRIO, T_LOOP, T_OPP],
    note: "A trend with no source, one impression as demand, one post as consensus, a stale opportunity, a high-commission recommendation, a synthetic bundle, an unshipped product CTA, a vetoed high scorer, a reworded duplicate and a typo-split subject pair are each exercised." },
  { section: 52, name: "Determinism", status: "tested", modules: [PASS, PRIO, OPP], callers: [LOOP], tests: [T_LOOP, T_PRIO],
    note: "No module reads the clock: now is always an argument. Ranking breaks ties on identity. Byte-identical output for identical input, asserted." },
  { section: 53, name: "Provider independence", status: "tested", modules: [SIGNALS, PASS], callers: [PIPELINE], tests: ["v2/strategy/completionLedger.test.ts"],
    note: "No strategy module contains fetch, reads an environment variable, or imports a provider adapter. Asserted structurally against the real source tree." },
  { section: 54, name: "Provider inventory", status: "integrated", modules: ["v2/research/providerInventory.ts"], callers: [PIPELINE], tests: ["v2/research/providerInventory.test.ts"],
    note: "MASTER #2's audited inventory is reused rather than duplicated. MASTER #3 adds no provider, so the inventory is unchanged and still validated against the tree." },
  { section: 55, name: "Zero-dollar core assertion", status: "tested", modules: [PASS], callers: [PIPELINE], tests: [T_LOOP, "v2/strategy/completionLedger.test.ts"],
    note: "assertZeroCostCore is called by the offline pipeline and throws if any authorised mission requires paid access, and a structural test proves no strategy module can reach a paid provider at all." },
  { section: 56, name: "Performance", status: "tested", modules: [PASS, PORT], callers: [PASS], tests: [T_PRIO],
    note: "Opportunities are assessed once and indexed by id; portfolio checks are linear in history size. Nothing is cubic. No premature micro-optimisation." },
  { section: 57, name: "Clean architecture", status: "tested", modules: [MODEL, SIGNALS, OPP, PORT, PRIO, MISSION, HYP, CRITIC, PASS, LOOP], callers: [PIPELINE], tests: [T_LOOP],
    note: "Ten modules along real seams — model, signals, opportunity, portfolio, priority, mission, hypotheses, critic, orchestrator, loop — rather than one strategyBrain.ts or twenty files split to look thorough." },
  { section: 58, name: "No premature MASTER #4-#8", status: "tested", modules: [MODEL, HYP], callers: [PASS], tests: [T_LOOP],
    note: "Audience level, hypothesis registry and portfolio interfaces exist as boundaries later masters fill. No audience brain, no platform predictor, no analytics learning, no experiment optimiser, no executive arbitration, and no publishing." },
];

export function sectionsByStatus(status: SectionStatus): readonly SectionRecord[] {
  return MASTER3_LEDGER.filter((record) => record.status === status);
}

export function formatMaster3Ledger(records: readonly SectionRecord[] = MASTER3_LEDGER): string {
  const lines: string[] = ["MASTER #3 COMPLETION LEDGER"];
  for (const status of SECTION_STATUSES) {
    const group = records.filter((record) => record.status === status);
    if (group.length === 0) continue;
    lines.push(`\n${status.toUpperCase()} (${group.length})`);
    for (const record of group) {
      lines.push(`  §${record.section} ${record.name}`);
      lines.push(`     ${record.note}`);
    }
  }
  return lines.join("\n");
}
