import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import {
  RuntimeContractError,
  RuntimeActorExtensionBindingStatePort,
  RuntimeCommandStatePort,
  RuntimeEpisodeStatePort,
  RuntimeQueueStatePort,
  RuntimeRequestStatePort,
  RuntimeToolExecutionError,
  RuntimeThreadStatePort,
  RuntimeTranscriptStatePort,
  RuntimeTurnStatePort,
  type ActorBinding,
  type ActorKind,
  type CommandId,
  type ExtensionHandlerResult,
  type MessageId,
  type NativeToolResult,
  type PiRuntimeEvent,
  type PromptExecutionContext,
  type RuntimePromptBindingRecord,
  type RuntimeCommandRecord,
  type RuntimeCommandStatePortService,
  type RuntimeActorExtensionBindingStatePortService,
  type RuntimeEpisodeStatePortService,
  type RuntimeQueueStatePortService,
  type RuntimeRequestStatePortService,
  type RuntimeSurfaceMessageRecord,
  type RuntimeSurfaceTarget,
  type RuntimeThreadStatePortService,
  type RuntimeSubmittedMessage,
  type RuntimeTranscriptStatePortService,
  type RuntimeTranscriptStreamCursor,
  type RuntimeTurnRecord,
  type RuntimeTurnStatePortService,
  type RunPiTurnInput,
  type StateContractError,
  type StateMutationResult,
  type SurfaceStreamGenerationId,
  type ToolCallId,
  type ToolItemId,
  type TurnId,
  type WorkspaceId,
} from "@svvy/core";
import {
  decodeRequestUserInputInputEffect,
  Extensions,
  type CommandInvocationContext,
  type ExtensionInvocation,
} from "@svvy/extensions";
import type { RuntimeAcceptedNativeToolExecutionService } from "./accepted-native-tool-execution-service";
import { RuntimeEventBus } from "./runtime-event-bus";
import { createPromptExecutionContext } from "./prompt-execution-context";
import { RuntimeSurfaceEventPublisher } from "./runtime-surface-event-publisher";
import { RuntimeSurfaceRuntimeService } from "./surface-runtime-scope-service";
import {
  applyExtensionRuntimeOperations,
  RuntimeExecutionPlanExecutor,
  RuntimeQueueInsertPostCommitLane,
} from "./runtime-effect-requests";
import { RuntimeSourceInvalidationService } from "./runtime-source-invalidation-service";

export type RuntimePromptExecutionInput = {
  readonly workspaceId: WorkspaceId;
  readonly target: RuntimeSurfaceTarget;
  readonly claimedMessage: RuntimeSurfaceMessageRecord;
  readonly turn: RuntimeTurnRecord;
  readonly promptContext: PromptExecutionContext;
  readonly piTurnInput: RunPiTurnInput;
};

export type RuntimePromptCommandReceipt = {
  readonly commandId: CommandId;
  readonly status: "completed" | "failed" | "cancelled";
};

export type RuntimePromptExecutionResult = {
  readonly queueItemId: RuntimeSurfaceMessageRecord["id"];
  readonly turnId: TurnId;
  readonly status: "completed" | "failed" | "cancelled";
  readonly assistantText: string;
  readonly commandReceipts: readonly RuntimePromptCommandReceipt[];
};

export interface RuntimePromptExecutionServiceService {
  executeClaimedPrompt(
    input: RuntimePromptExecutionInput,
  ): Effect.Effect<
    RuntimePromptExecutionResult,
    RuntimeContractError,
    RuntimeSurfaceRuntimeService
  >;
}

export class RuntimePromptExecutionService extends Context.Service<
  RuntimePromptExecutionService,
  RuntimePromptExecutionServiceService
>()("@svvy/runtime/RuntimePromptExecutionService") {}

export const layerRuntimePromptExecutionService = Layer.effect(
  RuntimePromptExecutionService,
  Effect.gen(function* () {
    const surfaceEvents = yield* RuntimeSurfaceEventPublisher;
    const turnState = yield* RuntimeTurnStatePort;
    const transcriptState = yield* RuntimeTranscriptStatePort;
    const commandState = yield* RuntimeCommandStatePort;
    const eventBus = yield* RuntimeEventBus;

    return RuntimePromptExecutionService.of({
      executeClaimedPrompt: (input) =>
        Effect.gen(function* () {
          const surface = yield* RuntimeSurfaceRuntimeService;
          const streamGenerationId = streamGenerationIdForTurn(input.turn.id);
          const transcript = yield* transcriptState
            .readSurfaceTranscript({
              surfacePiSessionId: input.target.surfacePiSessionId,
            })
            .pipe(
              Effect.mapError((cause) =>
                runtimeStateError("runtime.prompt.readSurfaceTranscript", cause),
              ),
            );
          let state = initialPromptExecutionState(
            input,
            streamGenerationId,
            transcript.streamCursor,
          );
          state = yield* advanceTranscriptCursorAndPublishPatch({
            state,
            transcriptState,
            surfaceEvents,
            eventBus,
            patch: {
              type: "prompt_status",
              turnId: input.turn.id as TurnId,
              status: "running",
            },
          });

          const turnStream = yield* surface.runPiTurn(input.piTurnInput);
          const result = yield* turnStream.stream.pipe(
            Stream.runForEach((event) =>
              handlePiRuntimeEvent({
                state,
                event,
                surfaceEvents,
                turnState,
                transcriptState,
                commandState,
                eventBus,
              }).pipe(
                Effect.tap((nextState) =>
                  Effect.sync(() => {
                    state = nextState;
                  }),
                ),
              ),
            ),
            Effect.andThen(() =>
              state.result
                ? Effect.succeed(state)
                : settlePromptTurn({
                    state,
                    status: "completed",
                    turnState,
                    transcriptState,
                    commandState,
                    eventBus,
                    surfaceEvents,
                  }),
            ),
            Effect.ensuring(turnStream.close().pipe(Effect.ignore)),
            Effect.catch((cause: unknown) =>
              settlePromptFailure({
                state,
                turnState,
                transcriptState,
                commandState,
                eventBus,
                surfaceEvents,
                error: cause,
              }),
            ),
          );
          return result.result!;
        }),
    });
  }),
);

