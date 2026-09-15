// The strategy object model.
//
// WHAT THIS LAYER IS FOR
// ----------------------
// MASTER #2 decides what SpecSmith may truthfully SAY. This layer decides what
// SpecSmith should BOTHER saying, why, why now, and — the part that makes it a
// strategy system rather than a topic generator — when the right answer is to
// produce nothing.
//
// The chain is kept apart at the type level for the same reason the research
// chain is:
//
//   OBSERVATION -> OPPORTUNITY -> STRATEGIC HYPOTHESIS -> OBJECTIVE
//               -> ANGLE -> CONTENT MISSION -> PRIORITY -> EXECUTE or HOLD
//
// An "opportunity" is a claim that a chance exists. A "hypothesis" is a guess
// about mechanism. A "mission" is an instruction to produce. Collapsing them
// into one `{ topic, score }` is how a strategy system becomes a random idea
// generator with a number attached.
//
// WHY UNKNOWN IS A VALUE HERE, NOT A MISSING FIELD
// ------------------------------------------------
// Almost every signal this layer would like — search demand, trend direction,
// competitor coverage, audience size — is genuinely unavailable in this
// repository today. A boolean defaulting to false would silently assert "not
// trending" and "no competition", which are claims nobody has evidence for.
// Every such dimension is therefore an enum that includes `unknown`, and
// `unknown` is never treated as a low score: it is treated as a gap.

import type { ClaimKind, EpistemicState } from "../research/model.ts";

/** What a piece of content is FOR. Objectives are not interchangeable. */
export type StrategicObjective =
  | "acquire-new-users"
  | "qualified-site-visits"
  | "grow-branded-search"
  | "category-association"
  | "drive-builder-usage"
  | "drive-fps-estimator-usage"
  | "drive-upgrade-tool-usage"
  | "educate-new-builders"
  | "earn-citations"
  | "shareable-comparison"
  | "returning-user-behaviour"
  | "affiliate-intent-traffic"
  | "build-trust-authority"
  | "explain-product-capability"
  | "answer-active-confusion"
  | "answer-emerging-question"
  | "support-feature-launch"
  | "community-participation"
  | "build-owned-audience"
  | "improve-social-to-site"
  | "defend-against-misinformation"
  | "validate-product-direction";

export const STRATEGIC_OBJECTIVES: readonly StrategicObjective[] = [
  "acquire-new-users", "qualified-site-visits", "grow-branded-search",
  "category-association", "drive-builder-usage", "drive-fps-estimator-usage",
  "drive-upgrade-tool-usage", "educate-new-builders", "earn-citations",
  "shareable-comparison", "returning-user-behaviour", "affiliate-intent-traffic",
  "build-trust-authority", "explain-product-capability", "answer-active-confusion",
  "answer-emerging-question", "support-feature-launch", "community-participation",
  "build-owned-audience", "improve-social-to-site", "defend-against-misinformation",
  "validate-product-direction",
];

/**
 * How an objective is measured, and whether SpecSmith can measure it TODAY.
 *
 * This is the field that stops the strategy layer optimising for something
 * nobody can observe. An objective measured only by `analytics-unavailable`
 * cannot be the basis of a confident bet, and the priority model says so rather
 * than quietly scoring it as though the number existed.
 */
export type ObjectiveMeasurability =
  /** Observable in SpecSmith's own durable state today. */
  | "first-party-available"
  /** Needs published analytics, which do not exist yet. */
  | "analytics-unavailable"
  /** Needs a search console or similar that is not connected. */
  | "search-data-unavailable"
  /** Only a human can judge it. */
  | "human-judgment-only";

export interface ObjectiveProfile {
  readonly objective: StrategicObjective;
  readonly measurability: ObjectiveMeasurability;
  /** How long before this objective could plausibly show movement. */
  readonly horizon: "immediate" | "weeks" | "months" | "long-term";
  /** Objectives that pull against this one. Recorded, never averaged away. */
  readonly tensions: readonly StrategicObjective[];
  readonly why: string;
}

/**
 * The objective registry.
 *
 * `tensions` is the load-bearing column. Reach and qualified traffic genuinely
 * fight each other: a meme reaches everyone and converts nobody, and a
 * compatibility deep-dive converts well and reaches few. A strategy layer that
 * blends both into one number cannot express that, and will keep recommending
 * the meme.
 */
