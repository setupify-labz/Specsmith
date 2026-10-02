// MASTER #8: what real posts can teach the next brief, and what they cannot.
//
// Reads only provider-confirmed publications and the observations stored for
// them. Compares videos within one platform, at the same publication age, on
// one metric definition, and only where exactly one recorded creative variable
// differs. Everything else is reported as an invalid comparison with its
// reason: too new, too few, definitions differ, several variables changed, a
// value unavailable.
//
// An observation ("A had a higher stayed-to-watch rate at 24 hours than B") is
// kept apart from a hypothesis ("the question hook may have helped"). With one
// video per arm nothing here is causal, and the report says so. It never
// approves a claim, changes benchmark data, schedules anything, or authorizes
// publishing: its output is a proposal that re-enters the normal workflow.

import { INDISTINGUISHABLE_RELATIVE_DIFFERENCE } from "../experiment/comparison.ts";
import { lookupMetric } from "../experiment/metrics.ts";
import { listStoredCreativeIds, loadStoredCreativeFingerprint, loadStoredPublicationLedger, publicationStoreMode } from "../../publishingStore.ts";
import type { CreativeFingerprint, VideoPlatform } from "../../types.ts";
import { sha256Json } from "../review/util.ts";
import { loadAuthorization } from "./boundary.ts";
import { loadObservationFailures, loadObservations, type ObservationRecord } from "./observations.ts";

export const LEARNING_REPORT_VERSION = "learning-report-v1";

/**
 * The creative variables compared, read from the fingerprint recorded when the
 * creative's ledger was created (before any result existed), plus the cut.
 */
export const COMPARED_VARIABLES = [
  "hookFamily", "format", "targetDurationSeconds", "voiceName", "editDensity", "plannedBeatChangesPer10Seconds",
  "ctaFamily", "ctaTimingBucket", "firstVisualType", "narrativeEngine", "captionDensity", "variantId",
] as const;
type Variable = (typeof COMPARED_VARIABLES)[number];

/** Metrics a comparison may be built on: each is "primary-eligible" in MASTER #5's registry. */
const COMPARED_METRICS = ["stayed-to-watch-rate", "average-percentage-viewed", "saves", "site-clicks"] as const;

export interface LearningOptions {
  readonly storeRoot: string;
  readonly now?: Date;
  /** Publication ages compared, in hours. */
  readonly checkpointsHours?: readonly number[];
  readonly toleranceHours?: number;
  /** Videos with data at a checkpoint needed before any comparison on that platform is made. */
  readonly minimumVideosPerPlatform?: number;
}

interface PublishedVideo {
  readonly creativeId: string;
  readonly platform: VideoPlatform;
  readonly variantId: string;
  readonly mediaSha256: string;
  readonly providerPostId: string;
  readonly publishedAt: string;
  readonly ageHours: number;
  readonly fingerprint: CreativeFingerprint | null;
  readonly reviewPacketId: string;
  readonly observations: readonly ObservationRecord[];
  readonly failures: number;
}

export interface Comparison {
  readonly platform: VideoPlatform;
  readonly checkpointHours: number;
  readonly metricId: string;
  readonly a: { readonly creativeId: string; readonly value: number | null; readonly observationId: string | null; readonly ageHours: number | null };
  readonly b: { readonly creativeId: string; readonly value: number | null; readonly observationId: string | null; readonly ageHours: number | null };
  readonly differingVariables: readonly string[];
  readonly valid: boolean;
  readonly invalidReasons: readonly string[];
  /** What was seen. Null when the comparison is invalid. */
  readonly observation: string | null;
  /** What might explain it. Never a conclusion. */
  readonly hypothesis: string | null;
  readonly relativeDifference: number | null;
}

export interface ProposedChange {
  readonly variable: Variable;
  readonly tryValue: string;
  readonly insteadOf: string;
  readonly holdConstant: readonly string[];
  readonly metric: string;
  readonly checkpointHours: number;
  readonly basedOn: readonly string[];
  readonly status: string;
}

export interface NextBriefInput {
  readonly version: "next-brief-input-v1";
  readonly reportId: string;
  readonly simulated: boolean;
  readonly evidence: {
    readonly creativeIds: readonly string[];
    readonly providerPostIds: readonly string[];
    readonly mediaSha256s: readonly string[];
    readonly reviewPacketIds: readonly string[];
    readonly observationIds: readonly string[];
  };
  readonly observations: readonly string[];
  readonly hypotheses: readonly string[];
  readonly unknowns: readonly string[];
  readonly proposedChange: ProposedChange | null;
  /** What the next brief may not change, whatever the numbers say. */
  readonly constraints: readonly string[];
  /** Lines for fileWorkflow.buildCreativeBrief's memoryObservations: context, never rules. */
  readonly memoryObservations: readonly string[];
}

