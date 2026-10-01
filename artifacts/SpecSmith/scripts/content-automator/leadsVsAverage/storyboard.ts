// The "leads vs average" proof of concept: one surprising result, explained
// with motion. Every number in a caption or a line of narration is read from
// leadsVsAverageFacts, never typed in.
//
// Language rules, enforced by the tests:
// - a tie is a tie: "ahead in N games" counts strict leads only, and the tie
//   count is always shown beside it;
// - every figure is a SpecSmith model estimate, and the label saying so is on
//   screen for the whole video;
// - a game is named only when it carries the point: here, Build B's wins that
//   are far larger than any of Build A's.

import type { PlatformScriptStoryboard, StoryboardBeat } from "../types.ts";
import type { GameEstimate, LeadsVsAverageFacts } from "./facts.ts";

export type SceneId = "hook" | "tally" | "margins" | "average" | "cta";

export interface PocScene {
  readonly id: SceneId;
  readonly purpose: StoryboardBeat["purpose"];
  readonly startSecond: number;
  readonly endSecond: number;
  readonly caption: string;
  readonly narration: string;
  /** What moves on screen, for the review and for a person reading the plan. */
  readonly motion: string;
}

/** Strip platform qualifiers: "CS2 (Counter-Strike 2)" reads as "CS2". */
export const shortGameName = (name: string) => name.replace(/\s*\(.*\)\s*$/, "");

/** Build B's wins more than twice Build A's largest lead: the ones that move the average. */
export function decisiveLeadsB(facts: LeadsVsAverageFacts): GameEstimate[] {
  return facts.games
    .filter((game) => game.outcome === "B" && -game.margin > 2 * facts.leadRangeA[1])
    .sort((a, b) => a.margin - b.margin);
}

const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const spoken = (value: number) => words[value] ?? String(value);
const capitalize = (text: string) => `${text[0].toUpperCase()}${text.slice(1)}`;
const teens = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const spokenNumber = (value: number) => value < 10 ? spoken(value) : value < 20 ? teens[value - 10] : String(value);

export function leadsVsAverageScenes(facts: LeadsVsAverageFacts): PocScene[] {
  const { leadsA, leadsB, ties } = facts.tally;
  const decisive = decisiveLeadsB(facts);
  const gap = facts.averageB - facts.averageA;
  if (gap <= 0 || leadsA <= leadsB) {
    throw new Error("These facts do not show the leads-versus-average split this video explains; refusing to narrate a result the model does not give.");
  }
  return [
    {
      id: "hook", purpose: "hook", startSecond: 0, endSecond: 3,
      caption: `${leadsA} games to ${leadsB}`,
      narration: `${capitalize(spoken(leadsA))} games to ${spoken(leadsB)}. Is A faster?`,
      motion: "Two scoreboard counters race up to the strict lead counts; a question mark drops in.",
    },
    {
      id: "tally", purpose: "evidence", startSecond: 3, endSecond: 9,
      caption: `${leadsA} ahead · ${ties} ${ties === 1 ? "tie" : "ties"} · ${leadsB} ahead`,
      narration: `In SpecSmith's model, A is higher in ${spoken(leadsA)} games, B in ${spoken(leadsB)}. ${capitalize(spoken(ties))} ${ties === 1 ? "is a tie" : "are ties"}.`,
      motion: `${facts.games.length} game tiles sort into three columns: A higher, tie, B higher.`,
    },
    {
      id: "margins", purpose: "reversal", startSecond: 9, endSecond: 15,
      caption: "B's wins are bigger",
      narration: `But A wins by ${spoken(facts.leadRangeA[0])} to ${spoken(facts.leadRangeA[1])} FPS. B wins ${spoken(decisive.length)} games by ${spokenNumber(Math.min(...decisive.map((game) => -game.margin)))} or more.`,
      motion: `The tiles stretch into bars sized by margin; B's ${decisive.length} longest bars are labelled with their games (${decisive.map((game) => shortGameName(game.game)).join(", ")}).`,
    },
    {
      id: "average", purpose: "payoff", startSecond: 15, endSecond: 19,
      caption: `Average: ${facts.averageA} vs ${facts.averageB}`,
      narration: `So B's average is ${spoken(gap)} FPS higher.`,
      motion: "Two average bars grow to near-equal lengths; B edges past A.",
    },
    {
      id: "cta", purpose: "cta", startSecond: 19, endSecond: 23,
      caption: "Your games: /compare",
      narration: "Check your own games at SpecSmith slash compare.",
      motion: "A real SpecSmith Compare capture of this pairing slides up beside the route.",
    },
  ];
}

/** The scenes in #1's storyboard shape, so MASTER #1's review can measure them. */
export function leadsVsAverageStoryboard(facts: LeadsVsAverageFacts): PlatformScriptStoryboard {
  const scenes = leadsVsAverageScenes(facts);
  return {
    platform: "youtube-shorts",
    targetDurationSeconds: scenes.at(-1)!.endSecond,
    title: "Ahead in more games, behind on average",
    narrationStyle: "Plain, curious, unhurried.",
    beats: scenes.map((scene) => ({
      startSecond: scene.startSecond,
      endSecond: scene.endSecond,
      purpose: scene.purpose,
      narration: scene.narration,
      visualDirection: `[animated:${scene.id}] ${scene.motion}`,
      onScreenText: scene.caption,
      factDependencies: [],
    })),
    finalCta: scenes.at(-1)!.narration,
    factualGuardrails: ["Every figure is a SpecSmith model estimate, not a measured benchmark."],
  };
}
