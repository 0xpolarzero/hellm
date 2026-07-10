import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeContractError,
  type StateInvalidationDescriptor,
  type WorkspaceId,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";

export interface RuntimeAppLogCommitNotificationInput {
  readonly workspaceId?: WorkspaceId;
}

export interface RuntimeAppLogCommitNotificationService {
  notifyCommittedAppend(
    input: RuntimeAppLogCommitNotificationInput,
  ): Effect.Effect<void, RuntimeContractError>;
}

export class RuntimeAppLogCommitNotification extends Context.Service<
  RuntimeAppLogCommitNotification,
  RuntimeAppLogCommitNotificationService
>()("@svvy/runtime/RuntimeAppLogCommitNotification") {}

export const layerRuntimeAppLogCommitNotification = Layer.effect(
  RuntimeAppLogCommitNotification,
  Effect.gen(function* () {
    const eventBus = yield* RuntimeEventBus;
    return RuntimeAppLogCommitNotification.of({
      notifyCommittedAppend: (input) => {
        const descriptor: StateInvalidationDescriptor = input.workspaceId
          ? {
              scope: "workspace",
              workspaceId: input.workspaceId,
              invalidation: { model: "appLogs" },
            }
          : { scope: "app", invalidation: { model: "appLogs" } };
        return eventBus.publishStateInvalidations({ afterCommit: [descriptor] }).pipe(
          Effect.asVoid,
          Effect.mapError(
            (cause) =>
              new RuntimeContractError({
                operation: "runtime.appLogs.notifyCommittedAppend",
                reason: "state-conflict",
                message: cause.message,
                cause,
              }),
          ),
        );
      },
    });
  }),
);