export const OBJECTIVE_PROFILES: readonly ObjectiveProfile[] = [
  { objective: "acquire-new-users", measurability: "analytics-unavailable", horizon: "weeks",
    tensions: ["build-trust-authority", "affiliate-intent-traffic"],
    why: "Reach-led acquisition favours broad, simple content, which is often the content that demonstrates least about the product." },
  { objective: "qualified-site-visits", measurability: "analytics-unavailable", horizon: "weeks",
    tensions: ["acquire-new-users"],
    why: "Qualification narrows the audience by design; it trades reach for intent." },
  { objective: "grow-branded-search", measurability: "search-data-unavailable", horizon: "months",
    tensions: [], why: "Branded search grows from repeated recognisable value, not from any single piece." },
  { objective: "category-association", measurability: "human-judgment-only", horizon: "long-term",
    tensions: ["affiliate-intent-traffic"],
    why: "What SpecSmith is known for is a perception, and perception is not measurable from this repository." },
  { objective: "drive-builder-usage", measurability: "first-party-available", horizon: "immediate",
    tensions: ["acquire-new-users"], why: "Tool usage is observable in SpecSmith's own routes." },
  { objective: "drive-fps-estimator-usage", measurability: "first-party-available", horizon: "immediate",
    tensions: [], why: "Same: a SpecSmith surface SpecSmith can see." },
  { objective: "drive-upgrade-tool-usage", measurability: "first-party-available", horizon: "immediate",
    tensions: [], why: "Same." },
  { objective: "educate-new-builders", measurability: "human-judgment-only", horizon: "weeks",
    tensions: ["affiliate-intent-traffic"],
    why: "Teaching well often means telling someone not to buy yet." },
  { objective: "earn-citations", measurability: "search-data-unavailable", horizon: "long-term",
    tensions: ["acquire-new-users"], why: "Citable content is usually rigorous rather than broad." },
  { objective: "shareable-comparison", measurability: "analytics-unavailable", horizon: "immediate",
    tensions: ["build-trust-authority"],
    why: "Shareability rewards a clean verdict; trust rewards admitting what is uncertain." },
  { objective: "returning-user-behaviour", measurability: "analytics-unavailable", horizon: "months",
    tensions: [], why: "Return behaviour needs a published history to observe." },
  { objective: "affiliate-intent-traffic", measurability: "first-party-available", horizon: "immediate",
    tensions: ["build-trust-authority", "educate-new-builders", "category-association"],
    why: "Commercial intent pulls directly against disinterested advice. This tension is never allowed to resolve in favour of commission." },
  { objective: "build-trust-authority", measurability: "human-judgment-only", horizon: "long-term",
    tensions: ["acquire-new-users", "affiliate-intent-traffic", "shareable-comparison"],
    why: "Trust is built by restraint, which costs reach in the short term." },
  { objective: "explain-product-capability", measurability: "first-party-available", horizon: "immediate",
    tensions: [], why: "Demonstrable against the real product surface." },
  { objective: "answer-active-confusion", measurability: "human-judgment-only", horizon: "immediate",
    tensions: [], why: "Requires evidence that the confusion is actually expressed." },
  { objective: "answer-emerging-question", measurability: "search-data-unavailable", horizon: "immediate",
    tensions: [], why: "Emergence is a claim about change over time and needs a time series." },
  { objective: "support-feature-launch", measurability: "first-party-available", horizon: "immediate",
    tensions: [], why: "Tied to a real shipped feature, or it is not a launch." },
  { objective: "community-participation", measurability: "analytics-unavailable", horizon: "months",
    tensions: [], why: "Needs a community to observe." },
  { objective: "build-owned-audience", measurability: "analytics-unavailable", horizon: "long-term",
    tensions: ["acquire-new-users"], why: "Owned audience grows slower than reach and is worth more." },
  { objective: "improve-social-to-site", measurability: "analytics-unavailable", horizon: "weeks",
    tensions: ["acquire-new-users"], why: "Needs published funnel data." },
  { objective: "defend-against-misinformation", measurability: "human-judgment-only", horizon: "immediate",
    tensions: [], why: "Requires evidence the misinformation is actually circulating." },
  { objective: "validate-product-direction", measurability: "human-judgment-only", horizon: "months",
    tensions: [], why: "A research objective dressed as content; its output is a decision, not traffic." },
];

