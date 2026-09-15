// MASTER #4 — MASTER #1 handoff and the closed loop (sections 32, 35, 36, 38).
//
// MASTER #1 still owns creative execution. MASTER #4 supplies constraints and
// then checks the result against them. The division:
//
//   MASTER #4 says  "the estimate label must be attached to the figure".
//   MASTER #1 says  "here is the shot where that happens".
//
// The Creative Director may choose freely among executions that satisfy the
// brief. What it may not do is satisfy the platform at the cost of an
// invariant, and `assertCreativeHonoursBrief` is where that gets caught.
//
// Note what is NOT here: no experiment assignment, no winner selection, no
// performance judgment, no retention optimization. Those are MASTER #5's and
// building them now would make the boundary unreviewable.

import type { PlatformScriptStoryboard } from "../../types.ts";
import { checkScriptAgainstResearchStrict } from "../research/strictEvidenceGate.ts";
import type { ResearchCreativeContract } from "../research/creativeContract.ts";
import {
  assertRequiredWordingPresent,
  assertTruthPreserved,
  type InvariantFinding,
  type TruthInvariant,
} from "./invariants.ts";
import { briefOutwardText, type PlatformCreativeBrief } from "./brief.ts";

/**
 * Everything MASTER #1 receives for one platform.
 *
 * Transport-independent by design: this is a value, not a call. Whatever
 * eventually renders it — the offline pipeline today, something else later —
 * receives the same frozen contract.
 */
export interface CreativeHandoff {
  readonly version: "creative-handoff-v1";
  readonly handoffId: string;
  readonly platform: PlatformCreativeBrief["platform"];
  readonly missionId: string;
  readonly brief: PlatformCreativeBrief;
  /** Restated at the top level so an executor cannot miss them. */
  readonly nonNegotiable: readonly string[];
  readonly createdAt: string;
}

export function buildCreativeHandoff(brief: PlatformCreativeBrief, now: Date): CreativeHandoff {
  const nonNegotiable: string[] = [
    `Objective is fixed: ${brief.objective}. Changing it is a strategy decision, not a creative one.`,
    `Thesis is fixed: "${brief.thesis}".`,
    ...brief.requiredWording.map((wording) => `Required wording, on this platform, in this cut: "${wording}".`),
    ...brief.requiredDisclosures.map((disclosure) => `Required disclosure: ${disclosure}`),
    ...brief.forbiddenClaims.map((claim) => `Forbidden claim: "${claim.proposition}" — ${claim.reason}`),
    ...brief.execution.accessibility.map((requirement) => `Accessibility (non-negotiable): ${requirement.requirement}`),
  ];

  if (!brief.execution.ctaTreatment.include) {
    nonNegotiable.push(`No call to action. ${brief.execution.ctaTreatment.reason}`);
  }

  return {
    version: "creative-handoff-v1",
    handoffId: `handoff-${brief.briefId}`,
    platform: brief.platform,
    missionId: brief.missionId,
    brief,
    nonNegotiable,
    createdAt: now.toISOString(),
  };
}

export interface CreativeComplianceFinding extends InvariantFinding {
  readonly platform: string;
}

/**
 * Check what MASTER #1 actually produced against what MASTER #4 required.
 *
 * Runs three gates over the same storyboard:
 *
 *  1. MASTER #2's strict evidence gate, unchanged and not re-implemented. If it
 *     rejects the script, MASTER #4 has no opinion that can overrule it.
 *  2. The truth invariants, across BOTH script lines and metadata, because a
 *     caption is shipped copy.
 *  3. The accessibility and depth requirements the brief made non-negotiable.
 */
