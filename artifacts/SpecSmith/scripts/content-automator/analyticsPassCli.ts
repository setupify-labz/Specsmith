// The one entry point that runs an analytics pass.
//
// It is a thin boundary on purpose. Argument parsing, exit codes and output
// formatting live here; every decision about what may be measured and what may
// be learned stays in analyticsOrchestrator.ts and the modules beneath it, so
// running the CLI cannot be a way around a gate.
//
// EXIT CODES
// ----------
//   0  the pass ran. That includes "no learning yet", which is a true and
//      expected answer — a cron job that reported failure every night until
//      enough windows had been captured would train its operator to ignore it.
//   1  a genuine execution or configuration failure: a missing or invalid
//      argument, an unreadable store, or collection asked for without the
//      credentials it needs.
//
// TWO MODES, AND WHY THE DEFAULT IS THE OFFLINE ONE
// -------------------------------------------------
// The founder's Metricool plan exposes no REST access, so analytics READS are
// not available today either. The default mode therefore touches no network:
// it scans what is eligible and learns from snapshots already stored, which is
// exactly what is useful on the current plan. Fetching new snapshots is opt-in
// via --collect, needs credentials that do not currently exist, and fails
// closed with a configuration error when they are absent.
//
// This CLI never posts, never publishes, never schedules, and holds no
// credentials of its own beyond reading the existing environment helper.

import { parseArgs } from "node:util";

import {
  formatAnalyticsPass,
  runAnalyticsPass,
  scanEligiblePublications,
  type OrchestrationResult,
} from "./analyticsOrchestrator.ts";
import { runLearningFromStoredSnapshots } from "./metricoolAnalyticsCollector.ts";
import { metricoolCredentialsFromEnv, type MetricoolTransport } from "./metricoolClient.ts";
import type { SnapshotWindow } from "./types.ts";

export const LEARNING_WINDOWS: readonly SnapshotWindow[] = ["1h", "6h", "24h", "72h", "7d"];

export class AnalyticsPassCliError extends Error {
  readonly code: "invalid-argument" | "missing-configuration";
  constructor(code: "invalid-argument" | "missing-configuration", message: string) {
    super(message);
    this.name = "AnalyticsPassCliError";
    this.code = code;
  }
}

export interface CliInvocation {
  readonly storeRoot: string;
  readonly window: SnapshotWindow;
  readonly collect: boolean;
  readonly blogId?: string;
  readonly json: boolean;
}

/**
 * Parses and validates arguments.
 *
 * The learning window is REQUIRED and has no default. Which window to compare
 * on is an editorial decision — 1h measures the algorithm's first impression,
 * 7d measures whether anyone kept watching — and silently picking one would
 * make every downstream number quietly mean something the operator did not
 * choose.
 */
export function parseCliArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): CliInvocation {
  let values: Record<string, unknown>;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        store: { type: "string" },
        window: { type: "string" },
        collect: { type: "boolean", default: false },
        "blog-id": { type: "string" },
        json: { type: "boolean", default: false },
      },
      strict: true,
    }) as { values: Record<string, unknown> });
  } catch (error) {
    throw new AnalyticsPassCliError("invalid-argument", (error as Error).message);
  }

  const storeRoot = typeof values.store === "string" ? values.store.trim() : "";
  if (!storeRoot) {
    throw new AnalyticsPassCliError("invalid-argument", "--store <path> is required: the durable publication store to read.");
  }

  const window = typeof values.window === "string" ? values.window.trim() : "";
  if (!window) {
    throw new AnalyticsPassCliError(
      "invalid-argument",
      `--window is required and has no default. Choose one of: ${LEARNING_WINDOWS.join(", ")}.`,
    );
  }
  if (!LEARNING_WINDOWS.includes(window as SnapshotWindow)) {
    throw new AnalyticsPassCliError(
      "invalid-argument",
      `--window ${JSON.stringify(window)} is not a snapshot window. Choose one of: ${LEARNING_WINDOWS.join(", ")}.`,
    );
  }

  const collect = values.collect === true;
  const blogId = typeof values["blog-id"] === "string" ? values["blog-id"].trim() : "";

  if (collect) {
    // Fail closed, and say which piece is missing rather than attempting a
    // request that would certainly fail.
    if (!blogId) {
      throw new AnalyticsPassCliError("missing-configuration", "--collect requires --blog-id.");
    }
    if (!metricoolCredentialsFromEnv(env)) {
      throw new AnalyticsPassCliError(
        "missing-configuration",
        "--collect requires METRICOOL_USER_TOKEN and METRICOOL_USER_ID. The current Metricool plan exposes no API access, so collection is not available; run without --collect to scan and learn from stored snapshots.",
      );
    }
  }

  return { storeRoot, window: window as SnapshotWindow, collect, blogId: blogId || undefined, json: values.json === true };
}

/** What the pass found, in a shape a machine can consume without parsing prose. */
export interface CliSummary {
  readonly mode: "scan" | "collect";
  readonly window: SnapshotWindow;
  readonly eligible: number;
  readonly skipped: { creativeId: string; reason: string }[];
  readonly captured: { creativeId: string; window: SnapshotWindow }[];
  readonly missed: { creativeId: string; windows: SnapshotWindow[] }[];
  readonly notCaptured: { creativeId: string; window: SnapshotWindow; status: string; detail: string }[];
  readonly learningStatus: "learned" | "no-learning-yet";
  readonly learningReason?: string;
  readonly excludedFromLearning: { creativeId: string; availableWindows: SnapshotWindow[] }[];
  readonly recommendations: string[];
}

