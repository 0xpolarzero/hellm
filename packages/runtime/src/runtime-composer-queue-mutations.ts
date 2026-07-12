import * as Effect from "effect/Effect";
import {
  RuntimeComposerDraftStatePort,
  RuntimeContractError,
  RuntimeQueueStatePort,
  decodeUnknownRuntimeSubmittedMessageEffect,
  type PromptTarget,
  type ReorderQueuedMessageInput,
  type RestoreQueuedMessageToComposerInput,
  type RuntimeSurfaceMessageRecord,
  type StateInvalidationDescriptor,
  type UpdateComposerDraftInput,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";

function stateFailure(operation: string, cause: unknown): RuntimeContractError {
  const stateCause = cause as { readonly reason?: string; readonly message?: string };
  return new RuntimeContractError({
    operation,
    reason:
      stateCause.reason === "not-found"
        ? "target-not-found"
        : stateCause.reason === "invalid-input"
          ? "invalid-input"
          : stateCause.reason === "claim-conflict" || stateCause.reason === "conflict"
            ? "state-conflict"
            : "stale-state",
    message: stateCause.message ?? "Runtime state operation failed.",
    cause,
  });
}

function assertQueuedMessageTarget(
  operation: string,
  target: PromptTarget,
  queued: RuntimeSurfaceMessageRecord,
): Effect.Effect<void, RuntimeContractError> {
  const expectedThreadId = target.surface === "handler" ? target.threadId : null;
  return queued.sessionId === target.workspaceSessionId &&
    queued.surfacePiSessionId === target.surfacePiSessionId &&
    (queued.threadId ?? null) === expectedThreadId
    ? Effect.void
    : Effect.fail(
        new RuntimeContractError({
          operation,
          reason: "target-not-found",
          message: `Queued surface message ${queued.id} does not belong to target.`,
        }),
      );
}

function publishAfterCommit(
  operation: string,
  afterCommit: { readonly afterCommit: readonly StateInvalidationDescriptor[] },
) {
  return Effect.gen(function* () {
    const eventBus = yield* RuntimeEventBus;
    yield* eventBus.publishStateInvalidations(afterCommit).pipe(
      Effect.mapError(
        (cause) =>
          new RuntimeContractError({
            operation,
            reason: "stale-state",
            message: "Runtime event bus did not accept committed state invalidations.",
            cause,
          }),
      ),
    );
  });
}

export const updateRuntimeComposerDraft = Effect.fn("@svvy/runtime/messages.updateDraft")(
  function* (input: UpdateComposerDraftInput) {
    const drafts = yield* RuntimeComposerDraftStatePort;
    const committed = yield* drafts
      .setDraft({
        target: input.target,
        text: input.draft.text,
        attachments: input.draft.attachments,
        snippetMentions: input.draft.snippetMentions ?? [],
      })
      .pipe(Effect.mapError((cause) => stateFailure("runtime.messages.updateDraft", cause)));
    yield* publishAfterCommit("runtime.messages.updateDraft", {
      afterCommit: committed.afterCommit,
    });
    return { target: input.target };
  },
);

export const restoreRuntimeQueuedMessageToComposer = Effect.fn(
  "@svvy/runtime/queues.restoreToComposer",
)(function* (input: RestoreQueuedMessageToComposerInput) {
  const queue = yield* RuntimeQueueStatePort;
  const existing = yield* queue
    .getSurfaceQueuedMessage({ id: input.queuedMessageId })
    .pipe(
      Effect.mapError((cause) => stateFailure("runtime.queues.restoreToComposer.lookup", cause)),
    );
  yield* assertQueuedMessageTarget("runtime.queues.restoreToComposer", input.target, existing);
  if (existing.kind !== "user_message") {
    return yield* Effect.fail(
      new RuntimeContractError({
        operation: "runtime.queues.restoreToComposer",
        reason: "invalid-input",
        message: "Only queued user messages can be restored to the composer.",
      }),
    );
  }
  const decoded = yield* Effect.try({
    try: () => JSON.parse(existing.messageJson) as unknown,
    catch: (cause) =>
      new RuntimeContractError({
        operation: "runtime.queues.restoreToComposer",
        reason: "invalid-input",
        message: "Queued user message payload cannot be restored to the composer.",
        cause,
      }),
  }).pipe(
    Effect.flatMap(decodeUnknownRuntimeSubmittedMessageEffect),
    Effect.mapError((cause) =>
      cause instanceof RuntimeContractError
        ? cause
        : new RuntimeContractError({
            operation: "runtime.queues.restoreToComposer",
            reason: "invalid-input",
            message: "Queued user message payload cannot be restored to the composer.",
            cause,
          }),
    ),
  );
  const committed = yield* queue
    .cancelSurfaceMessage({
      id: input.queuedMessageId,
      expectedStatuses: ["queued", "steering"],
    })
    .pipe(
      Effect.mapError((cause) => stateFailure("runtime.queues.restoreToComposer.cancel", cause)),
    );
  yield* publishAfterCommit("runtime.queues.restoreToComposer", {
    afterCommit: committed.afterCommit,
  });
  return { target: input.target, text: decoded.text };
});

export const reorderRuntimeQueuedMessage = Effect.fn("@svvy/runtime/queues.reorder")(function* (
  input: ReorderQueuedMessageInput,
) {
  const queue = yield* RuntimeQueueStatePort;
  const moving = yield* queue
    .getSurfaceQueuedMessage({ id: input.queuedMessageId })
    .pipe(Effect.mapError((cause) => stateFailure("runtime.queues.reorder.lookup", cause)));
  yield* assertQueuedMessageTarget("runtime.queues.reorder", input.target, moving);
  if (input.beforeQueuedMessageId) {
    const before = yield* queue
      .getSurfaceQueuedMessage({ id: input.beforeQueuedMessageId })
      .pipe(
        Effect.mapError((cause) => stateFailure("runtime.queues.reorder.lookup-before", cause)),
      );
    yield* assertQueuedMessageTarget("runtime.queues.reorder", input.target, before);
  }
  const committed = yield* queue
    .reorderSurfaceMessage({
      surfacePiSessionId: input.target.surfacePiSessionId,
      id: input.queuedMessageId,
      beforeId: input.beforeQueuedMessageId ?? null,
    })
    .pipe(Effect.mapError((cause) => stateFailure("runtime.queues.reorder.commit", cause)));
  yield* publishAfterCommit("runtime.queues.reorder", { afterCommit: committed.afterCommit });
  return { target: input.target };
});