export function buildRuntimePromptExecutionContext(input: {
  readonly target: RuntimeSurfaceTarget;
  readonly turn: RuntimeTurnRecord;
  readonly binding: RuntimePromptBindingRecord;
  readonly claimedMessage: RuntimeSurfaceMessageRecord;
}): PromptExecutionContext {
  const workflowRunId =
    input.target.surface === "workflow-task" ? input.target.workflowRunId : undefined;
  return createPromptExecutionContext({
    workspaceSessionId: input.target.workspaceSessionId,
    turnId: input.turn.id as TurnId,
    surfacePiSessionId: input.target.surfacePiSessionId,
    threadId:
      input.target.surface === "handler" || input.target.surface === "workflow-task"
        ? input.target.threadId
        : null,
    workflowTaskAttemptId:
      input.target.surface === "workflow-task" ? input.target.workflowTaskAttemptId : null,
    ...(workflowRunId === undefined ? {} : { workflowRunId }),
    surfaceKind: input.target.surface,
    loadedExtensionIds: input.binding.loadedExtensionIds,
    availableExtensionIds: input.binding.availableExtensionIds,
    externalInstructionSources: [],
    generatedAgentContextFingerprint: input.binding.generatedAgentContextFingerprint,
    generatedAgentContextRevision: String(input.binding.generatedAgentContextRevision) as never,
    queueItemId: input.claimedMessage.id,
  });
}

export function buildRuntimePiTurnInput(input: {
  readonly target: RuntimeSurfaceTarget;
  readonly turn: RuntimeTurnRecord;
  readonly binding: RuntimePromptBindingRecord;
  readonly claimedMessage: RuntimeSurfaceMessageRecord;
  readonly message: RuntimeSubmittedMessage;
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly tools: RunPiTurnInput["tools"];
  readonly toolExecutor: RunPiTurnInput["toolExecutor"];
}): RunPiTurnInput {
  return {
    session: { surfacePiSessionId: input.target.surfacePiSessionId },
    turnId: input.turn.id as TurnId,
    surfacePiSessionId: input.target.surfacePiSessionId,
    userMessage: input.message,
    userMessageSubmittedAt: input.claimedMessage
      .createdAt as RunPiTurnInput["userMessageSubmittedAt"],
    systemPromptBinding: {
      fingerprint: input.binding.generatedAgentContextFingerprint,
      revision: String(input.binding.generatedAgentContextRevision) as never,
      text: input.binding.systemPrompt,
    },
    model: {
      providerId: input.provider as never,
      modelId: input.model as never,
    },
    reasoning: {
      effort: input.reasoningEffort as never,
    },
    tools: input.tools,
    toolExecutor: input.toolExecutor,
  };
}

export function parseRuntimeSubmittedMessage(
  queued: RuntimeSurfaceMessageRecord,
): RuntimeSubmittedMessage {
  const parsed = JSON.parse(queued.messageJson) as RuntimeSubmittedMessage;
  if (typeof parsed.text !== "string") {
    throw new Error(`Queued surface message ${queued.id} has no submitted text.`);
  }
  return parsed;
}

export function actorKindForRuntimeSurfaceTarget(target: RuntimeSurfaceTarget): ActorKind {
  return target.surface;
}

export function extensionInvocationTarget(target: RuntimeSurfaceTarget) {
  if (target.surface === "orchestrator") {
    return {
      kind: "orchestrator" as const,
      workspaceSessionId: target.workspaceSessionId,
      surfacePiSessionId: target.surfacePiSessionId,
    };
  }
  if (target.surface === "handler") {
    return {
      kind: "handler" as const,
      workspaceSessionId: target.workspaceSessionId,
      threadId: target.threadId,
      surfacePiSessionId: target.surfacePiSessionId,
    };
  }
  return {
    kind: "workflow-task" as const,
    workspaceSessionId: target.workspaceSessionId,
    workflowTaskAttemptId: target.workflowTaskAttemptId,
    surfacePiSessionId: target.surfacePiSessionId,
  };
}

export function actorBindingFromRuntimePromptBinding(
  target: RuntimeSurfaceTarget,
  binding: RuntimePromptBindingRecord,
): ActorBinding {
  return {
    actorKind: actorKindForRuntimeSurfaceTarget(target),
    loadedExtensionIds: [...binding.loadedExtensionIds],
    availableExtensionIds: [...binding.availableExtensionIds],
    unavailableExtensionIds: [],
    instructionOrder: [
      ...new Set([...binding.loadedExtensionIds, ...binding.availableExtensionIds]),
    ],
    source: "surface-binding",
  };
}

