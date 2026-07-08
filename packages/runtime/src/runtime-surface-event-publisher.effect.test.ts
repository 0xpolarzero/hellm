import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeEventStreamError,
  type MessageId,
  type RuntimeEvent,
  type RuntimeEventGenerationId,
  type RuntimeEventSequence,
  type RuntimeSurfaceTarget,
  type SurfacePiSessionId,
  type SurfaceStreamGenerationId,
  type SurfaceStreamSequence,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { createRuntimeLayerConfigLayer, defaultRuntimeLayerConfig } from "./runtime-layer-config";
import { RuntimeEventBus, layerRuntimeEventBus } from "./runtime-event-bus";
import {
  RuntimeSurfaceEventPublisher,
  layerRuntimeSurfaceEventPublisher,
} from "./runtime-surface-event-publisher";

const workspaceId = "workspace_surface_events" as WorkspaceId;
const target = {
  workspaceSessionId: "wsess_surface_events" as WorkspaceSessionId,
  surface: "orchestrator",
  surfacePiSessionId: "pi_surface_events" as SurfacePiSessionId,
} satisfies RuntimeSurfaceTarget;
const secondTarget = {
  workspaceSessionId: "wsess_surface_events" as WorkspaceSessionId,
  surface: "orchestrator",
  surfacePiSessionId: "pi_surface_events_second" as SurfacePiSessionId,
} satisfies RuntimeSurfaceTarget;
const streamGenerationId = "surface-stream-generation-a" as SurfaceStreamGenerationId;
const nextStreamGenerationId = "surface-stream-generation-b" as SurfaceStreamGenerationId;
const messageId = "msg_surface_events" as MessageId;
const realPublisherLayer = layerRuntimeSurfaceEventPublisher.pipe(
  Layer.provide(layerRuntimeEventBus),
  Layer.provide(createRuntimeLayerConfigLayer(defaultRuntimeLayerConfig)),
);

