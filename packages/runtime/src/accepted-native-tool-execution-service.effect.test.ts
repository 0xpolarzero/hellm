import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  RuntimeActorExtensionBindingStatePort,
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeRequestStatePort,
  RuntimeSessionWaitStatePort,
  RuntimeThreadStatePort,
  IsoDateTimeStringSchema,
  type AbsolutePath,
  type BuildLaunchPolicyInput,
  type CommandId,
  type EnvironmentFact,
  type ExtensionId,
  type PositiveDurationMs,
  type PromptExecutionContext,
  type PromptTarget,
  type QueueItemId,
  type RequestInputQuestionId,
  type RequestInputRequestId,
  type RequestInputSettings,
  type StartRuntimeHandlerThreadsInput,
  type StartRuntimeHandlerThreadsResult,
  type RuntimeActorExtensionBindingStatePortService,
  type RuntimeApprovalStatePortService,
  type RuntimeCommandRecord,
  type RuntimeCommandStatePortService,
  type RuntimeRequestInputDetailsRecord,
  type RuntimeRequestInputRecord,
  type RuntimeRequestStatePortService,
  type RuntimeSessionWaitStatePortService,
  type RuntimeThreadStatePortService,
  type SandboxLaunchFacts,
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
import { Extensions, type ExtensionsService } from "@svvy/extensions";
import {
  layerRuntimeAcceptedNativeToolExecution,
  RuntimeAcceptedNativeToolExecution,
} from "./accepted-native-tool-execution-service";
import {
  RuntimeHandlerThreadStartPreparationHost,
  RuntimeQueueInsertPostCommitLane,
} from "./runtime-effect-requests";
import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeLaunchPolicyService } from "./runtime-launch-policy-service";
import { RuntimeApprovalWaitService } from "./runtime-approval-wait-service";
import { RuntimeQueueWakeService } from "./runtime-queue-wake-service";
import { RuntimeRequestInputWaitService } from "./runtime-request-input-wait-service";
import { RuntimeSourceInvalidationService } from "./runtime-source-invalidation-service";
import {
  layerRuntimeShutdownAdmission,
  RuntimeShutdownAdmission,
} from "./runtime-shutdown-admission";

const workspaceId = "workspace_accepted_tool_service" as WorkspaceId;
const target = {
  workspaceSessionId: "wsess_accepted_tool_service" as WorkspaceSessionId,
  surface: "orchestrator",
  surfacePiSessionId: "pi_accepted_tool_service" as SurfacePiSessionId,
} satisfies PromptTarget;
const turnId = "turn_accepted_tool_service" as TurnId;
const commandId = "command_accepted_tool_service" as CommandId;
const toolCallId = "tool_call_accepted_tool_service" as ToolCallId;
const toolItemId = "tool_call_accepted_tool_service" as ToolItemId;
const requestId = "rui_accepted_tool_service" as RequestInputRequestId;
const questionId = "ruiq_accepted_tool_service" as RequestInputQuestionId;
const threadId = "thread_accepted_tool_service" as ThreadId;
const threadGroupId = "thread_group_accepted_tool_service" as ThreadGroupId;
const handlerSurfacePiSessionId = "pi_accepted_tool_handler" as SurfacePiSessionId;
const queuedMessageId = "queue_accepted_tool_service" as QueueItemId;
const BLOCKING_TIMEOUT_MS = 300_000 as PositiveDurationMs;
const launchCwd = "/workspace/accepted-tool-service" as AbsolutePath;
const launchEnvFacts = [
  {
    key: "PATH",
    valueFingerprint: "fingerprint_path",
    redactionLabel: "path",
  },
] satisfies EnvironmentFact[];
const launchResolvedAt = "2026-04-18T09:00:00.000Z" as typeof IsoDateTimeStringSchema.Type;
const requestInvalidation = {
  scope: "workspace",
  workspaceId,
  invalidation: { model: "requestInput", ids: [requestId] },
} satisfies StateInvalidationDescriptor;
const commandInvalidation = {
  scope: "workspace",
  workspaceId,
  invalidation: { model: "commandInspector", ids: [commandId] },
} satisfies StateInvalidationDescriptor;
const handlerThreadInvalidation = {
  scope: "workspace",
  workspaceId,
  invalidation: { model: "surface", ids: [handlerSurfacePiSessionId] },
} satisfies StateInvalidationDescriptor;