const OBJECTIVE_INDEX = new Map(OBJECTIVE_PROFILES.map((profile) => [profile.objective, profile]));

export function objectiveProfile(objective: StrategicObjective): ObjectiveProfile {
  const profile = OBJECTIVE_INDEX.get(objective);
  if (!profile) throw new Error(`No profile for objective ${objective}; every objective must declare its measurability and tensions.`);
  return profile;
}

/** A durable subject area SpecSmith publishes in. */
export type ContentPillarId =
  | "pc-building-education"
  | "upgrade-decisions"
  | "gpu-comparisons"
  | "cpu-comparisons"
  | "price-availability-interpretation"
  | "bottleneck-myths"
  | "fps-expectations"
  | "compatibility"
  | "cooling-airflow"
  | "beginner-mistakes"
  | "value-traps"
  | "hardware-myths"
  | "new-hardware-launches"
  | "blind-comparisons"
  | "settings-optimization"
  | "tool-demonstrations"
  | "benchmark-transparency"
  | "specsmith-methodology"
  | "hardware-terminology"
  | "monitor-peripheral-matching";

export interface ContentPillar {
  readonly id: ContentPillarId;
  readonly name: string;
  /** Which objectives this pillar can genuinely serve. */
  readonly serves: readonly StrategicObjective[];
  /** The kinds of claim this pillar inevitably makes. Drives evidence demands. */
  readonly claimKinds: readonly ClaimKind[];
  /** How fast content in this pillar goes out of date. */
  readonly freshnessSensitivity: "volatile" | "seasonal" | "slow" | "evergreen";
  /** Which SpecSmith surface, if any, this pillar naturally demonstrates. */
  readonly productSurface: string | null;
  /** Assumed audience knowledge, so beginner clarity can be reasoned about. */
  readonly audienceLevel: "beginner" | "mixed" | "advanced";
  /** Standing risks of publishing in this pillar at all. */
  readonly inherentRisks: readonly string[];
  /** Can this pillar sustain a recurring series, or does it exhaust quickly? */
  readonly repeatability: "high" | "medium" | "low";
  readonly note: string;
}

/**
 * The pillar registry.
 *
 * `claimKinds` is what ties this layer to MASTER #2: a pillar that inevitably
 * makes `current-price` claims inherits that claim kind's evidence bar, so an
 * opportunity in that pillar cannot be approved on stale pricing however
 * attractive it looks. The pillar does not get to opt out.
 */
