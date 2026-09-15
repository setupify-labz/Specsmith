// Turning research state and signals into strategic opportunities.
//
// WHERE OPPORTUNITIES COME FROM
// -----------------------------
// Only from real inputs: a MASTER #2 research result, a signal bundle, and the
// product's actual state. There is no "generate 20 topic ideas" path in the
// production route — §17 of the brief forbids it, and it is also where a content
// system stops being strategic and starts being a feed.
//
// A research result is a rich source of opportunity precisely because it records
// what it could NOT establish. An unsafe claim is not a dead end; it is either a
// research gap worth closing or a topic worth dropping, and which of those it is
// depends on how much the audience cares. Both are strategic facts.
//
// WHY DECAY IS PER CLASS
// ----------------------
// A launch opportunity is worthless in three weeks. "What does VRAM do?" is as
// good next year as today. One decay curve for both would either expire the
// evergreen library or leave a stale launch sitting at the top of the queue
// forever, and the second is the one that gets someone to publish yesterday's
// news as today's.

import { createHash } from "node:crypto";

import type { AtomicClaim, EpistemicState } from "../research/model.ts";
import type { ResearchResult } from "../research/researchPass.ts";
import {
  BLOCKING_RISKS,
  contentPillar,
  type ContentPillarId,
  type OpportunityType,
  type ProductReadiness,
  type ResourcePosture,
  type SignalOrigin,
  type StrategicObjective,
  type StrategicOpportunity,
  type StrategicRisk,
  type StrategyConfidence,
  type StrategyProvenance,
  type WhyNowState,
} from "./model.ts";
import {
  communityPainFor,
  competitorCoverageFor,
  productReadinessFor,
  searchDemandFor,
  signalOrigin,
  trendFor,
  type SignalBundle,
} from "./signals.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * How long an opportunity of each class stays worth acting on.
 *
 * `null` means it does not expire by the calendar — but note that even an
 * evergreen opportunity carries a `lastValidatedAt`, because the EVIDENCE under
 * it can go stale even when the audience question does not.
 */
interface DecayRule {
  readonly bestBeforeMs: number | null;
  readonly expiresAfterMs: number | null;
  /** Whether this class is allowed to claim urgency at all. */
  readonly mayClaimUrgency: boolean;
  readonly why: string;
}

