// MASTER #4 — Completion ledger (section 44).
//
// A truthful record of what is actually built, validated against the real
// source tree by completionLedger.test.ts. A section may not claim `tested`
// unless its modules exist, a non-test caller genuinely imports them, and a
// test file that exercises them exists.

export type SectionStatus =
  | "tested"
  | "partially-implemented"
  | "blocked-external"
  | "blocked-data"
  | "deferred";

export const SECTION_STATUSES: readonly SectionStatus[] = [
  "tested", "partially-implemented", "blocked-external", "blocked-data", "deferred",
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
    note: "Born untested, requires a falsification condition, a measurement requirement and a creative implication. No status maps to observed, and repeated use cannot promote one to fact." },
  { section: 4, name: "Language and question intelligence", status: "partially-implemented", modules: [A_LANG], callers: [A_PROFILE], tests: [T_AUDIENCE],
    note: "Observed phrases and generated paraphrases are different types with a one-way door: asObserved throws on a generated phrase. Intent, terminology, ambiguity and expertise classification are deterministic. No collector exists, so production currently has no observed phrases." },
  { section: 5, name: "Audience segmentation without fake personas", status: "tested", modules: [A_MODEL, A_PROFILE], callers: [D_PASS], tests: [T_AUDIENCE, T_PASS],
    note: "Segments derive from problem, intent, knowledge, readiness and risk. With no observed job or intent the list is empty rather than containing a general audience. A second segment requires a signal that saw a second population." },
  { section: 6, name: "Audience fit", status: "tested", modules: [A_PROFILE], callers: [D_PASS, D_FIT], tests: [T_PASS],
    note: "Four verdicts keep strategically useful for a logical audience distinct from observed audience demand. Evergreen content is not rejected merely for lacking analytics." },
  { section: 7, name: "Platform intelligence model", status: "tested", modules: [P_MODEL], callers: [P_REGISTRY, P_INGEST, D_FIT], tests: [T_PLATFORM],
    note: "Seven knowledge statuses separate stable constraints from current guidance, hypotheses and stale facts. Structural tests reject unsupported algorithmic ranking folklore." },
  { section: 8, name: "Platform fact provenance and freshness", status: "tested", modules: [P_MODEL, P_INGEST], callers: [D_FIT], tests: [T_PLATFORM],
    note: "Expiry is computed from category rather than trusted from the document. Volatile categories may not claim a binding status and anecdotes may not become binding constraints." },
  { section: 9, name: "Platform capability registry", status: "partially-implemented", modules: [P_REGISTRY], callers: [D_FIT, D_BRIEF], tests: [T_PLATFORM],
    note: "External platform capabilities are unknown in the baseline until a traceable platform source or direct platform observation establishes them. Local renderer behaviour is kept as SpecSmith-owned behaviour with no platform fact id; it no longer masquerades as evidence that an external platform accepts a format, duration, audio track, title, link or metric." },
  { section: 10, name: "Connected Metricool reality", status: "blocked-external", modules: [P_REGISTRY], callers: [D_FIT], tests: [T_PLATFORM],
    note: "The repository cannot call the ChatGPT/Metricool connector, and the REST transport stays inert without credentials. Publishing transport is recorded as manual-handoff, which is what actually exists. Ingestion contracts are ready for future connector output." },
  { section: 11, name: "Audience x Platform fit", status: "tested", modules: [D_FIT], callers: [D_PASS], tests: [T_PASS],
    note: "Five verdicts with named reasons and no opaque score. Unknown capability remains unknown and never becomes incompatibility. Absolute refusal requires an established incompatible constraint; conflicts carry an honest resolution without deleting evidence." },
  { section: 12, name: "Truth invariants", status: "tested", modules: [D_INVARIANTS], callers: [D_PASS, D_BRIEF, D_LOOP], tests: [T_INVARIANTS],
    note: "Once a line mentions an approved claim it inherits that claim's required wording. Dropping estimated or the required configuration from the fixture's 15 percent figure is a hard failure, as is upgrading an estimate into measurement language." },
  { section: 13, name: "Mission invariants", status: "tested", modules: [D_INVARIANTS], callers: [D_PASS], tests: [T_INVARIANTS],
    note: "Nine mission fields are frozen. Changing objective, angle, thesis, claims, forbidden list, required wording, product route, resource posture or hypothesis identity is a named hard failure." },
  { section: 14, name: "Platform creative brief", status: "tested", modules: [D_BRIEF], callers: [D_PASS, D_LOOP, PIPELINE], tests: [T_PASS],
    note: "Transport-independent contract carrying identity, invariants, audience, execution and uncertainty. Claims are copied from the mission, and every platform-specific metadata, CTA or duration choice may carry the exact source-bound platform fact that authorized it." },
  { section: 15, name: "Cross-platform package plan", status: "tested", modules: [D_CROSS], callers: [D_PASS], tests: [T_PASS],
    note: "A material cross-platform difference is emitted only when a brief carries the exact usable source fact that caused it. Fact ids are never synthesized from platform names. Unknowns produce uniform execution, and an untraceable difference fails closed." },
  { section: 16, name: "Hook adaptation", status: "partially-implemented", modules: [D_FIT], callers: [D_BRIEF], tests: [T_PASS],
    note: "Constraints only: the hook premise must be a permitted claim, manufactured urgency is forbidden, and an estimated figure keeps its label and required configuration. Which hook form performs best remains MASTER #1 creative judgment and later experimental evidence." },
  { section: 17, name: "Pacing intelligence", status: "partially-implemented", modules: [D_FIT], callers: [D_BRIEF], tests: [T_PASS],
    note: "Every pacing number is typed as a hypothesis and derived from explanation needs, not presented as a platform optimum. Nothing has been validated against real retention; MASTER #5 owns that experiment." },
  { section: 18, name: "Caption and readability intelligence", status: "tested", modules: [D_FIT], callers: [D_BRIEF], tests: [T_PASS],
    note: "Line length tightens for audiences needing explanation and reading speed is an explicit guideline, not a law. Burned-in captions are a SpecSmith-owned accessibility requirement because their rendered output can be inspected locally." },
  { section: 19, name: "Accessibility", status: "tested", modules: [D_FIT], callers: [D_BRIEF, D_LOOP], tests: [T_PASS],
    note: "Accessibility requirements are typed non-negotiable. Safe areas stay conservative while unmeasured, and a storyboard with no on-screen text layer fails the audio-independent comprehension check." },
  { section: 20, name: "CTA intelligence", status: "tested", modules: [D_FIT], callers: [D_BRIEF], tests: [T_PASS],
    note: "No shipped product route means no CTA. Unknown link behaviour produces a neutral on-screen route and does not become false. Description or profile placement is used only when a source-bound capability establishes that surface. No urgency or bait is introduced." },
  { section: 21, name: "Platform metadata intelligence", status: "tested", modules: [D_BRIEF, D_INVARIANTS], callers: [D_PASS], tests: [T_INVARIANTS, T_PASS],
    note: "Metadata runs through the same truth gate as script lines. Unknown title or description limits do not become hard-coded fallback limits. When a source-bound limit exists it is carried as adaptation evidence, and the caveat precedes marketing copy." },
  { section: 22, name: "Hashtag intelligence", status: "tested", modules: [D_BRIEF], callers: [D_PASS], tests: [T_PASS],
    note: "Every tag this repository can currently produce is generic-descriptive because no tag collector exists. None is marked observed, and popularity, reach or trend status is never asserted. The count cap is labelled a judgment rather than an optimum." },
  { section: 23, name: "Posting-time intelligence", status: "blocked-data", modules: [P_REGISTRY, P_INGEST], callers: [D_FIT], tests: [T_PLATFORM],
    note: "Always unknown without first-party account analytics. A third-party best-time claim is refused as account evidence, and posting time is excluded from the fit verdict rather than being guessed." },
  { section: 24, name: "Platform trend intelligence", status: "blocked-data", modules: [P_REGISTRY, P_INGEST], callers: [D_FIT], tests: [T_PLATFORM],
    note: "Always unknown without a scoped observation. A trend requires provenance and expiry; an anecdote is refused and an expired trend remains expired rather than being recycled." },
  { section: 25, name: "Audience/platform contradiction handling", status: "tested", modules: [D_FIT], callers: [D_PASS], tests: [T_PASS],
    note: "Depth-versus-duration, conflicting segments and estimate-label-versus-brevity carry named resolutions. A duration conflict is considered only when a real maximum is established, and deleting evidence is never an available resolution." },
  { section: 26, name: "Platform refusal", status: "tested", modules: [D_FIT, D_BRIEF], callers: [D_PASS], tests: [T_PASS],
    note: "Refusal is evidence-bound. Required wording refuses a platform only when it exceeds an established maximum duration; the removed 50 percent honesty-budget heuristic cannot block content. Unknown orientation or duration never becomes a refusal, and no degraded version is produced after a real refusal." },
  { section: 27, name: "Unknown as first-class state", status: "tested", modules: [A_MODEL, A_SIGNALS, P_MODEL, P_INGEST], callers: [A_PROFILE, D_FIT], tests: [T_AUDIENCE, T_PLATFORM],
    note: "Unknown never becomes zero, average, false, an industry assumption or a persona. readMetric returns unknown for an absent or null metric and preserves a genuine measured zero as zero." },
  { section: 28, name: "Platform guidance versioning", status: "tested", modules: [P_MODEL, P_INGEST], callers: [D_PASS], tests: [T_PLATFORM],
    note: "refreshSnapshot creates a new revision rather than mutating history. A brief records the exact platform snapshot id and revision so the decision can be reconstructed later." },
  { section: 29, name: "Audience snapshot versioning", status: "tested", modules: [A_MODEL, A_PROFILE], callers: [D_PASS, D_BRIEF], tests: [T_PASS],
    note: "Audience profiles are immutable and revisioned, and each brief records the exact profile id and revision used. Later evidence creates a newer profile rather than rewriting what was believed at decision time." },
  { section: 30, name: "Zero-cost core", status: "tested", modules: [D_PASS], callers: [PIPELINE], tests: [T_PASS, T_LEDGER],
    note: "assertZeroCostDelivery is called by the offline pipeline, and structural tests prove MASTER #4 contains no fetch call, environment-variable read or provider adapter import. The core adds no paid provider." },
  { section: 31, name: "Transport-independent ingestion", status: "tested", modules: [A_SIGNALS, P_INGEST], callers: [D_PASS], tests: [T_AUDIENCE, T_PLATFORM],
    note: "AUDIENCE_SIGNAL_RESULT and PLATFORM_GUIDANCE_RESULT use strict schemas, idempotent parsing, duplicate and malformed refusal, stale handling, unknown preservation and explicit synthetic provenance. Core reasoning is provider-independent." },
  { section: 32, name: "MASTER #1 handoff", status: "tested", modules: [D_LOOP], callers: [PIPELINE], tests: [T_PASS],
    note: "CreativeHandoff restates invariants at the top level, and assertCreativeHonoursBrief checks the produced storyboard across script and metadata. MASTER #4 supplies constraints and does not silently edit creative output." },
  { section: 33, name: "MASTER #2 handoff", status: "tested", modules: [D_INVARIANTS, D_LOOP], callers: [D_PASS, PIPELINE], tests: [T_INVARIANTS, T_PASS],
    note: "assertNoEvidenceUpgrade rejects promoting unsafe claims, resolving disputed ones without authority or asserting unseen claims. The closed loop runs MASTER #2's strict gate unchanged and does not filter its findings." },
  { section: 34, name: "MASTER #3 handoff", status: "tested", modules: [D_PASS, D_INVARIANTS], callers: [PIPELINE, D_BRIEF], tests: [T_PASS],
    note: "Typed escalations replace silent rewrites for strategy-level decisions such as conflicting segments, a genuinely uncarryable mission and commercial intent without audience grounding." },
  { section: 35, name: "MASTER #5 boundary", status: "deferred", modules: [D_LOOP], callers: [], tests: [T_PASS],
    note: "Hypotheses and falsification conditions are defined here; experiment assignment, performance judgment, winner selection and retention optimization remain intentionally deferred to MASTER #5." },
  { section: 36, name: "MASTER #6 boundary", status: "deferred", modules: [D_LOOP], callers: [], tests: [T_PASS],
    note: "Immutable audience and platform snapshots are emitted for a future memory layer. Long-term learning memory remains intentionally absent until MASTER #6." },
  { section: 37, name: "Executive boundary", status: "deferred", modules: [D_PASS, D_LOOP], callers: [], tests: [T_PASS],
    note: "Fit, constraints, conflicts, refusals, hypotheses, uncertainty and escalations are exposed as data for MASTER #8. MASTER #4 does not pretend to arbitrate the full system." },
  { section: 38, name: "Adversarial testing", status: "tested", modules: [D_INVARIANTS, A_SIGNALS, P_INGEST], callers: [D_PASS], tests: [T_INVARIANTS, T_AUDIENCE, T_PLATFORM, T_PASS],
    note: "Boundary attacks cover persona invention, demographic inference, zero-as-measurement, cross-platform leakage, estimate stripping, measurement upgrading, forbidden metadata, mission mutation, stale guidance, invented posting times, unknown-to-false coercion and source-less platform adaptation." },
  { section: 39, name: "Negative controls", status: "tested", modules: [A_MODEL, A_SIGNALS, P_INGEST, D_INVARIANTS, D_FIT, D_BRIEF], callers: [D_PASS], tests: [T_INVARIANTS, T_AUDIENCE, T_PLATFORM, T_PASS],
    note: "Negative controls exercise the load-bearing boundaries. The repaired regressions specifically prevent renderer-output-as-platform-evidence, floor-as-maximum semantics, the old 50 percent refusal heuristic and source-less creative differences." },
  { section: 40, name: "Offline engineering fixture", status: "tested", modules: [D_FIXTURE], callers: [PIPELINE], tests: [T_AUDIENCE, T_PLATFORM, T_PASS],
    note: "Engineering fixtures are explicitly synthetic and production ingestion refuses them. They demonstrate the full chain and carry adversarial inputs that should be rejected without fabricating real observations." },
  { section: 41, name: "Real pipeline integration", status: "tested", modules: [D_PASS, D_LOOP], callers: [PIPELINE], tests: [T_LEDGER],
    note: "Stage 1e of the real offline pipeline runs delivery, reports audience state and unknowns, platform snapshots, fit, invariants, briefs and refusals, and exercises the synthetic full chain. It is not a disconnected demo." },
  { section: 42, name: "Explainability", status: "tested", modules: [D_PASS, D_FIT], callers: [PIPELINE, D_PASS], tests: [T_PASS],
    note: "Every verdict carries named reasons and every Held value carries a basis. Cross-platform differences carry the exact source fact copied into the brief rather than a guessed identifier; untraceable differences fail closed. There is no opaque fit score." },
  { section: 43, name: "Auditability", status: "tested", modules: [D_BRIEF, D_PASS], callers: [PIPELINE], tests: [T_PASS],
    note: "Each brief records mission, research question, strategy run, audience profile id and revision, platform snapshot id and revision, plus exact source facts that caused platform-specific choices. No module depends on mutable global time." },
  { section: 44, name: "Completion ledger", status: "tested", modules: ["v2/delivery/completionLedger.ts"], callers: [PIPELINE], tests: [T_LEDGER],
    note: "This file is validated against the real source tree: a tested section must point at real modules, tests and callers that genuinely import those modules." },
  { section: 45, name: "Completion report", status: "tested", modules: ["v2/delivery/completionLedger.ts"], callers: [PIPELINE], tests: [T_LEDGER],
    note: "formatMaster4Ledger renders the status of all 45 sections and the offline pipeline prints it, so the completion report follows the same source-controlled ledger as the tests." },
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
    for (const record of group) lines.push(`    ${record.section}. ${record.name}`);
  }
  lines.push(`  TOTAL: ${records.length} sections`);
  return lines.join("\n");
}
