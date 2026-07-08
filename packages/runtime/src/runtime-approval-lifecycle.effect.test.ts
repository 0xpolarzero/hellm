import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeContractError,
  RuntimeSessionWaitStatePort,
  type AnswerRuntimeApprovalInput,
  type CommandId,
  type RuntimeApprovalId,
  type RuntimeApprovalRecord,
  type RuntimeApprovalStatePortService,
  type RuntimeCommandRecord,
  type RuntimeCommandStatePortService,
  type RuntimeSessionWaitStatePortService,
  type StateInvalidationDescriptor,
  type StateMutationResult,
  type SurfacePiSessionId,
  type ToolItemId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeApprovalWaitService } from "./runtime-approval-wait-service";
import { answerRuntimeApproval } from "./runtime-approval-answer";

const approvalId = "approval_runtime_lifecycle_01" as RuntimeApprovalId;
const commandId = "command_runtime_lifecycle_01" as CommandId;
const sessionId = "wsess_runtime_lifecycle_01" as WorkspaceSessionId;
const surfacePiSessionId = "pi_runtime_lifecycle_01" as SurfacePiSessionId;

const approvalInvalidation = {
  scope: "workspace",
  workspaceId: "workspace_runtime_lifecycle" as WorkspaceId,
  invalidation: { model: "runtimeApprovals", ids: [approvalId] },
} satisfies StateInvalidationDescriptor;

const commandInvalidation = {
  scope: "workspace",
  workspaceId: "workspace_runtime_lifecycle" as WorkspaceId,
  invalidation: { model: "commandInspector", ids: [commandId] },
} satisfies StateInvalidationDescriptor;

const waitInvalidation = {
  scope: "workspace",
  workspaceId: "workspace_runtime_lifecycle" as WorkspaceId,
  invalidation: { model: "sessionNavigation" },
} satisfies StateInvalidationDescriptor;

function mutation<T>(
  value: T,
  afterCommit: readonly StateInvalidationDescriptor[],
): StateMutationResult<T> {
  return { value, afterCommit };
}

function approvalRecord(
  status: RuntimeApprovalRecord["status"] = "pending",
  reason: string | null = null,
): RuntimeApprovalRecord {
  return {
    requestId: approvalId,
    sessionId,
    surfacePiSessionId,
    threadId: null,
    turnId: null,
    commandId,
    toolCallId: "tool_runtime_lifecycle_01" as ToolItemId,
    toolName: "exec_command",
    approvalMode: "user",
    cwd: "/tmp/runtime-lifecycle",
    command: "git status --short",
    commandFamily: "git",
    patch: null,
    snippetArtifactId: null,
    typescriptCode: null,
    context: null,
    status,
    decisionReason: reason,
    reviewer: status === "pending" ? null : "user",
    createdAt: "2026-04-18T09:00:00.000Z",
    completedAt: status === "pending" ? null : "2026-04-18T09:01:00.000Z",
  };
}

function commandRecord(status: RuntimeCommandRecord["status"]): RuntimeCommandRecord {
  return {
    id: commandId,
    sessionId,
    turnId: null,
    workflowTaskAttemptId: null,
    surfacePiSessionId,
    threadId: null,
    workflowRunId: null,
    parentCommandId: null,
    toolName: "exec_command",
    executor: "orchestrator",
    visibility: "surface",
    status,
    attempts: 1,
    title: "Run git status",
    summary: "Waiting for approval.",
    arguments: null,
    facts: { approval: "pending" },
    error: null,
    startedAt: "2026-04-18T09:00:00.000Z",
    updatedAt: "2026-04-18T09:00:00.000Z",
    finishedAt: null,
  };
}

function answerInput(decision: AnswerRuntimeApprovalInput["decision"]): AnswerRuntimeApprovalInput {
  return decision === "approved"
    ? { approvalId, decision }
    : { approvalId, decision, reason: "Denied by test." };
}

