import {
  checkScriptAgainstResearch,
  type EvidenceFinding,
  type ResearchCreativeContract,
} from "./creativeContract.ts";
import { analyseMention } from "./claimMention.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";

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
      const unsafeMention = analyseMention(text, unsafe.proposition);
      if (!unsafeMention.mentions) continue;
      if (findings.some((finding) => finding.location === location && finding.code === "unsupported-factual-claim")) continue;
      findings.push({
        code: "unsupported-factual-claim",
        severity: "hard-fail",
        location,
        evidence: text,
        message: `Mentions a claim research did not establish (${unsafe.state}): "${unsafe.proposition}". Hedging does not supply missing evidence. This line ${unsafeMention.reason}. ${unsafe.reason}`,
      });
    }

    for (const disputed of contract.disputedClaims) {
      const disputedMention = analyseMention(text, disputed.proposition);
      if (!disputedMention.mentions) continue;
      if (findings.some((finding) => finding.location === location && finding.code === "disputed-presented-as-settled")) continue;
      findings.push({
        code: "disputed-presented-as-settled",
        severity: "hard-fail",
        location,
        evidence: text,
        message: `Mentions a disputed claim without a typed dispute-reporting permission: "${disputed.proposition}". Generic hedging is not disclosure of source conflict. This line ${disputedMention.reason}. ${disputed.reason}`,
      });
    }
  }

  return findings;
}
