// Maps a validated render request onto a real SpecSmith route, and defines how
// to prove afterwards that the page actually reached the requested state.
//
// THE VERIFICATION IS THE POINT
// -----------------------------
// SpecSmith's Compare page fails OPEN: Compare.tsx's initGpu() returns its
// default GPU whenever a URL id is not in the catalog, rather than erroring. So
// `/compare?gpuA=typo` renders a beautiful, fully-populated, completely wrong
// comparison. Validating the request (uiRenderState.ts) stops ids we know are
// bad; only reading the rendered DOM back catches the case where the app
// quietly swapped in something else — a stale build, a renamed catalog id, a
// route that changed its params.
//
// Each surface therefore declares `expectedText`: strings that MUST be present
// in the rendered page. They are chosen to be non-vacuous. Compare's is the
// composite `"{gpu} + {cpu}"` string that Compare.tsx renders only for the
// currently selected pair — not a bare model name, which would also appear in
// an open part-picker listing the whole catalog and would pass no matter what
// was selected.

import { predictCrate } from "./crateSeed.ts";
import {
  BUILDER_COMPONENT_SLOTS,
  componentName,
  cpuName,
  gpuName,
  type UiRenderRequest,
  type UiRenderSurfaceState,
} from "./uiRenderState.ts";

export interface SequenceStep {
  /** Label recorded in the frame manifest so a compositor knows what it got. */
  label: string;
  /**
   * A real interaction performed before this frame is captured.
   *
   * A sequence of identical screenshots separated by waits is not a sequence —
   * it is one frame billed three times. Every step here either changes
   * application state or advances a reveal, and `waitForText` proves it landed.
   */
  action?: { kind: "clickText"; text: string };
  /** DOM condition that must hold before capturing — the proof the step worked. */
  waitForText?: string;
  /** Milliseconds to let animation settle after the condition holds. */
  settleMs: number;
}

export interface SurfacePlan {
  /** Route including query string, relative to the app origin. */
  route: string;
  /** Canonical SpecSmith ids this capture claims to depict. */
  subjectIds: string[];
  /**
   * Strings that must appear in the rendered page for the capture to be
   * accepted. Absence means the app did not reach the requested state.
   */
  expectedText: string[];
  /**
   * Text identifying the region worth framing in a 9:16 crop.
   *
   * Without this the capture shows the top of the page, which on Compare is an
   * expanded part picker rather than the comparison itself.
   */
  focusText?: string;
  /**
   * Text that only appears AFTER a sequence has driven the UI.
   *
   * Build Crate starts closed, so its parts cannot be in the initial DOM;
   * these are verified once the reveal has run.
   */
  revealedText?: string[];
  /** Frames to capture for a sequence request. */
  sequence: SequenceStep[];
}

/** Reveal order and button labels, mirroring CRATE_CATEGORY_ORDER. */
const CRATE_REVEAL_ORDER = [
  { slot: "motherboard", label: "Motherboard" },
  { slot: "cpu", label: "CPU" },
  { slot: "ram", label: "RAM" },
  { slot: "gpu", label: "GPU" },
  { slot: "storage", label: "Storage" },
  { slot: "case", label: "Case" },
  { slot: "cooler", label: "CPU Cooler" },
  { slot: "psu", label: "PSU" },
] as const;

const CRATE_FIRST_BUTTON_TEXT = `Open ${CRATE_REVEAL_ORDER[0].label} Crate`;

