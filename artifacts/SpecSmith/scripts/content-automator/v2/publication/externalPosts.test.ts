// MASTER #8: externally published posts stay apart from authorized publications,
// carry their sources, and never gain a metric they do not have.

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runPublishedPosts } from "../../publishedPostsCli.ts";
import { creativeForProviderPost, listStoredCreativeIds } from "../../publishingStore.ts";
import { loadAuthorization } from "./boundary.ts";
import {
  ExternalPostError,
  externalPostReport,
  loadExternalPosts,
  nativePostIdFromUrl,
  recordExternalPost,
  type ExternalPostInput,
} from "./externalPosts.ts";
import { buildLearningReport } from "./learningReport.ts";
import { recordUnverifiedObservations } from "./observations.ts";
import { PUBLISHED_POSTS, PUBLISHED_WITHOUT_POSTS } from "./publishedPosts.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function store() {
  const root = await mkdtemp(join(tmpdir(), "external-posts-"));
  roots.push(root);
  return root;
}
const NOW = new Date("2026-10-06T18:00:00Z");
const RAM: ExternalPostInput = PUBLISHED_POSTS[0];

describe("recording an externally published post", () => {
  it("records the URL, native id, time and version with their sources, and is never machine-authorized", async () => {
    const root = await store();
    const record = await recordExternalPost({ storeRoot: root, post: RAM, now: NOW });
    expect(record.machineAuthorized).toBe(false);
    expect(record.kind).toBe("EXTERNAL_PUBLICATION");
    expect(record.nativePostId.value).toBe("cSDhjFC-CI8");
    expect(record.postUrl).toMatchObject({ value: "https://www.youtube.com/shorts/cSDhjFC-CI8", source: "user-provided" });
    // Not supplied, so not invented: the file's encode time is not promoted to a publication time.
    expect(record.publishedAt).toEqual({ value: null, source: null, basis: expect.stringContaining("not a confirmed publication time") });
    expect(record.creativeVersion.source).toBe("file-measured");
    expect(record.media?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reads native ids only from each platform's own post URLs", () => {
    expect(nativePostIdFromUrl("youtube-shorts", "https://youtube.com/shorts/cSDhjFC-CI8")).toBe("cSDhjFC-CI8");
    expect(nativePostIdFromUrl("youtube-shorts", "https://youtu.be/cSDhjFC-CI8")).toBe("cSDhjFC-CI8");
    expect(nativePostIdFromUrl("tiktok", "https://www.tiktok.com/@specsmith/video/7430000000000000000")).toBe("7430000000000000000");
    expect(nativePostIdFromUrl("instagram-reels", "https://www.instagram.com/reel/DAbc123xyz/")).toBe("DAbc123xyz");
    for (const [platform, url] of [
      ["youtube-shorts", "https://evil.example/shorts/cSDhjFC-CI8"],
      ["youtube-shorts", "http://youtube.com/shorts/cSDhjFC-CI8"],
      ["tiktok", "https://www.youtube.com/shorts/cSDhjFC-CI8"],
      ["instagram-reels", "https://www.instagram.com/specsmith/"],
    ] as const) expect(nativePostIdFromUrl(platform, url)).toBeNull();
  });

  it("refuses a wrong-platform URL, an unparseable time and an unknown time with no reason", async () => {
    const root = await store();
    await expect(recordExternalPost({ storeRoot: root, post: { ...RAM, platform: "tiktok" } })).rejects.toThrow(ExternalPostError);
    await expect(recordExternalPost({ storeRoot: root, post: { ...RAM, publishedAt: "yesterday" } })).rejects.toThrow(/not a timestamp/);
    await expect(recordExternalPost({ storeRoot: root, post: { ...RAM, publishedAtBasis: " " } })).rejects.toThrow(/needs a reason/);
    await expect(recordExternalPost({ storeRoot: root, post: { ...RAM, media: null } })).rejects.toThrow(/file's evidence/);
  });

  it("is idempotent for the same facts and refuses to overwrite different ones", async () => {
    const root = await store();
    const first = await recordExternalPost({ storeRoot: root, post: RAM, now: NOW });
    expect((await recordExternalPost({ storeRoot: root, post: RAM, now: NOW })).recordId).toBe(first.recordId);
    await expect(recordExternalPost({ storeRoot: root, post: { ...RAM, publishedAt: "2026-10-03T20:00:00Z", publishedAtBasis: "typed" } }))
      .rejects.toThrow(/already recorded with different facts/);
  });
});

describe("kept apart from machine-authorized publications", () => {
  it("writes no ledger, no authorization and no provider-post index, so trusted import and the learning report ignore it", async () => {
    const root = await store();
    await recordExternalPost({ storeRoot: root, post: RAM, now: NOW });
    expect(await listStoredCreativeIds(root)).toEqual([]);
    expect(await creativeForProviderPost(root, "metricool", "cSDhjFC-CI8")).toBeNull();
    expect(await creativeForProviderPost(root, "youtube", "cSDhjFC-CI8")).toBeNull();
    expect(await loadAuthorization(root, "ram-fit")).toBeNull();
    expect((await buildLearningReport({ storeRoot: root, now: NOW })).videos).toEqual([]);
    expect(await readdir(root)).toEqual(["external-posts"]);
  });

  it("refuses to load a record that claims machine authorization", async () => {
    const root = await store();
    await recordExternalPost({ storeRoot: root, post: RAM, now: NOW });
    const { writeFile, readFile } = await import("node:fs/promises");
    const path = join(root, "external-posts", "youtube-shorts-cSDhjFC-CI8.json");
    await writeFile(path, (await readFile(path, "utf8")).replace("\"machineAuthorized\": false", "\"machineAuthorized\": true"));
    await expect(loadExternalPosts(root)).rejects.toThrow(/refusing to read/);
  });
});

describe("the published-post report", () => {
  it("marks every metric unavailable with a reason and never writes a value", async () => {
    const root = await store();
    await recordExternalPost({ storeRoot: root, post: RAM, now: NOW });
    const report = await externalPostReport({ storeRoot: root, now: NOW, env: {} });
    const metrics = report.posts[0].metrics;
    expect(metrics.length).toBeGreaterThan(5);
    expect(metrics.find((metric) => metric.metricId === "stayed-to-watch-rate")?.reason).toMatch(/not served/);
    for (const metric of metrics) {
      expect(metric.state).toBe("unavailable");
      expect(metric.reason.length).toBeGreaterThan(10);
      expect(Object.keys(metric)).not.toContain("value");
    }
    expect(metrics.find((metric) => metric.metricId === "audience-retention-curve")?.reason).toMatch(/no trusted source/);
    expect(report.unknowns.join(" ")).toMatch(/publication time unknown/);
    expect(report.nextBrief.proposedChange).toBeNull();
  });

  it("keeps pasted numbers labelled UNVERIFIED and out of the observations", async () => {
    const root = await store();
    await recordExternalPost({ storeRoot: root, post: RAM, now: NOW });
    await recordUnverifiedObservations({ storeRoot: root, providerPostId: "cSDhjFC-CI8", suppliedBy: "user, screenshot of YouTube Studio", supplied: { views: 12345 }, now: NOW });
    const report = await externalPostReport({ storeRoot: root, now: NOW, env: {} });
    expect(report.posts[0].userProvidedEvidence).toEqual([expect.objectContaining({ suppliedBy: "user, screenshot of YouTube Studio" })]);
    expect(report.posts[0].metrics.every((metric) => metric.state === "unavailable")).toBe(true);
    const text = JSON.stringify({ observations: report.observations, hypotheses: report.hypotheses, brief: report.nextBrief.memoryObservations });
    expect(text).not.toContain("12345");
    expect(report.unknowns.join(" ")).toMatch(/UNVERIFIED and not used/);
  });

  it("walks post -> report -> creative memory -> next brief, with the change labelled a hypothesis", async () => {
    const root = await store();
    const out = await store();
    const { report, entries, handoff } = await runPublishedPosts({ storeRoot: root, outDir: out, now: NOW });
    expect(entries.every((entry) => entry.outcome.state === "unknown" && entry.evidenceStrength === "insufficient")).toBe(true);
    expect(report.creativesWithoutPosts).toEqual(["fps-20-wins"]);
    expect(report.unknowns.join(" ")).toMatch(/fps-20-wins: published, but no post URL/);
    expect(report.hypotheses).toHaveLength(1);
    expect(report.observations.some((line) => /performed|better|worse/i.test(line))).toBe(false);
    const lines = handoff.brief.memoryObservations;
    expect(lines.some((line) => line.includes(report.reportId) && line.includes("a hypothesis with no performance evidence yet"))).toBe(true);
    expect(handoff.evidence.reportId).toBe(report.reportId);
  });
});

describe("the recorded facts", () => {
  it("record no time, URL or metric that was not supplied", () => {
    expect(PUBLISHED_POSTS.every((post) => post.publishedAt === null)).toBe(true);
    expect(PUBLISHED_POSTS.map((post) => post.platform)).toEqual(["youtube-shorts"]);
    expect(PUBLISHED_WITHOUT_POSTS.map((creative) => creative.creativeKey)).toEqual(["fps-20-wins"]);
    expect(JSON.stringify(PUBLISHED_POSTS)).not.toMatch(/"(views|likes|retention)"/);
  });
});
