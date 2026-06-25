import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import {
  type AbsolutePath,
  type CommandId,
  type CreateRuntimeRequestInputInput,
  type EpisodeId,
  type EnqueueRuntimeSurfaceMessageInput,
  type ExtensionExecutionPlanId,
  type ExtensionId,
  type GeneratedPackagesRefreshResult,
  type PromptExecutionContext,
  type PromptTarget,
  type QueueItemId,
  type RecoveryWorkId,
  type RequestInputRequestId,
  RuntimeCommandStatePort,
  type RuntimeCommandStatePortService,
  RuntimeActorExtensionBindingStatePort,
  type RuntimeActorExtensionBindingRecord,
  type RuntimeActorExtensionBindingStatePortService,
  RuntimeContractError,
  RuntimeEventStreamError,
  type RuntimeEventSequence,
  RuntimeQueueStatePort,
  type RuntimeQueueStatePortService,
  RuntimeEpisodeStatePort,
  type RuntimeEpisodeStatePortService,
  type RuntimeEffectRequest,
  type RuntimeEpisodeRecord,
  type RuntimeRequestInputRecord,
  RuntimeRequestStatePort,
  type RuntimeRequestStatePortService,
  type RuntimeSurfaceMessageRecord,
  RuntimeThreadStatePort,
  type RuntimeThreadStatePortService,
  type StateInvalidationDescriptor,
  type StartRuntimeHandlerThreadsInput,
  type StartRuntimeHandlerThreadsResult,
  type SurfacePiSessionId,
  type ThreadGroupId,
  type ThreadId,
  type ToolCallId,
  type ToolItemId,
  type TurnId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { Extensions, type ExtensionsService } from "@svvy/extensions";
import type { Runtime } from "./index";
import { runTestEffect } from "./effect.test-support";
import {
  applyExtensionRuntimeOperations,
  applyRuntimeEffectRequests,
  RuntimeHandlerThreadStartPreparationHost,
  RuntimeQueueInsertPostCommitLane,
  type StartedHandlerThreadsResult,
} from "./runtime-effect-requests";
import { runAcceptedRequestUserInputToolCall } from "./request-user-input-operation";
import { RuntimeEventBus } from "./runtime-event-bus";

type RuntimeSourceInvalidationService = Runtime["Service"]["sourceInvalidation"];

const target = {
  workspaceSessionId: "wsess_runtime_effects_01" as WorkspaceSessionId,
  surface: "orchestrator",
  surfacePiSessionId: "pi_runtime_effects_01" as SurfacePiSessionId,
} satisfies PromptTarget;

const turnId = "turn_runtime_effects_01" as TurnId;
const toolItemId = "tool_item_runtime_effects_01" as ToolItemId;
const commandId = "command_runtime_effects_01" as CommandId;
const episodeId = "episode_runtime_effects_01" as EpisodeId;
const requestId = "request_input_runtime_effects_01" as RequestInputRequestId;
const threadId = "thread_runtime_effects_01" as ThreadId;
const threadGroupId = "thread_group_runtime_effects_01" as ThreadGroupId;
const queuedMessageId = "queue_runtime_effects_01" as QueueItemId;

const handlerTarget = {
  workspaceSessionId: target.workspaceSessionId,
  surface: "handler",
  surfacePiSessionId: "pi_runtime_effects_handler_01" as SurfacePiSessionId,
  threadId,
} satisfies PromptTarget;
const queueInvalidation = {
  scope: "workspace",
  workspaceId: "workspace_runtime_effects_01" as WorkspaceId,
  invalidation: { model: "surface", ids: [handlerTarget.surfacePiSessionId] },
} satisfies StateInvalidationDescriptor;

function queuedRecordFromInput(
  input: EnqueueRuntimeSurfaceMessageInput,
  id = queuedMessageId,
): RuntimeSurfaceMessageRecord {
  return {
    id,
    sessionId: input.sessionId,
    surfacePiSessionId: input.surfacePiSessionId,
    threadId: input.threadId ?? null,
    workflowTaskAttemptId: input.workflowTaskAttemptId ?? null,
    kind: input.kind ?? "user_message",
    idempotencyKey: input.idempotencyKey ?? `surface_queue:${id}`,
    messageJson: input.messageJson,
    payloadJson: input.payloadJson ?? null,
    status: "queued",
    priority: input.priority ?? "runtime",
    orderingKey: input.orderingKey ?? `surface:${input.surfacePiSessionId}`,
    sequence: 1,
    position: 1,
    sourceCommandId: input.sourceCommandId ?? null,
    claimOwnerId: null,
    claimLeaseExpiresAt: null,
    leaseVersion: 0,
    attemptCount: 0,
    maxAttempts: input.maxAttempts ?? 3,
    nextAttemptAt: input.nextAttemptAt ?? null,
    lastErrorJson: null,
    createdAt: "2026-04-18T09:00:00.000Z",
    updatedAt: "2026-04-18T09:00:00.000Z",
    deliveredAt: null,
    failedAt: null,
    failureError: null,
    cancelledAt: null,
  };
}

function stateMutation<T>(value: T, afterCommit: readonly StateInvalidationDescriptor[] = []) {
  return { value, afterCommit };
}

function eventBus(calls: string[], options?: { readonly publishFails?: boolean }) {
  return RuntimeEventBus.of({
    publishLive: () => Effect.die("Unexpected live event publication."),
    publishStateInvalidations: (input) =>
      Effect.gen(function* () {
        yield* Effect.sync(() => calls.push(`publish:${input.afterCommit.length}`));
        if (options?.publishFails) {
          return yield* Effect.fail(
            new RuntimeEventStreamError({
              operation: "runtime.events.publishStateInvalidations",
              reason: "stream-failed",
              message: "Runtime event bus failed.",
              latestSequence: 0 as RuntimeEventSequence,
            }),
          );
        }
        return [];
      }),
    subscribe: () => Effect.die("Unexpected runtime event subscription."),
  });
}

function queueInsertPostCommitLane(
  calls: string[],
  options?: { readonly postCommitFails?: boolean },
) {
  return RuntimeQueueInsertPostCommitLane.of({
    afterQueueInsertCommitted: (input) =>
      Effect.gen(function* () {
        yield* Effect.sync(() =>
          calls.push(`postCommit:${input.queuedMessageId}:${input.target.surfacePiSessionId}`),
        );
        if (options?.postCommitFails) {
          return yield* Effect.fail(
            new RuntimeContractError({
              operation: "runtime.effects.apply",
              reason: "stale-state",
              message: "Queue insert post-commit lane failed.",
            }),
          );
        }
      }),
  });
}

function extensionsServiceWithReadiness(
  readiness: {
    envReadiness: "ready" | "not_required" | "missing";
    dependencyReadiness: "ready" | "not_required" | "missing";
  } = { envReadiness: "not_required", dependencyReadiness: "ready" },
): Extensions["Service"] {
  return Extensions.of({
    registry: {
      list: () => Effect.succeed([]),
      inspect: ({ id }) =>
        Effect.succeed({
          id,
          category: "builtin",
          interface: "instructions",
          title: id,
          description: `${id} extension`,
          instructionSourceFiles: [],
          minimalLoadingHint: "",
          typescriptApiEnabled: false,
          envReadiness: readiness.envReadiness,
          dependencyReadiness: readiness.dependencyReadiness,
          resetBehavior: "builtin_reset",
          deleteBehavior: "not_allowed",
        }),
    },
    actorBindings: {
      resolve: () => Effect.succeed({ loadedExtensionIds: [], availableExtensionIds: [] }),
      visibleRecords: () =>
        Effect.succeed({
          loaded: [],
          available: [],
        }),
    },
    nativeTools: {
      schemasJson: () => Effect.succeed("[]"),
      schemaJsonForExtension: () => Effect.succeed("{}"),
      listCommandMetadata: () => Effect.succeed([]),
      getCommandMetadata: () => Effect.succeed(null),
      handler: () => Effect.die("Unexpected native tool handler lookup."),
    },
    generatedPackages: {
      refresh: () => Effect.die("Unexpected generated package refresh."),
      planWorkspaceLink: () => Effect.die("Unexpected generated package workspace link plan."),
    },
  } satisfies ExtensionsService);
}

describe("runtime effect request application", () => {
  it("applies request_input.create through RuntimeRequestStatePort", async () => {
    const createCalls: CreateRuntimeRequestInputInput[] = [];
    const calls: string[] = [];
    const requestStatePort = {
      createRequestInput: (input) => {
        createCalls.push(input);
        return Effect.succeed(
          stateMutation(
            {
              requestId,
              sessionId: input.target.workspaceSessionId,
              surfacePiSessionId: input.target.surfacePiSessionId,
              threadId: input.target.surface === "handler" ? input.target.threadId : null,
              turnId: input.turnId,
              commandId: input.sourceCommandId,
              variant: input.mode,
              status: "open",
              questionCount: input.questions.length,
            } satisfies RuntimeRequestInputRecord,
            [queueInvalidation],
          ),
        );
      },
      ...unexpectedRequestStateMethods(),
      answerRequestInput: () => Effect.die("Unexpected request input answer."),
      setRequestInputTimerPaused: () => Effect.die("Unexpected request input timer pause."),
    } satisfies RuntimeRequestStatePortService;

    const applied = await runTestEffect(
      applyRuntimeEffectRequests(
        {
          target,
          turnId,
          toolItemId,
        },
        [
          {
            type: "request_input.create",
            input: {
              target,
              sourceCommandId: commandId,
              mode: "nonblocking",
              timeout: null,
              questions: [
                {
                  title: "CI scope",
                  question: "Should CI run unit checks or the full suite?",
                  options: [
                    {
                      label: "Unit checks only",
                      description: "Faster.",
                      recommended: true,
                    },
                    {
                      label: "Full suite",
                      description: "Slower.",
                    },
                  ],
                },
                {
                  title: "Release note",
                  question: "What tone should I use?",
                  defaultAnswer: "Concise engineering summary.",
                },
              ],
            },
          },
        ],
      ).pipe(
        Effect.provideService(RuntimeRequestStatePort, requestStatePort),
        Effect.provideService(RuntimeEventBus, eventBus(calls)),
      ),
    );

    expect(createCalls).toEqual([
      {
        target,
        turnId,
        toolItemId,
        sourceCommandId: commandId,
        mode: "nonblocking",
        timeout: null,
        questions: [
          {
            title: "CI scope",
            question: "Should CI run unit checks or the full suite?",
            defaultAnswer: {
              kind: "option",
              label: "Unit checks only",
              text: "Unit checks only",
            },
            choices: [
              {
                label: "Unit checks only",
                description: "Faster.",
                recommended: true,
              },
              {
                label: "Full suite",
                description: "Slower.",
                recommended: false,
              },
            ],
          },
          {
            title: "Release note",
            question: "What tone should I use?",
            defaultAnswer: {
              kind: "custom",
              text: "Concise engineering summary.",
            },
          },
        ],
      },
    ]);
    expect(calls).toEqual(["publish:1"]);
    expect(applied).toEqual([
      {
        type: "request_input.create",
        request: {
          requestId,
          sessionId: target.workspaceSessionId,
          surfacePiSessionId: target.surfacePiSessionId,
          threadId: null,
          turnId,
          commandId,
          variant: "nonblocking",
          status: "open",
          questionCount: 2,
        },
      },
    ]);
  });

  it("applies ordered runtime_effect operation items", async () => {
    const createCalls: CreateRuntimeRequestInputInput[] = [];
    const calls: string[] = [];
    const requestStatePort = {
      createRequestInput: (input) => {
        createCalls.push(input);
        return Effect.succeed(
          stateMutation(
            {
              requestId,
              sessionId: input.target.workspaceSessionId,
              surfacePiSessionId: input.target.surfacePiSessionId,
              threadId: input.target.surface === "handler" ? input.target.threadId : null,
              turnId: input.turnId,
              commandId: input.sourceCommandId,
              variant: input.mode,
              status: "open",
              questionCount: input.questions.length,
            } satisfies RuntimeRequestInputRecord,
            [queueInvalidation],
          ),
        );
      },
      ...unexpectedRequestStateMethods(),
      answerRequestInput: () => Effect.die("Unexpected request input answer."),
      setRequestInputTimerPaused: () => Effect.die("Unexpected request input timer pause."),
    } satisfies RuntimeRequestStatePortService;

    const request = {
      type: "request_input.create",
      input: {
        target,
        sourceCommandId: commandId,
        mode: "nonblocking",
        timeout: null,
        questions: [
          {
            title: "Scope",
            question: "What should happen next?",
            defaultAnswer: "Keep the operation item path.",
          },
        ],
      },
    } satisfies RuntimeEffectRequest;

    const applied = await runTestEffect(
      applyExtensionRuntimeOperations({ target, turnId, toolItemId }, [
        { kind: "runtime_effect", request },
      ]).pipe(
        Effect.provideService(RuntimeRequestStatePort, requestStatePort),
        Effect.provideService(RuntimeEventBus, eventBus(calls)),
      ),
    );

    expect(createCalls).toHaveLength(1);
    expect(calls).toEqual(["publish:1"]);
    expect(applied).toEqual([
      {
        type: "request_input.create",
        request: {
          requestId,
          sessionId: target.workspaceSessionId,
          surfacePiSessionId: target.surfacePiSessionId,
          threadId: null,
          turnId,
          commandId,
          variant: "nonblocking",
          status: "open",
          questionCount: 1,
        },
      },
    ]);
  });

  it("maps request_input.create publication failures after state commit to runtime contract failures", async () => {
    const calls: string[] = [];
    const requestStatePort = {
      createRequestInput: (input) => {
        calls.push(`state:${input.sourceCommandId}`);
        return Effect.succeed(
          stateMutation(
            {
              requestId,
              sessionId: input.target.workspaceSessionId,
              surfacePiSessionId: input.target.surfacePiSessionId,
              threadId: input.target.surface === "handler" ? input.target.threadId : null,
              turnId: input.turnId,
              commandId: input.sourceCommandId,
              variant: input.mode,
              status: "open",
              questionCount: input.questions.length,
            } satisfies RuntimeRequestInputRecord,
            [queueInvalidation],
          ),
        );
      },
      ...unexpectedRequestStateMethods(),
      answerRequestInput: () => Effect.die("Unexpected request input answer."),
      setRequestInputTimerPaused: () => Effect.die("Unexpected request input timer pause."),
    } satisfies RuntimeRequestStatePortService;

    await expect(
      runTestEffect(
        applyRuntimeEffectRequests(
          {
            target,
            turnId,
            toolItemId,
          },
          [
            {
              type: "request_input.create",
              input: {
                target,
                sourceCommandId: commandId,
                mode: "nonblocking",
                timeout: null,
                questions: [
                  {
                    title: "Publication",
                    question: "Should this commit publish?",
                    defaultAnswer: "Yes.",
                  },
                ],
              },
            },
          ],
        ).pipe(
          Effect.provideService(RuntimeRequestStatePort, requestStatePort),
          Effect.provideService(RuntimeEventBus, eventBus(calls, { publishFails: true })),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      operation: "runtime.effects.apply",
      reason: "stale-state",
      message: "Runtime event bus did not accept request_input.create notifications.",
    });
    expect(calls).toEqual([`state:${commandId}`, "publish:1"]);
  });

  it("rejects execution_plan operation items in the runtime effect lane", async () => {
    await expect(
      runTestEffect(
        applyExtensionRuntimeOperations({ target, turnId, toolItemId }, [
          {
            kind: "execution_plan",
            plan: {
              type: "file_effect.apply_patch",
              planId: "plan_runtime_effects_01" as ExtensionExecutionPlanId,
              cwd: "/tmp/svvy-runtime-effects" as AbsolutePath,
              patch: "*** Begin Patch\n*** Add File: noop.txt\n+noop\n*** End Patch\n",
            },
          },
        ]),
      ),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      reason: "unsupported-operation",
      message:
        "Extension execution plans require a runtime-owned command executor and cannot be applied by the runtime effect lane.",
    });
  });

  it("rejects effect requests targeting another active prompt", async () => {
    const requestStatePort = {
      createRequestInput: () => {
        throw new Error("Unexpected state write.");
      },
      answerRequestInput: () => {
        throw new Error("Unexpected request input answer.");
      },
      setRequestInputTimerPaused: () => {
        throw new Error("Unexpected request input timer pause.");
      },
    } as unknown as RuntimeRequestStatePortService;

    await expect(
      runTestEffect(
        applyRuntimeEffectRequests(
          {
            target,
            turnId: "turn_runtime_effects_02" as TurnId,
            toolItemId: "tool_item_runtime_effects_02" as ToolItemId,
          },
          [
            {
              type: "request_input.create",
              input: {
                target: {
                  ...target,
                  surfacePiSessionId: "pi_runtime_effects_other" as SurfacePiSessionId,
                },
                sourceCommandId: "command_runtime_effects_02" as CommandId,
                mode: "nonblocking",
                timeout: null,
                questions: [
                  {
                    title: "Scope",
                    question: "What should happen?",
                    defaultAnswer: "Keep the current behavior.",
                  },
                ],
              },
            },
          ],
        ).pipe(Effect.provideService(RuntimeRequestStatePort, requestStatePort)),
      ),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      reason: "invalid-input",
      message: "Runtime effect request target does not match the active command target.",
    });
  });

  it("applies queue.insert through RuntimeQueueStatePort", async () => {
    const calls: string[] = [];
    const enqueueCalls: EnqueueRuntimeSurfaceMessageInput[] = [];
    const queueStatePort = {
      acceptSubmittedSurfaceMessage: () =>
        Effect.die("Unexpected acceptSubmittedSurfaceMessage call."),
      enqueueSurfaceMessage: (input) => {
        calls.push(`state:${input.surfacePiSessionId}`);
        enqueueCalls.push(input);
        return Effect.succeed(stateMutation(queuedRecordFromInput(input), [queueInvalidation]));
      },
      getSurfaceQueuedMessage: () => Effect.die("Unexpected queue get."),
      claimNextQueuedSurfaceMessage: () => Effect.die("Unexpected queue claim."),
      releaseExpiredSurfaceMessageClaims: () => Effect.die("Unexpected claim release."),
      markSurfaceMessageSteering: () => Effect.die("Unexpected queue steer."),
      markSurfaceMessageQueued: () => Effect.die("Unexpected queue requeue."),
      markSurfaceMessageDelivered: () => Effect.die("Unexpected queue delivered."),
      markSurfaceMessageFailed: () => Effect.die("Unexpected queue failure."),
      cancelSurfaceMessage: () => Effect.die("Unexpected queue cancellation."),
    } satisfies RuntimeQueueStatePortService;

    const request = {
      type: "queue.insert",
      input: {
        target: handlerTarget,
        kind: "thread_followup",
        idempotencyKey: "thread_followup:runtime_effects:01",
        sourceCommandId: commandId,
        priority: "runtime",
        notBefore: "2026-04-18T09:05:00.000Z",
        payload: {
          kind: "thread_followup",
          threadIds: [threadId],
          message: "Please rerun the focused verification.",
          sender: "orchestrator",
          activate: true,
        },
      },
    } satisfies RuntimeEffectRequest;

    const applied = await runTestEffect(
      applyRuntimeEffectRequests({ target, turnId, toolItemId }, [request]).pipe(
        Effect.provideService(RuntimeQueueStatePort, queueStatePort),
        Effect.provideService(RuntimeEventBus, eventBus(calls)),
        Effect.provideService(RuntimeQueueInsertPostCommitLane, queueInsertPostCommitLane(calls)),
      ),
    );

    const expectedPayload = JSON.stringify(request.input.payload);
    expect(enqueueCalls).toEqual([
      {
        sessionId: handlerTarget.workspaceSessionId,
        surfacePiSessionId: handlerTarget.surfacePiSessionId,
        threadId: handlerTarget.threadId,
        workflowTaskAttemptId: null,
        kind: "thread_followup",
        idempotencyKey: "thread_followup:runtime_effects:01",
        priority: "runtime",
        orderingKey: `surface:${handlerTarget.surfacePiSessionId}`,
        sourceCommandId: commandId,
        nextAttemptAt: "2026-04-18T09:05:00.000Z",
        messageJson: expectedPayload,
        payloadJson: expectedPayload,
      },
    ]);
    expect(applied).toEqual([
      {
        type: "queue.insert",
        queuedMessage: queuedRecordFromInput(enqueueCalls[0]!),
      },
    ]);
    expect(calls).toEqual([
      `state:${handlerTarget.surfacePiSessionId}`,
      "publish:1",
      `postCommit:${queuedMessageId}:${handlerTarget.surfacePiSessionId}`,
    ]);
  });

  it("maps queue.insert publication failures after state commit to runtime contract failures", async () => {
    const calls: string[] = [];
    const queueStatePort = {
      acceptSubmittedSurfaceMessage: () =>
        Effect.die("Unexpected acceptSubmittedSurfaceMessage call."),
      enqueueSurfaceMessage: (input) => {
        calls.push(`state:${input.surfacePiSessionId}`);
        return Effect.succeed(stateMutation(queuedRecordFromInput(input), [queueInvalidation]));
      },
      getSurfaceQueuedMessage: () => Effect.die("Unexpected queue get."),
      claimNextQueuedSurfaceMessage: () => Effect.die("Unexpected queue claim."),
      releaseExpiredSurfaceMessageClaims: () => Effect.die("Unexpected claim release."),
      markSurfaceMessageSteering: () => Effect.die("Unexpected queue steer."),
      markSurfaceMessageQueued: () => Effect.die("Unexpected queue requeue."),
      markSurfaceMessageDelivered: () => Effect.die("Unexpected queue delivered."),
      markSurfaceMessageFailed: () => Effect.die("Unexpected queue failure."),
      cancelSurfaceMessage: () => Effect.die("Unexpected queue cancellation."),
    } satisfies RuntimeQueueStatePortService;

    const request = {
      type: "queue.insert",
      input: {
        target: handlerTarget,
        kind: "thread_followup",
        idempotencyKey: "thread_followup:runtime_effects:publish_failure",
        payload: {
          kind: "thread_followup",
          threadIds: [threadId],
          message: "Please rerun the focused verification.",
          sender: "orchestrator",
          activate: true,
        },
      },
    } satisfies RuntimeEffectRequest;

    await expect(
      runTestEffect(
        applyRuntimeEffectRequests({ target, turnId, toolItemId }, [request]).pipe(
          Effect.provideService(RuntimeQueueStatePort, queueStatePort),
          Effect.provideService(RuntimeEventBus, eventBus(calls, { publishFails: true })),
          Effect.provideService(RuntimeQueueInsertPostCommitLane, queueInsertPostCommitLane(calls)),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      operation: "runtime.effects.apply",
      reason: "stale-state",
    });
    expect(calls).toEqual([`state:${handlerTarget.surfacePiSessionId}`, "publish:1"]);
  });

  it("maps queue.insert post-commit lane failures after publication to runtime contract failures", async () => {
    const calls: string[] = [];
    const queueStatePort = {
      acceptSubmittedSurfaceMessage: () =>
        Effect.die("Unexpected acceptSubmittedSurfaceMessage call."),
      enqueueSurfaceMessage: (input) => {
        calls.push(`state:${input.surfacePiSessionId}`);
        return Effect.succeed(stateMutation(queuedRecordFromInput(input), [queueInvalidation]));
      },
      getSurfaceQueuedMessage: () => Effect.die("Unexpected queue get."),
      claimNextQueuedSurfaceMessage: () => Effect.die("Unexpected queue claim."),
      releaseExpiredSurfaceMessageClaims: () => Effect.die("Unexpected claim release."),
      markSurfaceMessageSteering: () => Effect.die("Unexpected queue steer."),
      markSurfaceMessageQueued: () => Effect.die("Unexpected queue requeue."),
      markSurfaceMessageDelivered: () => Effect.die("Unexpected queue delivered."),
      markSurfaceMessageFailed: () => Effect.die("Unexpected queue failure."),
      cancelSurfaceMessage: () => Effect.die("Unexpected queue cancellation."),
    } satisfies RuntimeQueueStatePortService;

    const request = {
      type: "queue.insert",
      input: {
        target: handlerTarget,
        kind: "thread_followup",
        idempotencyKey: "thread_followup:runtime_effects:post_commit_failure",
        payload: {
          kind: "thread_followup",
          threadIds: [threadId],
          message: "Please rerun the focused verification.",
          sender: "orchestrator",
          activate: true,
        },
      },
    } satisfies RuntimeEffectRequest;

    await expect(
      runTestEffect(
        applyRuntimeEffectRequests({ target, turnId, toolItemId }, [request]).pipe(
          Effect.provideService(RuntimeQueueStatePort, queueStatePort),
          Effect.provideService(RuntimeEventBus, eventBus(calls)),
          Effect.provideService(
            RuntimeQueueInsertPostCommitLane,
            queueInsertPostCommitLane(calls, { postCommitFails: true }),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      operation: "runtime.effects.apply",
      reason: "stale-state",
    });
    expect(calls).toEqual([
      `state:${handlerTarget.surfacePiSessionId}`,
      "publish:1",
      `postCommit:${queuedMessageId}:${handlerTarget.surfacePiSessionId}`,
    ]);
  });

  it("applies episode.record through RuntimeEpisodeStatePort for the active handler thread", async () => {
    const recordCalls: RuntimeEffectRequest[] = [];
    const calls: string[] = [];
    const episodeStatePort = {
      recordHandlerThreadEpisode: (input) => {
        recordCalls.push({ type: "episode.record", input });
        return Effect.succeed(
          stateMutation(
            {
              id: episodeId,
              sessionId: input.workspaceSessionId,
              threadId: input.threadId,
              threadGroupId: input.threadGroupId,
              sourceCommandId: input.sourceCommandId ?? null,
              kind: input.kind,
              title: input.summary,
              summary: input.summary,
              body: input.body ?? "",
              createdAt: "2026-04-18T09:10:00.000Z",
            } satisfies RuntimeEpisodeRecord,
            [queueInvalidation],
          ),
        );
      },
    } satisfies RuntimeEpisodeStatePortService;
    const request = {
      type: "episode.record",
      input: {
        scope: "handler-thread",
        workspaceSessionId: handlerTarget.workspaceSessionId,
        threadId,
        threadGroupId,
        sourceCommandId: commandId,
        kind: "conclusion",
        summary: "The runtime-effect applier now records handler episodes.",
        body: "The state port owns the durable episode row.",
        outcome: "completed",
        notifyOrchestrator: true,
      },
    } satisfies RuntimeEffectRequest;

    const applied = await runTestEffect(
      applyRuntimeEffectRequests(
        {
          target: handlerTarget,
          turnId,
          toolItemId,
        },
        [request],
      ).pipe(
        Effect.provideService(RuntimeEpisodeStatePort, episodeStatePort),
        Effect.provideService(RuntimeEventBus, eventBus(calls)),
      ),
    );

    expect(recordCalls).toEqual([request]);
    expect(calls).toEqual(["publish:1"]);
    expect(applied).toEqual([
      {
        type: "episode.record",
        episode: {
          id: episodeId,
          sessionId: handlerTarget.workspaceSessionId,
          threadId,
          threadGroupId,
          sourceCommandId: commandId,
          kind: "conclusion",
          title: "The runtime-effect applier now records handler episodes.",
          summary: "The runtime-effect applier now records handler episodes.",
          body: "The state port owns the durable episode row.",
          createdAt: "2026-04-18T09:10:00.000Z",
        },
      },
    ]);
  });

  it("maps episode.record publication failures after state commit to runtime contract failures", async () => {
    const calls: string[] = [];
    const episodeStatePort = {
      recordHandlerThreadEpisode: (input) => {
        calls.push(`state:${input.threadId}`);
        return Effect.succeed(
          stateMutation(
            {
              id: episodeId,
              sessionId: input.workspaceSessionId,
              threadId: input.threadId,
              threadGroupId: input.threadGroupId,
              sourceCommandId: input.sourceCommandId ?? null,
              kind: input.kind,
              title: input.summary,
              summary: input.summary,
              body: input.body ?? "",
              createdAt: "2026-04-18T09:10:00.000Z",
            } satisfies RuntimeEpisodeRecord,
            [queueInvalidation],
          ),
        );
      },
    } satisfies RuntimeEpisodeStatePortService;

    await expect(
      runTestEffect(
        applyRuntimeEffectRequests(
          {
            target: handlerTarget,
            turnId,
            toolItemId,
          },
          [
            {
              type: "episode.record",
              input: {
                scope: "handler-thread",
                workspaceSessionId: handlerTarget.workspaceSessionId,
                threadId,
                threadGroupId,
                sourceCommandId: commandId,
                kind: "report",
                summary: "Publication should fail after this durable episode commit.",
              },
            },
          ],
        ).pipe(
          Effect.provideService(RuntimeEpisodeStatePort, episodeStatePort),
          Effect.provideService(RuntimeEventBus, eventBus(calls, { publishFails: true })),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      operation: "runtime.effects.apply",
      reason: "stale-state",
      message: "Runtime event bus did not accept episode.record notifications.",
    });
    expect(calls).toEqual([`state:${threadId}`, "publish:1"]);
  });

  it("rejects episode.record when the active handler thread does not own the request", async () => {
    const episodeStatePort = {
      recordHandlerThreadEpisode: () => Effect.die("Unexpected episode recording."),
    } satisfies RuntimeEpisodeStatePortService;

    await expect(
      runTestEffect(
        applyRuntimeEffectRequests(
          {
            target,
            turnId,
            toolItemId,
          },
          [
            {
              type: "episode.record",
              input: {
                scope: "handler-thread",
                workspaceSessionId: handlerTarget.workspaceSessionId,
                threadId,
                threadGroupId,
                sourceCommandId: commandId,
                kind: "report",
                summary: "This request belongs to a handler, not the orchestrator.",
              },
            },
          ],
        ).pipe(Effect.provideService(RuntimeEpisodeStatePort, episodeStatePort)),
      ),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      reason: "invalid-input",
      message: "Episode record request target does not match the active handler thread.",
    });
  });

  it("applies actor_extension_binding.update through state and schedules target context refresh", async () => {
    const updateCalls: RuntimeEffectRequest[] = [];
    const refreshCalls: RuntimeEffectRequest[] = [];
    const calls: string[] = [];
    const bindingStatePort = {
      updateActorExtensionBinding: (input) => {
        calls.push(`state:${input.extensionId}`);
        updateCalls.push({ type: "actor_extension_binding.update", input });
        return Effect.succeed(
          stateMutation(
            {
              target: input.target,
              loadedExtensionIds: ["base-common" as ExtensionId, input.extensionId],
              availableExtensionIds: [],
              generatedAgentContextFingerprint: "fingerprint_actor_binding_before",
              updateExtensionContextBeforeNextTurn: true,
            } satisfies RuntimeActorExtensionBindingRecord,
            [queueInvalidation],
          ),
        );
      },
      setActorExtensionBinding: () => Effect.die("Unexpected actor binding set."),
    } satisfies RuntimeActorExtensionBindingStatePortService;
    const sourceInvalidation = {
      refreshGeneratedContext: (input) => {
        calls.push(`refresh:${input.reason}`);
        refreshCalls.push({ type: "generated_context.refresh", input });
        return Effect.void;
      },
      refreshGeneratedPackages: () => Effect.die("Unexpected generated package refresh."),
    } satisfies Pick<
      RuntimeSourceInvalidationService,
      "refreshGeneratedContext" | "refreshGeneratedPackages"
    >;
    const request = {
      type: "actor_extension_binding.update",
      input: {
        target,
        extensionId: "smithers" as ExtensionId,
        usage: "loaded",
        reason: "load_extension",
        sourceCommandId: commandId,
      },
    } satisfies RuntimeEffectRequest;

    const applied = await runTestEffect(
      applyRuntimeEffectRequests({ target, turnId, toolItemId, sourceInvalidation }, [
        request,
      ]).pipe(
        Effect.provideService(RuntimeActorExtensionBindingStatePort, bindingStatePort),
        Effect.provideService(Extensions, extensionsServiceWithReadiness()),
        Effect.provideService(RuntimeEventBus, eventBus(calls)),
      ),
    );

    expect(updateCalls).toEqual([request]);
    expect(calls).toEqual(["state:smithers", "publish:1", "refresh:load-extension"]);
    expect(refreshCalls).toEqual([
      {
        type: "generated_context.refresh",
        input: {
          scope: "target",
          target,
          actorKind: "orchestrator",
          reason: "load-extension",
          sourceCommandId: commandId,
          refreshBoundSurfaceBeforeNextTurn: true,
        },
      },
    ]);
    expect(applied).toEqual([
      {
        type: "actor_extension_binding.update",
        binding: {
          target,
          loadedExtensionIds: ["base-common" as ExtensionId, "smithers" as ExtensionId],
          availableExtensionIds: [],
          generatedAgentContextFingerprint: "fingerprint_actor_binding_before",
          updateExtensionContextBeforeNextTurn: true,
        },
      },
    ]);
  });

  it("maps actor_extension_binding.update publication failures before generated-context refresh", async () => {
    const calls: string[] = [];
    const bindingStatePort = {
      updateActorExtensionBinding: (input) => {
        calls.push(`state:${input.extensionId}`);
        return Effect.succeed(
          stateMutation(
            {
              target: input.target,
              loadedExtensionIds: ["base-common" as ExtensionId, input.extensionId],
              availableExtensionIds: [],
              generatedAgentContextFingerprint: "fingerprint_actor_binding_before",
              updateExtensionContextBeforeNextTurn: true,
            } satisfies RuntimeActorExtensionBindingRecord,
            [queueInvalidation],
          ),
        );
      },
      setActorExtensionBinding: () => Effect.die("Unexpected actor binding set."),
    } satisfies RuntimeActorExtensionBindingStatePortService;
    const sourceInvalidation = {
      refreshGeneratedContext: () => {
        calls.push("refresh:unexpected");
        return Effect.die("Unexpected generated context refresh after publication failure.");
      },
      refreshGeneratedPackages: () => Effect.die("Unexpected generated package refresh."),
    } satisfies Pick<
      RuntimeSourceInvalidationService,
      "refreshGeneratedContext" | "refreshGeneratedPackages"
    >;

    await expect(
      runTestEffect(
        applyRuntimeEffectRequests({ target, turnId, toolItemId, sourceInvalidation }, [
          {
            type: "actor_extension_binding.update",
            input: {
              target,
              extensionId: "smithers" as ExtensionId,
              usage: "loaded",
              reason: "load_extension",
              sourceCommandId: commandId,
            },
          },
        ]).pipe(
          Effect.provideService(RuntimeActorExtensionBindingStatePort, bindingStatePort),
          Effect.provideService(Extensions, extensionsServiceWithReadiness()),
          Effect.provideService(RuntimeEventBus, eventBus(calls, { publishFails: true })),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      operation: "runtime.effects.apply",
      reason: "stale-state",
      message: "Runtime event bus did not accept actor_extension_binding.update notifications.",
    });
    expect(calls).toEqual(["state:smithers", "publish:1"]);
  });

  it("rejects actor_extension_binding.update when the active target does not own the request", async () => {
    const bindingStatePort = {
      updateActorExtensionBinding: () => Effect.die("Unexpected actor binding update."),
      setActorExtensionBinding: () => Effect.die("Unexpected actor binding set."),
    } satisfies RuntimeActorExtensionBindingStatePortService;

    await expect(
      runTestEffect(
        applyRuntimeEffectRequests(
          {
            target,
            turnId,
            toolItemId,
          },
          [
            {
              type: "actor_extension_binding.update",
              input: {
                target: handlerTarget,
                extensionId: "smithers" as ExtensionId,
                usage: "loaded",
                reason: "load_extension",
                sourceCommandId: commandId,
              },
            },
          ],
        ).pipe(Effect.provideService(RuntimeActorExtensionBindingStatePort, bindingStatePort)),
      ),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      reason: "invalid-input",
      message: "Actor extension binding request target does not match the active command target.",
    });
  });

  it("rejects actor_extension_binding.update before mutation when generated-context refresh is unavailable", async () => {
    const bindingStatePort = {
      updateActorExtensionBinding: () => Effect.die("Unexpected actor binding update."),
      setActorExtensionBinding: () => Effect.die("Unexpected actor binding set."),
    } satisfies RuntimeActorExtensionBindingStatePortService;

    await expect(
      runTestEffect(
        applyRuntimeEffectRequests({ target, turnId, toolItemId }, [
          {
            type: "actor_extension_binding.update",
            input: {
              target,
              extensionId: "smithers" as ExtensionId,
              usage: "loaded",
              reason: "load_extension",
              sourceCommandId: commandId,
            },
          },
        ]).pipe(
          Effect.provideService(RuntimeActorExtensionBindingStatePort, bindingStatePort),
          Effect.provideService(Extensions, extensionsServiceWithReadiness()),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      reason: "unsupported-operation",
      message:
        "Actor extension binding runtime effects require a source invalidation service in the application context.",
    });
  });

  it("rejects actor_extension_binding.update for extensions that are not ready", async () => {
    const bindingStatePort = {
      updateActorExtensionBinding: () => Effect.die("Unexpected actor binding update."),
      setActorExtensionBinding: () => Effect.die("Unexpected actor binding set."),
    } satisfies RuntimeActorExtensionBindingStatePortService;
    const sourceInvalidation = {
      refreshGeneratedContext: () => Effect.die("Unexpected generated context refresh."),
      refreshGeneratedPackages: () => Effect.die("Unexpected generated package refresh."),
    } satisfies Pick<
      RuntimeSourceInvalidationService,
      "refreshGeneratedContext" | "refreshGeneratedPackages"
    >;

    await expect(
      runTestEffect(
        applyRuntimeEffectRequests({ target, turnId, toolItemId, sourceInvalidation }, [
          {
            type: "actor_extension_binding.update",
            input: {
              target,
              extensionId: "smithers" as ExtensionId,
              usage: "loaded",
              reason: "load_extension",
              sourceCommandId: commandId,
            },
          },
        ]).pipe(
          Effect.provideService(RuntimeActorExtensionBindingStatePort, bindingStatePort),
          Effect.provideService(
            Extensions,
            extensionsServiceWithReadiness({
              envReadiness: "missing",
              dependencyReadiness: "ready",
            }),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      reason: "invalid-input",
      message: "Extension is not ready to load for this actor: smithers.",
    });
  });

  it("applies generated_packages.refresh through RuntimeSourceInvalidationService", async () => {
    const refreshCalls: RuntimeEffectRequest[] = [];
    const refreshResult = {
      scope: "app-global",
      packages: [{ packageName: "@svvyx/extensions", action: "written" }],
      workspaceLinks: [],
      recoveryWorkIds: [],
    } satisfies GeneratedPackagesRefreshResult;
    const sourceInvalidation = {
      refreshGeneratedContext: () => Effect.die("Unexpected generated context refresh."),
      refreshGeneratedPackages: (input) => {
        refreshCalls.push({ type: "generated_packages.refresh", input });
        return Effect.succeed(refreshResult);
      },
    } satisfies Pick<
      RuntimeSourceInvalidationService,
      "refreshGeneratedContext" | "refreshGeneratedPackages"
    >;
    const request = {
      type: "generated_packages.refresh",
      input: {
        scope: "app-global",
        packages: ["@svvyx/extensions"],
        reason: "source-changed",
        sourceCommandId: commandId,
        recoveryWorkId: "recovery_generated_refresh_01" as RecoveryWorkId,
      },
    } satisfies RuntimeEffectRequest;

    const applied = await runTestEffect(
      applyRuntimeEffectRequests({ target, turnId, toolItemId, sourceInvalidation }, [request]),
    );

    expect(refreshCalls).toEqual([request]);
    expect(applied).toEqual([{ type: "generated_packages.refresh", result: refreshResult }]);
  });

  it("rejects generated_packages.refresh when no source invalidation service is supplied", async () => {
    await expect(
      runTestEffect(
        applyRuntimeEffectRequests({ target, turnId, toolItemId }, [
          {
            type: "generated_packages.refresh",
            input: {
              scope: "app-global",
              packages: ["@svvyx/extensions"],
              reason: "source-changed",
              sourceCommandId: commandId,
            },
          },
        ]),
      ),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      reason: "unsupported-operation",
      message:
        "Generated package refresh runtime effects require a source invalidation service in the application context.",
    });
  });

  it("applies generated_context.refresh through RuntimeSourceInvalidationService", async () => {
    const refreshCalls: RuntimeEffectRequest[] = [];
    const sourceInvalidation = {
      refreshGeneratedContext: (input) => {
        refreshCalls.push({ type: "generated_context.refresh", input });
        return Effect.void;
      },
      refreshGeneratedPackages: () => Effect.die("Unexpected generated package refresh."),
    } satisfies Pick<
      RuntimeSourceInvalidationService,
      "refreshGeneratedContext" | "refreshGeneratedPackages"
    >;
    const request = {
      type: "generated_context.refresh",
      input: {
        scope: "workspace",
        workspaceId: "workspace_runtime_effects_01" as WorkspaceId,
        reason: "extension-source-changed",
        sourceCommandId: commandId,
      },
    } satisfies RuntimeEffectRequest;

    const applied = await runTestEffect(
      applyRuntimeEffectRequests({ target, turnId, toolItemId, sourceInvalidation }, [request]),
    );

    expect(refreshCalls).toEqual([request]);
    expect(applied).toEqual([{ type: "generated_context.refresh", input: request.input }]);
  });

  it("rejects generated_context.refresh when no source invalidation service is supplied", async () => {
    await expect(
      runTestEffect(
        applyRuntimeEffectRequests({ target, turnId, toolItemId }, [
          {
            type: "generated_context.refresh",
            input: {
              scope: "workspace",
              workspaceId: "workspace_runtime_effects_01" as WorkspaceId,
              reason: "extension-source-changed",
              sourceCommandId: commandId,
            },
          },
        ]),
      ),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      reason: "unsupported-operation",
      message:
        "Generated context refresh runtime effects require a source invalidation service in the application context.",
    });
  });

  it("applies handler_thread.start through runtime state, publication, and wakeup", async () => {
    const calls: string[] = [];
    const queuedMessage = queuedRecordFromInput(
      {
        sessionId: target.workspaceSessionId,
        surfacePiSessionId: handlerTarget.surfacePiSessionId,
        threadId,
        kind: "initial_handler_start",
        idempotencyKey: `initial_handler_start:${threadId}`,
        messageJson: "{}",
        payloadJson: JSON.stringify({
          threadId,
          parentSessionFile: null,
          requestedAt: "2026-04-18T09:00:00.000Z",
        }),
      },
      queuedMessageId,
    );
    const preparedInput = {
      workspaceSessionId: target.workspaceSessionId,
      orchestratorTurnId: turnId,
      sourceCommandId: commandId,
      threadGroupId,
      threads: [
        {
          surfacePiSessionId: handlerTarget.surfacePiSessionId,
          title: "Inspect the runtime-effect contract.",
          objective: "Inspect the runtime-effect contract.",
          historyMode: "forked",
          loadedExtensionIds: [],
          availableExtensionIds: [],
          agentProfileJson: null,
          generatedAgentContextBinding: {
            aggregateCacheKey: "handler-thread-cache",
            systemPrompt: "Handler prompt",
            svvyxGuidance: "",
            commandsDts: "",
            nativeToolSchemasJson: "{}",
            generatedAgentContextFingerprint: "handler-thread-fingerprint",
            generatedAgentContextRevision: 1,
            loadedExtensionIds: [],
            availableExtensionIds: [],
            externalSourceHashes: [],
          },
          initialQueue: {
            idempotencyKey: `initial_handler_start:${threadId}`,
            priority: "runtime",
            orderingKey: `surface:${handlerTarget.surfacePiSessionId}`,
            nextAttemptAt: null,
            messageJson: "{}",
            payloadJson: queuedMessage.payloadJson!,
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
          workspaceSessionId: target.workspaceSessionId,
          surfacePiSessionId: handlerTarget.surfacePiSessionId,
          title: "Inspect the runtime-effect contract.",
          objective: "Inspect the runtime-effect contract.",
          historyMode: "forked",
          objectiveState: "active",
          status: "running-handler",
          wait: null,
          worktreeId: null,
          loadedExtensionIds: [],
          availableExtensionIds: [],
          generatedAgentContextFingerprint: "handler-thread-fingerprint",
          generatedAgentContextBindingId: "handler-thread-binding",
          queuedMessage,
        },
      ],
    } satisfies StartRuntimeHandlerThreadsResult;
    const request = {
      type: "handler_thread.start",
      input: {
        workspaceSessionId: target.workspaceSessionId,
        sourceCommandId: commandId,
        threads: [
          {
            objective: "Inspect the runtime-effect contract.",
            history: "forked",
            initialQueue: {
              priority: "runtime",
            },
          },
        ],
      },
    } satisfies RuntimeEffectRequest;

    const applied = await runTestEffect(
      applyRuntimeEffectRequests(
        {
          target,
          turnId,
          toolItemId,
        },
        [request],
      ).pipe(
        Effect.provideService(
          RuntimeHandlerThreadStartPreparationHost,
          RuntimeHandlerThreadStartPreparationHost.of({
            prepareHandlerThreadStart: (input) =>
              Effect.sync(() => {
                calls.push(`prepare:${input.request.sourceCommandId}`);
                expect(input).toEqual({
                  request: request.input,
                  target,
                  turnId,
                  toolItemId,
                });
                return preparedInput;
              }),
          }),
        ),
        Effect.provideService(RuntimeThreadStatePort, {
          ensureHandlerThreadRunnable: () => Effect.die("Unexpected runnable update."),
          startHandlerThreads: (input) =>
            Effect.sync(() => {
              calls.push(`state:${input.sourceCommandId}`);
              expect(input).toEqual(preparedInput);
              return stateMutation(startResult, [queueInvalidation]);
            }),
        } satisfies RuntimeThreadStatePortService),
        Effect.provideService(RuntimeEventBus, eventBus(calls)),
        Effect.provideService(RuntimeQueueInsertPostCommitLane, queueInsertPostCommitLane(calls)),
      ),
    );

    expect(calls).toEqual([
      `prepare:${commandId}`,
      `state:${commandId}`,
      "publish:1",
      `postCommit:${queuedMessageId}:${handlerTarget.surfacePiSessionId}`,
    ]);
    expect(applied).toEqual([
      {
        type: "handler_thread.start",
        result: {
          threadGroupId,
          threads: [
            {
              threadId,
              threadGroupId,
              surfacePiSessionId: handlerTarget.surfacePiSessionId,
              objective: "Inspect the runtime-effect contract.",
              objectiveState: "active",
              queuedMessageId,
            },
          ],
        } satisfies StartedHandlerThreadsResult,
      },
    ]);
  });

  it("fails closed when handler_thread.start effects lack a preparation host", async () => {
    await expect(
      runTestEffect(
        applyRuntimeEffectRequests(
          {
            target,
            turnId,
            toolItemId,
          },
          [
            {
              type: "handler_thread.start",
              input: {
                workspaceSessionId: target.workspaceSessionId,
                sourceCommandId: commandId,
                threads: [
                  {
                    objective: "Inspect the runtime-effect contract.",
                    history: "forked",
                  },
                ],
              },
            },
          ],
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      reason: "unsupported-operation",
      message: "Handler thread start runtime effects require a handler thread preparation host.",
    });
  });

  it("rejects handler_thread.start from non-orchestrator targets", async () => {
    await expect(
      runTestEffect(
        applyRuntimeEffectRequests(
          {
            target: handlerTarget,
            turnId,
            toolItemId,
          },
          [
            {
              type: "handler_thread.start",
              input: {
                workspaceSessionId: handlerTarget.workspaceSessionId,
                sourceCommandId: commandId,
                threads: [
                  {
                    objective: "Inspect the runtime-effect contract.",
                  },
                ],
              },
            },
          ],
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      reason: "invalid-input",
      message: "Handler thread start requests must originate from an orchestrator surface.",
    });
  });

  it("runs accepted request_user_input calls through the handler and applies runtime effects", async () => {
    const createCalls: CreateRuntimeRequestInputInput[] = [];
    const progressCalls: Parameters<RuntimeCommandStatePortService["recordCommandEvent"]>[0][] = [];
    const finishCalls: Parameters<RuntimeCommandStatePortService["finishCommand"]>[0][] = [];
    const calls: string[] = [];
    const requestStatePort = {
      createRequestInput: (input) => {
        createCalls.push(input);
        return Effect.succeed(
          stateMutation(
            {
              requestId,
              sessionId: input.target.workspaceSessionId,
              surfacePiSessionId: input.target.surfacePiSessionId,
              threadId: input.target.surface === "handler" ? input.target.threadId : null,
              turnId: input.turnId,
              commandId: input.sourceCommandId,
              variant: input.mode,
              status: "open",
              questionCount: input.questions.length,
            } satisfies RuntimeRequestInputRecord,
            [queueInvalidation],
          ),
        );
      },
      ...unexpectedRequestStateMethods(),
      answerRequestInput: () => Effect.die("Unexpected request input answer."),
      setRequestInputTimerPaused: () => Effect.die("Unexpected request input timer pause."),
    } satisfies RuntimeRequestStatePortService;
    const commandStatePort = {
      createCommand: () => Effect.die("Unexpected command create."),
      createOrReuseStreamingCommand: () => Effect.die("Unexpected streaming command create."),
      findCommandByToolCallId: () => Effect.die("Unexpected command lookup by tool call."),
      findCommandById: () => Effect.die("Unexpected command lookup by id."),
      updateCommandArguments: () => Effect.die("Unexpected command argument update."),
      startCommand: () => Effect.die("Unexpected command start."),
      finishCommand: (input) => {
        finishCalls.push(input);
        return Effect.succeed(
          stateMutation({
            id: input.commandId,
            sessionId: target.workspaceSessionId,
            turnId,
            workflowTaskAttemptId: null,
            surfacePiSessionId: target.surfacePiSessionId,
            threadId: null,
            workflowRunId: null,
            parentCommandId: null,
            toolName: "request_user_input",
            executor: "orchestrator",
            visibility: "surface",
            status: input.status,
            attempts: 1,
            title: "Request user input",
            summary: input.summary ?? "",
            arguments: null,
            facts: input.facts ?? null,
            error: input.error ?? null,
            startedAt: "2026-04-18T09:00:00.000Z",
            updatedAt: "2026-04-18T09:00:00.000Z",
            finishedAt: "2026-04-18T09:00:01.000Z",
          }),
        );
      },
      recordCommandEvent: (input) => {
        progressCalls.push(input);
        return Effect.succeed(stateMutation(undefined));
      },
      recordStdinWrite: () => Effect.die("Unexpected stdin write."),
      hasCommandOutputEvent: () => Effect.die("Unexpected command output check."),
    } satisfies RuntimeCommandStatePortService;
    const context = {
      workspaceSessionId: target.workspaceSessionId,
      turnId,
      surfacePiSessionId: target.surfacePiSessionId,
      surfaceKind: "orchestrator",
      defaultEpisodeKind: "analysis",
      rootThreadId: null,
      rootEpisodeKind: "analysis",
      sessionWaitApplied: false,
      threadWasTerminalAtStart: false,
      loadedExtensionIds: ["ext_core"],
      availableExtensionIds: ["ext_core"],
      generatedAgentContextFingerprint: "fingerprint_runtime_effects",
      generatedAgentContextRevision: "revision_runtime_effects",
    } satisfies PromptExecutionContext;

    const executed = await runTestEffect(
      runAcceptedRequestUserInputToolCall({
        toolCallId: "tool_call_runtime_effects_01" as ToolCallId,
        toolItemId,
        arguments: {
          questions: [
            {
              title: "Scope",
              question: "What should the next slice cover?",
              defaultAnswer: "Move nonblocking request_user_input execution into runtime.",
            },
          ],
        },
        context,
        actorBinding: {
          loadedExtensionIds: context.loadedExtensionIds,
          availableExtensionIds: context.availableExtensionIds,
        },
        command: {
          commandId,
          target,
          turnId,
          approvalMode: "auto-review",
          sandbox: { snapshot: {} },
          cwd: "",
          baseEnv: {},
        },
      }).pipe(
        Effect.provideService(RuntimeRequestStatePort, requestStatePort),
        Effect.provideService(RuntimeCommandStatePort, commandStatePort),
        Effect.provideService(RuntimeEventBus, eventBus(calls)),
      ),
    );

    expect(createCalls).toEqual([
      {
        target,
        turnId,
        toolItemId,
        sourceCommandId: commandId,
        mode: "nonblocking",
        timeout: null,
        questions: [
          {
            title: "Scope",
            question: "What should the next slice cover?",
            defaultAnswer: {
              kind: "custom",
              text: "Move nonblocking request_user_input execution into runtime.",
            },
          },
        ],
      },
    ]);
    expect(calls).toEqual(["publish:1"]);
    expect(executed.toolResult).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify(executed.result),
        },
      ],
      details: {
        status: "succeeded",
        summary: "Defaulted answer for Scope.",
        commandFacts: {
          questionCount: 1,
          answeredBy: "default",
          result: executed.result,
        },
      },
    });
    expect(progressCalls).toEqual([
      {
        sessionId: target.workspaceSessionId,
        commandId,
        kind: "command.progress",
        data: {
          source: "request_user_input",
          phase: "created",
          message: "Created 1 user-input question.",
          facts: {
            requestId,
            variant: "nonblocking",
            questionCount: 1,
          },
        },
      },
    ]);
    expect(finishCalls).toEqual([
      {
        commandId,
        status: "succeeded",
        summary: "Defaulted answer for Scope.",
        facts: {
          questionCount: 1,
          answeredBy: "default",
          result: executed.result,
        },
      },
    ]);
  });
});

function unexpectedRequestStateMethods(): Pick<
  RuntimeRequestStatePortService,
  | "getRequestInput"
  | "listOpenBlockingRequestInputs"
  | "defaultOpenRequestInputQuestions"
  | "cancelRequestInput"
> {
  return {
    getRequestInput: () => Effect.die("Unexpected request input get."),
    listOpenBlockingRequestInputs: () => Effect.die("Unexpected request input open blocking list."),
    defaultOpenRequestInputQuestions: () =>
      Effect.die("Unexpected request input timeout defaults."),
    cancelRequestInput: () => Effect.die("Unexpected request input cancellation."),
  };
}
