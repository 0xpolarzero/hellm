import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  type CommandId,
  type CreateRuntimeRequestInputInput,
  type ExtensionId,
  type ExtensionRuntimeOperation,
  type GeneratedContextFingerprint,
  type PromptExecutionContext,
  type RequestInputRequestId,
  type RuntimeActorExtensionBindingStatePortService,
  type RuntimeCommandRecord,
  type RuntimeCommandStatePortService,
  type RuntimeEpisodeStatePortService,
  type RuntimeQueueStatePortService,
  type RuntimeRequestInputRecord,
  type RuntimeRequestStatePortService,
  type RuntimeThreadStatePortService,
  type StateInvalidationDescriptor,
  type SurfacePiSessionId,
  type ToolCallId,
  type TurnId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { Extensions, type ExtensionInvocation, type ExtensionsService } from "@svvy/extensions";
import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeSourceInvalidationService } from "./runtime-source-invalidation-service";
import { buildRuntimeToolExecutor } from "./runtime-prompt-execution-service";

const workspaceId = "workspace_prompt_tool_executor" as WorkspaceId;
const workspaceSessionId = "wsess_prompt_tool_executor" as WorkspaceSessionId;
const surfacePiSessionId = "pi_prompt_tool_executor" as SurfacePiSessionId;
const turnId = "turn_prompt_tool_executor_real" as TurnId;
const commandId = "cmd_prompt_tool_executor" as CommandId;
const toolCallId = "tool_call_prompt_tool_executor" as ToolCallId;
const extensionId = "request-user-input" as ExtensionId;
const requestId = "request_prompt_tool_executor" as RequestInputRequestId;
const target = {
  workspaceSessionId,
  surface: "orchestrator",
  surfacePiSessionId,
} as const;
const promptContext = {
  workspaceSessionId,
  turnId,
  surfacePiSessionId,
  surfaceKind: "orchestrator",
  loadedExtensionIds: [extensionId],
  availableExtensionIds: [extensionId],
  externalInstructionSources: [],
  generatedAgentContextFingerprint: "ctx_prompt_tool_executor" as GeneratedContextFingerprint,
  generatedAgentContextRevision: "1",
  queueItemId: "queue_prompt_tool_executor",
  defaultEpisodeKind: "analysis",
  rootThreadId: null,
  rootEpisodeKind: "analysis",
  sessionWaitApplied: false,
  threadWasTerminalAtStart: false,
} satisfies PromptExecutionContext;
const requestInvalidation = {
  scope: "workspace",
  workspaceId,
  invalidation: { model: "requestInput", ids: [requestId] },
} satisfies StateInvalidationDescriptor;

function commandRecord(input: {
  readonly status: RuntimeCommandRecord["status"];
  readonly summary?: string | null;
  readonly facts?: RuntimeCommandRecord["facts"];
}): RuntimeCommandRecord {
  return {
    id: commandId,
    sessionId: workspaceSessionId,
    turnId,
    workflowTaskAttemptId: null,
    surfacePiSessionId,
    threadId: null,
    workflowRunId: null,
    parentCommandId: null,
    toolName: "request_user_input",
    executor: "orchestrator",
    visibility: "surface",
    status: input.status,
    attempts: 1,
    title: "request_user_input",
    summary: input.summary ?? "request_user_input",
    arguments: null,
    facts: input.facts ?? null,
    error: null,
    startedAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    finishedAt: input.status === "succeeded" ? "2026-07-09T00:00:01.000Z" : null,
  };
}

