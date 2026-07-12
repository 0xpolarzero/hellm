import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeApprovalStatePort,
  StateContractError,
  type CommandId,
  type RuntimeApprovalId,
  type SurfacePiSessionId,
  type ToolItemId,
  type TurnId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import {
  layerRuntimeApprovalStatePort,
  runtimeApprovalStatePortFromStore,
} from "./runtime-approval-state-port";
import {
  layerStructuredSessionState,
  StructuredSessionState,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

const workspace = {
  id: "workspace_runtime_approval_state_port",
  cwd: "/tmp/svvy-runtime-approval-state-port",
  label: "Runtime approval state port",
};

const workspaceSessionId = "session-runtime-approval-state-port" as WorkspaceSessionId;
const surfacePiSessionId = "surface-runtime-approval-state-port" as SurfacePiSessionId;
const workspaceId = workspace.id as WorkspaceId;

describe("RuntimeApprovalStatePort", () => {
  it("creates, lists, reads, and resolves runtime approval requests", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* StructuredSessionState;
          yield* state.upsertPiSession({
            sessionId: workspaceSessionId,
            title: "Runtime approval state port",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "high",
            messageCount: 0,
            status: "idle",
            createdAt: "2026-04-18T08:55:00.000Z",
            updatedAt: "2026-04-18T08:56:00.000Z",
          });
          const turn = yield* state.startTurn({
            sessionId: workspaceSessionId,
            surfacePiSessionId,
            requestSummary: "Run a command requiring approval.",
          });
          const command = yield* state.createCommand({
            turnId: turn.id,
            surfacePiSessionId,
            toolName: "exec_command",
            executor: "orchestrator",
            visibility: "surface",
            title: "Run command",
            summary: "Run command.",
          });

          const port = yield* RuntimeApprovalStatePort;
          const requestResult = yield* port.createApprovalRequest({
            sessionId: workspaceSessionId,
            surfacePiSessionId,
            turnId: turn.id as TurnId,
            commandId: command.id as CommandId,
            toolCallId: "tool-call-runtime-approval" as ToolItemId,
            toolName: "exec_command",
            approvalMode: "user",
            cwd: workspace.cwd,
            command: "bun test",
            commandFamily: "bun",
            context: {
              reason: "sandbox_denial_escalation",
              sandboxDenied: true,
            },
          });
          const request = requestResult.value;
          const listed = yield* port.listOpenApprovalRequests({ surfacePiSessionId });
          const read = yield* port.getApprovalRequest({ requestId: request.requestId });
          const waitingCommand = yield* state.findCommandById(command.id);
          const waitingSession = yield* state.getSessionState(workspaceSessionId);
          const resolvedResult = yield* port.resolveApprovalRequest({
            requestId: request.requestId,
            status: "approved",
            reviewer: "user",
            decisionReason: "Looks good.",
          });
          const resolved = resolvedResult.value;
          const replayedResult = yield* port.resolveApprovalRequest({
            requestId: request.requestId,
            status: "approved",
            reviewer: "user",
            decisionReason: "Looks good.",
          });
          const conflictingResolution = yield* Effect.flip(
            port.resolveApprovalRequest({
              requestId: request.requestId,
              status: "denied",
              reviewer: "user",
              decisionReason: "Changed decision.",
            }),
          );
          const remaining = yield* port.listOpenApprovalRequests();

          expect(request).toMatchObject({
            sessionId: workspaceSessionId,
            surfacePiSessionId,
            commandId: command.id,
            toolName: "exec_command",
            approvalMode: "user",
            command: "bun test",
            context: {
              reason: "sandbox_denial_escalation",
              sandboxDenied: true,
            },
            status: "pending",
          });
          expect(listed.map((entry) => entry.requestId)).toEqual([request.requestId]);
          expect(read.requestId).toBe(request.requestId);
          expect(waitingCommand).toMatchObject({
            status: "waiting",
            facts: {
              approval: "pending",
              approvalRequestId: request.requestId,
            },
          });
          expect(waitingSession.session.wait).toMatchObject({
            kind: "approval",
            owner: { kind: "orchestrator" },
            reason: "Run command: bun test",
          });
          expect(requestResult.afterCommit).toEqual([
            {
              scope: "workspace",
              workspaceId,
              invalidation: {
                model: "runtimeApprovals",
                ids: [request.requestId],
              },
            },
            {
              scope: "workspace",
              workspaceId,
              invalidation: {
                model: "surface",
                ids: [surfacePiSessionId],
              },
            },
            {
              scope: "workspace",
              workspaceId,
              invalidation: { model: "sessionNavigation" },
            },
            {
              scope: "workspace",
              workspaceId,
              invalidation: {
                model: "commandInspector",
                ids: [command.id as CommandId],
              },
            },
          ]);
          expect(resolved).toMatchObject({
            requestId: request.requestId,
            status: "approved",
            reviewer: "user",
            decisionReason: "Looks good.",
            completedAt: expect.any(String),
          });
          expect(resolvedResult.afterCommit).toEqual(requestResult.afterCommit);
          expect(replayedResult.value).toEqual(resolved);
          expect(replayedResult.afterCommit).toEqual([]);
          expect(conflictingResolution).toMatchObject({
            reason: "conflict",
          });
          expect(remaining).toEqual([]);
          expect((yield* state.findCommandById(command.id))?.status).toBe("running");
          expect((yield* state.getSessionState(workspaceSessionId)).session.wait).toBeNull();
        }).pipe(
          Effect.provide(
            layerRuntimeApprovalStatePort.pipe(
              Layer.provideMerge(
                layerStructuredSessionState({
                  workspace,
                }),
              ),
            ),
          ),
        ),
      ),
    );
  });

  it("maps store failures to typed state errors through the runtime approval port", async () => {
    const port = runtimeApprovalStatePortFromStore(createFailingStore());

    await expect(
      runTestEffect(
        port.getApprovalRequest({
          requestId: "apr_runtime_approval_missing" as RuntimeApprovalId,
        }),
      ),
    ).rejects.toMatchObject({
      operation: "structured-session.getRuntimeApprovalRequest",
    });
    await expect(
      runTestEffect(
        port.getApprovalRequest({
          requestId: "apr_runtime_approval_missing" as RuntimeApprovalId,
        }),
      ),
    ).rejects.toBeInstanceOf(StateContractError);
  });
});

function createFailingStore(): StructuredSessionStateStore {
  return {
    workspaceId: "workspace_failure",
    databasePath: ":memory:",
    close: () => undefined,
    getRuntimeApprovalRequest: () => {
      throw new Error("approval read failed");
    },
  } as unknown as StructuredSessionStateStore;
}
