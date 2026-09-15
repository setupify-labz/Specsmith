// MASTER #4 — Completion ledger (section 44).
//
// A truthful record of what is actually built, validated against the real
// source tree by completionLedger.test.ts. A section may not claim `tested`
// unless its modules exist, a non-test caller genuinely imports them, and a
// test file that exercises them exists.
//
// The point of this file is that it is HARD to lie in. Writing "tested" next to
// a section whose module nobody imports fails a test.

export type SectionStatus =
  /** Built, wired into a real caller, and exercised by tests. */
  | "tested"
  /** Architecture exists and works; important behaviour is still missing. */
  | "partially-implemented"
  /** Needs real external access that does not exist here. */
  | "blocked-external"
  /** The system exists but no real observations do. */
  | "blocked-data"
  /** Intentionally belongs to a later MASTER. */
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

const A_MODEL = "v2/audience/model.ts";
const A_SIGNALS = "v2/audience/signals.ts";
const A_LANG = "v2/audience/language.ts";
const A_HYP = "v2/audience/hypotheses.ts";
const A_PROFILE = "v2/audience/profile.ts";

const P_MODEL = "v2/platform/model.ts";
const P_REGISTRY = "v2/platform/registry.ts";
const P_INGEST = "v2/platform/ingestion.ts";

const D_INVARIANTS = "v2/delivery/invariants.ts";
const D_FIT = "v2/delivery/fit.ts";
const D_BRIEF = "v2/delivery/brief.ts";
const D_CROSS = "v2/delivery/crossPlatform.ts";
const D_PASS = "v2/delivery/deliveryPass.ts";
const D_LOOP = "v2/delivery/closedLoop.ts";
const D_FIXTURE = "v2/delivery/engineeringFixture.ts";

const PIPELINE = "endToEndOfflinePipeline.ts";

const T_AUDIENCE = "v2/audience/audience.test.ts";
const T_PLATFORM = "v2/platform/platform.test.ts";
const T_INVARIANTS = "v2/delivery/invariants.test.ts";
const T_PASS = "v2/delivery/deliveryPass.test.ts";
const T_LEDGER = "v2/delivery/completionLedger.test.ts";

