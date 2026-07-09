import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import {
  RuntimeEventRebaselineRequired,
  type RuntimeEvent,
  type RuntimeEventGenerationId,
  type RuntimeEventSequence,
  type WorkspaceId,
} from "@svvy/core";
import {
  makeRuntimeEventBus,
  type RuntimeEventDraft,
  type RuntimeEventBusOptions,
  type RuntimeEventSubscriptionEffect,
} from "./runtime-event-bus";
import {
  createRuntimeLayerConfigLayer,
  defaultRuntimeLayerConfig,
  type RuntimeLayerConfig,
} from "./runtime-layer-config";

const workspaceA = "workspace_runtime_events_a" as WorkspaceId;
const workspaceB = "workspace_runtime_events_b" as WorkspaceId;
const runtimeEventSequence = (value: number) => value as RuntimeEventSequence;
type RuntimeEventBusConfigOverrides = Partial<
  Pick<RuntimeLayerConfig, "eventReplayCapacity" | "eventSubscriberBufferCapacity">
>;

function makeConfiguredRuntimeEventBus(
  configOverrides: RuntimeEventBusConfigOverrides = {},
  options: RuntimeEventBusOptions = {},
) {
  return makeRuntimeEventBus(options).pipe(
    Effect.provide(
      createRuntimeLayerConfigLayer({
        ...defaultRuntimeLayerConfig,
        ...configOverrides,
      }),
    ),
  );
}

function collectEvents(
  busEvents: Effect.Effect<RuntimeEventSubscriptionEffect, unknown>,
  count: number,
): Effect.Effect<RuntimeEvent[], unknown> {
  return Effect.gen(function* () {
    const subscription = yield* busEvents;
    return yield* subscription.stream.pipe(
      Stream.take(count),
      Stream.runCollect,
      Effect.map((chunk) => Array.from(chunk)),
    );
  });
}