export function summarize(result: OrchestrationResult, mode: "scan" | "collect"): CliSummary {
  const captured: CliSummary["captured"] = [];
  const notCaptured: CliSummary["notCaptured"] = [];
  for (const outcome of result.collection.outcomes) {
    if (outcome.status === "captured") captured.push({ creativeId: outcome.creativeId, window: outcome.window });
    else if (outcome.status === "no-data" || outcome.status === "failed") {
      notCaptured.push({ creativeId: outcome.creativeId, window: outcome.window, status: outcome.status, detail: outcome.detail });
    }
  }
  return {
    mode,
    window: result.learningWindow,
    eligible: result.scan.eligible.length,
    skipped: result.scan.skipped.map((entry) => ({ creativeId: entry.creativeId, reason: entry.reason })),
    captured,
    missed: result.collection.missed.map((entry) => ({ creativeId: entry.creativeId, windows: entry.windows })),
    notCaptured,
    learningStatus: result.learningStatus,
    ...(result.learningReason ? { learningReason: result.learningReason } : {}),
    excludedFromLearning: result.excludedFromLearning,
    recommendations: result.learning?.recommendations ?? [],
  };
}

export interface RunCliOptions {
  readonly transport?: MetricoolTransport;
  readonly now?: Date;
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Runs the pass described by the invocation.
 *
 * In scan mode nothing is fetched: eligibility comes from the durable store
 * and learning reads snapshots already recorded. The OrchestrationResult is
 * assembled with an empty collection report — which is honest, because no
 * collection was attempted. It is NOT a report of zero results.
 */
export async function runCli(
  invocation: CliInvocation,
  options: RunCliOptions = {},
): Promise<{ summary: CliSummary; result: OrchestrationResult }> {
  const now = options.now ?? new Date();

  if (!invocation.collect) {
    const scan = await scanEligiblePublications(invocation.storeRoot, now);
    const run = await runLearningFromStoredSnapshots(
      invocation.storeRoot,
      scan.eligible.map((publication) => publication.creativeId),
      invocation.window,
      now,
    );
    const result: OrchestrationResult = {
      collection: { outcomes: [], missed: [] },
      scan,
      learningWindow: invocation.window,
      learning: run.learning ?? null,
      learningStatus: run.learning ? "learned" : "no-learning-yet",
      ...(run.learning ? {} : {
        learningReason: scan.eligible.length === 0
          ? "No creative has a published ledger event with a provider id and a stored fingerprint."
          : `No creative has a captured ${invocation.window} snapshot yet.`,
      }),
      excludedFromLearning: run.selection.excluded.map((entry) => ({
        creativeId: entry.creativeId,
        availableWindows: entry.availableWindows,
      })),
    };
    return { summary: summarize(result, "scan"), result };
  }

  const credentials = metricoolCredentialsFromEnv(options.env ?? process.env);
  if (!credentials) {
    // parseCliArgs already refuses this; repeated so runCli is safe to call
    // directly without re-deriving the guard.
    throw new AnalyticsPassCliError("missing-configuration", "Metricool credentials are not configured.");
  }
  if (!options.transport) {
    throw new AnalyticsPassCliError("missing-configuration", "No analytics transport was supplied for --collect.");
  }

  const result = await runAnalyticsPass({
    storeRoot: invocation.storeRoot,
    credentials,
    transport: options.transport,
    blogId: invocation.blogId ?? "",
    learningWindow: invocation.window,
    now,
  });
  return { summary: summarize(result, "collect"), result };
}

/** Human-readable rendering, built from the same result the JSON describes. */
export function formatCli(summary: CliSummary, result: OrchestrationResult): string {
  return [
    `SpecSmith analytics pass — mode=${summary.mode} window=${summary.window}`,
    formatAnalyticsPass(result),
  ].join("\n");
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  void (async () => {
    let invocation: CliInvocation;
    try {
      invocation = parseCliArgs(process.argv.slice(2));
    } catch (error) {
      console.error(`${(error as Error).message}`);
      console.error("\nUsage:");
      console.error("  pnpm run content:analytics:pass --store <path> --window <1h|6h|24h|72h|7d> [--collect --blog-id <id>] [--json]");
      // Note the absence of `--` before the flags: pnpm 10 forwards a literal
      // `--` into argv, which strict parsing then rejects. Verified directly
      // against this CLI rather than assumed.
      console.error("  (no `--` before the flags: pnpm forwards it literally and strict parsing rejects it)");
      process.exitCode = 1;
      return;
    }

    try {
      const { summary, result } = await runCli(invocation);
      // "no learning yet" is a true answer, so it prints and exits 0.
      console.log(invocation.json ? JSON.stringify(summary, null, 2) : formatCli(summary, result));
    } catch (error) {
      console.error(`Analytics pass failed: ${(error as Error).message}`);
      process.exitCode = 1;
    }
  })();
}
