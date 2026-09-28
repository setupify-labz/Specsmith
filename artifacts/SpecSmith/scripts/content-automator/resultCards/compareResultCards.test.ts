// The result-card format states only figures the Compare model computes,
// labels every frame as a model estimate, and draws no screenshot or caption
// over a chart.

import { describe, expect, it } from "vitest";

import { COMPARE_VIDEO_BEATS } from "../compareVideoScript.ts";
import { compareFiguresFor, loadCompareData } from "./compareFigures.ts";
import {
  assertResultCardCopy,
  buildCompareResultCards,
  MODEL_ESTIMATE_LABEL,
  RTX4080S_VS_RTX4080,
  ResultCardCopyError,
} from "./compareResultCards.ts";
import { checkResultCardLayout, sampleTimes } from "./render.ts";
import { durationSeconds, readingSeconds, sceneText, sceneWindows, type ResultCardVideo } from "./spec.ts";
import { resultCardHtml } from "./template.ts";

const cards = await buildCompareResultCards(RTX4080S_VS_RTX4080);
const { video } = cards;
const allText = video.scenes.flatMap(sceneText);

describe("the RTX 4080 Super vs RTX 4080 cards state the model's figures", () => {
  it("computes every figure with the Compare page's functions", async () => {
    const data = await loadCompareData();
    for (const figures of cards.figures) {
      expect(figures).toEqual(compareFiguresFor(data, RTX4080S_VS_RTX4080.builds, figures));
    }
  });

  it("matches the figures the rendered Compare page was checked against", () => {
    // storyboardCompareClaims.test.tsx renders Compare and checks these beat figures against the page.
    for (const beat of COMPARE_VIDEO_BEATS.filter((entry) => entry.figures)) {
      const figures = cards.figures.find((entry) =>
        entry.resolution === beat.figures!.resolution && entry.preset === beat.figures!.preset);
      if (!figures) continue;
      expect(figures).toMatchObject(beat.figures!);
    }
    expect(cards.figures.map(({ resolution, preset }) => `${resolution} ${preset}`))
      .toEqual(["1080p high", "1440p high", "4k ultra"]);
  });

  it("tells the insight: 20 of 20 modelled leads, but 4 FPS apart at 1440p and 2 at 4K Ultra", () => {
    const takeaway = video.scenes.at(-1)!;
    expect(sceneText(takeaway)).toEqual([
      "20 of 20 modelled leads",
      "but only 4 FPS apart at 1440p High",
      "and 2 FPS at 4K Ultra",
      "Check your games in SpecSmith Compare",
    ]);
    const gaps = video.scenes.filter((scene) => scene.kind === "gap");
    expect(gaps.map((gap) => [gap.eyebrow, gap.value, gap.bars.map((bar) => bar.value)])).toEqual([
      ["1440p High", "4", [164, 160]],
      ["4K Ultra", "2", [79, 77]],
    ]);
  });

  it("shows no number that is not a computed figure, a setting or a part name", () => {
    const figureNumbers = new Set(cards.figures.flatMap((figures) => [
      figures.avgA, figures.avgB, figures.leadsA - figures.ties, figures.leadsB, figures.ties, figures.games, figures.avgA - figures.avgB,
    ].map(String)));
    const names = Object.values(cards.names).join(" ");
    for (const text of allText) {
      const stripped = text.replace(/\b(1080p|1440p|4K)\b/g, "").replace(/\bRyzen 9 9950X3D\b|\bRTX 4080\b/g, "");
      for (const number of stripped.match(/\d+/g) ?? []) {
        expect(figureNumbers.has(number) || names.includes(number), `"${number}" in "${text}"`).toBe(true);
      }
    }
  });
});