describe("runtime event bus", () => {
  it.effect("assigns app-wide sequences and replays retained events after a cursor", () =>
    Effect.gen(function* () {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const bus = yield* makeConfiguredRuntimeEventBus({ eventReplayCapacity: 2 });
          yield* bus.publishLive({ event: appInvalidation("extensions") });
          yield* bus.publishLive({ event: workspaceInvalidation(workspaceA) });
          return yield* collectEvents(bus.subscribe({ afterSequence: runtimeEventSequence(0) }), 2);
        }),
      );
      assert.deepStrictEqual(result.map(eventSummary), [
        { type: "app_read_model.changed", sequence: runtimeEventSequence(1), workspaceId: null },
        {
          type: "workspace_read_model.changed",
          sequence: runtimeEventSequence(2),
          workspaceId: workspaceA,
        },
      ]);
    }),
  );

  it.effect(
    "filters replay and live events by workspace while optionally retaining app events",
    () =>
      Effect.gen(function* () {
        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const bus = yield* makeConfiguredRuntimeEventBus({ eventReplayCapacity: 4 });
            yield* bus.publishLive({ event: appInvalidation("extensions") });
            yield* bus.publishLive({ event: workspaceInvalidation(workspaceA) });
            yield* bus.publishLive({ event: workspaceInvalidation(workspaceB) });
            return yield* collectEvents(
              bus.subscribe({
                workspaceId: workspaceA,
                includeAppEvents: true,
                afterSequence: runtimeEventSequence(0),
              }),
              2,
            );
          }),
        );
        assert.deepStrictEqual(result.map(eventSummary), [
          {
            type: "app_read_model.changed",
            sequence: runtimeEventSequence(1),
            workspaceId: null,
          },
          {
            type: "workspace_read_model.changed",
            sequence: runtimeEventSequence(2),
            workspaceId: workspaceA,
          },
        ]);
      }),
  );

  it.effect("fails stale replay cursors with a typed rebaseline error", () =>
    Effect.gen(function* () {
      const eventGenerationId = "runtime-events-generation-test" as RuntimeEventGenerationId;
      const error = yield* Effect.scoped(
        Effect.gen(function* () {
          const bus = yield* makeConfiguredRuntimeEventBus(
            { eventReplayCapacity: 2 },
            { eventGenerationId },
          );
          yield* bus.publishLive({ event: appInvalidation("extensions") });
          yield* bus.publishLive({ event: workspaceInvalidation(workspaceA) });
          yield* bus.publishLive({ event: workspaceInvalidation(workspaceB) });
          return yield* collectEvents(bus.subscribe({ afterSequence: runtimeEventSequence(0) }), 1);
        }),
      ).pipe(Effect.flip);
      assert.instanceOf(error, RuntimeEventRebaselineRequired);
      assert.strictEqual(error.reason, "stale-cursor");
      assert.strictEqual(error.requestedAfterSequence, runtimeEventSequence(0));
      assert.strictEqual(error.retainedFromSequence, runtimeEventSequence(2));
      assert.strictEqual(error.currentHighWaterSequence, runtimeEventSequence(3));
      assert.strictEqual(error.eventGenerationId, eventGenerationId);
      assert.deepStrictEqual(error.affectedReadModels, []);
    }),
  );

  it.effect("fails mismatched event generations before exposing a stream", () =>
    Effect.gen(function* () {
      const eventGenerationId = "runtime-events-generation-current" as RuntimeEventGenerationId;
      const requestedGenerationId =
        "runtime-events-generation-previous" as RuntimeEventGenerationId;
      const error = yield* Effect.scoped(
        Effect.gen(function* () {
          const bus = yield* makeConfiguredRuntimeEventBus(
            { eventReplayCapacity: 2 },
            { eventGenerationId },
          );
          yield* bus.publishLive({ event: workspaceInvalidation(workspaceA) });
          return yield* collectEvents(
            bus.subscribe({
              workspaceId: workspaceA,
              eventGenerationId: requestedGenerationId,
              afterSequence: runtimeEventSequence(1),
            }),
            1,
          );
        }),
      ).pipe(Effect.flip);
      assert.instanceOf(error, RuntimeEventRebaselineRequired);
      assert.strictEqual(error.reason, "generation-changed");
      assert.strictEqual(error.requestedAfterSequence, runtimeEventSequence(1));
      assert.strictEqual(error.retainedFromSequence, runtimeEventSequence(1));
      assert.strictEqual(error.currentHighWaterSequence, runtimeEventSequence(1));
      assert.strictEqual(error.eventGenerationId, eventGenerationId);
      assert.strictEqual(error.workspaceId, workspaceA);
      assert.deepStrictEqual(error.affectedReadModels, []);
    }),
  );

  it.effect("uses a fresh runtime event generation id for each bus by default", () =>
    Effect.gen(function* () {
      const generationIds = yield* Effect.scoped(
        Effect.gen(function* () {
          const first = yield* makeConfiguredRuntimeEventBus({ eventReplayCapacity: 1 });
          const second = yield* makeConfiguredRuntimeEventBus({ eventReplayCapacity: 1 });
          yield* first.publishLive({ event: appInvalidation("extensions") });
          yield* first.publishLive({ event: appInvalidation("settings") });
          yield* second.publishLive({ event: appInvalidation("extensions") });
          yield* second.publishLive({ event: appInvalidation("settings") });
          const firstExit = yield* Effect.exit(
            first.subscribe({ afterSequence: runtimeEventSequence(0) }),
          );
          const secondExit = yield* Effect.exit(
            second.subscribe({ afterSequence: runtimeEventSequence(0) }),
          );
          if (Exit.isSuccess(firstExit) || Exit.isSuccess(secondExit)) {
            return yield* Effect.die("Expected both stale event subscriptions to fail.");
          }
          return [
            (firstExit.cause.reasons[0] as { error: RuntimeEventRebaselineRequired }).error
              .eventGenerationId,
            (secondExit.cause.reasons[0] as { error: RuntimeEventRebaselineRequired }).error
              .eventGenerationId,
          ];
        }),
      );

      assert.notStrictEqual(generationIds[0], generationIds[1]);
    }),
  );

  it.effect("releases subscriptions when replay validation fails", () =>
    Effect.gen(function* () {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const bus = yield* makeConfiguredRuntimeEventBus({
            eventReplayCapacity: 1,
            eventSubscriberBufferCapacity: 1,
          });
          yield* bus.publishLive({ event: appInvalidation("extensions") });
          yield* bus.publishLive({ event: workspaceInvalidation(workspaceA) });
          const staleSubscription = yield* Effect.exit(
            bus.subscribe({ afterSequence: runtimeEventSequence(0) }),
          );
          if (Exit.isSuccess(staleSubscription)) {
            return yield* Effect.die("Expected stale event subscription to fail.");
          }
          const third = yield* bus.publishLive({ event: appInvalidation("settings") });
          const fourth = yield* bus.publishLive({ event: workspaceInvalidation(workspaceB) });
          return [third.sequence, fourth.sequence];
        }),
      );
      assert.deepStrictEqual(result, [runtimeEventSequence(3), runtimeEventSequence(4)]);
    }),
  );

  it.effect("delivers live events to an active subscription", () =>
    Effect.gen(function* () {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const bus = yield* makeConfiguredRuntimeEventBus({ eventReplayCapacity: 2 });
          const fiber = yield* collectEvents(
            bus.subscribe({ afterSequence: runtimeEventSequence(0) }),
            2,
          ).pipe(Effect.forkScoped);
          yield* Effect.yieldNow;
          yield* bus.publishLive({ event: appInvalidation("extensions") });
          yield* bus.publishLive({ event: workspaceInvalidation(workspaceA) });
          return yield* Fiber.join(fiber);
        }),
      );
      assert.deepStrictEqual(result.map(eventSummary), [
        {
          type: "app_read_model.changed",
          sequence: runtimeEventSequence(1),
          workspaceId: null,
        },
        {
          type: "workspace_read_model.changed",
          sequence: runtimeEventSequence(2),
          workspaceId: workspaceA,
        },
      ]);
    }),
  );

  it.effect(
    "does not drop events published after subscribe returns but before stream consumption starts",
    () =>
      Effect.gen(function* () {
        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const bus = yield* makeConfiguredRuntimeEventBus({ eventReplayCapacity: 2 });
            const events = yield* bus.subscribe({ afterSequence: runtimeEventSequence(0) });
            yield* bus.publishLive({ event: appInvalidation("extensions") });
            return yield* events.stream.pipe(
              Stream.take(1),
              Stream.runCollect,
              Effect.map((chunk) => Array.from(chunk)),
            );
          }),
        );
        assert.deepStrictEqual(result.map(eventSummary), [
          {
            type: "app_read_model.changed",
            sequence: runtimeEventSequence(1),
            workspaceId: null,
          },
        ]);
      }),
  );

  it.effect("removes explicitly closed subscribers without stream consumption", () =>
    Effect.gen(function* () {
      const subscriberCounts: number[] = [];
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const bus = yield* makeConfiguredRuntimeEventBus(
            { eventReplayCapacity: 2 },
            {
              onSubscriberCountChange: (count) => {
                subscriberCounts.push(count);
              },
            },
          );
          const events = yield* bus.subscribe({ afterSequence: runtimeEventSequence(0) });
          yield* events.close();
          const close = yield* events.closed;
          return close;
        }),
      );

      assert.deepStrictEqual(subscriberCounts, [1, 0]);
      assert.deepStrictEqual(closeSummary(result), {
        reason: "closed",
        lastContiguousSequence: 0,
        rebaselineRequired: false,
      });
    }),
  );

  it.effect(
    "retains events for replay and closes slow subscribers before they miss sequences",
    () =>
      Effect.gen(function* () {
        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const bus = yield* makeConfiguredRuntimeEventBus({
              eventReplayCapacity: 4,
              eventSubscriberBufferCapacity: 1,
            });
            const slowSubscriber = yield* bus.subscribe({ afterSequence: runtimeEventSequence(0) });
            yield* bus.publishLive({ event: appInvalidation("extensions") });
            const secondPublish = yield* bus.publishLive({ event: appInvalidation("settings") });
            const slowClose = yield* slowSubscriber.closed;
            const replayed = yield* collectEvents(
              bus.subscribe({ afterSequence: runtimeEventSequence(0) }),
              2,
            );
            return { secondPublish, slowClose, replayed };
          }),
        );
        assert.deepStrictEqual(eventSummary(result.secondPublish), {
          type: "app_read_model.changed",
          sequence: runtimeEventSequence(2),
          workspaceId: null,
        });
        assert.deepStrictEqual(closeSummary(result.slowClose), {
          reason: "slow-consumer",
          lastContiguousSequence: 0,
          rebaselineRequired: true,
        });
        assert.deepStrictEqual(result.replayed.map(appEventSummary), [
          {
            type: "app_read_model.changed",
            sequence: runtimeEventSequence(1),
            invalidation: { model: "extensions" },
          },
          {
            type: "app_read_model.changed",
            sequence: runtimeEventSequence(2),
            invalidation: { model: "settings" },
          },
        ]);
      }),
  );

  it.effect("does not close subscribers for events outside their filter", () =>
    Effect.gen(function* () {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const bus = yield* makeConfiguredRuntimeEventBus({
            eventReplayCapacity: 4,
            eventSubscriberBufferCapacity: 1,
          });
          const events = yield* bus.subscribe({
            workspaceId: workspaceA,
            afterSequence: runtimeEventSequence(0),
          });
          const fiber = yield* events.stream.pipe(
            Stream.take(1),
            Stream.runCollect,
            Effect.map((chunk) => Array.from(chunk)),
            Effect.forkScoped,
          );
          yield* Effect.yieldNow;
          yield* bus.publishLive({ event: workspaceInvalidation(workspaceB) });
          yield* bus.publishLive({ event: workspaceInvalidation(workspaceB) });
          yield* bus.publishLive({ event: workspaceInvalidation(workspaceA) });
          const collected = yield* Fiber.join(fiber);
          yield* events.close();
          const close = yield* events.closed;
          return { collected, close };
        }),
      );
      assert.deepStrictEqual(result.collected.map(eventSummary), [
        {
          type: "workspace_read_model.changed",
          sequence: runtimeEventSequence(3),
          workspaceId: workspaceA,
        },
      ]);
      assert.deepStrictEqual(closeSummary(result.close), {
        reason: "closed",
        lastContiguousSequence: 3,
        rebaselineRequired: false,
      });
    }),
  );

  it.effect("publishes state invalidation descriptors as ordered runtime events", () =>
    Effect.gen(function* () {
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const bus = yield* makeConfiguredRuntimeEventBus({ eventReplayCapacity: 4 });
          const published = yield* bus.publishStateInvalidations({
            afterCommit: [
              { scope: "app", invalidation: { model: "settings" } },
              {
                scope: "workspace",
                workspaceId: workspaceA,
                invalidation: { model: "appLogs" },
              },
            ],
          });
          const replayed = yield* collectEvents(
            bus.subscribe({ afterSequence: runtimeEventSequence(0) }),
            2,
          );
          return { published, replayed };
        }),
      );
      assert.deepStrictEqual(result.published.map(stateEventSummary), [
        {
          type: "app_read_model.changed",
          sequence: runtimeEventSequence(1),
          workspaceId: null,
          invalidation: { model: "settings" },
        },
        {
          type: "workspace_read_model.changed",
          sequence: runtimeEventSequence(2),
          workspaceId: workspaceA,
          invalidation: { model: "appLogs" },
        },
      ]);
      assert.deepStrictEqual(result.replayed.map(stateEventSummary), [
        {
          type: "app_read_model.changed",
          sequence: runtimeEventSequence(1),
          workspaceId: null,
          invalidation: { model: "settings" },
        },
        {
          type: "workspace_read_model.changed",
          sequence: runtimeEventSequence(2),
          workspaceId: workspaceA,
          invalidation: { model: "appLogs" },
        },
      ]);
    }),
  );
});

