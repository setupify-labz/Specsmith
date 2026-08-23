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

import {
  cpuName,
  gpuName,
  type UiRenderRequest,
  type UiRenderSurfaceState,
} from "./uiRenderState.ts";

export interface SequenceStep {
  /** Label recorded in the frame manifest so a compositor knows what it got. */
  label: string;
  /** Optional DOM action performed before this frame is captured. */
  action?: { kind: "click"; selector: string } | { kind: "scrollTo"; selector: string };
  /** Milliseconds to let the UI settle after the action, before capturing. */
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
  /** Frames to capture for a sequence request. */
  sequence: SequenceStep[];
}

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
        sequence: [
          { label: "side-a", settleMs: 400 },
          { label: "side-b", settleMs: 400 },
          { label: "result", settleMs: 600 },
        ],
      };
    }

    case "builder": {
      const expected: string[] = [];
      if (state.gpu) expected.push(gpuName(state.gpu));
      if (state.cpu) expected.push(cpuName(state.cpu));
      const subjectIds = [state.gpu, state.cpu, state.motherboard, state.ram, state.storage, state.psu, state.case, state.cooler]
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

    case "build-crate":
      return {
        route: `/crate${q({ seed: String(state.seed) })}`,
        subjectIds: [],
        // Verified against the seeded roll computed from the real crate logic;
        // see deterministicUiRenderAdapter.ts, which resolves the expected part
        // names for the seed before the capture is accepted.
        expectedText: [],
        sequence: [
          { label: "crate-closed", settleMs: 300 },
          { label: "crate-opening", settleMs: 800 },
          { label: "crate-result", settleMs: 1200 },
        ],
      };
  }
}

/** Text that means the app crashed rather than rendered. */
export const ERROR_BOUNDARY_MARKERS = [
  "Something went wrong",
  "Application error",
  "Unexpected Application Error",
];
