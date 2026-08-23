// The typed state contract for deterministic SpecSmith UI captures.
//
// WHY THIS EXISTS
// ---------------
// A production task's `inputRequirements` is free-form English written for a
// human or a generative model ("Show the real SpecSmith compare page with the
// 5090 against the 4090"). That is fine for a video-generation adapter, which
// is allowed to dramatize. It is useless — and dangerous — for a deterministic
// UI render, which must reproduce ONE exact application state and be able to
// prove afterwards that it did. Recovering canonical ids by parsing prose is
// precisely the guessing this renderer exists to eliminate.
//
// So a UI-render task carries a structured request alongside the prose, and
// every hardware reference in it is a canonical SpecSmith catalog id
// ("rtx5090", "r7-9800x3d"), resolved against the real gpus.json / cpus.json
// that ship in the app.
//
// FAIL CLOSED
// -----------
// Every unknown id, unknown surface, or malformed request throws
// UiRenderStateError. Nothing is substituted, defaulted, or "closest matched".
// This matters more than it looks: SpecSmith's own Compare page deliberately
// fails OPEN — Compare.tsx's initGpu() silently falls back to its default GPU
// when a URL id is unrecognised — so a typo'd request would otherwise render a
// flawless, entirely wrong screenshot. Validating here is the first of two
// defences; verifying the rendered DOM afterwards (see surfaces.ts) is the
// second, because only the second one catches the silent fallback.

import gpus from "../../../src/data/gpus.json" with { type: "json" };
import cpus from "../../../src/data/cpus.json" with { type: "json" };
import components from "../../../src/data/components.json" with { type: "json" };

export class UiRenderStateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "UiRenderStateError";
    this.code = code;
  }
}

interface CatalogEntry {
  id: string;
  name: string;
}

const GPU_CATALOG = gpus as CatalogEntry[];
const CPU_CATALOG = cpus as CatalogEntry[];

/**
 * The non-GPU/CPU Builder slots, each backed by its real catalog.
 *
 * Validated exactly like GPUs and CPUs rather than accepted as any non-empty
 * string. A capture whose motherboard id is a typo would otherwise render a
 * Builder with that slot silently empty, and a valid CPU/GPU pair would make
 * the screenshot look complete — a wrong state that passes inspection, which
 * is the failure this renderer exists to prevent.
 */
const COMPONENT_CATALOGS = {
  motherboard: (components as Record<string, CatalogEntry[]>).motherboards,
  ram: (components as Record<string, CatalogEntry[]>).ram,
  storage: (components as Record<string, CatalogEntry[]>).storage,
  psu: (components as Record<string, CatalogEntry[]>).psus,
  case: (components as Record<string, CatalogEntry[]>).cases,
  cooler: (components as Record<string, CatalogEntry[]>).coolers,
} as const;

export type BuilderComponentSlot = keyof typeof COMPONENT_CATALOGS;

export const BUILDER_COMPONENT_SLOTS = Object.keys(COMPONENT_CATALOGS) as BuilderComponentSlot[];

function requireComponent(id: unknown, slot: BuilderComponentSlot): string {
  if (typeof id !== "string" || !id) {
    throw new UiRenderStateError("missing-field", `${slot} must be a non-empty component id when provided.`);
  }
  const catalog = COMPONENT_CATALOGS[slot];
  if (!catalog?.some((entry) => entry.id === id)) {
    throw new UiRenderStateError(
      "unknown-component",
      `${slot}="${id}" is not a SpecSmith ${slot} id. Refusing to render: the Builder would show that slot empty while the rest of the build looked complete.`,
    );
  }
  return id;
}

/** Display name for a component id, used to verify it actually loaded. */
export function componentName(id: string, slot: BuilderComponentSlot): string {
  const entry = COMPONENT_CATALOGS[slot]?.find((e) => e.id === id);
  if (!entry) throw new UiRenderStateError("unknown-component", `No ${slot} named ${id}`);
  return entry.name;
}

/** Which SpecSmith product surface to capture. Mirrors types.ts SiteFeature. */
export type UiRenderSurface =
  | "compare"
  | "builder"
  | "upgrade-gpu"
  | "upgrade-cpu"
  | "build-crate";

export type UiCaptureType = "static" | "sequence";

export interface UiViewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

/**
 * 9:16 at a real device pixel ratio.
 *
 * Rendered at 540x960 CSS pixels with dsf 2, which produces a true 1080x1920
 * image while letting the app lay out at a width its responsive breakpoints
 * actually target. Rendering at 1080 CSS pixels wide would trigger the desktop
 * layout and then need destructive downscaling to fit vertical video.
 */
export const VERTICAL_1080x1920: UiViewport = { width: 540, height: 960, deviceScaleFactor: 2 };

export interface CompareState {
  surface: "compare";
  gpuA: string;
  cpuA: string;
  gpuB: string;
  cpuB: string;
  resolution?: "1080p" | "1440p" | "4k";
  preset?: "low" | "medium" | "high" | "ultra";
}

