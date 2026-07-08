import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeContractError,
  RuntimePromptDefaultsStatePort,
  type PromptTarget,
  type RuntimePromptDefaultsRecord,
} from "@svvy/core";

export interface RuntimePromptDefaultsServiceService {
  resolve(input: {
    readonly target: PromptTarget;
  }): Effect.Effect<RuntimePromptDefaultsRecord, RuntimeContractError>;
}

export class RuntimePromptDefaultsService extends Context.Service<
  RuntimePromptDefaultsService,
  RuntimePromptDefaultsServiceService
>()("@svvy/runtime/RuntimePromptDefaultsService") {}

export const layerRuntimePromptDefaultsService = Layer.effect(
  RuntimePromptDefaultsService,
  Effect.gen(function* () {
    const state = yield* RuntimePromptDefaultsStatePort;
    return RuntimePromptDefaultsService.of({
      resolve: (input) =>
        state.resolvePromptDefaults(input).pipe(
          Effect.mapError(
            (cause) =>
              new RuntimeContractError({
                operation: "runtime.promptDefaults.resolve",
                reason: "stale-state",
                message: cause.message,
                cause,
              }),
          ),
        ),
    });
  }),
);
