import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import {
  RuntimeShutdownAdmission,
  layerRuntimeShutdownAdmission,
} from "./runtime-shutdown-admission";

const shutdownReceipt = {
  status: "drained" as const,
  interruptedTurns: 0,
  interruptedCommands: 0,
  releasedQueueClaims: 0,
  recoveryRowsScheduled: 0,
};

describe("RuntimeShutdownAdmission", () => {
  it.effect("closes admission once and coalesces concurrent and repeated shutdown calls", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const admission = yield* RuntimeShutdownAdmission;
        const shutdownEntered = yield* Deferred.make<void>();
        const allowShutdown = yield* Deferred.make<void>();
        let shutdownRuns = 0;

        const first = yield* admission
          .runShutdown(
            Effect.gen(function* () {
              shutdownRuns += 1;
              yield* Deferred.succeed(shutdownEntered, undefined);
              yield* Deferred.await(allowShutdown);
              return shutdownReceipt;
            }),
          )
          .pipe(Effect.forkScoped);
        yield* Deferred.await(shutdownEntered);

        const rejected = yield* admission
          .assertAccepting("runtime.test.lateCall")
          .pipe(Effect.flip);
        assert.strictEqual(rejected.reason, "runtime-shutdown");

        const second = yield* admission
          .runShutdown(Effect.die("a concurrent shutdown must not start another drain"))
          .pipe(Effect.forkScoped);
        yield* Deferred.succeed(allowShutdown, undefined);

        const firstResult = yield* Fiber.join(first);
        const secondResult = yield* Fiber.join(second);
        const repeatedResult = yield* admission.runShutdown(
          Effect.die("a repeated shutdown must reuse the completed receipt"),
        );

        assert.strictEqual(shutdownRuns, 1);
        assert.strictEqual(firstResult, secondResult);
        assert.strictEqual(firstResult, repeatedResult);
        assert.deepStrictEqual(firstResult, shutdownReceipt);
      }),
    ).pipe(Effect.provide(layerRuntimeShutdownAdmission)),
  );

  it.effect("closes admission immediately and waits for already admitted work", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const admission = yield* RuntimeShutdownAdmission;
        const claimEntered = yield* Deferred.make<void>();
        const allowClaim = yield* Deferred.make<void>();
        let lateClaimRan = false;
        let shutdownDrainRan = false;

        const claim = yield* admission
          .withAdmission(
            "runtime.queue.dispatch.claimNext",
            Deferred.succeed(claimEntered, undefined).pipe(
              Effect.andThen(Deferred.await(allowClaim)),
            ),
          )
          .pipe(Effect.forkScoped);
        yield* Deferred.await(claimEntered);

        const shutdown = yield* admission
          .runShutdown(
            Effect.sync(() => {
              shutdownDrainRan = true;
              return shutdownReceipt;
            }),
          )
          .pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        assert.isTrue(admission.isShutdownStarted());
        assert.isFalse(shutdownDrainRan);
        const rejected = yield* admission
          .withAdmission(
            "runtime.queue.dispatch.claimNext",
            Effect.sync(() => {
              lateClaimRan = true;
            }),
          )
          .pipe(Effect.flip);
        assert.strictEqual(rejected.reason, "runtime-shutdown");
        assert.isFalse(lateClaimRan);

        yield* Deferred.succeed(allowClaim, undefined);
        yield* Fiber.join(claim);
        yield* Fiber.join(shutdown);
        assert.isTrue(shutdownDrainRan);
        assert.isTrue(admission.isShutdownStarted());
      }),
    ).pipe(Effect.provide(layerRuntimeShutdownAdmission)),
  );

  it.effect("completes the shared outcome when the leading shutdown caller is interrupted", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const admission = yield* RuntimeShutdownAdmission;
        const shutdownEntered = yield* Deferred.make<void>();
        const leader = yield* admission
          .runShutdown(
            Deferred.succeed(shutdownEntered, undefined).pipe(
              Effect.andThen(Effect.sleep(60_000)),
              Effect.as(shutdownReceipt),
            ),
          )
          .pipe(Effect.forkScoped);
        yield* Deferred.await(shutdownEntered);
        const follower = yield* admission
          .runShutdown(Effect.die("the follower must await the leading shutdown outcome"))
          .pipe(Effect.forkScoped);
        yield* Effect.yieldNow;

        yield* Fiber.interrupt(leader);
        const followerExit = yield* Fiber.join(follower).pipe(Effect.exit);
        const repeatedExit = yield* admission
          .runShutdown(Effect.die("the repeated call must reuse the interrupted outcome"))
          .pipe(Effect.exit);

        assert.isTrue(Exit.isFailure(followerExit));
        assert.isTrue(Exit.isFailure(repeatedExit));
        if (Exit.isFailure(followerExit) && Exit.isFailure(repeatedExit)) {
          assert.isTrue(Cause.hasInterruptsOnly(followerExit.cause));
          assert.isTrue(Cause.hasInterruptsOnly(repeatedExit.cause));
        }
      }),
    ).pipe(Effect.provide(layerRuntimeShutdownAdmission)),
  );

  it.effect("tracks concurrent admitted work without serializing it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const admission = yield* RuntimeShutdownAdmission;
        const firstEntered = yield* Deferred.make<void>();
        const secondEntered = yield* Deferred.make<void>();
        const allowBoth = yield* Deferred.make<void>();

        const first = yield* admission
          .withAdmission(
            "runtime.test.first",
            Deferred.succeed(firstEntered, undefined).pipe(
              Effect.andThen(Deferred.await(allowBoth)),
            ),
          )
          .pipe(Effect.forkScoped);
        const second = yield* admission
          .withAdmission(
            "runtime.test.second",
            Deferred.succeed(secondEntered, undefined).pipe(
              Effect.andThen(Deferred.await(allowBoth)),
            ),
          )
          .pipe(Effect.forkScoped);

        yield* Deferred.await(firstEntered);
        yield* Deferred.await(secondEntered);
        const shutdown = yield* admission
          .runShutdown(Effect.succeed(shutdownReceipt))
          .pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        assert.isTrue(admission.isShutdownStarted());

        yield* Deferred.succeed(allowBoth, undefined);
        yield* Fiber.join(first);
        yield* Fiber.join(second);
        assert.deepStrictEqual(yield* Fiber.join(shutdown), shutdownReceipt);
      }),
    ).pipe(Effect.provide(layerRuntimeShutdownAdmission)),
  );
});
