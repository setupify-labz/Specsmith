import type {
  PlatformProductionPlan,
  ProductionCapability,
  ProductionPlanPackage,
  ProductionTask,
  VideoPlatform,
} from "./types.ts";

export type RenderArtifactKind = "video" | "image" | "audio" | "captions" | "json";

export interface RenderArtifact {
  artifactId: string;
  taskId: string;
  kind: RenderArtifactKind;
  uri: string;
  mimeType: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface RenderTaskContext {
  packageId: string;
  campaignId: string;
  ideaId: string;
  platform: VideoPlatform;
  targetDurationSeconds: number;
  task: ProductionTask;
  dependencyArtifacts: RenderArtifact[];
}

export interface RenderAdapter {
  name: string;
  capability: ProductionCapability;
  render(context: RenderTaskContext): Promise<RenderArtifact[]>;
}

export interface RenderAttempt {
  capability: ProductionCapability;
  adapterName: string;
  ok: boolean;
  error?: string;
}

export interface RenderTaskResult {
  taskId: string;
  status: "succeeded" | "failed" | "skipped";
  attempts: RenderAttempt[];
  artifacts: RenderArtifact[];
  error?: string;
}

export interface PlatformRenderResult {
  packageId: string;
  campaignId: string;
  ideaId: string;
  platform: VideoPlatform;
  status: "succeeded" | "failed";
  taskResults: RenderTaskResult[];
  finalArtifacts: RenderArtifact[];
}

export interface RenderOptions {
  maxAttemptsPerCapability?: number;
}

const DEFAULT_MAX_ATTEMPTS = 2;

export class RenderAdapterRegistry {
  private readonly adapters = new Map<ProductionCapability, RenderAdapter[]>();

  register(adapter: RenderAdapter): this {
    const current = this.adapters.get(adapter.capability) ?? [];
    if (current.some((entry) => entry.name === adapter.name)) {
      throw new Error(`Duplicate render adapter ${adapter.name} for ${adapter.capability}`);
    }
    this.adapters.set(adapter.capability, [...current, adapter]);
    return this;
  }

