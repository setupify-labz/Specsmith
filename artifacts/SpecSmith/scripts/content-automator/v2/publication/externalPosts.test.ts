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
import { FPS_20_WINS_PUBLISHED_COPY, FPS_20_WINS_RENDER_SHA256, PUBLISHED_POSTS, RAM_FIT_PUBLISHED_COPY } from "./publishedPosts.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function store(mode?: "simulation" | "production") {
  const root = await mkdtemp(join(tmpdir(), "external-posts-"));
  roots.push(root);
  if (mode) await initPublicationStore(root, mode, "external post test");
  return root;
}
const NOW = new Date("2026-10-06T18:00:00Z");
const post = (platform: ExternalPostInput["platform"], nativeId: string) =>
  PUBLISHED_POSTS.find((entry) => entry.platform === platform && entry.postUrl.value.includes(nativeId))!;
const RAM = post("youtube-shorts", "cSDhjFC-CI8");
const RAM_TIKTOK = post("tiktok", "7693352089078058271");
const FPS_YT = post("youtube-shorts", "648FsZLefnc");
const CHANNEL = "UC1DBOCQ4F0y-BP9he39b3Kg";
const YT = { platform: "youtube-shorts" as const, nativePostId: "cSDhjFC-CI8" };
const TT = { platform: "tiktok" as const, nativePostId: "7693352089078058271" };
// A test-only variant whose account is not yet known.
const RAM_UNBOUND: ExternalPostInput = { ...RAM, accountId: { value: null, basis: "test: channel not supplied yet" } };
const FAKE_OBSERVATION = "obs-0123456789abcdef01234567";
const corrections = (root: string, id = "youtube-shorts-cSDhjFC-CI8") => join(root, "external-posts", `${id}.corrections`);

/** Test-only publication time; the real posts have none. */
async function complete(root: string) {
  await correctExternalPost({ storeRoot: root, ...YT, field: "publishedAt", next: { value: "2026-10-03T19:40:00-04:00", source: "user-provided", basis: "test: user read it from YouTube Studio" }, reason: "time supplied", suppliedBy: "test" , now: NOW });
}
function youtubeBatch(overrides: Partial<ProviderObservationBatch> = {}): ProviderObservationBatch {
  return {
    kind: OBSERVATION_BATCH_KIND, provider: "youtube", platform: "youtube-shorts", accountId: CHANNEL, providerPostId: "cSDhjFC-CI8",
    collectedAt: "2026-10-05T00:00:00Z", metrics: { views: 1000, averageViewPercentage: 61.5 }, raw: { test: true }, ...overrides,
  };
}

