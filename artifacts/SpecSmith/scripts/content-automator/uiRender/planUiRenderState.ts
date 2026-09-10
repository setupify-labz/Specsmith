// Derives a deterministic UI render state from real strategy output.
//
// The planner needs canonical ids, and it already has them: ContentIdea carries
// `subjectIds` populated straight from the catalogs (strategist.ts sets
// `[a.id, b.id]`, `[gpu.id]`, `[cpu.id]`), plus `productConnection.feature`.
// The only thing missing was that ContentPackage and ScriptStoryboardPackage
// dropped those fields before the plan was built, so productionPlan.ts had
// nothing but prose to work from. They now carry them through, and this module
// turns (feature, subjectIds) into a validated render request.
//
// NOTHING IS PARSED OUT OF PROSE. Ids are classified by looking them up in the
// real gpus.json / cpus.json, and an id that is in neither is simply not a
// subject this renderer can depict.
//
// WHEN A STATE CANNOT BE DERIVED
// ------------------------------
// deriveUiRenderState returns undefined rather than inventing something. What
// the planner does then depends on WHY, and the distinction matters:
// isRenderableFeature() says whether the surface could ever be captured. A
// surface that never can (gallery, price-guesser) downgrades to a generated
// visual. A renderable surface whose ids did not resolve keeps the
// deterministic capability and fails loudly, because quietly turning an
// evidence beat into generated footage would hide the bug and fabricate
// product visuals.

import gpus from "../../../src/data/gpus.json" with { type: "json" };
import cpus from "../../../src/data/cpus.json" with { type: "json" };
import type { SiteFeature } from "../types.ts";
import { parseUiRenderRequest, type UiRenderRequest } from "./uiRenderState.ts";

interface CatalogEntry {
  id: string;
  name: string;
  benchmark_score: number;
}

const GPUS = gpus as CatalogEntry[];
const CPUS = cpus as CatalogEntry[];

const isGpu = (id: string) => GPUS.some((g) => g.id === id);
const isCpu = (id: string) => CPUS.some((c) => c.id === id);

/**
 * The CPU used on BOTH sides of a GPU-vs-GPU comparison.
 *
 * A comparison idea's subjectIds are two GPUs; the Compare page needs a CPU per
 * side. Picking two different CPUs would change the FPS result and make the
 * capture a comparison of builds rather than of GPUs, so both sides get the
 * same one — the standard way to isolate a variable, and recorded in the
 * artifact metadata so the choice is visible rather than hidden.
 *
 * The specific CPU is the catalog's highest-benchmark part, chosen so the CPU
 * is the least likely bottleneck and the difference on screen is attributable
 * to the GPUs. It is derived from the catalog rather than hard-coded, so it
 * cannot drift out of date, and ties break by id to stay deterministic.
 */
export function referenceCpuId(): string {
  const best = [...CPUS].sort((a, b) =>
    b.benchmark_score - a.benchmark_score || (a.id < b.id ? -1 : 1),
  )[0];
  if (!best) throw new Error("CPU catalog is empty — cannot derive a reference CPU.");
  return best.id;
}

/** Same idea for a CPU-vs-CPU comparison: hold the GPU constant. */
export function referenceGpuId(): string {
  const best = [...GPUS].sort((a, b) =>
    b.benchmark_score - a.benchmark_score || (a.id < b.id ? -1 : 1),
  )[0];
  if (!best) throw new Error("GPU catalog is empty — cannot derive a reference GPU.");
  return best.id;
}

/**
 * Deterministic non-negative seed from a string.
 *
 * Used for Build Crate, whose result must be reproducible for a given idea.
 * FNV-1a: stable across runs and processes, unlike a hash that depends on
 * object iteration order or a random salt.
 */
export function seedFromString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 1; // keep it comfortably inside a positive int
}

/**
 * Whether this surface can ever be captured deterministically.
 *
 * Distinct from "did we manage to derive a state this time". If the surface is
 * renderable but the ids did not resolve, the beat MUST stay a
 * deterministic-ui-render and fail loudly: silently swapping an evidence beat
 * to generated visuals is precisely the fabrication SpecSmith's evidence rules
 * forbid, and it would hide a strategist bug behind a plausible video.
 */
export function isRenderableFeature(feature: SiteFeature): boolean {
  switch (feature) {
    case "compare":
    case "builder":
    case "upgrade":
    case "build-crate":
      return true;
    // Gallery needs a live backend, price-guesser is a game with no fixed
    // state, and the catalog/guide pages are not part of this renderer yet.
    case "gallery":
    case "price-guesser":
    case "parts-catalog":
    case "build-guides":
      return false;
  }
}

export interface DeriveInput {
  feature: SiteFeature;
  subjectIds: readonly string[];
  /** Used only to seed surfaces that have no hardware subject (Build Crate). */
  ideaId: string;
}

/**
 * Builds a validated render request, or undefined when this feature/subject
 * combination cannot be depicted deterministically.
 */
export function deriveUiRenderState(input: DeriveInput): UiRenderRequest | undefined {
  const gpuIds = input.subjectIds.filter(isGpu);
  const cpuIds = input.subjectIds.filter(isCpu);

  const build = (state: unknown): UiRenderRequest | undefined => {
    try {
      return parseUiRenderRequest({ state, captureType: "static" });
    } catch {
      // A derived state that does not validate is a planner bug, not something
      // to paper over: drop back to undefined so the beat does not become an
      // un-renderable UI task.
      return undefined;
    }
  };

  switch (input.feature) {
    case "compare": {
      if (gpuIds.length >= 2) {
        const cpu = referenceCpuId();
        return build({ surface: "compare", gpuA: gpuIds[0], cpuA: cpu, gpuB: gpuIds[1], cpuB: cpu });
      }
      if (cpuIds.length >= 2) {
        const gpu = referenceGpuId();
        return build({ surface: "compare", gpuA: gpu, cpuA: cpuIds[0], gpuB: gpu, cpuB: cpuIds[1] });
      }
      return undefined;
    }

    case "builder": {
      if (!gpuIds.length && !cpuIds.length) return undefined;
      return build({
        surface: "builder",
        ...(gpuIds[0] ? { gpu: gpuIds[0] } : {}),
        ...(cpuIds[0] ? { cpu: cpuIds[0] } : {}),
      });
    }

    case "upgrade": {
      // The idea names the part the viewer already owns — the calculator's
      // input. GPU takes precedence when both are present because the GPU
      // upgrade calculator is the primary surface.
      if (gpuIds[0]) return build({ surface: "upgrade-gpu", from: gpuIds[0] });
      if (cpuIds[0]) return build({ surface: "upgrade-cpu", from: cpuIds[0] });
      return undefined;
    }

    case "build-crate":
      // No hardware subject: the crate rolls its own. The seed comes from the
      // idea id so the same idea always yields the same crate.
      return build({ surface: "build-crate", seed: seedFromString(input.ideaId) });

    // Gallery needs a live backend, price-guesser is a game with no fixed
    // state, and the catalog/guide pages are not part of this renderer yet.
    case "gallery":
    case "price-guesser":
    case "parts-catalog":
    case "build-guides":
      return undefined;
  }
}