export interface BuilderState {
  surface: "builder";
  /** Canonical part ids per slot. gpu/cpu are the ones we can verify on screen. */
  gpu?: string;
  cpu?: string;
  motherboard?: string;
  ram?: string;
  storage?: string;
  psu?: string;
  case?: string;
  cooler?: string;
}

export interface UpgradeState {
  surface: "upgrade-gpu" | "upgrade-cpu";
  /** The user's current part — the calculator's input. */
  from: string;
}

export interface BuildCrateState {
  surface: "build-crate";
  /** Integer seed. The same seed always yields the same crate result. */
  seed: number;
}

export type UiRenderSurfaceState = CompareState | BuilderState | UpgradeState | BuildCrateState;

export interface UiRenderRequest {
  state: UiRenderSurfaceState;
  captureType: UiCaptureType;
  viewport?: UiViewport;
  /** Sequence only: total wall-clock span of the captured frames. */
  durationSeconds?: number;
  /** Sequence only: frames per second to sample. */
  fps?: number;
}

const SURFACES: readonly UiRenderSurface[] = ["compare", "builder", "upgrade-gpu", "upgrade-cpu", "build-crate"];
const RESOLUTIONS = ["1080p", "1440p", "4k"] as const;
const PRESETS = ["low", "medium", "high", "ultra"] as const;

function requireGpu(id: unknown, field: string): string {
  if (typeof id !== "string" || !id) {
    throw new UiRenderStateError("missing-field", `${field} is required and must be a canonical GPU id.`);
  }
  if (!GPU_CATALOG.some((g) => g.id === id)) {
    throw new UiRenderStateError(
      "unknown-gpu",
      `${field}="${id}" is not a SpecSmith GPU id. Refusing to render: substituting a different GPU would produce a convincing screenshot of the wrong hardware.`,
    );
  }
  return id;
}

function requireCpu(id: unknown, field: string): string {
  if (typeof id !== "string" || !id) {
    throw new UiRenderStateError("missing-field", `${field} is required and must be a canonical CPU id.`);
  }
  if (!CPU_CATALOG.some((c) => c.id === id)) {
    throw new UiRenderStateError(
      "unknown-cpu",
      `${field}="${id}" is not a SpecSmith CPU id. Refusing to render rather than substituting another CPU.`,
    );
  }
  return id;
}

/** Human-facing name for a canonical id, used to verify the rendered DOM. */
export function gpuName(id: string): string {
  const entry = GPU_CATALOG.find((g) => g.id === id);
  if (!entry) throw new UiRenderStateError("unknown-gpu", `No GPU named ${id}`);
  return entry.name;
}

export function cpuName(id: string): string {
  const entry = CPU_CATALOG.find((c) => c.id === id);
  if (!entry) throw new UiRenderStateError("unknown-cpu", `No CPU named ${id}`);
  return entry.name;
}

function validateViewport(v: UiViewport): UiViewport {
  if (!Number.isFinite(v.width) || !Number.isFinite(v.height) || v.width <= 0 || v.height <= 0) {
    throw new UiRenderStateError("bad-viewport", `Viewport must have positive finite dimensions, got ${v.width}x${v.height}.`);
  }
  if (!Number.isFinite(v.deviceScaleFactor) || v.deviceScaleFactor <= 0) {
    throw new UiRenderStateError("bad-viewport", `deviceScaleFactor must be positive, got ${v.deviceScaleFactor}.`);
  }
  if (v.height <= v.width) {
    throw new UiRenderStateError(
      "bad-viewport",
      `Viewport ${v.width}x${v.height} is not portrait. These captures target 9:16 short-form video; a landscape frame would have to be cropped destructively.`,
    );
  }
  return v;
}

/**
 * Validates an untrusted render request into a normalized one.
 *
 * Accepts `unknown` deliberately: the request arrives on a ProductionTask that
 * may have been produced by a model or read from JSON, so it has not been
 * type-checked by the compiler in any meaningful sense.
 */
