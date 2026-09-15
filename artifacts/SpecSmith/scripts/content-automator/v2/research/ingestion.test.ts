// Strict ingestion tests.
//
// The property this file protects: garbage is REFUSED, never coerced. Every
// test that asserts a throw is asserting that a malformed record did not become
// a plausible-looking one, because a boundary that repairs its input is the
// mechanism by which fabricated evidence enters a research system.

import { describe, expect, it } from "vitest";

import {
  evidenceFingerprint,
  ingestResearchEvidence,
  parseObservation,
  parseSourceSnapshot,
  ResearchIngestionError,
} from "./ingestion.ts";
import type { SourceSnapshot } from "./model.ts";

const ENGINEERING = { allowSynthetic: true } as const;
const PRODUCTION = { allowSynthetic: false } as const;

const provenance = (synthetic: boolean) => ({ synthetic, producedBy: "test", producedAt: "2026-09-15T10:00:00.000Z" });

function rawSnapshot(overrides: Record<string, unknown> = {}, sourceOverrides: Record<string, unknown> = {}) {
  return {
    snapshotId: "snap-1",
    source: {
      sourceId: "src-1",
      sourceType: "independent-benchmark",
      publisher: "Example Lab",
      url: "https://lab.example/article",
      publishedAt: "2026-09-01T00:00:00.000Z",
      ...sourceOverrides,
    },
    retrievedAt: "2026-09-15T10:00:00.000Z",
    retrievalMethod: "direct-fetch",
    contentHash: "a".repeat(64),
    provenance: provenance(true),
    ...overrides,
  };
}

function rawObservation(overrides: Record<string, unknown> = {}) {
  return {
    observationId: "obs-1",
    snapshotId: "snap-1",
    form: "structured-value",
    content: "90 fps",
    fields: { averageFps: 90 },
    observedAt: "2026-09-15T10:00:00.000Z",
    provenance: provenance(true),
    ...overrides,
  };
}

describe("the synthetic boundary", () => {
  it("accepts synthetic evidence in the engineering environment", () => {
    expect(parseSourceSnapshot(rawSnapshot(), ENGINEERING).provenance.synthetic).toBe(true);
  });

  it("refuses synthetic evidence in production, by name", () => {
    expect(() => parseSourceSnapshot(rawSnapshot(), PRODUCTION)).toThrow(/may never enter production research memory/);
  });

  it("refuses a record that does not say whether it is synthetic", () => {
    const raw = rawSnapshot({ provenance: { producedBy: "test", producedAt: "2026-09-15T10:00:00.000Z" } });
    expect(() => parseSourceSnapshot(raw, ENGINEERING)).toThrow(/must be an explicit boolean/);
  });

  it("refuses an observation whose synthetic flag disagrees with its snapshot", () => {
    const snapshots = new Map<string, SourceSnapshot>([["snap-1", parseSourceSnapshot(rawSnapshot(), ENGINEERING)]]);
    const raw = rawObservation({ provenance: provenance(false) });
    expect(() => parseObservation(raw, snapshots, ENGINEERING)).toThrow(/Fixture data may not be mixed with real evidence/);
  });
});

describe("impossible and missing data is refused, not repaired", () => {
  it("refuses a source retrieved before it was published", () => {
    const raw = rawSnapshot({ retrievedAt: "2026-08-01T00:00:00.000Z" });
    expect(() => parseSourceSnapshot(raw, ENGINEERING)).toThrow(/cannot be retrieved before it exists/);
  });

  it("refuses an update time that precedes publication", () => {
    const raw = rawSnapshot({}, { updatedAt: "2026-07-01T00:00:00.000Z" });
    expect(() => parseSourceSnapshot(raw, ENGINEERING)).toThrow(/precedes publishedAt/);
  });

  it("refuses an observation older than the snapshot that carried it", () => {
    const snapshots = new Map<string, SourceSnapshot>([["snap-1", parseSourceSnapshot(rawSnapshot(), ENGINEERING)]]);
    expect(() => parseObservation(rawObservation({ observedAt: "2026-09-14T00:00:00.000Z" }), snapshots, ENGINEERING))
      .toThrow(/precedes its snapshot/);
  });

  it("keeps a missing publication date missing rather than defaulting it to now", () => {
    const parsed = parseSourceSnapshot(rawSnapshot({}, { publishedAt: undefined }), ENGINEERING);
    expect(parsed.publishedAt).toBeUndefined();
  });

  it("refuses a present-but-null optional field instead of silently dropping it", () => {
    expect(() => parseSourceSnapshot(rawSnapshot({}, { title: null }), ENGINEERING)).toThrow(/Omit the key entirely/);
  });

  it("refuses a null metric rather than treating it as absent", () => {
    const snapshots = new Map<string, SourceSnapshot>([["snap-1", parseSourceSnapshot(rawSnapshot(), ENGINEERING)]]);
    expect(() => parseObservation(rawObservation({ fields: { averageFps: null } }), snapshots, ENGINEERING))
      .toThrow(/refused rather than dropped/);
  });

  it("keeps a real zero as a real zero", () => {
    const snapshots = new Map<string, SourceSnapshot>([["snap-1", parseSourceSnapshot(rawSnapshot(), ENGINEERING)]]);
    expect(parseObservation(rawObservation({ fields: { averageFps: 0 } }), snapshots, ENGINEERING).fields?.averageFps).toBe(0);
  });

  it("refuses an unrecognised enum rather than mapping it to a default", () => {
    expect(() => parseSourceSnapshot(rawSnapshot({}, { sourceType: "blog-ish" }), ENGINEERING)).toThrow(/refused rather than mapped to a default/);
    expect(() => parseSourceSnapshot(rawSnapshot({ retrievalMethod: "vibes" }), ENGINEERING)).toThrow(/must be one of/);
  });

  it("refuses an observation with no matching snapshot", () => {
    expect(() => parseObservation(rawObservation({ snapshotId: "snap-missing" }), new Map(), ENGINEERING))
      .toThrow(/An observation with no source is not evidence/);
  });

  it("refuses a source that declares itself its own upstream", () => {
    expect(() => parseSourceSnapshot(rawSnapshot({ upstreamSourceId: "src-1" }), ENGINEERING)).toThrow(/cannot be its own upstream/);
  });
});

