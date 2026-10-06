// Factual and presentation integrity: every figure a viewer reads or hears,
// recomputed from the model it comes from, and checked against the screen it
// is presented over.
//
// Declared claims are statements to be checked, not facts: the numbers in a
// declaration must be the numbers in the text, the text must be in the render,
// and the values must be what the model gives. A figure in the text with no
// declaration is a defect of its own, so leaving a claim undeclared does not
// get it past review.

import gpus from "../../../../src/data/gpus.json" with { type: "json" };
import cpus from "../../../../src/data/cpus.json" with { type: "json" };
import games from "../../../../src/data/games.json" with { type: "json" };
import { estimateFpsForBuild, type BuildFpsCpu, type BuildFpsGame, type BuildFpsGpu } from "../../../../src/lib/fps.ts";
import { leadsVsAverageFacts, shortGameNameOf, type ComparePairing, type LeadsVsAverageFacts } from "./modelFacts.ts";
import { compareAverageFpsText, compareTiesText } from "../../uiRender/surfaces.ts";
import { modelSnapshotSha256 } from "../../modelSnapshot.ts";
import { CREATIVE_DISCLOSURES } from "../creative/concept.ts";
import { MEASUREMENT_LOOKALIKE_SUBJECTS } from "../creative/visualHonesty.ts";
import type { ResearchCreativeContract } from "../research/creativeContract.ts";
import type { PlatformScriptStoryboard } from "../../types.ts";
import type { EditorialGraphic, ManifestMetadata, PresentedClaim } from "./inputs.ts";
import type { CheckId, ReviewFinding } from "./types.ts";
import { describePairing, digitsFor, figuresIn, normalizeText, numbersIn } from "./util.ts";

export interface BeatCapture {
  readonly assetId: string;
  readonly pairing: ComparePairing | null;
  readonly metadata: ManifestMetadata;
}

export interface PresentationContext {
  readonly storyboard: PlatformScriptStoryboard;
  readonly title: string;
  readonly description: string;
  /** Caption text per beat as the burned-in caption file holds it (null: no cue). */
  readonly captionsByBeat: readonly (string | null)[];
  /**
   * The fixed labels a beat's motion graphic draws, as its renderer recorded
   * them (never its figures). Read with the beat's text for its setting and
   * qualifiers; the graphic's figures are bound by the creative workflow.
   */
  readonly graphicTextByBeat?: readonly string[];
  readonly capturesByBeat: readonly (readonly BeatCapture[])[];
  readonly claims: readonly PresentedClaim[];
  readonly graphics: readonly EditorialGraphic[];
  readonly disclosureLines: readonly string[];
  /** True only when the frame check proved the disclosure panel on screen for the whole video. */
  readonly disclosureVerifiedOnScreen: boolean;
  readonly contract: ResearchCreativeContract;
}

