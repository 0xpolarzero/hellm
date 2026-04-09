import type {
  PiRuntimeBridge,
  PiRuntimeTransition,
  PiWorkerRequest,
  PiWorkerResult,
} from "@hellm/pi-bridge";
import { createEpisode } from "@hellm/session-model";

export class FakePiRuntimeBridge implements PiRuntimeBridge {
  readonly connected = true;
  readonly runtime = "pi";
  readonly workerRequests: PiWorkerRequest[] = [];
  readonly transitions: PiRuntimeTransition[] = [];
  private readonly queue: PiWorkerResult[] = [];

  enqueueResult(result: PiWorkerResult): void {
    this.queue.push(result);
  }

  async runWorker(request: PiWorkerRequest): Promise<PiWorkerResult> {
    this.workerRequests.push(request);
    const result = this.queue.shift();
    if (!result) {
      throw new Error("No queued fake pi worker result.");
    }
    return result;
  }

  async switchRuntime(
    transition: PiRuntimeTransition,
  ): Promise<PiRuntimeTransition> {
    this.transitions.push(transition);
    return transition;
  }
}

export class EchoPiRuntimeBridge implements PiRuntimeBridge {
  readonly connected = true;
  readonly runtime = "pi";
  readonly workerRequests: PiWorkerRequest[] = [];
  readonly transitions: PiRuntimeTransition[] = [];

  async runWorker(request: PiWorkerRequest): Promise<PiWorkerResult> {
    this.workerRequests.push(request);
    const now = new Date().toISOString();

    return {
      status: "completed",
      runtimeTransition: request.runtimeTransition,
      outputSummary: request.objective,
      episode: createEpisode({
        id: `${request.thread.id}:echo-pi:${now}`,
        threadId: request.thread.id,
        source: "pi-worker",
        objective: request.objective,
        status: "completed",
        conclusions: [request.objective],
        provenance: {
          executionPath: "pi-worker",
          actor: "pi-worker",
          notes: "Deterministic echo pi bridge for tests.",
        },
        startedAt: now,
        completedAt: now,
        inputEpisodeIds: request.inputEpisodeIds,
        ...(request.thread.worktreePath
          ? { worktreePath: request.thread.worktreePath }
          : {}),
      }),
    };
  }

  async switchRuntime(
    transition: PiRuntimeTransition,
  ): Promise<PiRuntimeTransition> {
    this.transitions.push(transition);
    return transition;
  }
}

export function createFakePiSdkEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    HELLM_PI_SDK_MODULE: new URL("./fake-pi-sdk-module.mjs", import.meta.url).href,
    ...overrides,
  };
}

export async function withProcessEnv<T>(
  env: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const previousValues = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(env)) {
    previousValues.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await run();
  } finally {
    for (const [key, value] of previousValues) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