export function parseUiRenderRequest(input: unknown): UiRenderRequest {
  if (!input || typeof input !== "object") {
    throw new UiRenderStateError("malformed", "UI render request must be an object.");
  }
  const raw = input as Record<string, unknown>;
  const stateRaw = raw.state;
  if (!stateRaw || typeof stateRaw !== "object") {
    throw new UiRenderStateError("malformed", "UI render request is missing its `state` object.");
  }
  const s = stateRaw as Record<string, unknown>;
  const surface = s.surface;
  if (typeof surface !== "string" || !SURFACES.includes(surface as UiRenderSurface)) {
    throw new UiRenderStateError(
      "unknown-surface",
      `Unknown surface ${JSON.stringify(surface)}. Supported: ${SURFACES.join(", ")}.`,
    );
  }

  const captureType = raw.captureType ?? "static";
  if (captureType !== "static" && captureType !== "sequence") {
    throw new UiRenderStateError("malformed", `captureType must be "static" or "sequence", got ${JSON.stringify(captureType)}.`);
  }

  const viewport = validateViewport((raw.viewport as UiViewport | undefined) ?? VERTICAL_1080x1920);

  let durationSeconds: number | undefined;
  let fps: number | undefined;
  if (captureType === "sequence") {
    durationSeconds = typeof raw.durationSeconds === "number" ? raw.durationSeconds : 3;
    fps = typeof raw.fps === "number" ? raw.fps : 4;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 15) {
      throw new UiRenderStateError("malformed", `durationSeconds must be in (0, 15], got ${durationSeconds}.`);
    }
    if (!Number.isInteger(fps) || fps <= 0 || fps > 30) {
      throw new UiRenderStateError("malformed", `fps must be an integer in [1, 30], got ${fps}.`);
    }
  }

  let state: UiRenderSurfaceState;
  switch (surface as UiRenderSurface) {
    case "compare": {
      const resolution = s.resolution ?? "1440p";
      const preset = s.preset ?? "high";
      if (!RESOLUTIONS.includes(resolution as (typeof RESOLUTIONS)[number])) {
        throw new UiRenderStateError("malformed", `resolution must be one of ${RESOLUTIONS.join(", ")}.`);
      }
      if (!PRESETS.includes(preset as (typeof PRESETS)[number])) {
        throw new UiRenderStateError("malformed", `preset must be one of ${PRESETS.join(", ")}.`);
      }
      state = {
        surface: "compare",
        gpuA: requireGpu(s.gpuA, "gpuA"),
        cpuA: requireCpu(s.cpuA, "cpuA"),
        gpuB: requireGpu(s.gpuB, "gpuB"),
        cpuB: requireCpu(s.cpuB, "cpuB"),
        resolution: resolution as CompareState["resolution"],
        preset: preset as CompareState["preset"],
      };
      break;
    }
    case "builder": {
      const builder: BuilderState = { surface: "builder" };
      if (s.gpu !== undefined) builder.gpu = requireGpu(s.gpu, "gpu");
      if (s.cpu !== undefined) builder.cpu = requireCpu(s.cpu, "cpu");
      // Every remaining slot is validated against its real catalog too, so a
      // valid GPU/CPU pair cannot smuggle an invalid motherboard past.
      for (const key of BUILDER_COMPONENT_SLOTS) {
        if (s[key] === undefined) continue;
        builder[key] = requireComponent(s[key], key);
      }
      if (!builder.gpu && !builder.cpu) {
        throw new UiRenderStateError(
          "malformed",
          "A Builder capture must request at least a gpu or a cpu — those are the slots this renderer can verify actually loaded.",
        );
      }
      state = builder;
      break;
    }
    case "upgrade-gpu":
      state = { surface: "upgrade-gpu", from: requireGpu(s.from, "from") };
      break;
    case "upgrade-cpu":
      state = { surface: "upgrade-cpu", from: requireCpu(s.from, "from") };
      break;
    case "build-crate": {
      const seed = s.seed;
      if (!Number.isInteger(seed) || (seed as number) < 0) {
        throw new UiRenderStateError(
          "malformed",
          `build-crate requires an integer seed >= 0 (got ${JSON.stringify(seed)}). Without a seed the crate result is random and the capture would not be reproducible.`,
        );
      }
      state = { surface: "build-crate", seed: seed as number };
      break;
    }
    default:
      throw new UiRenderStateError("unknown-surface", `Unhandled surface ${surface}.`);
  }

  return { state, captureType, viewport, durationSeconds, fps };
}

/**
 * A stable identifier for the requested state.
 *
 * Derived only from the request, so the same request always yields the same
 * id. It goes into the artifact metadata and the output filename, which is what
 * lets a reviewer tell two captures apart and re-request an exact one.
 */
export function stateIdentifier(request: UiRenderRequest): string {
  const s = request.state;
  const parts: string[] = [s.surface];
  switch (s.surface) {
    case "compare":
      parts.push(s.gpuA, s.cpuA, "vs", s.gpuB, s.cpuB, s.resolution ?? "1440p", s.preset ?? "high");
      break;
    case "builder":
      for (const key of ["gpu", "cpu", "motherboard", "ram", "storage", "psu", "case", "cooler"] as const) {
        const value = s[key];
        if (value) parts.push(`${key}:${value}`);
      }
      break;
    case "upgrade-gpu":
    case "upgrade-cpu":
      parts.push(s.from);
      break;
    case "build-crate":
      parts.push(`seed${s.seed}`);
      break;
  }
  parts.push(request.captureType);
  const v = request.viewport ?? VERTICAL_1080x1920;
  parts.push(`${v.width}x${v.height}@${v.deviceScaleFactor}`);
  return parts.join("_").replace(/[^A-Za-z0-9_.:-]/g, "-");
}
