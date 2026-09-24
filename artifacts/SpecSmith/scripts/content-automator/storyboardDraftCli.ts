// Renders the generated storyboard to a real MP4 draft and prints the
// per-beat provenance. Draft only: nothing here passes a quality gate,
// touches the publication ledger, or posts anywhere.

import { renderGeneratedStoryboard, INTENDED_VOICE_NAME } from "./storyboardRender.ts";
import { writeReviewPacket } from "./reviewPacket.ts";
import { evaluatePublishGate } from "./publishGate.ts";
import { renderReceiptFor, type RenderReceipt } from "./motionCompositor.ts";
import { dependencyRecordFor } from "./renderManifest.ts";
import type { HostedMaster } from "./hostedMaster.ts";

async function main(): Promise<number> {
  const result = await renderGeneratedStoryboard();

  console.log(`Idea:       ${result.idea.id} ("${result.idea.title}")`);
  console.log(`Package:    ${result.content.packageId}`);
  const script = result.storyboard.scripts.find((entry) => entry.platform === result.plan.platform);
  console.log(`Storyboard: ${script?.beats.length ?? 0} beats, target ${script?.targetDurationSeconds ?? 0}s`);

  if (result.timing.overruns) {
    console.log("\n*** STORYBOARD TIMING DEFECT — the headline finding of this run ***");
    console.log(`  The storyboard assigns itself ${result.timing.targetSeconds}s and writes narration needing ` +
      `${result.timing.narrationSeconds.toFixed(1)}s at a natural 165 wpm (${result.timing.overrunRatio.toFixed(2)}x over).`);
    for (const beat of result.timing.beats) {
      const flag = beat.neededSeconds > beat.windowSeconds ? "OVER " : "fits ";
      console.log(`    ${flag} beat ${beat.index} ${beat.purpose.padEnd(11)} window ${beat.windowSeconds}s, narration needs ${beat.neededSeconds.toFixed(1)}s`);
    }
    console.log(`  Every window was scaled by ${result.timingScale.toFixed(2)}x so proportions and voice sync survive.`);
    console.log("  The copy is what needs shortening. That is a writing decision, not made here.");
  }

  console.log(`\nMaster:     ${result.master.uri}`);
  console.log(`Metadata:   ${JSON.stringify(result.master.metadata)}`);

  console.log("\nBeat provenance (which seconds are real product evidence):");
  for (const beat of result.beats) {
    const window = `${beat.renderedStartSecond.toFixed(1)}-${beat.renderedEndSecond.toFixed(1)}s`.padStart(13);
    const origin = beat.isFixture ? "FIXTURE" : "real   ";
    console.log(`  beat ${beat.beatIndex} ${beat.purpose.padEnd(11)} ${window}  ${origin}  ${beat.adapterName}`);
  }

  const fixtures = result.beats.filter((beat) => beat.isFixture);
  console.log(`\n${result.beats.length - fixtures.length} of ${result.beats.length} beats are real SpecSmith captures.`);
  console.log(`Narration is an offline espeak-ng stand-in for ${INTENDED_VOICE_NAME}; no paid provider was called.`);

  const { packet, path } = await writeReviewPacket(result);
  console.log(`\nReview packet: ${path}`);
  console.log(`Master sha256: ${packet.master.sha256}`);
  console.log(`\nBlockers a human has to clear (${packet.blockers.length}):`);
  for (const blocker of packet.blockers) {
    console.log(`  - ${blocker.id}`);
    console.log(`      ${blocker.summary}`);
    console.log(`      NEEDS: ${blocker.needsHuman}`);
  }

  // THE GATE IS RUN, NOT DESCRIBED. It is handed the receipt the compositor
  // issued for this master — the files it actually consumed — so the refusal
  // printed below is a real verdict on real bytes and metadata. A draft has no
  // QC verdict, rights evidence or inspection, so those bindings are empty and
  // the gate refuses them too.
  const receipt = result.master ? renderReceiptFor(result.master) : undefined;
  const verdict = evaluatePublishGate({
    receipt: receipt as RenderReceipt,
    dependencyRecord: receipt ? dependencyRecordFor(receipt) : { masterSha256: "", receiptDigest: "", dependencies: [] },
    // A draft is never uploaded, so there is no verified hosted copy.
    hostedMaster: undefined as unknown as HostedMaster,
    qualityReview: { masterSha256: "", receiptDigest: "" },
    rightsEvidence: { masterSha256: "", receiptDigest: "" },
    narrationIdentity: { liamVoiceId: process.env.ELEVENLABS_VOICE_ID ?? "" },
  });
  console.log("\nPublish gate:");
  if (verdict.allowed) {
    console.log("  ALLOWED — every condition affirmatively met.");
  } else {
    console.log(`  REFUSED, for ${verdict.refusals.length} reasons:`);
    for (const refusal of verdict.refusals) console.log(`    [${refusal.code}] ${refusal.detail}`);
  }

  console.log("\nStatus: DRAFT — awaiting human review, not publishable, not posted.");
  return 0;
}

main().then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    console.error("\nSTORYBOARD DRAFT RENDER FAILED:");
    console.error(error);
    process.exitCode = 1;
  },
);
