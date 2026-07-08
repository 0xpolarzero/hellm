import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import {
  type AcceptSubmittedRuntimeSurfaceMessageInput,
  type EnqueueRuntimeSurfaceMessageInput,
  type AbortPromptInput,
  type AbsolutePath,
  type AppLogEntryId,
  type AcquireDefaultWorkspaceInput,
  type AcquireWorkspaceInput,
  type AnswerRequestInputInput,
  type AnswerRequestInputResult,
  type CancelCommandInput,
  type CloseSurfaceInput,
  type CommandId,
  type CreateOrchestratorSurfaceInput,
  type RuntimeApprovalId,
  type RuntimeApprovalRecord,
  type RuntimeActorExtensionBindingStatePortService,
  type RuntimeApprovalStatePortService,
  type RuntimeCommandRecord,
  type RecordRuntimeCommandStdinWriteInput,
  type GeneratedPackageName,
  type GeneratedPackagesRefreshResult,
  IsoDateTimeStringSchema,
  type IsoDateTimeString,
  type QueueItemId,
  type RefreshGeneratedContextRequest,
  type RecoveryWorkId,
  type ReleaseWorkspaceInput,
  type RequestInputAnswerId,
  type RequestInputOptionId,
  type RequestInputQuestionId,
  type RequestInputRequestId,
  type RuntimeRequestStatePortService,
  type RuntimeRequestInputDetailsRecord,
  type RuntimeCommandStatePortService,
  type SourceInvalidationHint,
  type SourceReconcileRequest,
  type RuntimeSessionWaitStatePortService,
  type RuntimeSourceScanFactRecord,
  type RuntimeSourceStatePortService,
  type RuntimeSurfaceLifecycleStatePortService,
  type RuntimeEpisodeStatePortService,
  type RuntimeThreadStatePortService,
  type RuntimeTurnStatePortService,
  type RuntimeWorkspaceStatePortService,
  type StateRevision,
  type RuntimeClientCorrelationId,
  type RuntimeClientRequestId,
  type RuntimeClientSubmissionSource,
  type RuntimeEvent,
  type RuntimeEventSequence,
  type RuntimeGeneratedPackageStatePortService,
  type RuntimeQueueStatePortService,
  type RuntimeSurfaceMessageRecord,
  type StateMutationResult,
  type OpenSurfaceInput,
  type FiniteDurationMs,
  type PositiveDurationMs,
  type RecordRuntimeSourceSaveInput,
  type RuntimeOwnerId,
  type SetRequestInputTimerPausedInput,
  type StateInvalidationDescriptor,
  type SteerQueuedMessageInput,
  type SubmitMessageInput,
  type SubmitMessageResult,
  type SurfacePiSessionId,
  type ThreadId,
  type ToolItemId,
  type TurnId,
  type WorkspaceId,
  type WorkspaceSessionId,
  type WriteCommandStdinInput,
  type SandboxPolicySnapshot,
  type SandboxPolicySourceService,
} from "@svvy/core";
import {
  createCatalogBackedRuntime,
  type CatalogBackedRuntimeDependencies,
  type RuntimeGeneratedPackageRefreshBoundaryHost,
} from "./runtime-service-adapter";
import { createTestSandboxHostSupport } from "./sandbox-host-support.test-support";
import {
  defaultRuntimeLayerConfig,
  type RuntimeGeneratedPackageWorkspaceLinkFileHost,
} from "@svvy/runtime/bootstrap";

type RuntimePort = Parameters<typeof createCatalogBackedRuntime>[0];
type TestCatalog = RuntimePort["catalog"];
type CancelActivePromptCall = Parameters<TestCatalog["cancelActivePrompt"]>[0];
type CancelPromptCall = Parameters<TestCatalog["cancelPrompt"]>[0];
type RuntimeSurfaceQueueWakeCall = Parameters<TestCatalog["wakeRuntimeSurfaceQueue"]>[0];
type RuntimeGeneratedContextRefreshHost = RuntimePort["generatedContextRefreshHost"];
type RuntimeGeneratedPackageRefreshHost = RuntimePort["generatedPackageRefreshHost"];
type RuntimeCommandStdinPort = RuntimePort["commandStdin"];
type RuntimeCommandControlPort = RuntimePort["commandControl"];

type FakeLinkEntry =
  | { readonly kind: "directory" }
  | { readonly kind: "file" }
  | { readonly kind: "symlink"; readonly targetPath: string };

function fakeWorkspaceLinkFileHost(
  entries: Map<string, FakeLinkEntry>,
  calls: string[] = [],
): RuntimeGeneratedPackageWorkspaceLinkFileHost {
  return {
    pathExists: (path) => entries.has(path),
    isDirectory: (path) => entries.get(path)?.kind === "directory",
    isSymbolicLink: (path) => entries.get(path)?.kind === "symlink",
    readSymbolicLink: (path) => {
      const entry = entries.get(path);
      return entry?.kind === "symlink" ? entry.targetPath : null;
    },
    makeDirectory: (path) => {
      calls.push(`mkdir:${path}`);
      entries.set(path, { kind: "directory" });
    },
    remove: (path) => {
      calls.push(`remove:${path}`);
      entries.delete(path);
    },
    symlinkDirectory: ({ targetPath, linkPath }) => {
      calls.push(`symlink:${linkPath}->${targetPath}`);
      entries.set(linkPath, { kind: "symlink", targetPath });
    },
  };
}

function generatedPackageInvalidations(
  packageName: GeneratedPackageName,
): readonly StateInvalidationDescriptor[] {
  if (packageName === "@svvyx/workflows") {
    return [{ scope: "app", invalidation: { model: "workflowsGenerated" } }];
  }
  if (packageName === "@svvyx/extensions") {
    return [{ scope: "app", invalidation: { model: "extensions" } }];
  }
  return [];
}

function runtimeSourceScanScopeKey(scope: RuntimeSourceScanFactRecord["scope"]): string {
  return scope.kind === "workspace" ? `workspace:${scope.workspaceId}` : "app-global";
}

function stateMutation<T>(
  value: T,
  afterCommit: readonly StateInvalidationDescriptor[] = [],
): StateMutationResult<T> {
  return { value, afterCommit };
}

function createGeneratedPackageStatePort(
  calls: string[] = [],
): RuntimeGeneratedPackageStatePortService {
  return {
    recordGeneratedPackageBuild: (input) =>
      Effect.sync(() => {
        calls.push(`build:${input.status.packageName}`);
        return {
          value: {
            packageName: input.status.packageName,
            status: "ready" as const,
            buildId: input.status.buildId ?? null,
            manifestPath: input.status.manifestPath ?? null,
            sourceFingerprint: input.status.sourceFingerprint ?? null,
            outputFingerprint: input.status.outputFingerprint ?? null,
            generatedFileListDigest: null,
            dependencies: input.status.dependencies ?? [],
            diagnostics: input.status.diagnostics ?? [],
            sourceCommandId: input.sourceCommandId ?? null,
            refreshNeededReason: null,
            lastRecoveryWorkId: input.recoveryWorkId ?? null,
            createdAt: "2026-04-18T09:00:00.000Z",
            updatedAt: "2026-04-18T09:00:00.000Z",
          },
          afterCommit: generatedPackageInvalidations(input.status.packageName),
        };
      }),
    recordGeneratedPackageFailure: (input) =>
      Effect.sync(() => {
        calls.push(`failure:${input.status.packageName}`);
        return {
          value: {
            packageName: input.status.packageName,
            status: "failed" as const,
            buildId: input.status.buildId ?? null,
            manifestPath: input.status.manifestPath ?? null,
            sourceFingerprint: input.status.sourceFingerprint ?? null,
            outputFingerprint: input.status.outputFingerprint ?? null,
            generatedFileListDigest: null,
            dependencies: input.status.dependencies ?? [],
            diagnostics: input.status.diagnostics ?? [],
            sourceCommandId: input.sourceCommandId ?? null,
            refreshNeededReason: null,
            lastRecoveryWorkId: input.recoveryWorkId ?? null,
            createdAt: "2026-04-18T09:00:00.000Z",
            updatedAt: "2026-04-18T09:00:00.000Z",
          },
          afterCommit: generatedPackageInvalidations(input.status.packageName),
        };
      }),
    recordWorkspaceLinkStatus: (input) =>
      Effect.sync(() => {
        calls.push(`link:${input.status.workspaceId}:${input.status.packageName}`);
        return {
          value: {
            workspaceId: input.status.workspaceId,
            packageName: input.status.packageName,
            status: input.status.status,
            linkPath: input.status.linkPath ?? null,
            targetPath: input.status.targetPath ?? null,
            diagnostics: input.status.diagnostics ?? [],
            sourceCommandId: input.sourceCommandId ?? null,
            lastRecoveryWorkId: input.recoveryWorkId ?? null,
            createdAt: "2026-04-18T09:00:00.000Z",
            updatedAt: "2026-04-18T09:00:00.000Z",
          },
          afterCommit: generatedPackageInvalidations(input.status.packageName),
        };
      }),
    markWorkspaceLinksRepairNeeded: (input) =>
      Effect.sync(() => {
        calls.push(
          ...input.packages.map(
            (packageName) => `repair-needed:${input.workspaceId}:${packageName}`,
          ),
        );
        return {
          value: {
            links: input.packages.map((packageName) => ({
              workspaceId: input.workspaceId,
              packageName,
              status: "repair-needed" as const,
              linkPath: null,
              targetPath: null,
              diagnostics: [],
              sourceCommandId: input.sourceCommandId ?? null,
              lastRecoveryWorkId: input.recoveryWorkId ?? null,
              createdAt: input.requestedAt,
              updatedAt: input.requestedAt,
            })),
            recoveryWorkIds: [],
          },
          afterCommit: input.packages.flatMap(generatedPackageInvalidations),
        };
      }),
    readLinksNeedingRepair: () => Effect.succeed([]),
    readGeneratedPackageFacts: () => Effect.succeed([]),
    reconcileGeneratedPackageManifest: (input) =>
      Effect.succeed({
        value: {
          ...input.fact,
          status: "ready",
          diagnostics: input.diagnostics ?? [],
          sourceCommandId: input.sourceCommandId ?? null,
          refreshNeededReason: null,
          lastRecoveryWorkId: input.recoveryWorkId ?? null,
          createdAt: "2026-04-18T09:00:00.000Z",
          updatedAt: "2026-04-18T09:00:00.000Z",
        },
        afterCommit: generatedPackageInvalidations(input.fact.packageName),
      }),
    markGeneratedPackageRefreshNeeded: (input) =>
      Effect.succeed({
        value: {
          packageName: input.packageName,
          status: "refresh-needed",
          buildId: null,
          manifestPath: null,
          sourceFingerprint: null,
          outputFingerprint: null,
          generatedFileListDigest: null,
          dependencies: [],
          diagnostics: [],
          sourceCommandId: input.sourceCommandId ?? null,
          refreshNeededReason: input.reason,
          lastRecoveryWorkId: input.recoveryWorkId ?? null,
          createdAt: "2026-04-18T09:00:00.000Z",
          updatedAt: "2026-04-18T09:00:00.000Z",
        },
        afterCommit: generatedPackageInvalidations(input.packageName),
      }),
  };
}