export function buildRuntimeToolExecutor(input: {
  readonly acceptedNativeTools: Pick<
    RuntimeAcceptedNativeToolExecutionService,
    "runRequestUserInput"
  >;
  readonly extensions: Extensions["Service"];
  readonly target: RuntimeSurfaceTarget;
  readonly actorBinding: ActorBinding;
  readonly promptContext: PromptExecutionContext;
  readonly commandState: RuntimeCommandStatePortService;
  readonly requestState: RuntimeRequestStatePortService;
  readonly actorBindingState: RuntimeActorExtensionBindingStatePortService;
  readonly episodeState: RuntimeEpisodeStatePortService;
  readonly threadState: RuntimeThreadStatePortService;
  readonly queueState: RuntimeQueueStatePortService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly sourceInvalidation: RuntimeSourceInvalidationService["Service"];
}): RunPiTurnInput["toolExecutor"] {
  return (toolInput) =>
    Effect.gen(function* () {
      const command = yield* createOrReuseToolCommand({
        target: input.target,
        commandState: input.commandState,
        eventBus: input.eventBus,
        toolCallId: toolInput.piToolCallId,
        toolName: toolInput.toolName,
        turnId: toolInput.turnId,
        arguments: parseToolArguments(toolInput.argumentsJson),
      }).pipe(
        Effect.mapError((cause) =>
          runtimeToolExecutionError(toolInput, "state-conflict", cause.message, cause),
        ),
      );
      yield* toolInput.emit({
        type: "accepted",
        commandId: command.id as CommandId,
        acceptedAt: command.startedAt as never,
      });

      const startedCommand = yield* publishCommandMutation(
        "runtime.prompt.tool.startCommand",
        input.commandState.startCommand({ commandId: command.id }),
        input.eventBus,
      ).pipe(
        Effect.mapError((cause) =>
          runtimeToolExecutionError(toolInput, "state-conflict", cause.message, cause),
        ),
      );

      const args = parseToolArguments(toolInput.argumentsJson);
      if (toolInput.toolName === "request_user_input") {
        if (input.target.surface === "workflow-task") {
          return yield* Effect.fail(
            runtimeToolExecutionError(
              toolInput,
              "extension-failed",
              "request_user_input is unavailable on workflow task surfaces.",
            ),
          );
        }
        const commandContext = {
          commandId: command.id as CommandId,
          target: input.target,
          turnId: toolInput.turnId,
          approvalMode: "auto-review" as const,
          sandbox: { snapshot: {} },
          cwd: "",
          baseEnv: {},
        };
        const requestArguments = yield* decodeRequestUserInputInputEffect(args).pipe(
          Effect.mapError((cause) =>
            runtimeToolExecutionError(toolInput, "invalid-arguments", cause.message, cause),
          ),
        );
        const executed = yield* input.acceptedNativeTools
          .runRequestUserInput({
            toolCallId: toolInput.piToolCallId,
            toolItemId: toolInput.piToolCallId as unknown as ToolItemId,
            arguments: requestArguments,
            context: input.promptContext,
            actorBinding: input.actorBinding,
            command: commandContext,
            commandRecord: startedCommand,
          })
          .pipe(
            Effect.mapError((cause) =>
              runtimeToolExecutionError(toolInput, "runtime-effect-failed", cause.message, cause),
            ),
          );
        return executed.toolResult;
      }
      const commandContext: CommandInvocationContext = {
        commandId: command.id as CommandId,
        target: input.target,
        turnId: toolInput.turnId,
        approvalMode: "auto-review",
        sandbox: { snapshot: {} },
        cwd: "",
        baseEnv: {},
      };
      const handler = yield* input.extensions.nativeTools
        .handler({
          toolName: toolInput.toolName,
          actorKind: input.actorBinding.actorKind,
          actorBinding: input.actorBinding,
          target: extensionInvocationTarget(input.target),
          extensionUsageSource: "surface-binding",
        })
        .pipe(
          Effect.mapError((cause) =>
            runtimeToolExecutionError(toolInput, "extension-failed", cause.message, cause),
          ),
        );
      const result: ExtensionHandlerResult = yield* handler
        .invoke({
          toolCallId: toolInput.piToolCallId,
          toolName: toolInput.toolName,
          arguments: {
            schemaId: toolInput.toolName,
            value: args,
          },
          context: input.promptContext,
          actorBinding: input.actorBinding,
          command: commandContext,
        } satisfies ExtensionInvocation)
        .pipe(
          Effect.mapError((cause) =>
            runtimeToolExecutionError(toolInput, "extension-failed", cause.message, cause),
          ),
        );

      yield* applyExtensionRuntimeOperations(
        {
          target: input.target as never,
          turnId: toolInput.turnId,
          toolItemId: toolInput.piToolCallId as never,
          commandId: command.id as CommandId,
          commandContext,
          promptExecutionContext: input.promptContext,
        },
        result.operations ?? [],
      ).pipe(
        Effect.provideService(
          RuntimeQueueInsertPostCommitLane,
          RuntimeQueueInsertPostCommitLane.of({ afterQueueInsertCommitted: () => Effect.void }),
        ),
        Effect.provideService(RuntimeQueueStatePort, input.queueState),
        Effect.provideService(RuntimeRequestStatePort, input.requestState),
        Effect.provideService(RuntimeActorExtensionBindingStatePort, input.actorBindingState),
        Effect.provideService(RuntimeEpisodeStatePort, input.episodeState),
        Effect.provideService(RuntimeThreadStatePort, input.threadState),
        Effect.provideService(RuntimeEventBus, input.eventBus),
        Effect.provideService(RuntimeSourceInvalidationService, input.sourceInvalidation),
        Effect.provideService(Extensions, input.extensions),
        Effect.provideService(
          RuntimeExecutionPlanExecutor,
          RuntimeExecutionPlanExecutor.of({
            execute: (planInput) =>
              Effect.fail(
                new RuntimeContractError({
                  operation: "runtime.executionPlan.execute",
                  reason: "unsupported-operation",
                  message: `Runtime execution plan ${planInput.plan.type} has no composed execution lane.`,
                }),
              ),
          }),
        ),
        Effect.mapError((cause) =>
          runtimeToolExecutionError(toolInput, "runtime-effect-failed", cause.message, cause),
        ),
      );

      yield* publishCommandMutation(
        "runtime.prompt.tool.finishCommand",
        input.commandState.finishCommand({
          commandId: command.id,
          status: "succeeded",
          summary: toolResultSummary(result.result),
          facts: toolResultFacts(result.result),
        }),
        input.eventBus,
      ).pipe(
        Effect.mapError((cause) =>
          runtimeToolExecutionError(toolInput, "state-conflict", cause.message, cause),
        ),
      );

      return result.result as NativeToolResult;
    });
}

type PromptExecutionState = {
  readonly input: RuntimePromptExecutionInput;
  readonly streamGenerationId: SurfaceStreamGenerationId;
  readonly cursor: RuntimeTranscriptStreamCursor | null;
  readonly assistantMessageId: MessageId | null;
  readonly activeAssistantMessageId: MessageId | null;
  readonly assistantMessageIds: Readonly<Record<string, MessageId>>;
  readonly assistantText: string;
  readonly commandReceipts: readonly RuntimePromptCommandReceipt[];
  readonly toolCommandIds: Readonly<Record<string, CommandId>>;
  readonly toolArgumentsJson: Readonly<Record<string, string>>;
  readonly result: RuntimePromptExecutionResult | null;
};

function initialPromptExecutionState(
  input: RuntimePromptExecutionInput,
  streamGenerationId: SurfaceStreamGenerationId,
  cursor: RuntimeTranscriptStreamCursor | null,
): PromptExecutionState {
  return {
    input,
    streamGenerationId,
    cursor,
    assistantMessageId: null,
    activeAssistantMessageId: null,
    assistantMessageIds: {},
    assistantText: "",
    commandReceipts: [],
    toolCommandIds: {},
    toolArgumentsJson: {},
    result: null,
  };
}

