import { describe, it, expect, afterEach } from "vitest";

import {
  parseUiRenderRequest,
  stateIdentifier,
  UiRenderStateError,
  VERTICAL_1080x1920,
} from "./uiRenderState.ts";
import { planSurface } from "./surfaces.ts";
import { createDeterministicUiRenderAdapter } from "./deterministicUiRenderAdapter.ts";
import { RenderAdapterRegistry, createDryRunAdapter, createFullDryRunRegistry } from "../rendering.ts";
import type { ProductionTask } from "../types.ts";
import { rollGpu, rollMotherboard, seededRng, setCrateRng } from "../../../src/lib/buildCrate.ts";

const compare = {
  state: { surface: "compare", gpuA: "rtx5090", cpuA: "r7-9800x3d", gpuB: "rtx4090", cpuB: "r7-7800x3d" },
  captureType: "static",
};

describe("request parsing and state validation", () => {
  it("accepts a well-formed compare request and applies defaults", () => {
    const parsed = parseUiRenderRequest(compare);
    expect(parsed.state.surface).toBe("compare");
    expect(parsed.captureType).toBe("static");
    expect(parsed.viewport).toEqual(VERTICAL_1080x1920);
    // Defaults are explicit, not accidental.
    if (parsed.state.surface === "compare") {
      expect(parsed.state.resolution).toBe("1440p");
      expect(parsed.state.preset).toBe("high");
    }
  });

  it("renders at a true 1080x1920 while laying out at a width the app targets", () => {
    const v = VERTICAL_1080x1920;
    expect(v.width * v.deviceScaleFactor).toBe(1080);
    expect(v.height * v.deviceScaleFactor).toBe(1920);
  });

  it("rejects a landscape viewport, which cannot be cropped to 9:16 without loss", () => {
    expect(() => parseUiRenderRequest({ ...compare, viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } }))
      .toThrow(/not portrait/i);
  });

  it("rejects a malformed request rather than filling in blanks", () => {
    expect(() => parseUiRenderRequest(null)).toThrow(UiRenderStateError);
    expect(() => parseUiRenderRequest({})).toThrow(/missing its `state`/);
    expect(() => parseUiRenderRequest({ state: { surface: "not-a-page" } })).toThrow(/Unknown surface/);
  });

  it("bounds sequence duration and fps", () => {
    expect(() => parseUiRenderRequest({ ...compare, captureType: "sequence", durationSeconds: 90 })).toThrow(/durationSeconds/);
    expect(() => parseUiRenderRequest({ ...compare, captureType: "sequence", fps: 0 })).toThrow(/fps/);
  });
});

