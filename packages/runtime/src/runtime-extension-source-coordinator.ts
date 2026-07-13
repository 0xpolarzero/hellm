import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";

export interface RuntimeExtensionSourceCoordinatorService {
  serialized<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
}

export class RuntimeExtensionSourceCoordinator extends Context.Service<
  RuntimeExtensionSourceCoordinator,
  RuntimeExtensionSourceCoordinatorService
>()("@svvy/runtime/RuntimeExtensionSourceCoordinator") {}

export const layerRuntimeExtensionSourceCoordinator = Layer.effect(
  RuntimeExtensionSourceCoordinator,
  Semaphore.make(1).pipe(
    Effect.map((lane) =>
      RuntimeExtensionSourceCoordinator.of({
        serialized: (effect) => lane.withPermit(effect),
      }),
    ),
  ),
);