describe("recording an externally published post, with provenance", () => {
  it("records each fact with its source, leaves unknowns null with a reason, and is never machine-authorized", async () => {
    const record = await recordExternalPost({ storeRoot: await store(), post: RAM, now: NOW });
    expect(record.machineAuthorized).toBe(false);
    expect(record.nativePostId).toBe("cSDhjFC-CI8");
    expect(record.postUrl).toMatchObject({ value: "https://www.youtube.com/shorts/cSDhjFC-CI8", source: "connector-reported", basis: expect.stringMatching(/Metricool connector.*6769542.*not fetched or re-checked by this environment.*PUBLISHED/) });
    expect(record.creativeId).toMatchObject({ value: "ram-fit@saved-take-pr172", source: "user-provided" });
    expect(record.creativeVersion.source).toBe("file-measured");
    expect(record.aggregatorPostId).toMatchObject({ value: "387469692", source: "connector-reported" });
    expect(record.providerStatus).toMatchObject({ value: "PUBLISHED", source: "connector-reported" });
    // The scheduled time is kept as its own fact, in UTC; it is not the publication time.
    expect(record.scheduledAt).toMatchObject({ value: "2026-10-03T20:00:00.000Z", source: "connector-reported", basis: expect.stringContaining("not exactly when") });
    expect(record.publishedAt).toEqual({ value: null, source: null, basis: expect.stringContaining("No confirmed publication time") });
    expect(record.accountId).toMatchObject({ value: CHANNEL, source: "user-provided" });
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
    await expect(recordExternalPost({ storeRoot: root, post: { ...RAM, accountId: { value: null, basis: " " } } })).rejects.toThrow(/must carry a basis/);
    await expect(recordExternalPost({ storeRoot: root, post: { ...RAM, accountId: { value: "UC1", source: "provider-reported", basis: "the API" } } })).rejects.toThrow(/must name the trusted observation/);
    await expect(recordExternalPost({ storeRoot: root, post: { ...RAM, postUrl: { ...RAM.postUrl, source: "file-measured" } } })).rejects.toThrow(/person or a connector/);
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
    await expect(correctExternalPost({ storeRoot: root, ...YT, field: "publishedVia", next: RAM.publishedVia, reason: "again", suppliedBy: "x" }))
      .rejects.toThrow(/nothing to correct/);
    await complete(root);
    await correctExternalPost({ storeRoot: root, ...YT, field: "creativeId", next: { value: "ram-fit@other", source: "user-provided", basis: "test" }, reason: "x", suppliedBy: "x", now: NOW });
    await rm(join(corrections(root), "0001.json"));
    await expect(resolveExternalPost(root, "youtube-shorts", "cSDhjFC-CI8")).rejects.toThrow(/out of order/);
  });

  async function twoCorrections() {
    const root = await store();
    await recordExternalPost({ storeRoot: root, post: RAM, now: NOW });
    await correctExternalPost({ storeRoot: root, ...YT, field: "publishedAt", next: { value: "2026-10-03T19:40:00-04:00", source: "user-provided", basis: "test" }, reason: "first", suppliedBy: "test", now: NOW });
    await correctExternalPost({ storeRoot: root, ...YT, field: "publishedAt", next: { value: "2026-10-03T19:42:00-04:00", source: "user-provided", basis: "test, re-checked" }, reason: "second", suppliedBy: "test", now: NOW });
    expect((await resolveExternalPost(root, "youtube-shorts", "cSDhjFC-CI8"))!.publishedAt.value).toBe("2026-10-03T23:42:00.000Z");
    return root;
  }
  async function tamper(root: string, name: string, change: (correction: Record<string, any>) => void) {
    const path = join(corrections(root), name);
    const correction = JSON.parse(await readFile(path, "utf8"));
    change(correction);
    await writeFile(path, JSON.stringify(correction));
  }

  it("refuses a replay whose previous value does not match the fact at that point", async () => {
    const root = await twoCorrections();
    // The second correction now claims to replace a value the first never set.
    await tamper(root, "0002.json", (correction) => { correction.previous.value = "2026-10-03T23:00:00.000Z"; });
    await expect(resolveExternalPost(root, "youtube-shorts", "cSDhjFC-CI8")).rejects.toThrow(/0002\.json .* expects publishedAt to be 2026-10-03T23:00:00\.000Z, but at that point it is 2026-10-03T23:40:00\.000Z/);
    // Its provenance changed, not its value: still refused.
    const second = await twoCorrections();
    await tamper(second, "0001.json", (correction) => { correction.previous.basis = "someone else"; });
    await expect(resolveExternalPost(second, "youtube-shorts", "cSDhjFC-CI8")).rejects.toThrow(/0001\.json .* expects publishedAt/);
    await expect(loadExternalPosts(second)).rejects.toThrow(ExternalPostError);
  });

  it("refuses a replay whose replacement is not a valid fact", async () => {
    for (const [change, why] of [
      [(correction: Record<string, any>) => { correction.next.value = "2026-10-03 19:40"; }, /invalid replacement: Publication time .* timezone/],
      [(correction: Record<string, any>) => { correction.next.value = "2026-10-03T19:40:00-04:00"; }, /invalid replacement: publishedAt must be stored in UTC/],
      [(correction: Record<string, any>) => { correction.next.source = "a friend"; }, /invalid replacement: .*unrecognised source/],
      [(correction: Record<string, any>) => { correction.next = { value: null, source: null, basis: "" }; }, /invalid replacement: .*must carry a basis/],
      [(correction: Record<string, any>) => { correction.next.source = "provider-reported"; }, /invalid replacement: .*must name the trusted observation/],
      [(correction: Record<string, any>) => { correction.field = "postUrl"; }, /not correctable/],
    ] as const) {
      const root = await twoCorrections();
      await tamper(root, "0001.json", change);
      await expect(resolveExternalPost(root, "youtube-shorts", "cSDhjFC-CI8")).rejects.toThrow(why);
    }
  });
});

