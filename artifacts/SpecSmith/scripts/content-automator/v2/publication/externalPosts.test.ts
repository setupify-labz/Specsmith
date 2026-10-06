// MASTER #8: externally published posts stay apart from authorized publications,
// keep their provenance and history, and gain numbers only from a trusted source
// (or, labelled exploratory, from a person).

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runPublishedPosts } from "../../publishedPostsCli.ts";
import { creativeForProviderPost, initPublicationStore, listStoredCreativeIds } from "../../publishingStore.ts";
import { loadAuthorization } from "./boundary.ts";
import {
  correctExternalPost,
  ExternalPostError,
  externalPostReport,
  loadExternalPosts,
  nativePostIdFromUrl,
  recordDashboardEvidence,
  recordExternalPost,
  resolveExternalPost,
  type ExternalPostInput,
} from "./externalPosts.ts";
import { buildLearningReport } from "./learningReport.ts";
import {
  createSimulatedObservationSource,
  importExternalPostObservations,
  importProviderObservations,
  OBSERVATION_BATCH_KIND,
  ObservationRefusedError,
  type ProviderObservationBatch,
} from "./observations.ts";
import { FPS_20_WINS_RENDER_SHA256, PUBLISHED_POSTS, PUBLISHED_WITHOUT_POSTS, RAM_FIT_PUBLISHED_COPY } from "./publishedPosts.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function store(mode?: "simulation" | "production") {
  const root = await mkdtemp(join(tmpdir(), "external-posts-"));
  roots.push(root);
  if (mode) await initPublicationStore(root, mode, "external post test");
  return root;
}
const NOW = new Date("2026-10-06T18:00:00Z");
const RAM: ExternalPostInput = PUBLISHED_POSTS[0];
const YT = { platform: "youtube-shorts" as const, nativePostId: "cSDhjFC-CI8" };
// A test-only TikTok copy of a video. Not a real post.
const TIKTOK_TEST: ExternalPostInput = {
  ...RAM, platform: "tiktok", postUrl: "https://www.tiktok.com/@testaccount/video/7000000000000000001", suppliedBy: "test fixture",
};

async function complete(root: string) {
  await correctExternalPost({ storeRoot: root, ...YT, field: "publishedAt", next: { value: "2026-10-03T19:40:00-04:00", source: "user-provided", basis: "test: user read it from YouTube Studio" }, reason: "time supplied", suppliedBy: "test" , now: NOW });
  await correctExternalPost({ storeRoot: root, ...YT, field: "accountId", next: { value: "UC-test-channel", source: "user-provided", basis: "test" }, reason: "channel supplied", suppliedBy: "test", now: NOW });
}
function youtubeBatch(overrides: Partial<ProviderObservationBatch> = {}): ProviderObservationBatch {
  return {
    kind: OBSERVATION_BATCH_KIND, provider: "youtube", platform: "youtube-shorts", accountId: "UC-test-channel", providerPostId: "cSDhjFC-CI8",
    collectedAt: "2026-10-05T00:00:00Z", metrics: { views: 1000, averageViewPercentage: 61.5 }, raw: { test: true }, ...overrides,
  };
}