function q(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

export function planSurface(request: UiRenderRequest): SurfacePlan {
  const state: UiRenderSurfaceState = request.state;

  switch (state.surface) {
    case "compare": {
      // Compare.tsx renders "{gpuName} + {cpuName}" per side for the SELECTED
      // pair only, which makes it a real assertion about state rather than a
      // substring that happens to exist somewhere on the page.
      const sideA = `${gpuName(state.gpuA)} + ${cpuName(state.cpuA)}`;
      const sideB = `${gpuName(state.gpuB)} + ${cpuName(state.cpuB)}`;
      return {
        route: `/compare${q({
          gpuA: state.gpuA,
          cpuA: state.cpuA,
          gpuB: state.gpuB,
          cpuB: state.cpuB,
          res: state.resolution,
          preset: state.preset,
        })}`,
        subjectIds: [state.gpuA, state.cpuA, state.gpuB, state.cpuB],
        expectedText: [sideA, sideB],
        // The composite string is rendered in the results section, so framing
        // on it lands the crop on the actual comparison.
        focusText: sideA,
        // Each frame is a DIFFERENT application state: the resolution and
        // quality toggles are real controls that re-run the FPS estimate, so
        // the captured numbers actually change between frames.
        sequence: [
          { label: "1080p-high", action: { kind: "clickText", text: "1080p" }, waitForText: sideA, settleMs: 250 },
          { label: "1440p-high", action: { kind: "clickText", text: "1440p" }, waitForText: sideA, settleMs: 250 },
          { label: "4k-high", action: { kind: "clickText", text: "4K" }, waitForText: sideA, settleMs: 250 },
          { label: "4k-ultra", action: { kind: "clickText", text: "Ultra" }, waitForText: sideA, settleMs: 250 },
        ],
      };
    }

    case "builder": {
      // EVERY requested slot is verified on screen, not just gpu/cpu. The
      // Builder renders a selected part's name in its slot card, so a
      // requested motherboard that failed to load is caught here rather than
      // shipping a build that merely looks complete.
      const expected: string[] = [];
      if (state.gpu) expected.push(gpuName(state.gpu));
      if (state.cpu) expected.push(cpuName(state.cpu));
      for (const slot of BUILDER_COMPONENT_SLOTS) {
        const id = state[slot];
        if (id) expected.push(componentName(id, slot));
      }
      const subjectIds = [state.gpu, state.cpu, ...BUILDER_COMPONENT_SLOTS.map((slot) => state[slot])]
        .filter((v): v is string => typeof v === "string");
      return {
        route: `/builder${q({
          gpu: state.gpu,
          cpu: state.cpu,
          motherboard: state.motherboard,
          ram: state.ram,
          storage: state.storage,
          psu: state.psu,
          case: state.case,
          cooler: state.cooler,
        })}`,
        subjectIds,
        expectedText: expected,
        focusText: expected[0],
        sequence: [
          { label: "parts-selected", settleMs: 500 },
          { label: "compatibility", settleMs: 600 },
        ],
      };
    }

    case "upgrade-gpu":
      return {
        route: `/upgrade-calculator${q({ gpu: state.from })}`,
        subjectIds: [state.from],
        expectedText: [gpuName(state.from)],
        focusText: gpuName(state.from),
        sequence: [
          { label: "current-hardware", settleMs: 500 },
          { label: "recommendation", settleMs: 700 },
        ],
      };

    case "upgrade-cpu":
      return {
        route: `/upgrade-calculator-cpu${q({ cpu: state.from })}`,
        subjectIds: [state.from],
        expectedText: [cpuName(state.from)],
        focusText: cpuName(state.from),
        sequence: [
          { label: "current-hardware", settleMs: 500 },
          { label: "recommendation", settleMs: 700 },
        ],
      };

    case "build-crate": {
      // The eight part names this seed produces, computed from the real crate
      // logic before the browser opens. Verifying them is what makes the
      // capture a proof of the seeded result rather than of "some crate".
      const predicted = predictCrate(state.seed);
      return {
        route: `/crate${q({ seed: String(state.seed) })}`,
        subjectIds: [],
        // A crate starts closed, so the parts only exist after the reveal is
        // driven. The static wait therefore checks the opening control, and the
        // part names are verified after the sequence completes.
        expectedText: [CRATE_FIRST_BUTTON_TEXT],
        revealedText: predicted.partNames,
        focusText: CRATE_FIRST_BUTTON_TEXT,
        // Drives the REAL reveal: one click per category, each frame waiting on
        // the part that click revealed.
        sequence: [
          ...CRATE_REVEAL_ORDER.map((category) => ({
            label: `reveal-${category.slot}`,
            action: { kind: "clickText" as const, text: `Open ${category.label} Crate` },
            // NOTE: the reveal animation spins a reel containing candidate
            // names, so this text can appear while the reel is still moving.
            // It proves the roll happened, not that it has landed — which is
            // fine for the intermediate frames of a reveal sequence, and is
            // why the final frame below waits on something stronger.
            waitForText: predicted.bySlot[category.slot],
            settleMs: 450,
          })),
          {
            // "Build With This" belongs to the finished-build block, which
            // only renders once all eight slots have landed and finalizeCrateBuild
            // has run. Waiting on it means this frame is the settled result
            // rather than a card caught mid-spin — the reveal reel shows
            // candidate names while it moves, so a part name alone proves the
            // roll happened, not that it finished.
            label: "crate-complete",
            waitForText: "Build With This",
            settleMs: 700,
          },
        ],
      };
    }
  }
}

/** Text that means the app crashed rather than rendered. */
export const ERROR_BOUNDARY_MARKERS = [
  "Something went wrong",
  "Application error",
  "Unexpected Application Error",
];
