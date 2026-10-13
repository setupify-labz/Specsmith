#!/usr/bin/env tsx
// Marks one topic as taken for review, so the next daily run proposes the next eligible topic:
//
//   pnpm exec tsx scripts/content-automator/dailyShortProposal/markUsed.ts \
//     --topic <topic id> --by <your name> [--ledger <path>]
//
// --ledger defaults to the committed used-topics.json. It writes nothing else and
// calls nothing outside this repository.

import { TOPICS } from "./topics.ts";
import { DailyProposalError } from "./snapshot.ts";
import { DEFAULT_USED_LEDGER, markTopicUsed } from "./usedTopics.ts";

function arg(name: string, argv: readonly string[]): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function main(argv: readonly string[], now = new Date()): Promise<number> {
  const topicId = arg("--topic", argv), by = arg("--by", argv);
  if (argv.includes("--note")) { console.error("The ledger records only the topic, who took it and when; --note is not accepted."); return 1; }
  if (!topicId || !by) { console.error("Usage: markUsed.ts --topic <topic id> --by <name> [--ledger <path>]"); return 1; }
  try {
    const ledger = await markTopicUsed(arg("--ledger", argv) ?? DEFAULT_USED_LEDGER, { topicId, by }, TOPICS.map((t) => t.id), now);
    console.log(`Marked ${topicId} as taken for review by ${by}. ${ledger.entries.length} topic(s) marked.`);
    return 0;
  } catch (error) {
    if (error instanceof DailyProposalError) { console.error(error.message); return 1; }
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main(process.argv.slice(2));