describe("RuntimeAcceptedNativeToolExecution", () => {
  it.effect("builds direct-tool launch facts through the runtime launch-policy mapper", () => {
    const calls: BuildLaunchPolicyInput[] = [];
    const facts = testLaunchFacts();
    const cases = [
      {
        toolName: "exec_command" as const,
        command: ["/bin/zsh", "-lc", "git status --short"],
        launchKind: "direct_shell" as const,
      },
      {
        toolName: "apply_patch" as const,
        command: ["/usr/bin/patch", "-p0"],
        launchKind: "direct_apply_patch" as const,
      },
      {
        toolName: "execute_typescript" as const,
        command: ["/usr/local/bin/bun", "/tmp/svvy-execute-typescript.js"],
        launchKind: "execute_typescript_runtime" as const,
      },
    ];

    return Effect.gen(function* () {
      const service = yield* RuntimeAcceptedNativeToolExecution;
      for (const directToolCase of cases) {
        const result = yield* service.acquireDirectToolLaunch({
          scope: { kind: "workspace", workspaceId },
          surfacePiSessionId: target.surfacePiSessionId,
          commandId,
          toolName: directToolCase.toolName,
          command: directToolCase.command,
          cwd: launchCwd,
          envFacts: launchEnvFacts,
        });

        assert.strictEqual(result, facts);
      }

      assert.deepStrictEqual(
        calls,
        cases.map((directToolCase) => ({
          scope: { kind: "workspace", workspaceId },
          surfacePiSessionId: target.surfacePiSessionId,
          commandId,
          launchKind: directToolCase.launchKind,
          command: directToolCase.command,
          cwd: launchCwd,
          envFacts: launchEnvFacts,
        })),
      );

      const shutdown = yield* RuntimeShutdownAdmission;
      yield* shutdown.runShutdown(
        Effect.succeed({
          status: "drained",
          interruptedTurns: 0,
          interruptedCommands: 0,
          releasedQueueClaims: 0,
          recoveryRowsScheduled: 0,
        }),
      );
      const rejected = yield* service
        .acquireDirectToolLaunch({
          scope: { kind: "workspace", workspaceId },
          surfacePiSessionId: target.surfacePiSessionId,
          commandId,
          toolName: "exec_command",
          command: ["/bin/true"],
          cwd: launchCwd,
          envFacts: launchEnvFacts,
        })
        .pipe(Effect.flip);
      assert.strictEqual(rejected.reason, "runtime-shutdown");
      assert.strictEqual(calls.length, cases.length);
    }).pipe(
      Effect.provide(layerRuntimeAcceptedNativeToolExecution),
      Effect.provide(layerRuntimeShutdownAdmission),
      Effect.provideService(RuntimeRequestStatePort, requestStatePort({ createCalls: [] })),
      Effect.provideService(
        RuntimeCommandStatePort,
        commandStatePort({ progressCalls: [], finishCalls: [] }),
      ),
      Effect.provideService(RuntimeEventBus, eventBus([])),
      Effect.provideService(RuntimeQueueWakeService, unusedQueueWakeService()),
      Effect.provideService(RuntimeApprovalStatePort, unusedApprovalStatePort()),
      Effect.provideService(RuntimeSessionWaitStatePort, unusedSessionWaitStatePort()),
      Effect.provideService(RuntimeApprovalWaitService, unusedApprovalWaitService()),
      Effect.provideService(RuntimeRequestInputWaitService, unusedRequestInputWaitService()),
      Effect.provideService(
        RuntimeLaunchPolicyService,
        RuntimeLaunchPolicyService.of({
          build: (input) =>
            Effect.sync(() => {
              calls.push(input);
              return facts;
            }),
        }),
      ),
      Effect.provideService(RuntimeActorExtensionBindingStatePort, unusedActorBindingStatePort()),
      Effect.provideService(RuntimeThreadStatePort, unusedThreadStatePort()),
      Effect.provideService(RuntimeSourceInvalidationService, unusedSourceInvalidationService()),
      Effect.provideService(Extensions, unusedExtensionsService()),
      Effect.provideService(
        RuntimeHandlerThreadStartPreparationHost,
        RuntimeHandlerThreadStartPreparationHost.of({
          prepareHandlerThreadStart: () => Effect.die("Unexpected handler thread preparation."),
        }),
      ),
      Effect.provideService(
        RuntimeQueueInsertPostCommitLane,
        RuntimeQueueInsertPostCommitLane.of({
          afterQueueInsertCommitted: () => Effect.die("Unexpected queue post-commit wake."),
        }),
      ),
    );
  });

  it.effect(
    "runs nonblocking request_user_input with runtime event publication for request and command writes",
    () => {
      const published: StateInvalidationDescriptor[][] = [];
      const createCalls: Parameters<RuntimeRequestStatePortService["createRequestInput"]>[0][] = [];
      const progressCalls: Parameters<RuntimeCommandStatePortService["recordCommandEvent"]>[0][] =
        [];
      const finishCalls: Parameters<RuntimeCommandStatePortService["finishCommand"]>[0][] = [];
      let settingsReads = 0;

      return Effect.gen(function* () {
        const service = yield* RuntimeAcceptedNativeToolExecution;
        const result = yield* service.runRequestUserInput({
          toolCallId,
          toolItemId,
          arguments: {
            questions: [
              {
                title: "Scope",
                question: "Which implementation slice should run next?",
                defaultAnswer: "Keep moving accepted tool execution into runtime.",
              },
            ],
          },
          context: promptContext(),
          actorBinding: {
            loadedExtensionIds: ["request-user-input" as ExtensionId],
            availableExtensionIds: [],
          },
          command: commandContext(),
          commandRecord: runtimeCommandRecord("running"),
        });

        assert.deepStrictEqual(result.result, {
          answers: [
            {
              title: "Scope",
              question: "Which implementation slice should run next?",
              answer: {
                kind: "custom",
                text: "Keep moving accepted tool execution into runtime.",
              },
              answeredBy: "default",
            },
          ],
        });
        assert.deepStrictEqual(
          createCalls.map((call) => ({ mode: call.mode, timeout: call.timeout })),
          [{ mode: "nonblocking", timeout: null }],
        );
        assert.strictEqual(progressCalls.length, 1);
        assert.strictEqual(finishCalls.length, 1);
        assert.strictEqual(settingsReads, 1);
        assert.deepStrictEqual(published, [
          [requestInvalidation],
          [commandInvalidation],
          [commandInvalidation],
        ]);
      }).pipe(
        Effect.provide(layerRuntimeAcceptedNativeToolExecution),
        Effect.provide(layerRuntimeShutdownAdmission),
        Effect.provideService(
          RuntimeRequestStatePort,
          requestStatePort({
            createCalls,
            onReadSettings: () => {
              settingsReads += 1;
            },
          }),
        ),
        Effect.provideService(
          RuntimeCommandStatePort,
          commandStatePort({ progressCalls, finishCalls }),
        ),
        Effect.provideService(RuntimeEventBus, eventBus(published)),
        Effect.provideService(RuntimeQueueWakeService, unusedQueueWakeService()),
        Effect.provideService(RuntimeApprovalStatePort, unusedApprovalStatePort()),
        Effect.provideService(RuntimeSessionWaitStatePort, unusedSessionWaitStatePort()),
        Effect.provideService(RuntimeApprovalWaitService, unusedApprovalWaitService()),
        Effect.provideService(RuntimeRequestInputWaitService, unusedRequestInputWaitService()),
        Effect.provideService(RuntimeLaunchPolicyService, unusedLaunchPolicyService()),
        Effect.provideService(RuntimeActorExtensionBindingStatePort, unusedActorBindingStatePort()),
        Effect.provideService(RuntimeThreadStatePort, unusedThreadStatePort()),
        Effect.provideService(RuntimeSourceInvalidationService, unusedSourceInvalidationService()),
        Effect.provideService(Extensions, unusedExtensionsService()),
        Effect.provideService(
          RuntimeHandlerThreadStartPreparationHost,
          RuntimeHandlerThreadStartPreparationHost.of({
            prepareHandlerThreadStart: () => Effect.die("Unexpected handler thread preparation."),
          }),
        ),
        Effect.provideService(
          RuntimeQueueInsertPostCommitLane,
          RuntimeQueueInsertPostCommitLane.of({
            afterQueueInsertCommitted: () => Effect.die("Unexpected queue post-commit wake."),
          }),
        ),
      );
    },
  );

  it.effect("runs accepted thread_start through the composed handler preparation host", () => {
    const published: StateInvalidationDescriptor[][] = [];
    const finishCalls: Parameters<RuntimeCommandStatePortService["finishCommand"]>[0][] = [];
    const startCalls: StartRuntimeHandlerThreadsInput[] = [];
    const wakeCalls: Parameters<RuntimeQueueWakeService["Service"]["wakeSurface"]>[0][] = [];
    const preparedInput = startHandlerThreadsInput();
    return Effect.gen(function* () {
      const service = yield* RuntimeAcceptedNativeToolExecution;
      const result = yield* service.runThreadStart({
        toolCallId,
        toolItemId,
        arguments: {
          threads: [{ objective: "Inspect accepted thread_start runtime wiring." }],
        },
        context: {
          ...promptContext(),
          loadedExtensionIds: ["thread-orchestration"],
        },
        actorBinding: {
          loadedExtensionIds: ["thread-orchestration" as ExtensionId],
          availableExtensionIds: [],
        },
        command: commandContext(),
      });

      assert.deepStrictEqual(startCalls, [preparedInput]);
      assert.deepStrictEqual(wakeCalls, [
        {
          target: {
            workspaceSessionId: target.workspaceSessionId,
            surface: "handler",
            surfacePiSessionId: handlerSurfacePiSessionId,
            threadId,
          },
          reason: "message-submitted",
        },
      ]);
      assert.deepStrictEqual(
        finishCalls.map((call) => call.status),
        ["succeeded"],
      );
      assert.deepStrictEqual(published, [[handlerThreadInvalidation], [commandInvalidation]]);
      assert.strictEqual(result.result.threadGroupId, threadGroupId);
      assert.strictEqual(result.result.threads[0]?.threadId, threadId);
    }).pipe(
      Effect.provide(layerRuntimeAcceptedNativeToolExecution),
      Effect.provide(layerRuntimeShutdownAdmission),
      Effect.provideService(
        RuntimeCommandStatePort,
        commandStatePort({ progressCalls: [], finishCalls }),
      ),
      Effect.provideService(
        RuntimeRequestStatePort,
        requestStatePort({
          createCalls: [],
        }),
      ),
      Effect.provideService(RuntimeEventBus, eventBus(published)),
      Effect.provideService(RuntimeApprovalStatePort, unusedApprovalStatePort()),
      Effect.provideService(RuntimeSessionWaitStatePort, unusedSessionWaitStatePort()),
      Effect.provideService(RuntimeApprovalWaitService, unusedApprovalWaitService()),
      Effect.provideService(
        RuntimeQueueWakeService,
        RuntimeQueueWakeService.of({
          wakeSurface: (input) =>
            Effect.sync(() => {
              wakeCalls.push(input);
            }),
        }),
      ),
      Effect.provideService(RuntimeRequestInputWaitService, unusedRequestInputWaitService()),
      Effect.provideService(RuntimeLaunchPolicyService, unusedLaunchPolicyService()),
      Effect.provideService(RuntimeActorExtensionBindingStatePort, unusedActorBindingStatePort()),
      Effect.provideService(
        RuntimeThreadStatePort,
        threadStatePort({ startCalls, result: startHandlerThreadsResult() }),
      ),
      Effect.provideService(RuntimeSourceInvalidationService, unusedSourceInvalidationService()),
      Effect.provideService(Extensions, unusedExtensionsService()),
      Effect.provideService(
        RuntimeHandlerThreadStartPreparationHost,
        RuntimeHandlerThreadStartPreparationHost.of({
          prepareHandlerThreadStart: () => Effect.succeed(preparedInput),
        }),
      ),
      Effect.provideService(
        RuntimeQueueInsertPostCommitLane,
        RuntimeQueueInsertPostCommitLane.of({
          afterQueueInsertCommitted: () => Effect.die("Unexpected queue post-commit wake."),
        }),
      ),
    );
  });

  it.effect(
    "runs blocking request_user_input through the runtime wait service after publishing request and progress writes",
    () => {
      const published: StateInvalidationDescriptor[][] = [];
      const createCalls: Parameters<RuntimeRequestStatePortService["createRequestInput"]>[0][] = [];
      const progressCalls: Parameters<RuntimeCommandStatePortService["recordCommandEvent"]>[0][] =
        [];
      const finishCalls: Parameters<RuntimeCommandStatePortService["finishCommand"]>[0][] = [];
      const waitCalls: {
        request: RuntimeRequestInputDetailsRecord;
        command: RuntimeCommandRecord;
      }[] = [];
      const commandRecord = runtimeCommandRecord("running");
      let createdDetails: RuntimeRequestInputDetailsRecord | null = null;
      const waitedResult = {
        answers: [
          {
            title: "Scope",
            question: "Which implementation slice should run next?",
            answer: {
              kind: "custom" as const,
              text: "Wait for the user's answer before continuing.",
            },
            answeredBy: "user" as const,
          },
        ],
      };

      return Effect.gen(function* () {
        const service = yield* RuntimeAcceptedNativeToolExecution;
        const result = yield* service.runRequestUserInput({
          toolCallId,
          toolItemId,
          arguments: {
            questions: [
              {
                title: "Scope",
                question: "Which implementation slice should run next?",
                defaultAnswer: "Fall back if the user does not answer.",
              },
            ],
          },
          context: promptContext(),
          actorBinding: {
            loadedExtensionIds: ["request-user-input" as ExtensionId],
            availableExtensionIds: [],
          },
          command: commandContext(),
          commandRecord,
        });

        assert.deepStrictEqual(result.result, waitedResult);
        assert.deepStrictEqual(result.toolResult.details, {
          status: "succeeded",
          summary: "Answered Scope.",
          commandFacts: {
            questionCount: 1,
            answeredBy: "user",
            result: waitedResult,
          },
        });
        assert.deepStrictEqual(
          createCalls.map((call) => ({ mode: call.mode, timeout: call.timeout })),
          [{ mode: "blocking", timeout: { enabled: true, durationMs: BLOCKING_TIMEOUT_MS } }],
        );
        assert.ok(createdDetails);
        assert.deepStrictEqual(waitCalls, [{ request: createdDetails, command: commandRecord }]);
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
        assert.deepStrictEqual(finishCalls, []);
        assert.deepStrictEqual(published, [[requestInvalidation], [commandInvalidation]]);
      }).pipe(
        Effect.provide(layerRuntimeAcceptedNativeToolExecution),
        Effect.provide(layerRuntimeShutdownAdmission),
        Effect.provideService(RuntimeApprovalStatePort, unusedApprovalStatePort()),
        Effect.provideService(RuntimeSessionWaitStatePort, unusedSessionWaitStatePort()),
        Effect.provideService(RuntimeApprovalWaitService, unusedApprovalWaitService()),
        Effect.provideService(
          RuntimeRequestStatePort,
          requestStatePort({
            createCalls,
            settings: {
              mode: "blocking",
              blockingTimeout: { enabled: true, durationMs: BLOCKING_TIMEOUT_MS },
            },
            createStatus: "open",
            afterCreate: (request) => {
              createdDetails = requestDetails({
                variant: "blocking",
                status: "open",
                completedAt: null,
                timeout: request.timeout
                  ? {
                      timerVersion: 1,
                      enabled: request.timeout.enabled,
                      durationMs: request.timeout.durationMs,
                      startedAt: "2026-04-18T09:00:00.000Z",
                      pausedAt: null,
                      remainingMsWhenPaused: null,
                      expiresAt: "2026-04-18T09:05:00.000Z",
                    }
                  : null,
              });
            },
            getDetails: () =>
              createdDetails ?? Effect.die("Expected blocking request details to exist."),
          }),
        ),
        Effect.provideService(
          RuntimeCommandStatePort,
          commandStatePort({ progressCalls, finishCalls }),
        ),
        Effect.provideService(RuntimeEventBus, eventBus(published)),
        Effect.provideService(RuntimeQueueWakeService, unusedQueueWakeService()),
        Effect.provideService(
          RuntimeRequestInputWaitService,
          RuntimeRequestInputWaitService.of({
            waitForBlockingRequest: (input) =>
              Effect.sync(() => {
                waitCalls.push(input);
                return waitedResult;
              }),
            afterAnswerCommitted: () => Effect.die("Unexpected request-input answer post-commit."),
            afterTimerPausedCommitted: () =>
              Effect.die("Unexpected request-input timer post-commit."),
            restoreOpenBlockingRequests: () =>
              Effect.die("Unexpected request-input startup restore."),
            cancelBlockingRequestsForSurface: () =>
              Effect.die("Unexpected request-input surface cancellation."),
          }),
        ),
        Effect.provideService(RuntimeLaunchPolicyService, unusedLaunchPolicyService()),
        Effect.provideService(RuntimeActorExtensionBindingStatePort, unusedActorBindingStatePort()),
        Effect.provideService(RuntimeThreadStatePort, unusedThreadStatePort()),
        Effect.provideService(RuntimeSourceInvalidationService, unusedSourceInvalidationService()),
        Effect.provideService(Extensions, unusedExtensionsService()),
        Effect.provideService(
          RuntimeHandlerThreadStartPreparationHost,
          RuntimeHandlerThreadStartPreparationHost.of({
            prepareHandlerThreadStart: () => Effect.die("Unexpected handler thread preparation."),
          }),
        ),
        Effect.provideService(
          RuntimeQueueInsertPostCommitLane,
          RuntimeQueueInsertPostCommitLane.of({
            afterQueueInsertCommitted: () => Effect.die("Unexpected queue post-commit wake."),
          }),
        ),
      );
    },
  );
});