export const CONTENT_PILLARS: readonly ContentPillar[] = [
  { id: "pc-building-education", name: "PC building education",
    serves: ["educate-new-builders", "build-trust-authority", "acquire-new-users", "category-association"],
    claimKinds: ["compatibility", "specification"], freshnessSensitivity: "evergreen",
    productSurface: "builder", audienceLevel: "beginner", inherentRisks: ["oversimplification"],
    repeatability: "high", note: "The pillar with the longest shelf life and the weakest urgency. Almost never time-sensitive." },
  { id: "upgrade-decisions", name: "Upgrade decisions",
    serves: ["drive-upgrade-tool-usage", "qualified-site-visits", "answer-active-confusion"],
    claimKinds: ["comparison", "performance-estimated", "compatibility"], freshnessSensitivity: "slow",
    productSurface: "upgrade", audienceLevel: "mixed", inherentRisks: ["misleading-buyer-advice"],
    repeatability: "high", note: "High product fit: the question a viewer asks is literally what the tool answers." },
  { id: "gpu-comparisons", name: "GPU comparisons",
    serves: ["shareable-comparison", "qualified-site-visits", "drive-fps-estimator-usage"],
    claimKinds: ["comparison", "performance-measured"], freshnessSensitivity: "slow",
    productSurface: "compare", audienceLevel: "mixed",
    inherentRisks: ["overclaim", "benchmark-configuration-mismatch"], repeatability: "high",
    note: "Highest saturation risk in the portfolio: easy to make, easy to make too many of." },
  { id: "cpu-comparisons", name: "CPU comparisons",
    serves: ["shareable-comparison", "qualified-site-visits"],
    claimKinds: ["comparison", "performance-measured"], freshnessSensitivity: "slow",
    productSurface: "compare", audienceLevel: "mixed", inherentRisks: ["overclaim"], repeatability: "high",
    note: "Structurally similar to GPU comparisons and usually under-served relative to them." },
  { id: "price-availability-interpretation", name: "Price and availability interpretation",
    serves: ["affiliate-intent-traffic", "answer-active-confusion", "qualified-site-visits"],
    claimKinds: ["current-price", "availability"], freshnessSensitivity: "volatile",
    productSurface: "parts-catalog", audienceLevel: "mixed",
    inherentRisks: ["stale-pricing", "commercial-bias", "misleading-buyer-advice"], repeatability: "medium",
    note: "The most dangerous pillar. Every claim in it decays within hours and every one of them can cost a viewer money." },
  { id: "bottleneck-myths", name: "Bottleneck myths",
    serves: ["educate-new-builders", "defend-against-misinformation", "build-trust-authority"],
    claimKinds: ["misconception-exists", "performance-estimated", "compatibility"],
    freshnessSensitivity: "evergreen", productSurface: "builder", audienceLevel: "beginner",
    inherentRisks: ["manufacturing-a-myth-nobody-holds"], repeatability: "medium",
    note: "Requires evidence the misconception is actually expressed, or it is a myth SpecSmith invented to correct." },
  { id: "fps-expectations", name: "FPS expectations",
    serves: ["drive-fps-estimator-usage", "educate-new-builders", "qualified-site-visits"],
    claimKinds: ["performance-estimated", "performance-measured"], freshnessSensitivity: "slow",
    productSurface: "builder", audienceLevel: "beginner",
    inherentRisks: ["estimate-presented-as-measurement"], repeatability: "high",
    note: "SpecSmith's estimates are its own first-party output, which is a genuine differentiator here." },
  { id: "compatibility", name: "Compatibility",
    serves: ["educate-new-builders", "drive-builder-usage", "build-trust-authority"],
    claimKinds: ["compatibility", "specification"], freshnessSensitivity: "evergreen",
    productSurface: "builder", audienceLevel: "beginner", inherentRisks: ["incorrect-fitment-advice"],
    repeatability: "high", note: "Deterministic, checkable, and exactly what the builder enforces." },
  { id: "cooling-airflow", name: "Cooling and airflow",
    serves: ["educate-new-builders", "build-trust-authority"], claimKinds: ["specification", "performance-measured"],
    freshnessSensitivity: "evergreen", productSurface: null, audienceLevel: "mixed",
    inherentRisks: ["thermal-safety-advice"], repeatability: "medium",
    note: "No product surface yet, so content here cannot be product-led." },
  { id: "beginner-mistakes", name: "Beginner mistakes",
    serves: ["educate-new-builders", "acquire-new-users", "build-trust-authority"],
    claimKinds: ["compatibility", "misconception-exists"], freshnessSensitivity: "evergreen",
    productSurface: "builder", audienceLevel: "beginner", inherentRisks: ["condescension"],
    repeatability: "high", note: "Strong reach and strong education at once, which is rare." },
  { id: "value-traps", name: "Value traps",
    serves: ["build-trust-authority", "educate-new-builders", "defend-against-misinformation"],
    claimKinds: ["comparison", "current-price", "recommendation"], freshnessSensitivity: "volatile",
    productSurface: "compare", audienceLevel: "mixed",
    inherentRisks: ["stale-pricing", "misleading-buyer-advice"], repeatability: "medium",
    note: "Trust-building, but it inherits the price pillar's volatility because a trap is usually a price claim." },
  { id: "hardware-myths", name: "Hardware myths",
    serves: ["defend-against-misinformation", "educate-new-builders"],
    claimKinds: ["misconception-exists", "specification"], freshnessSensitivity: "evergreen",
    productSurface: null, audienceLevel: "mixed", inherentRisks: ["manufacturing-a-myth-nobody-holds"],
    repeatability: "medium", note: "Same evidence requirement as bottleneck myths." },
  { id: "new-hardware-launches", name: "New hardware launches",
    serves: ["acquire-new-users", "answer-emerging-question", "shareable-comparison"],
    claimKinds: ["specification", "current-price", "performance-measured"], freshnessSensitivity: "volatile",
    productSurface: "compare", audienceLevel: "mixed",
    inherentRisks: ["speculation", "overclaim", "stale-pricing"], repeatability: "low",
    note: "The only pillar where genuine urgency is normal — and the one where evidence is thinnest at exactly the moment it is most wanted." },
  { id: "blind-comparisons", name: "Blind comparisons",
    serves: ["shareable-comparison", "drive-fps-estimator-usage", "acquire-new-users"],
    claimKinds: ["comparison", "performance-estimated"], freshnessSensitivity: "slow",
    productSurface: "compare", audienceLevel: "mixed", inherentRisks: ["overclaim"], repeatability: "high",
    note: "SpecSmith's signature format. Because it hides product names, its claims are unusually easy to assert without naming a subject." },
  { id: "settings-optimization", name: "Settings optimization",
    serves: ["educate-new-builders", "qualified-site-visits"], claimKinds: ["performance-measured", "performance-estimated"],
    freshnessSensitivity: "slow", productSurface: null, audienceLevel: "mixed",
    inherentRisks: ["game-version-drift"], repeatability: "high",
    note: "Highly version-sensitive: a patch invalidates the advice without changing the calendar." },
  { id: "tool-demonstrations", name: "Tool demonstrations",
    serves: ["explain-product-capability", "drive-builder-usage", "drive-upgrade-tool-usage", "improve-social-to-site"],
    claimKinds: ["specsmith-product"], freshnessSensitivity: "slow", productSurface: "builder",
    audienceLevel: "mixed", inherentRisks: ["promising-unbuilt-features"], repeatability: "medium",
    note: "The lowest-evidence-risk pillar, because the claims are about SpecSmith's own deterministic behaviour." },
  { id: "benchmark-transparency", name: "Benchmark transparency",
    serves: ["build-trust-authority", "earn-citations", "category-association"],
    claimKinds: ["performance-measured", "specsmith-product"], freshnessSensitivity: "slow",
    productSurface: null, audienceLevel: "advanced", inherentRisks: ["complexity"], repeatability: "low",
    note: "Serves authority rather than reach, and needs first-party measurement to be worth making." },
  { id: "specsmith-methodology", name: "SpecSmith methodology",
    serves: ["build-trust-authority", "category-association", "explain-product-capability"],
    claimKinds: ["specsmith-product"], freshnessSensitivity: "slow", productSurface: null,
    audienceLevel: "advanced", inherentRisks: ["navel-gazing"], repeatability: "low",
    note: "Only interesting once there is an audience who already cares." },
  { id: "hardware-terminology", name: "Hardware terminology",
    serves: ["educate-new-builders", "acquire-new-users"], claimKinds: ["specification"],
    freshnessSensitivity: "evergreen", productSurface: "builder", audienceLevel: "beginner",
    inherentRisks: ["oversimplification"], repeatability: "high",
    note: "Cheapest to evidence of any pillar: a manufacturer specification answers it outright." },
  { id: "monitor-peripheral-matching", name: "Monitor and peripheral matching",
    serves: ["educate-new-builders", "qualified-site-visits"], claimKinds: ["specification", "compatibility"],
    freshnessSensitivity: "slow", productSurface: null, audienceLevel: "mixed",
    inherentRisks: ["out-of-scope-for-specsmith"], repeatability: "medium",
    note: "Adjacent to SpecSmith's actual product; easy to drift into generic tech content here." },
];

