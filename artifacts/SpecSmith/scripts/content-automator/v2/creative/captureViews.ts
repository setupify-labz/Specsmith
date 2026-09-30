// The validated Compare views a MASTER #6 mission may show.
//
// WHY MORE THAN ONE
// -----------------
// A mission with a single capture state can only show one picture, so every
// beat repeats it and MASTER #1's shot-variety checks fail whatever the author
// writes. The Compare page's resolution and quality controls are real model
// inputs: each setting re-runs SpecSmith's FPS estimate, so the same pair at
// another setting is a genuinely different, reproducible screen, not a crop of
// the same screenshot.
//
// THE RULES
// ---------
// - Every view is the mission's own pair of builds. Only resolution and quality
//   change, and each view is validated by parseUiRenderRequest like the primary.
// - The primary view is the state the research was established for. A claim is
//   only known to hold there: at other settings the model's numbers differ, and
//   a claim true at 1440p High can be false at 4K High. So a beat that states a
//   claim must show the primary view (enforced in proposalPass).
// - A picture's identity is its state. Two visual ids naming one state are one
//   picture, however they are labelled.

import { parseUiRenderRequest, stateIdentifier, type CompareState, type UiRenderRequest } from "../../uiRender/uiRenderState.ts";
import type { DeclaredVisual } from "./visualHonesty.ts";

export interface CompareViewSetting {
  readonly resolution: NonNullable<CompareState["resolution"]>;
  readonly preset: NonNullable<CompareState["preset"]>;
}

export interface CaptureView extends CompareViewSetting {
  readonly stateIdentifier: string;
  readonly request: UiRenderRequest;
  /** The state the research claims were established for. */
  readonly primary: boolean;
}

export class CaptureViewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureViewError";
  }
}

/** The primary view first, then each additional setting of the same pair. */
export function missionCaptureViews(renderRequest: unknown, additional: readonly CompareViewSetting[] = []): readonly CaptureView[] {
  const primary = parseUiRenderRequest(renderRequest);
  const view = (request: UiRenderRequest, isPrimary: boolean): CaptureView => {
    if (request.state.surface !== "compare") throw new CaptureViewError("Capture views are defined for the Compare surface only.");
    return {
      stateIdentifier: stateIdentifier(request),
      request,
      primary: isPrimary,
      resolution: request.state.resolution ?? "1440p",
      preset: request.state.preset ?? "high",
    };
  };
  const views = [view(primary, true)];
  if (additional.length > 0 && (primary.state.surface !== "compare" || primary.captureType !== "static")) {
    throw new CaptureViewError("Additional views need a static Compare primary view.");
  }
  for (const setting of additional) {
    // Rebuilt from the primary request, so a view can never change the pair.
    const request = parseUiRenderRequest({
      ...(renderRequest as Record<string, unknown>),
      state: { ...(primary.state as CompareState), resolution: setting.resolution, preset: setting.preset },
    });
    const next = view(request, false);
    if (views.some((existing) => existing.stateIdentifier === next.stateIdentifier)) {
      throw new CaptureViewError(`View ${setting.resolution}/${setting.preset} is listed twice or repeats the primary view.`);
    }
    views.push(next);
  }
  return views;
}

/** What is actually on screen: the state for a capture, the visual itself otherwise. */
export function pictureIdentity(visual: DeclaredVisual): string {
  return visual.kind === "real-product-capture"
    ? `${visual.kind}:${visual.surface}:${visual.stateIdentifier}`
    : `${visual.kind}:${visual.visualId}`;
}