function promptContext(): PromptExecutionContext {
  return {
    workspaceSessionId: target.workspaceSessionId,
    turnId,
    surfacePiSessionId: target.surfacePiSessionId,
    surfaceKind: "orchestrator",
    defaultEpisodeKind: "analysis",
    rootThreadId: null,
    rootEpisodeKind: "analysis",
    sessionWaitApplied: false,
    threadWasTerminalAtStart: false,
    loadedExtensionIds: ["request-user-input"],
    availableExtensionIds: [],
    generatedAgentContextFingerprint: "fingerprint_accepted_tool_service",
    generatedAgentContextRevision: "revision_accepted_tool_service",
  };
}

function commandContext() {
  return {
    commandId,
    target,
    turnId,
    approvalMode: "auto-review" as const,
    sandbox: { snapshot: {} },
    cwd: "/tmp/svvy-accepted-tool-service",
    baseEnv: {},
  };
}

function startHandlerThreadsInput(): StartRuntimeHandlerThreadsInput {
  return {
    workspaceSessionId: target.workspaceSessionId,
    orchestratorTurnId: turnId,
    sourceCommandId: commandId,
    threads: [
      {
        surfacePiSessionId: handlerSurfacePiSessionId,
        title: "Inspect accepted thread_start runtime wiring.",
        objective: "Inspect accepted thread_start runtime wiring.",
        historyMode: "isolated",
        generatedAgentContextBinding: {
          aggregateCacheKey: "handler-thread-cache",
          generatedAgentContextFingerprint: "handler-thread-fingerprint",
          generatedAgentContextRevision: 1,
          externalSourceHashes: [],
        },
        initialQueue: {
          idempotencyKey: "initial_handler_start:thread_accepted_tool_service",
          priority: "runtime",
          orderingKey: `surface:${handlerSurfacePiSessionId}`,
          nextAttemptAt: null,
        },
      },
    ],
  };
}