const DECAY_RULES: Record<OpportunityType, DecayRule> = {
  "breaking-time-sensitive": { bestBeforeMs: 2 * DAY, expiresAfterMs: 7 * DAY, mayClaimUrgency: true,
    why: "Breaking relevance is measured in days; a week later the audience has moved on and the take reads as late." },
  "launch-event": { bestBeforeMs: 7 * DAY, expiresAfterMs: 30 * DAY, mayClaimUrgency: true,
    why: "Launch interest has a real peak and a real tail, both short." },
  "emerging-question": { bestBeforeMs: 21 * DAY, expiresAfterMs: 90 * DAY, mayClaimUrgency: true,
    why: "A question that is emerging either becomes established or fades; either way the emergence framing expires." },
  "dispute-explanation": { bestBeforeMs: 30 * DAY, expiresAfterMs: 120 * DAY, mayClaimUrgency: true,
    why: "A live disagreement is interesting while it is live." },
  seasonal: { bestBeforeMs: 30 * DAY, expiresAfterMs: 120 * DAY, mayClaimUrgency: true,
    why: "A seasonal window opens and closes on the calendar." },
  "search-gap": { bestBeforeMs: 90 * DAY, expiresAfterMs: 365 * DAY, mayClaimUrgency: false,
    why: "A gap in coverage persists until someone fills it, which is slow." },
  "competitor-whitespace": { bestBeforeMs: 90 * DAY, expiresAfterMs: 365 * DAY, mayClaimUrgency: false,
    why: "Whitespace closes when a competitor publishes, not on a schedule." },
  conversion: { bestBeforeMs: 90 * DAY, expiresAfterMs: null, mayClaimUrgency: false,
    why: "A conversion opportunity lasts as long as the product surface does." },
  "product-led": { bestBeforeMs: null, expiresAfterMs: null, mayClaimUrgency: false,
    why: "Tied to the product rather than to the news cycle." },
  "product-feature-education": { bestBeforeMs: null, expiresAfterMs: null, mayClaimUrgency: false,
    why: "Explaining what a shipped feature does does not go out of date until the feature changes." },
  "community-pain": { bestBeforeMs: 180 * DAY, expiresAfterMs: null, mayClaimUrgency: false,
    why: "Pain persists; the evidence that it is current is what ages." },
  "myth-correction": { bestBeforeMs: null, expiresAfterMs: null, mayClaimUrgency: false,
    why: "Misconceptions are remarkably durable." },
  "evergreen-education": { bestBeforeMs: null, expiresAfterMs: null, mayClaimUrgency: false,
    why: "The definition of the class: timing does not matter." },
  comparison: { bestBeforeMs: 180 * DAY, expiresAfterMs: null, mayClaimUrgency: false,
    why: "A comparison ages with its underlying measurements rather than with interest." },
  authority: { bestBeforeMs: null, expiresAfterMs: null, mayClaimUrgency: false,
    why: "Authority compounds slowly and does not expire." },
  recurring: { bestBeforeMs: null, expiresAfterMs: null, mayClaimUrgency: false,
    why: "A recurring format is a commitment, not a window." },
  retention: { bestBeforeMs: null, expiresAfterMs: null, mayClaimUrgency: false,
    why: "Depends on an audience existing, not on timing." },
  "community-creator": { bestBeforeMs: 90 * DAY, expiresAfterMs: null, mayClaimUrgency: false,
    why: "Tied to a collaboration rather than to news." },
  experimentation: { bestBeforeMs: null, expiresAfterMs: null, mayClaimUrgency: false,
    why: "An experiment is worth running whenever there is capacity to learn from it." },
  "portfolio-gap": { bestBeforeMs: null, expiresAfterMs: null, mayClaimUrgency: false,
    why: "A gap in the portfolio stays a gap until it is filled." },
};

export function decayRuleFor(type: OpportunityType): DecayRule {
  return DECAY_RULES[type];
}

/** Whether an opportunity has aged out, evaluated at an explicit time. */
export function opportunityFreshness(
  opportunity: StrategicOpportunity,
  now: Date,
): { readonly status: "current" | "past-best-before" | "expired" | "timeless"; readonly reason: string } {
  const rule = DECAY_RULES[opportunity.type];
  if (rule.bestBeforeMs === null && rule.expiresAfterMs === null) {
    return { status: "timeless", reason: rule.why };
  }
  const nowMs = now.getTime();
  if (opportunity.expiresAt !== null && nowMs > Date.parse(opportunity.expiresAt)) {
    return { status: "expired", reason: `Expired at ${opportunity.expiresAt}. ${rule.why}` };
  }
  if (opportunity.bestBefore !== null && nowMs > Date.parse(opportunity.bestBefore)) {
    return { status: "past-best-before", reason: `Past its best-before of ${opportunity.bestBefore}. ${rule.why}` };
  }
  return { status: "current", reason: rule.why };
}

/**
 * Establishes why-now from evidence, refusing to manufacture urgency.
 *
 * The important branch is the last one: a class that MAY claim urgency, with no
 * temporal evidence to support it, becomes `insufficient-evidence` — not
 * `time-sensitive`. That is the difference between "there is a launch and we can
 * see interest rising" and "we would like this to feel urgent".
 */
