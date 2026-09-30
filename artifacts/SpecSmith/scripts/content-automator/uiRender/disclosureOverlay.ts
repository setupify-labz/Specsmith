// The persistent disclosure panel: required disclosures, verbatim, rendered
// as one image that stays on screen for the whole video.
//
// WHY A RENDERED PANEL AND NOT A CAPTION
// --------------------------------------
// Burned into a two-line caption, 167 characters of disclosure overflowed the
// line and were on screen for one beat at a time. A panel in its own band
// (bandedLayout.ts) is on screen throughout and covers nothing.
//
// WHAT "READABLE" MEANS HERE, AND HOW IT IS CHECKED
// --------------------------------------------------
// The panel is laid out by a real browser, then MEASURED before it is
// accepted (assessDisclosurePanel):
//   - the rendered text equals the required disclosures exactly;
//   - nothing overflows or is clipped: every line is inside the panel;
//   - type is at least MIN_DISCLOSURE_FONT_PX in the final 1080px frame;
//   - text contrast against the panel is at least MIN_DISCLOSURE_CONTRAST.
// A panel failing any of these is refused, never shrunk to fit. What this
// cannot establish is whether a viewer finds it comfortable to read: that
// stays with the human readability review.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { launchBrowser, UiCaptureError } from "./capture.ts";
import type { RenderAdapter, RenderArtifact, RenderTaskContext } from "../rendering.ts";

/** Final-frame pixels. The panel renders at 36px (18 CSS px at 2x); captions are 72px. */
export const MIN_DISCLOSURE_FONT_PX = 34;
/** WCAG AAA for normal text. */
export const MIN_DISCLOSURE_CONTRAST = 7;

const PANEL_BACKGROUND = "rgb(11, 12, 18)";
const PANEL_TEXT = "rgb(255, 255, 255)";
const CSS_FONT_PX = 18;

export interface DisclosureOverlayState {
  readonly lines: readonly string[];
  readonly width: number;
  readonly height: number;
}

export class DisclosureOverlayError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DisclosureOverlayError";
    this.code = code;
  }
}

export function parseDisclosureOverlayState(input: unknown): DisclosureOverlayState {
  const raw = input as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") throw new DisclosureOverlayError("malformed", "disclosureOverlayState must be an object.");
  const lines = raw.lines;
  if (!Array.isArray(lines) || lines.length === 0 || lines.some((line) => typeof line !== "string" || !line.trim())) {
    throw new DisclosureOverlayError("malformed", "disclosureOverlayState.lines must be non-empty disclosure strings.");
  }
  const { width, height } = raw;
  if (typeof width !== "number" || typeof height !== "number" || !Number.isInteger(width) || !Number.isInteger(height) ||
      width <= 0 || height <= 0 || width % 2 !== 0 || height % 2 !== 0) {
    throw new DisclosureOverlayError("malformed", "Panel width and height must be positive even pixel counts.");
  }
  return { lines: lines as string[], width, height };
}