function startHandlerThreadsResult(): StartRuntimeHandlerThreadsResult {
  return {
    threadGroupId,
    threads: [
      {
        threadId,
        threadGroupId,
        workspaceSessionId: target.workspaceSessionId,
        surfacePiSessionId: handlerSurfacePiSessionId,
        parentThreadId: null,
        title: "Inspect accepted thread_start runtime wiring.",
        objective: "Inspect accepted thread_start runtime wiring.",
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
  };
}

function runtimeCommandRecord(status: RuntimeCommandRecord["status"]): RuntimeCommandRecord {
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
    status,
    attempts: 1,
    title: "Ask user",
    summary: "",
    arguments: null,
    facts: null,
    error: null,
    startedAt: "2026-04-18T09:00:00.000Z",
    updatedAt: "2026-04-18T09:00:00.000Z",
    finishedAt: status === "running" ? null : "2026-04-18T09:00:01.000Z",
  };
}

function testLaunchFacts(): SandboxLaunchFacts {
  return {
    mode: "omitted_full_access",
    spawn: {
      executable: "/bin/zsh" as AbsolutePath,
      args: ["-lc", "git status --short"],
      cwd: launchCwd,
      envFacts: launchEnvFacts,
    },
    policySnapshot: {
      snapshotId: "sandbox_snapshot_accepted_tool_service",
      fingerprint: "sandbox_fingerprint_accepted_tool_service",
      resolvedAt: launchResolvedAt,
      scope: { kind: "workspace", workspaceId },
      surfacePiSessionId: target.surfacePiSessionId,
      commandId,
      launchKind: "direct_shell",
      cwd: launchCwd,
      sandboxMode: "omitted_full_access",
      networkPolicy: "allow",
      filesystemPolicy: {
        defaultAccess: "read",
        entries: [],
      },
    },
  };
}

function requestDetails(
  input: Partial<
    Pick<
      RuntimeRequestInputDetailsRecord,
      "variant" | "status" | "completedAt" | "timeout" | "answers"
    >
  > = {},
): RuntimeRequestInputDetailsRecord {
  return {
    requestId,
    sessionId: target.workspaceSessionId,
    surfacePiSessionId: target.surfacePiSessionId,
    threadId: null,
    turnId,
    commandId,
    variant: input.variant ?? "nonblocking",
    status: input.status ?? "completed",
    questionCount: 1,
    toolItemId,
    createdAt: "2026-04-18T09:00:00.000Z",
    completedAt: input.completedAt ?? "2026-04-18T09:00:00.000Z",
    timeout: input.timeout ?? null,
    questions: [
      {
        questionId,
        requestId,
        ordinal: 0,
        title: "Scope",
        question: "Which implementation slice should run next?",
        defaultAnswer: {
          kind: "custom",
          text: "Keep moving accepted tool execution into runtime.",
        },
        choices: [],
        status: input.status === "open" ? "open" : "answered",
      },
    ],
    answers: input.answers ?? [],
  };
}

function requestStatePort(input: {
  createCalls: Parameters<RuntimeRequestStatePortService["createRequestInput"]>[0][];
  createStatus?: RuntimeRequestInputRecord["status"];
  afterCreate?: (
    request: Parameters<RuntimeRequestStatePortService["createRequestInput"]>[0],
  ) => void;
  getDetails?: () => RuntimeRequestInputDetailsRecord | Effect.Effect<never, never, never>;
  settings?: RequestInputSettings;
  onReadSettings?: () => void;
}): RuntimeRequestStatePortService {
  return {
    readRequestInputSettings: () =>
      Effect.sync(() => {
        input.onReadSettings?.();
        return (
          input.settings ?? {
            mode: "nonblocking",
            blockingTimeout: { enabled: true, durationMs: BLOCKING_TIMEOUT_MS },
          }
        );
      }),
    setRequestInputVariant: () => Effect.die("Unexpected request input variant mutation."),
    setRequestInputBlockingTimeout: () => Effect.die("Unexpected request input timeout mutation."),
    createRequestInput: (request) => {
      input.createCalls.push(request);
      input.afterCreate?.(request);
      return Effect.succeed({
        value: {
          requestId,
          sessionId: request.target.workspaceSessionId,
          surfacePiSessionId: request.target.surfacePiSessionId,
          threadId: request.target.surface === "handler" ? request.target.threadId : null,
          turnId: request.turnId,
          commandId: request.sourceCommandId,
          variant: request.mode,
          status: input.createStatus ?? "completed",
          questionCount: request.questions.length,
        } satisfies RuntimeRequestInputRecord,
        afterCommit: [requestInvalidation],
      });
    },
    getRequestInput: () => {
      const details = input.getDetails?.() ?? requestDetails();
      return Effect.isEffect(details) ? details : Effect.succeed(details);
    },
    listOpenBlockingRequestInputs: () =>
      Effect.die("Unexpected open blocking request input listing."),
    defaultOpenRequestInputQuestions: () => Effect.die("Unexpected request input defaulting."),
    answerRequestInput: () => Effect.die("Unexpected request input answer."),
    setRequestInputTimerPaused: () => Effect.die("Unexpected request input timer pause."),
    cancelRequestInput: () => Effect.die("Unexpected request input cancellation."),
  };
}

function commandStatePort(input: {
  progressCalls: Parameters<RuntimeCommandStatePortService["recordCommandEvent"]>[0][];
  finishCalls: Parameters<RuntimeCommandStatePortService["finishCommand"]>[0][];
}): RuntimeCommandStatePortService {
  return {
    createCommand: () => Effect.die("Unexpected command create."),
    createOrReuseStreamingCommand: () => Effect.die("Unexpected streaming command create."),
    findCommandByToolCallId: () => Effect.die("Unexpected command lookup by tool call."),
    findCommandById: () => Effect.die("Unexpected command lookup by id."),
    updateCommandArguments: () => Effect.die("Unexpected command argument update."),
    startCommand: () => Effect.die("Unexpected command start."),
    finishCommand: (request) => {
      input.finishCalls.push(request);
      return Effect.succeed({
        value: runtimeCommandRecord(request.status),
        afterCommit: [commandInvalidation],
      });
    },
    recordCommandEvent: (request) => {
      input.progressCalls.push(request);
      return Effect.succeed({ value: undefined, afterCommit: [commandInvalidation] });
    },
    recordStdinWrite: () => Effect.die("Unexpected stdin write."),
    hasCommandOutputEvent: () => Effect.die("Unexpected command output check."),
  };
}

function eventBus(published: StateInvalidationDescriptor[][]): RuntimeEventBus["Service"] {
  return RuntimeEventBus.of({
    publishLive: () => Effect.die("Unexpected live event publication."),
    publishStateInvalidations: (input) =>
      Effect.sync(() => {
        published.push([...input.afterCommit]);
        return [];
      }),
    subscribe: () => Effect.die("Unexpected runtime event subscription."),
  });
}

function unusedRequestInputWaitService(): RuntimeRequestInputWaitService["Service"] {
  return RuntimeRequestInputWaitService.of({
    waitForBlockingRequest: () => Effect.die("Unexpected blocking request-input wait."),
    afterAnswerCommitted: () => Effect.die("Unexpected request-input answer post-commit."),
    afterTimerPausedCommitted: () => Effect.die("Unexpected request-input timer post-commit."),
    restoreOpenBlockingRequests: () => Effect.die("Unexpected request-input startup restore."),
    cancelBlockingRequestsForSurface: () =>
      Effect.die("Unexpected request-input surface cancellation."),
  });
}

function unusedApprovalStatePort(): RuntimeApprovalStatePortService {
  return unusedPort("RuntimeApprovalStatePort");
}

function unusedSessionWaitStatePort(): RuntimeSessionWaitStatePortService {
  return unusedPort("RuntimeSessionWaitStatePort");
}

function unusedApprovalWaitService(): RuntimeApprovalWaitService["Service"] {
  return RuntimeApprovalWaitService.of({
    waitForApproval: () => Effect.die("Unexpected approval wait."),
    afterApprovalCommitted: () => Effect.die("Unexpected approval commit wake."),
    cancelApprovalWait: () => Effect.die("Unexpected approval cancellation wake."),
    cancelAllApprovalWaits: () => Effect.die("Unexpected approval cancellation wake."),
  });
}

function unusedPort(label: string): never {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(`${label} is unused by this test.`);
      },
    },
  ) as never;
}

