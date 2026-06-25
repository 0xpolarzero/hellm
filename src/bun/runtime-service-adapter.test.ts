import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import {
  type AcceptSubmittedRuntimeSurfaceMessageInput,
  type EnqueueRuntimeSurfaceMessageInput,
  type AbortPromptInput,
  type AbsolutePath,
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
  type RuntimeContractError,
  type RuntimeApprovalStatePortService,
  type RuntimeCommandRecord,
  type RecordRuntimeCommandStdinWriteInput,
  type ExtensionId,
  type GeneratedPackageName,
  type GeneratedPackagesRefreshResult,
  type QueueItemId,
  type RefreshGeneratedContextRequest,
  type RefreshGeneratedPackagesRequest,
  type RecoveryWorkId,
  type ReleaseWorkspaceInput,
  type RequestInputOptionId,
  type RequestInputQuestionId,
  type RequestInputRequestId,
  type RuntimeRequestStatePortService,
  type RuntimeCommandStatePortService,
  type RuntimeSessionWaitStatePortService,
  type RuntimeSourceStatePortService,
  type RuntimeSurfaceLifecycleStatePortService,
  type RuntimeWorkspaceStatePortService,
  type StateRevision,
  type RuntimeEvent,
  type RuntimeEventGenerationId,
  type RuntimeEventSequence,
  type RuntimeEventsInput,
  type RuntimeGeneratedPackageStatePortService,
  type RuntimeQueueStatePortService,
  type RuntimeSurfaceMessageRecord,
  type StateMutationResult,
  type OpenSurfaceInput,
  type OpenExtensionSourceEditInput,
  type RuntimeOwnerId,
  type SaveExtensionSourceEditInput,
  type SetRequestInputTimerPausedInput,
  type SetRequestInputTimerPausedResult,
  type SourceEditSaveResult,
  type SourceEditSession,
  type SourceInvalidationHint,
  type SourceReconcileRequest,
  type SourceReconcileResult,
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
} from "@svvy/core";
import {
  createCatalogBackedRuntime,
  refreshRuntimeGeneratedPackagesAtRuntimeBoundary,
  type CatalogBackedRuntimeDependencies,
} from "./runtime-service-adapter";
import type { RuntimeGeneratedPackageWorkspaceLinkFileHost } from "@svvy/runtime/bootstrap";

type RuntimePort = Parameters<typeof createCatalogBackedRuntime>[0];
type TestCatalog = RuntimePort["catalog"];
type CancelActivePromptCall = Parameters<TestCatalog["cancelActivePrompt"]>[0];
type CancelPromptCall = Parameters<TestCatalog["cancelPrompt"]>[0];
type DeleteQueuedMessageCall = Parameters<TestCatalog["deleteQueuedSurfaceMessage"]>[0];
type RuntimeQueuedMessageAbortedCall = Parameters<
  TestCatalog["afterRuntimeQueuedMessageAborted"]
>[0];
type RuntimeSteeredCall = Parameters<TestCatalog["afterRuntimeSurfaceMessageSteered"]>[0];
type RequestInputAnsweredCall = Parameters<TestCatalog["afterRequestInputAnswered"]>[0];
type RequestInputTimerPausedCall = Parameters<TestCatalog["afterRequestInputTimerPaused"]>[0];
type RuntimeQueuedCall = Parameters<TestCatalog["afterRuntimeSurfaceMessageQueued"]>[0];
type RuntimeQueuedResult = Awaited<ReturnType<TestCatalog["afterRuntimeSurfaceMessageQueued"]>>;
type RuntimeSourceEditsPort = NonNullable<RuntimePort["sourceEdits"]>;
type RuntimeSourceInvalidationPort = NonNullable<RuntimePort["sourceInvalidation"]>;
type RuntimeEventsPort = NonNullable<RuntimePort["events"]>;
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

