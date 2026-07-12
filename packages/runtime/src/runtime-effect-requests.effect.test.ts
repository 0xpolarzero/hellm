import * as Effect from "effect/Effect";
import { assert, describe, it } from "@effect/vitest";
import {
  type AbsolutePath,
  type CommandId,
  type CreateRuntimeRequestInputInput,
  type EpisodeId,
  type EnqueueRuntimeSurfaceMessageInput,
  type ExtensionExecutionPlanId,
  type ExtensionId,
  type GeneratedPackagesRefreshResult,
  type PositiveDurationMs,
  type PromptExecutionContext,
  type PromptTarget,
  type QueueItemId,
  type RecoveryWorkId,
  type RequestInputRequestId,
  type RequestInputQuestionId,
  RuntimeCommandStatePort,
  type RuntimeCommandRecord,
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
  type RuntimeRequestInputDetailsRecord,
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
import {
  Extensions,
  type CommandInvocationContext,
  type ExtensionsService,
} from "@svvy/extensions";
import type { Runtime } from "./index";
import {
  applyExtensionRuntimeOperations,
  applyRuntimeEffectRequests,
  RuntimeHandlerThreadStartPreparationHost,
  RuntimeExecutionPlanExecutor,
  RuntimeQueueInsertPostCommitLane,
  type StartedHandlerThreadsResult,
} from "./runtime-effect-requests";
import { runAcceptedRequestUserInputToolCall } from "./request-user-input-operation";
import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeRequestInputWaitService } from "./runtime-request-input-wait-service";

type RuntimeSourceInvalidationService = Runtime["Service"]["sourceInvalidation"];

function effectTest<A, E>(effect: Effect.Effect<A, E, unknown>): Effect.Effect<A, E, never> {
  return effect as Effect.Effect<A, E, never>;
}

const target = {
  workspaceSessionId: "wsess_runtime_effects_01" as WorkspaceSessionId,
  surface: "orchestrator",
  surfacePiSessionId: "pi_runtime_effects_01" as SurfacePiSessionId,
} satisfies PromptTarget;

const turnId = "turn_runtime_effects_01" as TurnId;
const toolItemId = "tool_item_runtime_effects_01" as ToolItemId;
const commandId = "command_runtime_effects_01" as CommandId;
const BLOCKING_TIMEOUT_MS = 300_000 as PositiveDurationMs;
const episodeId = "episode_runtime_effects_01" as EpisodeId;
const requestId = "request_input_runtime_effects_01" as RequestInputRequestId;
const questionId = "question_runtime_effects_01" as RequestInputQuestionId;
const threadId = "thread_runtime_effects_01" as ThreadId;
const threadGroupId = "thread_group_runtime_effects_01" as ThreadGroupId;
const queuedMessageId = "queue_runtime_effects_01" as QueueItemId;
const promptExecutionContext = {
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
const commandContext = {
  commandId,
  target,
  turnId,
  approvalMode: "auto-review",
  sandbox: { snapshot: {} },
  cwd: "/tmp/svvy-runtime-effects",
  baseEnv: {},
} satisfies CommandInvocationContext;

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

function requestUserInputCommandRecord(
  input: { readonly status?: RuntimeCommandRecord["status"] } = {},
): RuntimeCommandRecord {
  return {
    id: commandId,
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
    status: input.status ?? "running",
    attempts: 1,
    title: "Request user input",
    summary: "Request user input",
    arguments: null,
    facts: null,
    error: null,
    startedAt: "2026-04-18T09:00:00.000Z",
    updatedAt: "2026-04-18T09:00:00.000Z",
    finishedAt: null,
  };
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
    snapshots: {
      captureSourcePayload: () => Effect.die("Unexpected snapshot source capture."),
      prepareSourceRestore: () => Effect.die("Unexpected snapshot source restore preparation."),
      applySourceRestore: () => Effect.die("Unexpected snapshot source restore application."),
      finalizeSourceRestore: () => Effect.die("Unexpected snapshot source restore finalization."),
    },
    builds: {
      build: () => Effect.die("Unexpected extension build."),
      observeCurrent: () => Effect.die("Unexpected extension build observation."),
    },
    dependencies: {
      refreshReadiness: () => Effect.die("Unexpected extension dependency readiness refresh."),
    },
    registry: {
      list: () => Effect.succeed([]),
      observe: () =>
        Effect.succeed({ aggregateFingerprint: "test", observations: [], diagnostics: [] }),
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
    externalInstructions: {
      scan: () => Effect.die("Unexpected external instruction scan."),
      resolveSource: () => Effect.die("Unexpected external instruction resolve."),
      saveSource: () => Effect.die("Unexpected external instruction save."),
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
      declarations: () => Effect.succeed([]),
      metadata: () => Effect.succeed([]),
      handler: () => Effect.die("Unexpected native tool handler lookup."),
    },
    executeTypescriptFacadeDeclarations: {
      build: () => Effect.die("Unexpected execute_typescript facade declaration build."),
    },
    generatedPackages: {
      refresh: () => Effect.die("Unexpected generated package refresh."),
      planWorkspaceLink: () => Effect.die("Unexpected generated package workspace link plan."),
    },
    sources: {
      recoverMutations: () => Effect.die("Unexpected lifecycle recovery."),
      finalizeLifecycleMutation: () => Effect.die("Unexpected lifecycle finalization."),
      createExtension: () => Effect.die("Unexpected extension create."),
      duplicateExtension: () => Effect.die("Unexpected extension duplicate."),
      deleteExtension: () => Effect.die("Unexpected extension delete."),
      resetExtensionInstructions: () => Effect.die("Unexpected extension reset."),
      addInstruction: () => Effect.die("Unexpected instruction add."),
      removeInstruction: () => Effect.die("Unexpected instruction remove."),
      configureInstruction: () => Effect.die("Unexpected instruction configure."),
      renameInstruction: () => Effect.die("Unexpected instruction rename."),
      reorderInstructions: () => Effect.die("Unexpected instruction reorder."),
      revertMutation: () => Effect.die("Unexpected lifecycle revert."),
      configureTypescriptApi: () => Effect.die("Unexpected extension source mutation."),
      openEditSession: () => Effect.die("Unexpected source edit open."),
      saveEditSession: () => Effect.die("Unexpected source edit save."),
      createWorkflowAgent: () => Effect.die("Unexpected workflow-agent create."),
      duplicateWorkflowAgent: () => Effect.die("Unexpected workflow-agent duplicate."),
      deleteWorkflowAgent: () => Effect.die("Unexpected workflow-agent delete."),
      scanWorkflowAgents: () => Effect.die("Unexpected workflow-agent scan."),
      scaffoldMissingWorkflowAgents: () => Effect.die("Unexpected workflow-agent scaffold."),
    },
  } satisfies ExtensionsService);
}