export const MASTER4_LEDGER: readonly SectionRecord[] = [
  { section: 1, name: "Audience intelligence model", status: "tested", modules: [A_MODEL], callers: [A_PROFILE], tests: [T_AUDIENCE],
    note: "Eight knowledge states and a Held<T> that cannot hold a value without saying how it is known. buildHeld refuses an observation citing no signal, a conflict with one signal, and any value in a state that carries none." },
  { section: 2, name: "Audience signal provenance", status: "tested", modules: [A_SIGNALS], callers: [A_PROFILE, D_PASS], tests: [T_AUDIENCE],
    note: "Strict AUDIENCE_SIGNAL_RESULT ingestion with source family, scope, capture and observation times, limitations and an explicit synthetic flag. A missing sample size stays null; a reported 0 is refused as a fabricated measurement." },
  { section: 3, name: "Audience hypotheses", status: "tested", modules: [A_HYP], callers: [D_PASS], tests: [T_AUDIENCE],
    note: "Born untested, requires a falsification condition, a measurement requirement and a creative implication. No status maps to `observed`, and repeated use cannot promote one to fact." },
  { section: 4, name: "Language and question intelligence", status: "partially-implemented", modules: [A_LANG], callers: [A_PROFILE], tests: [T_AUDIENCE],
    note: "Observed phrases and generated paraphrases are different types with a one-way door: asObserved throws on a generated phrase. Intent, terminology, ambiguity and expertise classification are deterministic. No collector exists, so in production there are no observed phrases at all." },
  { section: 5, name: "Audience segmentation without fake personas", status: "tested", modules: [A_MODEL, A_PROFILE], callers: [D_PASS], tests: [T_AUDIENCE, T_PASS],
    note: "Segments derive from problem, intent, knowledge, readiness and risk. With no observed job or intent the list is empty rather than containing a 'general audience'. A second segment requires a signal that saw a second population, and the system may declare that one creative cannot serve both." },
  { section: 6, name: "Audience fit", status: "tested", modules: [A_PROFILE], callers: [D_PASS, D_FIT], tests: [T_PASS],
    note: "Four verdicts that keep 'strategically useful for a logical audience' distinct from 'we observed this audience demanding it'. Evergreen content is not rejected for lacking analytics." },
  { section: 7, name: "Platform intelligence model", status: "tested", modules: [P_MODEL], callers: [P_REGISTRY, P_INGEST, D_FIT], tests: [T_PLATFORM],
    note: "Seven knowledge statuses separating stable constraints from current guidance, hypotheses and stale facts. A structural test asserts the registry contains no claim about ranking, promotion or suppression." },
  { section: 8, name: "Platform fact provenance and freshness", status: "tested", modules: [P_MODEL, P_INGEST], callers: [D_FIT], tests: [T_PLATFORM],
    note: "Expiry is computed from the category, never taken from the document, so a source cannot declare its own folklore evergreen. Volatile categories may not claim a binding status and anecdotes may not be binding at all." },
  { section: 9, name: "Platform capability registry", status: "partially-implemented", modules: [P_REGISTRY], callers: [D_FIT, D_BRIEF], tests: [T_PLATFORM],
    note: "Media, text, interaction, accessibility, publishing and analytics. Vertical 9:16 is asserted from direct observation of our own renders; duration is a conservative floor rather than a current limit; safe areas and every analytics capability are unknown because nothing measured them." },
  { section: 10, name: "Connected Metricool reality", status: "blocked-external", modules: [P_REGISTRY], callers: [D_FIT], tests: [T_PLATFORM],
    note: "The repository cannot call the ChatGPT/Metricool connector, and the REST transport stays inert without credentials. Publishing transport is recorded as manual-handoff, which is what actually exists. Ingestion contracts are ready for a future connector to populate." },
  { section: 11, name: "Audience x Platform fit", status: "tested", modules: [D_FIT], callers: [D_PASS], tests: [T_PASS],
    note: "Five verdicts with named reasons and no score. Refusals are evaluated first and are absolute. Conflicts carry an honest resolution — restructure, layer, change format, change platform, refuse — and dropping evidence is not an available move." },
  { section: 12, name: "Truth invariants", status: "tested", modules: [D_INVARIANTS], callers: [D_PASS, D_BRIEF, D_LOOP], tests: [T_INVARIANTS],
    note: "Once a line mentions an approved claim it inherits that claim's required wording. The brief's own example — dropping 'estimated' and the configuration from a 15% figure — is a hard failure, and so is describing an estimate in the language of measurement." },
  { section: 13, name: "Mission invariants", status: "tested", modules: [D_INVARIANTS], callers: [D_PASS], tests: [T_INVARIANTS],
    note: "Nine frozen mission fields. Changing the objective, angle, thesis, claims, forbidden list, required wording, product route, resource posture or hypothesis identity is a hard failure with a named reason." },
  { section: 14, name: "Platform creative brief", status: "tested", modules: [D_BRIEF], callers: [D_PASS, D_LOOP, PIPELINE], tests: [T_PASS],
    note: "Transport-independent contract carrying identity, invariants, audience, execution and uncertainty. Claims are copied by reference from the mission; no code path constructs a new claim." },
  { section: 15, name: "Cross-platform package plan", status: "tested", modules: [D_CROSS], callers: [D_PASS], tests: [T_PASS],
    note: "Every difference names the established platform fact that caused it. When nothing differs, the plan says uniform execution is justified rather than inventing three differences to look thorough." },
  { section: 16, name: "Hook adaptation", status: "partially-implemented", modules: [D_FIT], callers: [D_BRIEF], tests: [T_PASS],
    note: "Constraints only: the hook's premise must be a permitted claim, no manufactured urgency, and an estimate label must live in the hook itself. A misconception-correction hook is forbidden unless MASTER #2 approved a misconception-exists claim. Which hook FORM is best is MASTER #1's judgment and is not decided here." },
  { section: 17, name: "Pacing intelligence", status: "partially-implemented", modules: [D_FIT], callers: [D_BRIEF], tests: [T_PASS],
    note: "Every pacing number is typed `isHypothesis: true` and derived from the audience's explanation needs, not from a universal optimum. Nothing has been tested against real retention; MASTER #5 owns that." },
  { section: 18, name: "Caption and readability intelligence", status: "tested", modules: [D_FIT], callers: [D_BRIEF], tests: [T_PASS],
    note: "Line length tightens for audiences needing explanation. Reading speed is stated as a configurable guideline rather than a law. Burning captions in is not a guideline: it is the only caption layer whose accuracy SpecSmith verifies." },
  { section: 19, name: "Accessibility", status: "tested", modules: [D_FIT], callers: [D_BRIEF, D_LOOP], tests: [T_PASS],
    note: "Four non-negotiable requirements typed `negotiable: false`, plus a conservative safe area because none is measured. A storyboard with no on-screen text layer fails the audio-independent comprehension check." },
  { section: 20, name: "CTA intelligence", status: "tested", modules: [D_FIT], callers: [D_BRIEF], tests: [T_PASS],
    note: "No shipped product route means no CTA, and no platform capability overrides that. Placement follows whether links actually render as links. No urgency, no bait." },
  { section: 21, name: "Platform metadata intelligence", status: "tested", modules: [D_BRIEF, D_INVARIANTS], callers: [D_PASS], tests: [T_INVARIANTS, T_PASS],
    note: "Metadata runs through the same truth gate as script lines, and a brief whose metadata would breach the boundary is never emitted. The caveat is placed before the CTA so platform truncation loses marketing rather than a qualification." },
  { section: 22, name: "Hashtag intelligence", status: "tested", modules: [D_BRIEF], callers: [D_PASS], tests: [T_PASS],
    note: "Three tag kinds. Every tag this repository can produce is generic-descriptive because no tag collector exists; none is marked observed, and popularity, reach and trend status are never asserted. The count cap is labelled a judgment, not a measured optimum." },
  { section: 23, name: "Posting-time intelligence", status: "blocked-data", modules: [P_REGISTRY, P_INGEST], callers: [D_FIT], tests: [T_PLATFORM],
    note: "Always unknown. A third-party best-time is refused by name: only first-party analytics about this account could establish when this audience watches. Posting time is excluded from the fit verdict entirely." },
  { section: 24, name: "Platform trend intelligence", status: "blocked-data", modules: [P_REGISTRY, P_INGEST], callers: [D_FIT], tests: [T_PLATFORM],
    note: "Always unknown. A trend needs a real observation with a scope and an expiry; an anecdote is refused and an expired trend is reported expired." },
  { section: 25, name: "Audience/platform contradiction handling", status: "tested", modules: [D_FIT], callers: [D_PASS], tests: [T_PASS],
    note: "Depth-versus-duration, conflicting segments and estimate-label-versus-brevity each carry a named resolution. Deleting evidence is not one of the available resolutions." },
  { section: 26, name: "Platform refusal", status: "tested", modules: [D_FIT, D_BRIEF], callers: [D_PASS], tests: [T_PASS],
    note: "Four refusal codes. When required wording takes more than half the format, every platform refuses and no degraded version is produced. Distribution is never forced to three." },
  { section: 27, name: "Unknown as first-class state", status: "tested", modules: [A_MODEL, A_SIGNALS, P_MODEL, P_INGEST], callers: [A_PROFILE, D_FIT], tests: [T_AUDIENCE, T_PLATFORM],
    note: "The most-tested guard in MASTER #4. Unknown never becomes zero, average, an industry assumption or a persona. readMetric returns unknown for an absent or null metric and reads a genuine 0 as a genuine measurement." },
  { section: 28, name: "Platform guidance versioning", status: "tested", modules: [P_MODEL, P_INGEST], callers: [D_PASS], tests: [T_PLATFORM],
    note: "refreshSnapshot creates a new revision rather than mutating; the original stays intact so a brief that cited it remains explainable. Each brief records the exact snapshot id and revision it used." },
  { section: 29, name: "Audience snapshot versioning", status: "tested", modules: [A_MODEL, A_PROFILE], callers: [D_PASS, D_BRIEF], tests: [T_PASS],
    note: "The profile is immutable and carries a revision, and each brief records the profile id and revision it was built from. Later analytics create a new profile rather than rewriting what was believed at decision time." },
  { section: 30, name: "Zero-cost core", status: "tested", modules: [D_PASS], callers: [PIPELINE], tests: [T_PASS, T_LEDGER],
    note: "assertZeroCostDelivery is called by the offline pipeline, and a structural test proves no MASTER #4 module contains fetch, reads an environment variable or imports a provider adapter. MASTER #4 adds no provider at all." },
  { section: 31, name: "Transport-independent ingestion", status: "tested", modules: [A_SIGNALS, P_INGEST], callers: [D_PASS], tests: [T_AUDIENCE, T_PLATFORM],
    note: "AUDIENCE_SIGNAL_RESULT and PLATFORM_GUIDANCE_RESULT: strict schemas, idempotent parsing, duplicate refusal, malformed refusal, stale handling, unknown preservation and an explicit synthetic marker. No core reasoning depends on a provider." },
  { section: 32, name: "MASTER #1 handoff", status: "tested", modules: [D_LOOP], callers: [PIPELINE], tests: [T_PASS],
    note: "CreativeHandoff restates every invariant at the top level, and assertCreativeHonoursBrief checks the produced storyboard against them across script and metadata together. MASTER #4 supplies constraints and never edits the video." },
  { section: 33, name: "MASTER #2 handoff", status: "tested", modules: [D_INVARIANTS, D_LOOP], callers: [D_PASS, PIPELINE], tests: [T_INVARIANTS, T_PASS],
    note: "assertNoEvidenceUpgrade rejects promoting an unsafe claim, resolving a disputed one, or asserting a claim research never saw. The closed loop runs MASTER #2's strict gate unchanged and passes its findings through without any suppression mechanism." },
  { section: 34, name: "MASTER #3 handoff", status: "tested", modules: [D_PASS, D_INVARIANTS], callers: [PIPELINE, D_BRIEF], tests: [T_PASS],
    note: "Typed escalations rather than silent rewrites: conflicting segments, no platform able to carry the mission, and commercial intent without audience grounding are each handed back to Strategy with what it must decide." },
  { section: 35, name: "MASTER #5 boundary", status: "deferred", modules: [D_LOOP], callers: [], tests: [T_PASS],
    note: "Hypotheses and falsification conditions are defined here; experiment assignment, performance judgment, winner selection and retention optimization are not implemented and are recorded in DEFERRED_TO_LATER_MASTERS." },
  { section: 36, name: "MASTER #6 boundary", status: "deferred", modules: [D_LOOP], callers: [], tests: [T_PASS],
    note: "Immutable audience and platform snapshots are emitted for a future memory layer. No long-term learning memory is implemented." },
  { section: 37, name: "Executive boundary", status: "deferred", modules: [D_PASS, D_LOOP], callers: [], tests: [T_PASS],
    note: "Fit, constraints, conflicts, refusals, hypotheses, uncertainty and escalations are all exposed as data for a future MASTER #8 to reason over. Nothing arbitrates." },
  { section: 38, name: "Adversarial testing", status: "tested", modules: [D_INVARIANTS, A_SIGNALS, P_INGEST], callers: [D_PASS], tests: [T_INVARIANTS, T_AUDIENCE, T_PLATFORM, T_PASS],
    note: "Attacks on every boundary: persona invention, demographic inference, zero-as-measurement, cross-platform leakage, estimate stripping, measurement upgrading, forbidden claims in metadata, mission mutation, stale guidance, invented posting times and anecdotal trends." },
  { section: 39, name: "Negative controls", status: "tested", modules: [A_MODEL, A_SIGNALS, P_INGEST, D_INVARIANTS, D_FIT, D_BRIEF], callers: [D_PASS], tests: [T_INVARIANTS, T_AUDIENCE, T_PLATFORM, T_PASS],
    note: "Fifteen controls, each of which fails tests when its guard is disabled. The list and what each proves are recorded in the commit message." },
  { section: 40, name: "Offline engineering fixture", status: "tested", modules: [D_FIXTURE], callers: [PIPELINE], tests: [T_AUDIENCE, T_PLATFORM, T_PASS],
    note: "Every fixture is marked SYNTHETIC_ENGINEERING_FIXTURE and production ingestion refuses each by name. The fixtures demonstrate the whole chain and also carry the impossible inputs that must be refused." },
  { section: 41, name: "Real pipeline integration", status: "tested", modules: [D_PASS, D_LOOP], callers: [PIPELINE], tests: [T_LEDGER],
    note: "Stage 1e of the real offline pipeline runs the delivery pass, reports audience state and unknowns, platform snapshots and freshness, the fit verdict, invariants, briefs produced and platforms refused. Not a disconnected demo." },
  { section: 42, name: "Explainability", status: "tested", modules: [D_PASS, D_FIT], callers: [PIPELINE, D_PASS], tests: [T_PASS],
    note: "Every verdict carries named reasons, every Held value carries a basis, every difference names its causing fact and every refusal explains itself. There is no opaque score anywhere in MASTER #4." },
  { section: 43, name: "Auditability", status: "tested", modules: [D_BRIEF, D_PASS], callers: [PIPELINE], tests: [T_PASS],
    note: "Each brief records mission, research question, strategy run, audience profile id and revision, and platform snapshot id and revision. No module holds mutable global state; `now` is always an argument." },
  { section: 44, name: "Completion ledger", status: "tested", modules: ["v2/delivery/completionLedger.ts"], callers: [PIPELINE], tests: [T_LEDGER],
    note: "This file, validated against the real source tree: a section cannot claim `tested` unless its modules exist, a non-test caller imports them and a test file exists." },
  { section: 45, name: "Completion report", status: "tested", modules: ["v2/delivery/completionLedger.ts"], callers: [PIPELINE], tests: [T_LEDGER],
    note: "formatMaster4Ledger renders the status of all 45 sections, and the pipeline prints it." },
];

export function sectionsByStatus(status: SectionStatus): readonly SectionRecord[] {
  return MASTER4_LEDGER.filter((record) => record.status === status);
}

export function formatMaster4Ledger(records: readonly SectionRecord[] = MASTER4_LEDGER): string {
  const lines: string[] = ["MASTER #4 COMPLETION LEDGER"];
  for (const status of SECTION_STATUSES) {
    const group = records.filter((record) => record.status === status);
    if (group.length === 0) continue;
    lines.push(`  ${status.toUpperCase()} (${group.length})`);
    for (const record of group) {
      lines.push(`    ${record.section}. ${record.name}`);
    }
  }
  lines.push(`  TOTAL: ${records.length} sections`);
  return lines.join("\n");
}
