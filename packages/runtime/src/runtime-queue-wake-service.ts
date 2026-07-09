import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RuntimeContractError, type PromptTarget } from "@svvy/core";
import type { RuntimeSurfaceQueueWakeReason } from "./runtime-surface-queue-wake-port";
import { RuntimeSurfaceQueueDispatcherService } from "./runtime-surface-queue-dispatcher-service";

export interface RuntimeQueueWakeServiceService {
  wakeSurface(input: {
    readonly target: PromptTarget;
    readonly reason: RuntimeSurfaceQueueWakeReason;
  }): Effect.Effect<void, RuntimeContractError>;
}

export class RuntimeQueueWakeService extends Context.Service<
  RuntimeQueueWakeService,
  RuntimeQueueWakeServiceService
>()("@svvy/runtime/RuntimeQueueWakeService") {}

export const layerRuntimeQueueWakeService = Layer.effect(
  RuntimeQueueWakeService,
  Effect.gen(function* () {
    const dispatcher = yield* RuntimeSurfaceQueueDispatcherService;
    return RuntimeQueueWakeService.of({
      wakeSurface: (input) =>
        dispatcher
          .acceptWakeHint({
            workspaceId: input.target.workspaceSessionId as never,
            target: input.target,
            reason: input.reason,
          })
          .pipe(
            Effect.mapError((cause) =>
              cause instanceof RuntimeContractError
                ? cause
                : new RuntimeContractError({
                    operation: "runtime.queueWake.wakeSurface",
                    reason: "stale-state",
                    message: "Runtime surface queue wake failed.",
                    cause,
                  }),
            ),
          ),
    });
  }),
);