describe("recording an externally published post, with provenance", () => {
  it("records each fact with its source, leaves unknowns null with a reason, and is never machine-authorized", async () => {
    const record = await recordExternalPost({ storeRoot: await store(), post: RAM, now: NOW });
    expect(record.machineAuthorized).toBe(false);
    expect(record.nativePostId).toBe("cSDhjFC-CI8");
    expect(record.postUrl).toMatchObject({ value: "https://www.youtube.com/shorts/cSDhjFC-CI8", source: "user-provided" });
    expect(record.creativeId).toMatchObject({ value: "ram-fit@saved-take-pr172", source: "user-provided" });
    expect(record.creativeVersion.source).toBe("file-measured");
    expect(record.publishedAt).toEqual({ value: null, source: null, basis: expect.stringContaining("not a confirmed publication time") });
    expect(record.accountId.value).toBeNull();
  });

  it("reads native ids only from each platform's own post URLs", () => {
    expect(nativePostIdFromUrl("youtube-shorts", "https://youtube.com/shorts/cSDhjFC-CI8")).toBe("cSDhjFC-CI8");
    expect(nativePostIdFromUrl("youtube-shorts", "https://youtu.be/cSDhjFC-CI8")).toBe("cSDhjFC-CI8");
    expect(nativePostIdFromUrl("tiktok", "https://www.tiktok.com/@a.b/video/7000000000000000001")).toBe("7000000000000000001");
    expect(nativePostIdFromUrl("instagram-reels", "https://www.instagram.com/reel/DAbc123xyz/")).toBe("DAbc123xyz");
    expect(nativePostIdFromUrl("instagram-reels", "https://www.instagram.com/specsmith/reel/DAbc123xyz/")).toBe("DAbc123xyz");
    for (const [platform, url] of [
      ["youtube-shorts", "https://evil.example/shorts/cSDhjFC-CI8"], ["youtube-shorts", "http://youtube.com/shorts/cSDhjFC-CI8"],
      ["tiktok", "https://www.youtube.com/shorts/cSDhjFC-CI8"], ["instagram-reels", "https://www.instagram.com/specsmith/"],
    ] as const) expect(nativePostIdFromUrl(platform, url)).toBeNull();
  });

  it("refuses a wrong-platform URL, a time without a timezone, an unexplained unknown, an uncited provider fact and an unevidenced measurement", async () => {
    const root = await store();
    await expect(recordExternalPost({ storeRoot: root, post: { ...RAM, platform: "tiktok" } })).rejects.toThrow(ExternalPostError);
    await expect(recordExternalPost({ storeRoot: root, post: { ...RAM, publishedAt: { value: "2026-10-03 19:40", source: "user-provided", basis: "typed" } } })).rejects.toThrow(/timezone/);
    await expect(recordExternalPost({ storeRoot: root, post: { ...RAM, accountId: { value: null, basis: " " } } })).rejects.toThrow(/needs a reason/);
    await expect(recordExternalPost({ storeRoot: root, post: { ...RAM, accountId: { value: "UC1", source: "provider-reported", basis: "the API" } } })).rejects.toThrow(/cite the trusted observation/);
    await expect(recordExternalPost({ storeRoot: root, post: { ...RAM, media: null } })).rejects.toThrow(/file's evidence/);
  });

  it("is idempotent for the same facts and sends different facts to a correction instead of overwriting", async () => {
    const root = await store();
    const first = await recordExternalPost({ storeRoot: root, post: RAM, now: NOW });
    expect((await recordExternalPost({ storeRoot: root, post: RAM, now: NOW })).recordId).toBe(first.recordId);
    await expect(recordExternalPost({ storeRoot: root, post: { ...RAM, publishedVia: { value: "manual-upload", source: "user-provided", basis: "typed" } } }))
      .rejects.toThrow(/Use correctExternalPost/);
  });
});

describe("history-preserving corrections", () => {
  it("completes an unknown fact, then corrects it, keeping the original record and every step", async () => {
    const root = await store();
    const original = await recordExternalPost({ storeRoot: root, post: RAM, now: NOW });
    const first = await correctExternalPost({ storeRoot: root, ...YT, field: "publishedAt",
      next: { value: "2026-10-03T19:40:00-04:00", source: "user-provided", basis: "user, from YouTube Studio" }, reason: "completing the unknown time", suppliedBy: "user", now: NOW });
    const second = await correctExternalPost({ storeRoot: root, ...YT, field: "publishedAt",
      next: { value: "2026-10-03T19:42:00-04:00", source: "user-provided", basis: "user, re-checked" }, reason: "first reading was rounded", suppliedBy: "user", now: NOW });
    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    expect(first.previous.value).toBeNull();
    expect(second.previous.value).toBe("2026-10-03T23:40:00.000Z");
    const resolved = (await resolveExternalPost(root, "youtube-shorts", "cSDhjFC-CI8"))!;
    expect(resolved.publishedAt).toMatchObject({ value: "2026-10-03T23:42:00.000Z", source: "user-provided" });
    expect(resolved.corrections.map((entry) => entry.reason)).toEqual(["completing the unknown time", "first reading was rounded"]);
    const onDisk = JSON.parse(await readFile(join(root, "external-posts", "youtube-shorts-cSDhjFC-CI8.json"), "utf8"));
    expect(onDisk).toEqual(JSON.parse(JSON.stringify(original)));
    const report = await externalPostReport({ storeRoot: root, now: NOW, env: {} });
    expect(report.posts[0].corrections.map((entry) => [entry.from, entry.to])).toEqual([[null, "2026-10-03T23:40:00.000Z"], ["2026-10-03T23:40:00.000Z", "2026-10-03T23:42:00.000Z"]]);
  });

  it("refuses to correct a post's identity, refuses no-op corrections, and refuses a tampered history", async () => {
    const root = await store();
    await recordExternalPost({ storeRoot: root, post: RAM, now: NOW });
    await expect(correctExternalPost({ storeRoot: root, ...YT, field: "postUrl" as never, next: { value: "https://youtu.be/x", source: "user-provided", basis: "x" }, reason: "x", suppliedBy: "x" }))
      .rejects.toThrow(/identity/);
    await expect(correctExternalPost({ storeRoot: root, ...YT, field: "publishedVia", next: { value: "metricool-auto", source: "user-provided", basis: "user, 2026-10-03" }, reason: "again", suppliedBy: "x" }))
      .rejects.toThrow(/nothing to correct/);
    await complete(root);
    await rm(join(root, "external-posts", "youtube-shorts-cSDhjFC-CI8.corrections", "0001.json"));
    await expect(resolveExternalPost(root, "youtube-shorts", "cSDhjFC-CI8")).rejects.toThrow(/out of order/);
  });
});

describe("kept apart from machine-authorized publications", () => {
  it("writes no ledger, authorization or provider-post index, so the learning report and the ledger import ignore it", async () => {
    const root = await store("simulation");
    await recordExternalPost({ storeRoot: root, post: RAM, now: NOW });
    await complete(root);
    expect(await listStoredCreativeIds(root)).toEqual([]);
    expect(await creativeForProviderPost(root, "youtube", "cSDhjFC-CI8")).toBeNull();
    expect(await loadAuthorization(root, "ram-fit@saved-take-pr172")).toBeNull();
    expect((await buildLearningReport({ storeRoot: root, now: NOW })).videos).toEqual([]);
    const source = createSimulatedObservationSource();
    await expect(importProviderObservations({ storeRoot: root, batch: source.respond(youtubeBatch()), now: NOW })).rejects.toMatchObject({ code: "unknown-post" });
  });

  it("refuses to read a record that claims machine authorization", async () => {
    const root = await store();
    await recordExternalPost({ storeRoot: root, post: RAM, now: NOW });
    const path = join(root, "external-posts", "youtube-shorts-cSDhjFC-CI8.json");
    await writeFile(path, (await readFile(path, "utf8")).replace("\"machineAuthorized\": false", "\"machineAuthorized\": true"));
    await expect(loadExternalPosts(root)).rejects.toThrow(/refusing to read/);
  });
});

describe("authenticated observations for an external post", () => {
  it("are refused until the account and publication time are known, then stored with values, times and sources — and no ledger appears", async () => {
    const root = await store("simulation");
    await recordExternalPost({ storeRoot: root, post: RAM, now: NOW });
    const source = createSimulatedObservationSource();
    await expect(importExternalPostObservations({ storeRoot: root, batch: source.respond(youtubeBatch()), now: NOW })).rejects.toMatchObject({ code: "incomplete-external-post" });
    await correctExternalPost({ storeRoot: root, ...YT, field: "accountId", next: { value: "UC-test-channel", source: "user-provided", basis: "test" }, reason: "channel supplied", suppliedBy: "test", now: NOW });
    await expect(importExternalPostObservations({ storeRoot: root, batch: source.respond(youtubeBatch()), now: NOW })).rejects.toThrow(/publication time .* is not recorded/);
    await correctExternalPost({ storeRoot: root, ...YT, field: "publishedAt", next: { value: "2026-10-03T19:40:00-04:00", source: "user-provided", basis: "test: user read it from YouTube Studio" }, reason: "time supplied", suppliedBy: "test", now: NOW });
    const imported = await importExternalPostObservations({ storeRoot: root, batch: source.respond(youtubeBatch()), now: NOW });
    expect(imported.stored.some((record) => record.metricId === "views" && record.value === 1000)).toBe(true);
    expect(await listStoredCreativeIds(root)).toEqual([]);
    const report = await externalPostReport({ storeRoot: root, now: NOW, env: {} });
    const views = report.posts[0].observations.find((record) => record.metricId === "views")!;
    expect(views).toMatchObject({ value: 1000, collectedAt: "2026-10-05T00:00:00Z", source: expect.stringContaining("SIMULATED") });
    expect(views.publicationAgeHours).toBeCloseTo(24.33, 1);
    expect(report.observations.some((line) => line.includes("views = 1000") && line.includes(views.observationId))).toBe(true);
    expect(report.nextBrief.evidence.observationIds).toContain(views.observationId);
    expect(report.nextBrief.simulated).toBe(true);
    // Not the unconditional "nothing exists" line any more.
    expect(report.unknowns.join(" ")).not.toMatch(/no trusted observation is stored/);
    expect(report.unknowns.join(" ")).not.toMatch(/^Access:/m);
  });

  it("keeps platforms apart: another provider, another platform's id, or a caller-built batch is refused", async () => {
    const root = await store("simulation");
    await recordExternalPost({ storeRoot: root, post: RAM, now: NOW });
    await recordExternalPost({ storeRoot: root, post: TIKTOK_TEST, now: NOW });
    await complete(root);
    const source = createSimulatedObservationSource();
    await expect(importExternalPostObservations({ storeRoot: root, batch: source.respond(youtubeBatch({ provider: "metricool" })), now: NOW })).rejects.toMatchObject({ code: "identity-mismatch" });
    await expect(importExternalPostObservations({ storeRoot: root, batch: source.respond(youtubeBatch({ provider: "tiktok", platform: "tiktok" })), now: NOW })).rejects.toMatchObject({ code: "unknown-post" });
    await expect(importExternalPostObservations({ storeRoot: root, batch: youtubeBatch(), now: NOW })).rejects.toBeInstanceOf(ObservationRefusedError);
    await importExternalPostObservations({ storeRoot: root, batch: source.respond(youtubeBatch()), now: NOW });
    const report = await externalPostReport({ storeRoot: root, now: NOW, env: {} });
    const tiktok = report.posts.find((post) => post.platform === "tiktok")!;
    expect(tiktok.observations).toEqual([]);
    expect(report.posts.find((post) => post.platform === "youtube-shorts")!.observations.length).toBeGreaterThan(0);
  });

  it("never lets a simulated batch into a production store", async () => {
    const root = await store("production");
    await recordExternalPost({ storeRoot: root, post: RAM, now: NOW });
    await complete(root);
    const source = createSimulatedObservationSource();
    await expect(importExternalPostObservations({ storeRoot: root, batch: source.respond(youtubeBatch()), now: NOW })).rejects.toMatchObject({ code: "synthetic-in-production" });
  });
});

describe("user-provided dashboard evidence", () => {
  const evidence = {
    ...YT, dashboard: "YouTube Studio (test)", readAt: "2026-10-05T09:00:00-04:00",
    sourceReference: "test-screenshot.png sha256 0000", values: [{ label: "Views", value: 321, window: "Since published" }, { label: "Viewed vs. swiped away", value: "58% viewed" }],
  };

  it("is shown with its values, read time and source as EXPLORATORY context, never as an observation", async () => {
    const root = await store();
    await recordExternalPost({ storeRoot: root, post: RAM, now: NOW });
    await recordDashboardEvidence({ storeRoot: root, suppliedBy: "user (test)", evidence, now: NOW });
    const report = await externalPostReport({ storeRoot: root, now: NOW, env: {} });
    const post = report.posts[0];
    expect(post.observations).toEqual([]);
    expect(post.exploratory[0]).toMatchObject({ dashboard: "YouTube Studio (test)", readAt: "2026-10-05T09:00:00-04:00", sourceReference: "test-screenshot.png sha256 0000" });
    expect(report.exploratoryContext[0]).toMatch(/EXPLORATORY.*Views: 321 \(Since published\); Viewed vs\. swiped away: 58% viewed.*says nothing about cause/);
    expect(report.observations.join(" ")).not.toContain("321");
    expect(report.nextBrief.evidence.observationIds).toEqual([]);
    expect(report.nextBrief.memoryObservations.some((line) => line.startsWith("Exploratory context") && line.includes("321") && line.includes("not a metric or a causal finding"))).toBe(true);
  });

  it("attaches to one platform's post only, and refuses unknown posts, future reads and times without a timezone", async () => {
    const root = await store();
    await recordExternalPost({ storeRoot: root, post: RAM, now: NOW });
    await expect(recordDashboardEvidence({ storeRoot: root, suppliedBy: "x", evidence: { ...evidence, platform: "tiktok" }, now: NOW })).rejects.toThrow(/not recorded/);
    await expect(recordDashboardEvidence({ storeRoot: root, suppliedBy: "x", evidence: { ...evidence, readAt: "2026-10-09T00:00:00Z" }, now: NOW })).rejects.toThrow(/future/);
    await expect(recordDashboardEvidence({ storeRoot: root, suppliedBy: "x", evidence: { ...evidence, readAt: "2026-10-05" }, now: NOW })).rejects.toThrow(/timezone/);
    await recordExternalPost({ storeRoot: root, post: TIKTOK_TEST, now: NOW });
    await recordDashboardEvidence({ storeRoot: root, suppliedBy: "x", evidence: { ...evidence, platform: "tiktok", nativePostId: "7000000000000000001", dashboard: "TikTok (test)" }, now: NOW });
    const report = await externalPostReport({ storeRoot: root, now: NOW, env: {} });
    expect(report.posts.find((post) => post.platform === "youtube-shorts")!.exploratory).toEqual([]);
    expect(report.posts.find((post) => post.platform === "tiktok")!.exploratory.map((entry) => entry.dashboard)).toEqual(["TikTok (test)"]);
  });
});

describe("post -> report -> next brief", () => {
  it("carries the RAM post's identifiers, media hashes and file-measured evidence into the next brief", async () => {
    const root = await store();
    const out = await store();
    const { report, entries, handoff } = await runPublishedPosts({ storeRoot: root, outDir: out, now: NOW });
    expect(entries.every((entry) => entry.outcome.state === "unknown" && entry.evidenceStrength === "insufficient")).toBe(true);
    expect(handoff.evidence.creativeIds).toEqual(["ram-fit@saved-take-pr172", "fps-20-wins@ce47598"]);
    expect(handoff.evidence.providerPostIds).toEqual(["youtube-shorts:cSDhjFC-CI8"]);
    expect(handoff.evidence.mediaSha256s).toEqual(expect.arrayContaining([RAM_FIT_PUBLISHED_COPY.sha256, FPS_20_WINS_RENDER_SHA256]));
    const lines = handoff.brief.memoryObservations;
    expect(lines.some((line) => line.includes(report.reportId) && line.includes(RAM_FIT_PUBLISHED_COPY.sha256))).toBe(true);
    expect(lines.some((line) => line.startsWith("Creative change to test") && line.includes("a hypothesis, not a finding"))).toBe(true);
    // With no trusted observation for the RAM post, the report says so for that post and names the access cause.
    expect(report.unknowns.some((line) => line.startsWith("ram-fit@saved-take-pr172 on youtube-shorts: no trusted observation is stored"))).toBe(true);
    expect(report.unknowns.some((line) => line.startsWith("Access: Metricool"))).toBe(true);
  });
});

describe("the recorded facts", () => {
  it("record no time, account, URL or metric that was not supplied", () => {
    expect(PUBLISHED_POSTS.every((post) => post.publishedAt.value === null && post.accountId.value === null)).toBe(true);
    expect(PUBLISHED_POSTS.map((post) => post.postUrl)).toEqual(["https://www.youtube.com/shorts/cSDhjFC-CI8"]);
    expect(PUBLISHED_WITHOUT_POSTS.map((creative) => creative.creativeId)).toEqual(["fps-20-wins@ce47598"]);
    expect(JSON.stringify(PUBLISHED_POSTS)).not.toMatch(/"(views|likes|retention)"/);
  });
});
