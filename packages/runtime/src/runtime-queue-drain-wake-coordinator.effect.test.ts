import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { createRuntimeQueueDrainWakeCoordinator } from "./runtime-surface-queue-dispatcher-service";

describe("runtime queue drain wake coordinator", () => {
  it.effect("reruns once when wake hints arrive during an active drain", () =>
    Effect.gen(function* () {
      const firstDrainEntered = yield* Deferred.make<void>();
      const allowFirstDrain = yield* Deferred.make<void>();
      const rerunEntered = yield* Deferred.make<void>();
      let drainRuns = 0;
      const coordinator = createRuntimeQueueDrainWakeCoordinator<string>({
        key: (request) => request,
        isClosed: () => false,
        drain: () =>
          Effect.gen(function* () {
            drainRuns += 1;
            if (drainRuns === 1) {
              yield* Deferred.succeed(firstDrainEntered, undefined);
              yield* Deferred.await(allowFirstDrain);
            } else {
              yield* Deferred.succeed(rerunEntered, undefined);
            }
            return false;
          }),
      });

      yield* coordinator.acceptWakeHint("surface-1");
      yield* Deferred.await(firstDrainEntered);
      yield* coordinator.acceptWakeHint("surface-1");
      yield* coordinator.acceptWakeHint("surface-1");
      yield* Deferred.succeed(allowFirstDrain, undefined);
      yield* Deferred.await(rerunEntered);
      yield* Effect.yieldNow;

      assert.strictEqual(drainRuns, 2);
    }),
  );
});
