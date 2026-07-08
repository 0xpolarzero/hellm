import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  RuntimeCommandStatePort,
  RuntimeContractError,
  RuntimeThreadStatePort,
  type CommandId,
  type RuntimeCommandRecord,
  type RuntimeCommandStatePortService,
  type RuntimeThreadStatePortService,
  type QueueItemId,
  type StartRuntimeHandlerThreadsInput,
  type StartRuntimeHandlerThreadsResult,
  type StateInvalidationDescriptor,
  type SurfacePiSessionId,
  type ThreadGroupId,
  type ThreadId,
  type ToolCallId,
  type ToolItemId,
  type TurnId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import {
  RuntimeHandlerThreadStartPreparationHost,
  RuntimeQueueInsertPostCommitLane,
} from "./runtime-effect-requests";
import { RuntimeEventBus } from "./runtime-event-bus";
import { runAcceptedThreadStartToolCall } from "./thread-start-operation";

function effectTest<A, E>(effect: Effect.Effect<A, E, unknown>): Effect.Effect<A, E, never> {
  return effect as Effect.Effect<A, E, never>;
}

const workspaceSessionId = "wsess_thread_start_runtime_01" as WorkspaceSessionId;
const orchestratorSurfacePiSessionId = "pi_thread_start_orchestrator_01" as SurfacePiSessionId;
const handlerSurfacePiSessionId = "pi_thread_start_handler_01" as SurfacePiSessionId;
const turnId = "turn_thread_start_runtime_01" as TurnId;
const commandId = "command_thread_start_runtime_01" as CommandId;
const toolCallId = "tool_call_thread_start_runtime_01" as ToolCallId;
const toolItemId = "tool_item_thread_start_runtime_01" as ToolItemId;
const threadId = "thread_thread_start_runtime_01" as ThreadId;
const threadGroupId = "thread_group_thread_start_runtime_01" as ThreadGroupId;
const queuedMessageId = "queue_thread_start_runtime_01" as QueueItemId;

function stateMutation<T>(value: T, afterCommit: readonly StateInvalidationDescriptor[] = []) {
  return { value, afterCommit };
}

function commandRecord(input: {
  status: RuntimeCommandRecord["status"];
  summary?: string;
  facts?: RuntimeCommandRecord["facts"];
}): RuntimeCommandRecord {
  return {
    id: commandId,
    sessionId: workspaceSessionId,
    turnId,
    workflowTaskAttemptId: null,
    surfacePiSessionId: orchestratorSurfacePiSessionId,
    threadId: null,
    workflowRunId: null,
    parentCommandId: null,
    toolName: "thread_start",
    executor: "orchestrator",
    visibility: "surface",
    status: input.status,
    attempts: 1,
    title: "Start handler thread",
    summary: input.summary ?? "",
    arguments: null,
    facts: input.facts ?? null,
    error: null,
    startedAt: "2026-04-18T09:00:00.000Z",
    updatedAt: "2026-04-18T09:00:01.000Z",
    finishedAt: "2026-04-18T09:00:01.000Z",
  };
}

const target = {
  workspaceSessionId,
  surface: "orchestrator" as const,
  surfacePiSessionId: orchestratorSurfacePiSessionId,
};

const handlerTarget = {
  workspaceSessionId,
  surface: "handler" as const,
  surfacePiSessionId: handlerSurfacePiSessionId,
  threadId,
};

const preparedInput = {
  workspaceSessionId,
  orchestratorTurnId: turnId,
  sourceCommandId: commandId,
  threads: [
    {
      surfacePiSessionId: handlerSurfacePiSessionId,
      title: "Inspect thread start runtime operation.",
      objective: "Inspect thread start runtime operation.",
      historyMode: "isolated",
      agentProfileJson: null,
      generatedAgentContextBinding: {
        aggregateCacheKey: "handler-thread-cache",
        generatedAgentContextFingerprint: "handler-thread-fingerprint",
        generatedAgentContextRevision: 1,
        externalSourceHashes: [],
      },
      initialQueue: {
        idempotencyKey: "initial_handler_start:thread_thread_start_runtime_01",
        priority: "runtime",
        orderingKey: "surface:pi_thread_start_handler_01",
        nextAttemptAt: null,
      },
    },
  ],
} satisfies StartRuntimeHandlerThreadsInput;

const startResult = {
  threadGroupId,
  threads: [
    {
      threadId,
      threadGroupId,
      workspaceSessionId,
      surfacePiSessionId: handlerSurfacePiSessionId,
      parentThreadId: null,
      title: "Inspect thread start runtime operation.",
      objective: "Inspect thread start runtime operation.",
      historyMode: "isolated",
      objectiveState: "active",
      status: "running-handler",
      wait: null,
      worktreeId: null,
      generatedAgentContextFingerprint: "handler-thread-fingerprint",
      generatedAgentContextBindingId: "handler-thread-binding",
      queuedMessageId,
    },
  ],
} satisfies StartRuntimeHandlerThreadsResult;

const queueInvalidation = {
  scope: "workspace",
  workspaceId: "workspace_thread_start_runtime_01" as WorkspaceId,
  invalidation: { model: "surface", ids: [handlerSurfacePiSessionId] },
} satisfies StateInvalidationDescriptor;