function handlePiRuntimeEvent(input: {
  readonly state: PromptExecutionState;
  readonly event: PiRuntimeEvent;
  readonly surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
  readonly turnState: RuntimeTurnStatePortService;
  readonly transcriptState: RuntimeTranscriptStatePortService;
  readonly commandState: RuntimeCommandStatePortService;
  readonly eventBus: RuntimeEventBus["Service"];
}): Effect.Effect<PromptExecutionState, RuntimeContractError> {
  const { state, event } = input;
  if (state.result) {
    return Effect.succeed(state);
  }
  switch (event.type) {
    case "pi.user_message.committed":
      return Effect.gen(function* () {
        const committed = yield* input.transcriptState
          .commitUserMessage({
            workspaceSessionId: state.input.target.workspaceSessionId,
            surfacePiSessionId: state.input.target.surfacePiSessionId,
            turnId: state.input.turn.id as TurnId,
            queueItemId: state.input.claimedMessage.id as never,
            message: state.input.piTurnInput.userMessage,
            submittedAt: state.input.claimedMessage.createdAt as never,
            committedAt: event.committedAt,
            streamGenerationId: state.streamGenerationId,
            expectedCursor: state.cursor,
          })
          .pipe(
            Effect.mapError((cause) =>
              runtimeStateError("runtime.prompt.transcript.commitUserMessage", cause),
            ),
          );
        if (event.piHistoryEntry) {
          yield* input.transcriptState
            .bindPiHistoryEntry({
              messageId: committed.value.message.messageId,
              piHistoryEntry: {
                ...event.piHistoryEntry,
                messageId: committed.value.message.messageId,
              },
            })
            .pipe(
              Effect.mapError((cause) =>
                runtimeStateError("runtime.prompt.transcript.bindUserPiHistory", cause),
              ),
            );
        }
        yield* publishCommittedTranscriptPatch({
          state,
          mutation: committed,
          surfaceEvents: input.surfaceEvents,
          eventBus: input.eventBus,
          patch: {
            type: "user_message_committed",
            messageId: committed.value.message.messageId,
            queueItemId: state.input.claimedMessage.id as never,
            message: state.input.piTurnInput.userMessage,
            submittedAt: state.input.claimedMessage.createdAt as never,
          },
        });
        return { ...state, cursor: committed.value.cursor };
      });
    case "pi.assistant_message.started":
      return Effect.gen(function* () {
        const begun = yield* input.transcriptState
          .beginAssistantMessage({
            workspaceSessionId: state.input.target.workspaceSessionId,
            surfacePiSessionId: state.input.target.surfacePiSessionId,
            turnId: state.input.turn.id as TurnId,
            api: event.api,
            providerId: event.providerId,
            modelId: event.modelId,
            startedAt: event.startedAt,
            streamGenerationId: state.streamGenerationId,
            expectedCursor: state.cursor,
          })
          .pipe(
            Effect.mapError((cause) =>
              runtimeStateError("runtime.prompt.transcript.beginAssistantMessage", cause),
            ),
          );
        const messageId = begun.value.message.messageId;
        yield* publishCommittedTranscriptPatch({
          state,
          mutation: begun,
          surfaceEvents: input.surfaceEvents,
          eventBus: input.eventBus,
          patch: {
            type: "assistant_message_started",
            messageId,
            turnId: state.input.turn.id as TurnId,
            createdAt: event.startedAt,
          },
        });
        return {
          ...state,
          cursor: begun.value.cursor,
          assistantMessageId: messageId,
          activeAssistantMessageId: messageId,
          assistantMessageIds: {
            ...state.assistantMessageIds,
            [event.piMessageRef]: messageId,
          },
        };
      });
    case "pi.assistant_message.committed":
      return Effect.gen(function* () {
        const messageId = yield* assistantMessageIdForPiRef(state, event.piMessageRef);
        const piHistoryEntry = event.piHistoryEntry ? { ...event.piHistoryEntry, messageId } : null;
        const terminalInput = {
          messageId,
          surfacePiSessionId: state.input.target.surfacePiSessionId,
          streamGenerationId: state.streamGenerationId,
          expectedCursor: state.cursor,
          api: event.api,
          providerId: event.providerId,
          modelId: event.modelId,
          responseId: event.responseId,
          usage: event.usage,
          stopReason: event.stopReason,
          errorMessage: event.errorMessage,
          piHistoryEntry,
          messageTimestamp: event.messageTimestamp,
          finishedAt: event.finishedAt,
        } as const;
        const committed = yield* (
          event.stopReason === "error" || event.stopReason === "aborted"
            ? input.transcriptState.failAssistantMessage({
                ...terminalInput,
                status: event.stopReason === "aborted" ? "cancelled" : "failed",
              })
            : input.transcriptState.commitAssistantMessage({
                ...terminalInput,
                content: event.content,
              })
        ).pipe(
          Effect.mapError((cause) =>
            runtimeStateError("runtime.prompt.transcript.commitAssistantMessage", cause),
          ),
        );
        const status = committed.value.message.status;
        yield* publishCommittedTranscriptPatch({
          state,
          mutation: committed,
          surfaceEvents: input.surfaceEvents,
          eventBus: input.eventBus,
          patch: {
            type: "assistant_message_finished",
            messageId,
            status:
              status === "completed"
                ? "completed"
                : status === "cancelled"
                  ? "cancelled"
                  : "failed",
            finishedAt: event.finishedAt,
          },
        });
        return {
          ...state,
          cursor: committed.value.cursor,
          assistantMessageId: messageId,
          activeAssistantMessageId: null,
          assistantText: event.content
            .filter((block) => block.kind === "text")
            .map((block) => block.text)
            .join(""),
        };
      });
    case "pi.assistant.text.delta":
      return Effect.gen(function* () {
        const messageId = yield* assistantMessageIdForPiRef(state, event.piMessageRef);
        const appended = yield* input.transcriptState
          .appendAssistantContentDelta({
            messageId,
            surfacePiSessionId: state.input.target.surfacePiSessionId,
            streamGenerationId: state.streamGenerationId,
            expectedCursor: state.cursor,
            contentIndex: event.contentIndex,
            kind: "text",
            delta: event.delta,
          })
          .pipe(
            Effect.mapError((cause) =>
              runtimeStateError("runtime.prompt.transcript.appendAssistantText", cause),
            ),
          );
        yield* publishCommittedTranscriptPatch({
          state,
          mutation: appended,
          surfaceEvents: input.surfaceEvents,
          eventBus: input.eventBus,
          patch: {
            type: "assistant_text_delta",
            messageId,
            contentIndex: event.contentIndex,
            delta: event.delta,
          },
        });
        return {
          ...state,
          cursor: appended.value.cursor,
          assistantMessageId: messageId,
          assistantText: state.assistantText + event.delta,
        };
      });
    case "pi.assistant.thinking.delta":
      return Effect.gen(function* () {
        const messageId = yield* assistantMessageIdForPiRef(state, event.piMessageRef);
        const appended = yield* input.transcriptState
          .appendAssistantContentDelta({
            messageId,
            surfacePiSessionId: state.input.target.surfacePiSessionId,
            streamGenerationId: state.streamGenerationId,
            expectedCursor: state.cursor,
            contentIndex: event.contentIndex,
            kind: "thinking",
            delta: event.delta,
          })
          .pipe(
            Effect.mapError((cause) =>
              runtimeStateError("runtime.prompt.transcript.appendAssistantThinking", cause),
            ),
          );
        yield* publishCommittedTranscriptPatch({
          state,
          mutation: appended,
          surfaceEvents: input.surfaceEvents,
          eventBus: input.eventBus,
          patch: {
            type: "assistant_thinking_delta",
            messageId,
            contentIndex: event.contentIndex,
            delta: event.delta,
          },
        });
        return {
          ...state,
          cursor: appended.value.cursor,
          assistantMessageId: messageId,
        };
      });
    case "pi.tool_call.started":
      return Effect.gen(function* () {
        const messageId = yield* assistantMessageIdForPiRef(state, event.piMessageRef);
        const command = yield* createOrReuseToolCommand({
          target: state.input.target,
          commandState: input.commandState,
          eventBus: input.eventBus,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          turnId: event.turnId,
        });
        const upserted = yield* input.transcriptState
          .upsertAssistantToolCall({
            messageId,
            surfacePiSessionId: state.input.target.surfacePiSessionId,
            streamGenerationId: state.streamGenerationId,
            expectedCursor: state.cursor,
            contentIndex: event.contentIndex,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            argumentsJson: "",
            argumentsStatus: "streaming",
          })
          .pipe(
            Effect.mapError((cause) =>
              runtimeStateError("runtime.prompt.transcript.startToolCall", cause),
            ),
          );
        yield* publishCommittedTranscriptPatch({
          state,
          mutation: upserted,
          surfaceEvents: input.surfaceEvents,
          eventBus: input.eventBus,
          patch: {
            type: "tool_arguments_snapshot",
            messageId,
            toolCallId: event.toolCallId,
            commandId: command.id as CommandId,
            contentIndex: event.contentIndex,
            snapshotRef: event.toolCallId as never,
          },
        });
        const linked = yield* input.transcriptState
          .linkAssistantToolCallCommand({
            messageId,
            surfacePiSessionId: state.input.target.surfacePiSessionId,
            streamGenerationId: state.streamGenerationId,
            expectedCursor: upserted.value.cursor,
            contentIndex: event.contentIndex,
            toolCallId: event.toolCallId,
            commandId: command.id as CommandId,
          })
          .pipe(
            Effect.mapError((cause) =>
              runtimeStateError("runtime.prompt.transcript.linkToolCommand", cause),
            ),
          );
        yield* publishCommittedTranscriptPatch({
          state: { ...state, cursor: upserted.value.cursor },
          mutation: linked,
          surfaceEvents: input.surfaceEvents,
          eventBus: input.eventBus,
          patch: {
            type: "active_command",
            messageId,
            toolCallId: event.toolCallId,
            commandId: command.id as CommandId,
            contentIndex: event.contentIndex,
            status: "accepted",
          },
        });
        return {
          ...state,
          cursor: linked.value.cursor,
          assistantMessageId: messageId,
          toolCommandIds: {
            ...state.toolCommandIds,
            [event.toolCallId]: command.id as CommandId,
          },
          toolArgumentsJson: {
            ...state.toolArgumentsJson,
            [event.toolCallId]: "",
          },
        };
      });
    case "pi.tool_call.arguments.delta":
      return Effect.gen(function* () {
        const messageId = yield* assistantMessageIdForPiRef(state, event.piMessageRef);
        const command = yield* createOrReuseToolCommand({
          target: state.input.target,
          commandState: input.commandState,
          eventBus: input.eventBus,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          turnId: event.turnId,
        });
        const argumentsJson = (state.toolArgumentsJson[event.toolCallId] ?? "") + event.delta;
        yield* publishCommandMutation(
          "runtime.prompt.tool.argumentsDelta",
          input.commandState.recordCommandEvent({
            sessionId: state.input.target.workspaceSessionId,
            commandId: command.id,
            kind: "command.arg_snapshot",
            data: {
              source: "pi-tool-call",
              arguments: {
                toolCallId: event.toolCallId,
                argumentsJson,
                contentIndex: event.contentIndex,
              },
            },
          }),
          input.eventBus,
        );
        const upserted = yield* input.transcriptState
          .upsertAssistantToolCall({
            messageId,
            surfacePiSessionId: state.input.target.surfacePiSessionId,
            streamGenerationId: state.streamGenerationId,
            expectedCursor: state.cursor,
            contentIndex: event.contentIndex,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            argumentsJson,
            argumentsStatus: "streaming",
          })
          .pipe(
            Effect.mapError((cause) =>
              runtimeStateError("runtime.prompt.transcript.updateToolArguments", cause),
            ),
          );
        yield* publishCommittedTranscriptPatch({
          state,
          mutation: upserted,
          surfaceEvents: input.surfaceEvents,
          eventBus: input.eventBus,
          patch: {
            type: "tool_arguments_snapshot",
            messageId,
            toolCallId: event.toolCallId,
            commandId: command.id as CommandId,
            contentIndex: event.contentIndex,
            snapshotRef: event.toolCallId as never,
          },
        });
        return {
          ...state,
          cursor: upserted.value.cursor,
          assistantMessageId: messageId,
          toolCommandIds: {
            ...state.toolCommandIds,
            [event.toolCallId]: command.id as CommandId,
          },
          toolArgumentsJson: {
            ...state.toolArgumentsJson,
            [event.toolCallId]: argumentsJson,
          },
        };
      });
    case "pi.tool_call.accepted":
      return Effect.gen(function* () {
        const messageId = yield* assistantMessageIdForPiRef(state, event.piMessageRef);
        const argumentsJson =
          event.argumentsJson ?? state.toolArgumentsJson[event.toolCallId] ?? "{}";
        const command = yield* createOrReuseToolCommand({
          target: state.input.target,
          commandState: input.commandState,
          eventBus: input.eventBus,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          turnId: event.turnId,
          arguments: parseToolArguments(argumentsJson),
        });
        const upserted = yield* input.transcriptState
          .upsertAssistantToolCall({
            messageId,
            surfacePiSessionId: state.input.target.surfacePiSessionId,
            streamGenerationId: state.streamGenerationId,
            expectedCursor: state.cursor,
            contentIndex: event.contentIndex,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            argumentsJson,
            argumentsStatus: "accepted",
          })
          .pipe(
            Effect.mapError((cause) =>
              runtimeStateError("runtime.prompt.transcript.acceptToolArguments", cause),
            ),
          );
        yield* publishCommittedTranscriptPatch({
          state,
          mutation: upserted,
          surfaceEvents: input.surfaceEvents,
          eventBus: input.eventBus,
          patch: {
            type: "tool_arguments_snapshot",
            messageId,
            toolCallId: event.toolCallId,
            commandId: command.id as CommandId,
            contentIndex: event.contentIndex,
            snapshotRef: event.toolCallId as never,
          },
        });
        let cursor = upserted.value.cursor;
        if (!state.toolCommandIds[event.toolCallId]) {
          const linked = yield* input.transcriptState
            .linkAssistantToolCallCommand({
              messageId,
              surfacePiSessionId: state.input.target.surfacePiSessionId,
              streamGenerationId: state.streamGenerationId,
              expectedCursor: cursor,
              contentIndex: event.contentIndex,
              toolCallId: event.toolCallId,
              commandId: command.id as CommandId,
            })
            .pipe(
              Effect.mapError((cause) =>
                runtimeStateError("runtime.prompt.transcript.linkAcceptedToolCommand", cause),
              ),
            );
          yield* publishCommittedTranscriptPatch({
            state: { ...state, cursor },
            mutation: linked,
            surfaceEvents: input.surfaceEvents,
            eventBus: input.eventBus,
            patch: {
              type: "active_command",
              messageId,
              toolCallId: event.toolCallId,
              commandId: command.id as CommandId,
              contentIndex: event.contentIndex,
              status: "accepted",
            },
          });
          cursor = linked.value.cursor;
        }
        return {
          ...state,
          cursor,
          assistantMessageId: messageId,
          toolCommandIds: {
            ...state.toolCommandIds,
            [event.toolCallId]: command.id as CommandId,
          },
          toolArgumentsJson: {
            ...state.toolArgumentsJson,
            [event.toolCallId]: argumentsJson,
          },
        };
      });
    case "pi.tool_execution.started":
      return resolveToolCommandId(state, input.commandState, event.toolCallId).pipe(
        Effect.andThen((commandId) =>
          publishCommandMutation(
            "runtime.prompt.tool.executionStarted",
            input.commandState.startCommand({ commandId }),
            input.eventBus,
          ).pipe(Effect.as(state)),
        ),
      );
    case "pi.tool_execution.updated":
      return resolveToolCommandId(state, input.commandState, event.toolCallId).pipe(
        Effect.andThen((commandId) =>
          publishCommandMutation(
            "runtime.prompt.tool.executionUpdated",
            input.commandState.recordCommandEvent({
              sessionId: state.input.target.workspaceSessionId,
              commandId,
              kind:
                "update" in event && event.update.type === "progress"
                  ? "command.progress"
                  : "command.output",
              data:
                "update" in event && event.update.type === "progress"
                  ? {
                      source: "pi-tool-execution",
                      message: event.update.message,
                    }
                  : {
                      stream: "stdout",
                      source: "pi-tool-execution",
                      text: "result" in event ? toolResultSummary(event.result) : "",
                    },
            }),
            input.eventBus,
          ).pipe(Effect.as(state)),
        ),
      );
    case "pi.tool_execution.finished":
      return resolveToolCommandId(state, input.commandState, event.toolCallId).pipe(
        Effect.andThen((commandId) =>
          publishCommandMutation(
            "runtime.prompt.tool.executionFinished",
            input.commandState.finishCommand({
              commandId,
              status:
                event.status === "completed"
                  ? "succeeded"
                  : event.status === "cancelled"
                    ? "cancelled"
                    : "failed",
              summary: event.error ?? toolResultSummary(event.result),
              ...(event.result ? { facts: toolResultFacts(event.result) } : {}),
              ...(event.error ? { error: event.error } : {}),
            }),
            input.eventBus,
          ).pipe(
            Effect.as({
              ...state,
              commandReceipts: [
                ...state.commandReceipts,
                {
                  commandId,
                  status: event.status,
                },
              ],
            }),
          ),
        ),
      );
    case "pi.turn.finished":
      return Effect.succeed(state);
    case "pi.agent.finished":
      return settlePromptTurn({
        state,
        status: event.status,
        turnState: input.turnState,
        transcriptState: input.transcriptState,
        commandState: input.commandState,
        eventBus: input.eventBus,
        surfaceEvents: input.surfaceEvents,
      });
  }
}

