import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import {
  RuntimeEventRebaselineRequired,
  RuntimeEventStreamError,
  type RuntimeEvent,
  type RuntimeEventError,
  type RuntimeEventGenerationId,
  type RuntimeEventSequence,
  type RuntimeEventSubscriptionClose,
  type RuntimeEventsInput,
  type StateInvalidationDescriptor,
} from "@svvy/core";
import { RuntimeLayerConfigService } from "./runtime-layer-config";

export type RuntimeEventDraft = RuntimeEvent extends infer Event
  ? Event extends { sequence: number }
    ? Omit<Event, "eventGenerationId" | "sequence">
    : never
  : never;

export interface RuntimeEventSubscriptionEffect {
  readonly stream: Stream.Stream<RuntimeEvent, never>;
  close(): Effect.Effect<void, RuntimeEventError>;
  readonly closed: Effect.Effect<RuntimeEventSubscriptionClose, RuntimeEventError>;
}

export interface RuntimeEventBusOptions {
  eventGenerationId?: RuntimeEventGenerationId;
}

export interface RuntimeEventBusService {
  publishLive(input: { event: RuntimeEventDraft }): Effect.Effect<RuntimeEvent, RuntimeEventError>;
  publishStateInvalidations(input: {
    afterCommit: readonly StateInvalidationDescriptor[];
  }): Effect.Effect<readonly RuntimeEvent[], RuntimeEventError>;
  subscribe(
    input?: RuntimeEventsInput,
  ): Effect.Effect<RuntimeEventSubscriptionEffect, RuntimeEventError>;
}

export class RuntimeEventBus extends Context.Service<RuntimeEventBus, RuntimeEventBusService>()(
  "@svvy/runtime/RuntimeEventBus",
) {}

interface RuntimeEventSubscriber {
  readonly id: number;
  readonly queue: Queue.Queue<RuntimeEvent>;
  readonly input: RuntimeEventsInput;
  readonly close: (reason: RuntimeEventSubscriptionClose["reason"]) => Effect.Effect<void>;
}

let runtimeEventBusGenerationCounter = 0;

