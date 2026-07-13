import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import {
  layerRuntimeExtensionSourceCoordinator,
  RuntimeExtensionSourceCoordinator,
} from "./runtime-extension-source-coordinator";

describe("RuntimeExtensionSourceCoordinator", () => {
  it.effect("admits only one complete extension source transaction at a time", () => {
    const operations: string[] = [];
    return Effect.gen(function* () {
      const firstEntered = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const coordinator = yield* RuntimeExtensionSourceCoordinator;
      const first = yield* Effect.forkChild(
        coordinator.serialized(
          Effect.gen(function* () {
            operations.push("first:entered");
            yield* Deferred.succeed(firstEntered, undefined);
            yield* Deferred.await(releaseFirst);
            operations.push("first:finished");
          }),
        ),
      );
      yield* Deferred.await(firstEntered);
      const second = yield* Effect.forkChild(
        coordinator.serialized(
          Effect.sync(() => {
            operations.push("second:entered");
          }),
        ),
      );
      yield* Effect.yieldNow;

      assert.deepStrictEqual(operations, ["first:entered"]);
      yield* Deferred.succeed(releaseFirst, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      assert.deepStrictEqual(operations, ["first:entered", "first:finished", "second:entered"]);
    }).pipe(Effect.provide(layerRuntimeExtensionSourceCoordinator));
  });

  it.effect("releases the app-global permit when a transaction is interrupted", () => {
    let secondEntered = false;
    return Effect.gen(function* () {
      const firstEntered = yield* Deferred.make<void>();
      const coordinator = yield* RuntimeExtensionSourceCoordinator;
      const first = yield* Effect.forkChild(
        coordinator.serialized(
          Deferred.succeed(firstEntered, undefined).pipe(Effect.andThen(Effect.never)),
        ),
      );
      yield* Deferred.await(firstEntered);
      const second = yield* Effect.forkChild(
        coordinator.serialized(
          Effect.sync(() => {
            secondEntered = true;
          }),
        ),
      );
      yield* Effect.yieldNow;

      assert.isFalse(secondEntered);
      yield* Fiber.interrupt(first);
      yield* Fiber.join(second);
      assert.isTrue(secondEntered);
    }).pipe(Effect.provide(layerRuntimeExtensionSourceCoordinator));
  });
});