const MEASURED_WORDING = /\b(measured|benchmark(?:ed|s)?|tested|lab[- ]tested|real[- ]world (?:fps|results?|performance)|actual fps|we ran)\b/gi;
const NEGATION = /\b(not|never|no|isn't|aren't|without)\b[\w\s,'-]{0,24}$/i;
const ESTIMATE_LABEL = /\b(estimat\w*|est\.|model(?:led|ed)?|predicted)(?=\W|$)/i;
const EXACT_WORDING = /\b(exactly|precisely|exact)\b/i;
const GENERALISING = /\b(every|all|each|always|across the board|in any game|whatever you play)\b/i;
const PHYSICAL_METAPHOR = /\b(thermometer|ruler|tape measure|speedometer|stopwatch|gauge|scale|dyno|meter)\b/i;

/** Unnegated "measured"/"benchmark" wording in text. */
function measuredWording(text: string): string | null {
  for (const match of text.matchAll(MEASURED_WORDING)) {
    if (!NEGATION.test(text.slice(0, match.index))) return match[0];
  }
  return null;
}

function finding(check: CheckId, code: string, severity: ReviewFinding["severity"], location: string, evidence: string,
  message: string, owner: ReviewFinding["owner"], recheck: ReviewFinding["recheck"] = [check]): ReviewFinding {
  return { code, severity, check, location, evidence, message, owner, recheck };
}

function factsFor(pairing: ComparePairing): LeadsVsAverageFacts | string {
  try {
    return leadsVsAverageFacts(pairing);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Exactly one game matches the name, or none. An ambiguous name is not guessed. */
function findGame(facts: LeadsVsAverageFacts, name: string) {
  const wanted = normalizeText(name);
  const matches = facts.games.filter((game) => normalizeText(game.game) === wanted || normalizeText(shortGameNameOf(game.game)) === wanted);
  return matches.length === 1 ? matches[0] : null;
}

function surfaceText(context: PresentationContext, claim: PresentedClaim): string {
  const beat = context.storyboard.beats[claim.beatIndex];
  switch (claim.where) {
    case "narration": return beat?.narration ?? "";
    case "caption": return context.captionsByBeat[claim.beatIndex] ?? "";
    case "title": return context.title;
    case "description": return context.description;
    case "graphic": return context.graphics.filter((graphic) => graphic.beatIndex === claim.beatIndex).map((graphic) => graphic.label).join(" \n ");
  }
}

/** Everything a viewer reads or hears during a beat. */
function beatText(context: PresentationContext, beatIndex: number): string {
  return [
    context.storyboard.beats[beatIndex]?.narration ?? "",
    context.captionsByBeat[beatIndex] ?? "",
    context.graphicTextByBeat?.[beatIndex] ?? "",
    ...context.graphics.filter((graphic) => graphic.beatIndex === beatIndex).map((graphic) => graphic.label),
  ].join(" \n ");
}

const location = (claim: PresentedClaim) =>
  claim.where === "title" || claim.where === "description" ? claim.where : `beat ${claim.beatIndex + 1} ${claim.where}`;

/** The numbers a statement asserts, which must all be in its text. */
function assertedNumbers(claim: PresentedClaim): number[] {
  const s = claim.statement;
  switch (s.kind) {
    case "tally": return [s.leadsA, s.leadsB, ...(s.ties === null ? [] : [s.ties])];
    case "averages": return [s.averageA, s.averageB];
    case "average-difference": return [s.difference];
    case "game-fps": return [s.fps];
    case "game-margin": return s.leader === "tie" ? [] : [s.margin];
    case "lead-range": return [s.low, s.high];
    case "research": return [];
  }
}

function checkAgainstModel(claim: PresentedClaim, facts: LeadsVsAverageFacts, text: string): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  const s = claim.statement;
  const at = location(claim);
  const contradicts = (detail: string) =>
    out.push(finding("claims.model", "figure-contradicts-model", "blocking", at, claim.text, `${detail} (${describePairing(facts.pairing)}).`, "script"));
  const swapped = (detail: string) =>
    out.push(finding("claims.model", "build-identity-swapped", "blocking", at, claim.text, `${detail}: Build A's figure is attributed to Build B, or the reverse.`, "script"));
  const { leadsA, leadsB, ties } = facts.tally;
  switch (s.kind) {
    case "tally": {
      if (s.leadsA === leadsA && s.leadsB === leadsB) {
        if (s.ties !== null && s.ties !== ties) contradicts(`Says ${s.ties} ties; the model gives ${ties}`);
        if (s.ties === null && ties > 0) {
          out.push(finding("claims.presentation", "ties-not-shown-with-tally", "advisory", at, claim.text,
            `A ${s.leadsA}-to-${s.leadsB} tally is presented without the ${ties} tied game(s) beside it; a viewer may read the tally as covering every game.`, "script"));
        }
      } else if (ties > 0 && (s.leadsA === leadsA + ties && s.leadsB === leadsB || s.leadsB === leadsB + ties && s.leadsA === leadsA)) {
        out.push(finding("claims.model", "tie-counted-as-lead", "blocking", at, claim.text,
          `Counts the ${ties} tied game(s) as ${s.leadsA === leadsA + ties ? "Build A" : "Build B"} leads: the model gives ${leadsA} A leads, ${ties} ties, ${leadsB} B leads. A tie is not a win.`, "script"));
      } else if (s.leadsA === leadsB && s.leadsB === leadsA && leadsA !== leadsB) {
        swapped(`The tally gives A ${s.leadsA} and B ${s.leadsB}; the model gives A ${leadsA} and B ${leadsB}`);
      } else {
        contradicts(`Says ${s.leadsA} to ${s.leadsB}; the model gives ${leadsA} to ${leadsB} with ${ties} ties`);
      }
      break;
    }
    case "averages":
      if (s.averageA === facts.averageA && s.averageB === facts.averageB) break;
      if (s.averageA === facts.averageB && s.averageB === facts.averageA) swapped(`Averages ${s.averageA}/${s.averageB}; the model gives A ${facts.averageA}, B ${facts.averageB}`);
      else contradicts(`Says averages ${s.averageA} and ${s.averageB}; the model gives ${facts.averageA} and ${facts.averageB}`);
      break;
    case "average-difference": {
      const gap = facts.averageB - facts.averageA;
      const leader = gap > 0 ? "B" : gap < 0 ? "A" : null;
      if (leader === null) contradicts("Names an average leader, but the model's averages are equal");
      else if (s.leader !== leader) swapped(`Says Build ${s.leader} has the higher average; the model gives Build ${leader}`);
      else if (s.difference !== Math.abs(gap)) contradicts(`Says a ${s.difference} FPS difference; the displayed averages differ by ${Math.abs(gap)}`);
      if (EXACT_WORDING.test(text) || /\d+\.\d+\s*fps/i.test(text)) {
        out.push(finding("claims.presentation", "rounded-average-as-exact", "blocking", at, claim.text,
          `The averages Compare shows are rounded means of ${facts.games.length} estimates; their difference is not an exact figure and may not be presented as one.`, "script"));
      }
      break;
    }
    case "game-fps": {
      const game = findGame(facts, s.game);
      if (!game) {
        out.push(finding("claims.model", "game-not-identified", "blocking", at, claim.text, `"${s.game}" does not name exactly one game in the catalog; no figure is matched to an ambiguous game.`, "script"));
        break;
      }
      const expected = s.build === "A" ? game.fpsA : game.fpsB;
      const other = s.build === "A" ? game.fpsB : game.fpsA;
      if (s.fps === expected) break;
      if (s.fps === other && other !== expected) swapped(`${shortGameNameOf(game.game)}: says Build ${s.build} ${s.fps} FPS; the model gives A ${game.fpsA}, B ${game.fpsB}`);
      else contradicts(`${shortGameNameOf(game.game)}: says Build ${s.build} ${s.fps} FPS; the model gives ${expected}`);
      break;
    }
    case "game-margin": {
      const game = findGame(facts, s.game);
      if (!game) {
        out.push(finding("claims.model", "game-not-identified", "blocking", at, claim.text, `"${s.game}" does not name exactly one game in the catalog; no figure is matched to an ambiguous game.`, "script"));
        break;
      }
      if (game.outcome === "tie" && s.leader !== "tie") {
        out.push(finding("claims.model", "tie-counted-as-lead", "blocking", at, claim.text,
          `${shortGameNameOf(game.game)} is a tie in the model (${game.fpsA} vs ${game.fpsB}); it is presented as a Build ${s.leader} lead.`, "script"));
      } else if (game.outcome !== s.leader) {
        swapped(`${shortGameNameOf(game.game)}: says ${s.leader === "tie" ? "a tie" : `Build ${s.leader} leads`}; the model gives ${game.outcome === "tie" ? "a tie" : `Build ${game.outcome}`}`);
      } else if (s.leader !== "tie" && s.margin !== Math.abs(game.margin)) {
        contradicts(`${shortGameNameOf(game.game)}: says a ${s.margin} FPS lead; the model gives ${Math.abs(game.margin)}`);
      }
      if (GENERALISING.test(text)) {
        out.push(finding("claims.presentation", "single-example-generalised", "blocking", at, claim.text,
          `One game's result (${shortGameNameOf(game.game)}) is worded as if it held across games; the model gives ${facts.tally.leadsA} A leads, ${facts.tally.ties} ties and ${facts.tally.leadsB} B leads.`, "script"));
      }
      break;
    }
    case "lead-range": {
      const range = s.build === "A" ? facts.leadRangeA : facts.leadRangeB;
      const otherRange = s.build === "A" ? facts.leadRangeB : facts.leadRangeA;
      if (s.low === range[0] && s.high === range[1]) break;
      if (s.low === otherRange[0] && s.high === otherRange[1]) swapped(`Build ${s.build}'s lead range is given as ${s.low}-${s.high}`);
      else contradicts(`Build ${s.build}'s leads are given as ${s.low}-${s.high} FPS; the model gives ${range[0]}-${range[1]}`);
      break;
    }
    case "research":
      break;
  }
  return out;
}

/** Checks of every declared claim, and of figures nobody declared. */
export function checkClaims(context: PresentationContext): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  const disclosureSaysEstimate = context.disclosureVerifiedOnScreen && context.disclosureLines.some((line) => ESTIMATE_LABEL.test(line));

  for (const claim of context.claims) {
    const at = location(claim);
    const surface = surfaceText(context, claim);
    // 1. The claim is in the presentation, and says what its declaration says.
    if (!normalizeText(surface).includes(normalizeText(claim.text))) {
      out.push(finding("claims.undeclared", "claim-not-in-presentation", "blocking", at, claim.text,
        `The declared claim text is not in the ${claim.where}${claim.where === "caption" ? " burned into the render" : ""}: ${JSON.stringify(surface)}.`, "script", ["claims.undeclared", "claims.model"]));
      continue;
    }
    const inText = new Set(numbersIn(claim.text));
    const missing = assertedNumbers(claim).filter((value) => !inText.has(value));
    if (missing.length) {
      out.push(finding("claims.undeclared", "declaration-differs-from-text", "blocking", at, claim.text,
        `The declaration asserts ${missing.join(", ")}, which the presented text does not say; the text, not the declaration, is what a viewer sees.`, "script", ["claims.undeclared", "claims.model"]));
    }

    // 2. Basis and wording.
    const s = claim.statement;
    const modelStatement = s.kind !== "research";
    if (claim.basis === "measured-benchmark" && modelStatement) {
      out.push(finding("claims.presentation", "estimate-labelled-measured", "blocking", at, claim.text,
        "This figure is computed by SpecSmith's estimate model, but it is declared as a measured benchmark. Estimates and measurements never share a label.", "script"));
    }
    if (claim.basis === "measured-benchmark" && !modelStatement) {
      const m = claim.measurement;
      const missingFields = m ? Object.entries(m).filter(([, value]) => !String(value ?? "").trim()).map(([key]) => key) : ["all provenance"];
      if (missingFields.length) {
        out.push(finding("claims.presentation", "measurement-without-provenance", "blocking", at, claim.text,
          `A measured result is presented without its provenance (${missingFields.join(", ")}).`, "research"));
      }
    }
    if (claim.basis === "synthetic-fixture") {
      out.push(finding("claims.presentation", "synthetic-figure", "blocks-final-approval", at, claim.text,
        "This figure comes from a synthetic engineering fixture. It may be reviewed but never published.", "research"));
    }
    if (modelStatement || claim.basis === "model-estimate") {
      const viewerText = claim.where === "title" || claim.where === "description" ? surface : beatText(context, claim.beatIndex);
      const measured = measuredWording(viewerText);
      if (measured) {
        out.push(finding("claims.presentation", "estimate-presented-as-measured", "blocking", at, viewerText,
          `"${measured}" presents a model estimate as a measurement.`, "script"));
      }
      const labelled = ESTIMATE_LABEL.test(viewerText) || (claim.where !== "title" && claim.where !== "description" && disclosureSaysEstimate);
      if (!labelled) {
        out.push(finding("claims.presentation", "estimate-unlabelled", "blocking", at, claim.text,
          claim.where === "title" || claim.where === "description"
            ? `The ${claim.where} states an estimated figure without saying it is an estimate; no on-screen disclosure travels with it.`
            : "An estimated figure is on screen without an estimate label in the beat and without a verified on-screen disclosure.", "script",
          ["claims.presentation", "disclosure.coverage"]));
      }
      const fpsDisclosure = CREATIVE_DISCLOSURES["disclosure.fps-estimate"];
      if (claim.where !== "title" && claim.where !== "description" && !context.disclosureLines.includes(fpsDisclosure)) {
        out.push(finding("disclosure.content", "required-disclosure-missing", "blocking", at, claim.text,
          `An estimated FPS figure is presented, but the plan's disclosures omit "${fpsDisclosure}".`, "disclosure", ["disclosure.content", "disclosure.coverage", "disclosures-in-context"]));
      }
    }

    // 3. Values against the model; conditions against the screen.
    if (modelStatement) {
      const facts = factsFor(s.pairing);
      if (typeof facts === "string") {
        out.push(finding("claims.model", "unknown-part", "blocking", at, claim.text, facts, "script"));
        continue;
      }
      out.push(...checkAgainstModel(claim, facts, surface));
      out.push(...checkScreen(context, claim, s.pairing));
      if ((s.kind === "game-fps" || s.kind === "game-margin") && !normalizeText(claim.where === "title" || claim.where === "description" ? surface : beatText(context, claim.beatIndex))
        .includes(normalizeText(shortGameNameOf(findGame(facts, s.game)?.game ?? s.game)))) {
        out.push(finding("claims.presentation", "game-not-named", "blocking", at, claim.text,
          `A per-game figure is presented without naming the game (${s.game}).`, "script"));
      }
    } else {
      out.push(...checkResearchClaim(context, claim));
    }
  }

  out.push(...undeclaredFigures(context));
  return out;
}

/** The screen under a figure must show the builds and settings the figure is about. */
function checkScreen(context: PresentationContext, claim: PresentedClaim, pairing: ComparePairing): ReviewFinding[] {
  const at = location(claim);
  const conditionsInText = (text: string) =>
    new RegExp(`\\b${pairing.resolution}\\b`, "i").test(text) && new RegExp(`\\b${pairing.preset}\\b`, "i").test(text);
  if (claim.where === "title" || claim.where === "description") {
    return conditionsInText(digitsFor(claim.text)) ? [] : [finding("claims.presentation", "conditions-omitted", "blocking", at, claim.text,
      `An FPS figure in the ${claim.where} does not state its resolution and preset (${pairing.resolution} ${pairing.preset}); no screen travels with it.`, "script")];
  }
  const captures = context.capturesByBeat[claim.beatIndex] ?? [];
  const shown = captures.map((capture) => capture.pairing).filter((value): value is ComparePairing => value !== null);
  if (shown.length === 0) {
    return conditionsInText(beatText(context, claim.beatIndex)) ? [] : [finding("claims.screen", "conditions-omitted", "blocking", at, claim.text,
      `No capture shows this beat's builds and settings, and the beat's text does not state ${pairing.resolution} ${pairing.preset}.`, "script")];
  }
  const out: ReviewFinding[] = [];
  for (const screen of shown) {
    const same = (keys: (keyof ComparePairing)[]) => keys.every((key) => screen[key] === pairing[key]);
    if (same(["gpuA", "cpuA", "gpuB", "cpuB", "resolution", "preset"])) continue;
    if (screen.gpuA === pairing.gpuB && screen.cpuA === pairing.cpuB && screen.gpuB === pairing.gpuA && screen.cpuB === pairing.cpuA) {
      out.push(finding("claims.screen", "build-identity-swapped", "blocking", at, claim.text,
        `The screen shows the builds the other way round (${describePairing(screen)}): Build A on screen is the claim's Build B.`, "capture", ["claims.screen", "factual-takeaway"]));
    } else if (!same(["gpuA", "cpuA", "gpuB", "cpuB"])) {
      out.push(finding("claims.screen", "figure-over-other-builds", "blocking", at, claim.text,
        `The figure is about ${describePairing(pairing)}, but the screen shows ${describePairing(screen)}.`, "capture", ["claims.screen", "factual-takeaway"]));
    } else {
      out.push(finding("claims.screen", "figure-over-wrong-settings", "blocking", at, claim.text,
        `The figure is the model's at ${pairing.resolution} ${pairing.preset}, but the screen under it shows ${screen.resolution} ${screen.preset}.`, "capture", ["claims.screen", "factual-takeaway"]));
    }
  }
  return out;
}

function checkResearchClaim(context: PresentationContext, claim: PresentedClaim): ReviewFinding[] {
  if (claim.statement.kind !== "research") return [];
  const { researchClaimId } = claim.statement;
  const at = location(claim);
  const safe = context.contract.safeClaims.find((entry) => entry.claimId === researchClaimId);
  if (!safe) {
    const unsafe = [...context.contract.unsafeClaims, ...context.contract.disputedClaims].find((entry) => entry.claimId === researchClaimId);
    return [finding("claims.research", "research-claim-not-safe", "blocking", at, claim.text,
      unsafe ? `Research holds this claim as ${unsafe.state}: ${unsafe.reason}` : `No claim "${researchClaimId}" is in the research contract.`, "research")];
  }
  // Every qualifier research requires must be in front of the viewer with it.
  const visible = `${beatText(context, claim.beatIndex)} \n ${context.disclosureVerifiedOnScreen ? context.disclosureLines.join(" ") : ""}`;
  return safe.requiredWording.filter((wording) => !normalizeText(visible).includes(normalizeText(wording))).map((wording) =>
    finding("claims.presentation", "qualifier-dropped", "blocking", at, claim.text,
      `Research allows this claim only with "${wording}", which is not in the beat or the on-screen disclosure.`, "script"));
}

function undeclaredFigures(context: PresentationContext): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  const places: { where: PresentedClaim["where"]; beatIndex: number; text: string }[] = [
    { where: "title", beatIndex: -1, text: context.title },
    { where: "description", beatIndex: -1, text: context.description },
  ];
  context.storyboard.beats.forEach((beat, index) => {
    places.push({ where: "narration", beatIndex: index, text: beat.narration });
    places.push({ where: "caption", beatIndex: index, text: context.captionsByBeat[index] ?? "" });
  });
  for (const graphic of context.graphics) places.push({ where: "graphic", beatIndex: graphic.beatIndex, text: graphic.label });

  for (const place of places) {
    const declared = context.claims.filter((claim) => claim.where === place.where && (place.beatIndex === -1 || claim.beatIndex === place.beatIndex));
    for (const figure of figuresIn(place.text)) {
      const covered = declared.some((claim) => digitsFor(normalizeText(claim.text)).includes(normalizeText(figure)));
      if (!covered) {
        out.push(finding("claims.undeclared", "undeclared-figure", "blocking",
          place.beatIndex === -1 ? place.where : `beat ${place.beatIndex + 1} ${place.where}`, place.text,
          `"${figure}" is presented as a fact, but no declared claim says what it is or where it comes from, so it cannot be checked.`, "script",
          ["claims.undeclared", "claims.model"]));
      }
    }
  }
  return out;
}