function settlePromptTurn(input: {
  readonly state: PromptExecutionState;
  readonly status: "completed" | "failed" | "cancelled";
  readonly turnState: RuntimeTurnStatePortService;
  readonly transcriptState: RuntimeTranscriptStatePortService;
  readonly commandState: RuntimeCommandStatePortService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
  readonly errorMessage?: string;
}): Effect.Effect<PromptExecutionState, RuntimeContractError> {
  return Effect.gen(function* () {
    let state = input.state;
    let status = input.status;
    const settledCommandIds = new Set(state.commandReceipts.map((receipt) => receipt.commandId));
    const danglingCommandReceipts: RuntimePromptCommandReceipt[] = [];
    const danglingCommandIds: CommandId[] = [];
    for (const commandId of new Set(Object.values(state.toolCommandIds))) {
      if (settledCommandIds.has(commandId)) continue;
      const command = yield* input.commandState
        .findCommandById({ commandId })
        .pipe(
          Effect.mapError((cause) =>
            runtimeStateError("runtime.prompt.findDanglingCommand", cause),
          ),
        );
      if (!command || ["succeeded", "failed", "cancelled"].includes(command.status)) continue;
      const commandStatus = input.status === "cancelled" ? "cancelled" : "failed";
      danglingCommandIds.push(commandId);
      danglingCommandReceipts.push({ commandId, status: commandStatus });
    }
    if (danglingCommandReceipts.length > 0) {
      state = {
        ...state,
        commandReceipts: [...state.commandReceipts, ...danglingCommandReceipts],
      };
      if (status === "completed") status = "failed";
    }
    if (state.activeAssistantMessageId) {
      const finishedAt = DateTime.formatIso(yield* DateTime.now) as never;
      const failed = yield* input.transcriptState
        .failAssistantMessage({
          messageId: state.activeAssistantMessageId,
          surfacePiSessionId: state.input.target.surfacePiSessionId,
          streamGenerationId: state.streamGenerationId,
          expectedCursor: state.cursor,
          api: null,
          providerId: state.input.piTurnInput.model.providerId,
          modelId: state.input.piTurnInput.model.modelId,
          responseId: null,
          usage: null,
          stopReason: input.status === "cancelled" ? "aborted" : "error",
          errorMessage:
            input.errorMessage ?? "Assistant stream ended without a committed terminal message.",
          piHistoryEntry: null,
          messageTimestamp: null,
          finishedAt,
          status: input.status === "cancelled" ? "cancelled" : "failed",
        })
        .pipe(
          Effect.mapError((cause) =>
            runtimeStateError("runtime.prompt.transcript.failActiveAssistant", cause),
          ),
        );
      yield* publishCommittedTranscriptPatch({
        state,
        mutation: failed,
        surfaceEvents: input.surfaceEvents,
        eventBus: input.eventBus,
        patch: {
          type: "assistant_message_finished",
          messageId: state.activeAssistantMessageId,
          status: input.status === "cancelled" ? "cancelled" : "failed",
          finishedAt,
        },
      });
      state = {
        ...state,
        cursor: failed.value.cursor,
        activeAssistantMessageId: null,
      };
      if (status === "completed") {
        status = "failed";
      }
    }
    const settlement = yield* input.turnState
      .settlePromptTurn({
        turnId: state.input.turn.id as TurnId,
        queueItemId: state.input.claimedMessage.id as never,
        status,
        ...(state.assistantMessageId ? { assistantMessageId: state.assistantMessageId } : {}),
        assistantText: state.assistantText,
        terminalCommandIds: danglingCommandIds,
        terminalCommandSummary: "Prompt execution ended before the tool run finished.",
        terminalCommandError: "Prompt execution ended before the tool run finished.",
        claimOwnerId: state.input.claimedMessage.claimOwnerId,
        leaseVersion: state.input.claimedMessage.leaseVersion,
      })
      .pipe(Effect.mapError((cause) => runtimeStateError("runtime.prompt.settleTurn", cause)));
    yield* input.eventBus
      .publishStateInvalidations({ afterCommit: settlement.afterCommit })
      .pipe(Effect.mapError((cause) => runtimeAdapterError("runtime.prompt.settleTurn", cause)));

    state = yield* advanceTranscriptCursorAndPublishPatch({
      state,
      transcriptState: input.transcriptState,
      surfaceEvents: input.surfaceEvents,
      eventBus: input.eventBus,
      patch: {
        type: "prompt_status",
        turnId: state.input.turn.id as TurnId,
        status,
      },
    });
    const result: RuntimePromptExecutionResult = {
      queueItemId: state.input.claimedMessage.id,
      turnId: state.input.turn.id as TurnId,
      status,
      assistantText: state.assistantText,
      commandReceipts: state.commandReceipts,
    };
    return { ...state, result };
  });
}

