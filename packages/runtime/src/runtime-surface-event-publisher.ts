import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import {
  type RuntimeEvent,
  type RuntimeEventError,
  RuntimeEventStreamError,
  type RuntimeSurfaceTarget,
  type SurfaceStreamGenerationId,
  type SurfaceStreamPatchInput,
  type SurfaceStreamSequence,
  type WorkspaceId,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";

export type RuntimeSurfaceChangedReason = Extract<
  RuntimeEvent,
  { type: "surface.changed" }
>["reason"];

export type RuntimeSurfaceChangedInput = {
  readonly workspaceId: WorkspaceId;
  readonly target: RuntimeSurfaceTarget;
  readonly reason: RuntimeSurfaceChangedReason;
};

export type RuntimeSurfaceStreamPatchInput = {
  readonly workspaceId: WorkspaceId;
  readonly target: RuntimeSurfaceTarget;
  readonly streamGenerationId: SurfaceStreamGenerationId;
  readonly streamSequence?: SurfaceStreamSequence;
  readonly patch: SurfaceStreamPatchInput;
};

export interface RuntimeSurfaceEventPublisherService {
  publishSurfaceChanged(
    input: RuntimeSurfaceChangedInput,
  ): Effect.Effect<RuntimeEvent, RuntimeEventError>;
  publishStreamPatch(
    input: RuntimeSurfaceStreamPatchInput,
  ): Effect.Effect<RuntimeEvent, RuntimeEventError>;
  resetSurfaceStream(
    input: Omit<RuntimeSurfaceStreamPatchInput, "patch"> & {
      readonly reason: Extract<SurfaceStreamPatchInput, { type: "stream_reset" }>["reason"];
      readonly latestStreamSequence?: SurfaceStreamSequence;
    },
  ): Effect.Effect<RuntimeEvent, RuntimeEventError>;
}

export class RuntimeSurfaceEventPublisher extends Context.Service<
  RuntimeSurfaceEventPublisher,
  RuntimeSurfaceEventPublisherService
>()("@svvy/runtime/RuntimeSurfaceEventPublisher") {}

export const layerRuntimeSurfaceEventPublisher = Layer.effect(
  RuntimeSurfaceEventPublisher,
  Effect.gen(function* () {
    const eventBus = yield* RuntimeEventBus;
    const streamLane = yield* Semaphore.make(1);
    const streamSequences = new Map<
      string,
      { streamGenerationId: SurfaceStreamGenerationId; latestSequence: number }
    >();

    return RuntimeSurfaceEventPublisher.of({
      publishSurfaceChanged: (input) =>
        eventBus.publishLive({
          event: {
            type: "surface.changed",
            workspaceId: input.workspaceId,
            target: input.target,
            reason: input.reason,
          },
        }),
      publishStreamPatch: (input) =>
        streamLane.withPermit(
          Effect.gen(function* () {
            if (
              input.streamSequence !== undefined &&
              !isNextCommittedSurfaceStreamSequence(streamSequences, input)
            ) {
              return yield* Effect.fail(
                new RuntimeEventStreamError({
                  operation: "runtime.surface-events.publishStreamPatch",
                  reason: "stream-failed",
                  message: `Committed surface stream sequence ${input.streamSequence} is not contiguous for ${input.target.surfacePiSessionId}.`,
                }),
              );
            }
            const streamSequence =
              input.streamSequence ?? nextSurfaceStreamSequence(streamSequences, input);
            if (input.streamSequence !== undefined) {
              streamSequences.set(input.target.surfacePiSessionId, {
                streamGenerationId: input.streamGenerationId,
                latestSequence: input.streamSequence,
              });
            }
            return yield* eventBus.publishLive({
              event: {
                type: "surface.stream",
                workspaceId: input.workspaceId,
                target: input.target,
                streamGenerationId: input.streamGenerationId,
                streamSequence,
                patch: input.patch,
              },
            });
          }),
        ),
      resetSurfaceStream: (input) =>
        streamLane.withPermit(
          Effect.gen(function* () {
            if (
              input.streamSequence !== undefined &&
              !isNextCommittedSurfaceStreamSequence(streamSequences, input)
            ) {
              return yield* Effect.fail(
                new RuntimeEventStreamError({
                  operation: "runtime.surface-events.resetSurfaceStream",
                  reason: "stream-failed",
                  message: `Committed surface reset sequence ${input.streamSequence} is not contiguous for ${input.target.surfacePiSessionId}.`,
                }),
              );
            }
            const latestStreamSequence =
              input.latestStreamSequence ?? latestSurfaceStreamSequence(streamSequences, input);
            const streamSequence =
              input.streamSequence ??
              nextSurfaceStreamSequence(streamSequences, {
                ...input,
                patch: { type: "stream_reset", reason: input.reason, latestStreamSequence },
              });
            if (input.streamSequence !== undefined) {
              streamSequences.set(input.target.surfacePiSessionId, {
                streamGenerationId: input.streamGenerationId,
                latestSequence: input.streamSequence,
              });
            }
            return yield* eventBus.publishLive({
              event: {
                type: "surface.stream",
                workspaceId: input.workspaceId,
                target: input.target,
                streamGenerationId: input.streamGenerationId,
                streamSequence,
                patch: { type: "stream_reset", reason: input.reason, latestStreamSequence },
              },
            });
          }),
        ),
    });
  }),
);

function isNextCommittedSurfaceStreamSequence(
  streamSequences: Map<
    string,
    { streamGenerationId: SurfaceStreamGenerationId; latestSequence: number }
  >,
  input: Omit<RuntimeSurfaceStreamPatchInput, "patch">,
): boolean {
  if (input.streamSequence === undefined) return true;
  const existing = streamSequences.get(input.target.surfacePiSessionId);
  if (!existing) return input.streamSequence >= 1;
  const expected =
    existing.streamGenerationId === input.streamGenerationId ? existing.latestSequence + 1 : 1;
  return input.streamSequence === expected;
}

function nextSurfaceStreamSequence(
  streamSequences: Map<
    string,
    { streamGenerationId: SurfaceStreamGenerationId; latestSequence: number }
  >,
  input: RuntimeSurfaceStreamPatchInput,
): SurfaceStreamSequence {
  const key = input.target.surfacePiSessionId;
  const existing = streamSequences.get(key);
  const next =
    existing?.streamGenerationId === input.streamGenerationId ? existing.latestSequence + 1 : 1;
  streamSequences.set(key, {
    streamGenerationId: input.streamGenerationId,
    latestSequence: next,
  });
  return next as SurfaceStreamSequence;
}

function latestSurfaceStreamSequence(
  streamSequences: Map<
    string,
    { streamGenerationId: SurfaceStreamGenerationId; latestSequence: number }
  >,
  input: Omit<RuntimeSurfaceStreamPatchInput, "patch">,
): SurfaceStreamSequence {
  const existing = streamSequences.get(input.target.surfacePiSessionId);
  if (existing?.streamGenerationId !== input.streamGenerationId) {
    return 0 as SurfaceStreamSequence;
  }
  return existing.latestSequence as SurfaceStreamSequence;
}
