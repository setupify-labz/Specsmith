// Picks one beginner troubleshooting Short from the snapshot, and records every
// metric that influenced the pick, how it was used, and what was unknown.
//
// THE RULE (deterministic, so two runs on one snapshot agree)
// 1. Each YouTube Short is tagged troubleshooting or comparison from its title.
// 2. Per theme: median views per day since publishing (public counts), median
//    average-view-percentage and engaged-view share (YouTube Analytics, only
//    from videos with at least MIN_ANALYTICS_VIEWS analytics views: smaller
//    samples are recorded but excluded, as is any "unknown").
// 3. The fastest troubleshooting Short's symptom family sets the family; the
//    best-retained Short's length sets the target length (recorded; an animated
//    topic keeps its template's length, and the record says so).
// 4. Topics without a registered animation template are dropped ("no animation
//    template yet": the job only proposes what it can render), and so are
//    topics an existing title already covers. Among the rest, the
//    family match comes first, then the editorial prior (labelled as editorial
//    judgement, not data), then the topic list's order.
// TikTok and Instagram rows are recorded as channel context only: Metricool's
// rows are per publish day, not per video, so no Short can be credited with
// them and they do not move the pick. That is written into the record.

import type { ChannelSnapshot, Metric, YouTubeVideo } from "./snapshot.ts";
import { DailyProposalError } from "./snapshot.ts";
import { TEMPLATES } from "./animations.ts";
import { TOPICS, type Family, type Topic } from "./topics.ts";