describe("provider-reported facts need a real trusted observation", () => {
  it("refuses a fabricated observation id when recording, correcting, or replaying", async () => {
    const root = await store("simulation");
    const fabricated = { value: "PUBLISHED", source: "provider-reported" as const, basis: "the API said so", observationId: FAKE_OBSERVATION };
    await expect(recordExternalPost({ storeRoot: root, post: { ...RAM, providerStatus: fabricated }, now: NOW })).rejects.toThrow(/no trusted observation with that id exists/);
    await recordExternalPost({ storeRoot: root, post: RAM, now: NOW });
    await expect(correctExternalPost({ storeRoot: root, ...YT, field: "providerStatus", next: fabricated, reason: "x", suppliedBy: "x", now: NOW }))
      .rejects.toThrow(/cites observation obs-0123456789abcdef01234567, but no trusted observation/);
    // Written straight into the history, it is caught on read.
    await correctExternalPost({ storeRoot: root, ...YT, field: "creativeId", next: { value: "ram-fit@other", source: "user-provided", basis: "test" }, reason: "x", suppliedBy: "x", now: NOW });
    const path = join(corrections(root), "0001.json");
    const correction = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...correction, next: { ...fabricated, value: "ram-fit@other" } }));
    await expect(resolveExternalPost(root, "youtube-shorts", "cSDhjFC-CI8")).rejects.toThrow(/invalid replacement: .*no trusted observation/);
  });

  it("accepts a reference to a trusted observation of this post and account, and refuses it for another account, post or platform", async () => {
    const root = await store("simulation");
    await recordExternalPost({ storeRoot: root, post: RAM, now: NOW });
    await recordExternalPost({ storeRoot: root, post: RAM_TIKTOK, now: NOW });
    await recordExternalPost({ storeRoot: root, post: FPS_YT, now: NOW });
    await complete(root);
    const { stored } = await importExternalPostObservations({ storeRoot: root, batch: createSimulatedObservationSource().respond(youtubeBatch()), now: NOW });
    const observationId = stored.find((record) => record.metricId === "views")!.observationId;
    const cited = (value: string) => ({ value, source: "provider-reported" as const, basis: "the YouTube API, via the trusted (simulated) source", observationId });

    await correctExternalPost({ storeRoot: root, ...YT, field: "accountId", next: cited(CHANNEL), reason: "confirmed by the provider", suppliedBy: "test", now: NOW });
    expect((await resolveExternalPost(root, "youtube-shorts", "cSDhjFC-CI8"))!.accountId).toMatchObject({ value: CHANNEL, source: "provider-reported", observationId });

    await expect(correctExternalPost({ storeRoot: root, ...YT, field: "accountId", next: cited("UC-someone-else"), reason: "x", suppliedBy: "x", now: NOW }))
      .rejects.toThrow(/no trusted observation .* on account UC-someone-else/);
    await expect(correctExternalPost({ storeRoot: root, platform: "youtube-shorts", nativePostId: "648FsZLefnc", field: "providerStatus", next: cited("PUBLISHED"), reason: "x", suppliedBy: "x", now: NOW }))
      .rejects.toThrow(/no trusted observation .* youtube-shorts post 648FsZLefnc/);
    await expect(correctExternalPost({ storeRoot: root, ...TT, field: "providerStatus", next: cited("PUBLISHED"), reason: "x", suppliedBy: "x", now: NOW }))
      .rejects.toThrow(/no trusted observation .* tiktok post 7693352089078058271/);
  });

  it("does not accept a simulated observation in a production store", async () => {
    const simulation = await store("simulation");
    await recordExternalPost({ storeRoot: simulation, post: RAM, now: NOW });
    await complete(simulation);
    const { stored } = await importExternalPostObservations({ storeRoot: simulation, batch: createSimulatedObservationSource().respond(youtubeBatch()), now: NOW });
    // Copy the simulated observation files into a production store by hand.
    const production = await store("production");
    await recordExternalPost({ storeRoot: production, post: RAM, now: NOW });
    const key = (await readdir(simulation)).find((name) => name.startsWith("observations"))!;
    const { cp } = await import("node:fs/promises");
    await cp(join(simulation, key), join(production, key), { recursive: true });
    await expect(correctExternalPost({ storeRoot: production, ...YT, field: "accountId", next: { value: CHANNEL, source: "provider-reported", basis: "x", observationId: stored[0].observationId }, reason: "x", suppliedBy: "x", now: NOW }))
      .rejects.toThrow(/no trusted observation/);
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
    await recordExternalPost({ storeRoot: root, post: RAM_UNBOUND, now: NOW });
    const source = createSimulatedObservationSource();
    await expect(importExternalPostObservations({ storeRoot: root, batch: source.respond(youtubeBatch()), now: NOW })).rejects.toMatchObject({ code: "incomplete-external-post" });
    await correctExternalPost({ storeRoot: root, ...YT, field: "accountId", next: { value: CHANNEL, source: "user-provided", basis: "test" }, reason: "channel supplied", suppliedBy: "test", now: NOW });
    await expect(importExternalPostObservations({ storeRoot: root, batch: source.respond(youtubeBatch()), now: NOW })).rejects.toThrow(/publication time .* is not recorded/);
    await complete(root);
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
    await recordExternalPost({ storeRoot: root, post: RAM_TIKTOK, now: NOW });
    await complete(root);
    const source = createSimulatedObservationSource();
    await expect(importExternalPostObservations({ storeRoot: root, batch: source.respond(youtubeBatch({ provider: "metricool" })), now: NOW })).rejects.toMatchObject({ code: "identity-mismatch" });
    await expect(importExternalPostObservations({ storeRoot: root, batch: source.respond(youtubeBatch({ provider: "tiktok", platform: "tiktok" })), now: NOW })).rejects.toMatchObject({ code: "unknown-post" });
    // The TikTok post itself: its account id is unknown (only the handle is), so nothing binds to it.
    await expect(importExternalPostObservations({ storeRoot: root, batch: source.respond(youtubeBatch({ provider: "tiktok", platform: "tiktok", providerPostId: "7693352089078058271", accountId: "@specsmithpc" })), now: NOW }))
      .rejects.toMatchObject({ code: "incomplete-external-post" });
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
    await recordExternalPost({ storeRoot: root, post: RAM_TIKTOK, now: NOW });
    await recordDashboardEvidence({ storeRoot: root, suppliedBy: "x", evidence: { ...evidence, ...TT, dashboard: "TikTok (test)" }, now: NOW });
    const report = await externalPostReport({ storeRoot: root, now: NOW, env: {} });
    expect(report.posts.find((post) => post.platform === "youtube-shorts")!.exploratory).toEqual([]);
    expect(report.posts.find((post) => post.platform === "tiktok")!.exploratory.map((entry) => entry.dashboard)).toEqual(["TikTok (test)"]);
  });
});