export function establishWhyNow(
  type: OpportunityType,
  trend: ReturnType<typeof trendFor>,
  searchDemand: ReturnType<typeof searchDemandFor>,
  communityPain: ReturnType<typeof communityPainFor>,
): { state: WhyNowState; reason: string } {
  const rule = DECAY_RULES[type];

  if (!rule.mayClaimUrgency) {
    return {
      state: "evergreen",
      reason: `${type} is not a time-sensitive class. ${rule.why}`,
    };
  }

  if (trend.available && trend.state === "rising") {
    return { state: "recently-emerging", reason: `Observed rising interest: ${trend.explanation}` };
  }
  if (trend.available && trend.state === "falling") {
    return { state: "not-actually-urgent", reason: `Interest is observably falling: ${trend.explanation}` };
  }
  if (communityPain.available && communityPain.state === "widespread") {
    return { state: "temporarily-relevant", reason: `Widespread current questions: ${communityPain.explanation}` };
  }
  if (searchDemand.available && searchDemand.state === "high") {
    return { state: "temporarily-relevant", reason: `High observed search demand: ${searchDemand.explanation}` };
  }

  // The refusal. Nothing observed, so nothing may be asserted about timing.
  return {
    state: "insufficient-evidence",
    reason: `This class could be time-sensitive, but no temporal evidence exists. Trend: ${trend.explanation} Search: ${searchDemand.explanation} Community: ${communityPain.explanation}`,
  };
}

/** Maps a research claim kind onto the pillar that would carry it. */
const PILLAR_FOR_CLAIM: Partial<Record<AtomicClaim["kind"], ContentPillarId>> = {
  specification: "hardware-terminology",
  "current-price": "price-availability-interpretation",
  availability: "price-availability-interpretation",
  "performance-measured": "gpu-comparisons",
  "performance-estimated": "fps-expectations",
  compatibility: "compatibility",
  comparison: "gpu-comparisons",
  recommendation: "upgrade-decisions",
  "audience-behaviour": "beginner-mistakes",
  "platform-guidance": "specsmith-methodology",
  "specsmith-product": "tool-demonstrations",
  "misconception-exists": "hardware-myths",
};

/** The opportunity class a claim naturally creates. */
const TYPE_FOR_CLAIM: Partial<Record<AtomicClaim["kind"], OpportunityType>> = {
  specification: "evergreen-education",
  "current-price": "conversion",
  availability: "breaking-time-sensitive",
  "performance-measured": "comparison",
  "performance-estimated": "comparison",
  compatibility: "evergreen-education",
  comparison: "comparison",
  recommendation: "conversion",
  "audience-behaviour": "community-pain",
  "platform-guidance": "authority",
  "specsmith-product": "product-feature-education",
  "misconception-exists": "myth-correction",
};

/** The objective a pillar most naturally serves, as a starting point. */
function primaryObjectiveFor(pillarId: ContentPillarId): StrategicObjective {
  const pillar = contentPillar(pillarId);
  return pillar.serves[0];
}

/** Stable identity, so the same input never produces two different records. */
export function opportunityIdFor(input: {
  readonly problem: string;
  readonly pillar: ContentPillarId;
  readonly type: OpportunityType;
  readonly claimIds: readonly string[];
}): string {
  const digest = createHash("sha256")
    .update([input.problem.trim().toLowerCase(), input.pillar, input.type, [...input.claimIds].sort().join(",")].join("|"))
    .digest("hex");
  return `opp-${digest.slice(0, 16)}`;
}

export interface DetectInput {
  readonly research: ResearchResult;
  readonly signals: SignalBundle;
  readonly now: Date;
  readonly provenance: StrategyProvenance;
}

/**
 * Derives opportunities from one research pass.
 *
 * Both halves of the research result are used. A SAFE claim is a chance to say
 * something true. An UNSAFE claim about something an audience cares about is a
 * chance to close a research gap — and if nobody cares, it is a chance to drop
 * the topic. All three are strategic outputs; only the first can be produced.
 */
