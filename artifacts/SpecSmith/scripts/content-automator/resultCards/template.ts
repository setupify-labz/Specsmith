// Draws a ResultCardVideo as one HTML page whose picture at any moment is set
// by `window.__seek(seconds)`.
//
// Deterministic by construction: there are no CSS animations or timers. Every
// moving property is computed from the time passed to __seek, so frame N is
// the same picture on every run and a sampled frame is exactly what the video
// shows at that time.
//
// What it draws: the persistent label and the SpecSmith mark, which never
// move, and one card per scene. There is no <img>, no iframe and no external
// resource: only text and boxes.

import {
  CROSSFADE_SECONDS,
  RESULT_CARD_FORMAT,
  SAFE_AREA,
  sceneWindows,
  type ResultCardScene,
  type ResultCardVideo,
} from "./spec.ts";

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** An element that enters `delay` seconds after its scene starts. */
const enter = (delay: number) => `data-in="${delay.toFixed(2)}"`;

function sceneBody(scene: ResultCardScene): string {
  switch (scene.kind) {
    case "matchup":
      return `
        <div class="card build lead" data-box ${enter(0)}><span class="build-name" data-text>${escapeHtml(scene.a)}</span></div>
        <div class="versus" data-box ${enter(0.25)}><span data-text>vs</span></div>
        <div class="card build" data-box ${enter(0.4)}><span class="build-name" data-text>${escapeHtml(scene.b)}</span></div>
        <p class="shared" data-box ${enter(0.7)}><span data-text>${escapeHtml(scene.shared)}</span></p>`;
    case "stat":
      return `
        <div class="card" data-box ${enter(0)}>
          <p class="eyebrow" data-text>${escapeHtml(scene.eyebrow)}</p>
          <p class="big" data-text ${enter(0.2)}><span class="big-value">${escapeHtml(scene.value)}</span><span class="big-suffix">${escapeHtml(scene.valueSuffix)}</span></p>
          <p class="body" data-text ${enter(0.4)}>${escapeHtml(scene.body)}</p>
          <p class="footnote" data-text ${enter(0.6)}>${escapeHtml(scene.footnote)}</p>
        </div>`;
    case "gap": {
      // Bars start at zero, so a 4 FPS gap on 164 looks like what it is.
      const max = Math.max(...scene.bars.map((bar) => bar.value));
      const bars = scene.bars.map((bar, index) => `
          <div class="bar-row" ${enter(0.45 + index * 0.15)}>
            <div class="bar-label"><span class="bar-name" data-text>${escapeHtml(bar.name)}</span><span class="bar-value" data-text>${bar.value}</span></div>
            <div class="bar-track"><div class="bar-fill${bar.leads ? " leads" : ""}" data-bar="${(bar.value / max).toFixed(4)}" ${enter(0.6 + index * 0.15)}></div></div>
          </div>`).join("");
      return `
        <div class="card" data-box ${enter(0)}>
          <p class="eyebrow" data-text>${escapeHtml(scene.eyebrow)}</p>
          <p class="big" data-text ${enter(0.2)}><span class="big-value">${escapeHtml(scene.value)}</span><span class="big-unit">${escapeHtml(scene.valueSuffix)}</span></p>
          ${bars}
          <p class="footnote" data-text ${enter(0.9)}>${escapeHtml(scene.footnote)}</p>
        </div>`;
    }
    case "takeaway":
      return `
        <div class="card takeaway" data-box ${enter(0)}>
          ${scene.lines.map((line, index) => `<p class="${line.emphasis ? "line emphasis" : "line"}" data-text ${enter(0.2 + index * 0.6)}>${escapeHtml(line.text)}</p>`).join("")}
        </div>
        <p class="cta" data-box ${enter(0.3 + scene.lines.length * 0.6)}><span data-text>${escapeHtml(scene.cta)}</span></p>`;
  }
}