/** What the browser measured about the laid-out panel, in final-frame pixels. */
export interface DisclosurePanelMeasurement {
  readonly renderedText: string;
  readonly fontPx: number;
  readonly textColor: string;
  readonly backgroundColor: string;
  readonly overflows: boolean;
  /** Bottom of the last line of text, and the panel's inner bottom edge. */
  readonly textBottom: number;
  readonly innerBottom: number;
  readonly renderedLineCount: number;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(rgb: string): number {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  if (!match) throw new DisclosureOverlayError("unmeasurable", `Cannot read colour ${rgb}.`);
  const [r, g, b] = match.slice(1, 4).map(Number);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** Every reason the panel may not be used. Empty means it passed. */
export function assessDisclosurePanel(lines: readonly string[], measured: DisclosurePanelMeasurement): string[] {
  const problems: string[] = [];
  if (normalize(measured.renderedText) !== normalize(lines.join(" "))) {
    problems.push(`Rendered text is not the required disclosure verbatim: ${JSON.stringify(measured.renderedText)}.`);
  }
  if (measured.overflows || measured.textBottom > measured.innerBottom + 0.5) {
    problems.push("Disclosure text overflows the panel; part of it would be clipped.");
  }
  if (measured.fontPx < MIN_DISCLOSURE_FONT_PX) {
    problems.push(`Disclosure type is ${measured.fontPx}px in the final frame, under the ${MIN_DISCLOSURE_FONT_PX}px minimum.`);
  }
  const contrast = contrastRatio(measured.textColor, measured.backgroundColor);
  if (contrast < MIN_DISCLOSURE_CONTRAST) {
    problems.push(`Disclosure contrast is ${contrast.toFixed(2)}:1, under ${MIN_DISCLOSURE_CONTRAST}:1.`);
  }
  return problems;
}

function panelHtml(state: DisclosureOverlayState): string {
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; background: ${PANEL_BACKGROUND}; }
    #panel { box-sizing: border-box; width: ${state.width / 2}px; height: ${state.height / 2}px; overflow: hidden;
      padding: 12px 18px; background: ${PANEL_BACKGROUND}; color: ${PANEL_TEXT};
      font-family: "DejaVu Sans", "Liberation Sans", Arial, sans-serif; font-size: ${CSS_FONT_PX}px; line-height: 1.28; font-weight: 600;
      display: flex; flex-direction: column; justify-content: center; gap: 6px; }
    #panel p { margin: 0; }
  </style></head><body><div id="panel">${state.lines.map((line) => `<p>${escape(line)}</p>`).join("")}</div></body></html>`;
}

export function createDisclosureOverlayAdapter(options: { outputDir: string }): RenderAdapter {
  return {
    name: "specsmith-disclosure-overlay",
    capability: "disclosure-overlay",
    async render(context: RenderTaskContext): Promise<RenderArtifact[]> {
      const rawState = (context.task as { disclosureOverlayState?: unknown }).disclosureOverlayState;
      if (rawState === undefined) {
        throw new DisclosureOverlayError("missing-state", `Task ${context.task.taskId} has no disclosureOverlayState; disclosure text will not be guessed.`);
      }
      const state = parseDisclosureOverlayState(rawState);
      await fs.mkdir(options.outputDir, { recursive: true });
      const session = await launchBrowser({ width: state.width / 2, height: state.height / 2, deviceScaleFactor: 2 });
      try {
        const page = await session.context.newPage();
        await page.setContent(panelHtml(state), { waitUntil: "load" });
        await page.evaluate("document.fonts.ready");
        const measured = await page.evaluate(`(function () {
          var panel = document.getElementById('panel');
          var style = getComputedStyle(panel);
          var paragraphs = panel.querySelectorAll('p');
          var last = paragraphs[paragraphs.length - 1].getBoundingClientRect();
          var rect = panel.getBoundingClientRect();
          var lines = 0;
          paragraphs.forEach(function (p) {
            var range = document.createRange(); range.selectNodeContents(p);
            var tops = {}; Array.prototype.forEach.call(range.getClientRects(), function (r) { tops[Math.round(r.top)] = true; });
            lines += Object.keys(tops).length;
          });
          return {
            renderedText: panel.innerText,
            fontPx: parseFloat(style.fontSize) * window.devicePixelRatio,
            textColor: style.color,
            backgroundColor: style.backgroundColor,
            overflows: panel.scrollHeight > panel.clientHeight + 0.5 || panel.scrollWidth > panel.clientWidth + 0.5,
            textBottom: last.bottom,
            innerBottom: rect.bottom - parseFloat(style.paddingBottom),
            renderedLineCount: lines
          };
        })()`) as DisclosurePanelMeasurement;
        const problems = assessDisclosurePanel(state.lines, measured);
        if (problems.length > 0) throw new DisclosureOverlayError("unreadable-panel", problems.join(" "));

        const textSha256 = createHash("sha256").update(state.lines.join("\n")).digest("hex");
        const finalPath = path.join(options.outputDir, `${context.task.taskId}__disclosure-${textSha256.slice(0, 12)}.png`);
        await page.locator("#panel").screenshot({ path: finalPath, type: "png", animations: "disabled" });
        const bytes = await fs.readFile(finalPath);
        return [{
          artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}-disclosure`,
          taskId: context.task.taskId,
          kind: "image",
          uri: `file://${finalPath}`,
          mimeType: "image/png",
          metadata: {
            renderer: "specsmith-disclosure-overlay",
            textSha256,
            lineCount: state.lines.length,
            renderedLineCount: measured.renderedLineCount,
            fontPx: measured.fontPx,
            contrastRatio: Number(contrastRatio(measured.textColor, measured.backgroundColor).toFixed(2)),
            width: state.width,
            height: state.height,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        }];
      } catch (error) {
        if (error instanceof DisclosureOverlayError) throw error;
        throw new UiCaptureError("disclosure-render-failed", error instanceof Error ? error.message : String(error));
      } finally {
        await session.close();
      }
    },
  };
}