describe("runtime effect request application", () => {
  it.effect("applies request_input.create through RuntimeRequestStatePort", () =>
    effectTest(
      Effect.gen(function* () {
        const createCalls: CreateRuntimeRequestInputInput[] = [];
        const calls: string[] = [];
        const requestStatePort = {
          ...unexpectedRequestStateMethods(),
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

        const applied = yield* applyRuntimeEffectRequests(
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
        );

        assert.deepStrictEqual(createCalls, [
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
        assert.deepStrictEqual(calls, ["publish:1"]);
        assert.deepStrictEqual(applied, [
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
      }),
    ),
  );

  it.effect("applies ordered runtime_effect operation items", () =>
    effectTest(
      Effect.gen(function* () {
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
            questions: [
              {
                title: "Scope",
                question: "What should happen next?",
                defaultAnswer: "Keep the operation item path.",
              },
            ],
          },
        } satisfies RuntimeEffectRequest;

        const applied = yield* applyExtensionRuntimeOperations({ target, turnId, toolItemId }, [
          { kind: "runtime_effect", request },
        ]).pipe(
          Effect.provideService(RuntimeRequestStatePort, requestStatePort),
          Effect.provideService(RuntimeEventBus, eventBus(calls)),
        );

        assert.strictEqual(createCalls.length, 1);
        assert.deepStrictEqual(calls, ["publish:1"]);
        assert.deepStrictEqual(applied, [
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
      }),
    ),
  );

  it.effect(
    "maps request_input.create publication failures after state commit to runtime contract failures",
    () =>
      effectTest(
        Effect.gen(function* () {
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

          const error = yield* applyRuntimeEffectRequests(
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
          )
            .pipe(
              Effect.provideService(RuntimeRequestStatePort, requestStatePort),
              Effect.provideService(RuntimeEventBus, eventBus(calls, { publishFails: true })),
            )
            .pipe(Effect.flip);
          assertRuntimeEffectError(error, {
            _tag: "RuntimeContractError",
            operation: "runtime.effects.apply",
            reason: "stale-state",
            message: "Runtime event bus did not accept request_input.create notifications.",
          });
          assert.deepStrictEqual(calls, [`state:${commandId}`, "publish:1"]);
        }),
      ),
  );

  it.effect(
    "executes execution_plan operation items through the runtime-owned executor in order",
    () =>
      effectTest(
        Effect.gen(function* () {
          const createCalls: CreateRuntimeRequestInputInput[] = [];
          const executionCalls: unknown[] = [];
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
          const executionPlan = {
            type: "file_effect.apply_patch",
            planId: "plan_runtime_effects_01" as ExtensionExecutionPlanId,
            cwd: "/tmp/svvy-runtime-effects" as AbsolutePath,
            patch: "*** Begin Patch\n*** Add File: noop.txt\n+noop\n*** End Patch\n",
          } as const;
          const request = {
            type: "request_input.create",
            input: {
              target,
              sourceCommandId: commandId,
              questions: [
                {
                  title: "Scope",
                  question: "What should happen next?",
                  defaultAnswer: "Keep ordered execution.",
                },
              ],
            },
          } satisfies RuntimeEffectRequest;

          const applied = yield* applyExtensionRuntimeOperations(
            {
              target,
              turnId,
              toolItemId,
              commandId,
              commandContext,
              promptExecutionContext,
            },
            [
              { kind: "runtime_effect", request },
              { kind: "execution_plan", plan: executionPlan },
              { kind: "runtime_effect", request },
            ],
          ).pipe(
            Effect.provideService(RuntimeRequestStatePort, requestStatePort),
            Effect.provideService(RuntimeEventBus, eventBus(calls)),
            Effect.provideService(
              RuntimeExecutionPlanExecutor,
              RuntimeExecutionPlanExecutor.of({
                execute: (input) =>
                  Effect.sync(() => {
                    executionCalls.push(input);
                    calls.push(`execute:${input.plan.planId}`);
                    return { commandId: input.commandId };
                  }),
              }),
            ),
          );

          assert.strictEqual(createCalls.length, 2);
          assert.deepStrictEqual(calls, [
            "publish:1",
            "execute:plan_runtime_effects_01",
            "publish:1",
          ]);
          assert.deepStrictEqual(executionCalls, [
            {
              commandId,
              target,
              plan: executionPlan,
              invocationContext: commandContext,
              promptExecutionContext,
            },
          ]);
          assert.deepStrictEqual(
            applied.map((item) => item.type),
            ["request_input.create", "execution_plan", "request_input.create"],
          );
          assert.deepStrictEqual(applied[1], {
            type: "execution_plan",
            plan: executionPlan,
            receipt: { commandId },
          });
        }),
      ),
  );

  it.effect("rejects execution_plan operation items without the owning command context", () =>
    effectTest(
      Effect.gen(function* () {
        const error2 = yield* applyExtensionRuntimeOperations({ target, turnId, toolItemId }, [
          {
            kind: "execution_plan",
            plan: {
              type: "file_effect.apply_patch",
              planId: "plan_runtime_effects_01" as ExtensionExecutionPlanId,
              cwd: "/tmp/svvy-runtime-effects" as AbsolutePath,
              patch: "*** Begin Patch\n*** Add File: noop.txt\n+noop\n*** End Patch\n",
            },
          },
        ]).pipe(Effect.flip);
        assertRuntimeEffectError(error2, {
          _tag: "RuntimeContractError",
          reason: "unsupported-operation",
          message:
            "Extension execution plans require the owning command context, prompt execution context, and command id.",
        });
      }),
    ),
  );

  it.effect("decodes runtime_effect operation requests before state ports are called", () =>
    effectTest(
      Effect.gen(function* () {
        let enqueueCalled = false;
        const queueStatePort = {
          enqueueSurfaceMessage: () =>
            Effect.sync(() => {
              enqueueCalled = true;
              return stateMutation(queuedRecordFromInput({} as never), []);
            }),
        } as unknown as RuntimeQueueStatePortService;

        const error3 = yield* applyExtensionRuntimeOperations({ target, turnId, toolItemId }, [
          {
            kind: "runtime_effect",
            request: {
              type: "queue.insert",
              input: {
                target: handlerTarget,
                kind: "thread_followup",
                idempotencyKey: "thread_followup:runtime_effects:invalid_boundary",
                payload: {
                  kind: "thread_followup",
                  threadIds: [threadId],
                  message: "Please rerun the focused verification.",
                  sender: "orchestrator",
                  activate: true,
                },
                previewOnly: "must not cross the runtime-effect boundary",
              },
            },
          },
        ] as readonly unknown[])
          .pipe(Effect.provideService(RuntimeQueueStatePort, queueStatePort))
          .pipe(Effect.flip);
        assertRuntimeEffectError(error3, {
          _tag: "RuntimeContractError",
          operation: "runtime.effects.applyOperations",
          reason: "invalid-input",
        });
        assert.strictEqual(enqueueCalled, false);
      }),
    ),
  );

  it.effect("decodes execution_plan operation plans before executors are called", () =>
    effectTest(
      Effect.gen(function* () {
        let executeCalled = false;
        const error4 = yield* applyExtensionRuntimeOperations(
          { target, turnId, toolItemId, commandId, commandContext, promptExecutionContext },
          [
            {
              kind: "execution_plan",
              plan: {
                type: "child_process.unknown",
                planId: "plan_runtime_effects_invalid" as ExtensionExecutionPlanId,
                commandFamily: "shell",
                command: { argv: ["echo", "hello"] },
                cwd: "/tmp/svvy-runtime-effects" as AbsolutePath,
                env: {
                  extensionId: "ext_core" as ExtensionId,
                  nonSecretValues: {},
                  secretKeyNames: [],
                  redactedLabels: {},
                  secretRevisionFingerprint: "secret_revision_runtime_effects",
                },
                stdin: "none",
              },
            },
          ] as readonly unknown[],
        )
          .pipe(
            Effect.provideService(
              RuntimeExecutionPlanExecutor,
              RuntimeExecutionPlanExecutor.of({
                execute: () =>
                  Effect.sync(() => {
                    executeCalled = true;
                    return { commandId };
                  }),
              }),
            ),
          )
          .pipe(Effect.flip);
        assertRuntimeEffectError(error4, {
          _tag: "RuntimeContractError",
          operation: "runtime.effects.applyOperations",
          reason: "invalid-input",
        });
        assert.strictEqual(executeCalled, false);
      }),
    ),
  );

  it.effect("rejects unknown extension operation kinds before applying side effects", () =>
    effectTest(
      Effect.gen(function* () {
        const error5 = yield* applyExtensionRuntimeOperations({ target, turnId, toolItemId }, [
          {
            kind: "unknown_operation",
            request: {
              type: "queue.insert",
              input: {
                target: handlerTarget,
                kind: "thread_followup",
                idempotencyKey: "thread_followup:runtime_effects:unknown_operation",
                payload: {
                  kind: "thread_followup",
                  threadIds: [threadId],
                  message: "Please rerun the focused verification.",
                  sender: "orchestrator",
                  activate: true,
                },
              },
            },
          },
        ] as readonly unknown[]).pipe(Effect.flip);
        assertRuntimeEffectError(error5, {
          _tag: "RuntimeContractError",
          operation: "runtime.effects.applyOperations",
          reason: "invalid-input",
          message: "Extension runtime operation has no application case: unknown_operation.",
        });
      }),
    ),
  );

  it.effect("rejects effect requests targeting another active prompt", () =>
    effectTest(
      Effect.gen(function* () {
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

        const error6 = yield* applyRuntimeEffectRequests(
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
        )
          .pipe(Effect.provideService(RuntimeRequestStatePort, requestStatePort))
          .pipe(Effect.flip);
        assertRuntimeEffectError(error6, {
          _tag: "RuntimeContractError",
          reason: "invalid-input",
          message: "Runtime effect request target does not match the active command target.",
        });
      }),
    ),
  );

  it.effect("applies queue.insert through RuntimeQueueStatePort", () =>
    effectTest(
      Effect.gen(function* () {
        const calls: string[] = [];
        const enqueueCalls: EnqueueRuntimeSurfaceMessageInput[] = [];
        const queueStatePort = {
          acceptSubmittedSurfaceMessage: () =>
            Effect.die("Unexpected acceptSubmittedSurfaceMessage call."),
          acceptEditedCommittedSurfaceMessage: () => Effect.die("Unexpected committed edit."),
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
          reorderSurfaceMessage: () => Effect.die("Unexpected queue reorder."),
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

        const applied = yield* applyRuntimeEffectRequests({ target, turnId, toolItemId }, [
          request,
        ]).pipe(
          Effect.provideService(RuntimeQueueStatePort, queueStatePort),
          Effect.provideService(RuntimeEventBus, eventBus(calls)),
          Effect.provideService(RuntimeQueueInsertPostCommitLane, queueInsertPostCommitLane(calls)),
        );

        const expectedPayload = JSON.stringify(request.input.payload);
        assert.deepStrictEqual(enqueueCalls, [
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
        assert.deepStrictEqual(applied, [
          {
            type: "queue.insert",
            queuedMessage: queuedRecordFromInput(enqueueCalls[0]!),
          },
        ]);
        assert.deepStrictEqual(calls, [
          `state:${handlerTarget.surfacePiSessionId}`,
          "publish:1",
          `postCommit:${queuedMessageId}:${handlerTarget.surfacePiSessionId}`,
        ]);
      }),
    ),
  );

  it.effect(
    "maps queue.insert publication failures after state commit to runtime contract failures",
    () =>
      effectTest(
        Effect.gen(function* () {
          const calls: string[] = [];
          const queueStatePort = {
            acceptSubmittedSurfaceMessage: () =>
              Effect.die("Unexpected acceptSubmittedSurfaceMessage call."),
            acceptEditedCommittedSurfaceMessage: () => Effect.die("Unexpected committed edit."),
            enqueueSurfaceMessage: (input) => {
              calls.push(`state:${input.surfacePiSessionId}`);
              return Effect.succeed(
                stateMutation(queuedRecordFromInput(input), [queueInvalidation]),
              );
            },
            getSurfaceQueuedMessage: () => Effect.die("Unexpected queue get."),
            claimNextQueuedSurfaceMessage: () => Effect.die("Unexpected queue claim."),
            releaseExpiredSurfaceMessageClaims: () => Effect.die("Unexpected claim release."),
            markSurfaceMessageSteering: () => Effect.die("Unexpected queue steer."),
            markSurfaceMessageQueued: () => Effect.die("Unexpected queue requeue."),
            markSurfaceMessageDelivered: () => Effect.die("Unexpected queue delivered."),
            markSurfaceMessageFailed: () => Effect.die("Unexpected queue failure."),
            cancelSurfaceMessage: () => Effect.die("Unexpected queue cancellation."),
            reorderSurfaceMessage: () => Effect.die("Unexpected queue reorder."),
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

          const error7 = yield* applyRuntimeEffectRequests({ target, turnId, toolItemId }, [
            request,
          ])
            .pipe(
              Effect.provideService(RuntimeQueueStatePort, queueStatePort),
              Effect.provideService(RuntimeEventBus, eventBus(calls, { publishFails: true })),
              Effect.provideService(
                RuntimeQueueInsertPostCommitLane,
                queueInsertPostCommitLane(calls),
              ),
            )
            .pipe(Effect.flip);
          assertRuntimeEffectError(error7, {
            _tag: "RuntimeContractError",
            operation: "runtime.effects.apply",
            reason: "stale-state",
          });
          assert.deepStrictEqual(calls, [`state:${handlerTarget.surfacePiSessionId}`, "publish:1"]);
        }),
      ),
  );

  it.effect(
    "maps queue.insert post-commit lane failures after publication to runtime contract failures",
    () =>
      effectTest(
        Effect.gen(function* () {
          const calls: string[] = [];
          const queueStatePort = {
            acceptSubmittedSurfaceMessage: () =>
              Effect.die("Unexpected acceptSubmittedSurfaceMessage call."),
            acceptEditedCommittedSurfaceMessage: () => Effect.die("Unexpected committed edit."),
            enqueueSurfaceMessage: (input) => {
              calls.push(`state:${input.surfacePiSessionId}`);
              return Effect.succeed(
                stateMutation(queuedRecordFromInput(input), [queueInvalidation]),
              );
            },
            getSurfaceQueuedMessage: () => Effect.die("Unexpected queue get."),
            claimNextQueuedSurfaceMessage: () => Effect.die("Unexpected queue claim."),
            releaseExpiredSurfaceMessageClaims: () => Effect.die("Unexpected claim release."),
            markSurfaceMessageSteering: () => Effect.die("Unexpected queue steer."),
            markSurfaceMessageQueued: () => Effect.die("Unexpected queue requeue."),
            markSurfaceMessageDelivered: () => Effect.die("Unexpected queue delivered."),
            markSurfaceMessageFailed: () => Effect.die("Unexpected queue failure."),
            cancelSurfaceMessage: () => Effect.die("Unexpected queue cancellation."),
            reorderSurfaceMessage: () => Effect.die("Unexpected queue reorder."),
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

          const error8 = yield* applyRuntimeEffectRequests({ target, turnId, toolItemId }, [
            request,
          ])
            .pipe(
              Effect.provideService(RuntimeQueueStatePort, queueStatePort),
              Effect.provideService(RuntimeEventBus, eventBus(calls)),
              Effect.provideService(
                RuntimeQueueInsertPostCommitLane,
                queueInsertPostCommitLane(calls, { postCommitFails: true }),
              ),
            )
            .pipe(Effect.flip);
          assertRuntimeEffectError(error8, {
            _tag: "RuntimeContractError",
            operation: "runtime.effects.apply",
            reason: "stale-state",
          });
          assert.deepStrictEqual(calls, [
            `state:${handlerTarget.surfacePiSessionId}`,
            "publish:1",
            `postCommit:${queuedMessageId}:${handlerTarget.surfacePiSessionId}`,
          ]);
        }),
      ),
  );

  it.effect(
    "applies episode.record through RuntimeEpisodeStatePort for the active handler thread",
    () =>
      effectTest(
        Effect.gen(function* () {
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

          const applied = yield* applyRuntimeEffectRequests(
            {
              target: handlerTarget,
              turnId,
              toolItemId,
            },
            [request],
          ).pipe(
            Effect.provideService(RuntimeEpisodeStatePort, episodeStatePort),
            Effect.provideService(RuntimeEventBus, eventBus(calls)),
          );

          assert.deepStrictEqual(recordCalls, [request]);
          assert.deepStrictEqual(calls, ["publish:1"]);
          assert.deepStrictEqual(applied, [
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
        }),
      ),
  );

  it.effect(
    "maps episode.record publication failures after state commit to runtime contract failures",
    () =>
      effectTest(
        Effect.gen(function* () {
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

          const error9 = yield* applyRuntimeEffectRequests(
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
          )
            .pipe(
              Effect.provideService(RuntimeEpisodeStatePort, episodeStatePort),
              Effect.provideService(RuntimeEventBus, eventBus(calls, { publishFails: true })),
            )
            .pipe(Effect.flip);
          assertRuntimeEffectError(error9, {
            _tag: "RuntimeContractError",
            operation: "runtime.effects.apply",
            reason: "stale-state",
            message: "Runtime event bus did not accept episode.record notifications.",
          });
          assert.deepStrictEqual(calls, [`state:${threadId}`, "publish:1"]);
        }),
      ),
  );

  it.effect("rejects episode.record when the active handler thread does not own the request", () =>
    effectTest(
      Effect.gen(function* () {
        const episodeStatePort = {
          recordHandlerThreadEpisode: () => Effect.die("Unexpected episode recording."),
        } satisfies RuntimeEpisodeStatePortService;

        const error10 = yield* applyRuntimeEffectRequests(
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
        )
          .pipe(Effect.provideService(RuntimeEpisodeStatePort, episodeStatePort))
          .pipe(Effect.flip);
        assertRuntimeEffectError(error10, {
          _tag: "RuntimeContractError",
          reason: "invalid-input",
          message: "Episode record request target does not match the active handler thread.",
        });
      }),
    ),
  );

  it.effect(
    "applies actor_extension_binding.update through state and schedules target context refresh",
    () =>
      effectTest(
        Effect.gen(function* () {
          const updateCalls: RuntimeEffectRequest[] = [];
          const refreshCalls: RuntimeEffectRequest[] = [];
          const calls: string[] = [];
          const bindingStatePort = {
            readRuntimePromptBinding: () => Effect.die("Unexpected runtime prompt binding read."),
            readGeneratedContextBuildSubject: () => Effect.die("Unexpected context subject read."),
            bindGeneratedContext: () => Effect.die("Unexpected context binding write."),
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

          const applied = yield* applyRuntimeEffectRequests(
            { target, turnId, toolItemId, sourceInvalidation },
            [request],
          ).pipe(
            Effect.provideService(RuntimeActorExtensionBindingStatePort, bindingStatePort),
            Effect.provideService(Extensions, extensionsServiceWithReadiness()),
            Effect.provideService(RuntimeEventBus, eventBus(calls)),
          );

          assert.deepStrictEqual(updateCalls, [request]);
          assert.deepStrictEqual(calls, ["state:smithers", "publish:1", "refresh:load-extension"]);
          assert.deepStrictEqual(refreshCalls, [
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
          assert.deepStrictEqual(applied, [
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
        }),
      ),
  );

  it.effect(
    "maps actor_extension_binding.update publication failures before generated-context refresh",
    () =>
      effectTest(
        Effect.gen(function* () {
          const calls: string[] = [];
          const bindingStatePort = {
            readRuntimePromptBinding: () => Effect.die("Unexpected runtime prompt binding read."),
            readGeneratedContextBuildSubject: () => Effect.die("Unexpected context subject read."),
            bindGeneratedContext: () => Effect.die("Unexpected context binding write."),
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

          const error11 = yield* applyRuntimeEffectRequests(
            { target, turnId, toolItemId, sourceInvalidation },
            [
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
            ],
          )
            .pipe(
              Effect.provideService(RuntimeActorExtensionBindingStatePort, bindingStatePort),
              Effect.provideService(Extensions, extensionsServiceWithReadiness()),
              Effect.provideService(RuntimeEventBus, eventBus(calls, { publishFails: true })),
            )
            .pipe(Effect.flip);
          assertRuntimeEffectError(error11, {
            _tag: "RuntimeContractError",
            operation: "runtime.effects.apply",
            reason: "stale-state",
            message:
              "Runtime event bus did not accept actor_extension_binding.update notifications.",
          });
          assert.deepStrictEqual(calls, ["state:smithers", "publish:1"]);
        }),
      ),
  );

  it.effect(
    "rejects actor_extension_binding.update when the active target does not own the request",
    () =>
      effectTest(
        Effect.gen(function* () {
          const bindingStatePort = {
            readRuntimePromptBinding: () => Effect.die("Unexpected runtime prompt binding read."),
            readGeneratedContextBuildSubject: () => Effect.die("Unexpected context subject read."),
            bindGeneratedContext: () => Effect.die("Unexpected context binding write."),
            updateActorExtensionBinding: () => Effect.die("Unexpected actor binding update."),
            setActorExtensionBinding: () => Effect.die("Unexpected actor binding set."),
          } satisfies RuntimeActorExtensionBindingStatePortService;

          const error12 = yield* applyRuntimeEffectRequests(
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
          )
            .pipe(Effect.provideService(RuntimeActorExtensionBindingStatePort, bindingStatePort))
            .pipe(Effect.flip);
          assertRuntimeEffectError(error12, {
            _tag: "RuntimeContractError",
            reason: "invalid-input",
            message:
              "Actor extension binding request target does not match the active command target.",
          });
        }),
      ),
  );

  it.effect(
    "rejects actor_extension_binding.update before mutation when generated-context refresh is unavailable",
    () =>
      effectTest(
        Effect.gen(function* () {
          const bindingStatePort = {
            readRuntimePromptBinding: () => Effect.die("Unexpected runtime prompt binding read."),
            readGeneratedContextBuildSubject: () => Effect.die("Unexpected context subject read."),
            bindGeneratedContext: () => Effect.die("Unexpected context binding write."),
            updateActorExtensionBinding: () => Effect.die("Unexpected actor binding update."),
            setActorExtensionBinding: () => Effect.die("Unexpected actor binding set."),
          } satisfies RuntimeActorExtensionBindingStatePortService;

          const error13 = yield* applyRuntimeEffectRequests({ target, turnId, toolItemId }, [
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
          ])
            .pipe(
              Effect.provideService(RuntimeActorExtensionBindingStatePort, bindingStatePort),
              Effect.provideService(Extensions, extensionsServiceWithReadiness()),
            )
            .pipe(Effect.flip);
          assertRuntimeEffectError(error13, {
            _tag: "RuntimeContractError",
            reason: "unsupported-operation",
            message:
              "Actor extension binding runtime effects require a source invalidation service in the application context.",
          });
        }),
      ),
  );

  it.effect("rejects actor_extension_binding.update for extensions that are not ready", () =>
    effectTest(
      Effect.gen(function* () {
        const bindingStatePort = {
          readRuntimePromptBinding: () => Effect.die("Unexpected runtime prompt binding read."),
          readGeneratedContextBuildSubject: () => Effect.die("Unexpected context subject read."),
          bindGeneratedContext: () => Effect.die("Unexpected context binding write."),
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

        const error14 = yield* applyRuntimeEffectRequests(
          { target, turnId, toolItemId, sourceInvalidation },
          [
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
          ],
        )
          .pipe(
            Effect.provideService(RuntimeActorExtensionBindingStatePort, bindingStatePort),
            Effect.provideService(
              Extensions,
              extensionsServiceWithReadiness({
                envReadiness: "missing",
                dependencyReadiness: "ready",
              }),
            ),
          )
          .pipe(Effect.flip);
        assertRuntimeEffectError(error14, {
          _tag: "RuntimeContractError",
          reason: "invalid-input",
          message: "Extension is not ready to load for this actor: smithers.",
        });
      }),
    ),
  );

  it.effect("applies generated_packages.refresh through RuntimeSourceInvalidationService", () =>
    effectTest(
      Effect.gen(function* () {
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

        const applied = yield* applyRuntimeEffectRequests(
          { target, turnId, toolItemId, sourceInvalidation },
          [request],
        );

        assert.deepStrictEqual(refreshCalls, [request]);
        assert.deepStrictEqual(applied, [
          { type: "generated_packages.refresh", result: refreshResult },
        ]);
      }),
    ),
  );

  it.effect(
    "rejects generated_packages.refresh when no source invalidation service is supplied",
    () =>
      effectTest(
        Effect.gen(function* () {
          const error15 = yield* applyRuntimeEffectRequests({ target, turnId, toolItemId }, [
            {
              type: "generated_packages.refresh",
              input: {
                scope: "app-global",
                packages: ["@svvyx/extensions"],
                reason: "source-changed",
                sourceCommandId: commandId,
              },
            },
          ]).pipe(Effect.flip);
          assertRuntimeEffectError(error15, {
            _tag: "RuntimeContractError",
            reason: "unsupported-operation",
            message:
              "Generated package refresh runtime effects require a source invalidation service in the application context.",
          });
        }),
      ),
  );

  it.effect("applies generated_context.refresh through RuntimeSourceInvalidationService", () =>
    effectTest(
      Effect.gen(function* () {
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

        const applied = yield* applyRuntimeEffectRequests(
          { target, turnId, toolItemId, sourceInvalidation },
          [request],
        );

        assert.deepStrictEqual(refreshCalls, [request]);
        assert.deepStrictEqual(applied, [
          { type: "generated_context.refresh", input: request.input },
        ]);
      }),
    ),
  );

  it.effect(
    "rejects generated_context.refresh when no source invalidation service is supplied",
    () =>
      effectTest(
        Effect.gen(function* () {
          const error16 = yield* applyRuntimeEffectRequests({ target, turnId, toolItemId }, [
            {
              type: "generated_context.refresh",
              input: {
                scope: "workspace",
                workspaceId: "workspace_runtime_effects_01" as WorkspaceId,
                reason: "extension-source-changed",
                sourceCommandId: commandId,
              },
            },
          ]).pipe(Effect.flip);
          assertRuntimeEffectError(error16, {
            _tag: "RuntimeContractError",
            reason: "unsupported-operation",
            message:
              "Generated context refresh runtime effects require a source invalidation service in the application context.",
          });
        }),
      ),
  );

  it.effect("applies handler_thread.start through runtime state, publication, and wakeup", () =>
    effectTest(
      Effect.gen(function* () {
        const calls: string[] = [];
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
              agentProfileJson: null,
              generatedAgentContextBinding: {
                generatedAgentContextFingerprint: "handler-thread-fingerprint",
                generatedAgentContextRevision: 1,
                externalSourceHashes: [],
              },
              initialQueue: {
                idempotencyKey: `initial_handler_start:${threadId}`,
                priority: "runtime",
                orderingKey: `surface:${handlerTarget.surfacePiSessionId}`,
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
              workspaceSessionId: target.workspaceSessionId,
              surfacePiSessionId: handlerTarget.surfacePiSessionId,
              parentThreadId: null,
              title: "Inspect the runtime-effect contract.",
              objective: "Inspect the runtime-effect contract.",
              historyMode: "forked",
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

        const applied = yield* applyRuntimeEffectRequests(
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
                  assert.deepStrictEqual(input, {
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
                assert.deepStrictEqual(input, preparedInput);
                return stateMutation(startResult, [queueInvalidation]);
              }),
          } satisfies RuntimeThreadStatePortService),
          Effect.provideService(RuntimeEventBus, eventBus(calls)),
          Effect.provideService(RuntimeQueueInsertPostCommitLane, queueInsertPostCommitLane(calls)),
        );

        assert.deepStrictEqual(calls, [
          `prepare:${commandId}`,
          `state:${commandId}`,
          "publish:1",
          `postCommit:${queuedMessageId}:${handlerTarget.surfacePiSessionId}`,
        ]);
        assert.deepStrictEqual(applied, [
          {
            type: "handler_thread.start",
            result: {
              threadGroupId,
              threads: [
                {
                  threadId,
                  threadGroupId,
                  surfacePiSessionId: handlerTarget.surfacePiSessionId,
                  parentThreadId: null,
                  objective: "Inspect the runtime-effect contract.",
                  objectiveState: "active",
                  queuedMessageId,
                },
              ],
            } satisfies StartedHandlerThreadsResult,
          },
        ]);
      }),
    ),
  );

  it.effect("fails closed when handler_thread.start effects lack a preparation host", () =>
    effectTest(
      Effect.gen(function* () {
        const error17 = yield* applyRuntimeEffectRequests(
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
        ).pipe(Effect.flip);
        assertRuntimeEffectError(error17, {
          _tag: "RuntimeContractError",
          reason: "unsupported-operation",
          message:
            "Handler thread start runtime effects require a handler thread preparation host.",
        });
      }),
    ),
  );

  it.effect("rejects handler_thread.start from non-orchestrator targets", () =>
    effectTest(
      Effect.gen(function* () {
        const error18 = yield* applyRuntimeEffectRequests(
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
        ).pipe(Effect.flip);
        assertRuntimeEffectError(error18, {
          _tag: "RuntimeContractError",
          reason: "invalid-input",
          message: "Handler thread start requests must originate from an orchestrator surface.",
        });
      }),
    ),
  );

  it.effect(
    "runs accepted request_user_input calls through the handler and applies runtime effects",
    () =>
      effectTest(
        Effect.gen(function* () {
          const createCalls: CreateRuntimeRequestInputInput[] = [];
          const progressCalls: Parameters<
            RuntimeCommandStatePortService["recordCommandEvent"]
          >[0][] = [];
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

          const executed = yield* runAcceptedRequestUserInputToolCall({
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
            commandRecord: requestUserInputCommandRecord(),
          }).pipe(
            Effect.provideService(RuntimeRequestStatePort, requestStatePort),
            Effect.provideService(RuntimeCommandStatePort, commandStatePort),
            Effect.provideService(RuntimeEventBus, eventBus(calls)),
            Effect.provideService(
              RuntimeRequestInputWaitService,
              RuntimeRequestInputWaitService.of({
                waitForBlockingRequest: () => Effect.die("Unexpected blocking request input wait."),
                afterAnswerCommitted: () => Effect.die("Unexpected request input answer commit."),
                afterTimerPausedCommitted: () =>
                  Effect.die("Unexpected request input timer commit."),
                restoreOpenBlockingRequests: () =>
                  Effect.die("Unexpected request input startup restore."),
                cancelBlockingRequestsForSurface: () =>
                  Effect.die("Unexpected request input surface cancellation."),
              }),
            ),
          );

          assert.deepStrictEqual(createCalls, [
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
          assert.deepStrictEqual(calls, ["publish:1"]);
          assert.deepStrictEqual(executed.toolResult, {
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
          assert.deepStrictEqual(progressCalls, [
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
          assert.deepStrictEqual(finishCalls, [
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
        }),
      ),
  );

  it.effect(
    "runs blocking accepted request_user_input calls through the runtime wait service",
    () =>
      effectTest(
        Effect.gen(function* () {
          const createCalls: CreateRuntimeRequestInputInput[] = [];
          const progressCalls: Parameters<
            RuntimeCommandStatePortService["recordCommandEvent"]
          >[0][] = [];
          const finishCalls: Parameters<RuntimeCommandStatePortService["finishCommand"]>[0][] = [];
          const waitCalls: {
            readonly request: RuntimeRequestInputDetailsRecord;
            readonly command: RuntimeCommandRecord;
          }[] = [];
          const calls: string[] = [];
          let createdDetails: RuntimeRequestInputDetailsRecord | null = null;
          const requestStatePort = {
            readRequestInputSettings: () =>
              Effect.succeed({
                mode: "blocking" as const,
                blockingTimeout: { enabled: true, durationMs: BLOCKING_TIMEOUT_MS },
              }),
            setRequestInputVariant: () => Effect.die("Unexpected request input variant mutation."),
            setRequestInputBlockingTimeout: () =>
              Effect.die("Unexpected request input timeout mutation."),
            createRequestInput: (input) => {
              createCalls.push(input);
              createdDetails = {
                requestId,
                sessionId: input.target.workspaceSessionId,
                surfacePiSessionId: input.target.surfacePiSessionId,
                threadId: input.target.surface === "handler" ? input.target.threadId : null,
                turnId: input.turnId,
                commandId: input.sourceCommandId,
                variant: input.mode,
                status: "open",
                questionCount: input.questions.length,
                toolItemId: input.toolItemId,
                createdAt: "2026-04-18T09:00:00.000Z",
                completedAt: null,
                timeout: input.timeout
                  ? {
                      timerVersion: 1,
                      enabled: input.timeout.enabled,
                      durationMs: input.timeout.durationMs,
                      startedAt: "2026-04-18T09:00:00.000Z",
                      pausedAt: null,
                      remainingMsWhenPaused: null,
                      expiresAt: "2026-04-18T09:05:00.000Z",
                    }
                  : null,
                questions: [
                  {
                    questionId,
                    requestId,
                    ordinal: 0,
                    title: "Scope",
                    question: "What should the next slice cover?",
                    defaultAnswer: {
                      kind: "custom",
                      text: "Move blocking request_user_input waiting into runtime.",
                    },
                    choices: [],
                    status: "open",
                  },
                ],
                answers: [],
              };
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
            getRequestInput: () =>
              createdDetails
                ? Effect.succeed(createdDetails)
                : Effect.die("Expected request details to exist."),
            listOpenBlockingRequestInputs: () =>
              Effect.die("Unexpected open blocking request input listing."),
            defaultOpenRequestInputQuestions: () =>
              Effect.die("Unexpected request input defaulting."),
            answerRequestInput: () => Effect.die("Unexpected request input answer."),
            setRequestInputTimerPaused: () => Effect.die("Unexpected request input timer pause."),
            cancelRequestInput: () => Effect.die("Unexpected request input cancellation."),
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
                stateMutation(requestUserInputCommandRecord({ status: input.status })),
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
          const commandRecord = requestUserInputCommandRecord();
          const waitedResult = {
            answers: [
              {
                title: "Scope",
                question: "What should the next slice cover?",
                answer: {
                  kind: "custom" as const,
                  text: "Move blocking request_user_input waiting into runtime.",
                },
                answeredBy: "user" as const,
              },
            ],
          };

          const executed = yield* runAcceptedRequestUserInputToolCall({
            toolCallId: "tool_call_runtime_effects_blocking_01" as ToolCallId,
            toolItemId,
            arguments: {
              questions: [
                {
                  title: "Scope",
                  question: "What should the next slice cover?",
                  defaultAnswer: "Move blocking request_user_input waiting into runtime.",
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
            commandRecord,
          }).pipe(
            Effect.provideService(RuntimeRequestStatePort, requestStatePort),
            Effect.provideService(RuntimeCommandStatePort, commandStatePort),
            Effect.provideService(RuntimeEventBus, eventBus(calls)),
            Effect.provideService(
              RuntimeRequestInputWaitService,
              RuntimeRequestInputWaitService.of({
                waitForBlockingRequest: (input) =>
                  Effect.sync(() => {
                    waitCalls.push(input);
                    return waitedResult;
                  }),
                afterAnswerCommitted: () => Effect.die("Unexpected request input answer commit."),
                afterTimerPausedCommitted: () =>
                  Effect.die("Unexpected request input timer commit."),
                restoreOpenBlockingRequests: () =>
                  Effect.die("Unexpected request input startup restore."),
                cancelBlockingRequestsForSurface: () =>
                  Effect.die("Unexpected request input surface cancellation."),
              }),
            ),
          );

          assert.deepStrictEqual(
            createCalls.map((call) => ({ mode: call.mode, timeout: call.timeout })),
            [
              {
                mode: "blocking",
                timeout: { enabled: true, durationMs: BLOCKING_TIMEOUT_MS },
              },
            ],
          );
          assert.deepStrictEqual(calls, ["publish:1"]);
          assert.ok(createdDetails);
          assert.deepStrictEqual(waitCalls, [
            {
              request: createdDetails,
              command: commandRecord,
            },
          ]);
          assert.deepStrictEqual(finishCalls, []);
          assert.deepStrictEqual(progressCalls, [
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
                  variant: "blocking",
                  questionCount: 1,
                },
              },
            },
          ]);
          assert.deepStrictEqual(executed.result, waitedResult);
          assert.deepStrictEqual(executed.toolResult.details, {
            status: "succeeded",
            summary: "Answered Scope.",
            commandFacts: {
              questionCount: 1,
              answeredBy: "user",
              result: waitedResult,
            },
          });
        }),
      ),
  );
});

function assertRuntimeEffectError(
  error: RuntimeContractError,
  expected: {
    readonly _tag: "RuntimeContractError";
    readonly operation?: string;
    readonly reason: string;
    readonly message?: string;
  },
) {
  assert.deepStrictEqual(
    {
      _tag: error._tag,
      ...(expected.operation === undefined ? {} : { operation: error.operation }),
      reason: error.reason,
      ...(expected.message === undefined ? {} : { message: error.message }),
    },
    expected,
  );
}

function unexpectedRequestStateMethods(): Pick<
  RuntimeRequestStatePortService,
  | "getRequestInput"
  | "readRequestInputSettings"
  | "setRequestInputBlockingTimeout"
  | "setRequestInputVariant"
  | "listOpenBlockingRequestInputs"
  | "defaultOpenRequestInputQuestions"
  | "cancelRequestInput"
> {
  return {
    readRequestInputSettings: () =>
      Effect.succeed({
        mode: "nonblocking",
        blockingTimeout: { enabled: true, durationMs: BLOCKING_TIMEOUT_MS },
      }),
    setRequestInputVariant: () => Effect.die("Unexpected request input variant mutation."),
    setRequestInputBlockingTimeout: () => Effect.die("Unexpected request input timeout mutation."),
    getRequestInput: () => Effect.die("Unexpected request input get."),
    listOpenBlockingRequestInputs: () => Effect.die("Unexpected request input open blocking list."),
    defaultOpenRequestInputQuestions: () =>
      Effect.die("Unexpected request input timeout defaults."),
    cancelRequestInput: () => Effect.die("Unexpected request input cancellation."),
  };
}