describe("runtime surface event publisher", () => {
  it.effect("publishes surface.stream patches with runtime and target-local sequences", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const publisher = yield* RuntimeSurfaceEventPublisher;
        const event = yield* publisher.publishStreamPatch({
          workspaceId,
          target,
          streamGenerationId,
          patch: {
            type: "assistant_text_delta",
            messageId,
            contentIndex: 0,
            delta: "hello",
          },
        });

        assertSurfaceStream(event);
        assert.strictEqual(event.sequence, 1 as RuntimeEventSequence);
        assert.strictEqual(event.workspaceId, workspaceId);
        assert.deepStrictEqual(event.target, target);
        assert.strictEqual(event.streamGenerationId, streamGenerationId);
        assert.strictEqual(event.streamSequence, 1 as SurfaceStreamSequence);
        assert.deepStrictEqual(event.patch, {
          type: "assistant_text_delta",
          messageId,
          contentIndex: 0,
          delta: "hello",
        });
      }).pipe(Effect.provide(realPublisherLayer)),
    ),
  );

  it.effect("keeps stream sequences independent by surface and generation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const publisher = yield* RuntimeSurfaceEventPublisher;
        const first = yield* publisher.publishStreamPatch(
          textDelta(target, streamGenerationId, "a"),
        );
        const second = yield* publisher.publishStreamPatch(
          textDelta(target, streamGenerationId, "b"),
        );
        const otherSurface = yield* publisher.publishStreamPatch(
          textDelta(secondTarget, streamGenerationId, "c"),
        );
        const otherGeneration = yield* publisher.publishStreamPatch(
          textDelta(target, nextStreamGenerationId, "d"),
        );

        assertSurfaceStream(first);
        assertSurfaceStream(second);
        assertSurfaceStream(otherSurface);
        assertSurfaceStream(otherGeneration);
        assert.strictEqual(first.streamSequence, 1 as SurfaceStreamSequence);
        assert.strictEqual(second.streamSequence, 2 as SurfaceStreamSequence);
        assert.strictEqual(otherSurface.streamSequence, 1 as SurfaceStreamSequence);
        assert.strictEqual(otherGeneration.streamSequence, 1 as SurfaceStreamSequence);
      }).pipe(Effect.provide(realPublisherLayer)),
    ),
  );

  it.effect("publishes stream_reset with the last prior sequence for that target generation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const publisher = yield* RuntimeSurfaceEventPublisher;
        yield* publisher.publishStreamPatch(textDelta(target, streamGenerationId, "a"));
        yield* publisher.publishStreamPatch(textDelta(target, streamGenerationId, "b"));
        const reset = yield* publisher.resetSurfaceStream({
          workspaceId,
          target,
          streamGenerationId,
          reason: "rebaseline_required",
        });

        assertSurfaceStream(reset);
        assert.strictEqual(reset.streamSequence, 3 as SurfaceStreamSequence);
        assert.deepStrictEqual(reset.patch, {
          type: "stream_reset",
          reason: "rebaseline_required",
          latestStreamSequence: 2 as SurfaceStreamSequence,
        });
      }).pipe(Effect.provide(realPublisherLayer)),
    ),
  );

  it.effect("resets an unseen stream generation with latest sequence zero", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const publisher = yield* RuntimeSurfaceEventPublisher;
        yield* publisher.publishStreamPatch(textDelta(target, streamGenerationId, "a"));
        const reset = yield* publisher.resetSurfaceStream({
          workspaceId,
          target,
          streamGenerationId: nextStreamGenerationId,
          reason: "runtime_recovered",
        });

        assertSurfaceStream(reset);
        assert.strictEqual(reset.streamGenerationId, nextStreamGenerationId);
        assert.strictEqual(reset.streamSequence, 1 as SurfaceStreamSequence);
        assert.deepStrictEqual(reset.patch, {
          type: "stream_reset",
          reason: "runtime_recovered",
          latestStreamSequence: 0 as SurfaceStreamSequence,
        });
      }).pipe(Effect.provide(realPublisherLayer)),
    ),
  );

  it.effect("publishes surface.changed through the runtime event bus", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const publisher = yield* RuntimeSurfaceEventPublisher;
        const event = yield* publisher.publishSurfaceChanged({
          workspaceId,
          target,
          reason: "prompt.started",
        });

        assertSurfaceChanged(event);
        assert.deepStrictEqual(event, {
          type: "surface.changed",
          eventGenerationId: event.eventGenerationId,
          sequence: 1 as RuntimeEventSequence,
          workspaceId,
          target,
          reason: "prompt.started",
        } satisfies RuntimeEvent);
      }).pipe(Effect.provide(realPublisherLayer)),
    ),
  );

  it.effect("propagates runtime event publication failures", () => {
    const failure = new RuntimeEventStreamError({
      operation: "runtime.events.publish",
      reason: "stream-failed",
      message: "closed bus",
    });

    return Effect.scoped(
      Effect.gen(function* () {
        const publisher = yield* RuntimeSurfaceEventPublisher;
        const error = yield* publisher
          .publishStreamPatch(textDelta(target, streamGenerationId, "a"))
          .pipe(Effect.flip);
        assert.strictEqual(error, failure);
      }).pipe(
        Effect.provide(layerRuntimeSurfaceEventPublisher),
        Effect.provideService(
          RuntimeEventBus,
          RuntimeEventBus.of({
            publishLive: () => Effect.fail(failure),
            publishStateInvalidations: () => Effect.fail(failure),
            subscribe: () => Effect.fail(failure),
          }),
        ),
      ),
    );
  });

  it.effect("releases the stream cursor permit when event publication fails", () => {
    const failure = new RuntimeEventStreamError({
      operation: "runtime.events.publish",
      reason: "stream-failed",
      message: "first publish failed",
    });
    let publishAttempts = 0;

    return Effect.scoped(
      Effect.gen(function* () {
        const publisher = yield* RuntimeSurfaceEventPublisher;
        const error = yield* publisher
          .publishStreamPatch(textDelta(target, streamGenerationId, "a"))
          .pipe(Effect.flip);
        const second = yield* publisher.publishStreamPatch(
          textDelta(target, streamGenerationId, "b"),
        );

        assert.strictEqual(error, failure);
        assertSurfaceStream(second);
        assert.strictEqual(second.streamSequence, 2 as SurfaceStreamSequence);
      }).pipe(
        Effect.provide(layerRuntimeSurfaceEventPublisher),
        Effect.provideService(
          RuntimeEventBus,
          RuntimeEventBus.of({
            publishLive: (input) => {
              publishAttempts += 1;
              if (publishAttempts === 1) {
                return Effect.fail(failure);
              }
              return Effect.succeed({
                ...input.event,
                eventGenerationId: "runtime_event_generation_test" as RuntimeEventGenerationId,
                sequence: publishAttempts as RuntimeEventSequence,
              } satisfies RuntimeEvent);
            },
            publishStateInvalidations: () => Effect.fail(failure),
            subscribe: () => Effect.fail(failure),
          }),
        ),
      ),
    );
  });
});

function textDelta(
  inputTarget: RuntimeSurfaceTarget,
  inputGenerationId: SurfaceStreamGenerationId,
  delta: string,
) {
  return {
    workspaceId,
    target: inputTarget,
    streamGenerationId: inputGenerationId,
    patch: {
      type: "assistant_text_delta",
      messageId,
      contentIndex: 0,
      delta,
    },
  } as const;
}

function assertSurfaceStream(
  event: RuntimeEvent,
): asserts event is Extract<RuntimeEvent, { type: "surface.stream" }> {
  assert.strictEqual(event.type, "surface.stream");
}

function assertSurfaceChanged(
  event: RuntimeEvent,
): asserts event is Extract<RuntimeEvent, { type: "surface.changed" }> {
  assert.strictEqual(event.type, "surface.changed");
}
