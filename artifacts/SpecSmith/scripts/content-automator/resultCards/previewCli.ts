// Renders the RTX 4080 Super vs RTX 4080 result-card video as an offline
// preview. Silent, local, and not publishable: no provider is called, nothing
// is uploaded, and no ledger is touched.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCompareResultCards, RTX4080S_VS_RTX4080 } from "./compareResultCards.ts";
import { renderResultCardPreview } from "./render.ts";
import { sceneText, sceneWindows } from "./spec.ts";

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const cards = await buildCompareResultCards(RTX4080S_VS_RTX4080);
  const outDir = join(here, "..", "..", "..", "render-output", "result-cards", cards.video.id);
  const preview = await renderResultCardPreview(cards.video, outDir, {
    figures: cards.figures,
    figureSource: "estimateFpsForBuild + getAverageFps (the Compare page's own functions)",
    dataSources: cards.sources,
    builds: RTX4080S_VS_RTX4080.builds,
    names: cards.names,
  });

  console.log(`Label (every frame): ${cards.video.label}`);
  for (const window of sceneWindows(cards.video)) {
    const scene = cards.video.scenes[window.index];
    console.log(`  ${window.start.toFixed(1).padStart(4)}-${window.end.toFixed(1).padEnd(4)}s ${scene.kind.padEnd(8)} ${sceneText(scene).join(" | ")}`);
  }
  console.log(`\nPreview:  ${preview.mp4} (${preview.durationSeconds.toFixed(2)}s, silent)`);
  console.log(`sha256:   ${preview.mp4Sha256}`);
  console.log(`Contact:  ${preview.contactSheet}`);
  console.log(`Manifest: ${preview.manifestPath}`);
  for (const frame of preview.frames) console.log(`  frame ${frame.second.toFixed(2)}s scene ${frame.scene} ${frame.moment.padEnd(9)} ${frame.file}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