export function assertCreativeHonoursBrief(
  storyboard: PlatformScriptStoryboard,
  brief: PlatformCreativeBrief,
  invariant: TruthInvariant,
  contract: ResearchCreativeContract,
): readonly CreativeComplianceFinding[] {
  const findings: CreativeComplianceFinding[] = [];

  // 1. MASTER #2 first. Evidence is upstream of everything here.
  for (const finding of checkScriptAgainstResearchStrict(storyboard, contract)) {
    findings.push({ ...finding, platform: brief.platform });
  }

  // 2. Truth invariants over script AND metadata together.
  const scriptTexts = scriptLines(storyboard).map((line) => ({
    location: `${brief.platform}:${line.location}`,
    text: line.text,
  }));
  const completeOutput = [...scriptTexts, ...briefOutwardText(brief)];
  for (const finding of assertTruthPreserved(invariant, completeOutput)) {
    findings.push({ ...finding, platform: brief.platform });
  }

  // The whole-output check belongs here and only here: this is the first point
  // at which the complete shipped surface for one platform exists. A caption
  // alone is not required to carry every caveat the script already delivers.
  for (const finding of assertRequiredWordingPresent(invariant, completeOutput)) {
    findings.push({ ...finding, platform: brief.platform });
  }

  // 3. Accessibility: a spoken claim with no on-screen equivalent fails the
  //    audio-independent comprehension requirement the brief froze.
  const requiresAudioIndependence = brief.execution.accessibility.some(
    (requirement) => requirement.code === "audio-independent-comprehension",
  );
  if (requiresAudioIndependence) {
    const onScreen = scriptLines(storyboard)
      .filter((line) => line.kind === "caption" || line.kind === "overlay")
      .map((line) => line.text)
      .join(" ");
    if (onScreen.trim() === "") {
      findings.push({
        code: "no-audio-independent-layer",
        severity: "hard-fail",
        location: `${brief.platform}:storyboard`,
        evidence: "no caption or overlay text found",
        platform: brief.platform,
        message:
          "The brief requires comprehension without audio, and this storyboard carries no on-screen text layer at all. " +
          "Short-form video is routinely watched muted; a spoken-only claim reaches a viewer as silence.",
      });
    }
  }

  return findings;
}

interface ScriptLine {
  readonly location: string;
  readonly text: string;
  readonly kind: "narration" | "caption" | "overlay" | "other";
}

/**
 * Pull every piece of text out of a storyboard.
 *
 * Typed against the real `StoryboardBeat` shape rather than probed defensively:
 * a reader that guesses field names degrades silently to "found no text", which
 * would make the accessibility check below pass by finding nothing. If the
 * storyboard shape changes, this should fail to compile — that is the point.
 */
function scriptLines(storyboard: PlatformScriptStoryboard): readonly ScriptLine[] {
  const lines: ScriptLine[] = [];

  storyboard.beats.forEach((beat, index) => {
    lines.push({ location: `beat[${index}].narration`, text: beat.narration, kind: "narration" });
    lines.push({ location: `beat[${index}].onScreenText`, text: beat.onScreenText, kind: "overlay" });
  });

  lines.push({ location: "title", text: storyboard.title, kind: "other" });
  lines.push({ location: "finalCta", text: storyboard.finalCta, kind: "other" });

  return lines.filter((line) => line.text.trim() !== "");
}

export function formatCreativeCompliance(findings: readonly CreativeComplianceFinding[]): string {
  if (findings.length === 0) {
    return "  compliance: the creative honours every brief invariant, on script and on metadata.";
  }
  return findings
    .map((finding) => `  ${finding.severity} ${finding.code} @ ${finding.location}: ${finding.message}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Boundaries (sections 35, 36, 37)
// ---------------------------------------------------------------------------

/**
 * What MASTER #4 deliberately does NOT do, recorded so the boundary is
 * reviewable rather than implied by absence.
 *
 * An auditor should be able to check this list against the source and find
 * nothing here implemented.
 */
export const DEFERRED_TO_LATER_MASTERS: readonly { readonly master: string; readonly capability: string; readonly why: string }[] = [
  {
    master: "MASTER #5",
    capability: "Experiment assignment and variant allocation",
    why: "MASTER #4 names the hypotheses and their falsification conditions. Deciding who sees which variant is experiment design.",
  },
  {
    master: "MASTER #5",
    capability: "Performance judgment and winner selection",
    why: "Nothing here reads a metric or ranks a creative. No analytics exist yet, and a ranking built on none would be fabricated.",
  },
  {
    master: "MASTER #5",
    capability: "Retention optimization loops",
    why: "Pacing guidance here is explicitly typed as a hypothesis. Turning it into a tuned parameter requires measured retention.",
  },
  {
    master: "MASTER #6",
    capability: "Long-term learning memory",
    why: "MASTER #4 emits immutable audience and platform snapshots. Learning across them over time is a separate concern.",
  },
  {
    master: "MASTER #8",
    capability: "Cross-system arbitration",
    why: "MASTER #4 exposes fit, conflicts, refusals, hypotheses and escalations as data so an Executive can reason over them. It does not arbitrate.",
  },
];
