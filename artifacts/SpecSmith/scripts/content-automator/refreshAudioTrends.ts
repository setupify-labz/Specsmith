import { resolve } from "node:path";
import { refreshAllAudioTrendSources } from "./multiTrendSource.ts";

const cachePath = resolve(process.cwd(), "content-ideas/generated/audio-trends.json");
const result = await refreshAllAudioTrendSources({
  cachePath,
  force: true,
});

for (const source of result.sources) {
  console.log(`[${source.source}] ${source.status}: ${source.message}`);
  console.log(`Fetched candidates: ${source.fetchedCandidates}.`);
}

if (result.snapshot) {
  console.log(`Cache now contains ${result.snapshot.candidates.length} total audio candidates.`);
  console.log(`Saved: ${cachePath}`);
}

const configured = result.sources.filter((source) => source.status !== "not-configured");
if (configured.length === 0) {
  throw new Error(
    "No live audio trend source is configured. Configure TikTok credentials, YOUTUBE_DATA_API_KEY, and/or INSTAGRAM_AUDIO_TREND_FEED_URL.",
  );
}

const failures = configured.filter((source) => source.status === "failed-no-cache" || source.status === "failed-cache");
if (failures.length > 0) {
  throw new Error(`One or more trend sources failed: ${failures.map((source) => `${source.source}: ${source.message}`).join(" | ")}`);
}
