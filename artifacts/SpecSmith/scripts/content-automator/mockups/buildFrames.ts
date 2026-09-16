#!/usr/bin/env tsx
/**
 * Generate the storyboard's editorial frames from one shared layout.
 *
 * Every frame is emitted from this single template, so Build A and Build B keep
 * the same identity, the same position and the same colour on every frame.
 * Hand-copied HTML would have let them drift, and a build that swaps sides
 * between frames teaches a viewer that position means ranking.
 *
 * These are EDITORIAL GRAPHICS. They are not screenshots of any SpecSmith page
 * and each one says so on the frame. They use the product's colour tokens so
 * they read as SpecSmith's, while the layout matches no page in the app.
 *
 * No provider call, no text-to-speech, no video, no product change.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Verbatim from the product's own comparison page. */
export const ESTIMATE_DISCLOSURE =
  "FPS values are SpecSmith model estimates, not measured benchmarks of these exact systems.";

/**
 * Build A is always first, always purple. Build B is always second, always
 * cyan. Fixed here rather than per frame so no frame can reorder them.
 */
export const BUILD_A = { side: "Build A", parts: "RTX 5060 Ti<br />+ i3-13100F", colour: "#9B94FF" } as const;
export const BUILD_B = { side: "Build B", parts: "RTX 4060 Ti<br />+ Ryzen 5 9600X", colour: "#00D4FF" } as const;

export interface GameFrame {
  readonly slug: string;
  readonly game: string;
  readonly settings: string;
  /** Point estimate and the model's declared range, from src/lib/fps.ts. */
  readonly a: { readonly estimate: number; readonly min: number; readonly max: number };
  readonly b: { readonly estimate: number; readonly min: number; readonly max: number };
}

export const GAME_FRAMES: readonly GameFrame[] = [
  {
    slug: "cyberpunk",
    game: "Cyberpunk 2077",
    settings: "1440p · High",
    a: { estimate: 69, min: 63, max: 75 },
    b: { estimate: 66, min: 61, max: 71 },
  },
  {
    slug: "valorant",
    game: "Valorant",
    settings: "1440p · High",
    a: { estimate: 266, min: 245, max: 287 },
    b: { estimate: 282, min: 259, max: 305 },
  },
];

/**
 * Short-form platforms draw their own controls over the frame: captions and
 * account chrome across the top, caption/CTA furniture across the bottom, and
 * a column of action buttons down the right edge. Nothing that has to be read
 * — least of all a disclosure — may sit underneath them.
 *
 * These reserves are deliberately generous. Losing a little canvas costs
 * nothing; losing the disclosure behind a platform's caption bar would make
 * the frame dishonest on the one platform it was made for.
 */
const SAFE_TOP_PX = 240;
const SAFE_BOTTOM_PX = 390;
const SAFE_RIGHT_PX = 120;
const SAFE_LEFT_PX = 56;

const SHARED_CSS = `
  :root {
    --bg: #0A0A0F; --border: rgba(255,255,255,0.08);
    --text: #F0F0FF; --text-2: #8888AA;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1080px; height: 1920px; }
  body {
    background: var(--bg); color: var(--text);
    font-family: Arial, Helvetica, sans-serif;
    display: flex; flex-direction: column; justify-content: center;
    padding: ${SAFE_TOP_PX}px ${SAFE_RIGHT_PX}px ${SAFE_BOTTOM_PX}px ${SAFE_LEFT_PX}px;
  }
  .disclosure {
    font-size: 31px; line-height: 1.35; text-align: center;
    background: rgba(0,0,0,0.75); border: 1px solid var(--border);
    border-radius: 14px; padding: 20px 24px;
  }
  .footer { margin-top: 26px; text-align: center; }
  .badge {
    display: inline-block; font-size: 23px; font-weight: 700;
    letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-2);
    border: 1px solid var(--border); border-radius: 999px; padding: 12px 24px;
  }
`;

const FRAME_CSS = `
  .context { margin-top: 40px; text-align: center; }
  .eyebrow {
    font-size: 25px; letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--text-2); font-weight: 700;
  }
  .game { font-size: 76px; font-weight: 900; margin-top: 10px; line-height: 1.05; }
  .settings { font-size: 29px; color: var(--text-2); margin-top: 8px; }
  .cards { margin-top: 34px; display: flex; flex-direction: column; gap: 22px; }
  .card {
    border-radius: 22px; padding: 30px 34px;
    display: flex; align-items: center; justify-content: space-between; gap: 24px;
  }
  .who { min-width: 0; }
  .side { font-size: 24px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; }
  .parts { font-size: 35px; font-weight: 700; margin-top: 8px; line-height: 1.24; }
  .num { text-align: right; flex-shrink: 0; }
  .fps { font-size: 116px; font-weight: 900; line-height: 1; }
  .fpslabel {
    font-size: 22px; color: var(--text-2); margin-top: 6px;
    letter-spacing: 0.1em; text-transform: uppercase; font-weight: 700;
  }
  .range { font-size: 24px; color: var(--text-2); margin-top: 8px; }
  /* Directly beneath the cards, not pushed to the foot of the frame. */
  .verdict {
    margin-top: 26px; text-align: center;
    border-top: 1px solid var(--border); padding-top: 24px;
  }
  .verdict .line1 { font-size: 36px; color: var(--text-2); line-height: 1.3; }
  .verdict .line1 strong { color: var(--text); font-weight: 800; }
  .verdict .line2 { font-size: 28px; color: var(--text-2); margin-top: 14px; line-height: 1.38; }
`;