export interface LearningReport {
  readonly version: typeof LEARNING_REPORT_VERSION;
  readonly reportId: string;
  readonly generatedAt: string;
  readonly storeMode: "production" | "simulation";
  readonly videos: readonly {
    readonly creativeId: string; readonly platform: VideoPlatform; readonly variantId: string; readonly providerPostId: string;
    readonly mediaSha256: string; readonly publishedAt: string; readonly ageHours: number; readonly observedMetrics: number;
    readonly unavailableMetrics: number; readonly failedCollections: number; readonly comparableAt: readonly number[]; readonly note: string;
  }[];
  readonly comparisons: readonly Comparison[];
  readonly retention: readonly { readonly creativeId: string; readonly available: boolean; readonly note: string }[];
  readonly unknowns: readonly string[];
  readonly nextBrief: NextBriefInput;
}

const CONSTRAINTS = [
  "Every factual claim, figure and disclosure stays exactly as research and MASTER #7 require; performance data never changes what may be said.",
  "Benchmark and model data are not changed by analytics.",
  "The proposed change is a creative execution choice to test, not an approved claim, a schedule, or an authorization to publish.",
  "The next concepts go through research, the creative workflow, rendering, MASTER #7 review and trusted human approval like any other.",
];

function nearest(records: readonly ObservationRecord[], metricId: string, checkpoint: number, tolerance: number): ObservationRecord | null {
  return records.filter((record) => record.metricId === metricId && Math.abs(record.publicationAgeHours - checkpoint) <= tolerance)
    .sort((x, y) => Math.abs(x.publicationAgeHours - checkpoint) - Math.abs(y.publicationAgeHours - checkpoint) || Date.parse(y.collectedAt) - Date.parse(x.collectedAt))[0] ?? null;
}

function variableValue(video: PublishedVideo, variable: Variable): string {
  if (variable === "variantId") return video.variantId;
  const value = video.fingerprint?.[variable as keyof CreativeFingerprint];
  return value === undefined ? "(not recorded)" : String(value);
}

function steepestDrop(record: ObservationRecord): string {
  const { seconds, shareWatching } = record.curve!;
  let worst = { from: seconds[0], to: seconds[1], drop: -Infinity };
  for (let index = 1; index < seconds.length; index += 1) {
    const drop = (shareWatching[index - 1] - shareWatching[index]) / Math.max(1e-9, seconds[index] - seconds[index - 1]);
    if (drop > worst.drop) worst = { from: seconds[index - 1], to: seconds[index], drop };
  }
  const at = (second: number) => shareWatching[seconds.indexOf(second)];
  return `steepest loss between ${worst.from}s and ${worst.to}s (${Math.round(at(worst.from) * 100)}% → ${Math.round(at(worst.to) * 100)}% still watching)`;
}