describe("post -> report -> next brief", () => {
  it("carries all six posts' identifiers, media hashes and file-measured evidence into the next brief", async () => {
    const root = await store();
    const out = await store();
    const { report, entries, handoff } = await runPublishedPosts({ storeRoot: root, outDir: out, now: NOW });
    expect(entries.every((entry) => entry.outcome.state === "unknown" && entry.evidenceStrength === "insufficient")).toBe(true);
    expect(handoff.evidence.creativeIds).toEqual(["ram-fit@saved-take-pr172", "fps-20-wins@ce47598"]);
    expect([...handoff.evidence.providerPostIds].sort()).toEqual([
      "instagram-reels:DeIi5pZDWew", "instagram-reels:DeKLo_0kw7C", "tiktok:7693352089078058271", "tiktok:7693587971584429343",
      "youtube-shorts:648FsZLefnc", "youtube-shorts:cSDhjFC-CI8",
    ]);
    expect([...handoff.evidence.mediaSha256s].sort()).toEqual([RAM_FIT_PUBLISHED_COPY.sha256, FPS_20_WINS_PUBLISHED_COPY.sha256, FPS_20_WINS_RENDER_SHA256].sort());
    expect(handoff.evidence.observationIds).toEqual([]);
    expect(report.posts.every((entry) => entry.publishedAt.value === null && entry.scheduledAt.value !== null && entry.providerStatus.value === "PUBLISHED")).toBe(true);
    // Each published copy is described once, not once per platform.
    expect(report.observations.filter((line) => line.includes(`sha256 ${RAM_FIT_PUBLISHED_COPY.sha256}`)).length).toBe(1);
    expect(report.unknowns.filter((line) => line.includes("the handle @specsmithpc is known but is not that id")).length).toBe(4);
    const lines = handoff.brief.memoryObservations;
    expect(lines.some((line) => line.includes(report.reportId) && line.includes(RAM_FIT_PUBLISHED_COPY.sha256))).toBe(true);
    expect(lines.some((line) => line.startsWith("Creative change to test") && line.includes("a hypothesis, not a finding"))).toBe(true);
    // With no trusted observation for the RAM post, the report says so for that post and names the access cause.
    expect(report.unknowns.some((line) => line.startsWith("ram-fit@saved-take-pr172 on youtube-shorts: no trusted observation is stored"))).toBe(true);
    expect(report.unknowns.some((line) => line.startsWith("Access: Metricool"))).toBe(true);
  });
});

