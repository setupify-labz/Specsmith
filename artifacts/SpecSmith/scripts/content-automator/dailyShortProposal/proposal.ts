// The proposal: one storyboard for the chosen topic, put through the pipeline's
// existing gates. Nothing here can pass a human gate; it can only fail early.
//
// GATES REUSED (not reimplemented)
// - v2/antiSlop.ts scanForSlop: the generated-copy slop scan (hard failures block).
// - v2/research/strictEvidenceGate.ts checkScriptAgainstResearchStrict, run twice:
//   1. BLOCKING: a contract whose unsafe claims are the topic's risky claims.
//      Any mention, hedged or not, blocks the run.
//   2. FACT CHECK: a contract whose unsafe claims are the topic's own claims,
//      in state "requires-human-judgment" (no person has read the sources).
//      Its findings are the lines that rest on unverified claims; they do not
//      stop the render, but the run's status is "awaiting-fact-check" and never
//      "ready". No claim is ever filed as safe here: "requires-human-judgment"
//      is in v2/research/model.ts UNSAFE_FOR_CREATIVE, and nothing in this job
//      can verify a source.
// - nextVideoMonitorPort/storyboard.ts FORBIDDEN_CLAIMS: no universal "no
//   signal", FPS or percentage figure, guaranteed fix, or SpecSmith-detects claim.
// - v2/review/humanGates.ts HUMAN_GATES and APPROVAL_MECHANISM: every gate is
//   listed unresolved, with the repository's stated reason no gate can close.
// One check is new and stated as such: on-screen text at most 20 characters a
// second, so frame text stays readable on a phone. For an animated topic it is
// measured per label, over the span that label is actually visible in the cut.

import { scanForSlop } from "../v2/antiSlop.ts";
import type { ResearchCreativeContract } from "../v2/research/creativeContract.ts";
import { checkScriptAgainstResearchStrict } from "../v2/research/strictEvidenceGate.ts";
import { APPROVAL_MECHANISM, HUMAN_GATES } from "../v2/review/humanGates.ts";
import { FORBIDDEN_CLAIMS } from "../nextVideoMonitorPort/storyboard.ts";
import type { PlatformScriptStoryboard } from "../types.ts";
import { TEMPLATES } from "./animations.ts";
import type { Topic } from "./topics.ts";

export { REQUIRED_DISCLOSURES as PERSISTENT_DISCLOSURES } from "../animationScenes/spec.ts";
import { REQUIRED_DISCLOSURES as PERSISTENT_DISCLOSURES } from "../animationScenes/spec.ts";
export const MAX_ON_SCREEN_CHARS_PER_SECOND = 20;
/**
 * Lines that state an outcome: the PC boots, loads, works or is fixed. The strict research gate matches risky
 * claims by shared words, so a paraphrase ("It loads Windows after that") can slip past it; these block the
 * outcome itself, whatever the wording. Instructions ("Then try booting again.") and the symptom ("now it won't
 * boot?") do not match. A backstop, not a semantic checker: the factual-takeaway human gate reads every line.
 */