export function detectOpportunities(input: DetectInput): StrategicOpportunity[] {
  const { research, signals, now, provenance } = input;
  const opportunities: StrategicOpportunity[] = [];

  const researchOrigin = signalOrigin(
    `research:${research.researchId}`,
    "research-result",
    research.researchId,
    research.completedAt,
    { synthetic: research.containsSyntheticEvidence, producedBy: "master2-research", producedAt: research.completedAt },
  );

  const claimsById = new Map(research.claims.map((claim) => [claim.claimId, claim]));

  // One opportunity per atomic claim: the claim is the unit MASTER #2 adjudicated,
  // so it is the unit whose evidence state can be honestly copied across.
  for (const claim of research.claims) {
    const pillarId = PILLAR_FOR_CLAIM[claim.kind] ?? "pc-building-education";
    const type = TYPE_FOR_CLAIM[claim.kind] ?? "evergreen-education";
    const pillar = contentPillar(pillarId);
    const evidenceState = research.confidence.get(claim.claimId)?.state ?? "unknown";
    const problem = claim.proposition;

    const trend = trendFor(signals, problem);
    const searchDemand = searchDemandFor(signals, problem);
    const communityPain = communityPainFor(signals, problem);
    const competitorCoverage = competitorCoverageFor(signals, problem);
    const whyNow = establishWhyNow(type, trend, searchDemand, communityPain);
    const product = productReadinessFor(signals, pillar.productSurface);

    const rule = DECAY_RULES[type];
    const origins: SignalOrigin[] = [researchOrigin];
    if (signals.search.length || signals.community.length || signals.trends.length || signals.competitors.length) {
      origins.push(signalOrigin(`signals:${signals.bundleId}`, "community-observation", signals.bundleId, signals.capturedAt, signals.provenance));
    }
    if (signals.productState.length) {
      origins.push(signalOrigin(`product:${signals.bundleId}`, "product-state", signals.bundleId, signals.capturedAt, signals.provenance));
    }

    const risks = assessRisks({
      claim,
      evidenceState,
      whyNowState: whyNow.state,
      productReadiness: product.readiness,
      pillarSurface: pillar.productSurface,
      syntheticResearch: research.containsSyntheticEvidence,
      syntheticSignals: signals.provenance.synthetic,
      communityAvailable: communityPain.available,
      type,
    });

    opportunities.push({
      opportunityId: opportunityIdFor({ problem, pillar: pillarId, type, claimIds: [claim.claimId] }),
      version: 1,
      detectedAt: now.toISOString(),
      origins,
      type,
      pillar: pillarId,
      problem,
      audienceLevel: pillar.audienceLevel,
      primaryObjective: primaryObjectiveFor(pillarId),
      secondaryObjectives: pillar.serves.slice(1, 3),
      dependsOnClaimIds: [claim.claimId],
      evidenceState,
      whyNow: whyNow.state,
      whyNowReason: whyNow.reason,
      trend: trend.state,
      searchDemand: searchDemand.state,
      competitorCoverage: competitorCoverage.state,
      communityPain: communityPain.state,
      productSurface: pillar.productSurface,
      productReadiness: product.readiness,
      bestBefore: rule.bestBeforeMs === null ? null : new Date(now.getTime() + rule.bestBeforeMs).toISOString(),
      expiresAt: rule.expiresAfterMs === null ? null : new Date(now.getTime() + rule.expiresAfterMs).toISOString(),
      lastValidatedAt: now.toISOString(),
      resourcePosture: resourcePostureFor(pillarId, product.readiness),
      risks,
      confidence: assessConfidence({
        evidenceState,
        whyNow: whyNow.state,
        searchAvailable: searchDemand.available,
        communityAvailable: communityPain.available,
        productReadiness: product.readiness,
        risks,
      }),
      provenance,
      parentOpportunityId: null,
    });
  }

  // Knowledge-gap opportunities: the research pass names what it could not
  // establish, and a blocking gap on a question worth answering is a research
  // priority rather than a content one.
  for (const gap of research.gaps) {
    if (gap.decisionImpact !== "blocking") continue;
    const claim = research.claims.find((entry) => gap.description.includes(entry.proposition));
    const pillarId = claim ? PILLAR_FOR_CLAIM[claim.kind] ?? "pc-building-education" : "pc-building-education";
    const problem = `Close the evidence gap: ${gap.description}`;
    const risks: StrategicRisk[] = [{
      code: "evidence-insufficient",
      blocking: true,
      detail: `${gap.code}: ${gap.description}. This is a research task, not a production task.`,
    }];
    opportunities.push({
      opportunityId: opportunityIdFor({ problem, pillar: pillarId, type: "experimentation", claimIds: claim ? [claim.claimId] : [] }),
      version: 1,
      detectedAt: now.toISOString(),
      origins: [researchOrigin],
      type: "experimentation",
      pillar: pillarId,
      problem,
      audienceLevel: contentPillar(pillarId).audienceLevel,
      primaryObjective: "validate-product-direction",
      secondaryObjectives: [],
      dependsOnClaimIds: claim ? [claim.claimId] : [],
      evidenceState: claim ? research.confidence.get(claim.claimId)?.state ?? "unknown" : "unknown",
      whyNow: "evergreen",
      whyNowReason: "A knowledge gap does not expire, though the evidence that closes it may.",
      trend: "unknown",
      searchDemand: "unknown",
      competitorCoverage: "unknown",
      communityPain: "unknown",
      productSurface: null,
      productReadiness: "absent",
      bestBefore: null,
      expiresAt: null,
      lastValidatedAt: now.toISOString(),
      resourcePosture: "blocked-external",
      risks,
      confidence: {
        opportunityExists: "high",
        timing: "moderate",
        audienceNeed: "insufficient",
        mechanism: "moderate",
        evidence: "insufficient",
        creativeFeasibility: "insufficient",
        reasons: ["The gap itself is certain; everything downstream of it is not."],
      },
      provenance,
      parentOpportunityId: null,
    });
    void claimsById;
  }

  return opportunities;
}