function settlePromptFailure(input: {
  readonly state: PromptExecutionState;
  readonly turnState: RuntimeTurnStatePortService;
  readonly transcriptState: RuntimeTranscriptStatePortService;
  readonly commandState: RuntimeCommandStatePortService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
  readonly error: unknown;
}): Effect.Effect<PromptExecutionState, RuntimeContractError> {
  return settlePromptTurn({
    state: input.state,
    status: "failed",
    turnState: input.turnState,
    transcriptState: input.transcriptState,
    commandState: input.commandState,
    eventBus: input.eventBus,
    surfaceEvents: input.surfaceEvents,
    errorMessage: input.error instanceof Error ? input.error.message : String(input.error),
  });
}

function assistantMessageIdForPiRef(
  state: PromptExecutionState,
  piMessageRef: string,
): Effect.Effect<MessageId, RuntimeContractError> {
  const messageId = state.assistantMessageIds[piMessageRef];
  return messageId
    ? Effect.succeed(messageId)
    : Effect.fail(
        new RuntimeContractError({
          operation: "runtime.prompt.transcript.resolveAssistantMessage",
          reason: "stream-failed",
          message: `Pi assistant message ${piMessageRef} emitted content before its durable start.`,
        }),
      );
}

function publishCommittedTranscriptPatch(input: {
  readonly state: PromptExecutionState;
  readonly mutation: StateMutationResult<{
    readonly cursor: RuntimeTranscriptStreamCursor;
  }>;
  readonly surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
  readonly eventBus: RuntimeEventBus["Service"];
  readonly patch: Parameters<
    RuntimeSurfaceEventPublisher["Service"]["publishStreamPatch"]
  >[0]["patch"];
}): Effect.Effect<void, RuntimeContractError> {
  return Effect.gen(function* () {
    // Transcript state is authoritative once committed. A later contiguous patch or surface
    // reopen exposes the gap and forces consumers to rebaseline from the durable read model.
    yield* input.eventBus
      .publishStateInvalidations({ afterCommit: input.mutation.afterCommit })
      .pipe(Effect.catch(() => Effect.void));
    yield* publishPatch({
      surfaceEvents: input.surfaceEvents,
      workspaceId: input.state.input.workspaceId,
      target: input.state.input.target,
      streamGenerationId: input.state.streamGenerationId,
      streamSequence: input.mutation.value.cursor.streamSequence,
      patch: input.patch,
    }).pipe(Effect.catch(() => Effect.void));
  });
}

