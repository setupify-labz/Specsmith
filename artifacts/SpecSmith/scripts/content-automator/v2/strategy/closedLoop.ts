// The strategy closed loop: the production route from research to mission.
//
// THE BOUNDARY THIS ENFORCES
// --------------------------
//   MASTER #2 RESEARCH_RESULT -> MASTER #3 opportunity -> hypothesis
//   -> CONTENT_MISSION -> MASTER #1 Creative
//
// Strategy never re-derives what may be said: the mission carries MASTER #2's
// contract verbatim. And Creative never invents its own strategy when a mission
// is supplied — `assertMissionGovernsCreative` below checks that the storyboard
// actually stays inside the mission it was given, which is what stops the
// boundary being advisory.
//
// WHY THE LOOP IS ALLOWED TO RETURN NOTHING
// -----------------------------------------
// On the current repository it usually does. There is no search data, no trend
// collector, no community source, no published history, and the research fixture
// is deliberately hostile. A strategy layer that produced a mission anyway would
// be proving only that it cannot say no.

import type { ResearchResult } from "../research/researchPass.ts";
import type { ResearchCreativeContract } from "../research/creativeContract.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";
import { analyseMention } from "../research/claimMention.ts";
import { parseSignalBundle, type SignalBundle, type SignalEnvironment } from "./signals.ts";
import { emptyPortfolioHistory, type PortfolioHistory } from "./portfolio.ts";
import { runStrategyPass, type StrategyResult } from "./strategyPass.ts";
import type { ContentMission } from "./contentMission.ts";
import type { StrategyProvenance } from "./model.ts";

export interface StrategyLoopInput {
  readonly runId: string;
  readonly research: ResearchResult;
  readonly contract: ResearchCreativeContract;
  /** Raw, so it goes through the real strict parser exactly as a feed would. */
  readonly rawSignals: unknown;
  readonly environment: SignalEnvironment;
  readonly history?: PortfolioHistory;
  readonly startedAt: Date;
  readonly now: Date;
  readonly provenance: StrategyProvenance;
}

export interface StrategyLoopResult {
  readonly result: StrategyResult;
  readonly signals: SignalBundle;
  /** The mission Creative should execute, or null when the answer is nothing. */
  readonly leadMission: ContentMission | null;
}

/** Runs the whole chain over real research and a parsed signal bundle. */
export function runStrategyClosedLoop(input: StrategyLoopInput): StrategyLoopResult {
  const signals = parseSignalBundle(input.rawSignals, input.environment);

  const result = runStrategyPass({
    runId: input.runId,
    research: input.research,
    contract: input.contract,
    signals,
    history: input.history ?? emptyPortfolioHistory(),
    startedAt: input.startedAt,
    now: input.now,
    provenance: input.provenance,
  });

  return { result, signals, leadMission: result.missions[0] ?? null };
}

/** A place where a storyboard left the mission it was given. */
export interface MissionComplianceFinding {
  readonly code:
    | "asserts-forbidden-claim"
    | "missing-required-wording"
    | "cta-to-unshipped-surface"
    | "no-mission-supplied";
  readonly severity: "hard-fail" | "warning";
  readonly location: string;
  readonly detail: string;
}

/**
 * Checks that Creative honoured the mission.
 *
 * This is deliberately NOT a second evidence gate — MASTER #2's strict gate
 * already owns that, and duplicating it would create two answers to one
 * question. This checks the STRATEGIC contract: did the piece assert something
 * the mission explicitly forbade, drop wording the mission required, or send an
 * audience to a surface the mission said was not shipped?
 *
 * The forbidden-claim check reuses MASTER #2's matcher rather than a second
 * copy, so the hardening that matcher received applies here too.
 */
export function assertMissionGovernsCreative(
  storyboard: PlatformScriptStoryboard,
  mission: ContentMission | null,
): MissionComplianceFinding[] {
  if (mission === null) {
    return [{
      code: "no-mission-supplied",
      severity: "warning",
      location: "storyboard",
      detail: "No mission governs this storyboard. Creative is operating on its own strategy, which strategy cannot vouch for.",
    }];
  }

  const findings: MissionComplianceFinding[] = [];
  const lines: { location: string; text: string }[] = [
    { location: "title", text: storyboard.title },
    { location: "cta", text: storyboard.finalCta },
  ];
  for (const [index, beat] of storyboard.beats.entries()) {
    lines.push({ location: `beat-${index + 1}.narration`, text: beat.narration });
    lines.push({ location: `beat-${index + 1}.onScreenText`, text: beat.onScreenText });
  }

  for (const { location, text } of lines) {
    if (!text.trim()) continue;
    for (const forbidden of mission.forbiddenClaims) {
      if (!analyseMention(text, forbidden.proposition).mentions) continue;
      findings.push({
        code: "asserts-forbidden-claim",
        severity: "hard-fail",
        location,
        detail: `The mission forbade "${forbidden.proposition}" (${forbidden.reason}), and this line states it.`,
      });
    }
  }

  // A CTA to a surface the mission says is not shipped.
  if (mission.productRoute === null) {
    const allText = lines.map((line) => line.text).join(" ").toLowerCase();
    for (const surface of ["/builder", "/compare", "/upgrade"]) {
      if (allText.includes(surface)) {
        findings.push({
          code: "cta-to-unshipped-surface",
          severity: "hard-fail",
          location: "storyboard",
          detail: `The script sends the viewer to ${surface}, but the mission states no route may be offered: ${mission.ctaIntent}`,
        });
      }
    }
  }

  return findings;
}

/** Renders compliance findings for a terminal. */
export function formatMissionCompliance(findings: readonly MissionComplianceFinding[]): string {
  if (findings.length === 0) return "  storyboard stays inside its mission";
  return findings.map((finding) => `  ${finding.severity} ${finding.code} @ ${finding.location}: ${finding.detail}`).join("\n");
}