export const MIN_ANALYTICS_VIEWS = 300;
const TROUBLESHOOTING = /\b(won'?t|won’t|fix|check|turn on|no display|no picture|doesn'?t)\b/i;
const FAMILY_OF: readonly [RegExp, Family][] = [
  [/\b(turn on|won'?t start|no power|power supply switch)\b/i, "wont-turn-on"],
  [/\b(no picture|no display|monitor|graphics card)\b/i, "on-no-picture"],
  [/\b(fit|compatib|ddr\d)\b/i, "compatibility"],
];

export interface InfluenceRecord {
  readonly metric: string;
  readonly source: string;
  readonly value: Metric | string;
  readonly usedFor: string;
}

export interface VideoSignal {
  readonly id: string;
  readonly title: string;
  readonly theme: "troubleshooting" | "comparison";
  readonly families: readonly Family[];
  readonly ageDays: number;
  readonly viewsPerDay: Metric;
  readonly averageViewPercentage: Metric;
  readonly engagedShare: Metric;
  readonly durationSeconds: Metric;
  readonly analyticsSampleOk: boolean;
}

export interface Selection {
  readonly topic: Topic;
  /** Whether the data picked the topic, or an operator chose it (--topic). */
  readonly chosenBy: "data" | "operator";
  /** The topic the data alone would have picked. */
  readonly dataPick: string;
  /** The Short's length: the template's. */
  readonly targetSeconds: number;
  /** The length the retention data pointed to (recorded, not imposed on the cut). */
  readonly dataTargetSeconds: number;
  readonly signals: readonly VideoSignal[];
  readonly themeSummary: Readonly<Record<"troubleshooting" | "comparison", { videos: number; medianViewsPerDay: Metric; medianAverageViewPercentage: Metric; medianEngagedShare: Metric }>>;
  readonly influences: readonly InfluenceRecord[];
  readonly unknowns: readonly string[];
  readonly excluded: readonly { readonly topicId: string; readonly why: string }[];
  readonly ranking: readonly { readonly topicId: string; readonly familyMatch: boolean; readonly editorialPrior: number }[];
}

const num = (m: Metric): m is number => typeof m === "number";
const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
function median(values: number[]): Metric {
  if (values.length === 0) return "unknown";
  const s = [...values].sort((a, b) => a - b), mid = s.length >> 1;
  return round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

function signalOf(video: YouTubeVideo, now: Date): VideoSignal {
  const ageDays = Math.max(1, (now.getTime() - Date.parse(video.publishedAt)) / 86_400_000);
  const a = video.analytics;
  const sampleOk = num(a.views) && a.views >= MIN_ANALYTICS_VIEWS;
  return {
    id: video.id, title: video.title,
    theme: TROUBLESHOOTING.test(video.title) ? "troubleshooting" : "comparison",
    families: FAMILY_OF.filter(([re]) => re.test(video.title)).map(([, family]) => family),
    ageDays: round(ageDays, 2),
    viewsPerDay: num(video.public.views) ? round(video.public.views / ageDays) : "unknown",
    averageViewPercentage: sampleOk && num(a.averageViewPercentage) ? a.averageViewPercentage : "unknown",
    engagedShare: sampleOk && num(a.engagedViews) && num(a.views) ? round(a.engagedViews / a.views, 3) : "unknown",
    durationSeconds: video.durationSeconds,
    analyticsSampleOk: sampleOk,
  };
}

export interface SelectOptions {
  readonly topics?: readonly Topic[];
  /**
   * An operator's choice of topic (run.ts --topic). It must still be producible
   * and uncovered; the record says the topic was chosen by a person, not by the
   * data, and the data's own pick is recorded next to it.
   */
  readonly topicId?: string;
}

export function selectTopic(snapshot: ChannelSnapshot, now: Date, options: SelectOptions = {}): Selection {
  const topics = options.topics ?? TOPICS;
  const yt = snapshot.sources.youtube;
  const signals = yt.videos.map((video) => signalOf(video, now));
  const influences: InfluenceRecord[] = [];
  const unknowns: string[] = [];
  const ytSource = `YouTube via ${yt.provider}`;

  for (const s of signals) {
    influences.push({ metric: "views per day (public views / days live)", source: ytSource, value: s.viewsPerDay, usedFor: `ranking "${s.title}" for the family choice` });
    if (!s.analyticsSampleOk) unknowns.push(`Retention for "${s.title}": analytics sample under ${MIN_ANALYTICS_VIEWS} views (or unknown), excluded rather than trusted.`);
    else influences.push({ metric: "average view percentage", source: `${ytSource} (YouTube Analytics)`, value: s.averageViewPercentage, usedFor: `ranking "${s.title}" for the target length` });
  }
  if (yt.subscribers === "unknown") unknowns.push("YouTube subscriber total: unknown (not collected; per-video subscribers gained is in the snapshot).");

  const theme = (name: "troubleshooting" | "comparison") => {
    const of = signals.filter((s) => s.theme === name);
    return {
      videos: of.length,
      medianViewsPerDay: median(of.map((s) => s.viewsPerDay).filter(num)),
      medianAverageViewPercentage: median(of.map((s) => s.averageViewPercentage).filter(num)),
      medianEngagedShare: median(of.map((s) => s.engagedShare).filter(num).map((x) => x * 100)),
    };
  };
  const themeSummary = { troubleshooting: theme("troubleshooting"), comparison: theme("comparison") };
  influences.push({ metric: "theme medians (views/day, avg view %, engaged %)", source: ytSource, value: JSON.stringify(themeSummary), usedFor: "recorded: whether the data favours troubleshooting Shorts at all (the job proposes troubleshooting either way, as asked)" });

  // The family: from the fastest troubleshooting Short.
  const troubleshooting = signals.filter((s) => s.theme === "troubleshooting" && num(s.viewsPerDay)).sort((a, b) => (b.viewsPerDay as number) - (a.viewsPerDay as number));
  const lead = troubleshooting[0];
  const families = new Set<Family>(lead?.families ?? []);
  if (lead) {
    influences.push({ metric: "fastest troubleshooting Short", source: ytSource, value: `${lead.title} (${lead.viewsPerDay} views/day)`, usedFor: `symptom family: ${[...families].join(", ") || "none detected"}` });
    if (lead.ageDays < 3) unknowns.push(`"${lead.title}" has been live ${lead.ageDays} days: its views per day are an early figure and may fall as it ages.`);
    unknowns.push("Symptom families are inferred from video titles only (tags and descriptions are not in the snapshot).");
  }
  else unknowns.push("No troubleshooting Short with a views figure: the family preference is unknown, so only the editorial prior ranks topics.");

  // The length: from the best-retained Short with a trustworthy sample.
  const retained = signals.filter((s) => num(s.averageViewPercentage) && num(s.durationSeconds)).sort((a, b) => (b.averageViewPercentage as number) - (a.averageViewPercentage as number))[0];
  const targetSeconds = retained ? Math.min(15, Math.max(10, retained.durationSeconds as number)) : 13;
  if (retained) influences.push({ metric: "best-retained Short's length", source: `${ytSource} (YouTube Analytics)`, value: `${retained.title}: ${retained.averageViewPercentage}% at ${retained.durationSeconds} s`, usedFor: `target length ${targetSeconds} s (clamped to 10-15 s)` });
  else unknowns.push("No retention figure with a trustworthy sample: target length defaults to 13 s.");

  // Cross-platform context: recorded, not used.
  for (const name of ["tiktok", "instagram"] as const) {
    const source = snapshot.sources[name];
    const views = source.byPublishDay.map((row) => row.views).filter((v): v is number => typeof v === "number");
    influences.push({ metric: `${name} views by publish day (sum)`, source: `${name} via ${source.provider}`, value: views.length ? views.reduce((a, b) => a + b, 0) : "unknown", usedFor: "context only: Metricool rows are per day, not per video, so no Short can be credited; not used in the pick" });
    if (source.followers === "unknown") unknowns.push(`${name} followers: unknown.`);
    for (const row of source.byPublishDay) for (const [key, value] of Object.entries(row)) if (value === "unknown") unknowns.push(`${name} ${row.date} ${key}: unknown (not returned by Metricool).`);
  }

  // Topics: drop the ones the job cannot render and the covered ones, then rank.
  const titles = yt.videos.map((v) => v.title).join("\n");
  const excluded: { topicId: string; why: string }[] = [];
  const open = topics.filter((topic) => {
    if (!topic.animation || !TEMPLATES[topic.animation]) { excluded.push({ topicId: topic.id, why: "no animation template yet (the job proposes only what it can render)" }); return false; }
    const hit = topic.coveredBy.find((re) => re.test(titles));
    if (hit) excluded.push({ topicId: topic.id, why: `an existing title matches ${hit}` });
    return !hit;
  });
  if (open.length === 0) throw new DailyProposalError("no-topic", `No producible topic is left: ${excluded.map((e) => `${e.topicId} (${e.why})`).join("; ")}. Build an animation template for an uncovered topic (animations.ts) before the next run.`);
  const ranking = open.map((topic, order) => ({ topic, order, familyMatch: families.has(topic.family) }))
    .sort((a, b) => Number(b.familyMatch) - Number(a.familyMatch) || b.topic.editorialPrior - a.topic.editorialPrior || a.order - b.order);
  influences.push({ metric: "editorial prior (NOT data)", source: "dailyShortProposal/topics.ts", value: ranking[0].topic.editorialPrior, usedFor: "tie-break among topics in the same family" });
  let chosen = ranking[0].topic;
  if (options.topicId !== undefined) {
    const forced = ranking.find((r) => r.topic.id === options.topicId)?.topic;
    if (!forced) {
      const why = excluded.find((e) => e.topicId === options.topicId)?.why ?? "not in the topic library";
      throw new DailyProposalError("no-topic", `The requested topic "${options.topicId}" cannot be proposed: ${why}.`);
    }
    influences.push({ metric: "operator's topic choice (NOT data)", source: "run.ts --topic", value: forced.id, usedFor: `the topic; the data's own pick on this snapshot was ${ranking[0].topic.id}` });
    chosen = forced;
  }
  const template = TEMPLATES[chosen.animation!];
  influences.push({ metric: "animation template length (not data)", source: `dailyShortProposal/animations.ts (${template.id})`, value: `${template.durationSeconds} s`, usedFor: `the Short's length; the data pointed to ${targetSeconds} s, recorded only, since the cut's timing is not stretched` });
  return {
    topic: chosen, chosenBy: options.topicId !== undefined ? "operator" : "data", dataPick: ranking[0].topic.id, targetSeconds: template.durationSeconds, dataTargetSeconds: targetSeconds, signals, themeSummary, influences, unknowns, excluded,
    ranking: ranking.map(({ topic, familyMatch }) => ({ topicId: topic.id, familyMatch, editorialPrior: topic.editorialPrior })),
  };
}
