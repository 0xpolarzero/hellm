import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeContractError,
  RuntimeWorkflowTaskStatePort,
  type AuthenticatedRunTaskAgentInput,
  type RuntimeWorkflowTaskAgentStartReceipt,
  type RuntimeWorkflowTaskAgentTerminalReceipt,
  type RuntimeWorkflowTaskStatePortService,
  type StateInvalidationDescriptor,
  type SurfacePiSessionId,
  type TurnId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeGeneratedContextRefreshService } from "./runtime-generated-context-refresh-service";
import { RuntimeSurfaceQueueDispatcherService } from "./runtime-surface-queue-dispatcher-service";
import { RuntimeSurfaceScopeService } from "./surface-runtime-scope-service";
import {
  layerRuntimeWorkflowTaskAgentBridgeService,
  RuntimeWorkflowTaskAgentBridgeBearerVerifier,
  RuntimeWorkflowTaskAgentBridgeService,
} from "./workflow-task-agent-bridge-service";
import { layerRuntimeShutdownAdmission } from "./runtime-shutdown-admission";

const workspaceId = "workspace_workflow_task_bridge" as WorkspaceId;
const workspaceSessionId = "wsess_workflow_task_bridge" as WorkspaceSessionId;
const surfacePiSessionId = "pi_workflow_task_bridge" as SurfacePiSessionId;
const target = {
  workspaceSessionId,
  surface: "workflow-task",
  surfacePiSessionId,
  workflowTaskAttemptId: "wfta_workflow_task_bridge" as never,
  workflowRunId: "workflow_run_bridge" as never,
  threadId: "thread_workflow_task_bridge" as never,
} as const;
const acceptedInvalidation = {
  scope: "workspace",
  workspaceId,
  invalidation: { model: "sessionNavigation" },
} satisfies StateInvalidationDescriptor;
const settledInvalidation = {
  scope: "workspace",
  workspaceId,
  invalidation: {
    model: "workflowTaskAttemptInspector",
    ids: [target.workflowTaskAttemptId],
  },
} satisfies StateInvalidationDescriptor;

function request(
  overrides: Partial<AuthenticatedRunTaskAgentInput> = {},
): AuthenticatedRunTaskAgentInput {
  return {
    auth: { kind: "bearer", token: "bridge-token", transport: "loopback-http" },
    request: {
      operation: "runTaskAgent",
      workspaceSessionId,
      sourceCommandId: "cmd_workflow_task_bridge",
      agent: {
        id: "reviewerAgent",
        label: "Reviewer",
        provider: "openai",
        model: "gpt-5.4",
        reasoning: { effort: "medium" },
        instructions: "Review the task result.",
      },
      taskIdentity: {
        runId: "smithers-run-bridge",
        nodeId: "node-review",
        iteration: 2,
        attempt: 1,
      },
      promptSource: { kind: "prompt", prompt: "Review this." },
    },
    ...overrides,
  } as AuthenticatedRunTaskAgentInput;
}