describe("@svvy/runtime prompt execution service", () => {
  it.effect(
    "applies native tool operations, publishes invalidations, and keeps real turn facts",
    () => {
      const calls: string[] = [];
      const createdRequests: CreateRuntimeRequestInputInput[] = [];
      const handlerTurnIds: TurnId[] = [];
      const published: Array<readonly StateInvalidationDescriptor[]> = [];
      const emitted: unknown[] = [];
      const operations: ExtensionRuntimeOperation[] = [
        {
          kind: "runtime_effect",
          request: {
            type: "request_input.create",
            input: {
              target,
              sourceCommandId: commandId,
              questions: [
                {
                  title: "Scope",
                  question: "Run unit tests or full checks?",
                  options: [
                    { label: "Unit", description: "Fast.", recommended: true },
                    { label: "Full", description: "Slower." },
                  ],
                },
              ],
            },
          },
        },
      ];

      const commandState = {
        createOrReuseStreamingCommand: (input) =>
          Effect.sync(() => {
            calls.push(`command:create:${input.turnId}:${input.toolCallId}`);
            return { value: commandRecord({ status: "requested" }), afterCommit: [] };
          }),
        startCommand: (input) =>
          Effect.sync(() => {
            calls.push(`command:start:${input.commandId}`);
            return { value: commandRecord({ status: "running" }), afterCommit: [] };
          }),
        finishCommand: (input) =>
          Effect.sync(() => {
            calls.push(`command:finish:${input.commandId}:${input.status}`);
            return {
              value: commandRecord({
                status: input.status,
                summary: input.summary ?? null,
                facts: input.facts ?? null,
              }),
              afterCommit: [],
            };
          }),
        createCommand: () => Effect.die("Unexpected createCommand call."),
        findCommandByToolCallId: () => Effect.die("Unexpected findCommandByToolCallId call."),
        findCommandById: () => Effect.die("Unexpected findCommandById call."),
        updateCommandArguments: () => Effect.die("Unexpected updateCommandArguments call."),
        recordCommandEvent: () => Effect.die("Unexpected recordCommandEvent call."),
        recordStdinWrite: () => Effect.die("Unexpected recordStdinWrite call."),
        hasCommandOutputEvent: () => Effect.die("Unexpected hasCommandOutputEvent call."),
      } satisfies RuntimeCommandStatePortService;
      const requestState = {
        readRequestInputSettings: () =>
          Effect.succeed({
            mode: "nonblocking" as const,
            blockingTimeout: { enabled: true, durationMs: 300_000 as never },
          }),
        setRequestInputVariant: () => Effect.die("Unexpected request input variant mutation."),
        setRequestInputBlockingTimeout: () =>
          Effect.die("Unexpected request input timeout mutation."),
        createRequestInput: (input) =>
          Effect.sync(() => {
            calls.push(`request:create:${input.turnId}:${input.sourceCommandId}`);
            createdRequests.push(input);
            return {
              value: {
                requestId,
                sessionId: workspaceSessionId,
                surfacePiSessionId,
                threadId: null,
                turnId: input.turnId,
                commandId: input.sourceCommandId,
                variant: input.mode,
                status: "open",
                questionCount: input.questions.length,
              } satisfies RuntimeRequestInputRecord,
              afterCommit: [requestInvalidation],
            };
          }),
        getRequestInput: () => Effect.die("Unexpected getRequestInput call."),
        listOpenBlockingRequestInputs: () =>
          Effect.die("Unexpected listOpenBlockingRequestInputs call."),
        answerRequestInput: () => Effect.die("Unexpected answerRequestInput call."),
        defaultOpenRequestInputQuestions: () =>
          Effect.die("Unexpected defaultOpenRequestInputQuestions call."),
        cancelRequestInput: () => Effect.die("Unexpected cancelRequestInput call."),
        setRequestInputTimerPaused: () => Effect.die("Unexpected setRequestInputTimerPaused call."),
      } satisfies RuntimeRequestStatePortService;
      const extensions = Extensions.of({
        nativeTools: {
          handler: () =>
            Effect.succeed({
              invoke: (input: ExtensionInvocation) =>
                Effect.sync(() => {
                  handlerTurnIds.push(input.command.turnId);
                  return {
                    result: {
                      content: [{ type: "text" as const, text: "tool result" }],
                    },
                    operations,
                  };
                }),
            }),
        },
      } as unknown as ExtensionsService);
      const eventBus = RuntimeEventBus.of({
        publishLive: () => Effect.die("Unexpected live publication."),
        publishStateInvalidations: (input) =>
          Effect.sync(() => {
            calls.push(`publish:${input.afterCommit.length}`);
            if (input.afterCommit.length > 0) {
              published.push(input.afterCommit);
            }
            return [];
          }),
        subscribe: () => Effect.die("Unexpected subscription."),
      });
      const toolExecutor = buildRuntimeToolExecutor({
        acceptedNativeTools: {
          runRequestUserInput: () => Effect.die("Unexpected accepted request input execution."),
        },
        extensions,
        target,
        actorBinding: {
          actorKind: "orchestrator",
          loadedExtensionIds: [extensionId],
          availableExtensionIds: [extensionId],
          unavailableExtensionIds: [],
          instructionOrder: [extensionId],
          source: "surface-binding",
        } as {
          actorKind: "orchestrator";
          loadedExtensionIds: ExtensionId[];
          availableExtensionIds: ExtensionId[];
          unavailableExtensionIds: ExtensionId[];
          instructionOrder: ExtensionId[];
          source: "surface-binding";
        },
        promptContext,
        commandState,
        requestState,
        actorBindingState: {} as RuntimeActorExtensionBindingStatePortService,
        episodeState: {} as RuntimeEpisodeStatePortService,
        threadState: {} as RuntimeThreadStatePortService,
        queueState: {} as RuntimeQueueStatePortService,
        eventBus,
        sourceInvalidation: RuntimeSourceInvalidationService.of({
          hint: () => Effect.void,
          reconcile: () => Effect.die("Unexpected source reconciliation."),
          applyCommittedScanEvent: () => Effect.die("Unexpected source scan event."),
          refreshGeneratedContext: () => Effect.void,
          refreshGeneratedPackages: () => Effect.die("Unexpected generated package refresh."),
        }),
      });

      return toolExecutor({
        turnId,
        surfacePiSessionId,
        piToolCallId: toolCallId,
        toolName: "synthetic_runtime_effect_tool",
        argumentsJson: "{}",
        emit: (update) =>
          Effect.sync(() => {
            emitted.push(update);
          }),
      }).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            assert.deepStrictEqual(result, {
              content: [{ type: "text", text: "tool result" }],
            });
            assert.deepStrictEqual(handlerTurnIds, [turnId]);
            assert.deepStrictEqual(
              createdRequests.map((input) => ({
                turnId: input.turnId,
                sourceCommandId: input.sourceCommandId,
              })),
              [{ turnId, sourceCommandId: commandId }],
            );
            assert.deepStrictEqual(published, [[requestInvalidation]]);
            assert.deepStrictEqual(calls, [
              `command:create:${turnId}:${toolCallId}`,
              "publish:0",
              `command:start:${commandId}`,
              "publish:0",
              `request:create:${turnId}:${commandId}`,
              "publish:1",
              `command:finish:${commandId}:succeeded`,
              "publish:0",
            ]);
            assert.strictEqual(emitted.length, 1);
          }),
        ),
      );
    },
  );

  it.effect(
    "routes request_user_input through accepted execution without generic command settlement",
    () => {
      const calls: string[] = [];
      const acceptedInputs: unknown[] = [];
      const commandState = {
        createOrReuseStreamingCommand: () =>
          Effect.sync(() => ({ value: commandRecord({ status: "requested" }), afterCommit: [] })),
        startCommand: () =>
          Effect.sync(() => {
            calls.push("command:start");
            return { value: commandRecord({ status: "running" }), afterCommit: [] };
          }),
        finishCommand: () =>
          Effect.sync(() => {
            calls.push("command:generic-finish");
            return { value: commandRecord({ status: "succeeded" }), afterCommit: [] };
          }),
        createCommand: () => Effect.die("Unexpected createCommand call."),
        findCommandByToolCallId: () => Effect.die("Unexpected command lookup."),
        findCommandById: () => Effect.die("Unexpected command lookup."),
        updateCommandArguments: () => Effect.die("Unexpected argument update."),
        recordCommandEvent: () => Effect.die("Unexpected command event."),
        recordStdinWrite: () => Effect.die("Unexpected stdin write."),
        hasCommandOutputEvent: () => Effect.die("Unexpected command output query."),
      } satisfies RuntimeCommandStatePortService;
      const eventBus = RuntimeEventBus.of({
        publishLive: () => Effect.die("Unexpected live publication."),
        publishStateInvalidations: () => Effect.succeed([]),
        subscribe: () => Effect.die("Unexpected subscription."),
      });
      const toolResult = {
        content: [{ type: "text" as const, text: '{"answers":[]}' }],
        details: { status: "succeeded" as const, commandFacts: { questionCount: 0 } },
      };
      const toolExecutor = buildRuntimeToolExecutor({
        acceptedNativeTools: {
          runRequestUserInput: (input) =>
            Effect.sync(() => {
              acceptedInputs.push(input);
              calls.push("accepted:request-user-input");
              return { toolResult, result: { answers: [] } };
            }),
        },
        extensions: Extensions.of({
          nativeTools: {
            handler: () => Effect.die("Generic handler must not receive request_user_input."),
          },
        } as unknown as ExtensionsService),
        target,
        actorBinding: {
          actorKind: "orchestrator",
          loadedExtensionIds: [extensionId],
          availableExtensionIds: [],
          unavailableExtensionIds: [],
          instructionOrder: [extensionId],
          source: "surface-binding",
        },
        promptContext,
        commandState,
        requestState: {} as RuntimeRequestStatePortService,
        actorBindingState: {} as RuntimeActorExtensionBindingStatePortService,
        episodeState: {} as RuntimeEpisodeStatePortService,
        threadState: {} as RuntimeThreadStatePortService,
        queueState: {} as RuntimeQueueStatePortService,
        eventBus,
        sourceInvalidation: {} as RuntimeSourceInvalidationService["Service"],
      });

      return toolExecutor({
        turnId,
        surfacePiSessionId,
        piToolCallId: toolCallId,
        toolName: "request_user_input",
        argumentsJson: JSON.stringify({
          questions: [
            {
              title: "Scope",
              question: "Run focused tests?",
              defaultAnswer: "Run focused tests.",
            },
          ],
        }),
        emit: () => Effect.void,
      }).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            assert.deepStrictEqual(result, toolResult);
            assert.deepStrictEqual(calls, ["command:start", "accepted:request-user-input"]);
            assert.strictEqual(acceptedInputs.length, 1);
            assert.deepStrictEqual(
              (acceptedInputs[0] as { commandRecord: RuntimeCommandRecord }).commandRecord.status,
              "running",
            );
          }),
        ),
      );
    },
  );
});