/** Captures must still show what the current model gives for their state. */
export function checkCapturesCurrent(capturesByBeat: readonly (readonly BeatCapture[])[]): { findings: ReviewFinding[]; checked: number } {
  const out: ReviewFinding[] = [];
  const current = modelSnapshotSha256();
  const seen = new Set<string>();
  let checked = 0;
  capturesByBeat.forEach((captures, beatIndex) => {
    for (const capture of captures) {
      if (seen.has(capture.assetId)) continue;
      seen.add(capture.assetId);
      const at = `asset ${capture.assetId} (beat ${beatIndex + 1})`;
      if (!capture.pairing) {
        if (capture.metadata.feature === "compare" || String(capture.metadata.route ?? "").startsWith("/compare")) {
          out.push(finding("captures.current", "capture-state-unknown", "blocking", at, String(capture.metadata.route ?? "(no route)"),
            "This Compare capture does not record the builds and settings it shows, so nothing on it can be checked.", "capture"));
        }
        continue;
      }
      checked += 1;
      const verified = String(capture.metadata.verifiedText ?? "");
      if (!verified) {
        out.push(finding("captures.current", "capture-unverified", "blocking", at, "(no verifiedText)",
          "The capture records no verified text, so it cannot be shown to display the current model's averages and tie count. Re-capture it.", "capture"));
        continue;
      }
      const expected = [...compareAverageFpsText(capture.pairing), compareTiesText(capture.pairing)];
      const missing = expected.filter((text) => !verified.split("\n").includes(text));
      if (missing.length) {
        out.push(finding("captures.current", "stale-capture", "blocking", at, verified.replace(/\n/g, " | "),
          `The capture was verified against ${verified.replace(/\n/g, ", ")}; the current model shows ${expected.join(", ")}. It predates the model (for example the tie fix) and must be re-captured.`,
          "capture", ["captures.current", "claims.screen", "frames.bands"]));
      } else if (capture.metadata.modelSnapshotSha256 !== current) {
        out.push(finding("captures.current", "model-files-changed-since-capture", "advisory", at, String(capture.metadata.modelSnapshotSha256 ?? "(none)"),
          "The model's source files changed after this capture, but the averages and tie count it was verified against are still what the model gives.", "capture"));
      }
    }
  });
  return { findings: out, checked };
}