export const makeRuntimeEventBus = Effect.fn("@svvy/runtime/makeRuntimeEventBus")(function* (
  options: RuntimeEventBusOptions = {},
) {
  const runtimeConfig = yield* RuntimeLayerConfigService;
  const replaySize = runtimeConfig.eventReplayCapacity;
  const subscriberBufferCapacity = runtimeConfig.eventSubscriberBufferCapacity;
  const publishLane = yield* Semaphore.make(1);
  const retained: RuntimeEvent[] = [];
  const subscribers = new Map<number, RuntimeEventSubscriber>();
  let nextSubscriberId = 1;
  const eventGenerationId =
    options.eventGenerationId ??
    (`runtime-event-generation-${(runtimeEventBusGenerationCounter += 1)}` as RuntimeEventGenerationId);
  let nextSequence = 1;
  let closed = false;

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      closed = true;
      for (const subscriber of subscribers.values()) {
        yield* subscriber.close("runtime-shutdown");
      }
      subscribers.clear();
    }),
  );

  const publishLive = Effect.fn("@svvy/runtime/RuntimeEventBus.publishLive")(function* (input: {
    event: RuntimeEventDraft;
  }) {
    return yield* publishLane.withPermit(
      Effect.gen(function* () {
        if (closed) {
          return yield* Effect.fail(
            new RuntimeEventStreamError({
              operation: "runtime.events.publish",
              reason: "stream-failed",
              message: "Runtime event bus is closed.",
              latestSequence: (nextSequence - 1) as RuntimeEventSequence,
            }),
          );
        }

        const event = {
          ...input.event,
          eventGenerationId,
          sequence: nextSequence as RuntimeEventSequence,
        } as RuntimeEvent;
        nextSequence += 1;
        retained.push(event);
        while (retained.length > replaySize) {
          retained.shift();
        }

        for (const subscriber of Array.from(subscribers.values())) {
          if (!runtimeEventMatchesSubscription(event, subscriber.input)) {
            continue;
          }
          const accepted = yield* Queue.offer(subscriber.queue, event);
          if (accepted !== true) {
            yield* subscriber.close("slow-consumer");
            subscribers.delete(subscriber.id);
          }
        }

        return event;
      }),
    );
  });

  const publishStateInvalidations = Effect.fn(
    "@svvy/runtime/RuntimeEventBus.publishStateInvalidations",
  )(function* (input: { afterCommit: readonly StateInvalidationDescriptor[] }) {
    return yield* Effect.forEach(
      input.afterCommit,
      (invalidation) => publishLive({ event: runtimeEventFromStateInvalidation(invalidation) }),
      { concurrency: 1 },
    );
  });

  const subscribe = (
    input: RuntimeEventsInput = {},
  ): Effect.Effect<RuntimeEventSubscriptionEffect, RuntimeEventError> =>
    Effect.gen(function* () {
      if (closed) {
        return yield* Effect.fail(
          new RuntimeEventStreamError({
            operation: "runtime.events",
            reason: "subscriber-closed",
            message: "Runtime event bus is closed.",
            latestSequence: (nextSequence - 1) as RuntimeEventSequence,
          }),
        );
      }

      const subscriptionScope = yield* Scope.make("sequential");
      const closedReceipt = yield* Deferred.make<
        RuntimeEventSubscriptionClose,
        RuntimeEventError
      >();
      const eventQueue = yield* Queue.dropping<RuntimeEvent>(subscriberBufferCapacity);
      yield* Scope.addFinalizer(subscriptionScope, Queue.shutdown(eventQueue));
      let lastContiguousSequence = 0 as RuntimeEventSequence;
      const closeWithReceipt = (reason: RuntimeEventSubscriptionClose["reason"]) =>
        Effect.gen(function* () {
          yield* Scope.close(subscriptionScope, Exit.void);
          const rebaselineRequired = reason !== "closed";
          yield* Deferred.succeed(closedReceipt, {
            reason,
            eventGenerationId,
            lastContiguousSequence,
            rebaselineRequired,
          } as RuntimeEventSubscriptionClose).pipe(Effect.ignore);
        });
      const subscriptionSnapshot = yield* publishLane
        .withPermit(
          Effect.gen(function* () {
            if (closed) {
              return yield* Effect.fail(
                new RuntimeEventStreamError({
                  operation: "runtime.events",
                  reason: "subscriber-closed",
                  message: "Runtime event bus is closed.",
                  latestSequence: (nextSequence - 1) as RuntimeEventSequence,
                }),
              );
            }

            const snapshotLatestSequence = nextSequence - 1;
            yield* validateReplayWindow(input, retained, snapshotLatestSequence, eventGenerationId);
            const minimumSequence = nextReplaySequence(input, snapshotLatestSequence);
            const snapshotReplay = retained.filter(
              (event) =>
                event.sequence > minimumSequence && runtimeEventMatchesSubscription(event, input),
            );
            const subscriberId = nextSubscriberId;
            nextSubscriberId += 1;
            lastContiguousSequence = minimumSequence as RuntimeEventSequence;
            const subscriber: RuntimeEventSubscriber = {
              id: subscriberId,
              queue: eventQueue,
              input,
              close: closeWithReceipt,
            };
            subscribers.set(subscriber.id, subscriber);
            return {
              latestSequence: snapshotLatestSequence,
              replay: snapshotReplay,
              subscriberId,
            };
          }),
        )
        .pipe(
          Effect.onError(() =>
            Scope.close(subscriptionScope, Exit.void).pipe(
              Effect.andThen(
                Deferred.fail(
                  closedReceipt,
                  new RuntimeEventStreamError({
                    operation: "runtime.events",
                    reason: "subscriber-closed",
                    message: "Runtime event subscription did not open.",
                    latestSequence: (nextSequence - 1) as RuntimeEventSequence,
                  }),
                ),
              ),
              Effect.ignore,
            ),
          ),
        );

      const live = Stream.fromQueue(eventQueue).pipe(
        Stream.filter(
          (event) =>
            event.sequence > subscriptionSnapshot.latestSequence &&
            runtimeEventMatchesSubscription(event, input),
        ),
      );
      const stream = Stream.fromIterable(subscriptionSnapshot.replay).pipe(
        Stream.concat(live),
        Stream.map((event) => {
          lastContiguousSequence = event.sequence;
          return event;
        }),
        Stream.ensuring(
          Effect.gen(function* () {
            yield* publishLane.withPermit(
              Effect.sync(() => {
                subscribers.delete(subscriptionSnapshot.subscriberId);
              }),
            );
            yield* closeWithReceipt(closed ? "runtime-shutdown" : "closed");
          }),
        ),
      );

      return {
        stream,
        close: () => closeWithReceipt("closed"),
        closed: Deferred.await(closedReceipt),
      };
    });

  return RuntimeEventBus.of({ publishLive, publishStateInvalidations, subscribe });
});

