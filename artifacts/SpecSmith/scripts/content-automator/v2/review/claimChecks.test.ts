// Presentation-integrity checks that need no media: each defect against the
// model the figure comes from, with an honest control beside it.

import { describe, expect, it } from "vitest";

import { DEMO_PAIRING } from "../../leadsVsAverage/facts.ts";
import { CREATIVE_DISCLOSURES } from "../creative/concept.ts";
import { checkClaims, checkGraphics, type BeatCapture, type PresentationContext } from "./claimChecks.ts";
import { FIXTURE_CLAIMS, FIXTURE_CONTRACT, FIXTURE_STORYBOARD, fixtureCaptureMetadata } from "./reviewFixture.ts";
import type { EditorialGraphic, PresentedClaim } from "./inputs.ts";
import { pairingFromRoute } from "./util.ts";

const capture = (pairing = DEMO_PAIRING): BeatCapture => {
  const metadata = fixtureCaptureMetadata(pairing);
  return { assetId: "c", pairing: pairingFromRoute(metadata.route), metadata };
};
function context(overrides: Partial<PresentationContext> & { narration?: string; caption?: string }): PresentationContext {
  const storyboard = structuredClone(FIXTURE_STORYBOARD);
  // Beat 2 carries only what each test puts there; beat 1 keeps the fixture's declared tally.
  (storyboard.beats[1] as { narration: string }).narration = overrides.narration ?? "Here is the comparison.";
  return {
    storyboard,
    title: "Ahead in more games, behind on average",
    description: "SpecSmith model estimates.",
    captionsByBeat: storyboard.beats.map((beat, index) => index === 1 ? overrides.caption ?? "Compare" : beat.onScreenText),
    capturesByBeat: [[capture()], [capture()], [capture({ ...DEMO_PAIRING, resolution: "1080p", preset: "low" })]],
    claims: [],
    graphics: [],
    disclosureLines: [CREATIVE_DISCLOSURES["disclosure.fps-estimate"]],
    disclosureVerifiedOnScreen: true,
    contract: FIXTURE_CONTRACT,
    ...overrides,
    claims: [...FIXTURE_CLAIMS.filter((entry) => entry.beatIndex === 0), ...(overrides.claims ?? [])],
  };
}
const claim = (text: string, statement: PresentedClaim["statement"], where: PresentedClaim["where"] = "caption"): PresentedClaim =>
  ({ claimId: "c", beatIndex: 1, where, text, basis: "model-estimate", statement });
const codes = (ctx: PresentationContext) => checkClaims(ctx).map((entry) => entry.code);