function appInvalidation(model: "extensions" | "settings"): RuntimeEventDraft {
  return {
    type: "app_read_model.changed",
    invalidation: { model },
  };
}

function workspaceInvalidation(workspaceId: WorkspaceId): RuntimeEventDraft {
  return {
    type: "workspace_read_model.changed",
    workspaceId,
    invalidation: { model: "appLogs" },
  };
}

function eventSummary(event: RuntimeEvent) {
  return {
    type: event.type,
    sequence: event.sequence,
    workspaceId: event.type === "workspace_read_model.changed" ? event.workspaceId : null,
  };
}

function appEventSummary(event: RuntimeEvent) {
  if (event.type !== "app_read_model.changed") {
    throw new Error(`Expected app invalidation event, received ${event.type}`);
  }
  return {
    type: event.type,
    sequence: event.sequence,
    invalidation: event.invalidation,
  };
}

function stateEventSummary(event: RuntimeEvent) {
  if (event.type === "app_read_model.changed") {
    return {
      type: event.type,
      sequence: event.sequence,
      workspaceId: null,
      invalidation: event.invalidation,
    };
  }
  if (event.type === "workspace_read_model.changed") {
    return {
      type: event.type,
      sequence: event.sequence,
      workspaceId: event.workspaceId,
      invalidation: event.invalidation,
    };
  }
  throw new Error(`Expected state invalidation event, received ${event.type}`);
}

function closeSummary(close: {
  readonly reason: string;
  readonly lastContiguousSequence: number;
  readonly rebaselineRequired: boolean;
}) {
  return {
    reason: close.reason,
    lastContiguousSequence: close.lastContiguousSequence,
    rebaselineRequired: close.rebaselineRequired,
  };
}