/** The model's own ±8% band for one game and build, as fps.ts computes it. */
function varianceRange(pairing: ComparePairing, build: "A" | "B", gameName: string): [number, number] | null {
  const gpuId = build === "A" ? pairing.gpuA : pairing.gpuB;
  const cpuId = build === "A" ? pairing.cpuA : pairing.cpuB;
  const gpu = (gpus as (BuildFpsGpu & { id: string })[]).find((entry) => entry.id === gpuId);
  const cpu = (cpus as (BuildFpsCpu & { id: string })[]).find((entry) => entry.id === cpuId);
  const wanted = normalizeText(gameName);
  const matches = (games as BuildFpsGame[]).filter((game) => normalizeText(game.name) === wanted || normalizeText(shortGameNameOf(game.name)) === wanted);
  if (!gpu || !cpu || matches.length !== 1) return null;
  const result = estimateFpsForBuild(gpu, cpu, matches[0], pairing.resolution, pairing.preset);
  return [result.min, result.max];
}

export function checkGraphics(graphics: readonly EditorialGraphic[], capturesByBeat: readonly (readonly BeatCapture[])[]): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  for (const graphic of graphics) {
    const at = `graphic ${graphic.graphicId} (beat ${graphic.beatIndex + 1})`;
    const add = (code: string, message: string, severity: ReviewFinding["severity"] = "blocking") =>
      out.push(finding("graphics.integrity", code, severity, at, graphic.label, message, "graphics", ["graphics.integrity", "factual-takeaway"]));
    const shows = graphic.shows;

    if (graphic.attributedTo === "page") {
      const pageText = (capturesByBeat[graphic.beatIndex] ?? []).map((capture) => String(capture.metadata.pageText ?? "")).join("\n");
      if (!graphic.pageText) add("attributed-to-page-without-text", "The graphic says its numbers come from the page, but names no page text that shows them.");
      else if (!normalizeText(pageText).includes(normalizeText(graphic.pageText))) {
        add("attributed-to-page-not-shown", `The graphic attributes "${graphic.pageText}" to the page, but the page captured under this beat does not show it.`);
      }
    }

    if (shows.kind === "metaphor") {
      const lookalike = (MEASUREMENT_LOOKALIKE_SUBJECTS as readonly string[]).includes(shows.subject);
      if (lookalike && PHYSICAL_METAPHOR.test(shows.metaphor) && !/\b(illustrat\w*|not (?:a )?measure\w*|estimat\w*)\b/i.test(graphic.label)) {
        add("metaphor-implies-measurement", `A ${shows.metaphor} for ${shows.subject} reads as a physical measurement; label it as an illustration of an estimate, or drop it.`);
      }
      continue;
    }

    const facts = factsFor(shows.pairing);
    if (typeof facts === "string") { add("unknown-part", facts); continue; }

    if (shows.kind === "bars") {
      let expected: [number, number] | null;
      if (shows.of === "averages") expected = [facts.averageA, facts.averageB];
      else {
        const game = shows.game ? findGame(facts, shows.game) : null;
        expected = game ? [game.fpsA, game.fpsB] : null;
      }
      if (!expected) add("game-not-identified", `"${shows.game ?? "(none)"}" does not name exactly one game.`);
      else if (shows.values[0] !== expected[0] || shows.values[1] !== expected[1]) {
        add("graphic-contradicts-model", `Bars show ${shows.values.join(" vs ")}; the model gives ${expected.join(" vs ")}.`);
      }
      if (!shows.axisStartsAtZero) add("truncated-axis", "The bars do not start at zero, so the difference in length overstates the difference in FPS.");
      const [la, lb] = shows.barLengthsPx, [va, vb] = shows.values;
      if (la > 0 && lb > 0 && va > 0 && vb > 0) {
        const factor = (lb / la) / (vb / va);
        if (Math.abs(factor - 1) > 0.1) add("exaggerated-scale", `Bar lengths are in a ratio ${factor.toFixed(2)}x the data's; a ${Math.abs(vb - va)} FPS gap is drawn larger than it is.`);
      }
    } else if (shows.kind === "range") {
      const supported = shows.of === "lead-range"
        ? (shows.build === "A" ? facts.leadRangeA : facts.leadRangeB)
        : varianceRange(shows.pairing, shows.build, shows.game);
      if (!supported) add("graphic-range-unsupported", "The range's game or parts do not identify exactly one model estimate.");
      else if (shows.low !== supported[0] || shows.high !== supported[1]) {
        add("graphic-range-unsupported", `The graphic shows ${shows.low}-${shows.high}; the evidence gives ${supported[0]}-${supported[1]}. A range is drawn only from values the model supplies.`);
      }
    } else if (shows.kind === "outcomes") {
      for (const entry of shows.perGame) {
        const game = findGame(facts, entry.game);
        if (!game) { add("game-not-identified", `"${entry.game}" does not name exactly one game.`); continue; }
        if (game.outcome === "tie" && entry.outcome !== "tie") add("tie-counted-as-lead", `${shortGameNameOf(game.game)} is a tie in the model (${game.fpsA} vs ${game.fpsB}) but is shown as a Build ${entry.outcome} lead.`);
        else if (game.outcome !== entry.outcome) add("graphic-contradicts-model", `${shortGameNameOf(game.game)} is shown as ${entry.outcome}; the model gives ${game.outcome}.`);
      }
    }
  }
  return out;
}
