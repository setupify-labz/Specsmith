// Browser capture engine for deterministic SpecSmith UI renders.
//
// SETTLING IS A DOM CONDITION, NOT A SLEEP
// ----------------------------------------
// Waiting a fixed number of seconds and hoping is how flaky captures happen.
// Every wait here is a real condition: the network idles, the expected state
// text appears in the DOM, document.fonts.ready resolves, and two consecutive
// animation frames report no layout movement. The one exception is the tiny
// per-step settle in a sequence, where the whole point is to sample the UI at
// chosen moments during an animation.
//
// A hard-won detail from this codebase: SpecSmith fades several cards in via
// framer-motion entrance animations, and reading the page mid-fade gives
// genuinely wrong answers — an axe-core audit against this app once reported
// ~10 phantom contrast failures because it measured during the fade, blending
// text toward the background. src/index.css documents that at length. The same
// hazard applies to screenshots, so a static capture disables animations
// outright and waits for layout to stop moving.

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export class UiCaptureError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "UiCaptureError";
    this.code = code;
  }
}

export interface CaptureViewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  close(): Promise<void>;
}

/**
 * Chromium executable.
 *
 * Playwright normally resolves its own download. This environment ships a
 * pre-installed Chromium whose build number does not match the npm package's
 * expectation, so an explicit path is supported via env var. Unset means "let
 * Playwright decide", which is what CI with a normal `playwright install`
 * wants — so the same code works in both places.
 */
function chromiumExecutablePath(): string | undefined {
  return process.env.SPECSMITH_RENDER_CHROMIUM || undefined;
}

export async function launchBrowser(viewport: CaptureViewport): Promise<BrowserSession> {
  const browser = await chromium.launch({
    executablePath: chromiumExecutablePath(),
    args: ["--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text"],
  });
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    // Fixed so date/number formatting in the UI cannot vary by host locale.
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "dark",
    reducedMotion: "reduce",
    // No browser chrome in the image: Playwright screenshots are viewport-only
    // by construction, but this also keeps scrollbars out of the frame.
    hasTouch: false,
  });
  return {
    browser,
    context,
    async close() {
      // Close in order and never let a cleanup failure mask a render failure.
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
}

/** Suppresses entrance animations so a still frame is not caught mid-fade. */
const FREEZE_ANIMATIONS_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }
  html { scroll-behavior: auto !important; scrollbar-width: none !important; }
  ::-webkit-scrollbar { display: none !important; }
