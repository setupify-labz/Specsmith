import {
  checkScriptAgainstResearch,
  type EvidenceFinding,
  type ResearchCreativeContract,
} from "./creativeContract.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";

// Generic domain words are intentionally excluded. They identify the subject
// area, not the researched proposition. Keep hyphenated model identifiers and
// figures intact so `gpu-a` cannot collapse to generic `gpu`.
const GENERIC_TERMS = new Set([
  "gpu", "cpu", "card", "cards", "fps", "price", "prices", "faster", "slower",
  "better", "worse", "performance", "specs", "spec", "build", "pc", "game",
  "games", "gaming", "memory", "vram", "new", "best", "buy", "value",
]);

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "and", "or", "of", "to", "in", "on",
  "at", "for", "with", "this", "that", "it", "its", "than", "more", "less", "be",
  "has", "have", "costs", "cost", "gets", "get", "may", "might", "could",
]);

function mentionsClaim(text: string, proposition: string): boolean {
  const tokenize = (value: string) =>
    value
      .toLowerCase()
      .split(/[^a-z0-9$%.\-]+/)
      .map((token) => token.replace(/^[.\-]+|[.\-]+$/g, ""))
      .filter(Boolean);

  const distinctive = [...new Set(tokenize(proposition))].filter(
    (token) => token.length > 2 && !STOP_WORDS.has(token) && !GENERIC_TERMS.has(token),
  );
  if (distinctive.length === 0) return false;

  const haystack = new Set(tokenize(text));
  const hits = distinctive.filter((token) => haystack.has(token)).length;
  return hits >= 2 || (distinctive.length <= 2 && hits === distinctive.length);
}

function scriptLines(storyboard: PlatformScriptStoryboard): Array<{ location: string; text: string }> {
  const lines = [
    { location: "title", text: storyboard.title },
    { location: "cta", text: storyboard.finalCta },
  ];
  for (const [index, beat] of storyboard.beats.entries()) {
    lines.push({ location: `beat-${index + 1}.narration`, text: beat.narration });
    lines.push({ location: `beat-${index + 1}.onScreenText`, text: beat.onScreenText });
  }
  return lines;
}

/**
 * Fail-closed production evidence gate.
 *
 * The original checker treated generic uncertainty words (`may`, `might`,
 * `could`, `about`, etc.) as permission to state a claim that the research
 * contract explicitly marked unsafe or disputed. A hedge communicates
 * uncertainty; it does not create evidence. Until hypotheses/dispute reporting
 * have their own typed creative permissions, any mention of an unsafe or
 * disputed proposition remains a hard failure.
 */
export function checkScriptAgainstResearchStrict(
  storyboard: PlatformScriptStoryboard,
  contract: ResearchCreativeContract,
): EvidenceFinding[] {
  const findings = [...checkScriptAgainstResearch(storyboard, contract)];

  for (const { location, text } of scriptLines(storyboard)) {
    if (!text.trim()) continue;

    for (const unsafe of contract.unsafeClaims) {
      if (!mentionsClaim(text, unsafe.proposition)) continue;
      if (findings.some((finding) => finding.location === location && finding.code === "unsupported-factual-claim")) continue;
      findings.push({
        code: "unsupported-factual-claim",
        severity: "hard-fail",
        location,
        evidence: text,
        message: `Mentions a claim research did not establish (${unsafe.state}): "${unsafe.proposition}". Hedging does not supply missing evidence. ${unsafe.reason}`,
      });
    }

    for (const disputed of contract.disputedClaims) {
      if (!mentionsClaim(text, disputed.proposition)) continue;
      if (findings.some((finding) => finding.location === location && finding.code === "disputed-presented-as-settled")) continue;
      findings.push({
        code: "disputed-presented-as-settled",
        severity: "hard-fail",
        location,
        evidence: text,
        message: `Mentions a disputed claim without a typed dispute-reporting permission: "${disputed.proposition}". Generic hedging is not disclosure of source conflict. ${disputed.reason}`,
      });
    }
  }

  return findings;
}