describe("missing or invalid hardware fails closed", () => {
  it("refuses an unknown GPU id instead of substituting one", () => {
    expect(() => parseUiRenderRequest({ ...compare, state: { ...compare.state, gpuA: "rtx9999" } }))
      .toThrow(/not a SpecSmith GPU id/);
  });

  it("refuses an unknown CPU id", () => {
    expect(() => parseUiRenderRequest({ ...compare, state: { ...compare.state, cpuB: "i9-99999k" } }))
      .toThrow(/not a SpecSmith CPU id/);
  });

  it("refuses a plausible-looking name that is not a canonical id", () => {
    // The whole point of requiring ids: "RTX 5090" is a name, not an id, and
    // accepting names is how a renderer starts guessing.
    expect(() => parseUiRenderRequest({ ...compare, state: { ...compare.state, gpuA: "RTX 5090" } }))
      .toThrow(/not a SpecSmith GPU id/);
  });

  it("refuses a Builder request naming no verifiable slot", () => {
    // Real RAM id, so this isolates the "needs a gpu or cpu" rule rather than
    // tripping component validation first.
    expect(() => parseUiRenderRequest({ state: { surface: "builder", ram: "cv16ddr4" }, captureType: "static" }))
      .toThrow(/at least a gpu or a cpu/);
  });

  it("refuses an invalid component even when the GPU and CPU are valid", () => {
    // The exact smuggling route worth closing: a believable build whose
    // motherboard slot would silently render empty.
    expect(() => parseUiRenderRequest({
      state: { surface: "builder", gpu: "rtx4070", cpu: "r5-7600x", motherboard: "not-a-board" },
      captureType: "static",
    })).toThrow(/not a SpecSmith motherboard id/);
  });

  it("validates every component slot against its own catalog", () => {
    const base = { surface: "builder", gpu: "rtx4070", cpu: "r5-7600x" };
    for (const slot of ["motherboard", "ram", "storage", "psu", "case", "cooler"]) {
      expect(
        () => parseUiRenderRequest({ state: { ...base, [slot]: "bogus-id" }, captureType: "static" }),
        `${slot} must be validated`,
      ).toThrow(new RegExp(`not a SpecSmith ${slot} id`));
    }
  });

  it("accepts a fully-specified build of real catalog ids and verifies every part", () => {
    const request = parseUiRenderRequest({
      state: {
        surface: "builder", gpu: "rtx5070ti", cpu: "r7-9800x3d", motherboard: "z890hero",
        ram: "cv16ddr4", storage: "s870evo", psu: "crm750", case: "fdpopair", cooler: "cmh212",
      },
      captureType: "static",
    });
    const plan = planSurface(request);
    // Eight requested parts -> eight names that must appear on screen.
    expect(plan.subjectIds).toHaveLength(8);
    expect(plan.expectedText).toHaveLength(8);
  });

  it("refuses a Build Crate request with no seed, because it would not be reproducible", () => {
    expect(() => parseUiRenderRequest({ state: { surface: "build-crate" }, captureType: "static" }))
      .toThrow(/requires an integer seed/);
    expect(() => parseUiRenderRequest({ state: { surface: "build-crate", seed: 1.5 }, captureType: "static" }))
      .toThrow(/requires an integer seed/);
  });
});

describe("deterministic state behaviour", () => {
  it("produces a stable state id for the same request", () => {
    expect(stateIdentifier(parseUiRenderRequest(compare))).toBe(stateIdentifier(parseUiRenderRequest(compare)));
  });

  it("produces a different state id when any subject changes", () => {
    const a = stateIdentifier(parseUiRenderRequest(compare));
    const b = stateIdentifier(parseUiRenderRequest({ ...compare, state: { ...compare.state, gpuB: "rtx4080" } }));
    expect(a).not.toBe(b);
  });

  it("builds the same route every time, with canonical ids in the query", () => {
    const plan = planSurface(parseUiRenderRequest(compare));
    expect(plan.route).toBe(planSurface(parseUiRenderRequest(compare)).route);
    expect(plan.route).toContain("gpuA=rtx5090");
    expect(plan.route).toContain("cpuB=r7-7800x3d");
    expect(plan.subjectIds).toEqual(["rtx5090", "r7-9800x3d", "rtx4090", "r7-7800x3d"]);
  });

  it("verifies compare state with a composite string, not a bare model name", () => {
    // Non-vacuity matters here: Compare renders its part pickers expanded, so
    // every GPU name in the catalog is present in the DOM. Asserting "RTX 5090"
    // would pass no matter which GPU was actually selected; the "A + B"
    // composite is rendered only for the selected pair.
    const plan = planSurface(parseUiRenderRequest(compare));
    expect(plan.expectedText).toEqual(["RTX 5090 + Ryzen 7 9800X3D", "RTX 4090 + Ryzen 7 7800X3D"]);
    for (const text of plan.expectedText) expect(text).toContain(" + ");
  });

  it("maps each surface to its real SpecSmith route", () => {
    const routeOf = (state: unknown) => planSurface(parseUiRenderRequest({ state, captureType: "static" })).route;
    expect(routeOf({ surface: "builder", gpu: "rtx4070", cpu: "r5-7600x" })).toBe("/builder?gpu=rtx4070&cpu=r5-7600x");
    expect(routeOf({ surface: "upgrade-gpu", from: "rtx3060" })).toBe("/upgrade-calculator?gpu=rtx3060");
    expect(routeOf({ surface: "upgrade-cpu", from: "r5-5600" })).toBe("/upgrade-calculator-cpu?cpu=r5-5600");
    expect(routeOf({ surface: "build-crate", seed: 7 })).toBe("/crate?seed=7");
  });
});

