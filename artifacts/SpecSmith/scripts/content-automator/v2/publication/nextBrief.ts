// MASTER #8: a learning report's next-brief input, carried into the normal
// creative workflow, and nowhere else.
//
// The input enters through fileWorkflow.buildCreativeBrief's
// memoryObservations, the same door creative memory uses: as context lines,
// each naming the report and the observations it rests on. The research
// contract, approved claims, disclosures and capture views come from the
// mission unchanged, so performance data cannot alter what may be said. The
// resulting brief is a proposal: concepts written from it still go through the
// creative checks, rendering, MASTER #7 review and trusted human approval.

import { buildCreativeBrief, type ExportedBrief } from "../creative/fileWorkflow.ts";
import type { CreativeMissionInput } from "../creative/proposalPass.ts";
import type { NextBriefInput } from "./learningReport.ts";

export class NextBriefRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NextBriefRefusedError";
  }
}

export interface NextBriefHandoff {
  readonly brief: ExportedBrief;
  /** Carried forward so every concept written from this brief can cite them. */
  readonly evidence: NextBriefInput["evidence"] & { readonly reportId: string };
  readonly proposedChange: NextBriefInput["proposedChange"];
  readonly constraints: readonly string[];
}

export function nextBriefForWorkflow(next: NextBriefInput, mission: Omit<CreativeMissionInput, "concepts">): NextBriefHandoff {
  if (next.simulated && !mission.researchSynthetic) {
    throw new NextBriefRefusedError(`Learning report ${next.reportId} rests on simulated performance data; it may inform only an engineering (synthetic) mission, never a production brief.`);
  }
  const brief = buildCreativeBrief(mission, next.memoryObservations);
  return {
    brief,
    evidence: { ...next.evidence, reportId: next.reportId },
    proposedChange: next.proposedChange,
    constraints: next.constraints,
  };
}
