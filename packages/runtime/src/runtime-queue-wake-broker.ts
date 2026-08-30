import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RuntimeContractError, type PromptTarget, type WorkspaceId } from "@svvy/core";
import type { RuntimeSurfaceQueueWakeReason } from "./runtime-surface-queue-wake-port";

type RuntimeQueueWakeHint = {
  readonly workspaceId: WorkspaceId;
  readonly target: PromptTarget;
  readonly reason: string;
};

export interface RuntimeQueueWakeBrokerService {
  register(input: {
    readonly acceptWakeHint: (
      input: RuntimeQueueWakeHint,
    ) => Effect.Effect<void, RuntimeContractError>;
  }): Effect.Effect<void>;
  wakeSurface(input: {
    readonly workspaceId: WorkspaceId;
    readonly target: PromptTarget;
    readonly reason: RuntimeSurfaceQueueWakeReason;
  }): Effect.Effect<void, RuntimeContractError>;
}

export class RuntimeQueueWakeBroker extends Context.Service<
  RuntimeQueueWakeBroker,
  RuntimeQueueWakeBrokerService
>()("@svvy/runtime/RuntimeQueueWakeBroker") {}

export const layerRuntimeQueueWakeBroker = Layer.effect(
  RuntimeQueueWakeBroker,
  Effect.sync(() => {
    let acceptWakeHint:
      | ((input: RuntimeQueueWakeHint) => Effect.Effect<void, RuntimeContractError>)
      | undefined;

    return RuntimeQueueWakeBroker.of({
      register: (input) =>
        Effect.sync(() => {
          acceptWakeHint = input.acceptWakeHint;
        }),
      wakeSurface: (input) => {
        if (!acceptWakeHint) {
          return Effect.fail(
            new RuntimeContractError({
              operation: "runtime.queueWake.broker",
              reason: "target-not-ready",
              message: "The runtime surface queue wake dispatcher is not registered.",
            }),
          );
        }
        return acceptWakeHint(input);
      },
    });
  }),
);
