#!/usr/bin/env node
// Mutation controls for the publish-provenance boundary.
//
// Re-introduces each original defect (and each individual check the fix
// relies on) into the source, runs the boundary tests, records which tests
// turn red, and restores the file. A mutation that turns nothing red means the
// tests do not guard that property, and the script exits non-zero.
//
// Run from artifacts/SpecSmith:  node scripts/content-automator/publishBoundaryMutations.mjs
// Source files are restored in a `finally`, and the script refuses to start
// if any target file has uncommitted changes, so a crash cannot lose work.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = "scripts/content-automator";
const TESTS = [
  "publishBoundary.test.ts", "publishGate.test.ts", "publishing.test.ts", "renderManifest.test.ts",
  "qualityReviewer.test.ts", "productVisualAssets.test.ts",
]
  .map((file) => `${DIR}/${file}`);

/** Each mutation is one exact, unique text replacement (or a whole-file revert). */
const MUTATIONS = [
  {
    id: "M1a",
    defect: "1: a caller-accessible seal operation is exported",
    file: "motionCompositor.ts",
    find: "export function isIssuedRenderReceipt(",
    replace: "export function sealRenderReceipt(receipt: object): object {\n  ISSUED_RECEIPTS.add(receipt);\n  return receipt;\n}\n\nexport function isIssuedRenderReceipt(",
  },
  {
    id: "M1b",
    defect: "1: trust is a self-consistent digest, so a re-digested substitution passes",
    file: "motionCompositor.ts",
    find: "  if (!ISSUED_RECEIPTS.has(value)) return false;\n",
    replace: "",
  },
  {
    id: "M2a",
    defect: "2: every input is recorded with the master's digest",
    file: "motionCompositor.ts",
    find: "          inputs: consumedBefore,\n",
    replace: "          inputs: consumedBefore.map((input) => ({ ...input, sha256: master.sha256 })),\n",
  },
  {
    id: "M2b",
    defect: "2: the offline pipeline's original hand-typed, master-digest provenance",
    file: "endToEndOfflinePipeline.ts",
    revertTo: "ea444f0348a4442a87ceb9b17136e95d3ae6bed3",
  },
  {
    id: "M3",
    defect: "3: every offered artifact is recorded as in the master without proof",
    file: "motionCompositor.ts",
    find: "      const consumedPlans = [...plans.values()];\n",
    replace:
      "      for (const artifact of context.dependencyArtifacts) {\n"
      + "        if (!plans.has(artifact.taskId)) plans.set(artifact.taskId, { artifact, role: \"evidence-visual\", path: filePathFromArtifact(artifact), timeline: [] });\n"
      + "      }\n"
      + "      const consumedPlans = [...plans.values()];\n",
  },
  {
    id: "M4a",
    defect: "4: sign-offs not bound to the receipt digest",
    file: "publishGate.ts",
    find: "  else if (digest !== receipt.digest) {",
    replace: "  else if (false) {",
  },
  {
    id: "M4b",
    defect: "4: sign-offs not bound to the master digest",
    file: "publishGate.ts",
    find: "  else if (master !== receipt.masterSha256) {",
    replace: "  else if (false) {",
  },
  {
    id: "M4c",
    defect: "4: the master is not re-hashed at the boundary",
    file: "publishGate.ts",
    find: "  const master = rehash(receipt.masterPath);",
    replace: "  const master = { sha256: receipt.masterSha256, realPath: receipt.masterPath };",
  },
  {
    id: "M4d",
    defect: "4: consumed inputs are not re-hashed at the boundary",
    file: "publishGate.ts",
    find: "    const current = rehash(consumed.resolvedPath);",
    replace: "    const current = { sha256: consumed.sha256, realPath: consumed.resolvedPath };",
  },
  {
    id: "M4e",
    defect: "4: QC binding read from the receipt instead of the QC record",
    file: "publishing.ts",
    find: "      receiptDigest: gate.qualityReview.reviewedReceiptDigest ?? \"\",",
    replace: "      receiptDigest: gate.renderReceipt?.digest ?? \"\",",
  },
  {
    id: "M4f",
    defect: "4: rights binding read from the receipt instead of the rights record",
    file: "publishing.ts",
    find: "      receiptDigest: gate.assetBundle.approvedReceiptDigest ?? \"\",",
    replace: "      receiptDigest: gate.renderReceipt?.digest ?? \"\",",
  },
  {
    id: "M5a",
    defect: "dependency record: omitted consumed file not detected",
    file: "publishGate.ts",
    find: "      if (!claimedTasks.has(consumed.taskId)) {",
    replace: "      if (false) {",
  },
  {
    id: "M5b",
    defect: "dependency record: extra claimed file not detected",
    file: "publishGate.ts",
    find: "        refuse(\"extra-claimed-dependency\", ",
    replace: "        void (",
  },
  {
    id: "M7a",
    defect: "provider evidence: ElevenLabs evidence issued for an injected transport",
    file: "elevenLabsTts.ts",
    find: "        && fetchImpl === BUILTIN_FETCH\n",
    replace: "",
  },
  {
    id: "M7b",
    defect: "provider evidence: narration accepted on a provider LABEL",
    file: "publishGate.ts",
    find: "      if (evidence?.issuer !== \"elevenlabs-tts\") {",
    replace: "      if (consumed.provider !== \"elevenlabs\" && evidence?.issuer !== \"elevenlabs-tts\") {",
  },
  {
    id: "M7c",
    defect: "provider evidence: voice accepted on a voiceId LABEL",
    file: "publishGate.ts",
    find: "      } else if (evidence?.issuer !== \"elevenlabs-tts\") {",
    replace: "      } else if (evidence?.issuer !== \"elevenlabs-tts\" && consumed.voiceId !== liamVoiceId) {",
  },
  {
    id: "M7d",
    defect: "provider evidence: evidence accepted for bytes it does not describe",
    file: "publishGate.ts",
    find: "      } else if (!evidence.sha256Matches) {",
    replace: "      } else if (false) {",
  },
  {
    id: "M7e",
    defect: "provider evidence: captions accepted on a renderer LABEL",
    file: "publishGate.ts",
    find: "        && !(consumed.evidence?.issuer === \"specsmith-ass-captions\" && consumed.evidence.sha256Matches)) {",
    replace: "        && false) {",
  },
  {
    id: "M8a",
    defect: "hosting: upload not verified by downloading the hosted bytes",
    file: "hostedMaster.ts",
    find: "  if (hosted.sha256 !== receipt.masterSha256 || hosted.bytes !== local.byteLength) {",
    replace: "  if (false) {",
  },
  {
    id: "M8b",
    defect: "hosting: builder does not re-download the hosted bytes",
    file: "publishing.ts",
    find: "    await reverifyHostedMaster(gate.hostedMaster);\n",
    replace: "",
  },
  {
    id: "M8c",
    defect: "hosting: a caller-built hosted record is accepted",
    file: "publishGate.ts",
    find: "  if (!isVerifiedHostedMaster(hosted)) {",
    replace: "  if (!hosted) {",
  },
  {
    id: "M8d",
    defect: "hosting: request media read from the registry URI (the original defect)",
    file: "publishing.ts",
    find: "  return { mediaUrl: gate.hostedMaster.uri, digest };",
    replace: "  return { mediaUrl: gate.assetBundle.approvedMasterUri ?? \"\", digest };",
  },
  {
    id: "M8e",
    defect: "hosting: hosted evidence not bound to this receipt",
    file: "publishGate.ts",
    find: "  } else if (hosted.sha256 !== receipt.masterSha256 || hosted.receiptDigest !== receipt.digest) {",
    replace: "  } else if (false) {",
  },
  {
    id: "M9a",
    defect: "producers: QC records a receipt digest for a master it did not watch",
    file: "qualityReviewer.ts",
    find: "    if (renderReceipt.masterSha256 !== requireSha256(observation.masterSha256, \"observation.masterSha256\")) {",
    replace: "    if (false) {",
  },
  {
    id: "M9b",
    defect: "producers: rights records a receipt digest for a different master",
    file: "productVisualAssets.ts",
    find: "      && request.renderReceipt.masterSha256 === approvedMasterSha256;",
    replace: ";",
  },
  {
    id: "M10",
    defect: "unattended publishing: autoPublish honoured",
    file: "publishing.ts",
    find: "  if (config.autoPublish === true) {",
    replace: "  if (false) {",
  },
  {
    id: "M6",
    defect: "fixtures recognised only by their own isFixture flag",
    file: "publishGate.ts",
    find: "      || FIXTURE_SOURCES.has(consumed.renderer)\n      || FIXTURE_SOURCES.has(consumed.provider);",
    replace: ";",
  },
];