  get(capability: ProductionCapability): RenderAdapter[] {
    return this.adapters.get(capability) ?? [];
  }
}

function taskById(plan: PlatformProductionPlan, taskId: string): ProductionTask {
  const task = plan.tasks.find((entry) => entry.taskId === taskId);
  if (!task) throw new Error(`Render order references missing task ${taskId}`);
  return task;
}

function referencedDependencies(task: ProductionTask, knownTaskIds: Set<string>): string[] {
  return task.inputRequirements.filter((value) => knownTaskIds.has(value));
}

function validatePlan(plan: PlatformProductionPlan): void {
  const taskIds = new Set(plan.tasks.map((task) => task.taskId));
  if (taskIds.size !== plan.tasks.length) throw new Error(`Duplicate task id in ${plan.platform} production plan`);
  if (plan.renderOrder.length !== plan.tasks.length) throw new Error(`Render order does not cover every task for ${plan.platform}`);
  if (new Set(plan.renderOrder).size !== plan.renderOrder.length) throw new Error(`Render order contains duplicate tasks for ${plan.platform}`);
  for (const taskId of plan.renderOrder) taskById(plan, taskId);

  const completed = new Set<string>();
  for (const taskId of plan.renderOrder) {
    const task = taskById(plan, taskId);
    const dependencies = referencedDependencies(task, taskIds);
    for (const dependency of dependencies) {
      if (!completed.has(dependency)) {
        throw new Error(`Task ${task.taskId} depends on ${dependency}, but render order places it too early`);
      }
    }
    completed.add(taskId);
  }
}

async function runCapability(
  registry: RenderAdapterRegistry,
  capability: ProductionCapability,
  context: RenderTaskContext,
  maxAttempts: number,
): Promise<{ artifacts: RenderArtifact[]; attempts: RenderAttempt[] }> {
  const adapters = registry.get(capability);
  if (!adapters.length) throw new Error(`No render adapter registered for ${capability}`);

  const attempts: RenderAttempt[] = [];
  let lastError: unknown;
  for (const adapter of adapters) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const artifacts = await adapter.render({ ...context, task: { ...context.task, capability } });
        if (!artifacts.length) throw new Error("Adapter returned no artifacts");
        if (artifacts.some((artifact) => artifact.taskId !== context.task.taskId)) {
          throw new Error("Adapter returned artifact for the wrong task");
        }
        attempts.push({ capability, adapterName: adapter.name, ok: true });
        return { artifacts, attempts };
      } catch (error) {
        lastError = error;
        attempts.push({ capability, adapterName: adapter.name, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown render error");
  throw Object.assign(new Error(message), { attempts });
}

export async function renderPlatformPlan(
  productionPackage: ProductionPlanPackage,
  platformPlan: PlatformProductionPlan,
  registry: RenderAdapterRegistry,
  options: RenderOptions = {},
): Promise<PlatformRenderResult> {
  validatePlan(platformPlan);
  const maxAttempts = Math.max(1, options.maxAttemptsPerCapability ?? DEFAULT_MAX_ATTEMPTS);
  const taskIds = new Set(platformPlan.tasks.map((task) => task.taskId));
  const results = new Map<string, RenderTaskResult>();

  for (const taskId of platformPlan.renderOrder) {
    const task = taskById(platformPlan, taskId);
    const dependencyIds = referencedDependencies(task, taskIds);
    const failedDependency = dependencyIds.find((dependencyId) => results.get(dependencyId)?.status !== "succeeded");
    if (failedDependency) {
      results.set(taskId, {
        taskId,
        status: "skipped",
        attempts: [],
        artifacts: [],
        error: `Dependency ${failedDependency} did not succeed`,
      });
      continue;
    }

    const dependencyArtifacts = dependencyIds.flatMap((dependencyId) => results.get(dependencyId)?.artifacts ?? []);
    const context: RenderTaskContext = {
      packageId: productionPackage.packageId,
      campaignId: productionPackage.campaignId,
      ideaId: productionPackage.ideaId,
      platform: platformPlan.platform,
      targetDurationSeconds: platformPlan.targetDurationSeconds,
      task,
      dependencyArtifacts,
    };

    const attempts: RenderAttempt[] = [];
    try {
      const primary = await runCapability(registry, task.capability, context, maxAttempts);
      attempts.push(...primary.attempts);
      results.set(taskId, { taskId, status: "succeeded", attempts, artifacts: primary.artifacts });
    } catch (primaryError) {
      const primaryAttempts = (primaryError as { attempts?: RenderAttempt[] }).attempts ?? [];
      attempts.push(...primaryAttempts);
      if (task.fallbackCapability) {
        try {
          const fallback = await runCapability(registry, task.fallbackCapability, context, maxAttempts);
          attempts.push(...fallback.attempts);
          results.set(taskId, { taskId, status: "succeeded", attempts, artifacts: fallback.artifacts });
          continue;
        } catch (fallbackError) {
          attempts.push(...((fallbackError as { attempts?: RenderAttempt[] }).attempts ?? []));
          results.set(taskId, {
            taskId,
            status: "failed",
            attempts,
            artifacts: [],
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
          continue;
        }
      }
      results.set(taskId, {
        taskId,
        status: "failed",
        attempts,
        artifacts: [],
        error: primaryError instanceof Error ? primaryError.message : String(primaryError),
      });
    }
  }

  const taskResults = platformPlan.renderOrder.map((taskId) => results.get(taskId)!);
  const failed = taskResults.some((result) => result.status !== "succeeded");
  const composeTaskId = platformPlan.renderOrder.find((taskId) => taskId.endsWith("-compose"));
  const finalArtifacts = composeTaskId ? results.get(composeTaskId)?.artifacts ?? [] : [];

  return {
    packageId: productionPackage.packageId,
    campaignId: productionPackage.campaignId,
    ideaId: productionPackage.ideaId,
    platform: platformPlan.platform,
    status: failed ? "failed" : "succeeded",
    taskResults,
    finalArtifacts,
  };
}

export async function renderProductionPackage(
  productionPackage: ProductionPlanPackage,
  registry: RenderAdapterRegistry,
  options: RenderOptions = {},
): Promise<PlatformRenderResult[]> {
  const results: PlatformRenderResult[] = [];
  for (const platformPlan of productionPackage.platforms) {
    results.push(await renderPlatformPlan(productionPackage, platformPlan, registry, options));
  }
  return results;
}

export function createDryRunAdapter(capability: ProductionCapability): RenderAdapter {
  return {
    name: `dry-run-${capability}`,
    capability,
    async render(context) {
      const kind: RenderArtifactKind = capability === "text-to-speech" || capability === "music-sfx"
        ? "audio"
        : capability === "caption-render"
          ? "captions"
          : capability === "motion-compositor" || capability === "video-generation"
            ? "video"
            : capability === "image-generation" || capability === "deterministic-ui-render"
              ? "image"
              : "json";
      return [{
        artifactId: `${context.packageId}-${context.platform}-${context.task.taskId}`,
        taskId: context.task.taskId,
        kind,
        uri: `dry-run://${context.packageId}/${context.platform}/${context.task.taskId}`,
        mimeType: kind === "video" ? "video/mp4" : kind === "audio" ? "audio/wav" : kind === "image" ? "image/png" : kind === "captions" ? "text/vtt" : "application/json",
        metadata: { dryRun: true, capability },
      }];
    },
  };
}

export function createFullDryRunRegistry(): RenderAdapterRegistry {
  const registry = new RenderAdapterRegistry();
  const capabilities: ProductionCapability[] = [
    "deterministic-ui-render",
    "video-generation",
    "image-generation",
    "text-to-speech",
    "music-sfx",
    "motion-compositor",
    "caption-render",
  ];
  for (const capability of capabilities) registry.register(createDryRunAdapter(capability));
  return registry;
}
