import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RuntimeContractError, type RefreshGeneratedContextRequest } from "@svvy/core";

export interface RuntimeGeneratedContextRefreshHostPortService {
  refresh(input: RefreshGeneratedContextRequest): Promise<void>;
}

export interface RuntimeGeneratedContextRefreshHostPort {
  readonly _tag: "RuntimeGeneratedContextRefreshHostPort";
}

export const RuntimeGeneratedContextRefreshHostPort = Context.Service<
  RuntimeGeneratedContextRefreshHostPort,
  RuntimeGeneratedContextRefreshHostPortService
>("@svvy/runtime/RuntimeGeneratedContextRefreshHostPort");

export interface RuntimeGeneratedContextRefreshServiceService {
  refresh(input: RefreshGeneratedContextRequest): Effect.Effect<void, RuntimeContractError>;
}

export class RuntimeGeneratedContextRefreshService extends Context.Service<
  RuntimeGeneratedContextRefreshService,
  RuntimeGeneratedContextRefreshServiceService
>()("@svvy/runtime/RuntimeGeneratedContextRefreshService") {}

export const layerRuntimeGeneratedContextRefreshService = Layer.effect(
  RuntimeGeneratedContextRefreshService,
  Effect.gen(function* () {
    const host = yield* RuntimeGeneratedContextRefreshHostPort;
    return RuntimeGeneratedContextRefreshService.of({
      refresh: (input) =>
        Effect.tryPromise({
          try: () => host.refresh(input),
          catch: (cause: unknown) => runtimeGeneratedContextRefreshHostError(cause),
        }),
    });
  }),
);

function runtimeGeneratedContextRefreshHostError(cause: unknown): RuntimeContractError {
  if (cause instanceof RuntimeContractError) {
    return cause;
  }
  return new RuntimeContractError({
    operation: "runtime.sourceInvalidation.refreshGeneratedContext",
    reason: "state-conflict",
    message: cause instanceof Error ? cause.message : "Runtime generated-context refresh failed.",
    cause,
  });
}
