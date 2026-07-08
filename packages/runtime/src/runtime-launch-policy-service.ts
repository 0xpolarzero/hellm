import { Sandbox } from "@svvy/sandbox";
import {
  RuntimeContractError,
  type BuildLaunchPolicyInput,
  type SandboxLaunchFacts,
} from "@svvy/core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";

export interface RuntimeLaunchPolicyServiceService {
  build(
    input: BuildLaunchPolicyInput,
  ): Effect.Effect<SandboxLaunchFacts, RuntimeContractError, Scope.Scope>;
}

export class RuntimeLaunchPolicyService extends Context.Service<
  RuntimeLaunchPolicyService,
  RuntimeLaunchPolicyServiceService
>()("@svvy/runtime/RuntimeLaunchPolicyService") {}

export const layerRuntimeLaunchPolicyService = Layer.effect(
  RuntimeLaunchPolicyService,
  Effect.gen(function* () {
    const sandbox = yield* Sandbox;

    return RuntimeLaunchPolicyService.of({
      build: Effect.fn("@svvy/runtime/launchPolicy.build")(function* (input) {
        return yield* sandbox.buildLaunchPolicy(input).pipe(
          Effect.mapError(
            (cause) =>
              new RuntimeContractError({
                operation: "runtime.launchPolicy.build",
                reason:
                  cause.reason === "helper-unavailable" ? "target-not-ready" : "state-conflict",
                message: cause.message,
                cause,
              }),
          ),
        );
      }),
    });
  }),
);
