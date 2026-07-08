import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  StateCommandPostCommitNotificationPort,
  type StateCommandPostCommitNotificationError,
  type StateCommandPostCommitNotificationInput,
  type StateCommandPostCommitNotificationResult,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";

export const layerStateCommandPostCommitNotificationPort = Layer.effect(
  StateCommandPostCommitNotificationPort,
  Effect.gen(function* () {
    const eventBus = yield* RuntimeEventBus;
    return {
      notifyCommittedStateCommand: (input) =>
        eventBus.publishStateInvalidations({ afterCommit: input.descriptors }).pipe(
          Effect.map(
            (): StateCommandPostCommitNotificationResult => ({
              receipt: input.receipt,
              acceptedDescriptorCount: input.descriptors.length,
              rebaselineRequired: false,
            }),
          ),
          Effect.mapError((cause) => stateCommandPostCommitNotificationError(input, cause)),
        ),
    };
  }),
);

function stateCommandPostCommitNotificationError(
  input: StateCommandPostCommitNotificationInput,
  cause: unknown,
): StateCommandPostCommitNotificationError {
  return {
    type: "state-command-post-commit-notification-error",
    operation: input.operation,
    reason: "publication-failed",
    receipt: input.receipt,
    message: cause instanceof Error ? cause.message : String(cause),
    affectedReadModels: input.descriptors,
  };
}
