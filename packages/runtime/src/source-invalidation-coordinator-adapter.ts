import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import type { RuntimeSourceInvalidationDomain } from "./bootstrap";
import {
  createSourceInvalidationCoordinator,
  type SourceInvalidationCoordinator,
  type SourceInvalidationCoordinatorOptions,
  type SourceInvalidationEvent,
} from "./source-invalidation-coordinator";

export type RuntimeSourceInvalidationCoordinatorHandleOptions =
  SourceInvalidationCoordinatorOptions;

export type RuntimeSourceInvalidationCoordinatorHandle = {
  classifyHint(
    input: Parameters<SourceInvalidationCoordinator["classifyHint"]>[0],
  ): Promise<"scan" | "scan-parent-domain" | "ignore">;
  close(): Promise<void>;
  reconcile(input: {
    domains?: readonly RuntimeSourceInvalidationDomain[];
    reason: string;
  }): Promise<SourceInvalidationEvent | null>;
  ready(): Promise<void>;
  refreshWatchedInputs(reason?: string): Promise<void>;
  requestScan(input: Parameters<SourceInvalidationCoordinator["requestScan"]>[0]): Promise<void>;
};

export function createRuntimeSourceInvalidationCoordinatorHandle(
  options: RuntimeSourceInvalidationCoordinatorHandleOptions,
): RuntimeSourceInvalidationCoordinatorHandle {
  let coordinator: ReturnType<typeof createSourceInvalidationCoordinator> | null = null;
  const ready = runRuntimeSourceInvalidationCoordinatorEffect(
    Effect.gen(function* () {
      const timerScope = yield* Scope.make("sequential");
      coordinator = createSourceInvalidationCoordinator({ ...options, timerScope });
      yield* coordinator.start();
    }),
  ).catch(async (error) => {
    if (coordinator) {
      await runRuntimeSourceInvalidationCoordinatorEffect(coordinator.close());
    }
    throw error;
  });

  return {
    classifyHint: async (input) => {
      await ready;
      if (!coordinator) {
        throw new Error("Source invalidation coordinator is not initialized.");
      }
      return await runRuntimeSourceInvalidationCoordinatorEffect(coordinator.classifyHint(input));
    },
    close: async () => {
      try {
        await ready;
      } catch {
        // The coordinator may fail during startup; close still releases watcher resources.
      }
      if (coordinator) {
        await runRuntimeSourceInvalidationCoordinatorEffect(coordinator.close());
      }
    },
    reconcile: async (input) => {
      await ready;
      if (!coordinator) {
        throw new Error("Source invalidation coordinator is not initialized.");
      }
      return await runRuntimeSourceInvalidationCoordinatorEffect(coordinator.reconcile(input));
    },
    ready: () => ready,
    refreshWatchedInputs: async (reason) => {
      await ready;
      if (!coordinator) {
        throw new Error("Source invalidation coordinator is not initialized.");
      }
      await runRuntimeSourceInvalidationCoordinatorEffect(coordinator.refreshWatchedInputs(reason));
    },
    requestScan: async (request) => {
      await ready;
      if (!coordinator) {
        throw new Error("Source invalidation coordinator is not initialized.");
      }
      await runRuntimeSourceInvalidationCoordinatorEffect(coordinator.requestScan(request));
    },
  };
}

function runRuntimeSourceInvalidationCoordinatorEffect<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<A> {
  return Effect.runPromise(effect);
}