describe("URL safety", () => {
  it("refuses a non-http scheme", () => {
    expect(() => parseSourceSnapshot(rawSnapshot({}, { url: "file:///etc/passwd" }), ENGINEERING)).toThrow(/Only http\(s\) sources/);
  });

  it("refuses a URL carrying credentials", () => {
    expect(() => parseSourceSnapshot(rawSnapshot({}, { url: "https://user:secret@lab.example/a" }), ENGINEERING))
      .toThrow(/must not carry credentials/);
  });

  it("refuses a malformed URL", () => {
    expect(() => parseSourceSnapshot(rawSnapshot({}, { url: "not a url" }), ENGINEERING)).toThrow(ResearchIngestionError);
  });
});

describe("idempotency and deduplication", () => {
  const document = { snapshots: [rawSnapshot()], observations: [rawObservation()] };

  it("ingests a fresh document", () => {
    const result = ingestResearchEvidence(document, ENGINEERING);
    expect(result.snapshots).toHaveLength(1);
    expect(result.observations).toHaveLength(1);
    expect(result.duplicatesSkipped).toBe(0);
  });

  it("treats an exact replay as a no-op", () => {
    const first = ingestResearchEvidence(document, ENGINEERING);
    const second = ingestResearchEvidence(document, ENGINEERING, first);
    expect(second.snapshots).toHaveLength(0);
    expect(second.observations).toHaveLength(0);
  });

  it("skips the same evidence arriving under a new id, so agreement cannot be faked", () => {
    const first = ingestResearchEvidence(document, ENGINEERING);
    const duplicate = {
      snapshots: [rawSnapshot()],
      observations: [rawObservation({ observationId: "obs-2" })],
    };
    const second = ingestResearchEvidence(duplicate, ENGINEERING, first);
    expect(second.observations).toHaveLength(0);
    expect(second.duplicatesSkipped).toBe(1);
  });

  it("fails closed on a conflicting replay rather than overwriting history", () => {
    const first = ingestResearchEvidence(document, ENGINEERING);
    const changed = { snapshots: [rawSnapshot({ contentHash: "b".repeat(64) })], observations: [] };
    expect(() => ingestResearchEvidence(changed, ENGINEERING, first)).toThrow(/is not editable/);
  });

  it("fails closed when an observation id is reused with different content", () => {
    const first = ingestResearchEvidence(document, ENGINEERING);
    const changed = { snapshots: [rawSnapshot()], observations: [rawObservation({ content: "95 fps" })] };
    expect(() => ingestResearchEvidence(changed, ENGINEERING, first)).toThrow(/append-only/);
  });

  it("fingerprints identical evidence identically and different evidence differently", () => {
    const snapshot = parseSourceSnapshot(rawSnapshot(), ENGINEERING);
    const snapshots = new Map([["snap-1", snapshot]]);
    const a = parseObservation(rawObservation(), snapshots, ENGINEERING);
    const b = parseObservation(rawObservation({ observationId: "obs-9" }), snapshots, ENGINEERING);
    const c = parseObservation(rawObservation({ content: "91 fps" }), snapshots, ENGINEERING);
    expect(evidenceFingerprint(a, snapshot)).toBe(evidenceFingerprint(b, snapshot));
    expect(evidenceFingerprint(a, snapshot)).not.toBe(evidenceFingerprint(c, snapshot));
  });

  it("refuses a document that is not shaped like one", () => {
    expect(() => ingestResearchEvidence({ snapshots: {}, observations: [] }, ENGINEERING)).toThrow(/must be an array/);
  });
});
