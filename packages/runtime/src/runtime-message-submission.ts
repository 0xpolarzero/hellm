import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import {
  RuntimeContractError,
  RuntimeQueueStatePort,
  normalizeRuntimeClientSubmissionMetadata,
  type RuntimePromptTelemetrySummary,
  type RuntimeSubmittedMessage,
  type SubmitMessageInput,
  type SubmitMessageResult,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";

export type RuntimeMaterializedSubmittedMessage = {
  readonly messageJson: string;
  readonly promptTelemetry: RuntimePromptTelemetrySummary;
};

export type RuntimeMessageSubmissionInput = {
  readonly input: SubmitMessageInput;
};

export type RuntimeSubmittedMessagePostCommitInput = {
  readonly target: SubmitMessageResult["target"];
  readonly queuedMessageId: SubmitMessageResult["queuedMessageId"];
  readonly delivery: NonNullable<SubmitMessageInput["delivery"]>;
  readonly clientSubmission?: SubmitMessageInput["clientSubmission"];
  readonly promptTelemetry: RuntimePromptTelemetrySummary;
  readonly receipt: SubmitMessageResult["receipt"];
};

export interface RuntimeMessageSubmissionPostCommitLaneService {
  afterSubmitCommitted(
    input: RuntimeSubmittedMessagePostCommitInput,
  ): Effect.Effect<void, RuntimeContractError>;
}

export class RuntimeMessageSubmissionPostCommitLane extends Context.Service<
  RuntimeMessageSubmissionPostCommitLane,
  RuntimeMessageSubmissionPostCommitLaneService
>()("@svvy/runtime/RuntimeMessageSubmissionPostCommitLane") {}

function submittedMessageHasContent(input: SubmitMessageInput): boolean {
  if (input.message.text.trim()) {
    return true;
  }
  return (input.message.attachments ?? []).length > 0;
}

function clientSubmissionIdempotencyKey(input: SubmitMessageInput): string | undefined {
  const normalized = normalizeRuntimeClientSubmissionMetadata(input.clientSubmission);
  return normalized?.submissionId ?? normalized?.clientRequestId ?? normalized?.correlationId;
}

function clientSubmissionRequestId(input: SubmitMessageInput): string | null {
  const normalized = normalizeRuntimeClientSubmissionMetadata(input.clientSubmission);
  return (
    normalized?.clientRequestId ?? normalized?.submissionId ?? normalized?.correlationId ?? null
  );
}

function submittedAttachmentHasPromptPath(
  attachment: NonNullable<RuntimeSubmittedMessage["attachments"]>[number],
): boolean {
  return typeof attachment.path === "string" && attachment.path.trim().length > 0;
}

export function summarizeRuntimeSubmittedMessageForTelemetry(
  message: RuntimeSubmittedMessage,
): RuntimePromptTelemetrySummary {
  const attachments = message.attachments ?? [];
  return {
    messageCount: 1,
    userMessageCount: 1,
    textBlockCount:
      (message.text.trim() ? 1 : 0) + (attachments.some(submittedAttachmentHasPromptPath) ? 1 : 0),
    imageCount: attachments.filter(
      (attachment) => attachment.kind === "image" && attachment.dataBase64 && attachment.mimeType,
    ).length,
  };
}

export function materializeRuntimeSubmittedMessageForQueue(
  input: SubmitMessageInput,
): RuntimeMaterializedSubmittedMessage {
  return {
    messageJson: JSON.stringify(input.message),
    promptTelemetry: summarizeRuntimeSubmittedMessageForTelemetry(input.message),
  };
}

export const submitRuntimeMessage = Effect.fn("@svvy/runtime/messages.submit")(function* ({
  input,
}: RuntimeMessageSubmissionInput) {
  if (!submittedMessageHasContent(input)) {
    return yield* Effect.fail(
      new RuntimeContractError({
        operation: "runtime.messages.submit",
        reason: "invalid-input",
        message: "Submitted messages must include text or at least one attachment.",
      }),
    );
  }

  const target = input.target;
  const queue = yield* RuntimeQueueStatePort;
  const eventBus = yield* RuntimeEventBus;
  const postCommitLane = yield* RuntimeMessageSubmissionPostCommitLane;
  const materialized = materializeRuntimeSubmittedMessageForQueue(input);
  const clientSubmission = normalizeRuntimeClientSubmissionMetadata(input.clientSubmission);
  const idempotencyKey = clientSubmissionIdempotencyKey(input);
  const payloadJson = JSON.stringify({
    source: "runtime-submit",
    ...(clientSubmission ? { clientSubmission } : {}),
    telemetry: materialized.promptTelemetry,
  });
  const queuedResult = yield* queue
    .acceptSubmittedSurfaceMessage({
      target,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      messageJson: materialized.messageJson,
      payloadJson,
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new RuntimeContractError({
            operation: "runtime.messages.submit",
            reason:
              cause.reason === "not-found"
                ? "target-not-found"
                : cause.reason === "invalid-input"
                  ? "invalid-input"
                  : "stale-state",
            message: cause.message,
            ...(cause.issues ? { issues: cause.issues } : {}),
            cause,
          }),
      ),
    );
  const queued = queuedResult.value;
  yield* eventBus.publishStateInvalidations({ afterCommit: queuedResult.afterCommit }).pipe(
    Effect.mapError(
      (cause) =>
        new RuntimeContractError({
          operation: "runtime.messages.submit",
          reason: "stale-state",
          message: "Runtime event bus did not accept message submission notifications.",
          cause,
        }),
    ),
  );

  const result = {
    queuedMessageId: queued.id as SubmitMessageResult["queuedMessageId"],
    target,
    status: "queued",
    receipt: {
      clientRequestId: clientSubmissionRequestId(input),
      outcome: "accepted",
      acceptedAt: queued.createdAt as SubmitMessageResult["receipt"]["acceptedAt"],
      stateRevision: queued.sequence as SubmitMessageResult["receipt"]["stateRevision"],
    },
  } satisfies SubmitMessageResult;
  yield* postCommitLane.afterSubmitCommitted({
    target: result.target,
    queuedMessageId: result.queuedMessageId,
    delivery: input.delivery ?? "enqueue-and-run",
    ...(input.clientSubmission ? { clientSubmission: input.clientSubmission } : {}),
    promptTelemetry: materialized.promptTelemetry,
    receipt: result.receipt,
  });
  return result;
});
