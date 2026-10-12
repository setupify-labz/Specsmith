// The human review gates every proposal lists, all unresolved: the job can never close one. Same gates and
// questions as v2/review/humanGates.ts on the content-pipeline branches (where they bind to media hashes); the
// daily job only lists them, so it carries the list and the approval statement, not that review subsystem.
export const HUMAN_GATES: readonly { readonly gate: string; readonly question: string }[] = [
  { gate: "hook-on-phone", question: "Watched on a phone at real size: is the hook understood within the first two seconds?" },
  { gate: "factual-takeaway", question: "Is the factual takeaway understood correctly, with no misleading emphasis, after one watch?" },
  { gate: "readable-at-size", question: "Are all text, numbers and game names readable at real size, inside the visible area?" },
  { gate: "pacing", question: "Is the pacing intentional: no rushed line, no dead air, and every cut lands on its line?" },
  { gate: "style-fits-audience", question: "Does the style suit a beginner choosing a gaming PC?" },
  { gate: "voice-and-mix", question: "After a full listen: is every word pronounced correctly, and is the mix clear?" },
  { gate: "disclosures-in-context", question: "Is each disclosure understandable in context, while the claim it qualifies is on screen?" },
  { gate: "rights-and-publication", question: "Are the rights to every asset signed off, and is publication of this exact cut authorised?" },
];

const NO_TRUSTED_APPROVAL_RECORD =
  "no trusted approval record exists in this repository: a caller-supplied reviewer name and time is recorded, but does not prove anyone watched or listened, so it cannot close the gate";

/** Stated in every proposal, so nobody has to find this comment. */
export const APPROVAL_MECHANISM = {
  trustedApprovalAvailable: false as const,
  why: `${NO_TRUSTED_APPROVAL_RECORD}. A decision is recorded with the bytes and cut it names; ` +
    "an approval never closes a gate, and a recorded rejection always blocks.",
};
