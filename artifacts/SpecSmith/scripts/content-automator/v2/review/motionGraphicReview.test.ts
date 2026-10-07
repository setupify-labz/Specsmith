// MASTER #7 reading a motion-graphic cut: the labels a graphic draws count as
// the beat's text (for its setting and qualifiers, never its figures); the
// planned caption set is the production plan's; synthesized sound effects are
// repo-made only on their renderer's word; and narration timing respects what
// the silence detector can resolve.

import { describe, expect, it } from "vitest";

import { DEMO_PAIRING } from "../../leadsVsAverage/facts.ts";
import { CREATIVE_DISCLOSURES } from "../creative/concept.ts";
import { checkClaims, type PresentationContext } from "./claimChecks.ts";
import { REQUIRED_USE, type AssetRightsRecord, type PresentedClaim, type RenderManifestAsset } from "./inputs.ts";
import { declaredEffectWindows, narrationSpans, plannedCaptionCues, unexplainedSound } from "./reviewCreative.ts";
import { FIXTURE_CLAIMS, FIXTURE_CONTRACT, FIXTURE_STORYBOARD } from "./reviewFixture.ts";
import { checkRights } from "./rightsChecks.ts";

function context(graphicText: string | undefined): PresentationContext {
  const storyboard = structuredClone(FIXTURE_STORYBOARD);
  (storyboard.beats[1] as { narration: string }).narration = "Here is the comparison.";
  const text = "Est. average: 121 vs 123";
  const claim: PresentedClaim = { claimId: "c", beatIndex: 1, where: "caption", text, basis: "model-estimate",
    statement: { kind: "averages", pairing: DEMO_PAIRING, averageA: 121, averageB: 123 } };
  return {
    storyboard, title: "t", description: "SpecSmith model estimates.",
    captionsByBeat: storyboard.beats.map((beat, index) => index === 1 ? text : beat.onScreenText),
    graphicTextByBeat: storyboard.beats.map((_, index) => index === 1 ? graphicText ?? "" : ""),
    // Beat 2 shows a motion graphic: no Compare capture, so no pairing on screen.
    capturesByBeat: storyboard.beats.map(() => []),
    claims: [...FIXTURE_CLAIMS.filter((entry) => entry.beatIndex === 0), claim],
    graphics: [], disclosureLines: [CREATIVE_DISCLOSURES["disclosure.fps-estimate"]], disclosureVerifiedOnScreen: true, contract: FIXTURE_CONTRACT,
  };
}
const omitted = (ctx: PresentationContext) => checkClaims(ctx).filter((entry) => entry.code === "conditions-omitted" && entry.location === "beat 2 caption");

describe("a motion graphic's drawn labels are part of its beat's text", () => {
  it("the setting the graphic states satisfies the conditions a figure needs", () => {
    const setting = `${DEMO_PAIRING.resolution} ${DEMO_PAIRING.preset}`;
    expect(omitted(context(undefined))).toHaveLength(1);
    expect(omitted(context(`SpecSmith model estimates · ${setting}`))).toEqual([]);
  });

  it("a graphic stating another setting does not", () => {
    expect(omitted(context("SpecSmith model estimates · 4k ultra"))).toHaveLength(1);
  });
});

describe("the planned caption set", () => {
  it("is the production plan's cues when it has them, so a caption carried by a graphic is not expected in the band", () => {
    const cues = [{ startSecond: 0, endSecond: 3, text: "Same CPU. New GPU." }];
    expect(plannedCaptionCues({ tasks: [{ capability: "caption-render", captionRenderState: { cues } }] })).toEqual(cues);
    expect(plannedCaptionCues({ platforms: [{ tasks: [{ capability: "caption-render", captionRenderState: { cues } }] }] })).toEqual(cues);
  });

  it("falls back to one per beat when the plan has none, or malformed ones", () => {
    expect(plannedCaptionCues({ tasks: [] })).toBeNull();
    expect(plannedCaptionCues(null)).toBeNull();
    expect(plannedCaptionCues({ tasks: [{ capability: "caption-render", captionRenderState: { cues: [{ startSecond: 0, text: "x" }] } }] })).toBeNull();
  });
});