function page(title: string, css: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>${SHARED_CSS}${css}</style>
</head>
<body>
  <div class="disclosure">${ESTIMATE_DISCLOSURE}</div>
${body}
  <div class="footer">
    <span class="badge">SpecSmith editorial graphic &middot; not a product screen</span>
  </div>
</body>
</html>
`;
}

function card(
  build: typeof BUILD_A | typeof BUILD_B,
  value: { readonly estimate: number; readonly min: number; readonly max: number },
): string {
  const tint = build.colour === BUILD_A.colour ? "rgba(155,148,255,0.10)" : "rgba(0,212,255,0.09)";
  const edge = build.colour === BUILD_A.colour ? "rgba(155,148,255,0.35)" : "rgba(0,212,255,0.30)";
  return `    <div class="card" style="background:${tint};border:2px solid ${edge}">
      <div class="who">
        <div class="side" style="color:${build.colour}">${build.side}</div>
        <div class="parts">${build.parts}</div>
      </div>
      <div class="num">
        <div class="fps" style="color:${build.colour}">${value.estimate}</div>
        <div class="fpslabel">Estimated FPS</div>
        <div class="range">range ${value.min}–${value.max}</div>
      </div>
    </div>`;
}

export function gameFrameHtml(frame: GameFrame): string {
  const higher = frame.a.estimate >= frame.b.estimate ? BUILD_A.side : BUILD_B.side;
  const body = `  <div class="context">
    <div class="eyebrow">Selected example</div>
    <div class="game">${frame.game}</div>
    <div class="settings">${frame.settings}</div>
  </div>

  <div class="cards">
${card(BUILD_A, frame.a)}
${card(BUILD_B, frame.b)}
  </div>

  <div class="verdict">
    <div class="line1">In this one game, <strong>${higher}</strong> has the higher point estimate.</div>
    <div class="line2">Ranges are a model convention, not measured uncertainty. They overlap here, so this does not establish a real-world winner.</div>
  </div>`;
  return page(`${frame.game} — editorial frame`, FRAME_CSS, body);
}

const TITLE_CSS = `
  .middle { text-align: center; margin-top: 40px; }
  .kicker {
    font-size: 26px; letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--text-2); font-weight: 700;
  }
  .question { font-size: 72px; font-weight: 900; line-height: 1.16; margin-top: 20px; }
  .answer { font-size: 38px; color: var(--text-2); margin-top: 24px; line-height: 1.35; }
  .builds { margin-top: 48px; display: flex; flex-direction: column; gap: 20px; }
  .row {
    display: flex; align-items: center; gap: 20px; text-align: left;
    border-radius: 20px; padding: 24px 30px;
  }
  .swatch { width: 24px; height: 24px; border-radius: 7px; flex-shrink: 0; }
  .rowside { font-size: 24px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; }
  .rowparts { font-size: 32px; font-weight: 700; margin-top: 6px; line-height: 1.25; }
`;

/**
 * No price claim appears on any frame.
 *
 * The two builds do come to the same editorial CPU-and-GPU parts subtotal, but
 * that claim may only be stated with its qualifier — not a complete build and
 * not a live retail price — which does not fit a kicker. The thesis is about
 * which games suit which parts, so the price is simply left out.
 */
export function titleCardHtml(): string {
  const row = (build: typeof BUILD_A | typeof BUILD_B, tint: string, edge: string) =>
    `      <div class="row" style="background:${tint};border:2px solid ${edge}">
        <div class="swatch" style="background:${build.colour}"></div>
        <div>
          <div class="rowside" style="color:${build.colour}">${build.side}</div>
          <div class="rowparts">${build.parts.replace("<br />", " ")}</div>
        </div>
      </div>`;

  const body = `  <div class="middle">
    <div class="kicker">Two builds, compared</div>
    <div class="question">A higher FPS estimate<br />isn&rsquo;t a proven winner.</div>
    <div class="answer">It depends on which games you play.</div>

    <div class="builds">
${row(BUILD_A, "rgba(155,148,255,0.10)", "rgba(155,148,255,0.35)")}
${row(BUILD_B, "rgba(0,212,255,0.09)", "rgba(0,212,255,0.30)")}
    </div>
  </div>`;
  return page("Which parts suit your games — title card", TITLE_CSS, body);
}

async function main(): Promise<void> {
  const outDir = join(here, "generated");
  await mkdir(outDir, { recursive: true });

  const written: string[] = [];
  const titlePath = join(outDir, "00-title-card.html");
  await writeFile(titlePath, titleCardHtml(), "utf8");
  written.push(titlePath);

  for (const [index, frame] of GAME_FRAMES.entries()) {
    const path = join(outDir, `${String(index + 1).padStart(2, "0")}-${frame.slug}.html`);
    await writeFile(path, gameFrameHtml(frame), "utf8");
    written.push(path);
  }

  for (const path of written) console.log(`wrote ${path}`);
}

main().catch((error: unknown) => {
  console.error("FRAME GENERATION FAILED:");
  console.error(error);
  process.exitCode = 1;
});