function unusedLaunchPolicyService(): RuntimeLaunchPolicyService["Service"] {
  return RuntimeLaunchPolicyService.of({
    build: () => Effect.die("Unexpected launch policy build."),
  });
}

function unusedQueueWakeService(): RuntimeQueueWakeService["Service"] {
  return RuntimeQueueWakeService.of({
    wakeSurface: () => Effect.die("Unexpected queue wake."),
  });
}

function unusedActorBindingStatePort(): RuntimeActorExtensionBindingStatePortService {
  return {
    readRuntimePromptBinding: () => Effect.die("Unexpected runtime prompt binding read."),
    updateActorExtensionBinding: () => Effect.die("Unexpected actor binding update."),
    setActorExtensionBinding: () => Effect.die("Unexpected actor binding set."),
  };
}

function unusedThreadStatePort(): RuntimeThreadStatePortService {
  return {
    ensureHandlerThreadRunnable: () => Effect.die("Unexpected handler thread runnable update."),
    startHandlerThreads: () => Effect.die("Unexpected handler thread start."),
  };
}

function threadStatePort(input: {
  startCalls: StartRuntimeHandlerThreadsInput[];
  result: StartRuntimeHandlerThreadsResult;
}): RuntimeThreadStatePortService {
  return {
    ensureHandlerThreadRunnable: () => Effect.die("Unexpected handler thread runnable update."),
    startHandlerThreads: (request) =>
      Effect.sync(() => {
        input.startCalls.push(request);
        return {
          value: input.result,
          afterCommit: [handlerThreadInvalidation],
        };
      }),
  };
}

