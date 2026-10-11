// The proposal: one storyboard for the chosen topic, put through the pipeline's
// existing gates. Nothing here can pass a human gate; it can only fail early.
//
// GATES REUSED (not reimplemented)
// - v2/antiSlop.ts scanForSlop: the generated-copy slop scan (hard failures block).
// - v2/research/strictEvidenceGate.ts checkScriptAgainstResearchStrict, against a
//   ResearchCreativeContract built from the topic's claims (safe: hedged
//   editorial claims, state "requires-human-judgment") and its risky claims
//   (unsafe): any unhedged or hedged mention of a risky claim blocks.
// - nextVideoMonitorPort/storyboard.ts FORBIDDEN_CLAIMS: no universal "no
//   signal", FPS or percentage figure, guaranteed fix, or SpecSmith-detects claim.
// - v2/review/humanGates.ts HUMAN_GATES and APPROVAL_MECHANISM: every gate is
//   listed unresolved, with the repository's stated reason no gate can close.
// One check is new and stated as such: on-screen text at most 20 characters a
// second of its beat, so frame text stays readable on a phone.

import { scanForSlop } from "../v2/antiSlop.ts";
import type { ResearchCreativeContract } from "../v2/research/creativeContract.ts";
import { checkScriptAgainstResearchStrict } from "../v2/research/strictEvidenceGate.ts";
import { APPROVAL_MECHANISM, HUMAN_GATES } from "../v2/review/humanGates.ts";
import { FORBIDDEN_CLAIMS } from "../nextVideoMonitorPort/storyboard.ts";
import type { PlatformScriptStoryboard } from "../types.ts";
import type { Topic } from "./topics.ts";

export const PERSISTENT_DISCLOSURES = ["ILLUSTRATION", "Stylized example · not a fix for every PC"] as const;
export const MAX_ON_SCREEN_CHARS_PER_SECOND = 20;

export interface GateFinding { readonly gate: string; readonly severity: "hard-fail" | "warning"; readonly location: string; readonly message: string }

/** The topic's beats, scaled to the target length, as the pipeline's storyboard type. */
export function buildStoryboard(topic: Topic, targetSeconds: number): PlatformScriptStoryboard {
  const total = topic.beats.reduce((sum, beat) => sum + beat.seconds, 0);
  const scale = targetSeconds / total;
  let t = 0;
  const purposes = ["hook", "commitment", "payoff", "cta"] as const;
  return {
    platform: "youtube-shorts",
    targetDurationSeconds: targetSeconds,
    title: topic.title,
    narrationStyle: "Calm, conversational, one check; proposed narration only (no voice generated).",
    beats: topic.beats.map((beat, i) => {
      const start = t;
      t = Math.round((t + beat.seconds * scale) * 100) / 100;
      return {
        startSecond: Math.round(start * 100) / 100, endSecond: i === topic.beats.length - 1 ? targetSeconds : t,
        purpose: purposes[Math.min(i, purposes.length - 1)],
        narration: beat.narration, visualDirection: beat.visualDirection, onScreenText: beat.onScreenText,
        factDependencies: topic.claims.map((claim) => claim.id),
      };
    }),
    finalCta: topic.finalCta,
    factualGuardrails: topic.riskyClaims.map((risky) => `Never say: ${risky.proposition} (${risky.why})`),
    persistentDisclosures: [...PERSISTENT_DISCLOSURES],
  };
}

/** The topic's claims as the research contract the strict evidence gate reads. */
export function contractFor(topic: Topic, now: Date): ResearchCreativeContract {
  return {
    version: "research-creative-contract-v1",
    questionId: `daily-short:${topic.id}`,
    generatedAt: now.toISOString(),
    safeClaims: topic.claims.map((claim) => ({ claimId: claim.id, proposition: claim.proposition, state: "requires-human-judgment", requiredWording: [], supportingSnapshotIds: [] })),
    unsafeClaims: topic.riskyClaims.map((risky) => ({ claimId: risky.id, proposition: risky.proposition, state: "insufficient-evidence", reason: risky.why, wouldBecomeSafeIf: ["never: the Short offers one check, not a guaranteed outcome"] })),
    disputedClaims: [],
    groundedHookMaterial: [],
    openQuestions: topic.claims.map((claim) => `Fact check: "${claim.proposition}" (${claim.basis})`),
    limitations: ["Claims are editorial knowledge, not fetched sources; the factual-takeaway human gate must check them against a manual."],
    overallState: "requires-human-judgment",
  };
}

export function runGates(storyboard: PlatformScriptStoryboard, topic: Topic, now: Date): { findings: GateFinding[]; passed: boolean } {
  const findings: GateFinding[] = [];
  const slop = scanForSlop({ title: storyboard.title, beats: storyboard.beats, finalCta: storyboard.finalCta });
  for (const f of slop.findings) findings.push({ gate: "anti-slop (v2/antiSlop.ts)", severity: f.severity, location: f.location, message: `${f.code}: ${f.message} ("${f.evidence}")` });
  for (const f of checkScriptAgainstResearchStrict(storyboard, contractFor(topic, now))) {
    findings.push({ gate: "strict research evidence (v2/research/strictEvidenceGate.ts)", severity: f.severity, location: f.location, message: f.message });
  }
  const lines = [{ location: "title", text: storyboard.title }, { location: "cta", text: storyboard.finalCta },
    ...storyboard.beats.flatMap((beat, i) => [{ location: `beat-${i + 1}.narration`, text: beat.narration }, { location: `beat-${i + 1}.onScreenText`, text: beat.onScreenText }])];
  for (const { location, text } of lines) {
    for (const { pattern, why } of FORBIDDEN_CLAIMS) if (pattern.test(text)) findings.push({ gate: "forbidden claims (nextVideoMonitorPort/storyboard.ts)", severity: "hard-fail", location, message: `"${text}": ${why}` });
  }
  storyboard.beats.forEach((beat, i) => {
    const cps = beat.onScreenText.length / (beat.endSecond - beat.startSecond);
    if (cps > MAX_ON_SCREEN_CHARS_PER_SECOND) findings.push({ gate: "on-screen reading speed (new in this job)", severity: "hard-fail", location: `beat-${i + 1}.onScreenText`, message: `${cps.toFixed(1)} characters a second; at most ${MAX_ON_SCREEN_CHARS_PER_SECOND}.` });
  });
  return { findings, passed: !findings.some((f) => f.severity === "hard-fail") };
}

/** Every human gate, unresolved, with why none can close here. */
export function humanGatesUnresolved() {
  return { mechanism: APPROVAL_MECHANISM, gates: HUMAN_GATES.map((g) => ({ gate: g.gate, question: g.question, status: "unresolved" as const })) };
}
