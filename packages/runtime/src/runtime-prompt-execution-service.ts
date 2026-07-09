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
  RuntimeTurnStatePort,
  type ActorBinding,
  type ActorKind,
  type CommandId,
  type ExtensionHandlerResult,
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
  type RuntimeTurnRecord,
  type RuntimeTurnStatePortService,
  type RunPiTurnInput,
  type StateContractError,
  type StateMutationResult,
  type SurfaceStreamGenerationId,
  type ToolCallId,
  type TurnId,
  type WorkspaceId,
} from "@svvy/core";
import {
  Extensions,
  type CommandInvocationContext,
  type ExtensionInvocation,
} from "@svvy/extensions";
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
    const queueState = yield* RuntimeQueueStatePort;
    const turnState = yield* RuntimeTurnStatePort;
    const commandState = yield* RuntimeCommandStatePort;
    const eventBus = yield* RuntimeEventBus;

    return RuntimePromptExecutionService.of({
      executeClaimedPrompt: (input) =>
        Effect.gen(function* () {
          const surface = yield* RuntimeSurfaceRuntimeService;
          const streamGenerationId = streamGenerationIdForTurn(input.turn.id);
          const assistantMessageId = `${input.turn.id}:assistant` as never;
          const startedAt = DateTime.formatIso(yield* DateTime.now) as never;
          yield* publishPatch({
            surfaceEvents,
            workspaceId: input.workspaceId,
            target: input.target,
            streamGenerationId,
            patch: {
              type: "assistant_message_started",
              messageId: assistantMessageId,
              turnId: input.turn.id as TurnId,
              createdAt: startedAt,
            },
          });
          yield* publishPatch({
            surfaceEvents,
            workspaceId: input.workspaceId,
            target: input.target,
            streamGenerationId,
            patch: {
              type: "prompt_status",
              turnId: input.turn.id as TurnId,
              status: "running",
            },
          });

          const turnStream = yield* surface.runPiTurn(input.piTurnInput);
          let state = initialPromptExecutionState(input, streamGenerationId);
          const result = yield* turnStream.stream.pipe(
            Stream.runForEach((event) =>
              handlePiRuntimeEvent({
                state,
                event,
                surfaceEvents,
                queueState,
                turnState,
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
                    queueState,
                    turnState,
                    eventBus,
                    surfaceEvents,
                  }),
            ),
            Effect.ensuring(turnStream.close().pipe(Effect.ignore)),
            Effect.catch((cause: unknown) =>
              settlePromptFailure({
                input,
                queueState,
                turnState,
                eventBus,
                surfaceEvents,
                streamGenerationId,
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

      yield* publishCommandMutation(
        "runtime.prompt.tool.startCommand",
        input.commandState.startCommand({ commandId: command.id }),
        input.eventBus,
      ).pipe(
        Effect.mapError((cause) =>
          runtimeToolExecutionError(toolInput, "state-conflict", cause.message, cause),
        ),
      );

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

      const args = parseToolArguments(toolInput.argumentsJson);
      const commandContext: CommandInvocationContext = {
        commandId: command.id as CommandId,
        target: input.target,
        turnId: toolInput.turnId,
        approvalMode: "auto-review",
        sandbox: { snapshot: {} },
        cwd: "",
        baseEnv: {},
      };
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
  readonly assistantMessageId: string;
  readonly assistantText: string;
  readonly commandReceipts: readonly RuntimePromptCommandReceipt[];
  readonly toolCommandIds: Readonly<Record<string, CommandId>>;
  readonly result: RuntimePromptExecutionResult | null;
};

function initialPromptExecutionState(
  input: RuntimePromptExecutionInput,
  streamGenerationId: SurfaceStreamGenerationId,
): PromptExecutionState {
  return {
    input,
    streamGenerationId,
    assistantMessageId: `${input.turn.id}:assistant`,
    assistantText: "",
    commandReceipts: [],
    toolCommandIds: {},
    result: null,
  };
}

function handlePiRuntimeEvent(input: {
  readonly state: PromptExecutionState;
  readonly event: PiRuntimeEvent;
  readonly surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
  readonly queueState: RuntimeQueueStatePortService;
  readonly turnState: RuntimeTurnStatePortService;
  readonly commandState: RuntimeCommandStatePortService;
  readonly eventBus: RuntimeEventBus["Service"];
}): Effect.Effect<PromptExecutionState, RuntimeContractError> {
  const { state, event } = input;
  if (state.result) {
    return Effect.succeed(state);
  }
  switch (event.type) {
    case "pi.user_message.committed":
      return publishPatch({
        ...input,
        workspaceId: state.input.workspaceId,
        target: state.input.target,
        streamGenerationId: state.streamGenerationId,
        patch: {
          type: "user_message_committed",
          messageId: (event.messageId ?? event.piMessageRef) as never,
          queueItemId: state.input.claimedMessage.id as never,
          text: state.input.piTurnInput.userMessage.text,
          submittedAt: state.input.claimedMessage.createdAt as never,
        },
      }).pipe(Effect.as(state));
    case "pi.assistant.text.delta":
      return publishPatch({
        ...input,
        workspaceId: state.input.workspaceId,
        target: state.input.target,
        streamGenerationId: state.streamGenerationId,
        patch: {
          type: "assistant_text_delta",
          messageId: event.piMessageRef as never,
          contentIndex: event.contentIndex,
          delta: event.delta,
        },
      }).pipe(
        Effect.as({
          ...state,
          assistantMessageId: event.piMessageRef,
          assistantText: state.assistantText + event.delta,
        }),
      );
    case "pi.assistant.thinking.delta":
      return publishPatch({
        ...input,
        workspaceId: state.input.workspaceId,
        target: state.input.target,
        streamGenerationId: state.streamGenerationId,
        patch: {
          type: "assistant_thinking_delta",
          messageId: event.piMessageRef as never,
          contentIndex: event.contentIndex,
          delta: event.delta,
        },
      }).pipe(Effect.as({ ...state, assistantMessageId: event.piMessageRef }));
    case "pi.tool_call.started":
      return createOrReuseToolCommand({
        target: state.input.target,
        commandState: input.commandState,
        eventBus: input.eventBus,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        turnId: event.turnId,
      }).pipe(
        Effect.andThen((command) =>
          publishPatch({
            ...input,
            workspaceId: state.input.workspaceId,
            target: state.input.target,
            streamGenerationId: state.streamGenerationId,
            patch: {
              type: "active_command",
              messageId: event.piMessageRef as never,
              toolCallId: event.toolCallId,
              commandId: command.id as CommandId,
              status: "accepted",
            },
          }).pipe(
            Effect.as({
              ...state,
              assistantMessageId: event.piMessageRef,
              toolCommandIds: {
                ...state.toolCommandIds,
                [event.toolCallId]: command.id as CommandId,
              },
            }),
          ),
        ),
      );
    case "pi.tool_call.arguments.delta":
      return createOrReuseToolCommand({
        target: state.input.target,
        commandState: input.commandState,
        eventBus: input.eventBus,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        turnId: event.turnId,
      }).pipe(
        Effect.andThen((command) =>
          publishCommandMutation(
            "runtime.prompt.tool.argumentsDelta",
            input.commandState.recordCommandEvent({
              sessionId: state.input.target.workspaceSessionId,
              commandId: command.id,
              kind: "command.arg_snapshot",
              data: {
                source: "pi-tool-call",
                arguments: {
                  toolCallId: event.toolCallId,
                  delta: event.delta,
                  contentIndex: event.contentIndex,
                },
              },
            }),
            input.eventBus,
          ).pipe(
            Effect.andThen(() =>
              publishPatch({
                ...input,
                workspaceId: state.input.workspaceId,
                target: state.input.target,
                streamGenerationId: state.streamGenerationId,
                patch: {
                  type: "tool_arguments_snapshot",
                  messageId: event.piMessageRef as never,
                  toolCallId: event.toolCallId,
                  commandId: command.id as CommandId,
                  snapshotRef: event.toolCallId as never,
                },
              }),
            ),
            Effect.as({
              ...state,
              assistantMessageId: event.piMessageRef,
              toolCommandIds: {
                ...state.toolCommandIds,
                [event.toolCallId]: command.id as CommandId,
              },
            }),
          ),
        ),
      );
    case "pi.tool_call.accepted":
      return createOrReuseToolCommand({
        target: state.input.target,
        commandState: input.commandState,
        eventBus: input.eventBus,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        turnId: event.turnId,
        arguments: event.argumentsJson ? parseToolArguments(event.argumentsJson) : undefined,
      }).pipe(
        Effect.andThen((command) =>
          publishPatch({
            ...input,
            workspaceId: state.input.workspaceId,
            target: state.input.target,
            streamGenerationId: state.streamGenerationId,
            patch: {
              type: "active_command",
              messageId: event.piMessageRef as never,
              toolCallId: event.toolCallId,
              commandId: command.id as CommandId,
              status: "accepted",
            },
          }).pipe(
            Effect.as({
              ...state,
              assistantMessageId: event.piMessageRef,
              toolCommandIds: {
                ...state.toolCommandIds,
                [event.toolCallId]: command.id as CommandId,
              },
            }),
          ),
        ),
      );
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
      return settlePromptTurn({
        state,
        status: event.status,
        queueState: input.queueState,
        turnState: input.turnState,
        eventBus: input.eventBus,
        surfaceEvents: input.surfaceEvents,
      });
  }
}

function settlePromptTurn(input: {
  readonly state: PromptExecutionState;
  readonly status: "completed" | "failed" | "cancelled";
  readonly queueState: RuntimeQueueStatePortService;
  readonly turnState: RuntimeTurnStatePortService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
}): Effect.Effect<PromptExecutionState, RuntimeContractError> {
  const { state } = input;
  const turnStatus = input.status === "completed" ? "completed" : "failed";
  return Effect.gen(function* () {
    const finishedTurn = yield* input.turnState
      .finishTurn({ turnId: state.input.turn.id, status: turnStatus })
      .pipe(Effect.mapError((cause) => runtimeStateError("runtime.prompt.finishTurn", cause)));
    yield* input.eventBus
      .publishStateInvalidations({ afterCommit: finishedTurn.afterCommit })
      .pipe(Effect.mapError((cause) => runtimeAdapterError("runtime.prompt.finishTurn", cause)));

    const queueMutation =
      input.status === "completed"
        ? input.queueState.markSurfaceMessageDelivered({
            id: state.input.claimedMessage.id,
            claimOwnerId: state.input.claimedMessage.claimOwnerId,
            leaseVersion: state.input.claimedMessage.leaseVersion,
          })
        : input.queueState.markSurfaceMessageFailed({
            id: state.input.claimedMessage.id,
            failureError: `Prompt ${input.status}.`,
            claimOwnerId: state.input.claimedMessage.claimOwnerId,
            leaseVersion: state.input.claimedMessage.leaseVersion,
          });
    const queued = yield* queueMutation.pipe(
      Effect.mapError((cause) => runtimeStateError("runtime.prompt.settleQueue", cause)),
    );
    yield* input.eventBus
      .publishStateInvalidations({ afterCommit: queued.afterCommit })
      .pipe(Effect.mapError((cause) => runtimeAdapterError("runtime.prompt.settleQueue", cause)));

    const finishedAt = DateTime.formatIso(yield* DateTime.now) as never;
    yield* publishPatch({
      surfaceEvents: input.surfaceEvents,
      workspaceId: state.input.workspaceId,
      target: state.input.target,
      streamGenerationId: state.streamGenerationId,
      patch: {
        type: "assistant_message_finished",
        messageId: state.assistantMessageId as never,
        status: input.status,
        finishedAt,
      },
    });
    yield* publishPatch({
      surfaceEvents: input.surfaceEvents,
      workspaceId: state.input.workspaceId,
      target: state.input.target,
      streamGenerationId: state.streamGenerationId,
      patch: {
        type: "prompt_status",
        turnId: state.input.turn.id as TurnId,
        status: input.status,
      },
    });
    const result: RuntimePromptExecutionResult = {
      queueItemId: state.input.claimedMessage.id,
      turnId: state.input.turn.id as TurnId,
      status: input.status,
      assistantText: state.assistantText,
      commandReceipts: state.commandReceipts,
    };
    return { ...state, result };
  });
}

function settlePromptFailure(input: {
  readonly input: RuntimePromptExecutionInput;
  readonly queueState: RuntimeQueueStatePortService;
  readonly turnState: RuntimeTurnStatePortService;
  readonly eventBus: RuntimeEventBus["Service"];
  readonly surfaceEvents: RuntimeSurfaceEventPublisher["Service"];
  readonly streamGenerationId: SurfaceStreamGenerationId;
  readonly error: unknown;
}): Effect.Effect<PromptExecutionState, RuntimeContractError> {
  const state = initialPromptExecutionState(input.input, input.streamGenerationId);
  return settlePromptTurn({
    state,
    status: "failed",
    queueState: input.queueState,
    turnState: input.turnState,
    eventBus: input.eventBus,
    surfaceEvents: input.surfaceEvents,
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
  return result?.details ?? null;
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