const PILLAR_INDEX = new Map(CONTENT_PILLARS.map((pillar) => [pillar.id, pillar]));

export function contentPillar(id: ContentPillarId): ContentPillar {
  const pillar = PILLAR_INDEX.get(id);
  if (!pillar) throw new Error(`Unknown content pillar ${id}.`);
  return pillar;
}

/** What KIND of chance this is. Different classes decay differently. */
export type OpportunityType =
  | "evergreen-education"
  | "breaking-time-sensitive"
  | "emerging-question"
  | "launch-event"
  | "search-gap"
  | "community-pain"
  | "myth-correction"
  | "competitor-whitespace"
  | "product-led"
  | "product-feature-education"
  | "conversion"
  | "authority"
  | "comparison"
  | "dispute-explanation"
  | "seasonal"
  | "recurring"
  | "retention"
  | "community-creator"
  | "experimentation"
  | "portfolio-gap";

export const OPPORTUNITY_TYPES: readonly OpportunityType[] = [
  "evergreen-education", "breaking-time-sensitive", "emerging-question", "launch-event",
  "search-gap", "community-pain", "myth-correction", "competitor-whitespace", "product-led",
  "product-feature-education", "conversion", "authority", "comparison", "dispute-explanation",
  "seasonal", "recurring", "retention", "community-creator", "experimentation", "portfolio-gap",
];