function eventBus(calls: string[]): RuntimeEventBus["Service"] {
  return RuntimeEventBus.of({
    publishLive: () => Effect.die("Unexpected live event publication."),
    publishStateInvalidations: (input) =>
      Effect.sync(() => {
        calls.push(`publish:${input.afterCommit[0]?.invalidation.model ?? "none"}`);
        return [];
      }),
    subscribe: () => Effect.die("Unexpected runtime event subscription."),
  });
}

function approvalWaitService(
  calls: string[],
  options?: { readonly afterCommitFails?: boolean },
): RuntimeApprovalWaitService["Service"] {
  return RuntimeApprovalWaitService.of({
    waitForApproval: () => Effect.die("Unexpected approval wait call."),
    afterApprovalCommitted: (input) =>
      Effect.gen(function* () {
        yield* Effect.sync(() =>
          calls.push(
            `wait:${input.request.requestId}:${input.approved ? "approved" : input.reason}`,
          ),
        );
        if (options?.afterCommitFails) {
          return yield* Effect.fail(
            new RuntimeContractError({
              operation: "runtime.approvals.afterCommit",
              reason: "stale-state",
              message: "Approval wait service failed.",
            }),
          );
        }
      }),
    cancelApprovalWait: () => Effect.die("Unexpected approval wait cancellation."),
    cancelAllApprovalWaits: () => Effect.die("Unexpected approval wait cancellation."),
  });
}

function approvalState(calls: string[]): RuntimeApprovalStatePortService {
  return {
    createApprovalRequest: () => Effect.die("Unexpected approval creation."),
    getApprovalRequest: (input) =>
      Effect.sync(() => {
        calls.push(`lookup:${input.requestId}`);
        return approvalRecord();
      }),
    resolveApprovalRequest: (input) =>
      Effect.sync(() => {
        calls.push(`resolve:${input.requestId}:${input.status}`);
        return mutation(approvalRecord(input.status, input.decisionReason ?? null), [
          approvalInvalidation,
        ]);
      }),
    listOpenApprovalRequests: () => Effect.die("Unexpected approval listing."),
  };
}

function approvedCommandState(calls: string[]): RuntimeCommandStatePortService {
  return {
    ...unexpectedCommandState(),
    findCommandById: () => Effect.die("Unexpected command lookup."),
    startCommand: (input) =>
      Effect.sync(() => {
        calls.push(`start-command:${input.commandId}`);
        return mutation(commandRecord("running"), [commandInvalidation]);
      }),
    finishCommand: () => Effect.die("Unexpected command finish."),
  };
}

function deniedCommandState(calls: string[]): RuntimeCommandStatePortService {
  return {
    ...unexpectedCommandState(),
    findCommandById: (input) =>
      Effect.sync(() => {
        calls.push(`find-command:${input.commandId}`);
        return commandRecord("waiting");
      }),
    startCommand: () => Effect.die("Unexpected command start."),
    finishCommand: (input) =>
      Effect.sync(() => {
        calls.push(`finish-command:${input.commandId}:${input.status}`);
        return mutation(commandRecord("cancelled"), [commandInvalidation]);
      }),
  };
}

function sessionWaitState(calls: string[]): RuntimeSessionWaitStatePortService {
  return {
    setApprovalWait: () => Effect.die("Unexpected approval wait set."),
    setUserWait: () => Effect.die("Unexpected user wait set."),
    clearSessionWait: (input) =>
      Effect.sync(() => {
        calls.push(`clear-wait:${input.sessionId}`);
        return mutation(undefined, [waitInvalidation]);
      }),
  };
}