function advanceTranscriptCursorAndPublishPatch(input: {
  readonly state: PromptExecutionState;
  readonly transcriptState: RuntimeTranscriptStatePortService;
  readonly surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
  readonly eventBus: RuntimeEventBus["Service"];
  readonly patch: Parameters<
    RuntimeSurfaceEventPublisher["Service"]["publishStreamPatch"]
  >[0]["patch"];
}): Effect.Effect<PromptExecutionState, RuntimeContractError> {
  return Effect.gen(function* () {
    const advanced = yield* input.transcriptState
      .advanceStreamCursor({
        surfacePiSessionId: input.state.input.target.surfacePiSessionId,
        streamGenerationId: input.state.streamGenerationId,
        expectedCursor: input.state.cursor,
      })
      .pipe(
        Effect.mapError((cause) =>
          runtimeStateError("runtime.prompt.transcript.advanceStreamCursor", cause),
        ),
      );
    // Cursor advancement is durable even when the renderer notification lane is unavailable.
    yield* input.eventBus
      .publishStateInvalidations({ afterCommit: advanced.afterCommit })
      .pipe(Effect.catch(() => Effect.void));
    yield* publishPatch({
      surfaceEvents: input.surfaceEvents,
      workspaceId: input.state.input.workspaceId,
      target: input.state.input.target,
      streamGenerationId: input.state.streamGenerationId,
      streamSequence: advanced.value.streamSequence,
      patch: input.patch,
    }).pipe(Effect.catch(() => Effect.void));
    return { ...input.state, cursor: advanced.value };
  });
}