/**
 * Why this is worth doing NOW rather than ever.
 *
 * `unknown` and `insufficient-evidence` are distinct from `evergreen`. Evergreen
 * means timing genuinely does not matter. Unknown means nobody looked. Treating
 * the second as the first is how a strategy layer starts calling things
 * "trending".
 */
export type WhyNowState =
  | "time-sensitive"
  | "recently-emerging"
  | "evergreen"
  | "temporarily-relevant"
  | "recurring-seasonal"
  | "not-actually-urgent"
  | "unknown"
  | "insufficient-evidence";

/** Every externally-sourced signal is one of these, and `unknown` is normal. */
export type TrendState = "rising" | "stable" | "falling" | "unknown";
export type SearchDemandState = "high" | "moderate" | "low" | "unknown";
export type CompetitorCoverageState = "crowded" | "whitespace" | "mixed" | "unknown";
export type CommunityPainState = "widespread" | "occasional" | "rare" | "unknown";

/** Whether a SpecSmith surface can actually back the content up. */
export type ProductReadiness =
  /** Shipped, reachable, and does what the content would claim. */
  | "shipped"
  /** Exists but not good enough to point an audience at. */
  | "partial"
  /** Named in a roadmap. Content may not promise it. */
  | "planned"
  /** No such surface. */
  | "absent";

/** How much a mission would cost to produce, in the only currency available. */
export type ResourcePosture =
  /** Producible entirely with local free tooling. The default and the target. */
  | "local-free"
  /** Helped by a free-tier external call, but not dependent on one. */
  | "free-tier-helpful"
  /** Consumes a metered free quota. */
  | "quota-consuming"
  /** A paid service would improve it but is not required. */
  | "optional-premium"
  /** Cannot be produced without paid access. Never approvable. */
  | "blocked-without-paid"
  /** Cannot be produced because something outside the repo is missing. */
  | "blocked-external";

/** Postures that may never reach an approved mission at $0. */
export const NON_FREE_POSTURES: readonly ResourcePosture[] = ["blocked-without-paid"];

/** A risk, and whether it is fatal. */
export type StrategicRiskCode =
  | "evidence-insufficient"
  | "evidence-stale"
  | "evidence-disputed"
  | "misleading-buyer-advice"
  | "commercial-bias"
  | "overclaim"
  | "product-mismatch"
  | "product-not-ready"
  | "manufactured-urgency"
  | "manufactured-demand"
  | "duplicate-of-recent"
  | "cannibalises-existing"
  | "platform-policy"
  | "rights"
  | "complexity"
  | "low-strategic-relevance"
  | "excessive-production-cost"
  | "depends-on-unavailable-capability"
  | "synthetic-evidence";

export interface StrategicRisk {
  readonly code: StrategicRiskCode;
  /** A blocking risk vetoes the opportunity regardless of its upside. */
  readonly blocking: boolean;
  readonly detail: string;
}

/**
 * Risks that veto an opportunity outright.
 *
 * This list is what makes the priority model something other than a weighted
 * average. A veto cannot be outscored: an opportunity resting on a disputed
 * claim is not redeemed by being timely and product-relevant, because the thing
 * it would say is not established.
 */
export const BLOCKING_RISKS: readonly StrategicRiskCode[] = [
  "evidence-insufficient", "evidence-stale", "evidence-disputed", "synthetic-evidence",
  "product-not-ready", "misleading-buyer-advice", "manufactured-urgency",
  "manufactured-demand", "depends-on-unavailable-capability", "rights",
];