/**
 * Risks, including the ones that veto.
 *
 * Note what is checked here and nowhere else: `manufactured-urgency` fires when
 * a class that could be urgent has no temporal evidence, and
 * `manufactured-demand` fires when an opportunity's whole premise is audience
 * behaviour that nobody observed. Those two are how a strategy layer invents its
 * own reasons to publish.
 */
function assessRisks(input: {
  claim: AtomicClaim;
  evidenceState: EpistemicState;
  whyNowState: WhyNowState;
  productReadiness: ProductReadiness;
  pillarSurface: string | null;
  syntheticResearch: boolean;
  syntheticSignals: boolean;
  communityAvailable: boolean;
  type: OpportunityType;
}): StrategicRisk[] {
  const risks: StrategicRisk[] = [];
  const add = (code: StrategicRisk["code"], detail: string) => {
    risks.push({ code, blocking: BLOCKING_RISKS.includes(code), detail });
  };

  if (input.evidenceState === "disputed") add("evidence-disputed", "MASTER #2 recorded this claim as disputed; sources genuinely disagree.");
  else if (input.evidenceState === "stale") add("evidence-stale", "The only applicable evidence is past its usable window for this claim kind.");
  else if (["unknown", "insufficient-evidence", "weakly-supported", "plausible", "requires-experiment", "requires-human-judgment"].includes(input.evidenceState)) {
    add("evidence-insufficient", `MASTER #2 rated the underlying claim ${input.evidenceState}; it may not be asserted.`);
  }

  if (input.syntheticResearch || input.syntheticSignals) {
    add("synthetic-evidence", "This opportunity rests on engineering fixture data and may never drive production.");
  }

  if (input.pillarSurface !== null && input.productReadiness !== "shipped") {
    add("product-not-ready", `The ${input.pillarSurface} surface is ${input.productReadiness}; content may not point an audience at it or promise what it does.`);
  }
  if (input.pillarSurface === null) {
    risks.push({ code: "product-mismatch", blocking: false, detail: "This pillar demonstrates no SpecSmith surface, so the content cannot be product-led." });
  }

  if (input.whyNowState === "insufficient-evidence") {
    add("manufactured-urgency", "This class can be time-sensitive but no temporal evidence exists, so urgency would be asserted rather than observed.");
  }
  if (input.whyNowState === "not-actually-urgent") {
    risks.push({ code: "manufactured-urgency", blocking: false, detail: "Interest is observably falling; framing this as timely would be misleading." });
  }

  if ((input.type === "community-pain" || input.claim.kind === "audience-behaviour" || input.claim.kind === "misconception-exists") && !input.communityAvailable) {
    add("manufactured-demand", "The premise is that an audience asks this, and no community evidence exists to show that they do.");
  }

  const pillarRisks = contentPillar(PILLAR_FOR_CLAIM[input.claim.kind] ?? "pc-building-education").inherentRisks;
  for (const inherent of pillarRisks) {
    if (inherent === "misleading-buyer-advice" && input.evidenceState !== "strongly-supported" && input.evidenceState !== "known") {
      add("misleading-buyer-advice", "This pillar gives buying advice, and the evidence behind it is not strong enough to risk someone's money on.");
    }
  }

  return risks;
}

