// Two properties of the MASTER #8 ledger:
//
// 1. A ledger written by the old score-based route (generated -> qc-passed ->
//    scheduled -> published ...) is still readable, with its whole history,
//    but nothing treats it as MASTER #7 reviewed, authorized or
//    provider-confirmed, and it can only be stopped.
// 2. An ordinary caller cannot forge a transition receipt, reuse one, move one
//    to another ledger position or store, strip its simulated flag, or put a
//    simulated event or approval into a production store, and cannot become a
//    second receipt issuer.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  advancePublicationLedger,
  claimLedgerAuthority,
  ledgerAuthorityClaimed,
  type PublicationEvent,
  type PublicationLedger,
  type TransitionReceipt,
} from "../../publishing.ts";
import {
  advanceStoredPublicationLedger,
  bindProviderPost,
  createStoredPublicationLedger,
  initPublicationStore,
  loadStoredPublicationLedger,
} from "../../publishingStore.ts";
import { assertPublicationGatesPassed, type ApprovedPublicationPackage } from "../../publicationIntegrity.ts";
import { reportCreativeStatus } from "../../publicationStatusReport.ts";
import { eligibilityFor } from "../../analyticsOrchestrator.ts";
import type { CreativeFingerprint } from "../../types.ts";
import { createMetricoolRestProvider } from "../../metricoolClient.ts";
import {
  authorizePublication,
  createSimulatedApprovalVerifier,
  loadAuthorization,
  recordMachineReview,
  seedSimulatedLedger,
  submitAuthorizedPublication,
  type ProviderPublicationRequest,
} from "./boundary.ts";
import { createSimulatedObservationSource, importProviderObservations } from "./observations.ts";
import { buildLearningReport } from "./learningReport.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function store(mode?: "production" | "simulation"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "master8-ledger-"));
  roots.push(root);
  if (mode) await initPublicationStore(root, mode, "test");
  return root;
}

const fingerprint = (creativeId: string): CreativeFingerprint => ({
  version: "creative-fingerprint-v1", creativeId, packageId: "package-1", campaignId: "campaign-1", ideaId: "idea-1",
  platform: "youtube-shorts", format: "comparison", feature: "compare", subjectIds: [], hookFamily: "price-gap", hookText: "Worth it?",
  visualWorld: "ui", narrativeEngine: "result-first", targetDurationSeconds: 20, beatCount: 4, plannedBeatChangesPer10Seconds: 1.5,
  editDensity: "medium", captionedBeatRatio: 1, captionDensity: "medium", firstVisualType: "deterministic-ui", sfxDensity: "low",
  ctaFamily: "compare-on-specsmithpc", ctaTimingBucket: "late", hashtagStrategy: "intent-balanced-v1", hashtags: [],
  experimentId: "none", experimentPrimaryMetric: "retention", changedVariable: "none", contentFreshness: "evergreen",
} as CreativeFingerprint);

const DESTINATION = { provider: "metricool" as const, accountId: "specsmithpc-main", platform: "youtube-shorts" as const };

/** Write events the way the pre-MASTER-#8 code did: plain files, no receipts, no evidence. */
async function writeLegacyLedger(root: string, creativeId: string, statuses: readonly PublicationEvent[]): Promise<void> {
  await createStoredPublicationLedger(root, fingerprint(creativeId), new Date("2026-09-01T10:00:00Z"));
  const directory = join(root, "publication-ledgers", createHash("sha256").update(creativeId).digest("hex"));
  for (const [index, event] of statuses.entries()) {
    await writeFile(join(directory, `${String(index + 1).padStart(6, "0")}.json`),
      JSON.stringify({ version: 1, creativeId, packageId: "package-1", platform: "youtube-shorts", event }));
  }
}

const LEGACY_HISTORY: PublicationEvent[] = [
  { status: "qc-passed", at: "2026-09-01T11:00:00Z", note: "Passed automated review at 8.7/10." },
  { status: "scheduled", at: "2026-09-01T12:00:00Z", note: "metricool:draft", providerPostId: "legacy-post-1" },
  { status: "published", at: "2026-09-02T12:00:00Z", note: "metricool-connector:published", providerPostId: "legacy-post-1", providerUrl: "https://youtube.com/shorts/legacy" },
  { status: "analytics-partial", at: "2026-09-03T12:00:00Z" },
];