describe("narration spans", () => {
  it("joins lines closer than the silence detector can separate, and keeps real pauses", () => {
    expect(narrationSpans([{ startSecond: 0.1, endSecond: 3.0 }, { startSecond: 3.3, endSecond: 7.0 }, { startSecond: 9.0, endSecond: 10.0 }]))
      .toEqual([{ startSecond: 0.1, endSecond: 7.0 }, { startSecond: 9.0, endSecond: 10.0 }]);
  });
});

describe("sound outside the narration", () => {
  // The saved take's own numbers: Liam pauses about 0.7 s between lines, and
  // the cut whoosh plays 0.05 s before each new picture, inside that pause.
  const spans = narrationSpans([{ startSecond: 8.51, endSecond: 11.9 }, { startSecond: 12.597, endSecond: 18.1 }]);
  const whoosh = declaredEffectWindows(JSON.stringify([{ atSecond: 12.35, kind: "whoosh", reason: "cut to beat 4", seconds: 0.32 }]));

  it("is explained by a declared effect, even when silencedetect joins it to the next line", () => {
    expect(whoosh).toEqual([{ startSecond: 12.35, endSecond: 12.67 }]);
    expect(unexplainedSound([{ start: 12.37, end: 15.9 }], spans, whoosh)).toEqual([]);
  });

  it("is refused without a declared effect, and wherever no effect was declared", () => {
    expect(unexplainedSound([{ start: 12.37, end: 15.9 }], spans, [])).toEqual([{ start: 12.37, end: 15.9 }]);
    expect(unexplainedSound([{ start: 12.0, end: 12.2 }], spans, whoosh)).toEqual([{ start: 12.0, end: 12.2 }]);
  });

  it("reads no windows from a cue list without lengths, or an unreadable one", () => {
    expect(declaredEffectWindows(JSON.stringify([{ atSecond: 1, kind: "whoosh" }]))).toEqual([]);
    expect(declaredEffectWindows("not json")).toEqual([]);
    expect(declaredEffectWindows(undefined)).toEqual([]);
  });
});

describe("synthesized sound effects", () => {
  const asset = (renderer: string, isLicensedSample: boolean | undefined): RenderManifestAsset => ({
    assetId: "sfx", role: "sound-effect", path: "/x.wav", sha256: "0".repeat(64),
    metadata: { renderer, ...(isLicensedSample === undefined ? {} : { isLicensedSample }) },
  });
  const record = (kind: AssetRightsRecord["kind"]): AssetRightsRecord => ({
    assetId: "sfx", kind, source: "soundEffects.ts",
    license: { kind: "repo-owned", evidence: "made here", permittedUse: [REQUIRED_USE], attribution: null, expiresAt: null, scope: "SpecSmith" },
    generation: { generator: "ffmpeg lavfi", inputs: "cue list" }, transformations: [], placeholder: { isPlaceholder: false, why: null },
  });
  const codes = (a: RenderManifestAsset, r: AssetRightsRecord) => checkRights({ assets: [a], records: [r], now: new Date(0) }).map((entry) => entry.code);

  it("are repo-made when their renderer says it synthesized them, with no samples", () => {
    expect(codes(asset("specsmith-synth-sound-effects", false), record("sound-effect"))).toEqual([]);
  });

  it("need evidence otherwise: any other renderer, or one that used a licensed sample", () => {
    expect(codes(asset("some-library", undefined), record("sound-effect"))).toContain("repo-ownership-unsupported");
    expect(codes(asset("specsmith-synth-sound-effects", true), record("sound-effect"))).toContain("repo-ownership-unsupported");
  });

  it("must be described as what they are", () => {
    expect(codes(asset("specsmith-synth-sound-effects", false), record("music"))).toContain("asset-kind-mismatch");
  });
});