describe("thread_start runtime operation", () => {
  it.effect(
    "invokes the package handler, applies handler_thread.start, wakes the handler queue, and finishes from committed state",
    () =>
      effectTest(
        Effect.gen(function* () {
          const calls: string[] = [];
          const finishCalls: Parameters<RuntimeCommandStatePortService["finishCommand"]>[0][] = [];

          const commandStatePort = {
            createCommand: () => Effect.die("Unexpected command create."),
            createOrReuseStreamingCommand: () => Effect.die("Unexpected streaming command create."),
            findCommandByToolCallId: () => Effect.die("Unexpected command lookup by tool call."),
            findCommandById: () => Effect.die("Unexpected command lookup by id."),
            updateCommandArguments: () => Effect.die("Unexpected command argument update."),
            startCommand: () => Effect.die("Unexpected command start."),
            finishCommand: (input) =>
              Effect.sync(() => {
                calls.push(`finish:${input.commandId}:${input.status}`);
                finishCalls.push(input);
                return stateMutation(
                  commandRecord({
                    status: input.status,
                    ...(input.summary === undefined ? {} : { summary: input.summary }),
                    facts: input.facts ?? null,
                  }),
                );
              }),
            recordCommandEvent: () => Effect.die("Unexpected command event."),
            recordStdinWrite: () => Effect.die("Unexpected stdin write."),
            hasCommandOutputEvent: () => Effect.die("Unexpected command output check."),
          } satisfies RuntimeCommandStatePortService;

          const threadStatePort = {
            ensureHandlerThreadRunnable: () => Effect.die("Unexpected runnable update."),
            startHandlerThreads: (input) =>
              Effect.sync(() => {
                calls.push(`state:${input.sourceCommandId}`);
                assert.deepStrictEqual(input, preparedInput);
                return stateMutation(startResult, [queueInvalidation]);
              }),
          } satisfies RuntimeThreadStatePortService;

          const result = yield* runAcceptedThreadStartToolCall({
            toolCallId,
            toolItemId,
            arguments: {
              threads: [{ objective: "Inspect thread start runtime operation." }],
            },
            context: {
              workspaceSessionId,
              turnId,
              surfacePiSessionId: orchestratorSurfacePiSessionId,
              surfaceKind: "orchestrator",
              defaultEpisodeKind: "analysis",
              rootThreadId: null,
              rootEpisodeKind: "analysis",
              sessionWaitApplied: false,
              threadWasTerminalAtStart: false,
              loadedExtensionIds: [],
              availableExtensionIds: [],
              generatedAgentContextFingerprint: "orchestrator-fingerprint",
              generatedAgentContextRevision: "1",
            },
            actorBinding: {
              loadedExtensionIds: [],
              availableExtensionIds: [],
            },
            command: {
              commandId,
              target,
              turnId,
              approvalMode: "auto-review",
              sandbox: { snapshot: {} },
              cwd: "/tmp/svvy-runtime-thread-start",
              baseEnv: {},
            },
          }).pipe(
            Effect.provideService(RuntimeCommandStatePort, commandStatePort),
            Effect.provideService(RuntimeThreadStatePort, threadStatePort),
            Effect.provideService(
              RuntimeHandlerThreadStartPreparationHost,
              RuntimeHandlerThreadStartPreparationHost.of({
                prepareHandlerThreadStart: (input) =>
                  Effect.sync(() => {
                    calls.push(`prepare:${input.request.sourceCommandId}`);
                    assert.deepStrictEqual(input, {
                      request: {
                        workspaceSessionId,
                        sourceCommandId: commandId,
                        threads: [
                          {
                            objective: "Inspect thread start runtime operation.",
                            history: "isolated",
                          },
                        ],
                      },
                      target,
                      turnId,
                      toolItemId,
                    });
                    return preparedInput;
                  }),
              }),
            ),
            Effect.provideService(
              RuntimeEventBus,
              RuntimeEventBus.of({
                publishLive: () => Effect.die("Unexpected live event publication."),
                publishStateInvalidations: (input) =>
                  Effect.sync(() => {
                    calls.push(`publish:${input.afterCommit.length}`);
                    return [];
                  }),
                subscribe: () => Effect.die("Unexpected runtime event subscription."),
              }),
            ),
            Effect.provideService(
              RuntimeQueueInsertPostCommitLane,
              RuntimeQueueInsertPostCommitLane.of({
                afterQueueInsertCommitted: (input) =>
                  Effect.sync(() => {
                    assert.deepStrictEqual(input, {
                      target: handlerTarget,
                      queuedMessageId,
                      kind: "initial_handler_start",
                    });
                    calls.push(
                      `postCommit:${input.queuedMessageId}:${input.target.surfacePiSessionId}`,
                    );
                  }),
              }),
            ),
          );

          assert.deepStrictEqual(calls, [
            `prepare:${commandId}`,
            `state:${commandId}`,
            "publish:1",
            `postCommit:${queuedMessageId}:${handlerSurfacePiSessionId}`,
            `finish:${commandId}:succeeded`,
          ]);
          assert.deepStrictEqual(result.result, {
            threadGroupId,
            threads: [
              {
                threadId,
                threadGroupId,
                surfacePiSessionId: handlerSurfacePiSessionId,
                parentThreadId: null,
                objective: "Inspect thread start runtime operation.",
                objectiveState: "active",
                queuedMessageId,
              },
            ],
          });
          assert.deepStrictEqual(finishCalls, [
            {
              commandId,
              status: "succeeded",
              summary: `Started 1 handler thread in group ${threadGroupId}.`,
              facts: {
                kind: "thread_start",
                accepted: true,
                threadGroupId,
                startedThreadCount: 1,
                threads: [
                  {
                    threadId,
                    threadGroupId,
                    surfacePiSessionId: handlerSurfacePiSessionId,
                    parentThreadId: null,
                    objective: "Inspect thread start runtime operation.",
                    objectiveState: "active",
                    queuedMessageId,
                  },
                ],
              },
            },
          ]);
        }) as Effect.Effect<void, RuntimeContractError, unknown>,
      ),
  );
});
