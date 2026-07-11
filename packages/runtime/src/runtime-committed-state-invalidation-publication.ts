import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RuntimeContractError, type StateInvalidationDescriptor } from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";

export interface RuntimeCommittedStateInvalidationPublicationService {
  publish(input: {
    readonly afterCommit: readonly StateInvalidationDescriptor[];
  }): Effect.Effect<void, RuntimeContractError>;
}

export class RuntimeCommittedStateInvalidationPublication extends Context.Service<
  RuntimeCommittedStateInvalidationPublication,
  RuntimeCommittedStateInvalidationPublicationService
>()("@svvy/runtime/RuntimeCommittedStateInvalidationPublication") {}

export const layerRuntimeCommittedStateInvalidationPublication = Layer.effect(
  RuntimeCommittedStateInvalidationPublication,
  Effect.gen(function* () {
    const eventBus = yield* RuntimeEventBus;
    return RuntimeCommittedStateInvalidationPublication.of({
      publish: ({ afterCommit }) =>
        afterCommit.length === 0
          ? Effect.void
          : eventBus.publishStateInvalidations({ afterCommit }).pipe(
              Effect.asVoid,
              Effect.mapError(
                (cause) =>
                  new RuntimeContractError({
                    operation: "runtime.stateInvalidations.publishCommitted",
                    reason: "dependency-not-ready",
                    message:
                      "Committed state changed, but its read-model invalidations could not be published.",
                    cause,
                  }),
              ),
            ),
    });
  }),
);
