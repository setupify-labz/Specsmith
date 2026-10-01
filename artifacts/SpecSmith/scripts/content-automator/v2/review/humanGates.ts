// The judgments only a person can make about a rendered cut.
//
// WHY NO GATE CAN CLOSE TODAY
// ---------------------------
// A gate closes when a person has watched or listened to these exact bytes and
// decided. Proving that needs an authenticated reviewer and a signed decision
// bound to the media hash. This repository has neither (contentCreativeReport's
// NO_TRUSTED_APPROVAL_RECORD), so a decision passed in by a caller is recorded
// as a claim: who it names, when, and about which bytes. It never closes a gate.
//
// A rejection is different. A claimed rejection is enough to stop: refusing to
// go ahead on someone's say-so costs nothing, approving on it could publish a
// mistake. So any recorded rejection blocks, whatever bytes it names.
//
// There is no "entertainment score". Whether a hook lands is a person's call.

import { NO_TRUSTED_APPROVAL_RECORD } from "../contentCreativeReport.ts";
import type { HumanDecisionClaim } from "./inputs.ts";
import type { BindingKey, HumanGateId, HumanGateRecord, ReviewFinding } from "./types.ts";

export const HUMAN_GATES: readonly { readonly gate: HumanGateId; readonly question: string; readonly bindsTo: readonly BindingKey[] }[] = [
  { gate: "hook-on-phone", question: "Watched on a phone at real size: is the hook understood within the first two seconds?", bindsTo: ["media", "platformCut", "script"] },
  { gate: "factual-takeaway", question: "Is the factual takeaway understood correctly, with no misleading emphasis, after one watch?", bindsTo: ["media", "script", "claims", "evidence", "graphics"] },
  { gate: "readable-at-size", question: "Are all text, numbers and game names readable at real size, inside the visible area?", bindsTo: ["media", "platformCut", "captions", "disclosure"] },
  { gate: "pacing", question: "Is the pacing intentional: no rushed line, no dead air, and every cut lands on its line?", bindsTo: ["media", "script"] },
  { gate: "style-fits-audience", question: "Does the style suit a beginner choosing a gaming PC?", bindsTo: ["media"] },
  { gate: "voice-and-mix", question: "After a full listen: is every word pronounced correctly, and is the mix clear?", bindsTo: ["media", "script", "assets"] },
  { gate: "disclosures-in-context", question: "Is each disclosure understandable in context, while the claim it qualifies is on screen?", bindsTo: ["media", "disclosure", "claims"] },
  { gate: "rights-and-publication", question: "Are the rights to every asset signed off, and is publication of this exact cut authorised?", bindsTo: ["media", "platformCut", "assets", "rights"] },
];

/** Stated in every packet, so nobody has to find this comment. */
export const APPROVAL_MECHANISM = {
  trustedApprovalAvailable: false as const,
  why: `${NO_TRUSTED_APPROVAL_RECORD}. A decision is recorded with the bytes and cut it names; ` +
    "an approval never closes a gate, and a recorded rejection always blocks.",
};

export function evaluateHumanGates(input: {
  readonly decisions: readonly HumanDecisionClaim[];
  readonly mediaSha256: string | null;
  readonly variantId: string;
  readonly now: Date;
}): { gates: HumanGateRecord[]; findings: ReviewFinding[] } {
  const findings: ReviewFinding[] = [];
  const known = new Set(HUMAN_GATES.map((gate) => gate.gate));
  for (const decision of input.decisions) {
    if (!known.has(decision.gate)) {
      findings.push({
        code: "decision-for-unknown-gate", severity: "advisory", check: "decisions.binding", location: `decision ${decision.gate}`,
        evidence: JSON.stringify(decision), message: `A decision names gate "${decision.gate}", which this review does not have; it was ignored.`,
        owner: "human-review", recheck: ["decisions.binding"],
      });
    }
  }

  const gates = HUMAN_GATES.map((definition): HumanGateRecord => {
    const recordedDecisions = input.decisions.filter((decision) => decision.gate === definition.gate).map((decision) => {
      const sameBytes = input.mediaSha256 !== null && decision.mediaSha256 === input.mediaSha256;
      const sameCut = decision.variantId === input.variantId;
      const at = Date.parse(decision.at);
      const problems: string[] = [];
      if (!sameBytes) problems.push(decision.mediaSha256 ? `names other media (${decision.mediaSha256.slice(0, 12)}…)` : "names no media");
      if (!sameCut) problems.push(decision.variantId ? `names another platform cut (${decision.variantId})` : "names no platform cut");
      if (!decision.by.trim()) problems.push("names no reviewer");
      if (!Number.isFinite(at) || at > input.now.getTime()) problems.push("has a missing, invalid or future time");
      const appliesToThisCut = problems.length === 0;

      if (decision.outcome === "approved" && (!sameBytes || !sameCut)) {
        findings.push({
          code: "approval-for-other-media", severity: "advisory", check: "decisions.binding", location: `gate ${definition.gate}`,
          evidence: `by ${decision.by || "(nobody)"} at ${decision.at}, media ${decision.mediaSha256 ?? "(none)"}, cut ${decision.variantId ?? "(none)"}`,
          message: `An approval for ${definition.gate} ${problems.join(" and ")}. Approval does not carry across media or platform cuts; it does not apply here.`,
          owner: "human-review", recheck: [definition.gate],
        });
      }
      return {
        outcome: decision.outcome,
        by: decision.by,
        at: decision.at,
        mediaSha256: decision.mediaSha256,
        variantId: decision.variantId,
        trusted: false as const,
        appliesToThisCut,
        note: decision.outcome === "rejected"
          ? "A recorded rejection blocks, whoever made it and whatever it names."
          : appliesToThisCut
            ? `Recorded for these exact bytes and this cut, but ${NO_TRUSTED_APPROVAL_RECORD}.`
            : `Does not apply: it ${problems.join(" and ")}.`,
      };
    });

    const rejected = recordedDecisions.some((decision) => decision.outcome === "rejected");
    if (rejected) {
      const rejection = recordedDecisions.find((decision) => decision.outcome === "rejected")!;
      findings.push({
        code: "human-rejection", severity: "blocking", check: "decisions.binding", location: `gate ${definition.gate}`,
        evidence: `rejected by ${rejection.by || "(unnamed)"} at ${rejection.at}`,
        message: `A person's rejection was recorded for "${definition.question}" It blocks until the cut is changed and reviewed again.`,
        owner: "human-review", recheck: [definition.gate],
      });
    }
    return { gate: definition.gate, question: definition.question, bindsTo: definition.bindsTo, status: rejected ? "rejected" : "open", recordedDecisions };
  });
  return { gates, findings };
}