describe("legacy qc-passed ledgers are readable, and are not MASTER #7 approved", () => {
  it("loads the whole old history and marks the ledger legacy", async () => {
    const root = await store();
    await writeLegacyLedger(root, "legacy-1", LEGACY_HISTORY);
    const ledger = (await loadStoredPublicationLedger(root, "legacy-1"))!;
    expect(ledger.events.map((event) => event.status)).toEqual(["generated", "qc-passed", "scheduled", "published", "analytics-partial"]);
    expect(ledger.legacy).toMatchObject({ since: "2026-09-01T11:00:00Z" });
    expect(ledger.legacy!.reason).toMatch(/self-reported quality score, with no MASTER #7 review/);
  });

  it("is reported as legacy and unverified, with its last recorded state kept visible", async () => {
    const root = await store();
    await writeLegacyLedger(root, "legacy-1", LEGACY_HISTORY);
    const status = (await reportCreativeStatus(root, "legacy-1", new Date("2026-10-01T00:00:00Z")))!;
    expect(status.stage).toBe("legacy-unverified");
    expect(status.ledgerStatus).toBe("analytics-partial");
    expect(status.legacy?.since).toBe("2026-09-01T11:00:00Z");
  });

  it("is not reviewed, authorized or provider-confirmed for any MASTER #8 consumer", async () => {
    const root = await store();
    await writeLegacyLedger(root, "legacy-1", LEGACY_HISTORY.slice(0, 1));
    const ledger = (await loadStoredPublicationLedger(root, "legacy-1"))!;

    // Release gate (handoff and REST routes).
    const pkg = {
      request: { requestId: "r", creativeId: "legacy-1", platform: "youtube-shorts", media: ["https://cdn.example/m.mp4"], date: "2026-10-05T18:00:00",
        timezone: "America/New_York", finalMediaSha256: "a".repeat(64), blog_id: "specsmithpc-main", text: "t" },
      mediaPath: "/nonexistent", approvedMasterSha256: "a".repeat(64),
    } as unknown as ApprovedPublicationPackage;
    expect(() => assertPublicationGatesPassed(pkg, ledger)).toThrow(/legacy ledger .* not MASTER #7 reviewed or authorized/);

    // The boundary: no authorization, and every protected step refuses the ledger by name.
    expect(await loadAuthorization(root, "legacy-1")).toBeNull();
    let transportCalls = 0;
    const provider = createMetricoolRestProvider({ credentials: { userToken: "t", userId: "u" }, transport: async () => { transportCalls += 1; return { status: 200, text: async () => "{}" }; } });
    await expect(submitAuthorizedPublication({ storeRoot: root, request: { creativeId: "legacy-1" } as ProviderPublicationRequest, mediaPath: "/nonexistent", provider }))
      .rejects.toMatchObject({ code: "legacy-ledger" });
    expect(transportCalls).toBe(0);

    // It can only be stopped, never advanced.
    await expect(advanceStoredPublicationLedger(root, "legacy-1", { status: "scheduled", providerPostId: "p" })).rejects.toThrow(/legacy ledger .* can only be stopped/);
    const stopped = await advanceStoredPublicationLedger(root, "legacy-1", { status: "failed", note: "retired" });
    expect(stopped.events.at(-1)!.status).toBe("failed");
  });

  it("its old 'published' state is not a confirmed publication for analytics or learning", async () => {
    const root = await store();
    await writeLegacyLedger(root, "legacy-1", LEGACY_HISTORY);
    await bindProviderPost(root, "metricool", "legacy-post-1", "legacy-1");
    const ledger = (await loadStoredPublicationLedger(root, "legacy-1"))!;

    expect(await eligibilityFor(root, ledger)).toEqual({ creativeId: "legacy-1", reason: "legacy-unverified" });
    const body = {
      kind: "PROVIDER_OBSERVATIONS", provider: "metricool", platform: "youtube-shorts",
      accountId: "specsmithpc-main", providerPostId: "legacy-post-1", collectedAt: "2026-09-03T12:00:00Z", metrics: { views: 1000 }, raw: {},
    } as const;
    // Production metrics are closed outright (no verified source)...
    await expect(importProviderObservations({ storeRoot: root, now: new Date("2026-10-01T00:00:00Z"), batch: body }))
      .rejects.toMatchObject({ code: "no-verified-source" });
    // ...and where a registered source does exist, the legacy ledger itself is refused.
    const simRoot = await store("simulation");
    await writeLegacyLedger(simRoot, "legacy-1", LEGACY_HISTORY);
    await bindProviderPost(simRoot, "metricool", "legacy-post-1", "legacy-1");
    await expect(importProviderObservations({ storeRoot: simRoot, now: new Date("2026-10-01T00:00:00Z"), batch: createSimulatedObservationSource().respond(body) }))
      .rejects.toMatchObject({ code: "legacy-unverified" });
    const report = await buildLearningReport({ storeRoot: root, now: new Date("2026-10-01T00:00:00Z") });
    expect(report.videos).toEqual([]);
    expect(report.unknowns.join(" ")).toMatch(/Excluded 1 legacy ledger\(s\) \(legacy-1\)/);
  });

  it("qc-passed cannot be written any more, and a corrupt legacy history is refused rather than guessed at", async () => {
    const root = await store();
    await createStoredPublicationLedger(root, fingerprint("fresh"));
    await expect(advanceStoredPublicationLedger(root, "fresh", { status: "qc-passed" })).rejects.toThrow(/legacy state and can no longer be written/);
    await writeLegacyLedger(root, "corrupt", [LEGACY_HISTORY[0], LEGACY_HISTORY[2]]);
    await expect(loadStoredPublicationLedger(root, "corrupt")).rejects.toThrow(/impossible transition qc-passed -> published/);
  });
});

/** Reproduce the receipt digest exactly, as an attacker reading the source could. */
function digest(creativeId: string, event: PublicationEvent): string {
  return createHash("sha256").update(JSON.stringify([creativeId, event.status, event.at, event.note ?? null, event.providerPostId ?? null,
    event.providerUuid ?? null, event.providerUrl ?? null, event.simulated ?? false,
    Object.entries(event.evidence ?? {}).sort(([a], [b]) => a.localeCompare(b))])).digest("hex");
}

const SUBMITTED: PublicationEvent = {
  status: "submission-started", at: "2026-10-01T12:00:00.000Z",
  evidence: { idempotencyKey: "specsmith-k", requestSha256: "r", attempt: 1 },
};

describe("ordinary callers cannot forge a transition receipt", () => {
  it("the boundary already holds the authority: nobody else can claim it", () => {
    expect(ledgerAuthorityClaimed()).toBe(true);
    expect(() => claimLedgerAuthority()).toThrow(/already been claimed/);
  });

  it("a hand-built receipt with every field and the correct digest is refused, and nothing is written", async () => {
    const root = await store("production");
    await createStoredPublicationLedger(root, fingerprint("c1"));
    const ledger = (await loadStoredPublicationLedger(root, "c1"))!;
    const event: PublicationEvent = { status: "published", at: "2026-10-01T12:00:00.000Z", providerPostId: "p1", evidence: { idempotencyKey: "k", confirmedBy: "provider-response" } };
    const forged: TransitionReceipt = Object.freeze({ creativeId: "c1", status: "published", eventSha256: digest("c1", event), sequence: 1, storeRoot: root, simulated: false });
    expect(() => advancePublicationLedger(ledger, event, forged, { storeRoot: root })).toThrow(/no receipt issued by the publication boundary/);
    await expect(advanceStoredPublicationLedger(root, "c1", event, forged)).rejects.toThrow(/no receipt issued by the publication boundary/);
    const files = await readdir(join(root, "publication-ledgers", createHash("sha256").update("c1").digest("hex")));
    expect(files).toEqual(["000000.json"]);
  });

  it("a simulated event or a simulated approval is refused by a production store", async () => {
    const root = await store("production");
    await createStoredPublicationLedger(root, fingerprint("c1"));
    await expect(advanceStoredPublicationLedger(root, "c1", { ...SUBMITTED, simulated: true }))
      .rejects.toThrow(/simulated "submission-started" event into the production store/);
    await expect(seedSimulatedLedger({ storeRoot: root, creativeId: "c1", through: "published", mediaSha256: "a".repeat(64), variantId: "v",
      destination: DESTINATION, title: "t", description: "d" })).rejects.toThrow(/only in a simulation store/);
    await expect(authorizePublication({ storeRoot: root, packet: {} as never, submission: {} as never, destination: DESTINATION,
      decisionClaim: { simulatedReviewer: "editor" }, verifier: createSimulatedApprovalVerifier() }))
      .rejects.toMatchObject({ code: "no-trusted-approval-mechanism" });
    await expect(recordMachineReview({ storeRoot: root, packet: { creativeId: "c1" } as never, submission: {} as never }))
      .rejects.toMatchObject({ code: "packet-not-issued" });
  });

  it("the reverse holds too: a simulation store takes no unlabelled protected event", async () => {
    const root = await store("simulation");
    await createStoredPublicationLedger(root, fingerprint("c1"));
    await expect(advanceStoredPublicationLedger(root, "c1", SUBMITTED)).rejects.toThrow(/must be labelled simulated/);
  });
});

describe("a genuine receipt is bound, single-use and uncopyable", () => {
  // Minted in an isolated module registry where the test, not the boundary,
  // holds the authority, so genuine receipts exist to be attacked. The
  // boundary and store are never loaded in that registry (they would refuse to
  // load; see the last test).
  async function isolatedIssuer() {
    vi.resetModules();
    const publishing = await import("../../publishing.ts");
    const issue = publishing.claimLedgerAuthority();
    const ledger: PublicationLedger = { creativeId: "c1", packageId: "p", platform: "youtube-shorts",
      events: [{ status: "generated", at: "2026-10-01T00:00:00Z" }, { status: "machine-reviewed", at: "2026-10-01T00:00:00Z" },
        { status: "human-review-pending", at: "2026-10-01T00:00:00Z" }, { status: "publication-authorized", at: "2026-10-01T00:00:00Z" }] };
    return { publishing, issue, ledger };
  }

  it("works once, for its own event, position and store", async () => {
    const { publishing, issue, ledger } = await isolatedIssuer();
    const receipt = issue("c1", SUBMITTED, { sequence: 4, storeRoot: "/stores/production" });
    const next = publishing.advancePublicationLedger(ledger, SUBMITTED, receipt, { storeRoot: "/stores/production" });
    expect(next.events.at(-1)!.status).toBe("submission-started");
    // Spent: the same receipt cannot write again.
    expect(() => publishing.advancePublicationLedger(ledger, SUBMITTED, receipt, { storeRoot: "/stores/production" })).toThrow(/no receipt issued/);
  });

  it("copies of a genuine receipt are not receipts", async () => {
    const { publishing, issue, ledger } = await isolatedIssuer();
    const receipt = issue("c1", SUBMITTED, { sequence: 4, storeRoot: "/stores/production" });
    for (const copy of [{ ...receipt }, structuredClone(receipt), JSON.parse(JSON.stringify(receipt))]) {
      expect(() => publishing.advancePublicationLedger(ledger, SUBMITTED, copy, { storeRoot: "/stores/production" })).toThrow(/no receipt issued/);
    }
  });

  it("a simulated receipt cannot be used in a production store, or with its simulated flag stripped", async () => {
    const { publishing, issue, ledger } = await isolatedIssuer();
    const simulatedEvent = { ...SUBMITTED, simulated: true };
    const simulated = issue("c1", simulatedEvent, { sequence: 4, storeRoot: "/stores/simulation" });
    expect(simulated.simulated).toBe(true);
    expect(() => publishing.advancePublicationLedger(ledger, simulatedEvent, simulated, { storeRoot: "/stores/production" }))
      .toThrow(/receipt is for store \/stores\/simulation, not \/stores\/production/);
    const stripped = issue("c1", simulatedEvent, { sequence: 4, storeRoot: "/stores/production" });
    expect(() => publishing.advancePublicationLedger(ledger, SUBMITTED, stripped, { storeRoot: "/stores/production" }))
      .toThrow(/issued for a different event \(any changed field, including the simulated flag, voids it\)/);
  });

  it("a receipt for another creative, status, position or edited event is refused", async () => {
    const { publishing, issue, ledger } = await isolatedIssuer();
    const place = { storeRoot: "/stores/production" };
    expect(() => publishing.advancePublicationLedger(ledger, SUBMITTED, issue("c2", SUBMITTED, { sequence: 4, ...place }), place)).toThrow(/receipt is for c2/);
    expect(() => publishing.advancePublicationLedger(ledger, SUBMITTED, issue("c1", SUBMITTED, { sequence: 7, ...place }), place)).toThrow(/position 7, not 4/);
    const edited = { ...SUBMITTED, evidence: { ...SUBMITTED.evidence, attempt: 2 } };
    expect(() => publishing.advancePublicationLedger(ledger, edited, issue("c1", SUBMITTED, { sequence: 4, ...place }), place)).toThrow(/different event/);
  });

  it("whoever claims the authority first is the only issuer: the boundary and store then refuse to load", async () => {
    vi.resetModules();
    const publishing = await import("../../publishing.ts");
    publishing.claimLedgerAuthority();
    await expect(import("./boundary.ts")).rejects.toThrow(/already been claimed/);
    vi.resetModules();
    const again = await import("../../publishing.ts");
    again.claimLedgerAuthority();
    await expect(import("../../publishingStore.ts")).rejects.toThrow(/already been claimed/);
  });
});