export async function buildLearningReport(options: LearningOptions): Promise<LearningReport> {
  const now = options.now ?? new Date();
  const checkpoints = options.checkpointsHours ?? [24, 72, 168];
  const tolerance = options.toleranceHours ?? 6;
  const minimum = options.minimumVideosPerPlatform ?? 2;
  const storeMode = await publicationStoreMode(options.storeRoot);
  const simulated = storeMode === "simulation";
  const label = simulated ? "[SIMULATED] " : "";

  // Only creatives a provider confirmed as published.
  const videos: PublishedVideo[] = [];
  const legacy: string[] = [];
  // Sorted by id, so comparisons and reports come out in a stable, readable order.
  for (const creativeId of (await listStoredCreativeIds(options.storeRoot)).sort()) {
    const ledger = await loadStoredPublicationLedger(options.storeRoot, creativeId);
    if (ledger?.legacy) { legacy.push(creativeId); continue; }
    const published = ledger?.events.find((event) => event.status === "published" && event.providerPostId);
    const authorization = await loadAuthorization(options.storeRoot, creativeId);
    if (!ledger || !published || !authorization) continue;
    const reviewed = ledger.events.find((event) => event.status === "machine-reviewed");
    const observations = (await loadObservations(options.storeRoot, published.providerPostId!)).filter((record) => record.simulated === simulated);
    videos.push({
      creativeId, platform: ledger.platform, variantId: authorization.variantId, mediaSha256: authorization.mediaSha256,
      providerPostId: published.providerPostId!, publishedAt: published.at,
      ageHours: Math.round(((now.getTime() - Date.parse(published.at)) / 3_600_000) * 10) / 10,
      fingerprint: await loadStoredCreativeFingerprint(options.storeRoot, creativeId),
      reviewPacketId: String(reviewed?.evidence?.reviewPacketId ?? ""),
      observations, failures: (await loadObservationFailures(options.storeRoot, published.providerPostId!)).length,
    });
  }

  const unknowns: string[] = [];
  if (legacy.length) unknowns.push(`Excluded ${legacy.length} legacy ledger(s) (${legacy.join(", ")}): written by the score-based route with no MASTER #7 review, so they are not treated as reviewed or confirmed publications.`);
  const comparisons: Comparison[] = [];
  const platforms = [...new Set(videos.map((video) => video.platform))];
  for (const platform of platforms) {
    const group = videos.filter((video) => video.platform === platform);
    for (const checkpoint of checkpoints) {
      for (const metricId of COMPARED_METRICS) {
        const definition = lookupMetric(platform, metricId);
        if (!definition?.validWindows.some((window) => ({ "1h": 1, "6h": 6, "24h": 24, "72h": 72, "7d": 168 })[window] === checkpoint)) continue;
        const withData = group.filter((video) => nearest(video.observations, metricId, checkpoint, tolerance)?.state === "observed");
        for (let i = 0; i < group.length; i += 1) {
          for (let j = i + 1; j < group.length; j += 1) {
            const [x, y] = [group[i], group[j]];
            const ox = nearest(x.observations, metricId, checkpoint, tolerance);
            const oy = nearest(y.observations, metricId, checkpoint, tolerance);
            const differing = COMPARED_VARIABLES.filter((variable) => variableValue(x, variable) !== variableValue(y, variable));
            const reasons: string[] = [];
            for (const [video, observation] of [[x, ox], [y, oy]] as const) {
              if (video.ageHours < checkpoint - tolerance) reasons.push(`${video.creativeId} is ${video.ageHours}h old, too new for a ${checkpoint}h comparison`);
              else if (!observation) reasons.push(`${video.creativeId} has no ${metricId} observation within ${tolerance}h of ${checkpoint}h`);
              else if (observation.state !== "observed") reasons.push(`${video.creativeId}'s ${metricId} is ${observation.state}: ${observation.unavailableReason ?? ""}`.trim());
              if (!video.fingerprint) reasons.push(`${video.creativeId} has no recorded creative fingerprint, so what differs cannot be known`);
            }
            if (ox && oy && ox.definitionId !== oy.definitionId) reasons.push(`metric definitions differ (${ox.definitionId} vs ${oy.definitionId})`);
            if (withData.length < minimum) reasons.push(`only ${withData.length} ${platform} video(s) have ${metricId} at ${checkpoint}h; at least ${minimum} are needed`);
            if (differing.length === 0) reasons.push("no recorded variable differs, so the comparison cannot inform a creative choice");
            if (differing.length > 1) reasons.push(`${differing.length} variables changed at once (${differing.join(", ")}); any difference is not attributable to one of them`);
            const valid = reasons.length === 0;
            const va = ox?.value ?? null, vb = oy?.value ?? null;
            let observation: string | null = null, hypothesis: string | null = null, relative: number | null = null;
            if (valid && va !== null && vb !== null) {
              relative = Math.abs(va - vb) / Math.max(Math.abs(va), Math.abs(vb), 1e-9);
              const variable = differing[0] as Variable;
              const [hi, lo, vhi, vlo] = va >= vb ? [x, y, va, vb] : [y, x, vb, va];
              if (relative < INDISTINGUISHABLE_RELATIVE_DIFFERENCE) {
                observation = `${label}At ${checkpoint}h on ${platform}, ${x.creativeId} and ${y.creativeId} had ${metricId} within ${Math.round(INDISTINGUISHABLE_RELATIVE_DIFFERENCE * 100)}% of each other (${va} vs ${vb}).`;
              } else {
                observation = `${label}At ${checkpoint}h on ${platform}, ${hi.creativeId} (${variable} = ${variableValue(hi, variable)}) had a higher ${metricId} than ${lo.creativeId} (${variable} = ${variableValue(lo, variable)}): ${vhi} vs ${vlo}.`;
                hypothesis = `${variable} = "${variableValue(hi, variable)}" may have contributed. One video per side: this is a hypothesis to test, not a finding. Topic demand and distribution can move ${metricId} on their own.`;
              }
            }
            comparisons.push({
              platform, checkpointHours: checkpoint, metricId,
              a: { creativeId: x.creativeId, value: va, observationId: ox?.observationId ?? null, ageHours: ox?.publicationAgeHours ?? null },
              b: { creativeId: y.creativeId, value: vb, observationId: oy?.observationId ?? null, ageHours: oy?.publicationAgeHours ?? null },
              differingVariables: differing, valid, invalidReasons: reasons, observation, hypothesis, relativeDifference: relative,
            });
          }
        }
      }
    }
    if (group.length < minimum) unknowns.push(`Only ${group.length} published ${platform} video(s): nothing on ${platform} can be compared yet.`);
  }
  if (videos.length === 0) unknowns.push("No provider-confirmed publication exists in this store; there is no performance to learn from.");

  const retention = videos.map((video) => {
    const curve = [...video.observations].reverse().find((record) => record.metricId === "retention-curve" && record.state === "observed");
    return curve
      ? { creativeId: video.creativeId, available: true, note: `${label}${steepestDrop(curve)}, at ${curve.publicationAgeHours}h.` }
      : { creativeId: video.creativeId, available: false, note: "No retention curve was returned; where viewers left is unknown." };
  });
  if (retention.some((entry) => !entry.available)) unknowns.push("Where viewers left is unknown for videos without a provider retention curve.");
  unknowns.push("Why any difference happened: no experiment assigned variants at random, so topic, timing and distribution remain possible explanations.");
  for (const metricId of COMPARED_METRICS) {
    const missing = videos.filter((video) => !video.observations.some((record) => record.metricId === metricId && record.state === "observed"));
    if (missing.length) unknowns.push(`${metricId} was not observed for ${missing.map((video) => video.creativeId).join(", ")}.`);
  }

  // One testable change: the largest distinguishable single-variable difference
  // on a primary-eligible metric. None when nothing qualifies.
  const candidates = comparisons.filter((entry) => entry.valid && entry.hypothesis && entry.relativeDifference !== null)
    .sort((a, b) => b.relativeDifference! - a.relativeDifference!);
  let proposedChange: ProposedChange | null = null;
  if (candidates.length) {
    const best = candidates[0];
    const x = videos.find((video) => video.creativeId === best.a.creativeId)!;
    const y = videos.find((video) => video.creativeId === best.b.creativeId)!;
    const variable = best.differingVariables[0] as Variable;
    const [hi, lo] = (best.a.value ?? 0) >= (best.b.value ?? 0) ? [x, y] : [y, x];
    proposedChange = {
      variable, tryValue: variableValue(hi, variable), insteadOf: variableValue(lo, variable),
      holdConstant: COMPARED_VARIABLES.filter((entry) => entry !== variable).map((entry) => `${entry} = ${variableValue(hi, entry)}`),
      metric: best.metricId, checkpointHours: best.checkpointHours,
      basedOn: [best.a.observationId!, best.b.observationId!],
      status: "A hypothesis to test in the next batch, with every other recorded variable held constant. Based on one video per side; not a causal result.",
    };
  }

  const included = videos.filter((video) => video.observations.length);
  const observations = comparisons.filter((entry) => entry.valid && entry.observation).map((entry) => entry.observation!);
  const hypotheses = comparisons.filter((entry) => entry.hypothesis).map((entry) => entry.hypothesis!);
  const reportBody = { generatedAt: now.toISOString(), storeMode, videos: included.map((video) => video.creativeId), observations };
  const reportId = `learning-${sha256Json(reportBody).slice(0, 16)}`;
  const evidence = {
    creativeIds: included.map((video) => video.creativeId),
    providerPostIds: included.map((video) => video.providerPostId),
    mediaSha256s: included.map((video) => video.mediaSha256),
    reviewPacketIds: included.map((video) => video.reviewPacketId).filter(Boolean),
    observationIds: [...new Set(comparisons.flatMap((entry) => [entry.a.observationId, entry.b.observationId]).filter((id): id is string => id !== null))],
  };
  const memoryObservations = [
    ...observations.map((line) => `Observation from published videos (context, not a rule; report ${reportId}): ${line}`),
    ...(proposedChange ? [`Hypothesis to test (report ${reportId}, evidence ${proposedChange.basedOn.join(", ")}): try ${proposedChange.variable} = "${proposedChange.tryValue}" instead of "${proposedChange.insteadOf}", holding everything else constant. One video per side; not a causal result.`] : []),
  ];

  return {
    version: LEARNING_REPORT_VERSION,
    reportId,
    generatedAt: now.toISOString(),
    storeMode,
    videos: videos.map((video) => {
      const observed = video.observations.filter((record) => record.state !== "unavailable");
      const comparableAt = checkpoints.filter((checkpoint) => COMPARED_METRICS.some((metric) => nearest(video.observations, metric, checkpoint, tolerance)?.state === "observed"));
      return {
        creativeId: video.creativeId, platform: video.platform, variantId: video.variantId, providerPostId: video.providerPostId,
        mediaSha256: video.mediaSha256, publishedAt: video.publishedAt, ageHours: video.ageHours,
        observedMetrics: observed.length, unavailableMetrics: video.observations.length - observed.length, failedCollections: video.failures,
        comparableAt,
        note: comparableAt.length ? `${label}Has comparable data at ${comparableAt.map((hours) => `${hours}h`).join(", ")}.` : `${label}No comparable observation yet.`,
      };
    }),
    comparisons,
    retention,
    unknowns,
    nextBrief: {
      version: "next-brief-input-v1", reportId, simulated, evidence, observations, hypotheses, unknowns, proposedChange,
      constraints: CONSTRAINTS, memoryObservations,
    },
  };
}