`;

export interface WaitOptions {
  /** Strings that must appear in the page before it counts as ready. */
  expectedText: string[];
  timeoutMs: number;
  freezeAnimations: boolean;
}

export async function openAndSettle(
  context: BrowserContext,
  url: string,
  options: WaitOptions,
): Promise<Page> {
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  const response = await page.goto(url, { waitUntil: "networkidle", timeout: options.timeoutMs });
  if (!response) throw new UiCaptureError("navigation-failed", `No response for ${url}`);
  if (response.status() !== 200) {
    throw new UiCaptureError("navigation-failed", `${url} returned HTTP ${response.status()}`);
  }

  if (options.freezeAnimations) await page.addStyleTag({ content: FREEZE_ANIMATIONS_CSS });

  // Real condition #1: the requested state is actually on screen. This is the
  // wait that matters — it is also the verification, so a state that never
  // arrives times out here instead of being screenshotted.
  //
  // Predicates are passed as STRINGS, not functions. tsx compiles this file
  // with esbuild's keepNames transform, which wraps function declarations in a
  // `__name()` helper; when Playwright serializes such a function into the page
  // the helper does not exist there and every wait dies with
  // "ReferenceError: __name is not defined". A string expression is never
  // transformed, so it crosses the boundary intact.
  for (const text of options.expectedText) {
    try {
      await page.waitForFunction(
        `document.body.innerText.includes(${JSON.stringify(text)})`,
        undefined,
        { timeout: options.timeoutMs },
      );
    } catch {
      const actual = await page.evaluate("document.body.innerText.slice(0, 400)");
      throw new UiCaptureError(
        "state-not-reached",
        `Expected "${text}" to appear at ${url} but it never did. The page rendered, so this is the dangerous case: a valid-looking screenshot of the wrong state. First 400 chars on screen: ${JSON.stringify(actual)}`,
      );
    }
  }

  // Real condition #2: fonts are loaded, so no reflow after capture.
  await page.evaluate("document.fonts.ready");

  // Real condition #3: layout has stopped moving. Two consecutive animation
  // frames reporting an identical body height beats any fixed delay.
  await page.waitForFunction(
    `new Promise(function (resolve) {
       var first = document.body.getBoundingClientRect().height;
       requestAnimationFrame(function () {
         requestAnimationFrame(function () {
           resolve(document.body.getBoundingClientRect().height === first);
         });
       });
     })`,
    undefined,
    { timeout: options.timeoutMs },
  );

  if (consoleErrors.length) {
    throw new UiCaptureError("page-error", `Page raised errors at ${url}: ${consoleErrors.slice(0, 3).join(" | ")}`);
  }
  return page;
}

/** Reads the visible text once, for post-capture verification. */
export async function pageText(page: Page): Promise<string> {
  return page.evaluate("document.body.innerText") as Promise<string>;
}

/**
 * Scrolls the deepest element containing `needle` to the centre of the frame.
 *
 * Vertical video is a 9:16 window onto a desktop-width layout, so the top of
 * the page is usually the wrong crop. Compare, for instance, renders its part
 * pickers expanded above the fold — a naive viewport screenshot captures a
 * search box and a scrolling catalog list instead of the comparison the
 * storyboard asked for. Framing on the result is the difference between a
 * usable asset and a screenshot of a form.
 *
 * Returns false when the anchor is not found, so the caller can decide; this
 * never silently captures the wrong region.
 */
export async function focusOn(page: Page, needle: string): Promise<boolean> {
  // Matches on textContent and picks the DEEPEST element whose text contains
  // the needle. Three things this has to get right:
  //
  //  - The target usually has NO element children. React renders
  //    `{gpu.name} + {cpu.name}` as three sibling TEXT nodes in one element, so
  //    requiring element children skips exactly the node we want, and a
  //    TreeWalker over text nodes never sees the whole string either.
  //
  //  - src/index.css sets `scroll-behavior: smooth`, so a scroll is ANIMATED.
  //    Reading scrollY straight after scrolling reports the old value and a
  //    screenshot catches the page mid-flight. Scrolling is forced to `auto`
  //    for the duration so the move is instantaneous and measurable.
  //
  //  - The element is placed about a third down the frame rather than centred,
  //    and the landing is CONFIRMED. Centring a tall ancestor can leave the
  //    interesting content off the top of a 9:16 crop — technically framed,
  //    useless as an asset — so a bad landing fails loudly.
  const result = await page.evaluate(`(function () {
    var needle = ${JSON.stringify(needle)};
    var matches = [];
    var all = document.body.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      if ((all[i].textContent || '').indexOf(needle) !== -1) matches.push(all[i]);
    }
    if (!matches.length) return { ok: false, reason: 'no-match' };

    var best = null;
    for (var j = matches.length - 1; j >= 0; j--) {
      var hasInnerMatch = false;
      for (var k = 0; k < matches.length; k++) {
        if (matches[k] !== matches[j] && matches[j].contains(matches[k])) { hasInnerMatch = true; break; }
      }
      if (!hasInnerMatch) { best = matches[j]; break; }
    }
    if (!best) best = matches[matches.length - 1];

    var root = document.documentElement;
    var previous = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';

    var rect = best.getBoundingClientRect();
    var scroller = document.scrollingElement || root;
    var target = window.innerHeight * 0.34;
    scroller.scrollTop = scroller.scrollTop + (rect.top - target);

    var after = best.getBoundingClientRect();
    root.style.scrollBehavior = previous;
    return {
      ok: after.top >= 0 && after.top < window.innerHeight,
      top: Math.round(after.top),
      height: Math.round(after.height),
      viewport: window.innerHeight
    };
  })()`);
  return (result as { ok?: boolean }).ok === true;
}

export async function screenshot(page: Page, outPath: string): Promise<void> {
  // Viewport-only (not fullPage): the frame must match the 9:16 video canvas.
  await page.screenshot({ path: outPath, type: "png", fullPage: false, animations: "disabled" });
}