describe("the recorded facts", () => {
  it("are the six connector-reported posts, with no publication time, handle-as-account or metric invented", () => {
    expect(PUBLISHED_POSTS.map((entry) => [entry.platform, entry.postUrl.value, entry.aggregatorPostId.value, entry.scheduledAt.value])).toEqual([
      ["youtube-shorts", "https://www.youtube.com/shorts/cSDhjFC-CI8", "387469692", "2026-10-03T16:00:00-04:00"],
      ["tiktok", "https://www.tiktok.com/@specsmithpc/video/7693352089078058271", "389042813", "2026-10-05T20:55:00-04:00"],
      ["instagram-reels", "https://www.instagram.com/reel/DeIi5pZDWew/", "389042813", "2026-10-05T20:55:00-04:00"],
      ["youtube-shorts", "https://www.youtube.com/shorts/648FsZLefnc", "389611858", "2026-10-06T12:10:00-04:00"],
      ["tiktok", "https://www.tiktok.com/@specsmithpc/video/7693587971584429343", "389611858", "2026-10-06T12:10:00-04:00"],
      ["instagram-reels", "https://www.instagram.com/reel/DeKLo_0kw7C/", "389611858", "2026-10-06T12:10:00-04:00"],
    ]);
    for (const entry of PUBLISHED_POSTS) {
      expect(entry.postUrl.source).toBe("connector-reported");
      expect(entry.providerStatus).toMatchObject({ value: "PUBLISHED", source: "connector-reported" });
      expect(entry.publishedAt.value).toBeNull();
      if (entry.platform === "youtube-shorts") expect(entry.accountId.value).toBe(CHANNEL);
      else {
        expect(entry.accountId.value).toBeNull();
        expect(entry.handle.value).toBe("@specsmithpc");
      }
    }
    expect(JSON.stringify(PUBLISHED_POSTS)).not.toMatch(/"(views|likes|retention)"/);
  });
});
