import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeActorExtensionBindingStatePort,
  RuntimeCommandStatePort,
  RuntimeContractError,
  RuntimeEpisodeStatePort,
  RuntimeQueueStatePort,
  RuntimeRequestStatePort,
  RuntimeThreadStatePort,
  RuntimeTurnStatePort,
  type CommandId,
  type ExtensionId,
  type GeneratedContextFingerprint,
  type RuntimeCommandRecord,
  type RuntimePromptBindingRecord,
  type RuntimeSurfaceMessageRecord,
  type RuntimeTurnRecord,
  type StateInvalidationDescriptor,
  type SurfacePiSessionId,
  type ToolCallId,
  type TurnId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { Extensions, type ExtensionsService } from "@svvy/extensions";
import type { ExtensionInvocation } from "@svvy/extensions";
import { RuntimeEventBus } from "./runtime-event-bus";
import { createRuntimeLayerConfigLayer, defaultRuntimeLayerConfig } from "./runtime-layer-config";
import { RuntimeGeneratedContextRefreshService } from "./runtime-generated-context-refresh-service";
import { RuntimePromptDefaultsService } from "./runtime-prompt-defaults-service";
import { RuntimeSourceInvalidationService } from "./runtime-source-invalidation-service";
import { RuntimePromptExecutionService } from "./runtime-prompt-execution-service";
import {
  layerRuntimeSurfaceQueueDispatcherService,
  RuntimeSurfaceQueueDispatcherService,
} from "./runtime-surface-queue-dispatcher-service";
import { RuntimeSurfaceScopeService } from "./surface-runtime-scope-service";

const workspaceId = "workspace_runtime_queue_dispatcher" as WorkspaceId;
const workspaceSessionId = "wsess_runtime_queue_dispatcher" as WorkspaceSessionId;
const surfacePiSessionId = "pi_runtime_queue_dispatcher" as SurfacePiSessionId;
const turnId = "turn_runtime_queue_dispatcher_real" as TurnId;
const commandId = "cmd_runtime_queue_dispatcher_tool" as CommandId;
const toolCallId = "tool_call_runtime_queue_dispatcher" as ToolCallId;
const extensionId = "test-extension" as ExtensionId;
const target = {
  workspaceSessionId,
  surface: "orchestrator",
  surfacePiSessionId,
} as const;
const titleInvalidation = {
  scope: "workspace",
  workspaceId,
  invalidation: { model: "sessionNavigation" },
} satisfies StateInvalidationDescriptor;

function queuedMessage(): RuntimeSurfaceMessageRecord {
  return {
    id: "queue_runtime_queue_dispatcher",
    sessionId: workspaceSessionId,
    surfacePiSessionId,
    threadId: null,
    workflowTaskAttemptId: null,
    kind: "user_message",
    idempotencyKey: "queue_runtime_queue_dispatcher",
    messageJson: JSON.stringify({ text: "Use a native tool." }),
    payloadJson: null,
    status: "queued",
    priority: "runtime",
    orderingKey: `surface:${surfacePiSessionId}`,
    sequence: 1,
    position: 1,
    sourceCommandId: null,
    claimOwnerId: null,
    claimLeaseExpiresAt: null,
    leaseVersion: 1,
    attemptCount: 0,
    maxAttempts: 3,
    nextAttemptAt: null,
    lastErrorJson: null,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    deliveredAt: null,
    failedAt: null,
    failureError: null,
    cancelledAt: null,
  };
}

function commandRecord(status: RuntimeCommandRecord["status"]): RuntimeCommandRecord {
  return {
    id: commandId,
    sessionId: workspaceSessionId,
    turnId,
    workflowTaskAttemptId: null,
    surfacePiSessionId,
    threadId: null,
    workflowRunId: null,
    parentCommandId: null,
    toolName: "test_tool",
    executor: "orchestrator",
    visibility: "surface",
    status,
    attempts: 1,
    title: "test_tool",
    summary: "test_tool",
    arguments: null,
    facts: null,
    error: null,
    startedAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    finishedAt: status === "succeeded" ? "2026-07-09T00:00:01.000Z" : null,
  };
}