describe("runtime approval lifecycle", () => {
  it.effect("resolves approved answers through state before publishing and waking waiters", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      const result = yield* answerRuntimeApproval(answerInput("approved")).pipe(
        Effect.provideService(RuntimeApprovalStatePort, approvalState(calls)),
        Effect.provideService(RuntimeCommandStatePort, approvedCommandState(calls)),
        Effect.provideService(RuntimeSessionWaitStatePort, sessionWaitState(calls)),
        Effect.provideService(RuntimeEventBus, eventBus(calls)),
        Effect.provideService(RuntimeApprovalWaitService, approvalWaitService(calls)),
      );

      assert.deepStrictEqual(result, {
        approvalId,
        commandId,
        status: "approved",
      });
      assert.deepStrictEqual(calls, [
        `lookup:${approvalId}`,
        `resolve:${approvalId}:approved`,
        "publish:runtimeApprovals",
        `start-command:${commandId}`,
        "publish:commandInspector",
        `clear-wait:${sessionId}`,
        "publish:sessionNavigation",
        `wait:${approvalId}:approved`,
      ]);
    }),
  );

  it.effect("resolves denied answers by cancelling the command before waking waiters", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      const result = yield* answerRuntimeApproval(answerInput("denied")).pipe(
        Effect.provideService(RuntimeApprovalStatePort, approvalState(calls)),
        Effect.provideService(RuntimeCommandStatePort, deniedCommandState(calls)),
        Effect.provideService(RuntimeSessionWaitStatePort, sessionWaitState(calls)),
        Effect.provideService(RuntimeEventBus, eventBus(calls)),
        Effect.provideService(RuntimeApprovalWaitService, approvalWaitService(calls)),
      );

      assert.deepStrictEqual(result, {
        approvalId,
        commandId,
        status: "denied",
      });
      assert.deepStrictEqual(calls, [
        `lookup:${approvalId}`,
        `resolve:${approvalId}:denied`,
        "publish:runtimeApprovals",
        `find-command:${commandId}`,
        `finish-command:${commandId}:cancelled`,
        "publish:commandInspector",
        `clear-wait:${sessionId}`,
        "publish:sessionNavigation",
        `wait:${approvalId}:Denied by test.`,
      ]);
    }),
  );

  it.effect("maps approval wait failures after committed publication", () =>
    Effect.gen(function* () {
      const calls: string[] = [];

      const error = yield* answerRuntimeApproval(answerInput("approved")).pipe(
        Effect.provideService(RuntimeApprovalStatePort, approvalState(calls)),
        Effect.provideService(RuntimeCommandStatePort, approvedCommandState(calls)),
        Effect.provideService(RuntimeSessionWaitStatePort, sessionWaitState(calls)),
        Effect.provideService(RuntimeEventBus, eventBus(calls)),
        Effect.provideService(
          RuntimeApprovalWaitService,
          approvalWaitService(calls, { afterCommitFails: true }),
        ),
        Effect.flip,
      );

      assert.deepStrictEqual(
        { _tag: error._tag, reason: error.reason, operation: error.operation },
        {
          _tag: "RuntimeContractError",
          reason: "stale-state",
          operation: "runtime.approvals.afterCommit",
        } satisfies Partial<RuntimeContractError>,
      );
      assert.deepStrictEqual(calls, [
        `lookup:${approvalId}`,
        `resolve:${approvalId}:approved`,
        "publish:runtimeApprovals",
        `start-command:${commandId}`,
        "publish:commandInspector",
        `clear-wait:${sessionId}`,
        "publish:sessionNavigation",
        `wait:${approvalId}:approved`,
      ]);
    }),
  );
});

function unexpectedCommandState(): Omit<
  RuntimeCommandStatePortService,
  "findCommandById" | "startCommand" | "finishCommand"
> {
  return {
    createCommand: () => Effect.die("Unexpected command creation."),
    createOrReuseStreamingCommand: () => Effect.die("Unexpected streaming command creation."),
    findCommandByToolCallId: () => Effect.die("Unexpected command tool-call lookup."),
    updateCommandArguments: () => Effect.die("Unexpected command argument update."),
    recordCommandEvent: () => Effect.die("Unexpected command event record."),
    recordStdinWrite: () => Effect.die("Unexpected stdin write record."),
    hasCommandOutputEvent: () => Effect.die("Unexpected command output query."),
  };
}
