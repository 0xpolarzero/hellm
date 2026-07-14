import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import {
  RuntimeContractError,
  type AppLogEntryId,
  type AppLogWritePortService,
  type PromptTarget,
  type StateInvalidationDescriptor,
  type WorkspaceId,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";
import {
  createRuntimeQueueDrainWakeCoordinator,
  persistRuntimeQueueDrainFailure,
} from "./runtime-surface-queue-dispatcher-service";

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
        onDrainFailure: () => Effect.die("unexpected drain failure"),
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

  it.effect("persists and publishes exactly one durable error for a failed drain", () =>
    Effect.gen(function* () {
      const workspaceId = "workspace_queue_drain" as WorkspaceId;
      const target = {
        workspaceSessionId: "session_queue_drain",
        surface: "orchestrator",
        surfacePiSessionId: "surface_queue_drain",
      } as PromptTarget;
      const invalidation = {
        scope: "workspace",
        workspaceId,
        invalidation: { model: "appLogs" },
      } satisfies StateInvalidationDescriptor;
      const cause = new Error("generated context refresh failed");
      const failure = new RuntimeContractError({
        operation: "runtime.generatedContext.refresh",
        reason: "target-not-ready",
        message: "Generated context is not ready.",
        cause,
      });
      const logged: Array<Parameters<AppLogWritePortService["append"]>[0]> = [];
      const published: Array<readonly StateInvalidationDescriptor[]> = [];
      const failurePersisted = yield* Deferred.make<void>();
      let drainRuns = 0;
      const appLog: AppLogWritePortService = {
        append: (entry) =>
          Effect.sync(() => {
            logged.push(entry);
            return {
              value: { appLogEntryId: "app-log-queue-drain" as AppLogEntryId },
              afterCommit: [invalidation],
            };
          }),
      };
      const eventBus = RuntimeEventBus.of({
        publishLive: () => Effect.die("unused"),
        publishStateInvalidations: ({ afterCommit }) =>
          Effect.sync(() => {
            published.push(afterCommit);
            return [];
          }),
        subscribe: () => Effect.die("unused"),
      });
      const coordinator = createRuntimeQueueDrainWakeCoordinator({
        key: (request: { workspaceId: WorkspaceId; target: PromptTarget; reason: string }) =>
          `${request.workspaceId}:${request.target.surfacePiSessionId}`,
        isClosed: () => false,
        drain: () =>
          Effect.sync(() => {
            drainRuns += 1;
          }).pipe(Effect.andThen(Effect.fail(failure))),
        onDrainFailure: ({ request, error }) =>
          persistRuntimeQueueDrainFailure({ request, error, appLog, eventBus }).pipe(
            Effect.tap(() => Deferred.succeed(failurePersisted, undefined)),
          ),
      });

      yield* coordinator.acceptWakeHint({
        workspaceId,
        target,
        reason: "message-submitted",
      });
      yield* Deferred.await(failurePersisted);
      yield* Effect.yieldNow;

      assert.strictEqual(drainRuns, 1);
      assert.strictEqual(logged.length, 1);
      assert.strictEqual(logged[0]?.workspaceId, workspaceId);
      assert.strictEqual(logged[0]?.message, failure.message);
      assert.deepStrictEqual(logged[0]?.details, {
        workspaceId,
        workspaceSessionId: target.workspaceSessionId,
        surfacePiSessionId: target.surfacePiSessionId,
        surfaceKind: target.surface,
        wakeReason: "message-submitted",
        runtimeOperation: failure.operation,
        runtimeReason: failure.reason,
      });
      assert.strictEqual(logged[0]?.normalizedError?.operation, failure.operation);
      assert.strictEqual(logged[0]?.normalizedError?.message, failure.message);
      assert.strictEqual(logged[0]?.normalizedError?.packageReason, failure.reason);
      assert.strictEqual(logged[0]?.normalizedError?.cause, cause);
      assert.deepStrictEqual(logged[0]?.related, [
        { kind: "workspace-session", id: target.workspaceSessionId },
        { kind: "surface", id: target.surfacePiSessionId },
      ]);
      assert.deepStrictEqual(published, [[invalidation]]);
    }),
  );

  it.effect("does not persist a queue-drain error after a successful drain", () =>
    Effect.gen(function* () {
      const drainCompleted = yield* Deferred.make<void>();
      let loggedFailures = 0;
      const coordinator = createRuntimeQueueDrainWakeCoordinator<string>({
        key: (request) => request,
        isClosed: () => false,
        drain: () => Deferred.succeed(drainCompleted, undefined).pipe(Effect.as(false)),
        onDrainFailure: () =>
          Effect.sync(() => {
            loggedFailures += 1;
          }),
      });

      yield* coordinator.acceptWakeHint("surface-1");
      yield* Deferred.await(drainCompleted);
      yield* Effect.yieldNow;

      assert.strictEqual(loggedFailures, 0);
    }),
  );
});