describe("@svvy/runtime surface queue dispatcher service", () => {
  it.effect(
    "builds the pi tool executor after the real turn and schedules first-prompt title work",
    () => {
      const calls: string[] = [];
      const handlerTurnIds: TurnId[] = [];
      const titlePublications: Array<readonly StateInvalidationDescriptor[]> = [];
      let claimed = false;
      const binding = {
        target,
        generatedAgentContextBindingId: "binding_runtime_queue_dispatcher",
        generatedAgentContextFingerprint:
          "ctx_runtime_queue_dispatcher" as GeneratedContextFingerprint,
        generatedAgentContextRevision: 1,
        systemPrompt: "Runtime queue dispatcher test.",
        loadedExtensionIds: [extensionId],
        availableExtensionIds: [extensionId],
        externalSourceHashes: [],
        updateExtensionContextBeforeNextTurn: false,
      } satisfies RuntimePromptBindingRecord;

      return Effect.gen(function* () {
        const dispatcher = yield* RuntimeSurfaceQueueDispatcherService;

        yield* dispatcher.drain({ workspaceId, target, awaitPrompt: true });

        assert.deepStrictEqual(handlerTurnIds, [turnId]);
        assert.deepStrictEqual(titlePublications, [[titleInvalidation]]);
        assert.deepStrictEqual(calls, [
          "claim",
          `startTurn:${turnId}`,
          `queueTitle:${workspaceSessionId}:${surfacePiSessionId}`,
          "publishTitle:1",
          `toolHandler:${turnId}`,
        ]);
      }).pipe(
        Effect.provide(layerRuntimeSurfaceQueueDispatcherService),
        Effect.provide(
          Layer.mergeAll(
            createRuntimeLayerConfigLayer(defaultRuntimeLayerConfig),
            Layer.succeed(RuntimeSurfaceScopeService, {
              retainOpen: () =>
                Effect.succeed({
                  surfacePiSessionId,
                  session: { surfacePiSessionId },
                  withPromptLock: (effect) => effect,
                  runPiTurn: () => Effect.die("unused"),
                  interruptActivePrompt: () => Effect.void,
                  isPromptActive: () => false,
                  activePromptDone: () => null,
                  installActivePrompt: () => Effect.void,
                  clearActivePrompt: () => Effect.void,
                }),
              create: () => Effect.die("unused"),
              open: () => Effect.die("unused"),
              release: () => Effect.void,
              interrupt: () => Effect.void,
              snapshot: () => Effect.succeed([]),
            }),
            Layer.succeed(RuntimePromptDefaultsService, {
              resolve: () =>
                Effect.succeed({
                  provider: "openai",
                  model: "gpt-5",
                  reasoningEffort: "medium",
                }),
            }),
            Layer.succeed(RuntimePromptExecutionService, {
              executeClaimedPrompt: (input) =>
                input.piTurnInput
                  .toolExecutor({
                    turnId: input.piTurnInput.turnId,
                    surfacePiSessionId,
                    piToolCallId: toolCallId,
                    toolName: "test_tool",
                    argumentsJson: "{}",
                    emit: () => Effect.void,
                  })
                  .pipe(
                    Effect.mapError(
                      (cause) =>
                        new RuntimeContractError({
                          operation: "runtime.queue.dispatcher.test.toolExecutor",
                          reason: "target-not-ready",
                          message: cause.message,
                          cause,
                        }),
                    ),
                    Effect.as({
                      queueItemId: input.claimedMessage.id,
                      turnId: input.turn.id as TurnId,
                      status: "completed" as const,
                      assistantText: "done",
                      commandReceipts: [],
                    }),
                  ),
            }),
            Layer.succeed(RuntimeActorExtensionBindingStatePort, {
              readRuntimePromptBinding: () => Effect.succeed(binding),
              updateActorExtensionBinding: () => Effect.die("unused"),
              setActorExtensionBinding: () => Effect.die("unused"),
            }),
            Layer.succeed(RuntimeGeneratedContextRefreshService, {
              refresh: () => Effect.void,
            }),
            Layer.succeed(Extensions, {
              nativeTools: {
                declarations: () => Effect.succeed([]),
                handler: () =>
                  Effect.succeed({
                    invoke: (input: ExtensionInvocation) =>
                      Effect.sync(() => {
                        calls.push(`toolHandler:${input.command.turnId}`);
                        handlerTurnIds.push(input.command.turnId);
                        return {
                          result: { content: [{ type: "text" as const, text: "ok" }] },
                          operations: [],
                        };
                      }),
                  }),
              },
            } as unknown as ExtensionsService),
            Layer.succeed(RuntimeQueueStatePort, {
              claimNextQueuedSurfaceMessage: () =>
                Effect.sync(() => {
                  calls.push("claim");
                  if (claimed) return { value: null, afterCommit: [] };
                  claimed = true;
                  return { value: queuedMessage(), afterCommit: [] };
                }),
              markSurfaceMessageDelivered: () =>
                Effect.sync(() => {
                  calls.push("delivered");
                  return { value: queuedMessage(), afterCommit: [] };
                }),
              acceptSubmittedSurfaceMessage: () => Effect.die("unused"),
              enqueueSurfaceMessage: () => Effect.die("unused"),
              getSurfaceQueuedMessage: () => Effect.die("unused"),
              releaseExpiredSurfaceMessageClaims: () => Effect.die("unused"),
              markSurfaceMessageSteering: () => Effect.die("unused"),
              markSurfaceMessageFailed: () => Effect.die("unused"),
              markSurfaceMessageQueued: () => Effect.die("unused"),
              cancelSurfaceMessage: () => Effect.die("unused"),
            }),
            Layer.succeed(RuntimeTurnStatePort, {
              startTurn: () =>
                Effect.sync(() => {
                  calls.push(`startTurn:${turnId}`);
                  return {
                    value: {
                      id: turnId,
                      sessionId: workspaceSessionId,
                      surfacePiSessionId,
                      threadId: null,
                      requestSummary: "Use a native tool.",
                      turnDecision: "pending",
                      status: "running",
                      startedAt: "2026-07-09T00:00:00.000Z",
                      updatedAt: "2026-07-09T00:00:00.000Z",
                      finishedAt: null,
                    } satisfies RuntimeTurnRecord,
                    afterCommit: [],
                  };
                }),
              queueTopLevelTitleGeneration: (input) =>
                Effect.sync(() => {
                  calls.push(`queueTitle:${input.sessionId}:${input.surfacePiSessionId}`);
                  return {
                    value: {
                      queued: true,
                      sessionId: input.sessionId,
                      surfacePiSessionId: input.surfacePiSessionId,
                      title: "",
                    },
                    afterCommit: [titleInvalidation],
                  };
                }),
              finishTurn: ({ turnId: finishedTurnId, status }) =>
                Effect.sync(() => {
                  calls.push(`finishTurn:${finishedTurnId}:${status}`);
                  return {
                    value: {
                      id: finishedTurnId,
                      sessionId: workspaceSessionId,
                      surfacePiSessionId,
                      threadId: null,
                      requestSummary: "Use a native tool.",
                      turnDecision: "pending",
                      status,
                      startedAt: "2026-07-09T00:00:00.000Z",
                      updatedAt: "2026-07-09T00:00:01.000Z",
                      finishedAt: "2026-07-09T00:00:01.000Z",
                    } satisfies RuntimeTurnRecord,
                    afterCommit: [],
                  };
                }),
              setTurnDecision: () => Effect.die("unused"),
            }),
            Layer.succeed(RuntimeCommandStatePort, {
              createOrReuseStreamingCommand: () =>
                Effect.succeed({ value: commandRecord("requested"), afterCommit: [] }),
              startCommand: () =>
                Effect.succeed({ value: commandRecord("running"), afterCommit: [] }),
              finishCommand: () =>
                Effect.succeed({ value: commandRecord("succeeded"), afterCommit: [] }),
              createCommand: () => Effect.die("unused"),
              findCommandByToolCallId: () => Effect.die("unused"),
              findCommandById: () => Effect.die("unused"),
              updateCommandArguments: () => Effect.die("unused"),
              recordCommandEvent: () => Effect.die("unused"),
              recordStdinWrite: () => Effect.die("unused"),
              hasCommandOutputEvent: () => Effect.die("unused"),
            }),
            Layer.succeed(RuntimeRequestStatePort, {} as never),
            Layer.succeed(RuntimeEpisodeStatePort, {} as never),
            Layer.succeed(RuntimeThreadStatePort, {} as never),
            Layer.succeed(RuntimeEventBus, {
              publishLive: () => Effect.die("unused"),
              publishStateInvalidations: (input) =>
                Effect.sync(() => {
                  if (input.afterCommit.length > 0) {
                    calls.push(`publishTitle:${input.afterCommit.length}`);
                    titlePublications.push(input.afterCommit);
                  }
                  return [];
                }),
              subscribe: () => Effect.die("unused"),
            }),
            Layer.succeed(RuntimeSourceInvalidationService, {
              hint: () => Effect.void,
              reconcile: () => Effect.die("unused"),
              applyCommittedScanEvent: () => Effect.die("unused"),
              refreshGeneratedContext: () => Effect.void,
              refreshGeneratedPackages: () => Effect.die("unused"),
            }),
          ),
        ),
      );
    },
  );
});