describe("@svvy/runtime workflow task-agent bridge service", () => {
  it.effect(
    "authenticates, admits idempotently, queues, settles, and returns the task-agent result",
    () => {
      const acceptedInputs: Parameters<
        RuntimeWorkflowTaskStatePortService["acceptWorkflowTaskAgentStart"]
      >[0][] = [];
      const createdSurfaces: unknown[] = [];
      const refreshes: unknown[] = [];
      const drains: unknown[] = [];
      const published: Array<readonly StateInvalidationDescriptor[]> = [];
      let terminal: RuntimeWorkflowTaskAgentTerminalReceipt | null = null;
      const queuedMessage = {
        id: "queue_workflow_task_bridge",
        sessionId: workspaceSessionId,
        surfacePiSessionId,
        threadId: target.threadId,
        workflowTaskAttemptId: target.workflowTaskAttemptId,
        kind: "workflow_task_agent_start",
        status: "queued",
        priority: "runtime",
        sequence: 1,
        position: 1,
        attemptCount: 0,
        maxAttempts: 1,
        idempotencyKey:
          "workflow-task-agent-start:wsess_workflow_task_bridge:cmd_workflow_task_bridge:smithers-run-bridge:node-review:2:1:reviewerAgent",
        orderingKey: "workflow-task-attempt:wfta_workflow_task_bridge",
        sourceCommandId: "cmd_workflow_task_bridge",
        claimOwnerId: null,
        claimLeaseExpiresAt: null,
        leaseVersion: 0,
        nextAttemptAt: null,
        lastErrorJson: null,
        messageJson: JSON.stringify({ text: "Review this." }),
        payloadJson: null,
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:00.000Z",
        deliveredAt: null,
        failedAt: null,
        failureError: null,
        cancelledAt: null,
      } satisfies RuntimeWorkflowTaskAgentStartReceipt["queuedMessage"];
      const receipt = (accepted: "created" | "existing"): RuntimeWorkflowTaskAgentStartReceipt => ({
        workspaceId,
        target,
        queuedMessage,
        accepted,
      });
      const bridgeLayer = Layer.mergeAll(
        layerRuntimeShutdownAdmission,
        Layer.succeed(RuntimeWorkflowTaskAgentBridgeBearerVerifier, {
          verify: () => Effect.succeed(true),
        }),
        Layer.succeed(RuntimeWorkflowTaskStatePort, {
          getWorkflowTaskAgentAttemptTerminal: () => Effect.sync(() => terminal),
          acceptWorkflowTaskAgentStart: (input) =>
            Effect.sync(() => {
              acceptedInputs.push(input);
              return {
                value: receipt("created"),
                afterCommit: [acceptedInvalidation],
              };
            }),
          settleWorkflowTaskAgentAttempt: (input) =>
            Effect.sync(() => {
              const settled: RuntimeWorkflowTaskAgentTerminalReceipt =
                input.status === "completed"
                  ? {
                      status: "completed" as const,
                      result: input.result ?? { text: "" },
                    }
                  : {
                      status: "failed" as const,
                      error: input.error ?? "failed",
                    };
              terminal = settled;
              return {
                value: settled,
                afterCommit: [settledInvalidation],
              };
            }),
        }),
        Layer.succeed(RuntimeSurfaceScopeService, {
          create: (input) =>
            Effect.sync(() => {
              createdSurfaces.push(input);
              return {
                surfacePiSessionId,
                session: { surfacePiSessionId },
                withPromptLock: (effect) => effect,
                acquirePromptLock: () => Effect.succeed(Effect.void),
                restorePiHistory: () => Effect.void,
                runPiTurn: () => Effect.die("unused"),
                interruptActivePrompt: () => Effect.void,
                isPromptActive: () => false,
                activePromptDone: () => null,
                installActivePrompt: () => Effect.void,
                clearActivePrompt: () => Effect.void,
              };
            }),
          open: () => Effect.die("unused"),
          retainOpen: () => Effect.die("unused"),
          release: () => Effect.void,
          interrupt: () => Effect.void,
          snapshot: () => Effect.succeed([]),
        }),
        Layer.succeed(RuntimeGeneratedContextRefreshService, {
          refresh: (input) =>
            Effect.sync(() => {
              refreshes.push(input);
            }),
        }),
        Layer.succeed(RuntimeSurfaceQueueDispatcherService, {
          acceptWakeHint: () => Effect.void,
          drain: () => Effect.succeed(false),
          drainForQueueItem: (input) =>
            Effect.sync(() => {
              drains.push(input);
              return {
                queueItemId: input.queueItemId,
                turnId: "turn_workflow_task_bridge" as TurnId,
                status: "completed" as const,
                assistantText: "runtime prompt result",
                commandReceipts: [],
              };
            }),
        }),
        Layer.succeed(RuntimeEventBus, {
          publishLive: () => Effect.die("unused"),
          publishStateInvalidations: (input) =>
            Effect.sync(() => {
              published.push(input.afterCommit);
              return [];
            }),
          subscribe: () => Effect.die("unused"),
        }),
      );
      const runWithFreshBridgeService = Effect.gen(function* () {
        const bridge = yield* RuntimeWorkflowTaskAgentBridgeService;
        return yield* bridge.runTaskAgent(request());
      }).pipe(
        Effect.provide(layerRuntimeWorkflowTaskAgentBridgeService),
        Effect.provide(bridgeLayer),
      );

      return Effect.gen(function* () {
        const first = yield* runWithFreshBridgeService;
        const duplicateAfterRestart = yield* runWithFreshBridgeService;

        assert.deepStrictEqual(first, { text: "runtime prompt result" });
        assert.deepStrictEqual(duplicateAfterRestart, { text: "runtime prompt result" });
        assert.strictEqual(createdSurfaces.length, 1);
        assert.strictEqual(refreshes.length, 1);
        assert.deepStrictEqual(drains, [{ workspaceId, target, queueItemId: queuedMessage.id }]);
        assert.deepStrictEqual(
          acceptedInputs.map((input) => input.idempotencyKey),
          [
            "workflow-task-agent-start:wsess_workflow_task_bridge:cmd_workflow_task_bridge:smithers-run-bridge:node-review:2:1:reviewerAgent",
          ],
        );
        assert.deepStrictEqual(published, [[acceptedInvalidation], [settledInvalidation]]);
      });
    },
  );

  it.effect("rejects forged bearer lineage before durable admission", () => {
    let durableWrites = 0;
    return Effect.gen(function* () {
      const bridge = yield* RuntimeWorkflowTaskAgentBridgeService;
      const error = yield* bridge.runTaskAgent(request()).pipe(Effect.flip);

      assert.ok(error instanceof RuntimeContractError);
      assert.strictEqual(error.reason, "bridge-forbidden");
      assert.strictEqual(durableWrites, 0);
    }).pipe(
      Effect.provide(layerRuntimeWorkflowTaskAgentBridgeService),
      Effect.provide(
        Layer.mergeAll(
          layerRuntimeShutdownAdmission,
          Layer.succeed(RuntimeWorkflowTaskAgentBridgeBearerVerifier, {
            verify: () => Effect.succeed(false),
          }),
          Layer.succeed(RuntimeWorkflowTaskStatePort, {
            getWorkflowTaskAgentAttemptTerminal: () =>
              Effect.sync(() => {
                durableWrites += 1;
                return null;
              }),
            acceptWorkflowTaskAgentStart: () =>
              Effect.sync(() => {
                durableWrites += 1;
                throw new Error("unexpected admission");
              }),
            settleWorkflowTaskAgentAttempt: () =>
              Effect.sync(() => {
                durableWrites += 1;
                throw new Error("unexpected settlement");
              }),
          }),
          Layer.succeed(RuntimeSurfaceScopeService, {
            create: () => Effect.die("unused"),
            open: () => Effect.die("unused"),
            retainOpen: () => Effect.die("unused"),
            release: () => Effect.void,
            interrupt: () => Effect.void,
            snapshot: () => Effect.succeed([]),
          }),
          Layer.succeed(RuntimeGeneratedContextRefreshService, {
            refresh: () => Effect.die("unused"),
          }),
          Layer.succeed(RuntimeSurfaceQueueDispatcherService, {
            acceptWakeHint: () => Effect.void,
            drain: () => Effect.succeed(false),
            drainForQueueItem: () => Effect.die("unused"),
          }),
          Layer.succeed(RuntimeEventBus, {
            publishLive: () => Effect.die("unused"),
            publishStateInvalidations: () => Effect.die("unused"),
            subscribe: () => Effect.die("unused"),
          }),
        ),
      ),
    );
  });

  it.effect("rejects unauthenticated bridge requests before admission", () =>
    Effect.gen(function* () {
      const bridge = yield* RuntimeWorkflowTaskAgentBridgeService;
      const error = yield* bridge
        .runTaskAgent(request({ auth: { kind: "bearer", token: "", transport: "loopback-http" } }))
        .pipe(Effect.flip);

      assert.ok(error instanceof RuntimeContractError);
      assert.strictEqual(error.reason, "bridge-forbidden");
    }).pipe(
      Effect.provide(layerRuntimeWorkflowTaskAgentBridgeService),
      Effect.provide(
        Layer.mergeAll(
          layerRuntimeShutdownAdmission,
          Layer.succeed(RuntimeWorkflowTaskAgentBridgeBearerVerifier, {
            verify: () => Effect.succeed(true),
          }),
          Layer.succeed(RuntimeWorkflowTaskStatePort, {
            getWorkflowTaskAgentAttemptTerminal: () => Effect.die("unexpected terminal lookup"),
            acceptWorkflowTaskAgentStart: () => Effect.die("unexpected admission"),
            settleWorkflowTaskAgentAttempt: () => Effect.die("unexpected settlement"),
          }),
          Layer.succeed(RuntimeSurfaceScopeService, {
            create: () => Effect.die("unused"),
            open: () => Effect.die("unused"),
            retainOpen: () => Effect.die("unused"),
            release: () => Effect.void,
            interrupt: () => Effect.void,
            snapshot: () => Effect.succeed([]),
          }),
          Layer.succeed(RuntimeGeneratedContextRefreshService, {
            refresh: () => Effect.die("unused"),
          }),
          Layer.succeed(RuntimeSurfaceQueueDispatcherService, {
            acceptWakeHint: () => Effect.void,
            drain: () => Effect.succeed(false),
            drainForQueueItem: () => Effect.die("unused"),
          }),
          Layer.succeed(RuntimeEventBus, {
            publishLive: () => Effect.die("unused"),
            publishStateInvalidations: () => Effect.die("unused"),
            subscribe: () => Effect.die("unused"),
          }),
        ),
      ),
    ),
  );
});