export const layerRuntimeEventBus = Layer.effect(RuntimeEventBus, makeRuntimeEventBus());

function validateReplayWindow(
  input: RuntimeEventsInput,
  retained: readonly RuntimeEvent[],
  latestSequence: number,
  eventGenerationId: RuntimeEventGenerationId,
): Effect.Effect<void, RuntimeEventRebaselineRequired> {
  const afterSequence = input.afterSequence;
  if (input.eventGenerationId !== undefined && input.eventGenerationId !== eventGenerationId) {
    return Effect.fail(
      new RuntimeEventRebaselineRequired({
        reason: "generation-changed",
        requestedAfterSequence: (afterSequence ?? 0) as RuntimeEventSequence,
        retainedFromSequence: (retained[0]?.sequence ?? latestSequence + 1) as RuntimeEventSequence,
        currentHighWaterSequence: latestSequence as RuntimeEventSequence,
        eventGenerationId,
        affectedReadModels: [],
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        message: "Requested event generation no longer matches the runtime event bus.",
      }),
    );
  }
  if (afterSequence === undefined || latestSequence === 0) {
    return Effect.void;
  }
  const retainedFromSequence = retained[0]?.sequence ?? latestSequence + 1;
  if (afterSequence < retainedFromSequence - 1) {
    return Effect.fail(
      new RuntimeEventRebaselineRequired({
        reason: "stale-cursor",
        requestedAfterSequence: afterSequence,
        retainedFromSequence: retainedFromSequence as RuntimeEventSequence,
        currentHighWaterSequence: latestSequence as RuntimeEventSequence,
        eventGenerationId,
        affectedReadModels: [],
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        message: "Requested event sequence is outside the retained replay window.",
      }),
    );
  }
  return Effect.void;
}

function nextReplaySequence(input: RuntimeEventsInput, latestSequence: number): number {
  return input.afterSequence ?? latestSequence;
}

function runtimeEventFromStateInvalidation(input: StateInvalidationDescriptor): RuntimeEventDraft {
  if (input.scope === "workspace") {
    return {
      type: "workspace_read_model.changed",
      workspaceId: input.workspaceId,
      invalidation: input.invalidation,
    };
  }
  return {
    type: "app_read_model.changed",
    invalidation: input.invalidation,
  };
}

function runtimeEventMatchesSubscription(event: RuntimeEvent, input: RuntimeEventsInput): boolean {
  const eventWorkspaceId = "workspaceId" in event ? event.workspaceId : undefined;
  if (input.workspaceId && eventWorkspaceId !== input.workspaceId) {
    return input.includeAppEvents === true && eventWorkspaceId === undefined;
  }
  if (!input.workspaceId && eventWorkspaceId === undefined) {
    return true;
  }
  if (input.workspaceSessionId) {
    return runtimeEventWorkspaceSessionId(event) === input.workspaceSessionId;
  }
  return true;
}

function runtimeEventWorkspaceSessionId(event: RuntimeEvent): string | undefined {
  if ("workspaceSessionId" in event) {
    return event.workspaceSessionId;
  }
  if ("target" in event) {
    return event.target.workspaceSessionId;
  }
  return undefined;
}