export function resultCardHtml(video: ResultCardVideo): string {
  const { width, height } = RESULT_CARD_FORMAT;
  const windows = sceneWindows(video);
  const scenes = video.scenes
    .map((scene, index) => `<section class="scene scene-${scene.kind}" data-scene="${index}">${sceneBody(scene)}</section>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(video.id)}</title>
<style>
  :root {
    --bg: #0b0b10; --card: #1c1c26; --card-edge: #2b2b3a; --text: #eeeef8; --muted: #a3a3bd;
    --primary: #8b7cf6; --cyan: #00d4ff; --amber: #ffb300; --track: #2b2b3a;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: var(--bg); }
  body {
    position: relative; color: var(--text);
    font-family: "Liberation Sans", "DejaVu Sans", Arial, sans-serif;
    font-variant-numeric: tabular-nums;
    background: radial-gradient(1200px 900px at 50% 38%, #17162a 0%, var(--bg) 70%);
  }
  .label {
    position: absolute; left: ${SAFE_AREA.left}px; right: ${width - SAFE_AREA.right}px; top: ${SAFE_AREA.top}px;
    display: flex; align-items: center; justify-content: center; gap: 18px;
    padding: 22px 28px; border: 3px solid var(--amber); border-radius: 999px;
    background: rgba(255, 179, 0, 0.10); color: var(--amber);
    font-size: 38px; font-weight: 700; letter-spacing: 0.01em; white-space: nowrap;
  }
  .label::before { content: ""; width: 18px; height: 18px; border-radius: 50%; background: var(--amber); flex: none; }
  .brand {
    position: absolute; left: ${SAFE_AREA.left}px; right: ${width - SAFE_AREA.right}px; bottom: ${height - SAFE_AREA.bottom}px;
    text-align: center; color: var(--muted); font-size: 36px; font-weight: 700; letter-spacing: 0.14em;
  }
  .scene {
    position: absolute; left: ${SAFE_AREA.left}px; right: ${width - SAFE_AREA.right}px; top: 300px; bottom: ${height - SAFE_AREA.bottom + 90}px;
    display: flex; flex-direction: column; justify-content: center; gap: 36px; opacity: 0;
  }
  .card {
    background: var(--card); border: 3px solid var(--card-edge); border-radius: 44px; padding: 56px 60px;
    display: flex; flex-direction: column; gap: 28px;
  }
  .eyebrow { color: var(--cyan); font-size: 46px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
  .big { display: flex; align-items: baseline; gap: 20px; line-height: 1; }
  .big-value { font-size: 300px; font-weight: 800; letter-spacing: -0.03em; }
  .big-suffix { font-size: 150px; font-weight: 700; color: var(--muted); }
  .big-unit { font-size: 88px; font-weight: 700; }
  .scene-gap .big-value { color: var(--cyan); }
  p, .build-name, .cta { text-wrap: balance; }
  .body { font-size: 64px; font-weight: 700; line-height: 1.15; }
  .footnote { font-size: 42px; color: var(--muted); }
  .build { align-items: center; padding: 72px 48px; }
  .build.lead { border-color: var(--primary); }
  .build-name { font-size: 104px; font-weight: 800; text-align: center; line-height: 1.05; }
  .versus { align-self: center; width: 150px; height: 150px; border-radius: 50%; background: var(--primary);
    display: flex; align-items: center; justify-content: center; font-size: 60px; font-weight: 800; color: #0b0b10; }
  .shared { text-align: center; font-size: 56px; font-weight: 700; color: var(--muted); }
  .bar-row { display: flex; flex-direction: column; gap: 14px; }
  .bar-label { display: flex; justify-content: space-between; align-items: baseline; gap: 24px; }
  .bar-name { font-size: 50px; font-weight: 700; }
  .bar-value { font-size: 72px; font-weight: 800; }
  .bar-track { height: 44px; border-radius: 22px; background: var(--track); overflow: hidden; }
  .bar-fill { height: 100%; width: 0; border-radius: 22px; background: var(--muted); }
  .bar-fill.leads { background: var(--primary); }
  .takeaway { gap: 34px; padding: 64px 60px; }
  .line { font-size: 70px; font-weight: 700; line-height: 1.12; }
  .line.emphasis { font-size: 92px; font-weight: 800; color: var(--cyan); }
  .cta { align-self: center; padding: 30px 48px; border-radius: 999px; background: var(--primary); color: #0b0b10;
    font-size: 48px; font-weight: 800; text-align: center; }
</style>
</head>
<body>
<div class="label" data-label data-box><span data-text>${escapeHtml(video.label)}</span></div>
${scenes}
<div class="brand" data-box><span data-text>SPECSMITH</span></div>
<script>
  const WINDOWS = ${JSON.stringify(windows)};
  const FADE = ${CROSSFADE_SECONDS};
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const easeOut = (value) => 1 - Math.pow(1 - clamp(value), 3);
  const sceneEls = [...document.querySelectorAll("[data-scene]")];
  window.__seek = (t) => {
    WINDOWS.forEach((w, index) => {
      const el = sceneEls[index];
      const first = index === 0;
      const last = index === WINDOWS.length - 1;
      // Out, then in: the scene before fades out over the first half of FADE
      // and this one fades in over the second half, so two cards' text never
      // shares a frame. The first scene is up at t=0.
      const half = FADE / 2;
      const fadeIn = first ? 1 : clamp((t - w.start - half) / half);
      const fadeOut = last ? 1 : 1 - clamp((t - w.end) / half);
      const visible = (first ? t >= 0 : t > w.start + half) && (last || t < w.end + half);
      el.style.opacity = visible ? String(Math.min(fadeIn, fadeOut)) : "0";
      el.style.visibility = visible ? "visible" : "hidden";
      // The first scene is already in place at t=0, so the opening frame is readable.
      const u = first ? Math.max(t - w.start, 5) : t - w.start;
      el.querySelectorAll("[data-in]").forEach((node) => {
        const k = easeOut((u - Number(node.dataset.in)) / 0.45);
        if (node.dataset.bar) {
          node.style.width = (Number(node.dataset.bar) * easeOut((u - Number(node.dataset.in)) / 0.8) * 100).toFixed(3) + "%";
        } else {
          node.style.opacity = String(k);
          node.style.transform = "translateY(" + ((1 - k) * 40).toFixed(2) + "px)";
        }
      });
    });
  };
  window.__seek(0);
</script>
</body>
</html>
`;
}