function publishPatch(
  input: Parameters<RuntimeSurfaceEventPublisher["Service"]["publishStreamPatch"]>[0] & {
    readonly surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
  },
): Effect.Effect<void, RuntimeContractError> {
  return input.surfaceEvents
    .publishStreamPatch({
      workspaceId: input.workspaceId,
      target: input.target,
      streamGenerationId: input.streamGenerationId,
      ...(input.streamSequence === undefined ? {} : { streamSequence: input.streamSequence }),
      patch: input.patch,
    })
    .pipe(
      Effect.asVoid,
      Effect.mapError((cause) => runtimeAdapterError("runtime.prompt.publishStreamPatch", cause)),
    );
}

function createOrReuseToolCommand(input: {
  readonly target: RuntimeSurfaceTarget;
  readonly commandState: RuntimeCommandStatePortService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly toolCallId: ToolCallId;
  readonly toolName: string;
  readonly turnId: TurnId;
  readonly arguments?: unknown;
}): Effect.Effect<RuntimeCommandRecord, RuntimeContractError> {
  return publishCommandMutation(
    "runtime.prompt.tool.createOrReuseCommand",
    input.commandState.createOrReuseStreamingCommand({
      turnId: input.turnId,
      workflowTaskAttemptId:
        input.target.surface === "workflow-task" ? input.target.workflowTaskAttemptId : null,
      surfacePiSessionId: input.target.surfacePiSessionId,
      threadId:
        input.target.surface === "handler" || input.target.surface === "workflow-task"
          ? (input.target.threadId ?? null)
          : null,
      workflowRunId:
        input.target.surface === "workflow-task" ? (input.target.workflowRunId ?? null) : null,
      toolName: input.toolName,
      executor: commandExecutorForTarget(input.target),
      visibility: "surface",
      title: input.toolName,
      summary: `Accepted ${input.toolName}`,
      ...(input.arguments === undefined ? {} : { arguments: input.arguments as never }),
      toolCallId: input.toolCallId,
      facts: { toolCallId: input.toolCallId, toolName: input.toolName },
    }),
    input.eventBus,
  );
}

function resolveToolCommandId(
  state: PromptExecutionState,
  commandState: RuntimeCommandStatePortService,
  toolCallId: ToolCallId,
): Effect.Effect<CommandId, RuntimeContractError> {
  const existing = state.toolCommandIds[toolCallId];
  if (existing) {
    return Effect.succeed(existing);
  }
  return commandState.findCommandByToolCallId({ toolCallId }).pipe(
    Effect.mapError((cause) => runtimeStateError("runtime.prompt.tool.findCommand", cause)),
    Effect.andThen((command) =>
      command
        ? Effect.succeed(command.id as CommandId)
        : Effect.fail(
            new RuntimeContractError({
              operation: "runtime.prompt.tool.findCommand",
              reason: "target-not-ready",
              message: `Runtime command not found for tool call ${toolCallId}.`,
            }),
          ),
    ),
  );
}

function publishCommandMutation<Value>(
  operation: string,
  effect: Effect.Effect<StateMutationResult<Value>, StateContractError>,
  eventBus: RuntimeEventBus["Service"],
): Effect.Effect<Value, RuntimeContractError> {
  return Effect.gen(function* () {
    const result = yield* effect.pipe(
      Effect.mapError((cause) => runtimeStateError(operation, cause)),
    );
    yield* eventBus
      .publishStateInvalidations({ afterCommit: result.afterCommit })
      .pipe(Effect.mapError((cause) => runtimeAdapterError(operation, cause)));
    return result.value;
  });
}

function commandExecutorForTarget(
  target: RuntimeSurfaceTarget,
): "orchestrator" | "handler" | "workflow-task-agent" {
  if (target.surface === "workflow-task") {
    return "workflow-task-agent";
  }
  return target.surface;
}

function toolResultSummary(result: NativeToolResult | undefined): string {
  if (!result) {
    return "Tool finished.";
  }
  const text = result.content
    ?.map((entry) => ("text" in entry ? entry.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
  return text || "Tool finished.";
}

function toolResultFacts(result: NativeToolResult | undefined) {
  return result?.details?.commandFacts ?? result?.details ?? null;
}

function parseToolArguments(argumentsJson: string): unknown {
  return JSON.parse(argumentsJson);
}

function streamGenerationIdForTurn(turnId: string): SurfaceStreamGenerationId {
  return `stream:${turnId}` as SurfaceStreamGenerationId;
}

function runtimeToolExecutionError(
  input: {
    readonly turnId: TurnId;
    readonly surfacePiSessionId: string;
    readonly piToolCallId: ToolCallId;
    readonly toolName: string;
  },
  reason:
    | "tool-not-found"
    | "invalid-arguments"
    | "extension-failed"
    | "runtime-effect-failed"
    | "cancelled"
    | "state-conflict",
  message: string,
  cause?: unknown,
): RuntimeToolExecutionError {
  return new RuntimeToolExecutionError({
    turnId: input.turnId,
    surfacePiSessionId: input.surfacePiSessionId as never,
    piToolCallId: input.piToolCallId,
    toolName: input.toolName,
    reason,
    message,
    cause,
  });
}

function runtimeStateError(operation: string, cause: StateContractError): RuntimeContractError {
  return new RuntimeContractError({
    operation,
    reason:
      cause.reason === "not-found"
        ? "target-not-found"
        : cause.reason === "invalid-input"
          ? "invalid-input"
          : cause.reason === "stale-state"
            ? "stale-state"
            : "state-conflict",
    message: cause.message,
    cause,
  });
}

function runtimeAdapterError(operation: string, cause: unknown): RuntimeContractError {
  if (cause instanceof RuntimeContractError) {
    return cause;
  }
  return new RuntimeContractError({
    operation,
    reason: "state-conflict",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}
