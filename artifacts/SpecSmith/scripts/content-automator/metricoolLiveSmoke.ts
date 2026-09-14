// The ONE way to make a real Metricool call from this repository.
//
// It is deliberately awkward to run. Three independent things must all be true,
// and none of them is a default:
//
//   1. SPECSMITH_METRICOOL_LIVE=i-understand-this-calls-metricool
//   2. METRICOOL_USER_TOKEN and METRICOOL_USER_ID present in the environment
//   3. --confirm-live passed on the command line
//
// Missing any one of them exits without touching the network. No CI workflow
// sets any of them, and contentE2eOfflineWorkflowSafety.test.ts asserts this
// script is not invoked by the offline pipeline, so an ordinary CI run cannot
// reach a paid or public call by accident.
//
// WHAT IT DOES, AND WHAT IT REFUSES TO DO
// ---------------------------------------
// It schedules a DRAFT. metricoolClient's publish mode is hard-coded to
// "draft" here and there is no flag to change it: the point of a live smoke
// test is to prove the transport, the credentials and the response parsing
// work against the real API, which a draft proves completely. Nothing this
// script can do results in a public post. Promoting a draft to a live post is
// a deliberate human action in Metricool's own UI.

import { parseArgs } from "node:util";

import {
  metricoolCredentialsFromEnv,
  publishApprovedPackage,
  type ApprovedPublicationPackage,
  type MetricoolTransport,
} from "./metricoolClient.ts";

const LIVE_ACKNOWLEDGEMENT = "i-understand-this-calls-metricool";

export interface LiveSmokeGate {
  readonly allowed: boolean;
  readonly reason?: string;
}

/**
 * Decides whether a real call may be made. Exported so a test can assert every
 * refusal without ever setting the variables for real.
 */
export function evaluateLiveSmokeGate(
  env: NodeJS.ProcessEnv,
  flags: { confirmLive?: boolean },
): LiveSmokeGate {
  if (!flags.confirmLive) {
    return { allowed: false, reason: "--confirm-live was not passed." };
  }
  if (env.SPECSMITH_METRICOOL_LIVE !== LIVE_ACKNOWLEDGEMENT) {
    return { allowed: false, reason: `SPECSMITH_METRICOOL_LIVE must be set to "${LIVE_ACKNOWLEDGEMENT}".` };
  }
  if (!metricoolCredentialsFromEnv(env)) {
    return { allowed: false, reason: "METRICOOL_USER_TOKEN and METRICOOL_USER_ID must both be set." };
  }
  return { allowed: true };
}

/** The real transport, constructed only after the gate allows it. */
function liveTransport(): MetricoolTransport {
  return async (url, init) => {
    const response = await fetch(url, { method: init.method, headers: init.headers, body: init.body || undefined });
    return { status: response.status, text: () => response.text() };
  };
}

export async function runLiveSmoke(
  pkg: ApprovedPublicationPackage,
  storeRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  flags: { confirmLive?: boolean } = {},
): Promise<void> {
  const gate = evaluateLiveSmokeGate(env, flags);
  if (!gate.allowed) {
    console.log(`Live Metricool smoke NOT run: ${gate.reason}`);
    console.log("This is the safe default. Nothing was sent and no credential was used.");
    return;
  }

  const credentials = metricoolCredentialsFromEnv(env);
  if (!credentials) throw new Error("Credentials vanished between the gate and the call.");

  console.log("Scheduling a DRAFT post against the real Metricool API. This never becomes public by itself.");
  const result = await publishApprovedPackage(pkg, {
    storeRoot,
    credentials,
    transport: liveTransport(),
    // Hard-coded. There is no flag that makes this "scheduled-live".
    mode: "draft",
  });

  console.log(`Draft scheduled. providerPostId=${result.providerPostId} platform=${result.platform}`);
  console.log(`Verified media sha256=${result.verifiedSha256}`);
  console.log("Review it in Metricool and release it manually if it is correct.");
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  const { values } = parseArgs({ options: { "confirm-live": { type: "boolean", default: false } }, strict: false });
  const gate = evaluateLiveSmokeGate(process.env, { confirmLive: Boolean(values["confirm-live"]) });
  console.log(gate.allowed
    ? "Live gate OPEN. Supply an approved publication package to runLiveSmoke() to schedule a draft."
    : `Live gate CLOSED: ${gate.reason}`);
  console.log("This entry point never schedules anything on its own; it reports the gate only.");
}