/** Interpretable confidence, per facet, with the reason attached. */
export type ConfidenceLevel = "high" | "moderate" | "low" | "insufficient";

export interface StrategyConfidence {
  /** Is there really a chance here at all? */
  readonly opportunityExists: ConfidenceLevel;
  /** Is now the right time? */
  readonly timing: ConfidenceLevel;
  /** Does an audience actually need this? */
  readonly audienceNeed: ConfidenceLevel;
  /** Would the proposed mechanism actually produce the objective? */
  readonly mechanism: ConfidenceLevel;
  /** Is the factual basis sound? Comes from MASTER #2, never invented here. */
  readonly evidence: ConfidenceLevel;
  /** Can this actually be made with what exists? */
  readonly creativeFeasibility: ConfidenceLevel;
  readonly reasons: readonly string[];
}

/** Provenance, carried so a fixture can never become production strategy. */
export interface StrategyProvenance {
  readonly synthetic: boolean;
  readonly producedBy: string;
  readonly producedAt: string;
}

/** Where a strategic signal came from, and whether it is real. */
export interface SignalOrigin {
  readonly signalId: string;
  readonly kind:
    | "research-result"
    | "search-console"
    | "social-analytics"
    | "community-observation"
    | "product-state"
    | "first-party-usage"
    | "portfolio-history"
    | "operator-assertion";
  /** The MASTER #2 snapshot or other artifact this rests on. */
  readonly sourceRef: string;
  readonly observedAt: string;
  readonly provenance: StrategyProvenance;
}

/** The recommendation. Producing nothing is a first-class answer. */
export type StrategicAction =
  | "produce-now"
  | "produce-next"
  | "backlog-evergreen"
  | "hold-for-evidence"
  | "hold-for-product"
  | "hold-for-event"
  | "reject-duplicate"
  | "reject-low-relevance"
  | "reject-risk"
  | "retire-stale";

/** Actions that authorise production. Everything else is a hold or a refusal. */
export const PRODUCING_ACTIONS: readonly StrategicAction[] = ["produce-now", "produce-next"];

/**
 * One strategic opportunity, immutable once created.
 *
 * Deliberately verbose. Every field here is something a later reviewer would
 * otherwise have to reconstruct from nothing when asking "why did the Content OS
 * decide to make this video?", and MASTER #8 cannot arbitrate between
 * opportunities it cannot inspect.
 */
export interface StrategicOpportunity {
  readonly opportunityId: string;
  /** Bumped rather than mutated when strategy changes its mind. */
  readonly version: number;
  readonly detectedAt: string;
  readonly origins: readonly SignalOrigin[];

  readonly type: OpportunityType;
  readonly pillar: ContentPillarId;
  /** The user's problem, in the user's terms. */
  readonly problem: string;
  /** What the viewer is assumed to already know. */
  readonly audienceLevel: ContentPillar["audienceLevel"];

  readonly primaryObjective: StrategicObjective;
  readonly secondaryObjectives: readonly StrategicObjective[];

  /** The research claims this opportunity would need to make. */
  readonly dependsOnClaimIds: readonly string[];
  /** MASTER #2's verdict on those claims, copied not re-derived. */
  readonly evidenceState: EpistemicState;

  readonly whyNow: WhyNowState;
  readonly whyNowReason: string;
  readonly trend: TrendState;
  readonly searchDemand: SearchDemandState;
  readonly competitorCoverage: CompetitorCoverageState;
  readonly communityPain: CommunityPainState;

  readonly productSurface: string | null;
  readonly productReadiness: ProductReadiness;

  /** Time bounds. A time-sensitive opportunity that never expires is a bug. */
  readonly bestBefore: string | null;
  readonly expiresAt: string | null;
  readonly lastValidatedAt: string;

  readonly resourcePosture: ResourcePosture;
  readonly risks: readonly StrategicRisk[];
  readonly confidence: StrategyConfidence;
  readonly provenance: StrategyProvenance;
  /** The opportunity this one supersedes or continues, if any. */
  readonly parentOpportunityId: string | null;
}