const target = {
  workspaceSessionId: "wsess_runtime_adapter_01" as WorkspaceSessionId,
  surface: "orchestrator",
  surfacePiSessionId: "pi_orch_runtime_adapter_01" as SurfacePiSessionId,
} satisfies SubmitMessageInput["target"];

const handlerTarget = {
  workspaceSessionId: "wsess_runtime_adapter_01" as WorkspaceSessionId,
  surface: "handler",
  surfacePiSessionId: "pi_handler_runtime_adapter_01" as SurfacePiSessionId,
  threadId: "thread_runtime_adapter_01" as ThreadId,
} satisfies SubmitMessageInput["target"];

function answeredRequestInputRecord(
  input: AnswerRequestInputInput,
): RuntimeRequestInputDetailsRecord {
  return {
    requestId: input.requestId,
    sessionId: target.workspaceSessionId,
    surfacePiSessionId: input.surfacePiSessionId,
    threadId: null,
    turnId: "turn_runtime_adapter_request_input_01" as TurnId,
    commandId: "command_runtime_adapter_request_input_01" as CommandId,
    variant: "nonblocking",
    status: "completed",
    questionCount: 1,
    toolItemId: "tool_runtime_adapter_request_input_01" as ToolItemId,
    createdAt: "2026-04-18T09:00:00.000Z",
    completedAt: "2026-04-18T09:01:00.000Z",
    timeout: null,
    questions: [
      {
        questionId: input.questionId,
        requestId: input.requestId,
        ordinal: 0,
        title: "Decision",
        question: "Which path should the test take?",
        defaultAnswer: { kind: "custom", text: "default" },
        choices: [
          {
            optionId: "ruio_runtime_adapter_01" as RequestInputOptionId,
            ordinal: 0,
            label: "Use fixture",
            description: "Exercise the adapter answer path.",
            recommended: true,
          },
        ],
        status: "answered",
      },
    ],
    answers: [
      {
        answerId: "ruia_runtime_adapter_01" as RequestInputAnswerId,
        requestId: input.requestId,
        questionId: input.questionId,
        answer:
          input.answer.kind === "option"
            ? { kind: "option", label: "Use fixture", text: "Use fixture" }
            : input.answer,
        answeredBy: "user",
        delivery: input.delivery,
        queuedItemId: "queue_runtime_adapter_answer_01" as QueueItemId,
        createdAt: "2026-04-18T09:01:00.000Z",
      },
    ],
  };
}

function pausedRequestInputRecord(
  input: SetRequestInputTimerPausedInput,
): RuntimeRequestInputDetailsRecord {
  return {
    requestId: input.requestId,
    sessionId: target.workspaceSessionId,
    surfacePiSessionId: input.surfacePiSessionId,
    threadId: null,
    turnId: "turn_runtime_adapter_request_input_timer_01" as TurnId,
    commandId: "command_runtime_adapter_request_input_timer_01" as CommandId,
    variant: "blocking",
    status: "open",
    questionCount: 1,
    toolItemId: "tool_runtime_adapter_request_input_timer_01" as ToolItemId,
    createdAt: "2026-04-18T09:00:00.000Z",
    completedAt: null,
    timeout: {
      enabled: true,
      durationMs: 300_000 as PositiveDurationMs,
      startedAt: "2026-04-18T09:00:00.000Z",
      pausedAt: input.paused ? "2026-04-18T09:01:00.000Z" : null,
      remainingMsWhenPaused: input.paused ? (240_000 as FiniteDurationMs) : null,
      expiresAt: input.paused ? null : "2026-04-18T09:05:00.000Z",
    },
    questions: [],
    answers: [],
  };
}

function submitInput(delivery: SubmitMessageInput["delivery"]): SubmitMessageInput {
  return {
    target,
    message: { text: "Run the adapter test path." },
    delivery,
    clientSubmission: {
      source: "test" as RuntimeClientSubmissionSource,
      clientRequestId: "client_request_01" as RuntimeClientRequestId,
    },
  };
}

function testSandboxPolicySource(): SandboxPolicySourceService {
  return {
    snapshot: (input) => {
      const snapshot: SandboxPolicySnapshot = {
        snapshotId: "sandbox_policy_runtime_adapter_01",
        fingerprint: "sandbox-policy-runtime-adapter",
        resolvedAt: "2026-04-18T09:00:00.000Z" as typeof IsoDateTimeStringSchema.Type,
        scope: input.scope,
        surfacePiSessionId: input.surfacePiSessionId,
        commandId: input.commandId,
        launchKind: input.launchKind,
        cwd: input.cwd,
        sandboxMode: "omitted_full_access",
        networkPolicy: "allow",
        filesystemPolicy: { defaultAccess: "read", entries: [] },
      };
      return Effect.succeed(snapshot);
    },
  };
}