function submitInput(delivery: SubmitMessageInput["delivery"]): SubmitMessageInput {
  return {
    target,
    message: { text: "Run the adapter test path." },
    delivery,
    clientSubmission: { source: "test", clientRequestId: "client_request_01" },
  };
}

async function createHarness(
  options: {
    authToken?: string | undefined;
    queuedMessageId?: QueueItemId;
    afterRuntimeQueuedResult?: RuntimeQueuedResult;
    sourceEdits?: RuntimeSourceEditsPort;
    sourceInvalidation?: RuntimeSourceInvalidationPort;
    events?: RuntimeEventsPort;
    commandRecord?: RuntimeCommandRecord | null;
    commandStdin?: RuntimeCommandStdinPort;
    commandControl?: RuntimeCommandControlPort;
  } = {},
) {
  const publishedStateInvalidations: StateInvalidationDescriptor[][] = [];
  const acceptSubmittedSurfaceMessageCalls: AcceptSubmittedRuntimeSurfaceMessageInput[] = [];
  const enqueueSurfaceMessageCalls: EnqueueRuntimeSurfaceMessageInput[] = [];
  const afterRuntimeQueuedCalls: RuntimeQueuedCall[] = [];
  const afterRuntimeQueuedMessageAbortedCalls: RuntimeQueuedMessageAbortedCall[] = [];
  const afterRuntimeSteeredCalls: RuntimeSteeredCall[] = [];
  const cancelActivePromptCalls: CancelActivePromptCall[] = [];
  const cancelPromptCalls: CancelPromptCall[] = [];
  const deleteQueuedMessageCalls: DeleteQueuedMessageCall[] = [];
  const cancelSurfaceMessageCalls: Array<{ id: string }> = [];
  const markSurfaceMessageQueuedCalls: Array<{ id: string; position?: "front" | "back" }> = [];
  const answerRequestInputCalls: AnswerRequestInputInput[] = [];
  const setRequestInputTimerPausedCalls: SetRequestInputTimerPausedInput[] = [];
  const afterRequestInputAnsweredCalls: RequestInputAnsweredCall[] = [];
  const afterRequestInputTimerPausedCalls: RequestInputTimerPausedCall[] = [];
  const resolveRuntimeApprovalAnswerCalls: Array<{
    approved: boolean;
    reason?: string | null;
    requestId: string;
  }> = [];
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
  const devBrowserToolsEvents: Array<{ name: string; details?: Record<string, unknown> }> = [];
  const generatedPackageStatePort = createGeneratedPackageStatePort();
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
    getRequestInput: () => Effect.die("Unexpected getRequestInput call."),
    listOpenBlockingRequestInputs: () =>
      Effect.die("Unexpected listOpenBlockingRequestInputs call."),
    answerRequestInput: (input) => {
      answerRequestInputCalls.push(input);
      return Effect.succeed(
        stateMutation(
          {
            requestId: input.requestId,
            questionId: input.questionId,
            status: "recorded",
            delivery: {
              kind: "nonblocking-queued",
              queuedItemId: "queue_runtime_adapter_answer_01" as QueueItemId,
            },
          } satisfies AnswerRequestInputResult,
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
        stateMutation(
          {
            requestId: input.requestId,
          } satisfies SetRequestInputTimerPausedResult,
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
      Effect.succeed(
        stateMutation({
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
        }),
      ),
    recordSourceDelete: (input) =>
      Effect.succeed(
        stateMutation({
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

  const catalog = {
    resolvePromptDefaultsForTarget: () => ({
      provider: "openai",
      model: "gpt-4o",
      reasoningEffort: "medium",
    }),
    getRuntimeApprovalStatePort: () => approvalStatePort,
    getRuntimeCommandStatePort: () => commandStatePort,
    getRuntimeQueueStatePort: () => queueStatePort,
    getRuntimeRequestStatePort: () => requestStatePort,
    getRuntimeSessionWaitStatePort: () => sessionWaitStatePort,
    getRuntimeSourceStatePort: () => sourceStatePort,
    getRuntimeSurfaceLifecycleStatePort: () => surfaceLifecycleStatePort,
    getRuntimeWorkspaceStatePort: () => workspaceStatePort,
    getRuntimeGeneratedPackageStatePort: () => generatedPackageStatePort,
    resolveRuntimeApprovalAnswer: (input) => {
      resolveRuntimeApprovalAnswerCalls.push(input);
    },
    afterRuntimeSurfaceMessageQueued: async (input) => {
      afterRuntimeQueuedCalls.push(input);
      return (
        options.afterRuntimeQueuedResult ?? {
          target: input.target,
          queuedMessageId: input.queuedMessageId,
          queued: true,
          dispatched: !input.queueOnly,
        }
      );
    },
    afterRuntimeQueuedMessageAborted: async (input) => {
      afterRuntimeQueuedMessageAbortedCalls.push(input);
      return { ok: true, target: input.target };
    },
    afterRuntimeSurfaceMessageSteered: async (input) => {
      afterRuntimeSteeredCalls.push(input);
      return { ok: true, target: input.target };
    },
    afterRequestInputAnswered: async (input) => {
      afterRequestInputAnsweredCalls.push(input);
      return { ok: true, target };
    },
    afterRequestInputTimerPaused: async (input) => {
      afterRequestInputTimerPausedCalls.push(input);
      return { ok: true };
    },
    cancelPrompt: async (input) => {
      cancelPromptCalls.push(input);
    },
    cancelActivePrompt: async (input) => {
      cancelActivePromptCalls.push(input);
    },
    deleteQueuedSurfaceMessage: async (input) => {
      deleteQueuedMessageCalls.push(input);
      return { ok: true, target: input.target };
    },
  } satisfies TestCatalog;

  const appLog = {
    debug: () => null,
    info: () => null,
    warning: () => null,
    error: () => null,
    subscribe: () => () => {},
  } satisfies RuntimePort["appLog"];

  const dependencies = {
    ensureUsableProviderAuth: async () =>
      Object.hasOwn(options, "authToken") ? options.authToken : "test-api-key",
    getProviderAuthUnavailableMessage: (provider) => `${provider} auth is unavailable.`,
    recordDevBrowserToolsEvent: (name, details) => {
      devBrowserToolsEvents.push({ name, details });
    },
  } satisfies CatalogBackedRuntimeDependencies;
  const sourceEdits = options.sourceEdits ?? defaultUnexpectedSourceEditsPort();
  const sourceInvalidation =
    options.sourceInvalidation ?? defaultUnexpectedSourceInvalidationPort();
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
      catalog,
      sourceEdits,
      sourceInvalidation,
      commandStdin,
      commandControl,
      ...(options.events ? { events: options.events } : {}),
      publishStateInvalidations: async ({ afterCommit }) => {
        publishedStateInvalidations.push([...afterCommit]);
        return [];
      },
      appLog,
    },
    dependencies,
  );

  return {
    ...runtime,
    calls: {
      acceptSubmittedSurfaceMessage: acceptSubmittedSurfaceMessageCalls,
      enqueueSurfaceMessage: enqueueSurfaceMessageCalls,
      afterRuntimeSurfaceMessageQueued: afterRuntimeQueuedCalls,
      afterRuntimeQueuedMessageAborted: afterRuntimeQueuedMessageAbortedCalls,
      afterRuntimeSurfaceMessageSteered: afterRuntimeSteeredCalls,
      cancelActivePrompt: cancelActivePromptCalls,
      cancelPrompt: cancelPromptCalls,
      deleteQueuedSurfaceMessage: deleteQueuedMessageCalls,
      cancelSurfaceMessage: cancelSurfaceMessageCalls,
      markSurfaceMessageQueued: markSurfaceMessageQueuedCalls,
      answerRequestInput: answerRequestInputCalls,
      setRequestInputTimerPaused: setRequestInputTimerPausedCalls,
      afterRequestInputAnswered: afterRequestInputAnsweredCalls,
      afterRequestInputTimerPaused: afterRequestInputTimerPausedCalls,
      resolveRuntimeApprovalAnswer: resolveRuntimeApprovalAnswerCalls,
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
      devBrowserToolsEvents,
      publishedStateInvalidations,
    },
  };
}

function defaultUnexpectedSourceEditsPort(): RuntimeSourceEditsPort {
  return {
    open: async () => unexpectedSourceEditCall("open"),
    save: async () => unexpectedSourceEditCall("save"),
  };
}

function unexpectedSourceEditCall(method: string): never {
  throw new Error(`Unexpected source edit ${method} call.`);
}

function defaultUnexpectedSourceInvalidationPort(): RuntimeSourceInvalidationPort {
  return {
    hint: async () => unexpectedSourceInvalidationCall("hint"),
    reconcile: async () => unexpectedSourceInvalidationCall("reconcile"),
    refreshGeneratedContext: async () =>
      unexpectedSourceInvalidationCall("refreshGeneratedContext"),
    refreshGeneratedPackages: async () =>
      unexpectedSourceInvalidationCall("refreshGeneratedPackages"),
  };
}

function unexpectedSourceInvalidationCall(method: string): never {
  throw new Error(`Unexpected source invalidation ${method} call.`);
}

async function collectEvents(iterable: AsyncIterable<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

describe("catalog-backed runtime service adapter", () => {
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
      expect(runtime.calls.publishedStateInvalidations).toHaveLength(6);
      expect(runtime.calls.publishedStateInvalidations[0]).toEqual([
        {
          scope: "workspace",
          workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
          invalidation: { model: "sessionNavigation" },
        },
      ]);
      expect(runtime.calls.publishedStateInvalidations[3]).toEqual([
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

  it("submits enqueue-and-run messages through the facade, queues, and asks the catalog to run", async () => {
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
            clientRequestId: "client_request_01",
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
        clientSubmission: { source: "test", clientRequestId: "client_request_01" },
        telemetry: { messageCount: 1, userMessageCount: 1, textBlockCount: 1, imageCount: 0 },
      });
      expect(runtime.calls.afterRuntimeSurfaceMessageQueued).toHaveLength(1);
      expect(runtime.calls.afterRuntimeSurfaceMessageQueued[0]?.queueOnly).toBe(false);
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

  it("submits queue-only messages through the facade, queues, and asks the catalog not to run", async () => {
    const runtime = await createHarness({
      queuedMessageId: "queue_runtime_adapter_only" as QueueItemId,
    });

    try {
      await expect(runtime.facade.messages.submit(submitInput("queue-only"))).resolves.toEqual({
        queuedMessageId: "queue_runtime_adapter_only" as QueueItemId,
        target,
        status: "queued",
        receipt: {
          clientRequestId: "client_request_01",
          outcome: "accepted",
          acceptedAt: "2026-04-18T09:00:00.000Z" as SubmitMessageResult["receipt"]["acceptedAt"],
          stateRevision: 1 as SubmitMessageResult["receipt"]["stateRevision"],
        },
      });
      expect(runtime.calls.acceptSubmittedSurfaceMessage).toHaveLength(1);
      expect(runtime.calls.afterRuntimeSurfaceMessageQueued).toHaveLength(1);
      expect(runtime.calls.afterRuntimeSurfaceMessageQueued[0]?.queueOnly).toBe(true);
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
      expect(runtime.calls.afterRuntimeSurfaceMessageQueued).toEqual([]);
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
      expect(runtime.calls.afterRuntimeSurfaceMessageQueued).toEqual([]);
      expect(runtime.calls.devBrowserToolsEvents).toEqual([]);
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
      expect(runtime.calls.deleteQueuedSurfaceMessage).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });

  it("cancels queued prompt aborts through runtime state and emits the post-commit catalog sync", async () => {
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
      expect(runtime.calls.afterRuntimeQueuedMessageAborted).toEqual([
        {
          target: handlerTarget,
          queuedMessageId: "queue_runtime_adapter_abort" as QueueItemId,
        },
      ]);
      expect(runtime.calls.deleteQueuedSurfaceMessage).toEqual([]);
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
      expect(runtime.calls.deleteQueuedSurfaceMessage).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });

  it("steers queued messages through runtime state and wakes the catalog after commit", async () => {
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
      expect(runtime.calls.afterRuntimeSurfaceMessageSteered).toEqual([
        {
          target: handlerTarget,
          queuedMessageId: "queue_runtime_adapter_steer" as QueueItemId,
        },
      ]);
    } finally {
      await runtime.dispose();
    }
  });

  it("records request-input answers, publishes invalidations, and runs the bootstrap wake callback", async () => {
    const runtime = await createHarness();
    const input = {
      surfacePiSessionId: target.surfacePiSessionId,
      requestId: "rui_runtime_adapter_01" as RequestInputRequestId,
      questionId: "ruiq_runtime_adapter_01" as RequestInputQuestionId,
      answer: { kind: "option", optionId: "ruio_runtime_adapter_01" as RequestInputOptionId },
      delivery: "enqueue-and-run",
      clientSubmission: {
        correlationId: "runtime-adapter-answer-01",
        source: "test",
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
      expect(runtime.calls.afterRequestInputAnswered).toEqual([
        {
          surfacePiSessionId: target.surfacePiSessionId,
          requestId: "rui_runtime_adapter_01" as RequestInputRequestId,
          queuedItemId: "queue_runtime_adapter_answer_01" as QueueItemId,
        },
      ]);
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

  it("sets request-input timer pause, publishes invalidations, and runs the bootstrap timer callback", async () => {
    const runtime = await createHarness();
    const input = {
      surfacePiSessionId: target.surfacePiSessionId,
      requestId: "rui_runtime_adapter_timer_01" as RequestInputRequestId,
      paused: true,
      clientSubmission: {
        correlationId: "runtime-adapter-timer-01",
        source: "test",
      },
    } satisfies SetRequestInputTimerPausedInput;

    try {
      await expect(runtime.facade.requestInput.setTimerPaused(input)).resolves.toEqual({
        requestId: "rui_runtime_adapter_timer_01" as RequestInputRequestId,
      });
      expect(runtime.calls.setRequestInputTimerPaused).toEqual([input]);
      expect(runtime.calls.afterRequestInputTimerPaused).toEqual([
        { requestId: "rui_runtime_adapter_timer_01" as RequestInputRequestId },
      ]);
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

  it("keeps command dependency actions unsupported until runtime dependency command lifecycle is wired", async () => {
    const runtime = await createHarness();

    try {
      await expect(
        runtime.facade.commands.runExtensionDependencyAction({
          scope: { kind: "app-global" },
          extensionId: "extension_web" as ExtensionId,
          requirementId: "tinyfish",
          action: "install",
        }),
      ).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
        error: { _tag: "RuntimeContractError" },
      });
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
          clientSubmission: { source: "test", clientRequestId: "cancel_request_01" },
        }),
      ).resolves.toEqual({
        commandId: "cmd_runtime_adapter_approval_01" as CommandId,
        status: "cancelled",
      });
      expect(runtime.calls.commandControl).toEqual([
        {
          commandId: "cmd_runtime_adapter_approval_01" as CommandId,
          reason: "test cancellation",
          clientSubmission: { source: "test", clientRequestId: "cancel_request_01" },
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
          clientSubmission: { source: "test", clientRequestId: "stdin_request_01" },
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
          clientSubmission: { source: "test", clientRequestId: "stdin_request_01" },
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

  it("answers runtime approvals through state ports, events, command state, wait state, and live waiter host", async () => {
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
      expect(runtime.calls.resolveRuntimeApprovalAnswer).toEqual([
        {
          requestId: "approval_runtime_adapter_01",
          approved: true,
          reason: "Looks correct.",
        },
      ]);
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

  it("delegates source edit requests through the required source edit port", async () => {
    const opened: OpenExtensionSourceEditInput[] = [];
    const saved: SaveExtensionSourceEditInput[] = [];
    const sourcePath = "/tmp/svvy/extensions/web/index.ts" as AbsolutePath;
    const session = {
      sourceKind: "user-extension",
      sourceId: "web",
      path: sourcePath,
      sourceVersion: "version_01",
      fingerprint: "fingerprint_01",
      text: "export default {};",
      diagnostics: [],
    } satisfies SourceEditSession;
    const saveResult = {
      status: "saved",
      sourceVersion: "version_02",
      fingerprint: "fingerprint_02",
      diagnostics: [],
      reconcileRequired: true,
    } satisfies SourceEditSaveResult;
    const runtime = await createHarness({
      sourceEdits: {
        open: async (input) => {
          opened.push(input);
          return session;
        },
        save: async (input) => {
          saved.push(input);
          return saveResult;
        },
      },
    });

    try {
      await expect(
        runtime.facade.sourceEdits.open({
          sourceKind: "user-extension",
          sourceId: "web",
        }),
      ).resolves.toEqual(session);
      await expect(
        runtime.facade.sourceEdits.save({
          sourceKind: "user-extension",
          sourceId: "web",
          expectedSourceVersion: "version_01",
          text: "export default { loaded: true };",
          saveMode: "compare-and-swap",
          sourceCommandId: "cmd_source_save_01" as CommandId,
        }),
      ).resolves.toEqual(saveResult);
      expect(opened).toEqual([{ sourceKind: "user-extension", sourceId: "web" }]);
      expect(saved).toHaveLength(1);
    } finally {
      await runtime.dispose();
    }
  });

  it("uses a fail-fast required source edit harness when a test does not wire source edits", async () => {
    const runtime = await createHarness();

    try {
      let caught: unknown;
      try {
        await runtime.facade.sourceEdits.open({
          sourceKind: "user-extension",
          sourceId: "web",
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
      });
      const typedError = (caught as { readonly error?: unknown }).error as RuntimeContractError;
      expect(typedError._tag).toBe("RuntimeContractError");
      expect(typedError.operation).toBe("runtime.sourceEdits.open");
      expect(typedError.reason).toBe("unsupported-operation");
      expect(typedError.message).toBe("Unexpected source edit open call.");
    } finally {
      await runtime.dispose();
    }
  });

  it("delegates source invalidation requests through the required invalidation port", async () => {
    const fileHints: SourceInvalidationHint[] = [];
    const reconciliations: SourceReconcileRequest[] = [];
    const contextRefreshes: RefreshGeneratedContextRequest[] = [];
    const packageRefreshes: RefreshGeneratedPackagesRequest[] = [];
    const reconcileResult = {
      changedReadModelCount: 0,
      generatedPackageRefreshes: [],
      recoveryWorkIds: [],
    } satisfies SourceReconcileResult;
    const packageRefreshResult = {
      scope: "app-global",
      packages: [{ packageName: "@svvyx/extensions", action: "written" }],
      workspaceLinks: [],
      recoveryWorkIds: [],
    } satisfies GeneratedPackagesRefreshResult;
    const runtime = await createHarness({
      sourceInvalidation: {
        hint: async (input) => {
          fileHints.push(input);
        },
        reconcile: async (input) => {
          reconciliations.push(input);
          return reconcileResult;
        },
        refreshGeneratedContext: async (input) => {
          contextRefreshes.push(input);
        },
        refreshGeneratedPackages: async (input) => {
          packageRefreshes.push(input);
          return packageRefreshResult;
        },
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
      expect(fileHints).toEqual([]);
      expect(reconciliations).toEqual([]);

      await expect(
        runtime.facade.sourceInvalidation.hint({
          scope: { kind: "app-global" },
          domain: "extensions",
          path: changedPath,
          observedAt: "2026-06-19T08:00:00.000Z",
        }),
      ).resolves.toBeUndefined();
      await expect(
        runtime.facade.sourceInvalidation.reconcile({
          scope: { kind: "workspace", workspaceId: "workspace_runtime_adapter_01" as WorkspaceId },
          domains: ["external_instructions", "host_snippets"],
          reason: "watcher-debounce",
        }),
      ).resolves.toEqual(reconcileResult);
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
      ).resolves.toEqual(packageRefreshResult);

      expect(fileHints).toEqual([
        {
          scope: { kind: "app-global" },
          domain: "extensions",
          path: changedPath,
          observedAt: "2026-06-19T08:00:00.000Z",
        },
      ]);
      expect(reconciliations).toEqual([
        {
          scope: { kind: "workspace", workspaceId: "workspace_runtime_adapter_01" as WorkspaceId },
          domains: ["external_instructions", "host_snippets"],
          reason: "watcher-debounce",
        },
      ]);
      expect(contextRefreshes).toEqual([
        {
          scope: "workspace",
          workspaceId: "workspace_runtime_adapter_01" as WorkspaceId,
          reason: "extension-source-changed",
        },
      ]);
      expect(packageRefreshes).toEqual([
        {
          scope: "app-global",
          packages: ["@svvyx/extensions"],
          reason: "source-changed",
          sourceCommandId: "cmd_generated_refresh_01" as CommandId,
          recoveryWorkId: "recovery_generated_refresh_01" as RecoveryWorkId,
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
      workspaceLinkFileHost,
    } satisfies Parameters<typeof refreshRuntimeGeneratedPackagesAtRuntimeBoundary>[0]["host"];
    const generatedPackageStatePort = createGeneratedPackageStatePort(stateCalls);

    await expect(
      refreshRuntimeGeneratedPackagesAtRuntimeBoundary({
        request: {
          scope: "app-global",
          packages: ["@svvyx/extensions"],
          reason: "startup-recovery",
          sourceCommandId: "cmd_generated_refresh_01" as CommandId,
          recoveryWorkId: "recovery_generated_refresh_01" as RecoveryWorkId,
        },
        host: boundaryHost,
        generatedPackageStatePort,
      }),
    ).resolves.toMatchObject({
      scope: "app-global",
      packages: [{ packageName: "@svvyx/extensions", action: "written" }],
      workspaceLinks: [],
    });
    expect(linkPathInputs).toEqual([]);
    expect(linkCalls).toEqual([]);
    expect(stateCalls).toEqual(["build:@svvyx/extensions"]);

    await expect(
      refreshRuntimeGeneratedPackagesAtRuntimeBoundary({
        request: {
          scope: "workspace-link-repair",
          workspaceId: "workspace_generated_link_01" as WorkspaceId,
          packages: ["@svvyx/workflows"],
          reason: "startup-recovery",
          sourceCommandId: "cmd_generated_link_01" as CommandId,
          recoveryWorkId: "recovery_generated_link_01" as RecoveryWorkId,
        },
        host: boundaryHost,
        generatedPackageStatePort,
      }),
    ).resolves.toMatchObject({
      scope: "workspace-link-repair",
      packages: [],
      workspaceLinks: [
        {
          workspaceId: "workspace_generated_link_01" as WorkspaceId,
          packageName: "@svvyx/workflows",
          status: "linked",
        },
      ],
    });
    expect(linkPathInputs).toEqual([
      {
        workspaceId: "workspace_generated_link_01" as WorkspaceId,
        packageName: "@svvyx/workflows",
      },
    ]);
    expect(linkCalls).toEqual([
      `mkdir:${join(workspaceRoot, ".smithers", "node_modules", "@svvyx")}`,
      `symlink:${join(
        workspaceRoot,
        ".smithers",
        "node_modules",
        "@svvyx",
        "workflows",
      )}->${workflowsPackageRoot}`,
    ]);
    expect(stateCalls).toEqual([
      "build:@svvyx/extensions",
      "link:workspace_generated_link_01:@svvyx/workflows",
    ]);
  });

  it("uses required source invalidation methods independently", async () => {
    const fileHints: SourceInvalidationHint[] = [];
    const calls: string[] = [];
    const runtime = await createHarness({
      sourceInvalidation: {
        hint: async (input) => {
          fileHints.push(input);
        },
        reconcile: async () => {
          calls.push("reconcile");
          return unexpectedSourceInvalidationCall("reconcile");
        },
        refreshGeneratedContext: async () => {
          calls.push("refreshGeneratedContext");
          return unexpectedSourceInvalidationCall("refreshGeneratedContext");
        },
        refreshGeneratedPackages: async () => {
          calls.push("refreshGeneratedPackages");
          return unexpectedSourceInvalidationCall("refreshGeneratedPackages");
        },
      },
    });

    try {
      await expect(
        runtime.facade.sourceInvalidation.hint({
          scope: { kind: "app-global" },
          domain: "extensions",
          path: "/tmp/svvy/extensions/web/index.ts" as AbsolutePath,
        }),
      ).resolves.toBeUndefined();
      expect(fileHints).toHaveLength(1);
      await expect(
        runtime.facade.sourceInvalidation.reconcile({
          scope: { kind: "app-global" },
          reason: "manual",
        }),
      ).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
        error: {
          _tag: "RuntimeContractError",
          operation: "runtime.sourceInvalidation.reconcile",
        },
      });
      await expect(
        runtime.facade.sourceInvalidation.refreshGeneratedPackages({
          scope: "app-global",
          packages: ["@svvyx/extensions"],
          reason: "source-changed",
        }),
      ).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
        error: {
          _tag: "RuntimeContractError",
          operation: "runtime.sourceInvalidation.refreshGeneratedPackages",
        },
      });
      expect(calls).toEqual(["reconcile", "refreshGeneratedPackages"]);
    } finally {
      await runtime.dispose();
    }
  });

  it("delegates runtime events through the optional event port", async () => {
    const eventGenerationId = "runtime-events-generation-test" as RuntimeEventGenerationId;
    const event = {
      type: "app_read_model.changed",
      eventGenerationId,
      sequence: 1 as RuntimeEventSequence,
      invalidation: { model: "extensions" },
    } satisfies RuntimeEvent;
    const subscriptions: RuntimeEventsInput[] = [];
    const runtime = await createHarness({
      events: (input) => {
        if (input) {
          subscriptions.push(input);
        }
        return Effect.succeed({
          stream: input?.includeAppEvents === true ? Stream.make(event) : Stream.empty,
          close: () => Effect.void,
          closed: Effect.succeed({
            reason: "closed",
            eventGenerationId,
            lastContiguousSequence: event.sequence,
            rebaselineRequired: false,
          }),
        });
      },
    });

    try {
      await expect(
        collectEvents(await runtime.facade.events({ includeAppEvents: true })),
      ).resolves.toEqual([event]);
      expect(subscriptions).toEqual([{ includeAppEvents: true }]);
    } finally {
      await runtime.dispose();
    }
  });

  it("fails runtime event subscriptions when no event port is supplied", async () => {
    const runtime = await createHarness();

    try {
      await expect(runtime.facade.events()).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
        error: { _tag: "RuntimeEventStreamError" },
      });
    } finally {
      await runtime.dispose();
    }
  });
});
