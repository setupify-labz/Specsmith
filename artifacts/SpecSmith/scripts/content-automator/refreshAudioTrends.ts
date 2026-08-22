import { resolve } from "node:path";
import { refreshAudioTrendCache } from "./trendSource.ts";

const cachePath = resolve(process.cwd(), "content-ideas/generated/audio-trends.json");
const result = await refreshAudioTrendCache({
  cachePath,
  force: true,
});

console.log(`[${result.source}] ${result.status}: ${result.message}`);
console.log(`Fetched candidates: ${result.fetchedCandidates}.`);
if (result.snapshot) {
  console.log(`Cache now contains ${result.snapshot.candidates.length} total audio candidates.`);
  console.log(`Saved: ${cachePath}`);
}

if (result.status === "not-configured") {
  throw new Error("Configure TIKTOK_BUSINESS_ACCESS_TOKEN and TIKTOK_BUSINESS_ID before running a live trend refresh.");
}
if (result.status === "failed-no-cache" || result.status === "failed-cache") {
  throw new Error(result.message);
}