/** Interpretable confidence per facet, derived only from what is known. */
function assessConfidence(input: {
  evidenceState: EpistemicState;
  whyNow: WhyNowState;
  searchAvailable: boolean;
  communityAvailable: boolean;
  productReadiness: ProductReadiness;
  risks: readonly StrategicRisk[];
}): StrategyConfidence {
  const reasons: string[] = [];

  const evidence =
    input.evidenceState === "known" || input.evidenceState === "strongly-supported" ? "high"
      : input.evidenceState === "likely" ? "moderate"
        : input.evidenceState === "disputed" || input.evidenceState === "stale" ? "low"
          : "insufficient";
  reasons.push(`Evidence confidence is ${evidence} because MASTER #2 rated the claim ${input.evidenceState}.`);

  const audienceNeed = input.communityAvailable ? "moderate" : "insufficient";
  if (!input.communityAvailable) reasons.push("Audience need is unverified: no community signal is connected.");

  const timing =
    input.whyNow === "evergreen" ? "high"
      : input.whyNow === "recently-emerging" || input.whyNow === "temporarily-relevant" ? "moderate"
        : "insufficient";
  if (timing === "insufficient") reasons.push("Timing confidence is insufficient: no temporal evidence supports acting now.");

  const feasibility = input.risks.some((risk) => risk.blocking) ? "insufficient" : "moderate";
  if (feasibility === "insufficient") reasons.push("Creative feasibility is insufficient while a blocking risk stands.");

  const mechanism = input.searchAvailable || input.communityAvailable ? "moderate" : "low";
  if (mechanism === "low") reasons.push("The strategic mechanism is untested: no signal shows the audience behaves as assumed.");

  const exists = evidence === "insufficient" && audienceNeed === "insufficient" ? "low" : "moderate";

  return { opportunityExists: exists, timing, audienceNeed, mechanism, evidence, creativeFeasibility: feasibility, reasons };
}

/**
 * What producing this would cost.
 *
 * Everything SpecSmith can currently make is `local-free`: the compositor is
 * ffmpeg, narration is espeak-ng, and the visuals are a capture of its own app.
 * A pillar with no product surface is not blocked — it is just not product-led.
 */
function resourcePostureFor(pillarId: ContentPillarId, readiness: ProductReadiness): ResourcePosture {
  const pillar = contentPillar(pillarId);
  if (pillar.productSurface !== null && readiness !== "shipped") return "blocked-external";
  return "local-free";
}

/** Groups opportunities that are really one strategic domain. */
export function clusterOpportunities(
  opportunities: readonly StrategicOpportunity[],
): { readonly clusterId: string; readonly pillar: ContentPillarId; readonly opportunityIds: readonly string[] }[] {
  const byPillar = new Map<ContentPillarId, string[]>();
  for (const opportunity of opportunities) {
    const bucket = byPillar.get(opportunity.pillar);
    if (bucket) bucket.push(opportunity.opportunityId);
    else byPillar.set(opportunity.pillar, [opportunity.opportunityId]);
  }
  return [...byPillar.entries()]
    .map(([pillar, ids]) => ({ clusterId: `cluster-${pillar}`, pillar, opportunityIds: [...ids].sort() }))
    .sort((a, b) => a.clusterId.localeCompare(b.clusterId));
}