/** The report for an editor: what can be compared, what was seen, what is unknown, what to try. */
export function formatLearningReport(report: LearningReport): string {
  const lines: string[] = [];
  lines.push(`LEARNING REPORT ${report.reportId}${report.storeMode === "simulation" ? " — SIMULATED DATA, NOT REAL PERFORMANCE" : ""}`);
  lines.push(`Generated ${report.generatedAt}`);
  lines.push("", "Which videos have enough comparable data?");
  for (const video of report.videos) lines.push(`  - ${video.creativeId} (${video.platform}, ${video.variantId}, post ${video.providerPostId}, ${video.ageHours}h old): ${video.note} ${video.observedMetrics} observed, ${video.unavailableMetrics} unavailable, ${video.failedCollections} failed collection(s).`);
  if (!report.videos.length) lines.push("  - None. No provider-confirmed publication exists.");
  lines.push("", "Where did viewers appear to leave?");
  for (const entry of report.retention) lines.push(`  - ${entry.creativeId}: ${entry.note}`);
  lines.push("", "Which creative choices are associated with stronger or weaker results? (observations, then hypotheses)");
  const valid = report.comparisons.filter((entry) => entry.valid);
  for (const entry of valid) {
    lines.push(`  - Observed: ${entry.observation}`);
    if (entry.hypothesis) lines.push(`    Hypothesis: ${entry.hypothesis}`);
  }
  if (!valid.length) lines.push("  - No valid comparison yet.");
  const invalid = report.comparisons.filter((entry) => !entry.valid);
  if (invalid.length) {
    lines.push("", `Comparisons that are not valid (${invalid.length}):`);
    // A checkpoint where no video has any observation yet is one fact, not many.
    const empty = new Set<string>();
    for (const entry of invalid) {
      const key = `${entry.platform}@${entry.checkpointHours}`;
      const atCheckpoint = report.comparisons.filter((other) => `${other.platform}@${other.checkpointHours}` === key);
      if (atCheckpoint.every((other) => other.a.observationId === null && other.b.observationId === null)) empty.add(key);
    }
    for (const key of empty) {
      const [platform, hours] = key.split("@");
      lines.push(`  - ${platform} at ${hours}h: no video has an observation within the window yet (too new, or not collected).`);
    }
    for (const entry of invalid) {
      if (empty.has(`${entry.platform}@${entry.checkpointHours}`)) continue;
      lines.push(`  - ${entry.a.creativeId} vs ${entry.b.creativeId}, ${entry.metricId} at ${entry.checkpointHours}h: ${entry.invalidReasons.join("; ")}.`);
    }
  }
  lines.push("", "What remains unknown?");
  for (const unknown of report.unknowns) lines.push(`  - ${unknown}`);
  lines.push("", "One testable change for the next brief:");
  const change = report.nextBrief.proposedChange;
  if (change) {
    lines.push(`  Try ${change.variable} = "${change.tryValue}" instead of "${change.insteadOf}", measured on ${change.metric} at ${change.checkpointHours}h.`);
    lines.push(`  Hold constant: ${change.holdConstant.join("; ")}.`);
    lines.push(`  Status: ${change.status}`);
  } else {
    lines.push("  None justified yet: no valid single-variable comparison shows a distinguishable difference.");
  }
  lines.push("", "This report cannot approve a claim, change benchmark data, schedule a post or authorize publishing.");
  return lines.join("\n");
}