function runTests(label) {
  const reportDir = mkdtempSync(join(tmpdir(), "boundary-mutation-"));
  const out = join(reportDir, "report.json");
  spawnSync("npx", ["vitest", "run", ...TESTS, "--reporter=json", `--outputFile=${out}`], {
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 600_000,
  });
  let report;
  try {
    report = JSON.parse(readFileSync(out, "utf8"));
  } catch {
    return { label, crashed: true, failed: [], total: 0 };
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
  const failed = [];
  for (const file of report.testResults) {
    const name = file.name.split("/").pop();
    if (file.status === "failed" && file.assertionResults.length === 0) failed.push(`${name}: (file failed to load) ${file.message ?? ""}`.slice(0, 200));
    for (const test of file.assertionResults) {
      if (test.status === "failed") failed.push(`${name} > ${test.ancestorTitles.join(" > ")} > ${test.title}`);
    }
  }
  return { label, crashed: false, failed, total: report.numTotalTests, passed: report.numPassedTests };
}

const dirty = execFileSync("git", ["status", "--porcelain", "--", ...MUTATIONS.map((m) => `${DIR}/${m.file}`)], { encoding: "utf8" });
if (dirty.trim()) {
  console.error(`Refusing to mutate files with uncommitted changes:\n${dirty}`);
  process.exit(2);
}

const baseline = runTests("baseline");
console.log(`baseline: ${baseline.passed}/${baseline.total} passed, ${baseline.failed.length} failed`);
if (baseline.crashed || baseline.failed.length > 0) {
  console.error("Baseline is not green; mutation results would be meaningless.");
  for (const name of baseline.failed) console.error(`  ${name}`);
  process.exit(1);
}

let inert = 0;
for (const mutation of MUTATIONS) {
  const path = `${DIR}/${mutation.file}`;
  const original = readFileSync(path, "utf8");
  let mutated;
  if (mutation.revertTo) {
    mutated = execFileSync("git", ["show", `${mutation.revertTo}:artifacts/SpecSmith/${path}`], { encoding: "utf8" });
  } else {
    const occurrences = original.split(mutation.find).length - 1;
    if (occurrences !== 1) {
      console.error(`${mutation.id}: expected exactly one match in ${mutation.file}, found ${occurrences}.`);
      process.exit(1);
    }
    mutated = original.replace(mutation.find, mutation.replace);
  }
  let result;
  try {
    writeFileSync(path, mutated);
    result = runTests(mutation.id);
  } finally {
    writeFileSync(path, original);
  }
  const red = result.failed.length;
  if (red === 0) inert += 1;
  console.log(`\n${mutation.id} — defect ${mutation.defect}`);
  console.log(`  ${red === 0 ? "INERT: no test turned red" : `${red} test(s) turned red`}${result.crashed ? " (runner crashed)" : ""}`);
  for (const name of result.failed) console.log(`    ✗ ${name}`);
}

const after = execFileSync("git", ["status", "--porcelain", "--", ...MUTATIONS.map((m) => `${DIR}/${m.file}`)], { encoding: "utf8" });
if (after.trim()) {
  console.error(`Source not restored cleanly:\n${after}`);
  process.exit(2);
}
console.log(`\n${MUTATIONS.length - inert}/${MUTATIONS.length} mutations detected; sources restored.`);
process.exit(inert === 0 ? 0 : 1);