describe("deterministic Build Crate rolls", () => {
  afterEach(() => setCrateRng(null));

  it("returns an identical roll for the same seed, using the real crate logic", () => {
    setCrateRng(seededRng(12345));
    const first = { mb: rollMotherboard(), gpu: rollGpu() };
    setCrateRng(seededRng(12345));
    const second = { mb: rollMotherboard(), gpu: rollGpu() };
    expect(second.mb.part.id ?? second.mb.part).toEqual(first.mb.part.id ?? first.mb.part);
    expect(second.gpu.part.id ?? second.gpu.part).toEqual(first.gpu.part.id ?? first.gpu.part);
    expect(second.gpu.rarity).toBe(first.gpu.rarity);
  });

  it("returns a different roll for a different seed", () => {
    const rollWith = (seed: number) => {
      setCrateRng(seededRng(seed));
      return Array.from({ length: 6 }, () => rollGpu().part.name).join("|");
    };
    expect(rollWith(1)).not.toBe(rollWith(999));
  });

  it("restores real randomness when the seed is cleared, leaving production unchanged", () => {
    setCrateRng(seededRng(42));
    const seeded = rollGpu().part.name;
    setCrateRng(null);
    // Over many pulls an unseeded roll must not be pinned to the seeded value.
    const names = new Set(Array.from({ length: 40 }, () => rollGpu().part.name));
    expect(names.size).toBeGreaterThan(1);
    expect(typeof seeded).toBe("string");
  });
});

describe("adapter registration and orchestrator contract", () => {
  const adapter = () => createDeterministicUiRenderAdapter({ baseUrl: "http://localhost:1", outputDir: "/tmp/unused" });

  it("registers against the real deterministic-ui-render capability", () => {
    const registry = new RenderAdapterRegistry().register(adapter());
    const registered = registry.get("deterministic-ui-render");
    expect(registered).toHaveLength(1);
    expect(registered[0].name).toBe("specsmith-ui-render");
    expect(registered[0].capability).toBe("deterministic-ui-render");
  });

  it("coexists with the dry-run adapter as a fallback in the same registry", () => {
    const registry = new RenderAdapterRegistry()
      .register(adapter())
      .register(createDryRunAdapter("deterministic-ui-render"));
    expect(registry.get("deterministic-ui-render").map((a) => a.name))
      .toEqual(["specsmith-ui-render", "dry-run-deterministic-ui-render"]);
  });

  it("leaves the full dry-run registry usable for tests that want no browser", () => {
    expect(createFullDryRunRegistry().get("deterministic-ui-render")).toHaveLength(1);
  });

  it("refuses a duplicate registration, per the existing registry contract", () => {
    const registry = new RenderAdapterRegistry().register(adapter());
    expect(() => registry.register(adapter())).toThrow(/Duplicate render adapter/);
  });

  it("fails closed when a ui-render task carries no structured state", async () => {
    // The prose in inputRequirements is not a substitute: inferring hardware
    // from a sentence is the fabrication this capability exists to prevent.
    const task: ProductionTask = {
      taskId: "t1",
      capability: "deterministic-ui-render",
      sourceBeat: 0,
      purpose: "evidence",
      inputRequirements: ["Show the real SpecSmith compare page with the 5090 versus the 4090"],
      outputRequirements: [],
    };
    await expect(
      adapter().render({
        packageId: "p", campaignId: "c", ideaId: "i", platform: "tiktok",
        targetDurationSeconds: 30, task, dependencyArtifacts: [],
      }),
    ).rejects.toThrow(/no uiRenderState/);
  });

  it("fails closed on an invalid id before ever launching a browser", async () => {
    const task: ProductionTask = {
      taskId: "t2",
      capability: "deterministic-ui-render",
      sourceBeat: 0,
      purpose: "evidence",
      inputRequirements: [],
      outputRequirements: [],
      uiRenderState: { state: { ...compare.state, gpuA: "not-real" }, captureType: "static" },
    };
    // baseUrl points at a dead port; reaching the network would hang rather
    // than throw this specific error, so this also proves validation is first.
    await expect(
      adapter().render({
        packageId: "p", campaignId: "c", ideaId: "i", platform: "tiktok",
        targetDurationSeconds: 30, task, dependencyArtifacts: [],
      }),
    ).rejects.toThrow(/not a SpecSmith GPU id/);
  });
});