describe("the format is readable on a phone and honest in every frame", () => {
  it("carries the model-estimate label as one persistent element outside every scene", () => {
    const html = resultCardHtml(video);
    expect(video.label).toBe(MODEL_ESTIMATE_LABEL);
    expect(html.match(/data-label/g)).toHaveLength(1);
    const labelAt = html.indexOf("data-label");
    expect(labelAt).toBeLessThan(html.indexOf("data-scene"));
    // The label never animates: __seek only touches scenes and [data-in] nodes inside them.
    expect(html.slice(labelAt, html.indexOf("</div>", labelAt))).not.toContain("data-in");
  });

  it("draws text and shapes only: no screenshot, image, video or external resource", () => {
    const html = resultCardHtml(video);
    expect(html).not.toMatch(/<img|<iframe|<video|<canvas|url\(|https?:/i);
  });

  it("is deterministic: no CSS animation or timer, the same page every time", () => {
    const html = resultCardHtml(video);
    expect(html).toBe(resultCardHtml(video));
    expect(html).not.toMatch(/@keyframes|animation:|transition:|setTimeout|setInterval|requestAnimationFrame|Date\.now|Math\.random/);
  });

  it("keeps every scene on screen long enough to read", () => {
    for (const scene of video.scenes) expect(scene.seconds).toBeGreaterThanOrEqual(readingSeconds(scene));
    expect(durationSeconds(video)).toBe(25);
    const windows = sceneWindows(video);
    windows.forEach((window, index) => {
      if (index > 0) expect(window.start).toBe(windows[index - 1].end);
    });
  });

  it("samples each scene once settled and once mid-fade", () => {
    const times = sampleTimes(video);
    const windows = sceneWindows(video);
    expect(times.filter((time) => time.moment === "settled").map((time) => time.scene)).toEqual(windows.map((window) => window.index));
    for (const time of times) {
      expect(time.second).toBeGreaterThanOrEqual(windows[time.scene].start);
      expect(time.second).toBeLessThan(windows[time.scene].end);
    }
  });
});

describe("a story the figures do not support is refused", () => {
  const request = RTX4080S_VS_RTX4080;

  it("refuses when Build A is not the leader", async () => {
    await expect(buildCompareResultCards({ ...request, builds: { a: request.builds.b, b: request.builds.a } }))
      .rejects.toThrow(ResultCardCopyError);
  });

  it("refuses builds on different CPUs, since every card credits the GPU", async () => {
    await expect(buildCompareResultCards({ ...request, builds: { ...request.builds, b: { gpu: "rtx4080", cpu: "r7-9800x3d" } } }))
      .rejects.toThrow(/different CPUs/);
  });

  it("refuses an unknown part rather than guessing", async () => {
    await expect(buildCompareResultCards({ ...request, builds: { ...request.builds, a: { gpu: "rtx4080-super", cpu: "r9-9950x3d" } } }))
      .rejects.toThrow(/Unknown GPU/);
  });

  it("refuses wording Compare does not support, and a missing label", () => {
    const edit = (change: (copy: ResultCardVideo) => void): ResultCardVideo => {
      const copy = structuredClone(video);
      change(copy);
      return copy;
    };
    expect(() => assertResultCardCopy(video)).not.toThrow();
    expect(() => assertResultCardCopy(edit((copy) => { copy.label = "Estimated"; }))).toThrow(/label/);
    for (const phrase of ["faster at 1440p", "better value", "worth the $437", "measured in our lab", "wins every game"]) {
      expect(() => assertResultCardCopy(edit((copy) => {
        const takeaway = copy.scenes.at(-1)!;
        if (takeaway.kind === "takeaway") takeaway.lines[1].text = phrase;
      })), phrase).toThrow(ResultCardCopyError);
    }
  });

  it("refuses a scene too short to read", () => {
    const rushed = structuredClone(video);
    rushed.scenes[1].seconds = 2;
    expect(() => assertResultCardCopy(rushed)).toThrow(/needs .* to read/);
  });
});

// The layout gate needs Chromium. Where it is configured, prove the real cards
// pass and that a label pushed onto a card, a stranded word and an off-screen
// CTA are each refused.
describe.skipIf(!process.env.SPECSMITH_RENDER_CHROMIUM)("the layout gate (Chromium)", () => {
  const withCss = (css: string) => resultCardHtml(video).replace("</style>", `${css}</style>`);

  it("passes the real cards at every sampled moment", async () => {
    expect(await checkResultCardLayout(video)).toEqual([]);
  }, 60_000);

  it("refuses the label over a card, a stranded last word and an off-screen CTA", async () => {
    const overCard = await checkResultCardLayout(video, withCss(".label { top: 700px !important; }"));
    expect(overCard.some((problem) => /label .* overlaps card/.test(problem))).toBe(true);
    const stranded = await checkResultCardLayout(video, resultCardHtml(video).replace("text-wrap: balance;", ""));
    expect(stranded.some((problem) => /one word alone/.test(problem))).toBe(true);
    const offScreen = await checkResultCardLayout(video, withCss(".cta { white-space: nowrap !important; font-size: 80px !important; }"));
    expect(offScreen.some((problem) => /cta .* outside the safe area/.test(problem))).toBe(true);
    // The first preview cross-faded, and two cards' text overlapped mid-fade.
    const crossfaded = await checkResultCardLayout(video, resultCardHtml(video)
      .replace("clamp((t - w.start - half) / half)", "clamp((t - w.start) / FADE)")
      .replace("t > w.start + half", "t >= w.start")
      .replace("(t - w.end) / half", "(t - w.end) / FADE")
      .replace("t < w.end + half", "t < w.end + FADE"));
    expect(crossfaded.some((problem) => /scenes share the frame/.test(problem))).toBe(true);
  }, 120_000);
});