describe("figures against the model", () => {
  it("swapped builds are named as a swap", () => {
    expect(codes(context({ caption: "Est. average: 123 vs 121", claims: [claim("Est. average: 123 vs 121", { kind: "averages", pairing: DEMO_PAIRING, averageA: 123, averageB: 121 })] })))
      .toContain("build-identity-swapped");
    expect(codes(context({ caption: "Est. average: 121 vs 123", claims: [claim("Est. average: 121 vs 123", { kind: "averages", pairing: DEMO_PAIRING, averageA: 121, averageB: 123 })] })))
      .toEqual([]);
  });

  it("a rounded average difference called exact", () => {
    const text = "B is exactly 2 FPS faster on average";
    expect(codes(context({ caption: text, claims: [claim(text, { kind: "average-difference", pairing: DEMO_PAIRING, leader: "B", difference: 2 })] })))
      .toContain("rounded-average-as-exact");
    const honest = "B averages about 2 FPS more";
    expect(codes(context({ caption: honest, claims: [claim(honest, { kind: "average-difference", pairing: DEMO_PAIRING, leader: "B", difference: 2 })] })))
      .toEqual([]);
  });

  it("one game generalised to every game", () => {
    const text = "Minecraft: B leads by 18 FPS in every game";
    expect(codes(context({ caption: text, claims: [claim(text, { kind: "game-margin", pairing: DEMO_PAIRING, game: "Minecraft", leader: "B", margin: 18 })] })))
      .toContain("single-example-generalised");
    const honest = "Minecraft: B leads by 18 FPS";
    expect(codes(context({ caption: honest, claims: [claim(honest, { kind: "game-margin", pairing: DEMO_PAIRING, game: "Minecraft", leader: "B", margin: 18 })] })))
      .toEqual([]);
  });

  it("a per-game tie presented as a lead", () => {
    const text = "Call of Duty: Warzone: A ahead by 1 FPS";
    expect(codes(context({ caption: text, claims: [claim(text, { kind: "game-margin", pairing: DEMO_PAIRING, game: "Call of Duty: Warzone", leader: "A", margin: 1 })] })))
      .toEqual(["tie-counted-as-lead"]);
    const honest = "Call of Duty: Warzone: a tie at 119 FPS";
    expect(codes(context({ caption: honest, claims: [claim(honest, { kind: "game-margin", pairing: DEMO_PAIRING, game: "Call of Duty: Warzone", leader: "tie", margin: 0 })] })))
      .toEqual([]);
  });

  it("settings omitted where no screen travels with the figure", () => {
    const title = "Build B: 123 FPS average";
    const titled = context({ title, claims: [{ ...claim(title, { kind: "averages", pairing: DEMO_PAIRING, averageA: 121, averageB: 123 }, "title"), text: "123 FPS average" }] });
    expect(codes(titled)).toEqual(expect.arrayContaining(["conditions-omitted", "estimate-unlabelled"]));
    const fixed = "Est. 1440p High average: 121 vs 123 FPS";
    expect(codes(context({ title: fixed, claims: [claim(fixed, { kind: "averages", pairing: DEMO_PAIRING, averageA: 121, averageB: 123 }, "title")] }))).toEqual([]);
  });

  it("a figure nobody declared", () => {
    expect(codes(context({ caption: "B is 18 FPS faster in Minecraft" }))).toContain("undeclared-figure");
  });

  it("a declaration that says something the text does not", () => {
    expect(codes(context({ caption: "Est. average: 121 vs 123", claims: [claim("Est. average: 121 vs 123", { kind: "averages", pairing: DEMO_PAIRING, averageA: 120, averageB: 123 })] })))
      .toEqual(expect.arrayContaining(["declaration-differs-from-text", "figure-contradicts-model"]));
  });

  it("a figure with no estimate label and no verified disclosure", () => {
    const text = "Average: 121 vs 123";
    expect(codes(context({ caption: text, disclosureVerifiedOnScreen: false, claims: [claim(text, { kind: "averages", pairing: DEMO_PAIRING, averageA: 121, averageB: 123 })] })))
      .toContain("estimate-unlabelled");
  });

  it("a research claim whose qualifier was dropped", () => {
    const contract = { ...FIXTURE_CONTRACT, safeClaims: [{ claimId: "r", proposition: "p", state: "known" as const, requiredWording: ["model estimates"], attribution: undefined, supportingSnapshotIds: [] }] };
    const text = "Every gap here is inside the range";
    const research = { claimId: "c", beatIndex: 1, where: "narration" as const, text, basis: "research-claim" as const, statement: { kind: "research" as const, researchClaimId: "r" } };
    expect(codes(context({ narration: text, contract, disclosureLines: ["Something else."], claims: [research] }))).toContain("qualifier-dropped");
    expect(codes(context({ narration: `${text}. These are model estimates.`, contract, claims: [research] }))).not.toContain("qualifier-dropped");
  });
});

describe("graphics", () => {
  const bars = (lengths: [number, number], axisStartsAtZero = true): EditorialGraphic => ({
    graphicId: "g", beatIndex: 1, label: "Estimated averages",
    shows: { kind: "bars", pairing: DEMO_PAIRING, of: "averages", values: [121, 123], barLengthsPx: lengths, axisStartsAtZero }, attributedTo: "model",
  });
  it("an exaggerated or truncated scale makes a 2 FPS gap look large", () => {
    expect(checkGraphics([bars([300, 600])], []).map((entry) => entry.code)).toContain("exaggerated-scale");
    expect(checkGraphics([bars([605, 615], false)], []).map((entry) => entry.code)).toContain("truncated-axis");
    expect(checkGraphics([bars([605, 615])], [])).toEqual([]);
  });

  it("a physical-measurement metaphor for an estimate", () => {
    const metaphor = (label: string): EditorialGraphic => ({ graphicId: "m", beatIndex: 1, label, shows: { kind: "metaphor", metaphor: "speedometer", subject: "fps" }, attributedTo: "illustration" });
    expect(checkGraphics([metaphor("Build B is faster")], []).map((entry) => entry.code)).toEqual(["metaphor-implies-measurement"]);
    expect(checkGraphics([metaphor("Illustration of the estimate, not a measurement")], [])).toEqual([]);
  });

  it("a tie shown as a lead in an outcomes graphic", () => {
    const graphic: EditorialGraphic = { graphicId: "o", beatIndex: 1, label: "Who leads", attributedTo: "model",
      shows: { kind: "outcomes", pairing: DEMO_PAIRING, perGame: [{ game: "Baldur's Gate 3", outcome: "A" }] } };
    expect(checkGraphics([graphic], []).map((entry) => entry.code)).toEqual(["tie-counted-as-lead"]);
  });
});
