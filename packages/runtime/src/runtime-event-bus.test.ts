import { describe, expect, it } from "bun:test";
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
import { runTestEffect } from "./effect.test-support";

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
  it("assigns app-wide sequences and replays retained events after a cursor", async () => {
    await expect(
      runTestEffect(
        Effect.scoped(
          Effect.gen(function* () {
            const bus = yield* makeConfiguredRuntimeEventBus({ eventReplayCapacity: 2 });
            yield* bus.publishLive({ event: appInvalidation("extensions") });
            yield* bus.publishLive({ event: workspaceInvalidation(workspaceA) });
            return yield* collectEvents(
              bus.subscribe({ afterSequence: runtimeEventSequence(0) }),
              2,
            );
          }),
        ),
      ),
    ).resolves.toMatchObject([
      { type: "app_read_model.changed", sequence: 1 },
      { type: "workspace_read_model.changed", sequence: 2, workspaceId: workspaceA },
    ]);
  });

  it("filters replay and live events by workspace while optionally retaining app events", async () => {
    await expect(
      runTestEffect(
        Effect.scoped(
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
        ),
      ),
    ).resolves.toMatchObject([
      { type: "app_read_model.changed", sequence: 1 },
      { type: "workspace_read_model.changed", sequence: 2, workspaceId: workspaceA },
    ]);
  });

  it("fails stale replay cursors with a typed rebaseline error", async () => {
    const eventGenerationId = "runtime-events-generation-test" as RuntimeEventGenerationId;
    await expect(
      runTestEffect(
        Effect.scoped(
          Effect.gen(function* () {
            const bus = yield* makeConfiguredRuntimeEventBus(
              { eventReplayCapacity: 2 },
              { eventGenerationId },
            );
            yield* bus.publishLive({ event: appInvalidation("extensions") });
            yield* bus.publishLive({ event: workspaceInvalidation(workspaceA) });
            yield* bus.publishLive({ event: workspaceInvalidation(workspaceB) });
            return yield* collectEvents(
              bus.subscribe({ afterSequence: runtimeEventSequence(0) }),
              1,
            );
          }),
        ),
      ),
    ).rejects.toMatchObject({ eventGenerationId });
  });

  it("uses a fresh runtime event generation id for each bus by default", async () => {
    const generationIds = await runTestEffect(
      Effect.scoped(
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
      ),
    );

    expect(generationIds[0]).not.toBe(generationIds[1]);
  });

  it("releases subscriptions when replay validation fails", async () => {
    await expect(
      runTestEffect(
        Effect.scoped(
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
        ),
      ),
    ).resolves.toEqual([runtimeEventSequence(3), runtimeEventSequence(4)]);
  });

  it("delivers live events to an active subscription", async () => {
    await expect(
      runTestEffect(
        Effect.scoped(
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
        ),
      ),
    ).resolves.toMatchObject([
      { type: "app_read_model.changed", sequence: 1 },
      { type: "workspace_read_model.changed", sequence: 2, workspaceId: workspaceA },
    ]);
  });

  it("does not drop events published after subscribe returns but before stream consumption starts", async () => {
    await expect(
      runTestEffect(
        Effect.scoped(
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
        ),
      ),
    ).resolves.toMatchObject([{ type: "app_read_model.changed", sequence: 1 }]);
  });

  it("retains events for replay and closes slow subscribers before they miss sequences", async () => {
    await expect(
      runTestEffect(
        Effect.scoped(
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
        ),
      ),
    ).resolves.toMatchObject({
      secondPublish: { type: "app_read_model.changed", sequence: 2 },
      slowClose: {
        reason: "slow-consumer",
        lastContiguousSequence: 0,
        rebaselineRequired: true,
      },
      replayed: [
        { type: "app_read_model.changed", sequence: 1, invalidation: { model: "extensions" } },
        { type: "app_read_model.changed", sequence: 2, invalidation: { model: "settings" } },
      ],
    });
  });

  it("does not close subscribers for events outside their filter", async () => {
    await expect(
      runTestEffect(
        Effect.scoped(
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
        ),
      ),
    ).resolves.toMatchObject({
      collected: [{ type: "workspace_read_model.changed", sequence: 3, workspaceId: workspaceA }],
      close: {
        reason: "closed",
        lastContiguousSequence: 3,
        rebaselineRequired: false,
      },
    });
  });

  it("publishes state invalidation descriptors as ordered runtime events", async () => {
    await expect(
      runTestEffect(
        Effect.scoped(
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
        ),
      ),
    ).resolves.toMatchObject({
      published: [
        { type: "app_read_model.changed", sequence: 1, invalidation: { model: "settings" } },
        { type: "workspace_read_model.changed", sequence: 2, workspaceId: workspaceA },
      ],
      replayed: [
        { type: "app_read_model.changed", sequence: 1, invalidation: { model: "settings" } },
        { type: "workspace_read_model.changed", sequence: 2, workspaceId: workspaceA },
      ],
    });
  });
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