function unusedSourceInvalidationService(): RuntimeSourceInvalidationService["Service"] {
  return RuntimeSourceInvalidationService.of({
    hint: () => Effect.die("Unexpected source hint."),
    reconcile: () => Effect.die("Unexpected source reconcile."),
    applyCommittedScanEvent: () => Effect.die("Unexpected committed source scan event."),
    refreshGeneratedContext: () => Effect.die("Unexpected generated context refresh."),
    refreshGeneratedPackages: () => Effect.die("Unexpected generated package refresh."),
  });
}

function unusedExtensionsService(): ExtensionsService {
  return Extensions.of({
    registry: {
      list: () => Effect.die("Unexpected extension list."),
      inspect: () => Effect.die("Unexpected extension inspect."),
    },
    actorBindings: {
      resolve: () => Effect.die("Unexpected actor binding resolve."),
      visibleRecords: () => Effect.die("Unexpected visible extension records."),
    },
    nativeTools: {
      declarations: () => Effect.die("Unexpected native tool declarations."),
      metadata: () => Effect.die("Unexpected native tool metadata."),
      handler: () => Effect.die("Unexpected native tool handler lookup."),
    },
    executeTypescriptFacadeDeclarations: {
      build: () => Effect.die("Unexpected execute_typescript facade declaration build."),
    },
    generatedPackages: {
      refresh: () => Effect.die("Unexpected generated package refresh."),
      planWorkspaceLink: () => Effect.die("Unexpected workspace link plan."),
    },
    sources: {
      openEditSession: () => Effect.die("Unexpected source edit open."),
      saveEditSession: () => Effect.die("Unexpected source edit save."),
      createWorkflowAgent: () => Effect.die("Unexpected workflow-agent create."),
      duplicateWorkflowAgent: () => Effect.die("Unexpected workflow-agent duplicate."),
      deleteWorkflowAgent: () => Effect.die("Unexpected workflow-agent delete."),
      scanWorkflowAgents: () => Effect.die("Unexpected workflow-agent scan."),
      scaffoldMissingWorkflowAgents: () => Effect.die("Unexpected workflow-agent scaffold."),
    },
  });
}
