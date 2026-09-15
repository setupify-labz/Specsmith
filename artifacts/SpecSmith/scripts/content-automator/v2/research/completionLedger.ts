// MASTER #2 completion ledger.
//
// Same doctrine as v2/capabilityLedger.ts, and for the same reason: a status
// field nobody validates is a wish. This one is checked against the real source
// tree by completionLedger.test.ts — a section cannot claim `integrated` unless
// a named caller genuinely imports one of its modules, nor `tested` without an
// existing test file.
//
// A section may NOT be called implemented merely because a type exists.

export type SectionStatus =
  /** Module exists, has a real caller, and tests cover it. */
  | "tested"
  /** A real production caller consumes its output. Tests may be thinner. */
  | "integrated"
  /** Exists and works, but nothing calls it yet. */
  | "implemented"
  /** Part of the section is real; the rest is named as missing in the note. */
  | "partially-implemented"
  /** Needs something outside this repository. */
  | "blocked-external"
  /** Needs data that does not exist yet. */
  | "blocked-data"
  /** Belongs to a later MASTER by the brief's own allocation. */
  | "deferred-to-master"
  | "not-applicable";

export const SECTION_STATUSES: readonly SectionStatus[] = [
  "tested", "integrated", "implemented", "partially-implemented",
  "blocked-external", "blocked-data", "deferred-to-master", "not-applicable",
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

const MODEL = "v2/research/model.ts";
const SOURCES = "v2/research/sourceAssessment.ts";
const CLAIMS = "v2/research/claims.ts";
const EVIDENCE = "v2/research/evidence.ts";
const CONFIDENCE = "v2/research/confidence.ts";
const CONTRACT = "v2/research/creativeContract.ts";
const INGEST = "v2/research/ingestion.ts";
const PASS = "v2/research/researchPass.ts";
const LOOP = "v2/research/closedLoop.ts";
const FIXTURE = "v2/research/engineeringFixture.ts";
const PIPELINE = "endToEndOfflinePipeline.ts";

const T_SOURCES = "v2/research/sourceAssessment.test.ts";
const T_CLAIMS = "v2/research/claims.test.ts";
const T_EVIDENCE = "v2/research/evidence.test.ts";
const T_CONTRACT = "v2/research/creativeContract.test.ts";
const T_INGEST = "v2/research/ingestion.test.ts";
const T_LOOP = "v2/research/closedLoop.test.ts";

export const MASTER2_LEDGER: readonly SectionRecord[] = [
  { section: 1, name: "Zero-dollar operating requirement", status: "tested", modules: [PASS, MODEL], callers: [PIPELINE], tests: [T_LOOP],
    note: "No research module contains an HTTP client or reads a credential. Quota exhaustion is a first-class stopping reason that does not lower the evidence bar, asserted by test. There is no paid fallback because there is no network path at all." },
  { section: 2, name: "Audit of the existing system", status: "tested", modules: [MODEL, EVIDENCE], callers: [PASS], tests: [T_EVIDENCE],
    note: "Canonical structures were reused rather than duplicated: classifyFormFactor from src/lib/measured/hardwareMatch.ts is imported and exercised, and model.ts documents which existing types each concept mirrors (EvidenceQuality, VerificationMethod, ObservationTier, offerSnapshot freshness)." },
  { section: 3, name: "Research object model", status: "tested", modules: [MODEL], callers: [PASS, CONTRACT, INGEST], tests: [T_EVIDENCE],
    note: "Eighteen distinct primitives with stable identity and lineage. Source, Observation, Claim, Hypothesis and Belief are separate types precisely so they cannot collapse into one another." },
  { section: 4, name: "Source intelligence", status: "tested", modules: [SOURCES], callers: [PASS], tests: [T_SOURCES],
    note: "Interpretable grades with attached reasons and limitations, never a float. Authority, directness, independence, transparency, conflict of interest and whether the material was actually observed are each assessed separately." },
  { section: 5, name: "Context-sensitive source hierarchy", status: "tested", modules: [SOURCES], callers: [PASS], tests: [T_SOURCES],
    note: "SOURCE_FITNESS is a (claim kind x source type) table, so manufacturer documentation is high for specifications and low for measured performance. Nothing hard-codes official-source-always-wins." },
  { section: 6, name: "Source snapshots and immutability", status: "tested", modules: [INGEST, MODEL], callers: [LOOP, PIPELINE], tests: [T_INGEST],
    note: "Snapshots carry retrieval method, content hash, publication/update/retrieval times and parser version. A conflicting replay of the same id fails closed rather than editing history." },
  { section: 7, name: "Claim atomization", status: "tested", modules: [CLAIMS], callers: [LOOP], tests: [T_CLAIMS],
    note: "A three-part compound statement becomes three claims with three kinds and three risk classes, each free to reach a different verdict. weakestRisk gives combined copy its ceiling." },
  { section: 8, name: "Observation vs claim", status: "tested", modules: [CLAIMS, MODEL], callers: [PASS], tests: [T_CLAIMS],
    note: "describeLeap detects a claim asserting more than its observation shows: a dropped time bound, a configuration the observation never fixed, a family-wide spec drawn from one SKU." },
  { section: 9, name: "Quote and paraphrase integrity", status: "tested", modules: [CLAIMS, MODEL], callers: [PASS], tests: [T_CLAIMS],
    note: "renderObservationForScript throws rather than put quotation marks around a paraphrase, a model summary or an inference. There is deliberately no override flag." },
  { section: 10, name: "Corroboration intelligence", status: "tested", modules: [EVIDENCE], callers: [PASS], tests: [T_EVIDENCE, T_LOOP],
    note: "Sources collapse by declared upstream lineage first and publisher second, so three articles restating one press release count as one independent origin." },
  { section: 11, name: "Conflict intelligence", status: "tested", modules: [EVIDENCE, CONFIDENCE], callers: [PASS], tests: [T_EVIDENCE],
    note: "A disagreement is recorded, never averaged. A configuration or date difference resolves it as a non-conflict; otherwise the claim becomes disputed and no winner is invented." },
  { section: 12, name: "Temporal / freshness intelligence", status: "tested", modules: [EVIDENCE], callers: [PASS], tests: [T_EVIDENCE],
    note: "Per-claim-kind rules, not one global TTL: a price is stale in a day, a specification is timeless, a benchmark is expired by a version mismatch regardless of age." },
  { section: 13, name: "Version and configuration intelligence", status: "tested", modules: [EVIDENCE, MODEL], callers: [PASS], tests: [T_EVIDENCE],
    note: "ClaimConfiguration carries GPU, CPU, game, version, driver, resolution, preset, RT, upscaler, frame generation, form factor and SKU. A version mismatch beats the clock." },
  { section: 14, name: "Applicability intelligence", status: "tested", modules: [EVIDENCE], callers: [PASS], tests: [T_EVIDENCE, T_LOOP],
    note: "Six applicability states with reasons. The laptop-vs-desktop boundary uses the SAME classifier as the measured-observation system rather than a second copy of that rule." },
  { section: 15, name: "First-party SpecSmith evidence", status: "partially-implemented", modules: [MODEL, SOURCES], callers: [PASS], tests: [T_SOURCES],
    note: "first-party-specsmith is a distinct source type graded high for its own questions, and specsmith-runtime is a distinct retrieval method. A live adapter reading the measured/estimated catalogues is NOT built: no research question in the pipeline needs one yet, and an adapter with no caller would be theatre." },
  { section: 16, name: "Hardware claim provenance", status: "tested", modules: [EVIDENCE, CLAIMS], callers: [PASS], tests: [T_EVIDENCE, T_CLAIMS],
    note: "Exact-SKU mismatch, canonical-spec-to-SKU leakage, editorial price versus listing price, and frame-generated versus rendered frames are each refused by name." },
  { section: 17, name: "Benchmark evidence intelligence", status: "tested", modules: [MODEL, CONTRACT], callers: [PASS], tests: [T_CONTRACT],
    note: "performance-measured and performance-estimated are separate claim kinds with separate freshness rules, and the contract forbids first-person measurement language for a third-party result." },
  { section: 18, name: "Research questions", status: "tested", modules: [MODEL, PASS], callers: [LOOP, PIPELINE], tests: [T_LOOP],
    note: "ResearchQuestion requires a purpose, the decision it informs, the acceptable uncertainty and a claim kind. A question with no claims stops as question-invalid." },
  { section: 19, name: "Question decomposition", status: "partially-implemented", modules: [MODEL, CLAIMS], callers: [LOOP], tests: [T_CLAIMS],
    note: "Decomposition happens at the CLAIM level, which is where the evidence attaches: a compound statement becomes independently-evidenced claims. subQuestionIds exists on ResearchQuestion but no generator produces sub-questions yet, so that half is a boundary rather than a feature." },
  { section: 20, name: "Knowledge gap detection", status: "tested", modules: [PASS], callers: [LOOP, PIPELINE], tests: [T_LOOP],
    note: "Gaps are derived from the question's own requirements rather than from what the evidence happens to lack, and each is ranked by how much closing it could change the decision." },
  { section: 21, name: "Research planning", status: "blocked-external", modules: [], callers: [], tests: [],
    note: "A plan says which sources to go and look at. Nothing in this repository can go and look at anything: there is no autonomous web access, and evidence arrives through the ingestion boundary from a connector or a person. A planner whose output nobody could execute would be architecture theatre." },
  { section: 22, name: "Evidence escalation", status: "partially-implemented", modules: [CONFIDENCE, MODEL], callers: [PASS], tests: [T_CONTRACT],
    note: "The demand side is real and enforced: claim risk sets both the required epistemic state and the required number of independent origins, so a controversial hook needs more than a VRAM figure. The supply side — actually going and getting more evidence — is blocked with section 21." },
  { section: 23, name: "Evidence budget", status: "tested", modules: [PASS, MODEL], callers: [LOOP, PIPELINE], tests: [T_LOOP],
    note: "ResearchBudget records sources consulted, snapshots ingested, cached reuse, duplicate evidence and named exhausted quotas. Duplicate counting is real: deduplication in ingestion feeds it." },
  { section: 24, name: "Research stopping rules", status: "tested", modules: [PASS, MODEL], callers: [LOOP, PIPELINE], tests: [T_LOOP],
    note: "All ten stopping reasons exist and six are marked successful. insufficient-evidence is a correct outcome, asserted by test, so nothing is pushed to force an answer." },
  { section: 25, name: "Confidence intelligence", status: "tested", modules: [CONFIDENCE], callers: [PASS], tests: [T_CONTRACT, T_LOOP],
    note: "Every state carries drivers, detractors and wouldChangeIfs derived from stored evidence, so why-do-we-believe-this has an answer that can be argued with." },
  { section: 26, name: "Uncertainty as first-class data", status: "tested", modules: [MODEL, CONFIDENCE], callers: [PASS], tests: [T_CONTRACT],
    note: "Eleven epistemic states. unknown never becomes 0, missing evidence never becomes false, absence of contradiction never becomes proof, and stale is its own state rather than either absent or current." },
  { section: 27, name: "Hypothesis registry", status: "deferred-to-master", modules: [], callers: [], tests: [],
    note: "A hypothesis registry is only useful once something can test a hypothesis. MASTER #5 runs controlled performance experiments; building the registry now would be a store nothing reads or writes." },
  { section: 28, name: "Belief model", status: "deferred-to-master", modules: [], callers: [], tests: [],
    note: "A durable belief is only meaningful if something can change it, which requires new evidence arriving over time from a source that does not exist here. Nothing would write to the store and nothing would read it, so it would be a schema rather than a capability." },
  { section: 29, name: "Belief updating", status: "deferred-to-master", modules: [], callers: [], tests: [],
    note: "Requires beliefs (section 28) and new evidence arriving over time. Neither exists yet." },
  { section: 30, name: "Disconfirmation search", status: "partially-implemented", modules: [CONFIDENCE, EVIDENCE], callers: [PASS], tests: [T_EVIDENCE],
    note: "The interpretation half is real: contradicting evidence is a first-class stance, conflicts are preserved, and confidence names what would falsify a claim. Actively GOING TO LOOK for disconfirming sources is blocked with section 21." },
  { section: 31, name: "Self-confirmation protection", status: "tested", modules: [CONTRACT, LOOP], callers: [LOOP, PIPELINE], tests: [T_CONTRACT],
    note: "No function in the contract accepts a parameter expressing what the creative side wants. A claim becomes safe only by clearing its own risk class's evidence bar, and the pipeline demonstrates research refusing a hook." },
  { section: 32, name: "Claim-risk classification", status: "tested", modules: [MODEL, CLAIMS], callers: [PASS], tests: [T_CLAIMS],
    note: "MINIMUM_RISK_BY_KIND is a floor a caller cannot argue below: asking for low risk on a price claim still yields high." },
  { section: 33, name: "Content-evidence contradiction check", status: "tested", modules: [CONTRACT, LOOP], callers: [LOOP, PIPELINE], tests: [T_CONTRACT, T_LOOP],
    note: "checkScriptAgainstResearch scans every line a viewer hears or reads and emits findings in the same severity vocabulary MASTER #1's slop report uses, so the pipeline's existing blocking logic applies without a second rule set. It does not duplicate anti-slop: that module judges language, this one judges evidence." },
  { section: 34, name: "Research -> Creative Director contract", status: "tested", modules: [CONTRACT, LOOP], callers: [LOOP, PIPELINE], tests: [T_CONTRACT],
    note: "Safe claims, unsafe claims with what would fix them, disputed claims, grounded hook material, open questions, required wording and attribution. Structured, never an essay." },
  { section: 35, name: "Creative decision traceability", status: "partially-implemented", modules: [MODEL, PASS], callers: [PASS], tests: [T_LOOP],
    note: "The chain from snapshot to observation to claim to confidence to contract entry is complete and traceable by id. The link onward to a creative decision and then to analytics needs MASTER #1's revision lineage joined to published performance, and nothing has been published." },
  { section: 36, name: "RESEARCH_RESULT contract", status: "tested", modules: [PASS], callers: [LOOP, PIPELINE], tests: [T_LOOP],
    note: "Transport-independent and self-describing. It assumes no provider and contains no fetch." },
  { section: 37, name: "Strict ingestion", status: "tested", modules: [INGEST], callers: [LOOP, PIPELINE], tests: [T_INGEST],
    note: "Refuses malformed records, unknown enums, impossible times, missing provenance, null-as-absent, unsafe URLs, credentials in URLs, circular lineage and observations with no snapshot. Nothing is coerced." },
  { section: 38, name: "Idempotency and deduplication", status: "tested", modules: [INGEST], callers: [LOOP], tests: [T_INGEST],
    note: "Exact replay is a no-op by content fingerprint, so the same evidence resubmitted under a new id cannot inflate corroboration. A conflicting replay fails closed." },
  { section: 39, name: "Research memory", status: "blocked-data", modules: [], callers: [], tests: [],
    note: "Durable memory needs research passes worth remembering. Zero real research passes have run, because there is no evidence source. The ingestion boundary is what a memory would be built on and it exists; the store does not." },
  { section: 40, name: "Source performance memory", status: "blocked-data", modules: [], callers: [], tests: [],
    note: "Learning which sources are useful requires a history of sources having been useful or not. Fabricating that history is exactly what the brief forbids." },
  { section: 41, name: "Research failure memory", status: "blocked-data", modules: [], callers: [], tests: [],
    note: "Same dependency as section 39: no passes have run, so there are no failures to remember." },
  { section: 42, name: "Community intelligence", status: "partially-implemented", modules: [SOURCES, MODEL], callers: [PASS], tests: [T_SOURCES],
    note: "The separation the brief asks for is real and tested: community-discussion is high for audience-behaviour and misconception-exists, and low for performance-measured. A collector is blocked with section 21." },
  { section: 43, name: "Question intelligence", status: "blocked-data", modules: [], callers: [], tests: [],
    note: "Identifying which questions are worth answering needs evidence that people are asking them. No community or search source is connected, and fabricating search volume is forbidden." },
  { section: 44, name: "Language intelligence", status: "blocked-data", modules: [], callers: [], tests: [],
    note: "Preserving audience phrasing requires observed audience phrasing. Same blocker as section 43." },
  { section: 45, name: "Misconception intelligence", status: "partially-implemented", modules: [MODEL, SOURCES], callers: [PASS], tests: [T_SOURCES],
    note: "misconception-exists is a claim kind with its own evidence requirements and its own freshness rule, so a myth-busting hook needs evidence the myth is actually expressed. Detecting real misconceptions needs a community source." },
  { section: 46, name: "Trend research boundary", status: "blocked-external", modules: [], callers: [], tests: [],
    note: "Trend claims need change over time from a real source. The repository has trend-source adapters for TikTok/YouTube/Instagram AUDIO trends only, all requiring API keys that are not set, and none of them evidences topic trends." },
  { section: 47, name: "Opportunity research contribution", status: "deferred-to-master", modules: [], callers: [], tests: [],
    note: "The brief assigns the portfolio decision to MASTER #3. The research-side inputs it would consume are themselves blocked on sections 39-43." },
  { section: 48, name: "Competitor / content research", status: "blocked-external", modules: [], callers: [], tests: [],
    note: "Needs observation of external content. No collector exists and none can be built without web access." },
  { section: 49, name: "Survivorship bias protection", status: "partially-implemented", modules: [MODEL, CONFIDENCE], callers: [PASS], tests: [T_SOURCES],
    note: "The representational groundwork is real: corroboration counts origins rather than instances, so ten examples from one origin do not become ten data points. Reasoning about an unobserved unsuccessful population needs section 48's corpus." },
  { section: 50, name: "Causality protection", status: "partially-implemented", modules: [MODEL], callers: [PASS], tests: [],
    note: "The type system enforces the distinction: Hypothesis is a separate type from AtomicClaim, and requires-experiment is a distinct epistemic state that the creative contract refuses. Running the experiments is MASTER #5." },
  { section: 51, name: "Sample-size protection", status: "tested", modules: [EVIDENCE, CONFIDENCE], callers: [PASS], tests: [T_EVIDENCE, T_LOOP],
    note: "independentOriginCount is the sample size, and it counts origins rather than URLs. Required origins scale with claim risk. Sample size is never invented when unknown." },
  { section: 52, name: "Platform research profiles", status: "partially-implemented", modules: [MODEL, EVIDENCE, SOURCES], callers: [PASS], tests: [T_EVIDENCE, T_SOURCES],
    note: "platform-guidance is a real claim kind: it carries its own freshness rule (platform advice ages fast and old guidance is confidently wrong) and its own source hierarchy that rates official platform guidance high and an editorial article low, so folklore cannot be encoded as platform truth. Populated per-platform profiles need official guidance nobody has ingested, and no collector exists." },
  { section: 53, name: "Audience research profiles", status: "deferred-to-master", modules: [], callers: [], tests: [],
    note: "The brief assigns deeper audience intelligence to MASTER #4, and profiles based on observed needs require section 43's evidence." },
  { section: 54, name: "Content domain research profiles", status: "partially-implemented", modules: [MODEL, EVIDENCE, SOURCES], callers: [PASS], tests: [T_EVIDENCE, T_SOURCES],
    note: "Domains are expressed as claim kinds, and each genuinely carries different evidence requirements, freshness rules and source hierarchies. That is the part of a domain profile that changes behaviour." },
  { section: 55, name: "Primary-source preference", status: "tested", modules: [SOURCES], callers: [PASS], tests: [T_SOURCES],
    note: "Directness is assessed separately from authority, and a declared upstream demotes it. Manufacturer specification and independent measurement are graded on different axes because they answer different questions." },
  { section: 56, name: "Research candidate generation", status: "blocked-external", modules: [], callers: [], tests: [],
    note: "Generating several explanations for an observation is useful only if evidence can then be gathered to discriminate between them. Blocked with section 21." },
  { section: 57, name: "Adversarial research review", status: "partially-implemented", modules: [CONFIDENCE, CONTRACT], callers: [PASS, PIPELINE], tests: [T_CONTRACT],
    note: "Every refusal already answers the adversarial questions from stored evidence: what is unsupported, what is stale, what is inferred, what conflicts, what is generalised, what source dependence exists, what would falsify it. A separate review agent is not built; the checks are inline and always run." },
  { section: 58, name: "Research quality vs creative quality", status: "tested", modules: [CONTRACT, PASS], callers: [PIPELINE], tests: [T_LOOP],
    note: "Separate objects with no shared score. Nothing in the research modules imports MASTER #1's creativeQualityReview, and nothing in that module imports these." },
  { section: 59, name: "Research quality vs performance", status: "tested", modules: [PASS, CONFIDENCE], callers: [PIPELINE], tests: [T_LOOP],
    note: "No research module imports performance.ts or any analytics module. There is no code path by which a view count could strengthen a factual claim." },
  { section: 60, name: "Research + performance triangulation", status: "deferred-to-master", modules: [], callers: [], tests: [],
    note: "Needs published performance. Assigned to MASTER #5/#6 by the brief." },
  { section: 61, name: "Agreement / disagreement matrix", status: "deferred-to-master", modules: [], callers: [], tests: [],
    note: "The matrix requires four independent verdicts on one creative, and three of them do not exist yet: no performance data, no recorded human review of a generated creative, and no second critic. The brief assigns this to MASTER #8." },
  { section: 62, name: "Research refresh queue", status: "blocked-data", modules: [], callers: [], tests: [],
    note: "A refresh queue needs stored evidence to revisit. Freshness classification, which is what a queue would prioritise on, is built and tested." },
  { section: 63, name: "Cache and reuse intelligence", status: "partially-implemented", modules: [INGEST, EVIDENCE], callers: [LOOP], tests: [T_INGEST],
    note: "The correctness half is real: deduplication by content fingerprint, and freshness/applicability gates that decide whether stored evidence may be reused at all. The store itself is blocked with section 39." },
  { section: 64, name: "Resource / quota metadata", status: "partially-implemented", modules: [PASS, MODEL], callers: [PIPELINE], tests: [T_LOOP],
    note: "Exhausted quotas are named on the budget and become a stopping reason. Per-provider quota inventory is not modelled because no research provider is connected, and inventing quota numbers is forbidden." },
  { section: 65, name: "Explanation intelligence", status: "tested", modules: [CONFIDENCE, PASS, CONTRACT], callers: [PIPELINE], tests: [T_CONTRACT, T_LOOP],
    note: "Every explanation derives from stored evidence rather than being written afterwards: drivers, detractors, wouldChangeIfs, freshness reasons, applicability reasons, corroboration reasoning and the stopping reason." },
  { section: 66, name: "Counterfactual reasoning", status: "partially-implemented", modules: [CONFIDENCE], callers: [PASS], tests: [T_CONTRACT],
    note: "wouldChangeIfs and wouldBecomeSafeIf are counterfactuals derived from the actual evidence state, and they are never presented as observations. Systematic fragility analysis across a decision is not built." },
  { section: 67, name: "CONTENT_RESEARCH_REPORT", status: "tested", modules: [PASS], callers: [PIPELINE], tests: [T_LOOP],
    note: "Machine-readable result plus a human-readable render, deliberately with no headline score: a single number would be the first thing read and the last thing checked." },
  { section: 68, name: "No research theater", status: "tested", modules: [LOOP, FIXTURE], callers: [PIPELINE], tests: [T_LOOP],
    note: "Every module marked integrated or tested here is reachable from the offline pipeline, and this ledger's own test refuses a caller claim unless the import genuinely exists. Sections with no honest caller are recorded as blocked rather than given one." },
  { section: 69, name: "Negative controls", status: "tested", modules: [EVIDENCE, CONTRACT, INGEST, CONFIDENCE], callers: [PIPELINE], tests: [T_EVIDENCE, T_CONTRACT, T_INGEST],
    note: "Each load-bearing guard has a test that fails when the guard is disabled; the controls and what each proves are recorded in the commit message." },
  { section: 70, name: "Adversarial fixtures", status: "tested", modules: [FIXTURE], callers: [LOOP, PIPELINE], tests: [T_LOOP, T_EVIDENCE],
    note: "Laptop-versus-desktop, exact-SKU mismatch, stale price, patch mismatch, frame generation, press-release repetition, missing publication date, search-summary retrieval, marketing presented as measurement, malformed ingestion, duplicate snapshot and synthetic-into-production are each exercised." },
  { section: 71, name: "Determinism", status: "tested", modules: [PASS, SOURCES, EVIDENCE], callers: [LOOP], tests: [T_LOOP, T_SOURCES],
    note: "No module reads the clock: every time-dependent function takes `now`. Source ranking breaks ties on snapshotId. Identical inputs produce byte-identical results, asserted by test." },
  { section: 72, name: "Synthetic test data boundary", status: "tested", modules: [INGEST, FIXTURE], callers: [PIPELINE], tests: [T_INGEST, T_LOOP],
    note: "Every record carries an explicit synthetic flag, production ingestion refuses synthetic records, mixed provenance is refused, and the pipeline asserts the refusal at runtime rather than trusting it." },
  { section: 73, name: "Security and privacy", status: "tested", modules: [INGEST], callers: [PIPELINE], tests: [T_INGEST],
    note: "No credential is read anywhere in the research modules. Non-http schemes and URLs carrying credentials are refused. There is no fetch, no shell, no deserialization of code, and no file write." },
  { section: 74, name: "Copyright / source storage discipline", status: "tested", modules: [MODEL, INGEST], callers: [PASS], tests: [T_INGEST],
    note: "Observations store a short excerpt or structured fields plus a hash and metadata. Nothing mirrors whole works, and there is no bulk content field." },
  { section: 75, name: "Current external access reality", status: "tested", modules: [INGEST, PASS], callers: [PIPELINE], tests: [T_INGEST],
    note: "Transport-independent ingestion, exactly as the Metricool handoff does. No fake network client was added to make the architecture look complete, and the modules contain no HTTP call of any kind." },
  { section: 76, name: "Provider inventory", status: "tested", modules: ["v2/research/providerInventory.ts"], callers: [PIPELINE], tests: ["v2/research/providerInventory.test.ts"],
    note: "Audited from the real source tree: each provider's module, callers, required environment variables, whether it can execute, and whether core functionality depends on it. Validated against the repository by test." },
  { section: 77, name: "Real integration target", status: "tested", modules: [LOOP], callers: [PIPELINE], tests: [T_LOOP],
    note: "The full chain runs as section 1c of the offline pipeline against the REAL generated storyboard, and the gate genuinely blocks the run on a hard evidence finding." },
  { section: 78, name: "Completion ledger", status: "tested", modules: ["v2/research/completionLedger.ts"], callers: [PIPELINE], tests: ["v2/research/completionLedger.test.ts"],
    note: "This ledger, validated against the real source tree: a section cannot claim a caller that does not import one of its modules, nor a test file that does not exist." },
];

export function sectionsByStatus(status: SectionStatus): readonly SectionRecord[] {
  return MASTER2_LEDGER.filter((record) => record.status === status);
}

/** Renders the ledger grouped by status, for a terminal. */
export function formatMaster2Ledger(records: readonly SectionRecord[] = MASTER2_LEDGER): string {
  const lines: string[] = ["MASTER #2 COMPLETION LEDGER"];
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