async function createHarness(
  options: {
    authToken?: string | undefined;
    queuedMessageId?: QueueItemId;
    sourceRoots?: RuntimePort["sourceRoots"];
    generatedPackageRoots?: RuntimePort["generatedPackageRoots"];
    extensionStatePort?: RuntimePort["extensionStatePort"];
    generatedPackageLinkPath?: RuntimePort["generatedPackageLinkPath"];
    generatedContextRefreshHost?: RuntimeGeneratedContextRefreshHost;
    generatedPackageRefreshHost?: RuntimeGeneratedPackageRefreshHost;
    sourceInvalidationScan?: RuntimePort["sourceInvalidationScan"];
    generatedPackageStateCalls?: string[];
    commandRecord?: RuntimeCommandRecord | null;
    commandStdin?: RuntimeCommandStdinPort;
    commandControl?: RuntimeCommandControlPort;
    sandboxPolicySource?: SandboxPolicySourceService;
  } = {},
) {
  const publishedStateInvalidations: StateInvalidationDescriptor[][] = [];
  const acceptSubmittedSurfaceMessageCalls: AcceptSubmittedRuntimeSurfaceMessageInput[] = [];
  const enqueueSurfaceMessageCalls: EnqueueRuntimeSurfaceMessageInput[] = [];
  const wakeRuntimeSurfaceQueueCalls: RuntimeSurfaceQueueWakeCall[] = [];
  const cancelActivePromptCalls: CancelActivePromptCall[] = [];
  const cancelPromptCalls: CancelPromptCall[] = [];
  const cancelSurfaceMessageCalls: Array<{ id: string }> = [];
  const markSurfaceMessageQueuedCalls: Array<{ id: string; position?: "front" | "back" }> = [];
  const answerRequestInputCalls: AnswerRequestInputInput[] = [];
  const setRequestInputTimerPausedCalls: SetRequestInputTimerPausedInput[] = [];
  const recordSourceSaveCalls: RecordRuntimeSourceSaveInput[] = [];
  const sourceInvalidationScanRequests: SourceReconcileRequest[] = [];
  const sourceInvalidationReconciliations: SourceReconcileRequest[] = [];
  const resolveApprovalRequestCalls: Array<{
    requestId: RuntimeApprovalId;
    status: "approved" | "denied" | "cancelled";
  }> = [];
  const startCommandCalls: Array<{ commandId: string }> = [];
  const finishCommandCalls: Array<{ commandId: string; status: string }> = [];
  const recordStdinWriteCalls: RecordRuntimeCommandStdinWriteInput[] = [];
  const commandStdinCalls: WriteCommandStdinInput[] = [];
  const commandControlCalls: CancelCommandInput[] = [];
  const clearSessionWaitCalls: Array<{ sessionId: string }> = [];
  const acquireWorkspaceCalls: AcquireWorkspaceInput[] = [];
  const acquireDefaultWorkspaceCalls: AcquireDefaultWorkspaceInput[] = [];
  const releaseWorkspaceCalls: ReleaseWorkspaceInput[] = [];
  const createOrchestratorSurfaceCalls: CreateOrchestratorSurfaceInput[] = [];
  const openSurfaceCalls: OpenSurfaceInput[] = [];
  const closeSurfaceCalls: CloseSurfaceInput[] = [];
  const generatedPackageStatePort = createGeneratedPackageStatePort(
    options.generatedPackageStateCalls,
  );
  const queuedMessageId = options.queuedMessageId ?? ("queue_runtime_adapter_01" as QueueItemId);

  const createQueuedRecord = (
    input: EnqueueRuntimeSurfaceMessageInput,
  ): RuntimeSurfaceMessageRecord => ({
    id: queuedMessageId,
    sessionId: input.sessionId,
    surfacePiSessionId: input.surfacePiSessionId,
    threadId: input.threadId ?? null,
    workflowTaskAttemptId: input.workflowTaskAttemptId ?? null,
    kind: input.kind ?? "user_message",
    idempotencyKey: input.idempotencyKey ?? `surface_queue:${queuedMessageId}`,
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
  });
  const createAcceptedQueuedRecord = (
    input: AcceptSubmittedRuntimeSurfaceMessageInput,
  ): RuntimeSurfaceMessageRecord => ({
    id: queuedMessageId,
    sessionId: input.target.workspaceSessionId,
    surfacePiSessionId: input.target.surfacePiSessionId,
    threadId: input.target.surface === "handler" ? input.target.threadId : null,
    workflowTaskAttemptId: null,
    kind: "user_message",
    idempotencyKey: input.idempotencyKey ?? `surface_queue:${queuedMessageId}`,
    messageJson: input.messageJson,
    payloadJson: input.payloadJson ?? null,
    status: "queued",
    priority: "runtime",
    orderingKey: `surface:${input.target.surfacePiSessionId}`,
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
  });
  const createSteerQueuedRecord = (): RuntimeSurfaceMessageRecord => ({
    id: queuedMessageId,
    sessionId: handlerTarget.workspaceSessionId,
    surfacePiSessionId: handlerTarget.surfacePiSessionId,
    threadId: handlerTarget.threadId,
    workflowTaskAttemptId: null,
    kind: "user_message",
    idempotencyKey: `surface_queue:${queuedMessageId}`,
    messageJson: JSON.stringify({ text: "Steer this queued message." }),
    payloadJson: null,
    status: "queued",
    priority: "runtime",
    orderingKey: `surface:${handlerTarget.surfacePiSessionId}`,
    sequence: 2,
    position: 2,
    sourceCommandId: null,
    claimOwnerId: null,
    claimLeaseExpiresAt: null,
    leaseVersion: 0,
    attemptCount: 0,
    maxAttempts: 3,
    nextAttemptAt: null,
    lastErrorJson: null,
    createdAt: "2026-04-18T09:00:00.000Z",
    updatedAt: "2026-04-18T09:00:00.000Z",
    deliveredAt: null,
    failedAt: null,
    failureError: null,
    cancelledAt: null,
  });

  const queueStatePort = {
    acceptSubmittedSurfaceMessage: (input) => {
      acceptSubmittedSurfaceMessageCalls.push(input);
      return Effect.succeed(
        stateMutation(createAcceptedQueuedRecord(input), [
          {
            scope: "workspace",
            workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
            invalidation: {
              model: "surface",
              ids: [input.target.surfacePiSessionId],
            },
          },
        ]),
      );
    },
    enqueueSurfaceMessage: (input) => {
      enqueueSurfaceMessageCalls.push(input);
      return Effect.succeed(
        stateMutation(createQueuedRecord(input), [
          {
            scope: "workspace",
            workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
            invalidation: {
              model: "surface",
              ids: [input.surfacePiSessionId as SurfacePiSessionId],
            },
          },
        ]),
      );
    },
    getSurfaceQueuedMessage: () => Effect.succeed(createSteerQueuedRecord()),
    claimNextQueuedSurfaceMessage: () =>
      Effect.die("Unexpected claimNextQueuedSurfaceMessage call."),
    releaseExpiredSurfaceMessageClaims: () =>
      Effect.die("Unexpected releaseExpiredSurfaceMessageClaims call."),
    markSurfaceMessageSteering: () => Effect.die("Unexpected markSurfaceMessageSteering call."),
    markSurfaceMessageQueued: (input) => {
      markSurfaceMessageQueuedCalls.push(input);
      return Effect.succeed(
        stateMutation(
          {
            ...createSteerQueuedRecord(),
            position: input.position === "front" ? 1 : 3,
          },
          [
            {
              scope: "workspace",
              workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
              invalidation: {
                model: "surface",
                ids: [handlerTarget.surfacePiSessionId],
              },
            },
          ],
        ),
      );
    },
    markSurfaceMessageDelivered: () => Effect.die("Unexpected markSurfaceMessageDelivered call."),
    markSurfaceMessageFailed: () => Effect.die("Unexpected markSurfaceMessageFailed call."),
    cancelSurfaceMessage: (input) => {
      cancelSurfaceMessageCalls.push(input);
      return Effect.succeed(
        stateMutation(
          {
            ...createSteerQueuedRecord(),
            status: "cancelled",
            cancelledAt: "2026-04-18T09:02:00.000Z",
          },
          [
            {
              scope: "workspace",
              workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
              invalidation: {
                model: "surface",
                ids: [handlerTarget.surfacePiSessionId],
              },
            },
          ],
        ),
      );
    },
  } satisfies RuntimeQueueStatePortService;

  const requestStatePort = {
    createRequestInput: () => Effect.die("Unexpected createRequestInput call."),
    getRequestInput: (input) => {
      const answer = answerRequestInputCalls.find((call) => call.requestId === input.requestId);
      if (!answer) {
        return Effect.die(`Unexpected getRequestInput call: ${input.requestId}`);
      }
      return Effect.succeed(answeredRequestInputRecord(answer));
    },
    listOpenBlockingRequestInputs: () => Effect.succeed([]),
    answerRequestInput: (input) => {
      answerRequestInputCalls.push(input);
      return Effect.succeed(
        stateMutation(
          {
            answer: {
              requestId: input.requestId,
              questionId: input.questionId,
              status: "recorded",
              delivery: {
                kind: "nonblocking-queued",
                queuedItemId: "queue_runtime_adapter_answer_01" as QueueItemId,
              },
            } satisfies AnswerRequestInputResult,
            target: {
              workspaceSessionId: target.workspaceSessionId,
              surface: "orchestrator",
              surfacePiSessionId: input.surfacePiSessionId,
            },
          },
          [
            {
              scope: "workspace",
              workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
              invalidation: { model: "requestInput", ids: [input.requestId] },
            },
          ],
        ),
      );
    },
    defaultOpenRequestInputQuestions: () =>
      Effect.die("Unexpected defaultOpenRequestInputQuestions call."),
    cancelRequestInput: () => Effect.die("Unexpected cancelRequestInput call."),
    setRequestInputTimerPaused: (input) => {
      setRequestInputTimerPausedCalls.push(input);
      return Effect.succeed(
        stateMutation(pausedRequestInputRecord(input), [
          {
            scope: "workspace",
            workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
            invalidation: { model: "requestInput", ids: [input.requestId] },
          },
        ]),
      );
    },
  } satisfies RuntimeRequestStatePortService;

  const approvalRecord = {
    requestId: "approval_runtime_adapter_01" as RuntimeApprovalId,
    sessionId: "session_runtime_adapter_01" as WorkspaceSessionId,
    surfacePiSessionId: "surface_runtime_adapter_01" as SurfacePiSessionId,
    threadId: null,
    turnId: "turn_runtime_adapter_01" as TurnId,
    commandId: "cmd_runtime_adapter_approval_01" as CommandId,
    toolCallId: "tool_runtime_adapter_approval_01" as ToolItemId,
    toolName: "exec_command",
    approvalMode: "user",
    cwd: "/tmp/svvy-runtime-adapter",
    command: "git status",
    commandFamily: "git",
    patch: null,
    snippetArtifactId: null,
    typescriptCode: null,
    context: null,
    status: "pending",
    decisionReason: null,
    reviewer: null,
    createdAt: "2026-04-18T09:00:00.000Z",
    completedAt: null,
  } satisfies RuntimeApprovalRecord;
  const commandRecord = {
    id: approvalRecord.commandId,
    sessionId: approvalRecord.sessionId,
    turnId: approvalRecord.turnId,
    workflowTaskAttemptId: null,
    surfacePiSessionId: approvalRecord.surfacePiSessionId,
    threadId: null,
    workflowRunId: null,
    parentCommandId: null,
    toolName: "exec_command",
    executor: "runtime",
    visibility: "surface",
    status: "waiting",
    attempts: 1,
    title: "Run command",
    summary: "Waiting for approval",
    arguments: null,
    facts: { approval: "pending" },
    error: null,
    startedAt: "2026-04-18T09:00:00.000Z",
    updatedAt: "2026-04-18T09:00:00.000Z",
    finishedAt: null,
  } satisfies RuntimeCommandRecord;
  const approvalStatePort = {
    createApprovalRequest: () => Effect.die("Unexpected createApprovalRequest call."),
    getApprovalRequest: () => Effect.succeed(approvalRecord),
    listOpenApprovalRequests: () => Effect.succeed([approvalRecord]),
    resolveApprovalRequest: (input) => {
      resolveApprovalRequestCalls.push({ requestId: input.requestId, status: input.status });
      return Effect.succeed(
        stateMutation(
          {
            ...approvalRecord,
            status: input.status,
            decisionReason: input.decisionReason ?? null,
            reviewer: input.reviewer,
            completedAt: "2026-04-18T09:01:00.000Z",
          },
          [
            {
              scope: "workspace",
              workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
              invalidation: { model: "runtimeApprovals", ids: [input.requestId] },
            },
          ],
        ),
      );
    },
  } satisfies RuntimeApprovalStatePortService;
  const commandStatePort = {
    createCommand: () => Effect.die("Unexpected createCommand call."),
    createOrReuseStreamingCommand: () =>
      Effect.die("Unexpected createOrReuseStreamingCommand call."),
    findCommandByToolCallId: () => Effect.succeed(commandRecord),
    findCommandById: () =>
      Effect.succeed(
        Object.hasOwn(options, "commandRecord") ? (options.commandRecord ?? null) : commandRecord,
      ),
    updateCommandArguments: () => Effect.die("Unexpected updateCommandArguments call."),
    startCommand: (input) => {
      startCommandCalls.push(input);
      return Effect.succeed(
        stateMutation(
          { ...commandRecord, status: "running", startedAt: "2026-04-18T09:01:00.000Z" },
          [
            {
              scope: "workspace",
              workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
              invalidation: { model: "commandInspector", ids: [input.commandId as CommandId] },
            },
          ],
        ),
      );
    },
    finishCommand: (input) => {
      finishCommandCalls.push({ commandId: input.commandId, status: input.status });
      return Effect.succeed(
        stateMutation(
          {
            ...commandRecord,
            status: input.status,
            summary: input.summary ?? commandRecord.summary,
            facts: input.facts ?? commandRecord.facts,
            finishedAt: "2026-04-18T09:01:00.000Z",
          },
          [
            {
              scope: "workspace",
              workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
              invalidation: { model: "commandInspector", ids: [input.commandId as CommandId] },
            },
          ],
        ),
      );
    },
    recordCommandEvent: () => Effect.die("Unexpected recordCommandEvent call."),
    recordStdinWrite: (input) => {
      recordStdinWriteCalls.push(input);
      return Effect.succeed(
        stateMutation(undefined, [
          {
            scope: "workspace",
            workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
            invalidation: { model: "commandInspector", ids: [input.commandId as CommandId] },
          },
        ]),
      );
    },
    hasCommandOutputEvent: () => Effect.succeed(false),
  } satisfies RuntimeCommandStatePortService;
  const sessionWaitStatePort = {
    setApprovalWait: () => Effect.die("Unexpected setApprovalWait call."),
    setUserWait: () => Effect.die("Unexpected setUserWait call."),
    clearSessionWait: (input) => {
      clearSessionWaitCalls.push(input);
      return Effect.succeed(
        stateMutation(undefined, [
          {
            scope: "workspace",
            workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
            invalidation: { model: "sessionNavigation" },
          },
        ]),
      );
    },
  } satisfies RuntimeSessionWaitStatePortService;
  const sourceStatePort = {
    readSourceVersion: () => Effect.succeed(null),
    recordSourceSave: (input) =>
      Effect.sync(() => {
        recordSourceSaveCalls.push(input);
        return stateMutation(
          {
            scope: input.scope,
            scopeKey:
              input.scope.kind === "workspace"
                ? `workspace:${input.scope.workspaceId}`
                : "app-global",
            sourceKind: input.sourceKind,
            sourceId: input.sourceId,
            path: input.path,
            sourceVersion: input.sourceVersion,
            fingerprint: input.fingerprint,
            diagnostics: input.diagnostics,
            sourceCommandId: input.sourceCommandId ?? null,
            createdAt: input.savedAt,
            updatedAt: input.savedAt,
            deletedAt: null,
          },
          [{ scope: "app", invalidation: { model: "extensions" } }],
        );
      }),
    recordSourceDelete: (input) =>
      Effect.succeed(
        stateMutation({
          scope: input.scope,
          scopeKey:
            input.scope.kind === "workspace"
              ? `workspace:${input.scope.workspaceId}`
              : "app-global",
          sourceKind: input.sourceKind,
          sourceId: input.sourceId,
          path: "/tmp/deleted-source" as AbsolutePath,
          sourceVersion: input.expectedSourceVersion ?? "deleted",
          fingerprint: "deleted",
          diagnostics: [],
          sourceCommandId: input.sourceCommandId ?? null,
          createdAt: input.deletedAt,
          updatedAt: input.deletedAt,
          deletedAt: input.deletedAt,
        }),
      ),
    recordSourceScan: (input) =>
      Effect.succeed(
        stateMutation({
          scope: input.scope,
          scopeKey: runtimeSourceScanScopeKey(input.scope),
          domain: input.domain,
          sourceFingerprint: input.sourceFingerprint,
          diagnostics: input.diagnostics,
          lastObservedPath: null,
          lastObservationKind: "scan",
          observedAt: input.scannedAt,
          createdAt: input.scannedAt,
          updatedAt: input.scannedAt,
        }),
      ),
    recordObservedSourceDeletion: (input) =>
      Effect.succeed(
        stateMutation({
          scope: input.scope,
          scopeKey: runtimeSourceScanScopeKey(input.scope),
          domain: input.domain,
          sourceFingerprint: input.sourceFingerprint ?? `unresolved:${input.domain}`,
          diagnostics: input.diagnostics,
          lastObservedPath: input.path,
          lastObservationKind: "deletion",
          observedAt: input.observedAt,
          createdAt: input.observedAt,
          updatedAt: input.observedAt,
        }),
      ),
    recordSourceDiagnostic: (input) =>
      Effect.succeed(
        stateMutation({
          scope: input.scope,
          scopeKey: runtimeSourceScanScopeKey(input.scope),
          domain: input.domain,
          sourceFingerprint: input.sourceFingerprint ?? `unresolved:${input.domain}`,
          diagnostics: [input.diagnostic],
          lastObservedPath: input.path ?? null,
          lastObservationKind: "diagnostic",
          observedAt: input.observedAt,
          createdAt: input.observedAt,
          updatedAt: input.observedAt,
        }),
      ),
  } satisfies RuntimeSourceStatePortService;
  const surfaceLifecycleStatePort = {
    createOrchestratorSurface: (input) =>
      Effect.sync(() => {
        createOrchestratorSurfaceCalls.push(input);
        return stateMutation(
          {
            workspaceSessionId: target.workspaceSessionId,
            surfacePiSessionId: target.surfacePiSessionId,
            target,
            created: "new" as const,
            stateRevision: 1 as StateRevision,
          },
          [
            {
              scope: "workspace",
              workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
              invalidation: { model: "surface", ids: [target.surfacePiSessionId] },
            },
          ],
        );
      }),
    openSurface: (input) =>
      Effect.sync(() => {
        openSurfaceCalls.push(input);
        return stateMutation(
          {
            workspaceSessionId: input.target.workspaceSessionId,
            surfacePiSessionId: input.target.surfacePiSessionId,
            target: input.target,
            stateRevision: 1 as StateRevision,
          },
          [
            {
              scope: "workspace",
              workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
              invalidation: { model: "surface", ids: [input.target.surfacePiSessionId] },
            },
          ],
        );
      }),
    closeSurface: (input) =>
      Effect.sync(() => {
        closeSurfaceCalls.push(input);
        return stateMutation(
          {
            target: input.target,
            lifecycle: "idle" as const,
          },
          [
            {
              scope: "workspace",
              workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
              invalidation: { model: "surface", ids: [input.target.surfacePiSessionId] },
            },
          ],
        );
      }),
  } satisfies RuntimeSurfaceLifecycleStatePortService;
  const workspaceStatePort = {
    acquireWorkspace: (input) =>
      Effect.sync(() => {
        acquireWorkspaceCalls.push(input);
        return stateMutation(
          {
            workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
            cwd: input.cwd,
            kind: "user" as const,
            acquired: "created" as const,
            readiness: "ready" as const,
            readinessDetail: { mode: "full" as const },
            stateRevision: 1 as StateRevision,
          },
          [
            {
              scope: "workspace",
              workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
              invalidation: { model: "sessionNavigation" },
            },
          ],
        );
      }),
    acquireDefaultWorkspace: (input) =>
      Effect.sync(() => {
        acquireDefaultWorkspaceCalls.push(input);
        return stateMutation(
          {
            workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
            cwd: "/tmp/runtime-adapter" as AbsolutePath,
            kind: "default" as const,
            acquired: "created" as const,
            readiness: "ready" as const,
            readinessDetail: { mode: "full" as const },
            stateRevision: 1 as StateRevision,
          },
          [
            {
              scope: "workspace",
              workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
              invalidation: { model: "sessionNavigation" },
            },
          ],
        );
      }),
    releaseWorkspace: (input) =>
      Effect.sync(() => {
        releaseWorkspaceCalls.push(input);
        return stateMutation(
          {
            workspaceId: input.workspaceId,
            released: true as const,
            remainingOwners: 0,
            lifecycle: "idle" as const,
          },
          [
            {
              scope: "workspace",
              workspaceId: input.workspaceId,
              invalidation: { model: "sessionNavigation" },
            },
          ],
        );
      }),
  } satisfies RuntimeWorkspaceStatePortService;

  const actorExtensionBindingStatePort = {
    readRuntimePromptBinding: () => Effect.die("Unexpected runtime prompt binding read."),
    updateActorExtensionBinding: () => Effect.die("Unexpected actor binding update."),
    setActorExtensionBinding: () => Effect.die("Unexpected actor binding set."),
  } satisfies RuntimeActorExtensionBindingStatePortService;

  const threadStatePort = {
    ensureHandlerThreadRunnable: () => Effect.die("Unexpected handler thread runnable update."),
    startHandlerThreads: () => Effect.die("Unexpected handler thread start."),
  } satisfies RuntimeThreadStatePortService;
  const turnStatePort = {
    startTurn: () => Effect.die("Unexpected runtime turn start."),
    setTurnDecision: () => Effect.die("Unexpected runtime turn decision."),
    finishTurn: () => Effect.die("Unexpected runtime turn finish."),
  } satisfies RuntimeTurnStatePortService;
  const episodeStatePort = {
    recordHandlerThreadEpisode: () => Effect.die("Unexpected handler thread episode record."),
  } satisfies RuntimeEpisodeStatePortService;

  const catalog = {
    resolvePromptDefaultsForTarget: () => ({
      provider: "openai",
      model: "gpt-4o",
      reasoningEffort: "medium",
    }),
    getRuntimeApprovalStatePort: () => approvalStatePort,
    getRuntimeActorExtensionBindingStatePort: () => actorExtensionBindingStatePort,
    getRuntimeCommandStatePort: () => commandStatePort,
    getRuntimeQueueStatePort: () => queueStatePort,
    getRuntimeRequestStatePort: () => requestStatePort,
    getRuntimeSessionWaitStatePort: () => sessionWaitStatePort,
    getRuntimeThreadStatePort: () => threadStatePort,
    getRuntimeTurnStatePort: () => turnStatePort,
    getRuntimeEpisodeStatePort: () => episodeStatePort,
    getRuntimeSourceStatePort: () => sourceStatePort,
    getRuntimeSurfaceLifecycleStatePort: () => surfaceLifecycleStatePort,
    getRuntimeWorkspaceStatePort: () => workspaceStatePort,
    getRuntimeGeneratedPackageStatePort: () => generatedPackageStatePort,
    getSandboxPolicySource: () => options.sandboxPolicySource ?? testSandboxPolicySource(),
    wakeRuntimeSurfaceQueue: async (input) => {
      wakeRuntimeSurfaceQueueCalls.push(input);
    },
    cancelPrompt: async (input) => {
      cancelPromptCalls.push(input);
    },
    cancelActivePrompt: async (input) => {
      cancelActivePromptCalls.push(input);
    },
  } satisfies TestCatalog;

  const appLogWritePort = {
    append: () =>
      Effect.succeed({
        value: { appLogEntryId: "app_log_runtime_adapter_test" as AppLogEntryId },
        afterCommit: [],
      }),
  } satisfies RuntimePort["appLogWritePort"];

  const dependencies = {
    ensureUsableProviderAuth: async () =>
      Object.hasOwn(options, "authToken") ? options.authToken : "test-api-key",
    getProviderAuthUnavailableMessage: (provider) => `${provider} auth is unavailable.`,
  } satisfies CatalogBackedRuntimeDependencies;
  const generatedContextRefreshHost =
    options.generatedContextRefreshHost ?? defaultUnexpectedGeneratedContextRefreshHost();
  const sourceInvalidationScan =
    options.sourceInvalidationScan ??
    ({
      classifyHint: () => Effect.succeed("scan" as const),
      listAcquiredWorkspaceIds: () =>
        Effect.succeed(["workspace_runtime_adapter_01" as WorkspaceId]),
      requestScan: (input) =>
        Effect.sync(() => {
          sourceInvalidationScanRequests.push(input);
        }),
      reconcile: (input) =>
        Effect.sync(() => {
          sourceInvalidationReconciliations.push(input);
          return null;
        }),
    } satisfies RuntimePort["sourceInvalidationScan"]);
  const commandStdin =
    options.commandStdin ??
    ({
      writeStdin: (input) =>
        Effect.sync(() => {
          commandStdinCalls.push(input);
          return {
            commandId: input.commandId,
            status: "accepted" as const,
            acceptedBytes: Buffer.byteLength(input.text, "utf8"),
          };
        }),
    } satisfies RuntimeCommandStdinPort);
  const commandControl =
    options.commandControl ??
    ({
      cancel: (input) =>
        Effect.sync(() => {
          commandControlCalls.push(input);
          return {
            commandId: input.commandId,
            status: "cancelled" as const,
          };
        }),
    } satisfies RuntimeCommandControlPort);

  const runtime = await createCatalogBackedRuntime(
    {
      sourceRoots:
        options.sourceRoots ??
        ({
          extensionsRoot: mkdtempSync(
            join(tmpdir(), "svvy-runtime-adapter-extensions-"),
          ) as AbsolutePath,
          workflowsSourceRoot: mkdtempSync(
            join(tmpdir(), "svvy-runtime-adapter-workflows-"),
          ) as AbsolutePath,
        } satisfies RuntimePort["sourceRoots"]),
      generatedPackageRoots: options.generatedPackageRoots ?? {
        extensionsPackageRoot: mkdtempSync(
          join(tmpdir(), "svvy-runtime-adapter-generated-extensions-"),
        ) as AbsolutePath,
        workflowsPackageRoot: mkdtempSync(
          join(tmpdir(), "svvy-runtime-adapter-generated-workflows-"),
        ) as AbsolutePath,
        coreTypeContractPackageRoot: mkdtempSync(
          join(tmpdir(), "svvy-runtime-adapter-generated-core-type-contract-"),
        ) as AbsolutePath,
      },
      extensionStatePort: options.extensionStatePort ?? {
        records: {
          readSourceFingerprint: () => Effect.succeed(null),
        },
        dependencies: {
          isApproved: () => Effect.succeed(false),
          readReadiness: () => Effect.succeed(null),
        },
      },
      generatedPackageLinkPath:
        options.generatedPackageLinkPath ??
        (async ({ packageName, workspaceId }) =>
          join(
            tmpdir(),
            "svvy-runtime-adapter-links",
            workspaceId,
            packageName === "@svvyx/workflows" ? "workflows" : "extensions",
          ) as AbsolutePath),
      catalog,
      generatedContextRefreshHost,
      generatedPackageRefreshHost:
        options.generatedPackageRefreshHost ?? defaultGeneratedPackageRefreshHost(),
      sourceInvalidationScan,
      commandStdin,
      commandControl,
      appLogWritePort,
      sandboxHostSupport: createTestSandboxHostSupport(),
    },
    dependencies,
    defaultRuntimeLayerConfig,
  );
  const runtimeEvents = await runtime.facade.events({
    includeAppEvents: true,
    afterSequence: 0 as RuntimeEventSequence,
  });
  const eventPump = (async () => {
    for await (const event of runtimeEvents) {
      publishedStateInvalidations.push(runtimeEventToStateInvalidationDescriptors(event));
    }
  })();

  return {
    ...runtime,
    dispose: async () => {
      await runtimeEvents.close();
      await eventPump.catch(() => {});
      await runtime.dispose();
    },
    waitForPublishedStateInvalidations: async (count: number) => {
      const deadline = Date.now() + 1000;
      while (publishedStateInvalidations.length < count && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
    calls: {
      acceptSubmittedSurfaceMessage: acceptSubmittedSurfaceMessageCalls,
      enqueueSurfaceMessage: enqueueSurfaceMessageCalls,
      wakeRuntimeSurfaceQueue: wakeRuntimeSurfaceQueueCalls,
      cancelActivePrompt: cancelActivePromptCalls,
      cancelPrompt: cancelPromptCalls,
      cancelSurfaceMessage: cancelSurfaceMessageCalls,
      markSurfaceMessageQueued: markSurfaceMessageQueuedCalls,
      answerRequestInput: answerRequestInputCalls,
      setRequestInputTimerPaused: setRequestInputTimerPausedCalls,
      resolveApprovalRequest: resolveApprovalRequestCalls,
      startCommand: startCommandCalls,
      finishCommand: finishCommandCalls,
      recordStdinWrite: recordStdinWriteCalls,
      commandStdin: commandStdinCalls,
      commandControl: commandControlCalls,
      clearSessionWait: clearSessionWaitCalls,
      acquireWorkspace: acquireWorkspaceCalls,
      acquireDefaultWorkspace: acquireDefaultWorkspaceCalls,
      releaseWorkspace: releaseWorkspaceCalls,
      createOrchestratorSurface: createOrchestratorSurfaceCalls,
      openSurface: openSurfaceCalls,
      closeSurface: closeSurfaceCalls,
      publishedStateInvalidations,
      recordSourceSave: recordSourceSaveCalls,
      sourceInvalidationScanRequests,
      sourceInvalidationReconciliations,
    },
  };
}

function runtimeEventToStateInvalidationDescriptors(
  event: RuntimeEvent,
): StateInvalidationDescriptor[] {
  if (event.type === "workspace_read_model.changed") {
    return [
      {
        scope: "workspace",
        workspaceId: event.workspaceId,
        invalidation: event.invalidation,
      },
    ];
  }
  if (event.type === "app_read_model.changed") {
    return [
      {
        scope: "app",
        invalidation: event.invalidation,
      },
    ];
  }
  return [];
}

function defaultUnexpectedGeneratedContextRefreshHost(): RuntimeGeneratedContextRefreshHost {
  return {
    refresh: async () => {
      throw new Error("Unexpected generated-context refresh call.");
    },
  };
}

function defaultGeneratedPackageRefreshHost(
  calls: string[] = [],
): RuntimeGeneratedPackageRefreshHost {
  return {
    listAcquiredWorkspaceIds: () =>
      Effect.succeed(["workspace_runtime_adapter_generated_01" as WorkspaceId]),
    listRecoverableWorkspaceIds: () => Effect.succeed([]),
    materializeCoreTypeContractPackage: () =>
      Effect.sync(() => {
        calls.push("materialize-core-type-contract");
      }),
    now: () => Effect.succeed("2026-04-18T09:00:00.000Z" as IsoDateTimeString),
    workspaceLinkFileHost: fakeWorkspaceLinkFileHost(
      new Map([
        ["/workspace/.smithers", { kind: "directory" }],
        ["/generated/workflows", { kind: "directory" }],
        ["/generated/extensions", { kind: "directory" }],
      ]),
      calls,
    ),
  };
}

describe("catalog-backed runtime service adapter", () => {
  it("keeps runtime construction in the catalog-free adapter seam", () => {
    const source = readFileSync(join(import.meta.dir, "runtime-service-adapter.ts"), "utf8");
    const wrapperStart = source.indexOf("export async function createCatalogBackedRuntime(");
    const adapterStart = source.indexOf("export async function createRuntimeServiceAdapter(");
    const adapterEnd = source.indexOf("function catalogBackedRuntimePort(", adapterStart);
    const wrapperSource = source.slice(wrapperStart, adapterStart);
    const adapterSource = source.slice(adapterStart, adapterEnd);

    expect(wrapperStart).toBeGreaterThanOrEqual(0);
    expect(adapterStart).toBeGreaterThan(wrapperStart);
    expect(adapterEnd).toBeGreaterThan(adapterStart);
    expect(wrapperSource).toContain("catalogBackedRuntimePort(port)");
    expect(adapterSource).toContain("ManagedRuntime.make(");
    expect(adapterSource).toContain("await managedRuntime.context();");
    expect(adapterSource).toContain("await awaitRuntimeStartupReadiness(managedRuntime);");
    expect(adapterSource).toContain("createRuntimeFacade(managedRuntime)");
    expect(adapterSource).not.toContain("WorkspaceSessionCatalog");
    expect(adapterSource).not.toContain("port.catalog");
  });

  it("routes workspace and surface lifecycle facade calls through runtime state ports", async () => {
    const runtime = await createHarness();
    const owner = {
      ownerId: "runtime_adapter_owner_01" as RuntimeOwnerId,
      kind: "test",
    } as const;
    const acquireInput = {
      cwd: "/tmp/runtime-adapter-user-workspace" as AbsolutePath,
      owner,
      openReason: "test",
    } satisfies AcquireWorkspaceInput;
    const acquireDefaultInput = {
      owner,
      openReason: "test",
    } satisfies AcquireDefaultWorkspaceInput;
    const releaseInput = {
      workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
      owner,
      releaseReason: "test",
    } satisfies ReleaseWorkspaceInput;
    const createSurfaceInput = {
      workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
      title: "Runtime adapter lifecycle test",
    } satisfies CreateOrchestratorSurfaceInput;
    const openSurfaceInput = {
      workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
      target,
    } satisfies OpenSurfaceInput;
    const closeSurfaceInput = {
      workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
      target,
      closeReason: "test",
    } satisfies CloseSurfaceInput;

    try {
      await expect(runtime.facade.workspaces.acquire(acquireInput)).resolves.toEqual({
        workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
        cwd: acquireInput.cwd,
        kind: "user",
        acquired: "created",
        readiness: "ready",
        readinessDetail: { mode: "full" },
        stateRevision: 1 as StateRevision,
      });
      await expect(runtime.facade.workspaces.acquireDefault(acquireDefaultInput)).resolves.toEqual({
        workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
        cwd: "/tmp/runtime-adapter" as AbsolutePath,
        kind: "default",
        acquired: "created",
        readiness: "ready",
        readinessDetail: { mode: "full" },
        stateRevision: 1 as StateRevision,
      });
      await expect(runtime.facade.workspaces.release(releaseInput)).resolves.toEqual({
        workspaceId: releaseInput.workspaceId,
        released: true,
        remainingOwners: 0,
        lifecycle: "idle",
      });
      await expect(runtime.facade.surfaces.createOrchestrator(createSurfaceInput)).resolves.toEqual(
        {
          workspaceSessionId: target.workspaceSessionId,
          surfacePiSessionId: target.surfacePiSessionId,
          target,
          created: "new",
          stateRevision: 1 as StateRevision,
        },
      );
      await expect(runtime.facade.surfaces.open(openSurfaceInput)).resolves.toEqual({
        workspaceSessionId: target.workspaceSessionId,
        surfacePiSessionId: target.surfacePiSessionId,
        target,
        stateRevision: 1 as StateRevision,
      });
      await expect(runtime.facade.surfaces.close(closeSurfaceInput)).resolves.toEqual({
        target,
        lifecycle: "idle",
      });

      expect(runtime.calls.acquireWorkspace).toEqual([acquireInput]);
      expect(runtime.calls.acquireDefaultWorkspace).toEqual([acquireDefaultInput]);
      expect(runtime.calls.releaseWorkspace).toEqual([releaseInput]);
      expect(runtime.calls.createOrchestratorSurface).toEqual([createSurfaceInput]);
      expect(runtime.calls.openSurface).toEqual([openSurfaceInput]);
      expect(runtime.calls.closeSurface).toEqual([closeSurfaceInput]);
      await runtime.waitForPublishedStateInvalidations(9);
      expect(runtime.calls.publishedStateInvalidations.length).toBeGreaterThanOrEqual(9);
      expect(runtime.calls.publishedStateInvalidations).toContainEqual([
        {
          scope: "workspace",
          workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
          invalidation: { model: "sessionNavigation" },
        },
      ]);
      expect(runtime.calls.publishedStateInvalidations).toContainEqual([
        {
          scope: "workspace",
          workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
          invalidation: { model: "surface", ids: [target.surfacePiSessionId] },
        },
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("submits enqueue-and-run messages through the facade, queues, and wakes the surface queue", async () => {
    const runtime = await createHarness({
      queuedMessageId: "queue_runtime_adapter_run" as QueueItemId,
    });

    try {
      await expect(runtime.facade.messages.submit(submitInput("enqueue-and-run"))).resolves.toEqual(
        {
          queuedMessageId: "queue_runtime_adapter_run" as QueueItemId,
          target,
          status: "queued",
          receipt: {
            clientRequestId: "client_request_01" as RuntimeClientRequestId,
            outcome: "accepted",
            acceptedAt: "2026-04-18T09:00:00.000Z" as SubmitMessageResult["receipt"]["acceptedAt"],
            stateRevision: 1 as SubmitMessageResult["receipt"]["stateRevision"],
          },
        },
      );
      expect(runtime.calls.acceptSubmittedSurfaceMessage).toHaveLength(1);
      expect(runtime.calls.acceptSubmittedSurfaceMessage[0]).toMatchObject({
        target,
      });
      expect(
        JSON.parse(runtime.calls.acceptSubmittedSurfaceMessage[0]?.messageJson ?? "{}"),
      ).toEqual(submitInput("enqueue-and-run").message);
      expect(
        JSON.parse(runtime.calls.acceptSubmittedSurfaceMessage[0]?.payloadJson ?? "{}"),
      ).toMatchObject({
        clientSubmission: {
          source: "test" as RuntimeClientSubmissionSource,
          clientRequestId: "client_request_01" as RuntimeClientRequestId,
        },
        telemetry: { messageCount: 1, userMessageCount: 1, textBlockCount: 1, imageCount: 0 },
      });
      expect(runtime.calls.wakeRuntimeSurfaceQueue).toEqual([
        { target, reason: "message-submitted" },
      ]);
      await runtime.waitForPublishedStateInvalidations(1);
      expect(runtime.calls.publishedStateInvalidations).toEqual([
        [
          {
            scope: "workspace",
            workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
            invalidation: { model: "surface", ids: [target.surfacePiSessionId] },
          },
        ],
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("submits queue-only messages through the facade without waking the surface queue", async () => {
    const runtime = await createHarness({
      queuedMessageId: "queue_runtime_adapter_only" as QueueItemId,
    });

    try {
      await expect(runtime.facade.messages.submit(submitInput("queue-only"))).resolves.toEqual({
        queuedMessageId: "queue_runtime_adapter_only" as QueueItemId,
        target,
        status: "queued",
        receipt: {
          clientRequestId: "client_request_01" as RuntimeClientRequestId,
          outcome: "accepted",
          acceptedAt: "2026-04-18T09:00:00.000Z" as SubmitMessageResult["receipt"]["acceptedAt"],
          stateRevision: 1 as SubmitMessageResult["receipt"]["stateRevision"],
        },
      });
      expect(runtime.calls.acceptSubmittedSurfaceMessage).toHaveLength(1);
      expect(runtime.calls.wakeRuntimeSurfaceQueue).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects auth failures with a RuntimeContractError before sending to the catalog", async () => {
    const runtime = await createHarness({ authToken: undefined });

    try {
      await expect(
        runtime.facade.messages.submit(submitInput("enqueue-and-run")),
      ).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
        error: { _tag: "RuntimeContractError" },
      });
      expect(runtime.calls.acceptSubmittedSurfaceMessage).toEqual([]);
      expect(runtime.calls.enqueueSurfaceMessage).toEqual([]);
      expect(runtime.calls.wakeRuntimeSurfaceQueue).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects invalid facade submissions before auth lookup or catalog dispatch", async () => {
    const runtime = await createHarness();

    try {
      await expect(
        runtime.facade.messages.submit({
          ...submitInput("enqueue-and-run"),
          messages: [{ role: "user", content: "renderer transcript arrays are not accepted" }],
          systemPrompt: "renderer prompt",
        } as unknown as SubmitMessageInput),
      ).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
        error: { _tag: "RuntimeContractError" },
      });
      expect(runtime.calls.acceptSubmittedSurfaceMessage).toEqual([]);
      expect(runtime.calls.enqueueSurfaceMessage).toEqual([]);
      expect(runtime.calls.wakeRuntimeSurfaceQueue).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });

  it("delegates all-for-surface prompt aborts to the catalog", async () => {
    const runtime = await createHarness();
    const input = {
      target: handlerTarget,
      mode: "all-for-surface",
      reason: "test cancellation",
    } satisfies AbortPromptInput;

    try {
      await expect(runtime.facade.messages.abort(input)).resolves.toBeUndefined();
      expect(runtime.calls.cancelPrompt).toEqual([handlerTarget]);
      expect(runtime.calls.cancelActivePrompt).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });

  it("cancels queued prompt aborts through runtime state and publishes invalidations", async () => {
    const runtime = await createHarness({
      queuedMessageId: "queue_runtime_adapter_abort" as QueueItemId,
    });
    const input = {
      target: handlerTarget,
      mode: "queued",
      queuedMessageId: "queue_runtime_adapter_abort" as QueueItemId,
      reason: "test queued cancellation",
    } satisfies AbortPromptInput;

    try {
      await expect(runtime.facade.messages.abort(input)).resolves.toBeUndefined();
      expect(runtime.calls.cancelSurfaceMessage).toEqual([
        {
          id: "queue_runtime_adapter_abort" as QueueItemId,
        },
      ]);
      expect(runtime.calls.publishedStateInvalidations).toEqual([
        [
          {
            scope: "workspace",
            workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
            invalidation: {
              model: "surface",
              ids: [handlerTarget.surfacePiSessionId],
            },
          },
        ],
      ]);
      expect(runtime.calls.cancelPrompt).toEqual([]);
      expect(runtime.calls.cancelActivePrompt).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });

  it("delegates active-turn prompt aborts to the active-turn catalog path", async () => {
    const runtime = await createHarness();
    const input = {
      target: handlerTarget,
      mode: "active-turn",
      turnId: "turn_runtime_adapter_abort" as TurnId,
      reason: "test active cancellation",
    } satisfies AbortPromptInput;

    try {
      await expect(runtime.facade.messages.abort(input)).resolves.toBeUndefined();
      expect(runtime.calls.cancelActivePrompt).toEqual([
        {
          target: handlerTarget,
          turnId: "turn_runtime_adapter_abort",
        },
      ]);
      expect(runtime.calls.cancelPrompt).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects active-turn prompt aborts without a turn id before catalog dispatch", async () => {
    const runtime = await createHarness();
    const input = {
      target: handlerTarget,
      mode: "active-turn",
      reason: "missing active turn",
    } satisfies AbortPromptInput;

    try {
      await expect(runtime.facade.messages.abort(input)).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
        error: {
          _tag: "RuntimeContractError",
          reason: "invalid-input",
          message: "Active-turn prompt abort requires turnId.",
        },
      });
      expect(runtime.calls.cancelActivePrompt).toEqual([]);
      expect(runtime.calls.cancelPrompt).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });

  it("steers queued messages through runtime state and wakes the surface queue after commit", async () => {
    const runtime = await createHarness({
      queuedMessageId: "queue_runtime_adapter_steer" as QueueItemId,
    });
    const input = {
      target: handlerTarget,
      queuedMessageId: "queue_runtime_adapter_steer" as QueueItemId,
    } satisfies SteerQueuedMessageInput;

    try {
      await expect(runtime.facade.queues.steer(input)).resolves.toBeUndefined();
      expect(runtime.calls.markSurfaceMessageQueued).toEqual([
        {
          id: "queue_runtime_adapter_steer" as QueueItemId,
          position: "front",
        },
      ]);
      expect(runtime.calls.publishedStateInvalidations).toEqual([
        [
          {
            scope: "workspace",
            workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
            invalidation: {
              model: "surface",
              ids: [handlerTarget.surfacePiSessionId],
            },
          },
        ],
      ]);
      expect(runtime.calls.wakeRuntimeSurfaceQueue).toEqual([
        {
          target: handlerTarget,
          reason: "queue-steered",
        },
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("records request-input answers and publishes invalidations", async () => {
    const runtime = await createHarness();
    const input = {
      surfacePiSessionId: target.surfacePiSessionId,
      requestId: "rui_runtime_adapter_01" as RequestInputRequestId,
      questionId: "ruiq_runtime_adapter_01" as RequestInputQuestionId,
      answer: { kind: "option", optionId: "ruio_runtime_adapter_01" as RequestInputOptionId },
      delivery: "enqueue-and-run",
      clientSubmission: {
        correlationId: "runtime-adapter-answer-01" as RuntimeClientCorrelationId,
        source: "test" as RuntimeClientSubmissionSource,
      },
    } satisfies AnswerRequestInputInput;

    try {
      await expect(runtime.facade.requestInput.answer(input)).resolves.toEqual({
        requestId: "rui_runtime_adapter_01" as RequestInputRequestId,
        questionId: "ruiq_runtime_adapter_01" as RequestInputQuestionId,
        status: "recorded",
        delivery: {
          kind: "nonblocking-queued",
          queuedItemId: "queue_runtime_adapter_answer_01" as QueueItemId,
        },
      });
      expect(runtime.calls.answerRequestInput).toEqual([input]);
      expect(runtime.calls.publishedStateInvalidations).toEqual([
        [
          {
            scope: "workspace",
            workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
            invalidation: {
              model: "requestInput",
              ids: ["rui_runtime_adapter_01" as RequestInputRequestId],
            },
          },
        ],
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("sets request-input timer pause and publishes invalidations", async () => {
    const runtime = await createHarness();
    const input = {
      surfacePiSessionId: target.surfacePiSessionId,
      requestId: "rui_runtime_adapter_timer_01" as RequestInputRequestId,
      paused: true,
      clientSubmission: {
        correlationId: "runtime-adapter-timer-01" as RuntimeClientCorrelationId,
        source: "test" as RuntimeClientSubmissionSource,
      },
    } satisfies SetRequestInputTimerPausedInput;

    try {
      await expect(runtime.facade.requestInput.setTimerPaused(input)).resolves.toEqual({
        requestId: "rui_runtime_adapter_timer_01" as RequestInputRequestId,
      });
      expect(runtime.calls.setRequestInputTimerPaused).toEqual([input]);
      expect(runtime.calls.publishedStateInvalidations).toEqual([
        [
          {
            scope: "workspace",
            workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
            invalidation: {
              model: "requestInput",
              ids: ["rui_runtime_adapter_timer_01" as RequestInputRequestId],
            },
          },
        ],
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("cancels command ids through runtime command control and records terminal command facts", async () => {
    const runtime = await createHarness();

    try {
      await expect(
        runtime.facade.commands.cancel({
          commandId: "cmd_runtime_adapter_approval_01" as CommandId,
          reason: "test cancellation",
          clientSubmission: {
            source: "test" as RuntimeClientSubmissionSource,
            clientRequestId: "cancel_request_01" as RuntimeClientRequestId,
          },
        }),
      ).resolves.toEqual({
        commandId: "cmd_runtime_adapter_approval_01" as CommandId,
        status: "cancelled",
      });
      expect(runtime.calls.commandControl).toEqual([
        {
          commandId: "cmd_runtime_adapter_approval_01" as CommandId,
          reason: "test cancellation",
          clientSubmission: {
            source: "test" as RuntimeClientSubmissionSource,
            clientRequestId: "cancel_request_01" as RuntimeClientRequestId,
          },
        },
      ]);
      expect(runtime.calls.finishCommand).toEqual([
        { commandId: "cmd_runtime_adapter_approval_01", status: "cancelled" },
      ]);
      expect(runtime.calls.publishedStateInvalidations).toEqual([
        [
          {
            scope: "workspace",
            workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
            invalidation: {
              model: "commandInspector",
              ids: ["cmd_runtime_adapter_approval_01" as CommandId],
            },
          },
        ],
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("writes command stdin through the runtime command-id path and records the durable receipt", async () => {
    const runtime = await createHarness();

    try {
      await expect(
        runtime.facade.commands.writeStdin({
          commandId: "cmd_runtime_adapter_approval_01" as CommandId,
          text: "yes\n",
          clientSubmission: {
            source: "test" as RuntimeClientSubmissionSource,
            clientRequestId: "stdin_request_01" as RuntimeClientRequestId,
          },
        }),
      ).resolves.toEqual({
        commandId: "cmd_runtime_adapter_approval_01" as CommandId,
        status: "accepted",
        acceptedBytes: 4,
      });
      expect(runtime.calls.commandStdin).toEqual([
        {
          commandId: "cmd_runtime_adapter_approval_01" as CommandId,
          text: "yes\n",
          clientSubmission: {
            source: "test" as RuntimeClientSubmissionSource,
            clientRequestId: "stdin_request_01" as RuntimeClientRequestId,
          },
        },
      ]);
      expect(runtime.calls.recordStdinWrite).toEqual([
        {
          sessionId: "session_runtime_adapter_01" as WorkspaceSessionId,
          commandId: "cmd_runtime_adapter_approval_01" as CommandId,
          text: "yes\n",
          acceptedBytes: 4,
        },
      ]);
      expect(runtime.calls.publishedStateInvalidations).toEqual([
        [
          {
            scope: "workspace",
            workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
            invalidation: {
              model: "commandInspector",
              ids: ["cmd_runtime_adapter_approval_01" as CommandId],
            },
          },
        ],
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("returns already_terminal for terminal durable commands without touching live stdin", async () => {
    const runtime = await createHarness({
      commandRecord: {
        id: "cmd_terminal_01" as CommandId,
        sessionId: "session_runtime_adapter_01" as WorkspaceSessionId,
        turnId: "turn_runtime_adapter_01" as TurnId,
        workflowTaskAttemptId: null,
        surfacePiSessionId: "surface_runtime_adapter_01" as SurfacePiSessionId,
        threadId: null,
        workflowRunId: null,
        parentCommandId: null,
        toolName: "exec_command",
        executor: "runtime",
        visibility: "surface",
        status: "succeeded",
        attempts: 1,
        title: "Run command",
        summary: "Done",
        arguments: null,
        facts: null,
        error: null,
        startedAt: "2026-04-18T09:00:00.000Z",
        updatedAt: "2026-04-18T09:01:00.000Z",
        finishedAt: "2026-04-18T09:01:00.000Z",
      },
    });

    try {
      await expect(
        runtime.facade.commands.writeStdin({
          commandId: "cmd_terminal_01" as CommandId,
          text: "ignored\n",
        }),
      ).resolves.toEqual({
        commandId: "cmd_terminal_01" as CommandId,
        status: "already_terminal",
      });
      expect(runtime.calls.commandStdin).toEqual([]);
      expect(runtime.calls.recordStdinWrite).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });

  it("rejects command stdin for unknown durable commands", async () => {
    const runtime = await createHarness({ commandRecord: null });

    try {
      await expect(
        runtime.facade.commands.writeStdin({
          commandId: "cmd_missing_01" as CommandId,
          text: "ignored\n",
        }),
      ).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
        error: {
          _tag: "RuntimeContractError",
          reason: "target-not-found",
        },
      });
      expect(runtime.calls.commandStdin).toEqual([]);
      expect(runtime.calls.recordStdinWrite).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });

  it("answers runtime approvals through state ports, events, command state, wait state, and the runtime-owned waiter", async () => {
    const runtime = await createHarness();

    try {
      await expect(
        runtime.facade.approvals.answer({
          approvalId: "approval_runtime_adapter_01" as RuntimeApprovalId,
          decision: "approved",
          reason: "Looks correct.",
        }),
      ).resolves.toEqual({
        approvalId: "approval_runtime_adapter_01" as RuntimeApprovalId,
        commandId: "cmd_runtime_adapter_approval_01" as CommandId,
        status: "approved",
      });

      expect(runtime.calls.resolveApprovalRequest).toEqual([
        {
          requestId: "approval_runtime_adapter_01" as RuntimeApprovalId,
          status: "approved",
        },
      ]);
      expect(runtime.calls.startCommand).toEqual([
        { commandId: "cmd_runtime_adapter_approval_01" },
      ]);
      expect(runtime.calls.finishCommand).toEqual([]);
      expect(runtime.calls.clearSessionWait).toEqual([{ sessionId: "session_runtime_adapter_01" }]);
      expect(runtime.calls.publishedStateInvalidations).toEqual([
        [
          {
            scope: "workspace",
            workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
            invalidation: {
              model: "runtimeApprovals",
              ids: ["approval_runtime_adapter_01" as RuntimeApprovalId],
            },
          },
        ],
        [
          {
            scope: "workspace",
            workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
            invalidation: {
              model: "commandInspector",
              ids: ["cmd_runtime_adapter_approval_01" as CommandId],
            },
          },
        ],
        [
          {
            scope: "workspace",
            workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
            invalidation: {
              model: "sessionNavigation",
            },
          },
        ],
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("opens and saves source edits through Extensions.sources and RuntimeSourceStatePort", async () => {
    const sourceRoots = {
      extensionsRoot: mkdtempSync(
        join(tmpdir(), "svvy-runtime-adapter-extensions-"),
      ) as AbsolutePath,
      workflowsSourceRoot: mkdtempSync(
        join(tmpdir(), "svvy-runtime-adapter-workflows-"),
      ) as AbsolutePath,
    } satisfies RuntimePort["sourceRoots"];
    const runtime = await createHarness({ sourceRoots });

    try {
      const session = await runtime.facade.sourceEdits.open({
        sourceKind: "builtin-extension",
        sourceId: "base-common",
      });
      expect(session).toMatchObject({
        sourceKind: "builtin-extension",
        sourceId: "base-common",
        text: "Load Base Common only when shared svvy operating rules are missing.\n",
        diagnostics: [],
      });
      expect(session.path).toBe(
        join(
          sourceRoots.extensionsRoot as string,
          "sources",
          "builtin",
          "base-common",
          "instructions",
          "minimal.md",
        ) as AbsolutePath,
      );

      const saveResult = await runtime.facade.sourceEdits.save({
        sourceKind: "builtin-extension",
        sourceId: "base-common",
        expectedSourceVersion: session.sourceVersion,
        text: "Load Base Common when shared svvy rules are needed.\n",
        saveMode: "compare-and-swap",
        sourceCommandId: "cmd_source_save_01" as CommandId,
      });

      expect(saveResult).toMatchObject({
        status: "saved",
        diagnostics: [],
        reconcileRequired: true,
      });
      if (saveResult.status !== "saved") {
        throw new Error("Expected source edit save to succeed.");
      }
      expect(readFileSync(session.path, "utf8")).toBe(
        "Load Base Common when shared svvy rules are needed.\n",
      );
      expect(runtime.calls.recordSourceSave).toHaveLength(1);
      expect(runtime.calls.recordSourceSave[0]).toMatchObject({
        sourceKind: "builtin-extension",
        sourceId: "base-common",
        path: session.path,
        previousSourceVersion: null,
        sourceCommandId: "cmd_source_save_01",
      });
      expect(runtime.calls.recordSourceSave[0]?.sourceVersion).toBe(saveResult.sourceVersion);
      expect(runtime.calls.recordSourceSave[0]?.fingerprint).toBe(saveResult.fingerprint);
      await runtime.waitForPublishedStateInvalidations(1);
      expect(runtime.calls.publishedStateInvalidations).toEqual([
        [{ scope: "app", invalidation: { model: "extensions" } }],
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("routes source invalidation scans and generated-context refresh through separate runtime seams", async () => {
    const contextRefreshes: RefreshGeneratedContextRequest[] = [];
    const generatedPackageHostCalls: string[] = [];
    const sourceInvalidationScanRequests: SourceReconcileRequest[] = [];
    const sourceInvalidationReconciliations: SourceReconcileRequest[] = [];
    const packageRefreshResult = {
      scope: "app-global",
      packages: [{ packageName: "@svvyx/extensions", action: "written" }],
      workspaceLinks: [],
      recoveryWorkIds: [],
    } satisfies Partial<GeneratedPackagesRefreshResult>;
    const runtime = await createHarness({
      generatedContextRefreshHost: {
        refresh: async (input) => {
          contextRefreshes.push(input);
        },
      },
      generatedPackageRefreshHost: defaultGeneratedPackageRefreshHost(generatedPackageHostCalls),
      sourceInvalidationScan: {
        classifyHint: () => Effect.succeed("scan" as const),
        listAcquiredWorkspaceIds: () =>
          Effect.succeed(["workspace_runtime_adapter_01" as WorkspaceId]),
        requestScan: (input) =>
          Effect.sync(() => {
            sourceInvalidationScanRequests.push(input);
          }),
        reconcile: (input) =>
          Effect.sync(() => {
            sourceInvalidationReconciliations.push(input);
            return {
              domains: [...(input.domains ?? [])],
              reason: input.reason,
              sourceFingerprints: {
                extensions: "fingerprint_extensions_01",
                workflows: "fingerprint_workflows_01",
                external_instructions: "fingerprint_external_01",
                host_snippets: "fingerprint_snippets_01",
              },
              afterCommit: [{ scope: "app", invalidation: { model: "extensions" } }],
            };
          }),
      },
    });
    const changedPath = "/tmp/svvy/extensions/web/index.ts" as AbsolutePath;

    try {
      await expect(
        runtime.facade.sourceInvalidation.hint({
          scope: { kind: "app-global" },
          domain: "external_instructions",
          path: changedPath,
        }),
      ).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
        error: { _tag: "RuntimeContractError" },
      });
      await expect(
        runtime.facade.sourceInvalidation.reconcile({
          scope: { kind: "workspace", workspaceId: "workspace_runtime_adapter_01" as WorkspaceId },
          domains: ["extensions"],
          reason: "manual",
        }),
      ).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
        error: { _tag: "RuntimeContractError" },
      });

      const hint = {
        scope: { kind: "app-global" },
        domain: "extensions",
        path: changedPath,
        observedAt: "2026-06-19T08:00:00.000Z",
      } as SourceInvalidationHint;
      await expect(runtime.facade.sourceInvalidation.hint(hint)).resolves.toBeUndefined();
      await expect(
        runtime.facade.sourceInvalidation.reconcile({
          scope: { kind: "workspace", workspaceId: "workspace_runtime_adapter_01" as WorkspaceId },
          domains: ["external_instructions", "host_snippets"],
          reason: "watcher-debounce",
        }),
      ).resolves.toEqual({
        changedReadModelCount: 1,
        generatedPackageRefreshes: [],
        recoveryWorkIds: [],
      });
      await expect(
        runtime.facade.sourceInvalidation.refreshGeneratedContext({
          scope: "workspace",
          workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
          reason: "extension-source-changed",
        }),
      ).resolves.toBeUndefined();
      await expect(
        runtime.facade.sourceInvalidation.refreshGeneratedPackages({
          scope: "app-global",
          packages: ["@svvyx/extensions"],
          reason: "source-changed",
          sourceCommandId: "cmd_generated_refresh_01" as CommandId,
          recoveryWorkId: "recovery_generated_refresh_01" as RecoveryWorkId,
        }),
      ).resolves.toMatchObject(packageRefreshResult);

      expect(contextRefreshes).toEqual([
        {
          scope: "workspace",
          workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
          reason: "external-instruction-changed",
        },
        {
          scope: "workspace",
          workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
          reason: "extension-source-changed",
        },
      ]);
      expect(generatedPackageHostCalls).toEqual([]);
      expect(sourceInvalidationScanRequests).toEqual([
        {
          scope: { kind: "app-global" },
          domains: ["extensions"],
          reason: "watcher-debounce",
        },
      ]);
      expect(sourceInvalidationReconciliations).toEqual([
        {
          scope: {
            kind: "workspace",
            workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
          },
          domains: ["external_instructions", "host_snippets"],
          reason: "watcher-debounce",
        },
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("runs generated-package refresh through the extension package service at the runtime boundary", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "svvy-runtime-generated-packages-"));
    const extensionsRoot = join(tempRoot, "extensions");
    const workflowsSourceRoot = join(tempRoot, "workflows-source");
    const extensionsPackageRoot = join(tempRoot, "generated", "extensions-package");
    const workflowsPackageRoot = join(tempRoot, "generated", "workflows-package");
    const workspaceRoot = join(tempRoot, "workspace");
    mkdirSync(join(extensionsRoot, "sources", "user"), { recursive: true });
    mkdirSync(workflowsSourceRoot, { recursive: true });
    const linkCalls: string[] = [];
    const linkPathInputs: unknown[] = [];
    const stateCalls: string[] = [];
    const workspaceLinkFileHost = fakeWorkspaceLinkFileHost(
      new Map([
        [join(workspaceRoot, ".smithers"), { kind: "directory" }],
        [extensionsPackageRoot, { kind: "directory" }],
        [workflowsPackageRoot, { kind: "directory" }],
      ]),
      linkCalls,
    );
    const boundaryHost = {
      sourceRoots: {
        extensionsRoot: extensionsRoot as AbsolutePath,
        workflowsSourceRoot: workflowsSourceRoot as AbsolutePath,
      },
      generatedPackageRoots: {
        extensionsPackageRoot: extensionsPackageRoot as AbsolutePath,
        workflowsPackageRoot: workflowsPackageRoot as AbsolutePath,
        coreTypeContractPackageRoot: join(
          tmpdir(),
          "svvy-runtime-adapter-generated-core-type-contract",
        ) as AbsolutePath,
      },
      extensionStatePort: {
        records: {
          readSourceFingerprint: () => Effect.succeed(null),
        },
        dependencies: {
          isApproved: () => Effect.succeed(false),
          readReadiness: () => Effect.succeed(null),
        },
      },
      generatedPackageLinkPath: async (input) => {
        linkPathInputs.push(input);
        return join(
          workspaceRoot,
          ".smithers",
          "node_modules",
          "@svvyx",
          input.packageName === "@svvyx/workflows" ? "workflows" : "extensions",
        ) as AbsolutePath;
      },
      listAcquiredWorkspaceIds: () =>
        Effect.succeed(["workspace_generated_link_01" as WorkspaceId]),
      listRecoverableWorkspaceIds: () => Effect.succeed([]),
      materializeCoreTypeContractPackage: () => Effect.void,
      now: () => Effect.succeed("2026-04-18T09:00:00.000Z" as IsoDateTimeString),
      workspaceLinkFileHost,
    } satisfies RuntimeGeneratedPackageRefreshBoundaryHost &
      Pick<
        RuntimePort,
        "extensionStatePort" | "generatedPackageLinkPath" | "generatedPackageRoots" | "sourceRoots"
      >;
    const runtime = await createHarness({
      sourceRoots: boundaryHost.sourceRoots,
      generatedPackageRoots: boundaryHost.generatedPackageRoots,
      extensionStatePort: boundaryHost.extensionStatePort,
      generatedPackageLinkPath: boundaryHost.generatedPackageLinkPath,
      generatedPackageRefreshHost: {
        listAcquiredWorkspaceIds: boundaryHost.listAcquiredWorkspaceIds,
        listRecoverableWorkspaceIds: boundaryHost.listRecoverableWorkspaceIds,
        materializeCoreTypeContractPackage: boundaryHost.materializeCoreTypeContractPackage,
        now: boundaryHost.now,
        workspaceLinkFileHost: boundaryHost.workspaceLinkFileHost,
      },
      generatedPackageStateCalls: stateCalls,
    });

    try {
      await expect(
        runtime.facade.sourceInvalidation.refreshGeneratedPackages({
          scope: "app-global",
          packages: ["@svvyx/extensions"],
          reason: "startup-recovery",
          sourceCommandId: "cmd_generated_refresh_01" as CommandId,
          recoveryWorkId: "recovery_generated_refresh_01" as RecoveryWorkId,
        }),
      ).resolves.toMatchObject({
        scope: "app-global",
        packages: [{ packageName: "@svvyx/extensions", action: "written" }],
        workspaceLinks: [],
      });
      expect(linkPathInputs).toEqual([
        {
          workspaceId: "workspace_generated_link_01" as WorkspaceId,
          packageName: "@svvyx/extensions",
        },
      ]);
      expect(linkCalls).toEqual([
        `mkdir:${join(workspaceRoot, ".smithers", "node_modules", "@svvyx")}`,
        `symlink:${join(
          workspaceRoot,
          ".smithers",
          "node_modules",
          "@svvyx",
          "extensions",
        )}->${extensionsPackageRoot}`,
      ]);
      expect(stateCalls).toEqual([
        "build:@svvyx/extensions",
        "link:workspace_generated_link_01:@svvyx/extensions",
      ]);

      await expect(
        runtime.facade.sourceInvalidation.refreshGeneratedPackages({
          scope: "workspace-link-repair",
          workspaceId: "workspace_generated_link_01" as WorkspaceId,
          packages: ["@svvyx/workflows"],
          reason: "startup-recovery",
          sourceCommandId: "cmd_generated_link_01" as CommandId,
          recoveryWorkId: "recovery_generated_link_01" as RecoveryWorkId,
        } as never),
      ).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
      });
      expect(linkPathInputs).toEqual([
        {
          workspaceId: "workspace_generated_link_01" as WorkspaceId,
          packageName: "@svvyx/extensions",
        },
      ]);
      expect(linkCalls).toEqual([
        `mkdir:${join(workspaceRoot, ".smithers", "node_modules", "@svvyx")}`,
        `symlink:${join(
          workspaceRoot,
          ".smithers",
          "node_modules",
          "@svvyx",
          "extensions",
        )}->${extensionsPackageRoot}`,
      ]);
      expect(stateCalls).toEqual([
        "build:@svvyx/extensions",
        "link:workspace_generated_link_01:@svvyx/extensions",
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("uses required source invalidation methods independently", async () => {
    const generatedPackageHostCalls: string[] = [];
    const runtime = await createHarness({
      generatedPackageRefreshHost: defaultGeneratedPackageRefreshHost(generatedPackageHostCalls),
    });

    try {
      await expect(
        runtime.facade.sourceInvalidation.hint({
          scope: { kind: "app-global" },
          domain: "extensions",
          path: "/tmp/svvy/extensions/web/index.ts" as AbsolutePath,
        }),
      ).resolves.toBeUndefined();
      await expect(
        runtime.facade.sourceInvalidation.reconcile({
          scope: { kind: "app-global" },
          reason: "manual",
        }),
      ).resolves.toEqual({
        changedReadModelCount: 0,
        generatedPackageRefreshes: [],
        recoveryWorkIds: [],
      });
      await expect(
        runtime.facade.sourceInvalidation.refreshGeneratedPackages({
          scope: "app-global",
          packages: ["@svvyx/extensions"],
          reason: "source-changed",
        }),
      ).resolves.toMatchObject({
        scope: "app-global",
        packages: [{ packageName: "@svvyx/extensions", action: "written" }],
        workspaceLinks: [],
      });
      await expect(
        runtime.facade.sourceInvalidation.applyCommittedScanEvent({
          scope: { kind: "app-global" },
          event: {
            domains: [],
            reason: "manual",
            sourceFingerprints: {
              extensions: "extensions_fingerprint",
              workflows: "workflows_fingerprint",
              external_instructions: "external_instructions_fingerprint",
              host_snippets: "host_snippets_fingerprint",
            },
            afterCommit: [{ scope: "app", invalidation: { model: "extensions" } }],
          },
        }),
      ).resolves.toEqual({
        changedReadModelCount: 1,
        generatedPackageRefreshes: [],
        recoveryWorkIds: [],
      });
      expect(generatedPackageHostCalls).toEqual([]);
      expect(runtime.calls.sourceInvalidationScanRequests).toEqual([
        {
          scope: { kind: "app-global" },
          domains: ["extensions"],
          reason: "watcher-debounce",
        },
      ]);
      expect(runtime.calls.sourceInvalidationReconciliations).toEqual([
        {
          scope: { kind: "app-global" },
          reason: "manual",
        },
      ]);
      await runtime.waitForPublishedStateInvalidations(1);
      expect(runtime.calls.publishedStateInvalidations).toContainEqual([
        { scope: "app", invalidation: { model: "extensions" } },
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("streams runtime-owned event bus events through the facade", async () => {
    const runtime = await createHarness();
    const events = await runtime.facade.events({
      workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
    });
    const iterator = events[Symbol.asyncIterator]();

    try {
      const nextEvent = iterator.next();
      await runtime.facade.workspaces.acquire({
        cwd: "/tmp/runtime-adapter-user-workspace" as AbsolutePath,
        owner: {
          ownerId: "runtime_adapter_owner_01" as RuntimeOwnerId,
          kind: "test",
        },
        openReason: "test",
      });
      await expect(nextEvent).resolves.toMatchObject({
        done: false,
        value: {
          type: "workspace_read_model.changed",
          workspaceId: "workspace_runtime_adapter_01",
          invalidation: { model: "sessionNavigation" },
        },
      });
    } finally {
      await iterator.return?.();
      await runtime.dispose();
    }
  });

  it("threads caller-provided runtime layer config into the managed runtime layer", () => {
    const source = readFileSync(new URL("./runtime-service-adapter.ts", import.meta.url), "utf8");

    expect(source).toContain("config: RuntimeLayerConfig");
    expect(source).toContain("createRuntimeLayerConfigLayer(config)");
    expect(source).not.toContain("createRuntimeLayerConfigLayer(defaultRuntimeLayerConfig)");
  });
});
