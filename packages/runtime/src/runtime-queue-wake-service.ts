import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RuntimeContractError, RuntimeWorkspaceStatePort } from "@svvy/core";
import { RuntimeQueueWakeService } from "./runtime-queue-wake-port";
import { RuntimeQueueWakeBroker } from "./runtime-queue-wake-broker";
import { RuntimeShutdownAdmission } from "./runtime-shutdown-admission";

export { RuntimeQueueWakeService } from "./runtime-queue-wake-port";
export type { RuntimeQueueWakeServiceService } from "./runtime-queue-wake-port";

export const layerRuntimeQueueWakeService = Layer.effect(
  RuntimeQueueWakeService,
  Effect.gen(function* () {
    const broker = yield* RuntimeQueueWakeBroker;
    const workspaceState = yield* RuntimeWorkspaceStatePort;
    const shutdownAdmission = yield* RuntimeShutdownAdmission;
    return RuntimeQueueWakeService.of({
      wakeSurface: (input) =>
        shutdownAdmission.assertAccepting("runtime.queueWake.wakeSurface").pipe(
          Effect.andThen(workspaceState.resolvePromptTargetWorkspaceId({ target: input.target })),
          Effect.flatMap((workspaceId) =>
            broker.wakeSurface({
              workspaceId,
              target: input.target,
              reason: input.reason,
            }),
          ),
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
