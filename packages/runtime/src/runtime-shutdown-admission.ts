import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import { RuntimeContractError } from "@svvy/core";
import type { RuntimeLayerError, RuntimePrepareShutdownResult } from "./runtime-layer-config";

export interface RuntimeShutdownAdmissionService {
  readonly isShutdownStarted: () => boolean;
  readonly assertAccepting: (operation: string) => Effect.Effect<void, RuntimeContractError>;
  readonly withAdmission: <A, E, R>(
    operation: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | RuntimeContractError, R>;
  readonly runShutdown: (
    effect: Effect.Effect<RuntimePrepareShutdownResult, RuntimeLayerError>,
  ) => Effect.Effect<RuntimePrepareShutdownResult, RuntimeLayerError>;
}

export class RuntimeShutdownAdmission extends Context.Service<
  RuntimeShutdownAdmission,
  RuntimeShutdownAdmissionService
>()("@svvy/runtime/RuntimeShutdownAdmission") {}

export const layerRuntimeShutdownAdmission = Layer.effect(
  RuntimeShutdownAdmission,
  Effect.gen(function* () {
    const admissionLane = yield* Semaphore.make(1);
    const shutdownResult =
      yield* Deferred.make<Exit.Exit<RuntimePrepareShutdownResult, RuntimeLayerError>>();
    let shutdownStarted = false;
    let activeAdmissions = 0;
    let activeAdmissionsDrained: Deferred.Deferred<void> | null = null;

    const awaitShutdownResult = Deferred.await(shutdownResult).pipe(
      Effect.flatMap((result) =>
        Exit.match(result, {
          onSuccess: Effect.succeed,
          onFailure: Effect.failCause,
        }),
      ),
    );

    const assertAccepting = (operation: string) =>
      admissionLane.withPermit(
        Effect.suspend(() =>
          shutdownStarted ? Effect.fail(runtimeShutdownError(operation)) : Effect.void,
        ),
      );

    return RuntimeShutdownAdmission.of({
      isShutdownStarted: () => shutdownStarted,
      assertAccepting,
      withAdmission: (operation, effect) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const nextDrain = yield* Deferred.make<void>();
            yield* admissionLane.withPermit(
              Effect.suspend(() => {
                if (shutdownStarted) {
                  return Effect.fail(runtimeShutdownError(operation));
                }
                if (activeAdmissions === 0) {
                  activeAdmissionsDrained = nextDrain;
                }
                activeAdmissions += 1;
                return Effect.void;
              }),
            );
            return yield* restore(effect).pipe(
              Effect.ensuring(
                admissionLane.withPermit(
                  Effect.gen(function* () {
                    activeAdmissions -= 1;
                    if (activeAdmissions === 0 && activeAdmissionsDrained) {
                      yield* Deferred.succeed(activeAdmissionsDrained, undefined);
                    }
                  }),
                ),
              ),
            );
          }),
        ),
      runShutdown: (effect) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const leadership = yield* admissionLane.withPermit(
              Effect.sync(() => {
                if (shutdownStarted) {
                  return { leadsShutdown: false, drain: null } as const;
                }
                shutdownStarted = true;
                return {
                  leadsShutdown: true,
                  drain: activeAdmissions > 0 ? activeAdmissionsDrained : null,
                } as const;
              }),
            );
            if (!leadership.leadsShutdown) {
              return yield* restore(awaitShutdownResult);
            }

            if (leadership.drain) {
              yield* Deferred.await(leadership.drain);
            }
            const result = yield* Effect.exit(restore(effect));
            const completed = yield* Deferred.succeed(shutdownResult, result);
            if (!completed) {
              return yield* Effect.die(
                "Runtime shutdown admission completed its single-use receipt more than once.",
              );
            }
            return yield* awaitShutdownResult;
          }),
        ),
    });
  }),
);

function runtimeShutdownError(operation: string): RuntimeContractError {
  return new RuntimeContractError({
    operation,
    reason: "runtime-shutdown",
    message: "Runtime shutdown has started and no longer accepts new work.",
  });
}