export const OUTCOME_PROMISES: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  // Subject + optional auxiliary/copula + outcome verb in its base, -s, -ing or -ed form:
  // "it loads", "your PC will boot", "the PC is working now", "it's booting again", "it has started".
  { pattern: /\b(it|it's|your pc|the pc|your computer|the computer|that|this|the build|your build|everything)\s+((will|should|would|then|now|is|are|was|has|have|has been|will be|should be)\s+)*(boot(s|ing|ed)?|load(s|ing|ed)?|start(s|ing|ed)?(\s+up)?|power(s|ing|ed)?\s+on|post(s|ing|ed)?|work(s|ing|ed)?|run(s|ning)?|ran|turn(s|ing|ed)?\s+on)\b/i, why: "States that the PC boots, loads or works afterwards; the Shorts show a check, never an outcome." },
  { pattern: /\b(fixed|solved|problem solved|back to normal|good as new|up and running)\b/i, why: "States that the problem is fixed; the Shorts offer one check, never a fix." },
  { pattern: /\b(loads?|boots?\s+(in)?to|straight\s+(in)?to)\s+windows\b/i, why: "Shows or promises a successful boot into Windows, which no cut shows." },
];

export interface GateFinding { readonly gate: string; readonly severity: "hard-fail" | "warning"; readonly location: string; readonly message: string }

/**
 * The topic's beats as the pipeline's storyboard type. An animated topic's
 * storyboard is its template's, at the template's exact timing (targetSeconds
 * is ignored: the cut has one length); any other topic is scaled to the target.
 */
export function buildStoryboard(topic: Topic, targetSeconds: number): PlatformScriptStoryboard {
  const template = topic.animation ? TEMPLATES[topic.animation] : undefined;
  if (template) {
    return {
      platform: "youtube-shorts",
      targetDurationSeconds: template.durationSeconds,
      title: topic.title,
      narrationStyle: "Calm, conversational, one check. The captions are burned into the cut; no voice generated.",
      beats: template.beats.map((beat) => ({
        startSecond: beat.from, endSecond: beat.to, purpose: beat.purpose,
        narration: beat.caption, visualDirection: beat.visualDirection, onScreenText: beat.onScreenText,
        factDependencies: topic.claims.map((claim) => claim.id),
      })),
      finalCta: topic.finalCta,
      factualGuardrails: topic.riskyClaims.map((risky) => `Never say: ${risky.proposition} (${risky.why})`),
      persistentDisclosures: [...template.disclosures],
    };
  }
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

function contract(topic: Topic, now: Date, purpose: "blocking" | "fact-check"): ResearchCreativeContract {
  const unsafe = purpose === "blocking"
    ? topic.riskyClaims.map((risky) => ({ claimId: risky.id, proposition: risky.proposition, state: "insufficient-evidence" as const, reason: risky.why, wouldBecomeSafeIf: ["never: the Short offers one check, not a guaranteed outcome"] }))
    : topic.claims.map((claim) => ({ claimId: claim.id, proposition: claim.proposition, state: "requires-human-judgment" as const, reason: `Not yet fact-checked by a person. Basis: ${claim.basis}`, wouldBecomeSafeIf: ["a person reads the cited page and confirms the quote supports the line"] }));
  return {
    version: "research-creative-contract-v1",
    questionId: `daily-short:${topic.id}:${purpose}`,
    generatedAt: now.toISOString(),
    safeClaims: [],
    unsafeClaims: unsafe,
    disputedClaims: [],
    groundedHookMaterial: [],
    openQuestions: topic.claims.map((claim) => `Fact check: "${claim.proposition}" (${claim.basis})`),
    limitations: ["No claim has been read against its source by a person; the factual-takeaway human gate must do it."],
    overallState: "requires-human-judgment",
  };
}
/** The research contracts the strict evidence gate reads: risky claims (blocking) and the topic's unverified claims (fact check). */
export function contractFor(topic: Topic, now: Date, purpose: "blocking" | "fact-check" = "blocking"): ResearchCreativeContract {
  return contract(topic, now, purpose);
}

export interface FactCheckItem { readonly location: string; readonly line: string; readonly claimIds: readonly string[]; readonly bases: readonly string[] }

export function runGates(storyboard: PlatformScriptStoryboard, topic: Topic, now: Date): { findings: GateFinding[]; passed: boolean; factCheck: FactCheckItem[] } {
  const findings: GateFinding[] = [];
  const slop = scanForSlop({ title: storyboard.title, beats: storyboard.beats, finalCta: storyboard.finalCta });
  for (const f of slop.findings) findings.push({ gate: "anti-slop (v2/antiSlop.ts)", severity: f.severity, location: f.location, message: `${f.code}: ${f.message} ("${f.evidence}")` });
  for (const f of checkScriptAgainstResearchStrict(storyboard, contract(topic, now, "blocking"))) {
    findings.push({ gate: "strict research evidence (v2/research/strictEvidenceGate.ts)", severity: f.severity, location: f.location, message: f.message });
  }
  // The lines that rest on the topic's own, not-yet-verified claims.
  const byLocation = new Map<string, { line: string; claimIds: Set<string> }>();
  for (const f of checkScriptAgainstResearchStrict(storyboard, contract(topic, now, "fact-check"))) {
    const entry = byLocation.get(f.location) ?? { line: f.evidence, claimIds: new Set<string>() };
    for (const claim of topic.claims) if (f.message.includes(`"${claim.proposition}"`)) entry.claimIds.add(claim.id);
    byLocation.set(f.location, entry);
  }
  const factCheck = [...byLocation].map(([location, { line, claimIds }]) => ({
    location, line, claimIds: [...claimIds], bases: topic.claims.filter((c) => claimIds.has(c.id)).map((c) => c.basis),
  }));
  const lines = [{ location: "title", text: storyboard.title }, { location: "cta", text: storyboard.finalCta },
    // The standard disclosure is exempt from the universal-claim pattern it negates ("not a fix for every PC"); anything else on the band is scanned.
    ...(storyboard.persistentDisclosures ?? []).map((text, i) => ({ location: `disclosure-${i + 1}`, text })).filter(({ text }, i) => text !== PERSISTENT_DISCLOSURES[i]),
    ...storyboard.beats.flatMap((beat, i) => [{ location: `beat-${i + 1}.narration`, text: beat.narration }, { location: `beat-${i + 1}.onScreenText`, text: beat.onScreenText }])];
  for (const { location, text } of lines) {
    for (const { pattern, why } of FORBIDDEN_CLAIMS) if (pattern.test(text)) findings.push({ gate: "forbidden claims (nextVideoMonitorPort/storyboard.ts)", severity: "hard-fail", location, message: `"${text}": ${why}` });
    for (const { pattern, why } of OUTCOME_PROMISES) if (pattern.test(text)) findings.push({ gate: "outcome promise (new in this job)", severity: "hard-fail", location, message: `"${text}": ${why}` });
  }
  const template = topic.animation ? TEMPLATES[topic.animation] : undefined;
  const spans = template
    ? template.labels.map((label) => ({ location: `label "${label.text}" ${label.from.toFixed(2)}-${label.to.toFixed(2)} s`, text: label.text, seconds: label.to - label.from }))
    : storyboard.beats.map((beat, i) => ({ location: `beat-${i + 1}.onScreenText`, text: beat.onScreenText, seconds: beat.endSecond - beat.startSecond }));
  for (const { location, text, seconds } of spans) {
    const cps = text.length / seconds;
    if (cps > MAX_ON_SCREEN_CHARS_PER_SECOND) findings.push({ gate: "on-screen reading speed (new in this job)", severity: "hard-fail", location, message: `${cps.toFixed(1)} characters a second; at most ${MAX_ON_SCREEN_CHARS_PER_SECOND}.` });
  }
  if (template) for (const label of template.labels) {
    for (const { pattern, why } of FORBIDDEN_CLAIMS) if (pattern.test(label.text)) findings.push({ gate: "forbidden claims (nextVideoMonitorPort/storyboard.ts)", severity: "hard-fail", location: `label "${label.text}"`, message: why });
    for (const { pattern, why } of OUTCOME_PROMISES) if (pattern.test(label.text)) findings.push({ gate: "outcome promise (new in this job)", severity: "hard-fail", location: `label "${label.text}"`, message: why });
  }
  return { findings, passed: !findings.some((f) => f.severity === "hard-fail"), factCheck };
}

/** Every human gate, unresolved, with why none can close here. */
export function humanGatesUnresolved() {
  return { mechanism: APPROVAL_MECHANISM, gates: HUMAN_GATES.map((g) => ({ gate: g.gate, question: g.question, status: "unresolved" as const })) };
}
